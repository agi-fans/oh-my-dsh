/** Interactive credential commands backed by the Harness credential and settings seams. */

import { spawn } from 'node:child_process'
import process from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import {
  AuthorizationError,
  type AuthorizationEntry,
} from '@deepseek-ai/dsh-authorization'
import type {} from '@deepseek-ai/dsh-authorization'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import {
  credentialKey,
  credentialKeyId,
  credentialKeyScope,
  credentialRef,
  isCredentialKeySegment,
  parseCredentialKey,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRef,
} from '@deepseek-ai/dsh-credentials'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '../definition.ts'
import { createAuthorizationInteraction } from '../session/authorization-interaction.ts'
import { APP_VERSION } from '../session/package-metadata.ts'
import { registerCommands } from './registration.ts'

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
export const DEEPSEEK_API_KEYS_URL = 'https://platform.deepseek.com/api_keys'
export const DEEPSEEK_MODELS_URL = 'https://api.deepseek.com/v1/models'
export const CUSTOM_PROVIDER_VALUE = '__omdsh_custom__'
export const DEEPSEEK_ACCOUNT_CHOICE = '__omdsh_deepseek_account__'
export const FLOW_VALUE_PREFIX = '__omdsh_flow__:'
const PI_AI_RECORD_SCOPE = 'llm-pi-ai'

const FULLSCREEN_CHOICE_THRESHOLD = 8
const UNCONFIGURED: CredentialInfo = { configured: false, writable: true }
const PROVIDER_ID = /^[a-z][a-z0-9-]*$/u
const CUSTOM_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const

/** Match DeepSeek's own login normalization without accepting an empty Bearer value. */
export function normalizeDeepSeekApiKey(raw: string): string {
  return normalizeApiKey(raw, 'DeepSeek')
}

/** Trim a pasted key and reject an empty Bearer value. */
export function normalizeApiKey(raw: string, providerLabel: string): string {
  const normalized = raw.trim().replace(/^bearer\b\s*/iu, '')
  if (normalized === '') throw new Error(`Paste a non-empty ${providerLabel} API key.`)
  return normalized
}

/** omdsh-managed credential reference for one catalog provider route. */
export function managedProviderCredentialRef(provider: string): CredentialRef {
  return credentialRef(`OMDSH_${provider.toUpperCase().replace(/[^A-Z0-9]+/gu, '_')}_API_KEY`)
}

/** Lowercase kebab-case route id used as the permanent provider key. */
export function parseProviderId(raw: string): string {
  const id = raw.trim().toLowerCase()
  if (!PROVIDER_ID.test(id)) {
    throw new Error('Provider id must start with a letter and use only lowercase letters, digits, and hyphens.')
  }
  if (id === 'custom' || id === CUSTOM_PROVIDER_VALUE) {
    throw new Error('Choose a different provider id.')
  }
  return id
}

/** Absolute http(s) prefix the adapter will call. */
export function parseBaseURL(raw: string): string {
  const value = raw.trim().replace(/\/+$/u, '')
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Base URL must be an absolute http or https URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL must be an http or https URL.')
  }
  return value
}

/** One or more model ids from a comma- or whitespace-separated list. */
export function parseModelIds(raw: string): string[] {
  const ids = [...new Set(raw.split(/[,\s]+/u).map(item => item.trim()).filter(item => item !== ''))]
  if (ids.length === 0) throw new Error('Enter at least one model id.')
  return ids
}

/** Validate a candidate without ever reading or returning a response body. */
export async function validateDeepSeekApiKey(
  apiKey: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  let response: Response
  try {
    response = await fetchImpl(DEEPSEEK_MODELS_URL, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      signal,
    })
  } catch {
    if (signal.aborted) throw new Error('DeepSeek login was cancelled.')
    throw new Error('Could not reach DeepSeek to validate the API key. Check your network and try again.')
  }
  if (response.ok) return
  if (response.status === 401 || response.status === 403) {
    throw new Error('DeepSeek rejected this API key. Copy a valid key from the DeepSeek dashboard and try again.')
  }
  throw new Error(`DeepSeek could not validate the API key (HTTP ${response.status}). Try again later.`)
}

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

