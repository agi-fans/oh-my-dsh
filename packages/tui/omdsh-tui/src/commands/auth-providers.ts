/**
 * Which providers omdsh can sign in to, and how they are classified.
 *
 * `commands/auth.ts` was 1265 lines because it held three jobs at once: what the
 * reader typed (now `auth-input.ts`), which providers exist, and the login flows
 * themselves. This module is the middle one. It reads the Harness roster and the
 * authorization registry and answers questions about it — "what may be listed",
 * "what is this flow", "does this provider have a stored profile" — without
 * showing anything or changing anything.
 *
 * Keeping it separate matters for the same reason the whole TUI is being thinned:
 * a provider rule that lives inside a login prompt can only be tested by driving
 * a terminal. Every function here is a plain Context query.
 *
 * @module @agi-fans/dsh-tui/commands/auth-providers
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationEntry } from '@deepseek-ai/dsh-authorization'
import {
  credentialKey,
  credentialKeyId,
  credentialKeyScope,
  isCredentialKeySegment,
  parseCredentialKey,
  type CredentialKey,
} from '@deepseek-ai/dsh-credentials'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import {
  DEEPSEEK_API_KEY,
  DEEPSEEK_PROVIDER,
  FLOW_VALUE_PREFIX,
  PI_AI_RECORD_SCOPE,
  PI_AI_SETTINGS,
} from './auth-ids.ts'

export function isDeepSeek(entry: LlmConfigurableProvider): boolean {
  return entry.provider === DEEPSEEK_PROVIDER
}

export function isPiAiLoginable(entry: LlmConfigurableProvider): boolean {
  return entry.settingsNs === 'llm-pi-ai' && entry.provider !== 'deepseek'
}

export function providerListId(entry: LlmConfigurableProvider): string {
  return isDeepSeek(entry) ? 'DeepSeek' : entry.provider
}

export function fallbackDeepSeekEntry(): LlmConfigurableProvider {
  return {
    provider: DEEPSEEK_PROVIDER,
    displayName: 'DeepSeek',
    settingsNs: 'llm-deepseek',
    settingsPath: [],
  }
}

export function loginableProviders(ctx: Context): LlmConfigurableProvider[] {
  const listed = ctx.llm.listConfigurableProviders()
  const loginable = listed.filter(entry => isDeepSeek(entry) || isPiAiLoginable(entry))
  return loginable.length > 0 ? loginable : [fallbackDeepSeekEntry()]
}

export function authorizationFlows(ctx: Context): readonly AuthorizationEntry[] {
  return ctx.get('authorization')?.list() ?? []
}

export function isPiAiDeepSeekFlow(flow: AuthorizationEntry): boolean {
  return credentialKeyScope(flow.key) === PI_AI_RECORD_SCOPE && credentialKeyId(flow.key) === 'deepseek'
}

export function isAccountFlow(flow: AuthorizationEntry): boolean {
  return credentialKeyScope(flow.key) === 'deepseek-account-platform'
}

export function loginAuthorizationFlows(ctx: Context): readonly AuthorizationEntry[] {
  return authorizationFlows(ctx).flatMap(flow => {
    if (isAccountFlow(flow)) return []
    if (!isPiAiDeepSeekFlow(flow)) return [flow]

    const profile = walkPath(sectionValue(ctx, PI_AI_SETTINGS), ['providers', 'deepseek'])
    if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) return []
    return [{ ...flow, label: 'DeepSeek (pi-ai compatibility)' }]
  })
}

export function catalogAuthorizationFlow(ctx: Context, provider: string): AuthorizationEntry | undefined {
  const authorization = ctx.get('authorization')
  if (authorization === undefined || !isCredentialKeySegment(provider)) return undefined
  return authorization.describe(credentialKey(PI_AI_RECORD_SCOPE, provider))
}

export function catalogProvidersWithoutFlows(ctx: Context): LlmConfigurableProvider[] {
  return loginableProviders(ctx).filter(entry => isDeepSeek(entry) || catalogAuthorizationFlow(ctx, entry.provider) === undefined)
}

export function flowChoiceValue(key: CredentialKey): string {
  return FLOW_VALUE_PREFIX + key
}

export function parseFlowChoice(raw: string): CredentialKey | undefined {
  if (!raw.startsWith(FLOW_VALUE_PREFIX)) return undefined
  try {
    return parseCredentialKey(raw.slice(FLOW_VALUE_PREFIX.length))
  } catch {
    return undefined
  }
}

export function sectionValue(ctx: Context, namespace: string): unknown {
  // A provider's configured fields are the live volatile config of its own
  // profile entry, so the roster reads the same values a form would show.
  return ctx.settings.describe().find(row => String(row.ns) === namespace)?.value
}

export function walkPath(root: unknown, path: readonly string[]): unknown {
  let cursor = root
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

export function profileApiKeyEnv(ctx: Context, entry: LlmConfigurableProvider): string | undefined {
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

export function hasStoredProfile(ctx: Context, entry: LlmConfigurableProvider): boolean {
  if (isDeepSeek(entry)) return true
  const profile = walkPath(sectionValue(ctx, entry.settingsNs), entry.settingsPath)
  return typeof profile === 'object' && profile !== null && !Array.isArray(profile)
}

export function logoutableProviders(ctx: Context): LlmConfigurableProvider[] {
  return loginableProviders(ctx).filter(entry => isDeepSeek(entry) || hasStoredProfile(ctx, entry))
}

export function catalogForRecord(ctx: Context, key: CredentialKey): LlmConfigurableProvider | undefined {
  const id = credentialKeyId(key)
  const scope = credentialKeyScope(key)
  return loginableProviders(ctx).find(entry => entry.provider === id && entry.settingsNs === scope)
}
