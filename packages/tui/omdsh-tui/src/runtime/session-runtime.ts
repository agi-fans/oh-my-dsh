/**
 * Cordis plugin owning the active top-level omdsh Agent/session lifecycle.
 * @module @agi-fans/dsh-tui/session-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { TuiService } from '../definition.ts'
import { SessionRuntime } from '../session/session-controller.ts'

export const name = 'omdsh-session-runtime'
export const inject = ['tui', 'agentDefaultModel', 'agents', 'agentPresets', 'tools']

/** Plugin config: the product state directory this runtime owns. */
export interface Config {
  /**
   * Directory for the reusable Session Library rows and the installed
   * session-format marker; omitted keeps both in memory for this process.
   */
  stateDir?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Active root Agent/session lifecycle shared by the runner and command plugins. */
    omdshSession: SessionRuntime
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  const tui = ctx.get('tui') as TuiService | undefined
  if (tui === undefined) throw new Error('omdsh-session-runtime: the tui provider must be mounted')
  const runtime = new SessionRuntime(ctx, tui, config.stateDir === undefined ? {} : { stateDir: config.stateDir })
  ctx.provide('omdshSession', runtime)
  ctx.effect(() => async () => { await runtime.dispose() }, 'omdsh session runtime lifecycle')
}

export { SessionRuntime } from '../session/session-controller.ts'
