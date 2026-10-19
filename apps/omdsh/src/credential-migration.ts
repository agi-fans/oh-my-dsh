/**
 * One-time move from the retired product credential reference to the upstream
 * DeepSeek slot. The secret stays in the local Harness credential store; only
 * the reference and the provider setting change.
 * @module @agi-fans/oh-my-dsh/credential-migration
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'

export const name = 'omdsh-credential-migration'
export const inject = ['credentials', 'settings']

const LEGACY = credentialRef('OMDSH_DEEPSEEK_API_KEY')
const UPSTREAM = credentialRef('DEEPSEEK_API_KEY')
const SETTINGS = 'llm-deepseek'

/**
 * Import one legacy DeepSeek key and reset a profile that still pins it.
 * @returns true when a legacy reference was handled.
 */
export async function migrateLegacyDeepSeekCredential(ctx: Context): Promise<boolean> {
  if (!(await ctx.credentials.describe(LEGACY)).configured) return false
  if (!(await ctx.credentials.describe(UPSTREAM)).configured) {
    const secret = await ctx.credentials.resolve(LEGACY)
    if (secret !== undefined && secret.value.length > 0) await ctx.credentials.set(UPSTREAM, secret.value)
  }
  const section = ctx.settings.describe().find(row => String(row.ns) === SETTINGS)
  const configured = (section?.value as { apiKeyEnv?: unknown } | undefined)?.apiKeyEnv
  if (configured === String(LEGACY)) {
    await ctx.settings.mutate(SETTINGS, [{ op: 'unset', path: ['apiKeyEnv'] }])
  }
  await ctx.credentials.unset(LEGACY)
  return true
}

/** Run the migration without blocking plugin activation. */
export function apply(ctx: Context): void {
  void migrateLegacyDeepSeekCredential(ctx).catch(error => ctx.logger.warn(error))
}
