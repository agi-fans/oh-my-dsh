/**
 * Parsing and validation for credential and provider input.
 *
 * These functions used to live beside the login flows in `commands/auth.ts`,
 * which made that file 1265 lines and mixed three jobs: turning what the reader
 * typed into a value, discovering which providers exist, and orchestrating a
 * login. Only the first is pure — no `Context`, no terminal, no credential
 * store — so it is the part that can be read and tested on its own.
 *
 * @module @agi-fans/dsh-tui/commands/auth-input
 */

import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { CUSTOM_PROVIDER_VALUE } from './auth-ids.ts'

export { CUSTOM_PROVIDER_VALUE }

/** DeepSeek's own API-key console. */
export const DEEPSEEK_API_KEYS_URL = 'https://platform.deepseek.com/api_keys'
/** The listing used to validate a key without reading its body. */
export const DEEPSEEK_MODELS_URL = 'https://api.deepseek.com/v1/models'

/** Accepted provider ids: lowercase kebab-case, starting with a letter. */
const PROVIDER_ID = /^[a-z][a-z0-9-]*$/u

/** Protocols a custom provider may speak. */
export const CUSTOM_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const

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
