/** Interactive credential commands backed by the Harness credential and settings seams. */

import type { Context } from '@deepseek-ai/cordis'
import {
  AuthorizationError,
  type AuthorizationEntry,
} from '@deepseek-ai/dsh-authorization'
import type {} from '@deepseek-ai/dsh-authorization'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import {
  credentialRef,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRef,
} from '@deepseek-ai/dsh-credentials'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm'
import type { TuiPrompt, TuiService } from '../definition.ts'
import { resolveUiLanguage, uiText } from '../locale/index.ts'
import { createPromptBrowser } from '../runtime/prompt-browser.ts'
import { createAuthorizationInteraction } from '../session/authorization-interaction.ts'
import { logoutDeepSeekAccount } from './auth-account.ts'
import { openExternal } from './open-external.ts'
import { openAccountSettings, bindAccountNotices } from '../runtime/account-settings.ts'
import { registerCommands } from './registration.ts'
import {
  authorizationFlows,
  catalogForRecord,
  catalogProvidersWithoutFlows,
  fallbackDeepSeekEntry,
  flowChoiceValue,
  isAccountFlow,
  isDeepSeek,
  isPiAiDeepSeekFlow,
  loginAuthorizationFlows,
  logoutableProviders,
  parseFlowChoice,
  profileApiKeyEnv,
  providerListId,
} from './auth-providers.ts'
import { askPrompt } from '../prompt-intents.ts'

import {
  CUSTOM_PROTOCOLS,
  CUSTOM_PROVIDER_VALUE,
  DEEPSEEK_API_KEYS_URL,
  DEEPSEEK_MODELS_URL,
  managedProviderCredentialRef,
  normalizeApiKey,
  normalizeDeepSeekApiKey,
  parseBaseURL,
  parseModelIds,
  parseProviderId,
  validateDeepSeekApiKey,
} from './auth-input.ts'

export {
  CUSTOM_PROTOCOLS,
  CUSTOM_PROVIDER_VALUE,
  DEEPSEEK_API_KEYS_URL,
  DEEPSEEK_MODELS_URL,
  managedProviderCredentialRef,
  normalizeApiKey,
  normalizeDeepSeekApiKey,
  parseBaseURL,
  parseModelIds,
  parseProviderId,
  validateDeepSeekApiKey,
}

export const name = 'omdsh-command-auth'
export const inject = ['commands', 'credentials', 'settings', 'tui', 'llm']

export interface Config {
  /** Open the DeepSeek API-key dashboard when `/login` starts for DeepSeek. */
  openDashboard?: boolean
  /** Open the browser for a DeepSeek account sign-in. Defaults to true. */
  openBrowser?: boolean
}

export const DEEPSEEK_PROVIDER = 'deepseek-official'
export const DEEPSEEK_API_KEY = credentialRef('DEEPSEEK_API_KEY')
export const DEEPSEEK_SETTINGS = 'llm-deepseek'
export const PI_AI_SETTINGS = 'llm-pi-ai'
/** Sentinel the provider picker returns for "sign in to the DeepSeek account". */
export const DEEPSEEK_ACCOUNT_CHOICE = '__omdsh_deepseek_account__'
/** Prefix a picker value carries when it names an authorization flow. */
export const FLOW_VALUE_PREFIX = '__omdsh_flow__:'

/** Default when the credential store has nothing to say about a provider. */
const UNCONFIGURED: CredentialInfo = { configured: false, writable: true }
function credentialSource(info: CredentialInfo): string {
  if (info.source === 'env') return 'the current process environment'
  if (info.source === 'project-env') return 'the project .env file'
  if (info.source === 'user-env') return 'the user .env file'
  if (info.source === 'file') return 'the local Harness credential store'
  return info.source === undefined ? 'an external credential source' : `the ${info.source} credential source`
}

function unmanagedCredentialMessage(
  ref: CredentialRef,
  info: CredentialInfo,
  action: 'replace' | 'remove',
): string {
  const instruction = info.source === 'env'
    ? 'Unset it before starting omdsh.'
    : info.source === 'project-env'
      ? 'Remove it from the project .env file and restart omdsh.'
      : info.source === 'user-env'
        ? 'Remove it from the user .env file and restart omdsh.'
        : 'Update that source directly and restart omdsh.'
  return `${String(ref)} is supplied by ${credentialSource(info)} and /${action === 'replace' ? 'login' : 'logout'} cannot ${action} it. ${instruction}`
}

type LoginChoice =
  | LlmConfigurableProvider
  | typeof CUSTOM_PROVIDER_VALUE
  | typeof DEEPSEEK_ACCOUNT_CHOICE
  | AuthorizationEntry

