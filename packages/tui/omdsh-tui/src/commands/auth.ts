/** DeepSeek-only interactive credential commands backed by the Harness credential seam. */

import { spawn } from 'node:child_process'
import process from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { credentialRef, type CredentialInfo } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '../definition.ts'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-auth'
export const inject = ['commands', 'credentials', 'settings', 'tui']

export interface Config {
  /** Open the DeepSeek API-key dashboard when `/login` starts. */
  openDashboard?: boolean
}

export const DEEPSEEK_API_KEY = credentialRef('DEEPSEEK_API_KEY')
export const OMDSH_DEEPSEEK_API_KEY = credentialRef('OMDSH_DEEPSEEK_API_KEY')
export const DEEPSEEK_SETTINGS = settingsNamespace('llm-deepseek')
export const DEEPSEEK_API_KEYS_URL = 'https://platform.deepseek.com/api_keys'
export const DEEPSEEK_MODELS_URL = 'https://api.deepseek.com/v1/models'

/** Match DeepSeek's own login normalization without accepting an empty Bearer value. */
export function normalizeDeepSeekApiKey(raw: string): string {
  const normalized = raw.trim().replace(/^bearer\b\s*/iu, '')
  if (normalized === '') throw new Error('Paste a non-empty DeepSeek API key.')
  return normalized
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
  ref: typeof DEEPSEEK_API_KEY,
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

function activeDeepSeekCredentialRef(ctx: Context): string {
  const settings = ctx.settings.get(DEEPSEEK_SETTINGS)
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return String(DEEPSEEK_API_KEY)
  const apiKeyEnv = (settings as Record<string, unknown>)['apiKeyEnv']
  return typeof apiKeyEnv === 'string' && apiKeyEnv.trim() !== '' ? apiKeyEnv : String(DEEPSEEK_API_KEY)
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

async function login(ctx: Context, invocation: CommandInvocation, config: Config): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') {
    return { kind: 'error', text: 'Usage: /login (paste the key only into the protected prompt)' }
  }
  // Keep an interactive login on its own credential reference. The DeepSeek
  // adapter can select that reference live through settings, so an inherited
  // DEEPSEEK_API_KEY remains a fallback instead of shadowing the user's choice.
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

async function logout(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /logout' }
  const activeRef = activeDeepSeekCredentialRef(ctx)
  const usesOmdshCredential = activeRef === String(OMDSH_DEEPSEEK_API_KEY)
  const activeCredential = usesOmdshCredential ? OMDSH_DEEPSEEK_API_KEY : DEEPSEEK_API_KEY
  const current = await ctx.credentials.describe(activeCredential)

  // A custom provider credential configured outside omdsh belongs to that
  // source. /logout only removes credentials it owns; it must not turn an
  // external DEEPSEEK_API_KEY into an error or pretend it can delete it.
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

export function apply(ctx: Context, config: Config = {}): void {
  registerCommands(ctx, [
    { name: 'login', description: 'Configure and validate the DeepSeek API key', handler: invocation => login(ctx, invocation, config) },
    { name: 'logout', description: 'Remove the stored DeepSeek API key', handler: invocation => logout(ctx, invocation) },
  ], 'omdsh DeepSeek authentication commands')
}
