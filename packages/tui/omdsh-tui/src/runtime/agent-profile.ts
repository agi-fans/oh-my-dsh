/** Agent-preset helpers owned by the omdsh product composition. */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'

export const name = 'omdsh-agent-profile'
export const inject = ['tools']

/**
 * Cross-platform alias for the host's one shell tool. A preset that allows
 * `shell` keeps its shape on POSIX (`bash`) and Windows (`pwsh`) without
 * duplicating itself, because `tools.restrict()` rejects a name that no global
 * tool registered.
 */
export const SHELL_TOOL_ALIAS = 'shell'

export interface Config {
  /** Restrict inherited tools while preserving tools registered by this preset. */
  tools?: ToolRestriction
}

/** Global shell tool name mounted for one platform. */
export function shellToolName(platform: NodeJS.Platform = process.platform): 'bash' | 'pwsh' {
  return platform === 'win32' ? 'pwsh' : 'bash'
}

/** Replace the `shell` alias in an allow list with the platform's shell tool. */
export function expandToolAliases(
  restriction: ToolRestriction,
  platform: NodeJS.Platform = process.platform,
): ToolRestriction {
  if (restriction.allow === undefined) return restriction
  const allow = restriction.allow.map(tool => tool === SHELL_TOOL_ALIAS ? shellToolName(platform) : tool)
  return { ...restriction, allow: [...new Set(allow)] }
}

export function apply(ctx: Context, config: Config = {}): void {
  if (config.tools === undefined) return
  const restriction = expandToolAliases(config.tools)
  ctx.effect(() => ctx.tools.restrict(restriction), 'omdsh agent preset tool restriction')
}