interface FlowRecordLogout {
  key: CredentialKey
  label: string
  writable: boolean
}

type LogoutChoice = LlmConfigurableProvider | FlowRecordLogout | typeof DEEPSEEK_ACCOUNT_CHOICE

function loginChoiceValues(
  entries: readonly LlmConfigurableProvider[],
  flows: readonly AuthorizationEntry[],
  includeCustom: boolean,
  includeAccount = false,
): string[] {
  return [
    ...(includeAccount ? [DEEPSEEK_ACCOUNT_CHOICE] : []),
    ...entries.map(entry => entry.provider),
    ...flows.map(flow => flowChoiceValue(flow.key)),
    ...(includeCustom ? [CUSTOM_PROVIDER_VALUE] : []),
  ]
}

export function isFlowRecordLogout(choice: LogoutChoice): choice is FlowRecordLogout {
  return typeof choice !== 'string' && 'key' in choice && 'writable' in choice && !('provider' in choice)
}

async function configuredFlowRecords(ctx: Context): Promise<FlowRecordLogout[]> {
  const credentials = ctx.credentials
  const rows: FlowRecordLogout[] = []
  const claimed = new Set<CredentialKey>()
  for (const flow of authorizationFlows(ctx)) {
    if (isAccountFlow(flow)) continue
    const info = await credentials.describeRecord(flow.key)
    if (!info.configured) continue
    claimed.add(flow.key)
    rows.push({
      key: flow.key,
      label: isPiAiDeepSeekFlow(flow) ? 'DeepSeek (pi-ai compatibility)' : flow.label,
      writable: info.writable,
    })
  }
  for (const entry of await credentials.listRecords()) {
    if (claimed.has(entry.key)) continue
    const catalog = catalogForRecord(ctx, entry.key)
    if (catalog === undefined) continue
    const info = await credentials.describeRecord(entry.key)
    if (!info.configured) continue
    rows.push({ key: entry.key, label: catalog.displayName, writable: info.writable })
  }
  return rows
}

async function logoutableChoices(ctx: Context): Promise<LogoutChoice[]> {
  const providers = logoutableProviders(ctx)
  const records = await configuredFlowRecords(ctx)
  const account = ctx.get('deepseekAccount')
  const accountState = account === undefined ? undefined : await account.getState().catch(() => undefined)
  const accountChoice: LogoutChoice[] = accountState?.status === 'credential-stored' ? [DEEPSEEK_ACCOUNT_CHOICE] : []
  const actionable: LlmConfigurableProvider[] = []
  let inactiveDeepSeek: LlmConfigurableProvider | undefined

  for (const entry of providers) {
    if (!isDeepSeek(entry)) {
      actionable.push(entry)
      continue
    }

    const activeRef = profileApiKeyEnv(ctx, entry) ?? String(DEEPSEEK_API_KEY)
    const current = await ctx.credentials.describe(credentialRef(activeRef))
    if (current.configured && current.source === 'file') actionable.push(entry)
    else inactiveDeepSeek = entry
  }

  const choices: LogoutChoice[] = [...accountChoice, ...actionable, ...records]
  // Preserve the direct explanatory response when the environment-owned or
  // already-logged-out official route is the only thing the command can see.
  if (choices.length === 0 && inactiveDeepSeek !== undefined) return [inactiveDeepSeek]
  return choices
}

function selected(raw: string, values: readonly string[]): string | undefined {
  const index = /^\d+$/u.test(raw) ? Number(raw) - 1 : -1
  return index >= 0 ? values[index] : raw
}

type ProviderBadge = { label: string, tone: 'success' | 'warning' | 'muted' }

function credentialOwnershipBadge(info: { configured: boolean, source?: string }): ProviderBadge | undefined {
  if (!info.configured) return undefined
  if (info.source === 'file') return { label: 'stored locally', tone: 'success' }
  if (info.source === 'project-env') return { label: 'project .env', tone: 'muted' }
  if (info.source === 'user-env') return { label: 'user .env', tone: 'muted' }
  if (info.source === 'env') return { label: 'environment', tone: 'muted' }
  return { label: 'configured externally', tone: 'muted' }
}

