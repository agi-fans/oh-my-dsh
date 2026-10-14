/** Durable preset policy for tool-free side consultations. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const BTW_PRESET = 'btw'
export const name = 'omdsh-btw-policy'
export const inject = ['tools', 'systemPrompt']

/** No scope-local tool or an earlier allow decision may bypass this guard. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.tools.presentAs('native'), 'side consultation tool presentation')
  ctx.effect(() => ctx.tools.restrict({ allow: [] }), 'side consultation inherited tools')
  ctx.effect(() => ctx.tools.guard(() => 'Side consultations cannot use tools.'), 'side consultation execution guard')
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => ({ ...await next(), tools: [], contexts: [] }))
  // New workspace observations belong to the primary run. Preserve rejection
  // policies, but admit only explicit side questions after the copied prefix.
  ctx.on('agent/pre-step', async ({ messages }, next) => {
    const decision = await next()
    return decision.kind === 'reject' ? decision : { ...decision, messages: messages.filter(message => message.source.kind === 'user') }
  }, true)
}
