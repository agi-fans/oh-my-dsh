/** Interactive credential commands backed by the Harness credential and settings seams. */

import { spawn } from 'node:child_process'
import process from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { credentialRef, type CredentialInfo, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '../definition.ts'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-auth'
export const inject = ['commands', 'credentials', 'settings', 'tui', 'llm']

export interface Config {
  /** Open the DeepSeek API-key dashboard when `/login` starts for DeepSeek. */
  openDashboard?: boolean
}

export const DEEPSEEK_PROVIDER = 'deepseek-official'
export const DEEPSEEK_API_KEY = credentialRef('DEEPSEEK_API_KEY')
export const OMDSH_DEEPSEEK_API_KEY = credentialRef('OMDSH_DEEPSEEK_API_KEY')
export const DEEPSEEK_SETTINGS = settingsNamespace('llm-deepseek')
export const PI_AI_SETTINGS = settingsNamespace('llm-pi-ai')
export const DEEPSEEK_API_KEYS_URL = 'https://platform.deepseek.com/api_keys'
export const DEEPSEEK_MODELS_URL = 'https://api.deepseek.com/v1/models'
export const CUSTOM_PROVIDER_VALUE = '__omdsh_custom__'

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

/** Picker labels are route ids; the official adapter is shown as `deepseek`. */
export function providerListId(entry: LlmConfigurableProvider): string {
  return isDeepSeek(entry) ? 'deepseek' : entry.provider
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

function sectionValue(ctx: Context, namespace: string): unknown {
  return ctx.settings.get(settingsNamespace(namespace))
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

function selected(raw: string, values: readonly string[]): string | undefined {
  const index = /^\d+$/u.test(raw) ? Number(raw) - 1 : -1
  return index >= 0 ? values[index] : raw
}

async function pickProvider(
  ctx: Context,
  invocation: CommandInvocation,
  entries: readonly LlmConfigurableProvider[],
  title: string,
  question: string,
  includeCustom = false,
): Promise<LlmConfigurableProvider | typeof CUSTOM_PROVIDER_VALUE | undefined> {
  if (entries.length === 0 && !includeCustom) return undefined
  if (entries.length === 1 && !includeCustom) return entries[0]
  const live = new Set(ctx.llm.listProviders().map(provider => provider.id))
  const values = [
    ...entries.map(entry => entry.provider),
    ...(includeCustom ? [CUSTOM_PROVIDER_VALUE] : []),
  ]
  const optionCount = values.length
  const fullscreen = optionCount > FULLSCREEN_CHOICE_THRESHOLD
  const raw = await ctx.tui.prompt({
    ...(fullscreen ? { presentation: 'fullscreen-list' as const } : {}),
    optionLayout: 'compact',
    filterable: fullscreen,
    title,
    question,
    options: [
      ...entries.map(entry => ({
        label: providerListId(entry),
        value: entry.provider,
        description: live.has(entry.provider) ? 'configured' : 'not configured',
      })),
      ...(includeCustom
        ? [{
          label: 'custom',
          value: CUSTOM_PROVIDER_VALUE,
          description: 'Add a provider that is not in the catalog',
        }]
        : []),
    ],
    allowCustom: false,
    signal: invocation.signal,
  })
  if (raw === null) return undefined
  if (raw.trim().toLowerCase() === 'custom' || selected(raw, values) === CUSTOM_PROVIDER_VALUE) {
    return CUSTOM_PROVIDER_VALUE
  }
  const provider = selected(raw, values)
  return entries.find(entry => entry.provider === provider)
}

async function resetDeepSeekCredentialRoute(ctx: Context): Promise<void> {
  await ctx.settings.mutate(DEEPSEEK_SETTINGS, [{ op: 'unset', path: ['apiKeyEnv'] }])
}

async function logoutSuccess(ctx: Context, managed: boolean): Promise<CommandResult> {
  const fallback = await ctx.credentials.describe(DEEPSEEK_API_KEY)
  if (fallback.configured) {
    return {
      kind: 'success',
      text: `${managed ? 'Logged out from the omdsh-managed DeepSeek credential.' : 'Logged out from DeepSeek.'} Falling back to DEEPSEEK_API_KEY from ${credentialSource(fallback)}.`,
    }
  }
  return { kind: 'success', text: 'Logged out from DeepSeek.' }
}

/** Best-effort browser launch; the prompt always retains the full URL as a fallback. */
export function openDeepSeekDashboard(): void {
  const command = process.platform === 'darwin'
    ? { file: 'open', args: [DEEPSEEK_API_KEYS_URL] }
    : process.platform === 'win32'
      ? { file: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', DEEPSEEK_API_KEYS_URL] }
      : { file: 'xdg-open', args: [DEEPSEEK_API_KEYS_URL] }
  try {
    const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore' })
    child.once('error', () => undefined)
    child.unref()
  } catch {
    // Headless and remote terminals still receive the visible dashboard URL.
  }
}

async function loginDeepSeek(ctx: Context, invocation: CommandInvocation, config: Config): Promise<CommandResult> {
  const current = await ctx.credentials.describe(OMDSH_DEEPSEEK_API_KEY)
  if (current.configured && !current.writable) {
    return { kind: 'error', text: unmanagedCredentialMessage(OMDSH_DEEPSEEK_API_KEY, current, 'replace') }
  }
  if (config.openDashboard !== false) openDeepSeekDashboard()
  const raw = await ctx.tui.prompt({
    title: 'Login to DeepSeek',
    question: current.configured ? 'Paste a new DeepSeek API key' : 'Paste your DeepSeek API key',
    detail: `Create or copy a key at ${DEEPSEEK_API_KEYS_URL}. It will be validated, stored locally, and preferred over DEEPSEEK_API_KEY.`,
    allowCustom: true,
    secret: true,
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
    await ctx.credentials.set(OMDSH_DEEPSEEK_API_KEY, apiKey)
  } catch {
    return { kind: 'error', text: 'The API key is valid, but it could not be saved to the Harness credential store.' }
  }
  try {
    await ctx.settings.update(DEEPSEEK_SETTINGS, { apiKeyEnv: String(OMDSH_DEEPSEEK_API_KEY) })
  } catch {
    return {
      kind: 'error',
      text: 'The API key is valid and saved, but omdsh could not activate it for the DeepSeek provider. Run /login again after checking your settings file.',
    }
  }
  return {
    kind: 'success',
    text: 'Logged in to DeepSeek. Your omdsh credential takes priority on the next model request.',
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
    await ctx.settings.mutate(settingsNamespace(entry.settingsNs), [
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
    signal: invocation.signal,
  })
  if (source === null) return undefined
  if (source === 'fetch') {
    try {
      const discovered = await ctx.llm.discoverModels('llm-pi-ai', {
        baseURL: draft.baseURL,
        api: draft.api,
        ...(draft.apiKey === undefined ? {} : { apiKey: draft.apiKey }),
        signal: invocation.signal,
      })
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
  const usesOmdshCredential = activeRef === String(OMDSH_DEEPSEEK_API_KEY)
  const activeCredential = usesOmdshCredential ? OMDSH_DEEPSEEK_API_KEY : DEEPSEEK_API_KEY
  const current = await ctx.credentials.describe(activeCredential)

  const legacyManagedDefault = activeRef === String(DEEPSEEK_API_KEY) && current.source === 'file'
  if (!usesOmdshCredential && !legacyManagedDefault) {
    if (!current.configured) return { kind: 'success', text: 'DeepSeek is already logged out.' }
    return {
      kind: 'success',
      text: `No omdsh-managed DeepSeek login is active. DeepSeek is configured by ${credentialSource(current)}.`,
    }
  }

  if (usesOmdshCredential && !current.configured) {
    try {
      await resetDeepSeekCredentialRoute(ctx)
    } catch {
      return { kind: 'error', text: 'Could not reset the DeepSeek credential setting.' }
    }
    return logoutSuccess(ctx, true)
  }

  const removesStoredKey = current.source === 'file'
  const answer = await ctx.tui.prompt({
    title: 'Logout from DeepSeek',
    question: removesStoredKey ? 'Remove the stored DeepSeek API key?' : 'Stop using the omdsh DeepSeek credential?',
    detail: 'The next model request will fall back to DEEPSEEK_API_KEY when one is available.',
    options: [
      { label: 'Cancel', value: 'cancel', description: 'Keep the current credential.' },
      {
        label: 'Log out',
        value: 'logout',
        description: removesStoredKey
          ? 'Remove the key from the local Harness credential store.'
          : 'Return the provider to its default credential source.',
        badge: { label: 'removes credential', tone: 'warning' },
      },
    ],
    initialValue: 'cancel',
    allowCustom: false,
    submitLabel: 'apply',
    signal: invocation.signal,
  })
  if (answer !== 'logout') return { kind: 'success' }
  try {
    if (usesOmdshCredential) await resetDeepSeekCredentialRoute(ctx)
    if (removesStoredKey) await ctx.credentials.unset(activeCredential)
  } catch {
    return { kind: 'error', text: 'Could not remove the DeepSeek API key from the Harness credential store.' }
  }
  return logoutSuccess(ctx, usesOmdshCredential)
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
    submitLabel: 'apply',
    signal: invocation.signal,
  })
  if (answer !== 'logout') return { kind: 'success' }
  try {
    await ctx.settings.mutate(settingsNamespace(entry.settingsNs), [
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
  const entry = await pickProvider(
    ctx,
    invocation,
    loginableProviders(ctx),
    'Provider',
    'Choose a provider to configure',
    true,
  )
  if (entry === undefined) return { kind: 'success' }
  if (entry === CUSTOM_PROVIDER_VALUE) return loginCustom(ctx, invocation)
  return isDeepSeek(entry)
    ? loginDeepSeek(ctx, invocation, config)
    : loginCatalog(ctx, invocation, entry)
}

async function logout(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /logout' }
  const entry = await pickProvider(
    ctx,
    invocation,
    logoutableProviders(ctx),
    'Provider',
    'Choose a provider to log out from',
  )
  if (entry === undefined || entry === CUSTOM_PROVIDER_VALUE) return { kind: 'success' }
  return isDeepSeek(entry)
    ? logoutDeepSeek(ctx, invocation)
    : logoutCatalog(ctx, invocation, entry)
}

export function apply(ctx: Context, config: Config = {}): void {
  registerCommands(ctx, [
    { name: 'login', description: 'Configure a provider API key', handler: invocation => login(ctx, invocation, config) },
    { name: 'logout', description: 'Remove a stored provider API key', handler: invocation => logout(ctx, invocation) },
  ], 'omdsh authentication commands')
}