async function pickLoginChoice(
  ctx: Context,
  invocation: CommandInvocation,
  prompt: TuiService['prompt'],
): Promise<LoginChoice | undefined> {
  const entries = catalogProvidersWithoutFlows(ctx)
  const flows = loginAuthorizationFlows(ctx)
  const entryRows = await Promise.all(entries.map(async (entry) => {
    const ref = profileApiKeyEnv(ctx, entry)
    const info = ref === undefined ? UNCONFIGURED : await ctx.credentials.describe(credentialRef(ref))
    return { entry, badge: credentialOwnershipBadge(info) }
  }))
  const flowRows = await Promise.all(flows.map(async flow => ({
    flow,
    info: await ctx.credentials.describeRecord(flow.key),
  })))
  flowRows.sort((left, right) => {
    const configured = Number(right.info.configured) - Number(left.info.configured)
    return configured !== 0 ? configured : left.flow.label.localeCompare(right.flow.label)
  })
  const orderedFlows = flowRows.map(row => row.flow)
  const account = ctx.get('deepseekAccount') as { getState?: () => Promise<{ status?: string }> } | undefined
  const accountState = account?.getState === undefined ? undefined : await account.getState().catch(() => undefined)
  const includeAccount = account?.getState !== undefined
  const values = loginChoiceValues(entries, orderedFlows, true, includeAccount)
  const raw = await prompt({ localize: true,
    presentation: 'card',
    filterable: true,
    title: 'Provider',
    question: 'Choose a provider to sign in or update',
    options: [
      ...(includeAccount ? [{
        label: 'DeepSeek account',
        value: DEEPSEEK_ACCOUNT_CHOICE,
        description: accountState?.status === 'credential-stored'
          ? 'signed in · shared with DSH; choose deepseek-account in /model'
          : 'signed out · opens the DeepSeek browser sign-in',
        ...(accountState?.status === 'credential-stored'
          ? { badge: { label: 'signed in', tone: 'success' as const } }
          : {}),
      }] : []),
      ...entryRows.map(({ entry, badge }) => ({
        label: providerListId(entry),
        value: entry.provider,
        description: isDeepSeek(entry) ? 'DeepSeek API key' : `${entry.displayName} API key`,
        ...(badge === undefined ? {} : { badge }),
      })),
      ...flowRows.map(({ flow, info }) => ({
        label: flow.label,
        value: flowChoiceValue(flow.key),
        description: flow.inFlight
          ? 'login in progress'
          : flow.methods.map(method => method.label).join(' · '),
        ...(flow.inFlight
          ? { badge: { label: 'login in progress', tone: 'warning' as const } }
          : info.configured
            ? { badge: { label: 'signed in', tone: 'success' as const } }
            : {}),
      })),
      {
        label: 'Custom',
        value: CUSTOM_PROVIDER_VALUE,
        description: 'Add a provider that is not in the catalog',
      },
    ],
    allowCustom: false,
    notify: false,
    signal: invocation.signal,
  })
  if (raw === null) return undefined
  if (raw.trim().toLowerCase() === 'custom' || selected(raw, values) === CUSTOM_PROVIDER_VALUE) {
    return CUSTOM_PROVIDER_VALUE
  }
  const chosen = selected(raw, values)
  if (chosen === undefined) return undefined
  if (chosen === DEEPSEEK_ACCOUNT_CHOICE) return DEEPSEEK_ACCOUNT_CHOICE
  const flowKey = parseFlowChoice(chosen)
  if (flowKey !== undefined) return orderedFlows.find(flow => flow.key === flowKey)
  return entries.find(entry => entry.provider === chosen)
}

function isAuthorizationFlow(choice: LoginChoice): choice is AuthorizationEntry {
  return typeof choice !== 'string' && 'key' in choice && 'methods' in choice
}

async function pickAuthorizationMethod(
  ctx: Context,
  invocation: CommandInvocation,
  flow: AuthorizationEntry,
): Promise<string | undefined> {
  if (flow.methods.length === 1) return flow.methods[0]?.id
  const values = flow.methods.map(method => method.id)
  const raw = await ctx.tui.prompt({ localize: true,
    title: `Login to ${flow.label}`,
    question: 'Choose a sign-in method',
    options: flow.methods.map(method => ({
      label: method.label,
      value: method.id,
    })),
    allowCustom: false,
    notify: false,
    signal: invocation.signal,
  })
  if (raw === null) return undefined
  return selected(raw, values)
}

async function loginAuthorization(
  ctx: Context,
  invocation: CommandInvocation,
  flow: AuthorizationEntry,
): Promise<CommandResult> {
  const authorization = ctx.get('authorization')
  if (authorization === undefined) {
    return { kind: 'error', text: 'Authorization is not available in this session.' }
  }
  if (flow.inFlight) {
    return { kind: 'error', text: `${flow.label} already has a login in progress.` }
  }
  const method = await pickAuthorizationMethod(ctx, invocation, flow)
  if (method === undefined) return { kind: 'success' }
  try {
    const outcome = await authorization.begin({
      key: flow.key,
      method,
      interaction: createAuthorizationInteraction({
        notice: message => { ctx.tui.notice(message) },
        prompt: request => ctx.tui.prompt({ ...request, notify: false }),
      }, `Login to ${flow.label}`),
      signal: invocation.signal,
    })
    if (outcome.status === 'cancelled') return { kind: 'success' }
    return { kind: 'success', text: `Logged in to ${flow.label}.` }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'success' }
    if (error instanceof AuthorizationError && error.code === 'ALREADY_IN_FLIGHT') {
      return { kind: 'error', text: `${flow.label} already has a login in progress.` }
    }
    return {
      kind: 'error',
      text: error instanceof Error ? error.message : `${flow.label} login failed.`,
    }
  }
}