function isDeepSeek(entry: LlmConfigurableProvider): boolean {
  return entry.provider === DEEPSEEK_PROVIDER
}

function isPiAiLoginable(entry: LlmConfigurableProvider): boolean {
  return entry.settingsNs === 'llm-pi-ai' && entry.provider !== 'deepseek'
}

/** Picker labels are route ids; the official adapter keeps the DeepSeek product name. */
export function providerListId(entry: LlmConfigurableProvider): string {
  return isDeepSeek(entry) ? 'DeepSeek' : entry.provider
}

function fallbackDeepSeekEntry(): LlmConfigurableProvider {
  return {
    provider: DEEPSEEK_PROVIDER,
    displayName: 'DeepSeek',
    settingsNs: 'llm-deepseek',
    settingsPath: [],
  }
}

function loginableProviders(ctx: Context): LlmConfigurableProvider[] {
  const listed = ctx.llm.listConfigurableProviders()
  const loginable = listed.filter(entry => isDeepSeek(entry) || isPiAiLoginable(entry))
  return loginable.length > 0 ? loginable : [fallbackDeepSeekEntry()]
}

function authorizationFlows(ctx: Context): readonly AuthorizationEntry[] {
  return ctx.get('authorization')?.list() ?? []
}

function isPiAiDeepSeekFlow(flow: AuthorizationEntry): boolean {
  return credentialKeyScope(flow.key) === PI_AI_RECORD_SCOPE && credentialKeyId(flow.key) === 'deepseek'
}

function isAccountFlow(flow: AuthorizationEntry): boolean {
  return credentialKeyScope(flow.key) === 'deepseek-account-platform'
}

function loginAuthorizationFlows(ctx: Context): readonly AuthorizationEntry[] {
  return authorizationFlows(ctx).flatMap(flow => {
    if (isAccountFlow(flow)) return []
    if (!isPiAiDeepSeekFlow(flow)) return [flow]

    const profile = walkPath(sectionValue(ctx, PI_AI_SETTINGS), ['providers', 'deepseek'])
    if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) return []
    return [{ ...flow, label: 'DeepSeek (pi-ai compatibility)' }]
  })
}

function catalogAuthorizationFlow(ctx: Context, provider: string): AuthorizationEntry | undefined {
  const authorization = ctx.get('authorization')
  if (authorization === undefined || !isCredentialKeySegment(provider)) return undefined
  return authorization.describe(credentialKey(PI_AI_RECORD_SCOPE, provider))
}

function catalogProvidersWithoutFlows(ctx: Context): LlmConfigurableProvider[] {
  return loginableProviders(ctx).filter(entry => isDeepSeek(entry) || catalogAuthorizationFlow(ctx, entry.provider) === undefined)
}

function flowChoiceValue(key: CredentialKey): string {
  return FLOW_VALUE_PREFIX + key
}

function parseFlowChoice(raw: string): CredentialKey | undefined {
  if (!raw.startsWith(FLOW_VALUE_PREFIX)) return undefined
  try {
    return parseCredentialKey(raw.slice(FLOW_VALUE_PREFIX.length))
  } catch {
    return undefined
  }
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

type LogoutChoice = LlmConfigurableProvider | FlowRecordLogout

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

function sectionValue(ctx: Context, namespace: string): unknown {
  // A provider's configured fields are the live volatile config of its own
  // profile entry, so the roster reads the same values a form would show.
  return ctx.settings.describe().find(row => String(row.ns) === namespace)?.value
}

function walkPath(root: unknown, path: readonly string[]): unknown {
  let cursor = root
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

function profileApiKeyEnv(ctx: Context, entry: LlmConfigurableProvider): string | undefined {
  const profile = walkPath(sectionValue(ctx, entry.settingsNs), entry.settingsPath)
  if (isDeepSeek(entry)) {
    if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) return String(DEEPSEEK_API_KEY)
    const apiKeyEnv = (profile as Record<string, unknown>)['apiKeyEnv']
    return typeof apiKeyEnv === 'string' && apiKeyEnv.trim() !== '' ? apiKeyEnv : String(DEEPSEEK_API_KEY)
  }
  if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) return undefined
  const apiKeyEnv = (profile as Record<string, unknown>)['apiKeyEnv']
  return typeof apiKeyEnv === 'string' && apiKeyEnv.trim() !== '' ? apiKeyEnv : undefined
}

