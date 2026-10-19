/**
 * Conservative first-run readiness for model requests.
 *
 * The TUI does not block input when no credential is found: custom routes and
 * environment-owned keys are legitimate. It only claims "not connected" when
 * the credential and settings seams are present and none of their known
 * signals is configured, so a normal session is never told to log in.
 * @module @agi-fans/dsh-tui/model-readiness
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'

/** The upstream DeepSeek API-key route stores its key under this reference. */
const DEEPSEEK_REF = credentialRef('DEEPSEEK_API_KEY')

/**
 * Whether any configured model route is visible to the TUI.
 * @param ctx - host context carrying credentials and settings.
 * @returns true when a signal exists or the seams are unavailable.
 */
export async function modelRouteReady(ctx: Context): Promise<boolean> {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined && (await credentials.describe(DEEPSEEK_REF)).configured) return true
  const account = ctx.get('deepseekAccount') as { getState?: () => Promise<{ status?: string }> } | undefined
  if (account?.getState !== undefined) {
    try {
      if ((await account.getState()).status === 'credential-stored') return true
    } catch { /* an unavailable account service is not evidence of missing credentials */ }
  }
  const settings = ctx.get('settings')
  const rows = settings?.describe() ?? []
  const piAi = rows.find(row => String(row.ns) === 'llm-pi-ai')?.value as { providers?: Record<string, unknown> } | undefined
  if (piAi?.providers !== undefined && Object.keys(piAi.providers).length > 0) return true
  const deepseek = rows.find(row => String(row.ns) === 'llm-deepseek')?.value as { apiKeyEnv?: unknown } | undefined
  if (typeof deepseek?.apiKeyEnv === 'string' && credentials !== undefined) {
    if ((await credentials.describe(credentialRef(deepseek.apiKeyEnv))).configured) return true
  }
  // A deployment without both seams cannot be judged; do not gate it.
  return settings === undefined || credentials === undefined
}