async function resetDeepSeekCredentialRoute(ctx: Context): Promise<void> {
  await ctx.settings.mutate(DEEPSEEK_SETTINGS, [{ op: 'unset', path: ['apiKeyEnv'] }])
}

/** Best-effort browser launch for the DeepSeek key dashboard. */
export function openDeepSeekDashboard(): void {
  openExternal(DEEPSEEK_API_KEYS_URL)
}

async function loginDeepSeek(ctx: Context, invocation: CommandInvocation, config: Config, prompt: TuiService['prompt']): Promise<CommandResult> {
  const current = await ctx.credentials.describe(DEEPSEEK_API_KEY)
  if (current.configured && !current.writable) {
    return { kind: 'error', text: unmanagedCredentialMessage(DEEPSEEK_API_KEY, current, 'replace') }
  }
  if (config.openDashboard !== false) openDeepSeekDashboard()
  let stored = false
  while (!invocation.signal.aborted && !stored) {
    const apiKey = await readLoginField(prompt, askPrompt({ localize: ['title', 'question', 'actions'],
      title: 'Login to DeepSeek',
      question: current.configured ? 'Paste a new DeepSeek API key' : 'Paste your DeepSeek API key',
      detail: `Create or copy a key at ${DEEPSEEK_API_KEYS_URL}. It will be validated and stored locally as ${DEEPSEEK_API_KEY}.`,
      secret: true, submitLabel: 'validate', signal: invocation.signal,
    }), normalizeDeepSeekApiKey)
    if (apiKey === null) return { kind: 'success' }
    let validated = false
    while (!invocation.signal.aborted) {
      try {
        if (!validated) await validateDeepSeekApiKey(apiKey, invocation.signal)
        validated = true
        invocation.signal.throwIfAborted()
        await ctx.credentials.set(DEEPSEEK_API_KEY, apiKey)
        stored = true
        break
      } catch (error) {
        if (invocation.signal.aborted) return { kind: 'success' }
        const diagnostic = validated
          ? 'The API key is valid, but it could not be saved to the Harness credential store.'
          : error instanceof Error ? error.message : 'DeepSeek login failed.'
        const action = await prompt({ localize: ['title', 'question', 'options'],
          title: 'Login to DeepSeek', question: validated ? 'Could not save the key' : 'Could not validate the key',
          detail: diagnostic, allowCustom: false, notify: false, signal: invocation.signal,
          options: [
            { label: validated ? 'Retry saving' : 'Retry validation', value: 'retry' },
            { label: 'Enter another key', value: 'edit' },
            { label: 'Back', value: 'back' },
          ],
        })
        if (action === null || action === 'back') return { kind: 'success' }
        if (action !== 'retry') break
      }
    }
  }
  if (invocation.signal.aborted) return { kind: 'success' }
  // A profile may still pin the old product-owned reference. Reset it so the
  // upstream default resolves the key that was just stored.
  if (profileApiKeyEnv(ctx, fallbackDeepSeekEntry()) !== String(DEEPSEEK_API_KEY)) {
    try {
      await resetDeepSeekCredentialRoute(ctx)
    } catch {
      return {
        kind: 'error',
        text: 'The API key is valid and saved, but the DeepSeek credential reference could not be reset. Run /login again after checking your settings file.',
      }
    }
  }
  return {
    kind: 'success',
    text: 'Logged in to DeepSeek. The stored key is used by the deepseek-official route on the next model request.',
  }
}