function hasStoredProfile(ctx: Context, entry: LlmConfigurableProvider): boolean {
  if (isDeepSeek(entry)) return true
  const profile = walkPath(sectionValue(ctx, entry.settingsNs), entry.settingsPath)
  return typeof profile === 'object' && profile !== null && !Array.isArray(profile)
}

function logoutableProviders(ctx: Context): LlmConfigurableProvider[] {
  return loginableProviders(ctx).filter(entry => isDeepSeek(entry) || hasStoredProfile(ctx, entry))
}

function catalogForRecord(ctx: Context, key: CredentialKey): LlmConfigurableProvider | undefined {
  const id = credentialKeyId(key)
  const scope = credentialKeyScope(key)
  return loginableProviders(ctx).find(entry => entry.provider === id && entry.settingsNs === scope)
}

function isFlowRecordLogout(choice: LogoutChoice): choice is FlowRecordLogout {
  return 'key' in choice && 'writable' in choice && !('provider' in choice)
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

  const choices: LogoutChoice[] = [...actionable, ...records]
  // Preserve the direct explanatory response when the environment-owned or
  // already-logged-out official route is the only thing the command can see.
  return choices.length === 0 && inactiveDeepSeek !== undefined ? [inactiveDeepSeek] : choices
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
): Promise<LoginChoice | undefined> {
  const entries = catalogProvidersWithoutFlows(ctx)
  const flows = loginAuthorizationFlows(ctx)
  if (entries.length === 0 && flows.length === 0) return CUSTOM_PROVIDER_VALUE
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
  const fullscreen = values.length > FULLSCREEN_CHOICE_THRESHOLD
  const raw = await ctx.tui.prompt({
    ...(fullscreen ? { presentation: 'fullscreen-list' as const } : {}),
    optionLayout: 'compact',
    filterable: fullscreen,
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
  const raw = await ctx.tui.prompt({
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

/** Best-effort browser launch; callers always retain the full URL as a fallback. */
function openExternal(url: string): void {
  const command = process.platform === 'darwin'
    ? { file: 'open', args: [url] }
    : process.platform === 'win32'
      ? { file: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url] }
      : { file: 'xdg-open', args: [url] }
  try {
    const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore' })
    child.once('error', () => undefined)
    child.unref()
  } catch {
    // Headless and remote terminals still receive the visible URL.
  }
}

/** Best-effort browser launch for the DeepSeek key dashboard. */
export function openDeepSeekDashboard(): void {
  openExternal(DEEPSEEK_API_KEYS_URL)
}

async function loginDeepSeek(ctx: Context, invocation: CommandInvocation, config: Config): Promise<CommandResult> {
  const current = await ctx.credentials.describe(DEEPSEEK_API_KEY)
  if (current.configured && !current.writable) {
    return { kind: 'error', text: unmanagedCredentialMessage(DEEPSEEK_API_KEY, current, 'replace') }
  }
  if (config.openDashboard !== false) openDeepSeekDashboard()
  const raw = await ctx.tui.prompt({
    title: 'Login to DeepSeek',
    question: current.configured ? 'Paste a new DeepSeek API key' : 'Paste your DeepSeek API key',
    detail: `Create or copy a key at ${DEEPSEEK_API_KEYS_URL}. It will be validated and stored locally as ${DEEPSEEK_API_KEY}.`,
    allowCustom: true,
    secret: true,
    notify: false,
    submitLabel: 'validate',
    signal: invocation.signal,
  })
  if (raw === null) return { kind: 'success' }

  let apiKey: string
  try {
    apiKey = normalizeDeepSeekApiKey(raw)
    await validateDeepSeekApiKey(apiKey, invocation.signal)
  } catch (error) {
    if (invocation.signal.aborted) return { kind: 'success' }
    return { kind: 'error', text: error instanceof Error ? error.message : 'DeepSeek login failed.' }
  }
  try {
    await ctx.credentials.set(DEEPSEEK_API_KEY, apiKey)
  } catch {
    return { kind: 'error', text: 'The API key is valid, but it could not be saved to the Harness credential store.' }
  }
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

async function loginCatalog(ctx: Context, invocation: CommandInvocation, entry: LlmConfigurableProvider): Promise<CommandResult> {
  const ref = managedProviderCredentialRef(entry.provider)
  const current = await ctx.credentials.describe(ref)
  if (current.configured && !current.writable) {
    return { kind: 'error', text: unmanagedCredentialMessage(ref, current, 'replace') }
  }
  const label = entry.displayName
  const raw = await ctx.tui.prompt({
    title: `Login to ${label}`,
    question: current.configured ? `Paste a new ${label} API key` : `Paste your ${label} API key`,
    detail: `The key is stored locally and activates the ${entry.provider} route for the next model request. Use /model to select it.`,
    allowCustom: true,
    secret: true,
    notify: false,
    submitLabel: 'save',
    signal: invocation.signal,
  })
  if (raw === null) return { kind: 'success' }

  let apiKey: string
  try {
    apiKey = normalizeApiKey(raw, label)
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : `${label} login failed.` }
  }
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

async function collectCustomModels(
  ctx: Context,
  invocation: CommandInvocation,
  draft: { baseURL: string; api: string; apiKey?: string },
): Promise<string[] | undefined> {
  const source = await ctx.tui.prompt({
    title: 'Custom models',
    question: 'How should omdsh learn the model ids?',
    options: [
      { label: 'Enter model ids', value: 'enter', description: 'Type one or more ids, separated by commas.' },
      { label: 'Fetch from endpoint', value: 'fetch', description: 'Ask the base URL for GET /models.' },
    ],
    initialValue: 'enter',
    allowCustom: false,
    notify: false,
    signal: invocation.signal,
  })
  if (source === null) return undefined
  if (source === 'fetch') {
    try {
      const discovered = await ctx.llm.discoverModels('llm-pi-ai', {
        baseURL: draft.baseURL,
        api: draft.api,
        ...(draft.apiKey === undefined ? {} : { apiKey: draft.apiKey }),
      }, invocation.signal)
      if (discovered.length === 1) return [discovered[0]?.id ?? '']
      if (discovered.length > 1) {
        const picked = await ctx.tui.prompt({
          title: 'Custom models',
          question: 'Choose models to enable',
          options: discovered.map(model => ({
            label: model.id,
            value: model.id,
            ...(model.name === undefined || model.name === model.id ? {} : { description: model.name }),
          })),
          multiSelect: true,
          allowCustom: false,
          notify: false,
          filterable: discovered.length > FULLSCREEN_CHOICE_THRESHOLD,
          ...(discovered.length > FULLSCREEN_CHOICE_THRESHOLD ? { presentation: 'fullscreen-list' as const } : {}),
          signal: invocation.signal,
        })
        if (picked === null) return undefined
        return parseModelIds(picked)
      }
    } catch (error) {
      if (invocation.signal.aborted) return undefined
      const detail = error instanceof Error ? error.message : 'the endpoint did not list models'
      const fallback = await ctx.tui.prompt({
        title: 'Custom models',
        question: 'Enter model ids',
        detail: `Could not fetch models (${detail}). Type one or more ids, separated by commas.`,
        allowCustom: true,
        notify: false,
        signal: invocation.signal,
      })
      if (fallback === null) return undefined
      return parseModelIds(fallback)
    }
  }
  const typed = await ctx.tui.prompt({
    title: 'Custom models',
    question: 'Enter model ids',
    detail: 'Separate multiple ids with commas. Example: llama3.1, qwen2.5-coder',
    allowCustom: true,
    notify: false,
    signal: invocation.signal,
  })
  if (typed === null) return undefined
  return parseModelIds(typed)
}

async function loginCustom(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const idRaw = await ctx.tui.prompt({
    title: 'Custom provider',
    question: 'Provider id',
    detail: 'Lowercase letters, digits, and hyphens. This id is permanent.',
    allowCustom: true,
    notify: false,
    signal: invocation.signal,
  })
  if (idRaw === null) return { kind: 'success' }
  let id: string
  try {
    id = parseProviderId(idRaw)
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : 'Invalid provider id.' }
  }
  if (reservedProviderIds(ctx).has(id)) {
    return { kind: 'error', text: `${id} is a catalog provider. Use /login and choose it from the list.` }
  }

  const urlRaw = await ctx.tui.prompt({
    title: 'Custom provider',
    question: 'Base URL',
    detail: 'Absolute http(s) prefix, for example http://127.0.0.1:11434/v1',
    allowCustom: true,
    notify: false,
    signal: invocation.signal,
  })
  if (urlRaw === null) return { kind: 'success' }
  let baseURL: string
  try {
    baseURL = parseBaseURL(urlRaw)
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : 'Invalid base URL.' }
  }

  const api = await ctx.tui.prompt({
    title: 'Custom provider',
    question: 'API protocol',
    options: CUSTOM_PROTOCOLS.map(protocol => ({
      label: protocol,
      value: protocol,
      description: protocol === 'openai-completions'
        ? 'Chat Completions — Ollama, vLLM, LM Studio, and most gateways'
        : protocol === 'openai-responses' ? 'OpenAI Responses API' : 'Anthropic Messages API',
    })),
    initialValue: 'openai-completions',
    allowCustom: false,
    notify: false,
    signal: invocation.signal,
  })
  if (api === null) return { kind: 'success' }
  if (!(CUSTOM_PROTOCOLS as readonly string[]).includes(api)) {
    return { kind: 'error', text: `Unknown API protocol: ${api}` }
  }

  const keyRaw = await ctx.tui.prompt({
    title: `Login to ${id}`,
    question: `Paste your ${id} API key`,
    detail: 'Leave empty if the endpoint does not need a key.',
    allowCustom: true,
    secret: true,
    notify: false,
    submitLabel: 'continue',
    signal: invocation.signal,
  })
  if (keyRaw === null) return { kind: 'success' }
  let apiKey: string | undefined
  if (keyRaw.trim() !== '') {
    try {
      apiKey = normalizeApiKey(keyRaw, id)
    } catch (error) {
      return { kind: 'error', text: error instanceof Error ? error.message : `${id} login failed.` }
    }
  }

  let modelIds: string[]
  try {
    const collected = await collectCustomModels(ctx, invocation, {
      baseURL,
      api,
      ...(apiKey === undefined ? {} : { apiKey }),
    })
    if (collected === undefined) return { kind: 'success' }
    modelIds = collected.filter(item => item !== '')
    if (modelIds.length === 0) throw new Error('Enter at least one model id.')
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : 'Invalid model list.' }
  }

  const ref = managedProviderCredentialRef(id)
  if (apiKey !== undefined) {
    const current = await ctx.credentials.describe(ref)
    if (current.configured && !current.writable) {
      return { kind: 'error', text: unmanagedCredentialMessage(ref, current, 'replace') }
    }
    try {
      await ctx.credentials.set(ref, apiKey)
    } catch {
      return { kind: 'error', text: 'The API key could not be saved to the Harness credential store.' }
    }
  }

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

  const answer = await ctx.tui.prompt({
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
  const values = choices.map(choice => isFlowRecordLogout(choice) ? flowChoiceValue(choice.key) : choice.provider)
  const fullscreen = values.length > FULLSCREEN_CHOICE_THRESHOLD
  const raw = await ctx.tui.prompt({
    ...(fullscreen ? { presentation: 'fullscreen-list' as const } : {}),
    optionLayout: 'compact',
    filterable: fullscreen,
    title: 'Provider',
    question: 'Choose a provider to log out from',
    options: choices.map(choice => isFlowRecordLogout(choice)
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
  const flowKey = parseFlowChoice(chosen)
  if (flowKey !== undefined) return choices.find(choice => isFlowRecordLogout(choice) && choice.key === flowKey)
  return choices.find(choice => !isFlowRecordLogout(choice) && choice.provider === chosen)
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
  const answer = await ctx.tui.prompt({
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
  const answer = await ctx.tui.prompt({
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

interface AccountAttemptLike {
  id?: unknown
  phase?: string
  authorizeUrl?: string
  errorCode?: string
}

interface AccountStateLike {
  status?: string
  attempt?: AccountAttemptLike | null
}

interface AccountLike {
  getState(): Promise<AccountStateLike>
  startSignIn(client: AccountClientMetadata, callbackOrigin: string, source: 'web' | 'desktop'): Promise<AccountStateLike>
  cancelSignIn(id: unknown): Promise<AccountStateLike>
  signOut(client: AccountClientMetadata): Promise<AccountStateLike>
}

interface AccountClientMetadata {
  version: string
  locale: string
  timezoneOffsetSeconds: number
}

interface WebServerLike {
  protocol: 'http:' | 'https:'
  host: string
  port: number
}

function accountClient(ctx: Context): AccountLike | undefined {
  return ctx.get('deepseekAccount') as AccountLike | undefined
}

function accountClientMetadata(): AccountClientMetadata {
  return {
    version: APP_VERSION,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
}

function accountCallbackOrigin(ctx: Context): string | undefined {
  const server = ctx.get('webServer') as WebServerLike | undefined
  if (server === undefined || typeof server.port !== 'number' || server.port === 0) return undefined
  return `${server.protocol}//${server.host}:${server.port}`
}

function accountFailure(attempt: AccountAttemptLike | null | undefined): string | undefined {
  if (attempt?.phase === 'expired') return 'The DeepSeek sign-in expired. Run /login to try again.'
  if (attempt?.phase === 'failed') return `DeepSeek sign-in failed${attempt.errorCode === undefined ? '' : ` (${attempt.errorCode})`}. Run /login to try again.`
  if (attempt?.phase === 'cancelled') return 'DeepSeek sign-in was cancelled.'
  return undefined
}

async function waitForAccount(invocation: CommandInvocation, account: AccountLike, timeoutMs: number): Promise<CommandResult> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (invocation.signal.aborted) {
      const state = await account.getState().catch(() => undefined)
      const id = state?.attempt?.id
      if (id !== undefined) await account.cancelSignIn(id).catch(() => undefined)
      return { kind: 'success' }
    }
    const state = await account.getState().catch(() => undefined)
    if (state?.status === 'credential-stored' && state.attempt?.phase === 'succeeded') {
      return { kind: 'success', text: 'Signed in to the DeepSeek account. Use /model to select the deepseek-account route; web search and fetch use the account token there.' }
    }
    const failure = accountFailure(state?.attempt)
    if (failure !== undefined) return { kind: 'error', text: failure }
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  const state = await account.getState().catch(() => undefined)
  const id = state?.attempt?.id
  if (id !== undefined) await account.cancelSignIn(id).catch(() => undefined)
  return { kind: 'error', text: 'DeepSeek sign-in timed out before the browser completed. Run /login to try again.' }
}

async function loginDeepSeekAccount(ctx: Context, invocation: CommandInvocation, config: Config): Promise<CommandResult> {
  const account = accountClient(ctx)
  if (account === undefined) return { kind: 'error', text: 'DeepSeek account integration is not mounted in this build.' }
  let state: AccountStateLike
  try {
    state = await account.getState()
  } catch {
    return { kind: 'error', text: 'Could not read the shared DeepSeek account state.' }
  }

  if (state.status === 'credential-stored') {
    const choice = await ctx.tui.prompt({
      title: 'DeepSeek account',
      question: 'The account is signed in and shared with DSH.',
      detail: 'Use /model to select the deepseek-account route. Signing out removes the local grant; the DSH browser session is revoked in the background.',
      options: [
        { label: 'Use account route', value: 'use', description: 'Close this prompt; select the route in /model.' },
        { label: 'Sign out', value: 'out', description: 'Remove the local grant and revoke it in the background.' },
        { label: 'Cancel', value: 'cancel' },
      ],
      initialValue: 'use',
      allowCustom: false,
      notify: false,
      signal: invocation.signal,
    })
    if (choice === null || choice === 'cancel' || choice === 'use') {
      return { kind: 'success', text: 'Use /model to select the deepseek-account route.' }
    }
    try {
      await account.signOut(accountClientMetadata())
    } catch {
      return { kind: 'error', text: 'Could not sign out of the DeepSeek account. Try again from DSH Web/Desktop.' }
    }
    return { kind: 'success', text: 'Signed out of the DeepSeek account. The next account request requires sign-in again.' }
  }

  const server = ctx.get('webServer') as WebServerLike | undefined
  if (server === undefined || ctx.tui.interactive === false) {
    return {
      kind: 'error',
      text: 'The loopback sign-in host is unavailable. Start omdsh with its normal terminal host, or sign in through DSH Web/Desktop and rerun /login.',
    }
  }
  const origin = accountCallbackOrigin(ctx)
  if (origin === undefined) return { kind: 'error', text: 'The loopback sign-in host did not expose a port.' }

  let initial: AccountStateLike
  try {
    initial = await account.startSignIn(accountClientMetadata(), origin, 'web')
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : 'Could not start DeepSeek sign-in.' }
  }
  const attempt = initial.attempt
  const failure = accountFailure(attempt)
  if (failure !== undefined) return { kind: 'error', text: failure }
  let url = attempt?.authorizeUrl
  for (let i = 0; i < 40 && url === undefined; i += 1) {
    if (invocation.signal.aborted) break
    await new Promise(resolve => setTimeout(resolve, 100))
    const next = await account.getState().catch(() => undefined)
    const nextFailure = accountFailure(next?.attempt)
    if (nextFailure !== undefined) return { kind: 'error', text: nextFailure }
    url = next?.attempt?.authorizeUrl
  }
  if (url === undefined) {
    const id = attempt?.id ?? (await account.getState().catch(() => undefined))?.attempt?.id
    if (id !== undefined) await account.cancelSignIn(id).catch(() => undefined)
    return { kind: 'error', text: 'DeepSeek did not return a browser URL for this sign-in attempt.' }
  }

  if (config.openBrowser !== false) openExternal(url)
  const answer = await ctx.tui.prompt({
    title: 'DeepSeek account',
    question: 'Complete sign-in in your browser, then return here.',
    detail: `${url}

This terminal is listening on ${origin}/oauth/callback until the attempt ends.`,
    options: [
      { label: 'I completed sign-in', value: 'done' },
      { label: 'Cancel', value: 'cancel', description: 'Withdraw this sign-in attempt.' },
    ],
    initialValue: 'done',
    allowCustom: false,
    notify: false,
    signal: invocation.signal,
  })
  if (answer !== 'done') {
    const id = attempt?.id ?? (await account.getState().catch(() => undefined))?.attempt?.id
    if (id !== undefined) await account.cancelSignIn(id).catch(() => undefined)
    return { kind: 'success', text: 'DeepSeek sign-in cancelled.' }
  }
  return waitForAccount(invocation, account, 120_000)
}

async function login(ctx: Context, invocation: CommandInvocation, config: Config): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') {
    return { kind: 'error', text: 'Usage: /login (paste the key only into the protected prompt)' }
  }
  const choice = await pickLoginChoice(ctx, invocation)
  if (choice === undefined) return { kind: 'success' }
  if (choice === DEEPSEEK_ACCOUNT_CHOICE) return loginDeepSeekAccount(ctx, invocation, config)
  if (choice === CUSTOM_PROVIDER_VALUE) return loginCustom(ctx, invocation)
  if (isAuthorizationFlow(choice)) return loginAuthorization(ctx, invocation, choice)
  return isDeepSeek(choice)
    ? loginDeepSeek(ctx, invocation, config)
    : loginCatalog(ctx, invocation, choice)
}

async function logout(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /logout' }
  const choice = await pickLogoutChoice(ctx, invocation)
  if (choice === undefined) return { kind: 'success' }
  if (isFlowRecordLogout(choice)) return logoutRecord(ctx, invocation, choice)
  return isDeepSeek(choice)
    ? logoutDeepSeek(ctx, invocation)
    : logoutCatalog(ctx, invocation, choice)
}

export function apply(ctx: Context, config: Config = {}): void {
  registerCommands(ctx, [
    { name: 'login', description: 'Sign in to a provider', handler: invocation => login(ctx, invocation, config) },
    { name: 'logout', description: 'Sign out of a stored provider', handler: invocation => logout(ctx, invocation) },
  ], 'omdsh authentication commands')
}
