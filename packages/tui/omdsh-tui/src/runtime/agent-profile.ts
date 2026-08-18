/** Agent-preset helpers owned by the omdsh product composition. */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'

export const name = 'omdsh-agent-profile'
export const inject = ['tools']

export interface Config {
  /** Restrict inherited tools while preserving tools registered by this preset. */
  tools?: ToolRestriction
}

export function apply(ctx: Context, config: Config = {}): void {
  if (config.tools === undefined) return
  ctx.effect(() => ctx.tools.restrict(config.tools as ToolRestriction), 'omdsh agent preset tool restriction')
}