async function loginCatalog(ctx: Context, invocation: CommandInvocation, entry: LlmConfigurableProvider, prompt: TuiService['prompt']): Promise<CommandResult> {
  const ref = managedProviderCredentialRef(entry.provider)
  const current = await ctx.credentials.describe(ref)
  if (current.configured && !current.writable) {
    return { kind: 'error', text: unmanagedCredentialMessage(ref, current, 'replace') }
  }
  const label = entry.displayName
  const apiKey = await readLoginField(prompt, askPrompt({ localize: ['title', 'question', 'actions'],
      title: `Login to ${label}`,
      question: current.configured ? `Paste a new ${label} API key` : `Paste your ${label} API key`,
      detail: `The key is stored locally and activates the ${entry.provider} route for the next model request. Use /model to select it.`,
      secret: true,
      submitLabel: 'save',
      signal: invocation.signal,
  }), value => normalizeApiKey(value, label))
  if (apiKey === null) return { kind: 'success' }
  try {
    await ctx.credentials.set(ref, apiKey)
  } catch {
    return { kind: 'error', text: `The API key could not be saved to the Harness credential store.` }
  }
  try {
    await ctx.settings.mutate(entry.settingsNs, [
      { op: 'set', path: [...entry.settingsPath, 'apiKeyEnv'], value: String(ref) },
    ])
  } catch {
    return {
      kind: 'error',
      text: `The API key is saved, but omdsh could not activate the ${entry.provider} route. Check your settings file and run /login again.`,
    }
  }
  return {
    kind: 'success',
    text: `Logged in to ${label}. Use /model to choose a model from ${entry.provider}.`,
  }
}

function reservedProviderIds(ctx: Context): Set<string> {
  return new Set([
    DEEPSEEK_PROVIDER,
    'deepseek',
    ...ctx.llm.listConfigurableProviders()
      .filter(entry => entry.declared !== true)
      .map(entry => entry.provider),
  ])
}

/** Retry a field in place, keeping only non-secret text in its editor. */
async function readLoginField(
  prompt: TuiService['prompt'],
  request: TuiPrompt,
  validate: (value: string) => string | Promise<string>,
): Promise<string | null> {
  let input = request.initialInput ?? '', diagnostic = ''
  while (!request.signal?.aborted) {
    const raw = await prompt({ ...request,
      ...(request.secret ? {} : { initialInput: input }),
      detail: [diagnostic, request.detail].filter(Boolean).join('\n\n'),
    })
    if (raw === null || request.signal?.aborted) return null
    if (!request.secret) input = raw
    try { return await validate(raw) }
    catch (error) { diagnostic = error instanceof Error ? error.message : 'Invalid value.' }
  }
  return null
}

async function collectCustomModels(
  ctx: Context,
  invocation: CommandInvocation,
  draft: { baseURL: string; api: string; apiKey?: string },
  prompt: TuiService['prompt'],
): Promise<string[] | undefined> {
  let diagnostic = '', typed = ''
  while (!invocation.signal.aborted) {
    const source = await prompt({ localize: true,
      title: 'Custom models', question: 'How should omdsh learn the model ids?', detail: diagnostic,
      options: [
        { label: 'Enter model ids', value: 'enter', description: 'Type one or more ids, separated by commas.' },
        { label: 'Fetch from endpoint', value: 'fetch', description: 'Ask the base URL for GET /models.' },
      ],
      initialValue: 'enter', allowCustom: false, notify: false, signal: invocation.signal,
    })
    if (source === null || invocation.signal.aborted) return undefined
    if (source === 'fetch') {
      try {
        const discovered = await ctx.llm.discoverModels('llm-pi-ai', draft, invocation.signal)
        if (invocation.signal.aborted) return undefined
        if (discovered.length === 1) return [discovered[0]!.id]
        if (discovered.length === 0) { diagnostic = 'No models were returned. Try again or enter model ids.'; continue }
        const picked = await prompt({ localize: ['title', 'question', 'actions'],
          title: 'Custom models', question: 'Choose models to enable',
          options: discovered.map(model => ({ label: model.id, value: model.id,
            ...(model.name === undefined || model.name === model.id ? {} : { description: model.name }) })),
          multiSelect: true, allowCustom: false, notify: false, filterable: true,
          presentation: 'card', signal: invocation.signal,
        })
        if (picked === null) continue
        return parseModelIds(picked)
      } catch (error) {
        diagnostic = error instanceof Error ? error.message : 'Could not fetch models. Try again or enter model ids.'
        continue
      }
    }
    const value = await readLoginField(prompt, askPrompt({ localize: ['title', 'question', 'actions'],
      title: 'Custom models', question: 'Enter model ids',
      detail: 'Separate multiple ids with commas. Example: llama3.1, qwen2.5-coder',
      initialInput: typed, onCancelDraft: value => { typed = value }, signal: invocation.signal,
    }), value => parseModelIds(value).join(', '))
    if (value !== null) return parseModelIds(value)
  }
  return undefined
}

