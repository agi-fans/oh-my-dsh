/**
 * omdsh tree boot: mounts the shipped cordis.yml composition through the
 * harness boot machinery, providing the command line, the exit request,
 * and the launch-environment snapshot before any entry mounts.
 * @module @agi-fans/oh-my-dsh
 */

import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { CONFIG_PATH, loadBootPatches, NAME, prepareLaunchEnvironment } from './composition.ts'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'

export { CONFIG_PATH, NAME } from './composition.ts'

/**
 * Boot the omdsh tree and leave process lifetime to the mounted runner.
 * @param prompt - positional prompt words (empty for interactive only).
 * @param resume - durable session id selected by the launcher.
 * @returns the settled root context and the shutdown controller.
 */
export async function runOmdsh(
  prompt: readonly string[],
  resume?: string,
): Promise<{ ctx: Context; shutdown: ProcessShutdown }> {
  const app: { current?: Context } = {}
  const shutdown = createProcessShutdown(async () => { await app.current?.fiber.dispose() })
  const signalShutdown = new AbortController()
  const interrupt = (code: number): void => {
    signalShutdown.abort()
    shutdown.interrupt(code)
  }
  // SIGINT only fires outside raw mode (a raw tty delivers Ctrl-C as a
  // keypress the tui provider handles); SIGTERM is the supervisor's stop.
  process.on('SIGTERM', () => { interrupt(0) })
  process.on('SIGINT', () => { interrupt(130) })
  installFailLoud(NAME, process, async () => { await app.current?.fiber.dispose() })
  const environment = prepareLaunchEnvironment()
  const ctx = await boot(NAME, CONFIG_PATH, loadBootPatches(), (hostCtx) => {
    app.current = hostCtx
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
    provideCmdline(hostCtx, {
      args: resume === undefined ? prompt : ['--resume', resume],
      exit: (code) => { void shutdown.shutdown(code) },
    })
  })
  app.current = ctx
  return { ctx, shutdown }
}
