/** Default-on tmux location context bridge that mounts only inside POSIX tmux panes. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import * as tmuxContext from '@deepseek-ai/dsh-tmux-context'
import z from '@deepseek-ai/schemastery'

export const name = 'omdsh-tmux-settings'
export const inject = ['agents', 'sessionProjections']
export interface Config {
  enabled: Volatile<boolean>
  refreshIntervalMs: Volatile<number>
}
export interface TmuxSettingsRuntime {
  readonly platform?: NodeJS.Platform
  readonly env?: NodeJS.ProcessEnv
}
export const Config = z.object({
  enabled: z.boolean().default(true).description('Append tmux session, window, pane, and layout context when running inside a real tmux pane.').volatile(),
  refreshIntervalMs: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(0).description('Minimum interval between tmux location injections in one session; 0 injects on every pane or layout change.').volatile(),
})

function hasActiveTmuxPane(runtime: TmuxSettingsRuntime): boolean {
  const platform = runtime.platform ?? process.platform
  if (platform === 'win32') return false
  const pane = (runtime.env ?? process.env).TMUX_PANE
  return typeof pane === 'string' && pane.trim() !== ''
}

export function apply(ctx: Context, config: Config, runtime: TmuxSettingsRuntime = {}): Promise<void> {
  const inTmuxPane = hasActiveTmuxPane(runtime)
  let child: { dispose(): Promise<unknown> } | undefined
  let key: string | undefined
  let disposed = false
  let pending: Promise<void> = Promise.resolve()
  const update = (): Promise<void> => {
    const enabled = config.enabled.get()
    const refreshIntervalMs = config.refreshIntervalMs.get()
    const nextKey = enabled ? `${inTmuxPane ? 'on' : 'idle'}:${refreshIntervalMs}` : 'off'
    pending = pending.then(async () => {
      if (disposed || key === nextKey) return
      // Unregister the previous projection/pre-step listener before mounting a replacement.
      await child?.dispose()
      child = undefined
      key = undefined
      if (disposed) return
      if (!enabled) { key = nextKey; return }
      if (!Number.isSafeInteger(refreshIntervalMs) || refreshIntervalMs < 0) {
        throw new Error('Minimum refresh interval must be a non-negative integer.')
      }
      if (!inTmuxPane || disposed) { key = nextKey; return }
      child = await ctx.plugin(tmuxContext, refreshIntervalMs > 0 ? { refreshIntervalMs } : {})
      key = nextKey
    }).catch(error => {
      if (!disposed) {
        ctx.get('tui')?.notice(`Tmux location context is disabled: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' })
      }
    })
    return pending
  }
  ctx.on('loader/volatile-update', () => update())
  ctx.effect(() => async () => { disposed = true; await pending; await child?.dispose() })
  return update()
}