async function loginCustom(ctx: Context, invocation: CommandInvocation, prompt: TuiService['prompt']): Promise<CommandResult | undefined> {
  let step = 0, id = '', baseURL = '', api = 'openai-completions'
  let apiKey: string | undefined
  let modelIds: string[] | undefined
  while (!invocation.signal.aborted && modelIds === undefined) {
    switch (step) {
      case 0: {
        const value = await readLoginField(prompt, askPrompt({ localize: ['title', 'question', 'actions'],
          title: 'Custom provider', question: 'Provider id',
          detail: 'Lowercase letters, digits, and hyphens. This id is permanent.',
          initialInput: id, onCancelDraft: value => { id = value }, signal: invocation.signal,
        }), value => {
          const parsed = parseProviderId(value)
          if (reservedProviderIds(ctx).has(parsed)) throw new Error(uiText(resolveUiLanguage(ctx.tui.prefs?.().uiLanguage), '{name} is a catalog provider. Choose it from the provider list.', { name: parsed }))
          return parsed
        })
        if (value === null) return undefined
        id = value
        step = 1
        break
      }
      case 1: {
        const value = await readLoginField(prompt, askPrompt({ localize: ['title', 'question', 'actions'],
          title: 'Custom provider', question: 'Base URL',
          detail: 'Absolute http(s) prefix, for example http://127.0.0.1:11434/v1',
          initialInput: baseURL, onCancelDraft: value => { baseURL = value }, signal: invocation.signal,
        }), parseBaseURL)
        if (value === null) { step = 0; break }
        baseURL = value
        step = 2
        break
      }
      case 2: {
        const value = await prompt({ localize: true, title: 'Custom provider', question: 'API protocol',
          options: CUSTOM_PROTOCOLS.map(protocol => ({ label: protocol, value: protocol,
            description: protocol === 'openai-completions'
              ? 'Chat Completions — Ollama, vLLM, LM Studio, and most gateways'
              : protocol === 'openai-responses' ? 'OpenAI Responses API' : 'Anthropic Messages API' })),
          initialValue: api, allowCustom: false, notify: false, signal: invocation.signal,
        })
        if (value === null) { step = 1; break }
        if (!(CUSTOM_PROTOCOLS as readonly string[]).includes(value)) break
        api = value
        step = 3
        break
      }
      case 3: {
        apiKey = undefined
        const value = await readLoginField(prompt, askPrompt({ localize: ['title', 'question', 'actions'],
          title: `Login to ${id}`, question: `Paste your ${id} API key`,
          detail: 'Leave empty if the endpoint does not need a key.', secret: true,
          submitLabel: 'continue', signal: invocation.signal,
        }), value => value.trim() === '' ? '' : normalizeApiKey(value, id))
        if (value === null) { step = 2; break }
        apiKey = value === '' ? undefined : value
        step = 4
        break
      }
      case 4:
        modelIds = await collectCustomModels(ctx, invocation, { baseURL, api,
          ...(apiKey === undefined ? {} : { apiKey }),
        }, prompt)
        if (modelIds === undefined) step = 3
        break
    }
  }
  if (invocation.signal.aborted || modelIds === undefined) return undefined

  const ref = managedProviderCredentialRef(id)
  if (apiKey !== undefined) {
    const current = await ctx.credentials.describe(ref)
    if (invocation.signal.aborted) return undefined
    if (current.configured && !current.writable) {
      return { kind: 'error', text: unmanagedCredentialMessage(ref, current, 'replace') }
    }
    try {
      await ctx.credentials.set(ref, apiKey)
    } catch {
      return { kind: 'error', text: 'The API key could not be saved to the Harness credential store.' }
    }
  }

  if (invocation.signal.aborted) return undefined
  try {
    await ctx.settings.mutate(PI_AI_SETTINGS, [{
      op: 'set',
      path: ['providers', id],
      value: {
        api,
        baseURL,
        models: modelIds.map(model => ({ id: model })),
        ...(apiKey === undefined ? {} : { apiKeyEnv: String(ref) }),
      },
    }])
  } catch {
    return {
      kind: 'error',
      text: `The custom provider could not be activated. Check the id, URL, protocol, and model list, then run /login again.`,
    }
  }
  return {
    kind: 'success',
    text: `Added ${id} with ${modelIds.length} model${modelIds.length === 1 ? '' : 's'}. Use /model to choose it.`,
  }
}

