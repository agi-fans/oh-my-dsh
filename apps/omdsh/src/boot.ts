/**
 * omdsh tree boot: mounts the omdsh Profile over an empty root, providing the
 * command line, the profile facts, the runtime package resolution, and the
 * launch-environment snapshot before any entry mounts.
 * @module @agi-fans/oh-my-dsh
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  boot, createRuntimeResolution, installFailLoud, PluginPackages, type ProfileContext,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { NAME, prepareLaunchEnvironment } from './composition.ts'
import { composeLaunch, INSTALL_ANCHOR, PROFILE_NAME } from './profile.ts'
import { omdshHome } from './config-paths.ts'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'

export { NAME } from './composition.ts'

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
  const interrupt = (code: number): void => {
    shutdown.interrupt(code)
  }
  // SIGINT only fires outside raw mode (a raw tty delivers Ctrl-C as a
  // keypress the tui provider handles); SIGTERM is the supervisor's stop.
  process.on('SIGTERM', () => { interrupt(0) })
  process.on('SIGINT', () => { interrupt(130) })
  installFailLoud(NAME, process, async () => { await app.current?.fiber.dispose() })
  const environment = prepareLaunchEnvironment()
  const composed = composeLaunch()
  const home = omdshHome()
  // The Profile facts every profile-scoped plugin reads: `dsh-settings` and
  // `config-editor` persist edits into `patchPath`, and the composition
  // preflight judges profile rows against the running DSH release. Overlays
  // are the layers above the Profile patch, so a reconciliation re-derives
  // exactly the list `composeLaunch` mounted.
  const profileContext: ProfileContext = {
    name: PROFILE_NAME,
    dir: composed.profile.dir,
    patchPath: composed.profile.patchPath,
    installAnchor: INSTALL_ANCHOR,
    startedBundles: composed.profile.layers.map(layer => layer.packageName),
    cwd: process.cwd(),
    home,
    overlays: composed.overlays,
    telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED,
  }
  // One immutable package table for this launch: installation packages first
  // (every `@deepseek-ai/*` and `@agi-fans/dsh-tui` module resolves from the
  // omdsh installation), then the Profile's own `node_modules`, then the
  // Profile's linked roots. No fallback links are created.
  const resolution = await createRuntimeResolution({
    installAnchor: INSTALL_ANCHOR,
    profile: composed.profile,
    home,
  })
  const ctx = await boot(NAME, composed.rootConfig, structuredClone(composed.patches), async (hostCtx) => {
    app.current = hostCtx
    hostCtx.provide('profileContext', profileContext)
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
    await hostCtx.plugin(PluginPackages, { resolution })
    provideCmdline(hostCtx, {
      args: resume === undefined ? prompt : ['--resume', resume],
      exit: (code) => { void shutdown.shutdown(code) },
    })
  })
  app.current = ctx
  return { ctx, shutdown }
}