async function logoutDeepSeek(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const activeRef = profileApiKeyEnv(ctx, fallbackDeepSeekEntry()) ?? String(DEEPSEEK_API_KEY)
  const current = await ctx.credentials.describe(credentialRef(activeRef))
  if (!current.configured) {
    if (activeRef !== String(DEEPSEEK_API_KEY)) {
      try { await resetDeepSeekCredentialRoute(ctx) } catch {
        return { kind: 'error', text: 'Could not reset the DeepSeek credential setting.' }
      }
    }
    return { kind: 'success', text: 'DeepSeek is already logged out.' }
  }
  if (current.source !== 'file') {
    return { kind: 'success', text: `DeepSeek is configured by ${credentialSource(current)}; the credential store cannot remove it.` }
  }

  const answer = await ctx.tui.prompt({ localize: true,
    title: 'Logout from DeepSeek',
    question: 'Remove the stored DeepSeek API key?',
    detail: 'The next model request will use DEEPSEEK_API_KEY from the launch environment when one is available.',
    options: [
      { label: 'Cancel', value: 'cancel', description: 'Keep the current credential.' },
      {
        label: 'Log out',
        value: 'logout',
        description: 'Remove the key from the local Harness credential store.',
        badge: { label: 'removes credential', tone: 'warning' },
      },
    ],
    initialValue: 'cancel',
    allowCustom: false,
    notify: false,
    submitLabel: 'apply',
    signal: invocation.signal,
  })
  if (answer !== 'logout') return { kind: 'success' }
  try {
    await ctx.credentials.unset(credentialRef(activeRef))
    if (activeRef !== String(DEEPSEEK_API_KEY)) await resetDeepSeekCredentialRoute(ctx)
  } catch {
    return { kind: 'error', text: 'Could not remove the DeepSeek API key from the Harness credential store.' }
  }
  return { kind: 'success', text: 'Logged out from DeepSeek. The next model request falls back to the environment when available.' }
}

async function pickLogoutChoice(
  ctx: Context,
  invocation: CommandInvocation,
): Promise<LogoutChoice | undefined> {
  const choices = await logoutableChoices(ctx)
  if (choices.length === 0) return undefined
  if (choices.length === 1) return choices[0]
  const values = choices.map(choice => choice === DEEPSEEK_ACCOUNT_CHOICE
    ? DEEPSEEK_ACCOUNT_CHOICE
    : isFlowRecordLogout(choice) ? flowChoiceValue(choice.key) : choice.provider)
  const raw = await ctx.tui.prompt({ localize: true,
    presentation: 'card',
    filterable: true,
    title: 'Provider',
    question: 'Choose a provider to log out from',
    options: choices.map(choice => choice === DEEPSEEK_ACCOUNT_CHOICE
      ? {
        label: 'DeepSeek account',
        value: DEEPSEEK_ACCOUNT_CHOICE,
        description: 'shared with DSH · signed in',
      }
      : isFlowRecordLogout(choice)
        ? {
          label: choice.label,
          value: flowChoiceValue(choice.key),
          description: choice.writable ? 'signed in' : 'not removable here',
        }
        : {
          label: providerListId(choice),
          value: choice.provider,
          description: 'signed in',
        }),
    allowCustom: false,
    notify: false,
    signal: invocation.signal,
  })
  if (raw === null) return undefined
  const chosen = selected(raw, values)
  if (chosen === undefined) return undefined
  if (chosen === DEEPSEEK_ACCOUNT_CHOICE) return DEEPSEEK_ACCOUNT_CHOICE
  const flowKey = parseFlowChoice(chosen)
  if (flowKey !== undefined) return choices.find(choice => isFlowRecordLogout(choice) && choice.key === flowKey)
  return choices.find(choice => typeof choice !== 'string' && !isFlowRecordLogout(choice) && choice.provider === chosen)
}

async function logoutRecord(
  ctx: Context,
  invocation: CommandInvocation,
  record: FlowRecordLogout,
): Promise<CommandResult> {
  if (!record.writable) {
    return {
      kind: 'error',
      text: `The stored ${record.label} sign-in is not removable from this session. Update that credential source directly and restart omdsh.`,
    }
  }
  const answer = await ctx.tui.prompt({ localize: true,
    title: `Logout from ${record.label}`,
    question: `Remove the stored ${record.label} sign-in?`,
    detail: 'The local credential record is deleted. Settings profiles and environment credentials stay in place. The issuer is not notified.',
    options: [
      { label: 'Cancel', value: 'cancel', description: 'Keep the current credential.' },
      {
        label: 'Log out',
        value: 'logout',
        description: 'Delete the stored sign-in.',
        badge: { label: 'removes credential', tone: 'warning' },
      },
    ],
    initialValue: 'cancel',
    allowCustom: false,
    notify: false,
    submitLabel: 'apply',
    signal: invocation.signal,
  })
  if (answer !== 'logout') return { kind: 'success' }
  try {
    await ctx.credentials.deleteRecord(record.key)
  } catch {
    return { kind: 'error', text: `Could not remove the ${record.label} sign-in.` }
  }
  return { kind: 'success', text: `Logged out from ${record.label}.` }
}

async function logoutCatalog(ctx: Context, invocation: CommandInvocation, entry: LlmConfigurableProvider): Promise<CommandResult> {
  const label = entry.displayName
  const storedRef = profileApiKeyEnv(ctx, entry)
  const managedRef = managedProviderCredentialRef(entry.provider)
  const usesManaged = storedRef === String(managedRef)
  const current = storedRef === undefined
    ? UNCONFIGURED
    : await ctx.credentials.describe(credentialRef(storedRef))
  if (usesManaged && current.configured && !current.writable) {
    return { kind: 'error', text: unmanagedCredentialMessage(managedRef, current, 'remove') }
  }
  const removesStoredKey = usesManaged && current.source === 'file'
  const answer = await ctx.tui.prompt({ localize: true,
    title: `Logout from ${label}`,
    question: removesStoredKey
      ? `Remove the stored ${label} API key and deactivate the route?`
      : `Deactivate the ${entry.provider} route?`,
    detail: 'The route leaves the model picker. Environment credentials are left in place.',
    options: [
      { label: 'Cancel', value: 'cancel', description: 'Keep the current credential.' },
      {
        label: 'Log out',
        value: 'logout',
        description: removesStoredKey
          ? 'Remove the key from the local Harness credential store and drop the route.'
          : 'Drop the route without changing environment credentials.',
        badge: { label: 'removes route', tone: 'warning' },
      },
    ],
    initialValue: 'cancel',
    allowCustom: false,
    notify: false,
    submitLabel: 'apply',
    signal: invocation.signal,
  })
  if (answer !== 'logout') return { kind: 'success' }
  try {
    await ctx.settings.mutate(entry.settingsNs, [
      { op: 'unset', path: [...entry.settingsPath] },
    ])
    if (removesStoredKey) await ctx.credentials.unset(managedRef)
  } catch {
    return { kind: 'error', text: `Could not deactivate the ${entry.provider} route.` }
  }
  return { kind: 'success', text: `Logged out from ${label}.` }
}

async function login(ctx: Context, invocation: CommandInvocation, config: Config): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') {
    return { kind: 'error', text: 'Usage: /login (paste the key only into the protected prompt)' }
  }
  const abort = new AbortController()
  invocation = { ...invocation, signal: AbortSignal.any([invocation.signal, abort.signal]) }
  const prompt: TuiService['prompt'] = request => ctx.tui.prompt({ dismissLabel: 'Back', ...request,
    ...(request.detail === undefined ? {} : { detail: request.detail.split('\n').map(line => uiText(resolveUiLanguage(ctx.tui.prefs?.().uiLanguage), line)).join('\n') }),
    signal: invocation.signal, onSuperseded: () => abort.abort(),
  })
  const browse = createPromptBrowser(request => prompt({ ...request, dismissLabel: 'Cancel' }))
  while (!invocation.signal.aborted) {
    const choice = await pickLoginChoice(ctx, invocation, browse)
    if (choice === undefined || invocation.signal.aborted) return { kind: 'success' }
    if (choice === DEEPSEEK_ACCOUNT_CHOICE) {
      await openAccountSettings(ctx, invocation.signal, { ...config, signIn: true })
      return { kind: 'success' }
    }
    if (choice === CUSTOM_PROVIDER_VALUE) {
      const result = await loginCustom(ctx, invocation, prompt)
      if (result !== undefined) return result
      continue
    }
    if (isAuthorizationFlow(choice)) return loginAuthorization(ctx, invocation, choice)
    const result = isDeepSeek(choice)
      ? await loginDeepSeek(ctx, invocation, config, prompt)
      : await loginCatalog(ctx, invocation, choice, prompt)
    if (result.kind !== 'success' || result.text !== undefined) return result
  }
  return { kind: 'success' }
}

async function logout(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /logout' }
  const choice = await pickLogoutChoice(ctx, invocation)
  if (choice === undefined) return { kind: 'success' }
  if (choice === DEEPSEEK_ACCOUNT_CHOICE) return logoutDeepSeekAccount(ctx, invocation)
  if (isFlowRecordLogout(choice)) return logoutRecord(ctx, invocation, choice)
  return isDeepSeek(choice)
    ? logoutDeepSeek(ctx, invocation)
    : logoutCatalog(ctx, invocation, choice)
}

export function apply(ctx: Context, config: Config = {}): void {
  ctx.inject(['deepseekAccount'], accountCtx => { bindAccountNotices(accountCtx) })
  registerCommands(ctx, [
    {
      name: 'login',
      description: 'Sign in to a provider',
      handler: invocation => login(ctx, invocation, config),
    },
    {
      // Its own command: signing in and signing out are two intentions, and
      // folding the second into `/login logout` made the reader look for a verb
      // about leaving inside the one about entering.
      name: 'logout',
      description: 'Sign out of a stored provider or account',
      handler: invocation => logout(ctx, invocation),
    },
  ], 'omdsh authentication commands')
}
