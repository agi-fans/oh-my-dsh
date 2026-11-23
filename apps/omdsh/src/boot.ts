/**
 * omdsh tree boot: mounts the omdsh Profile over an empty root, providing the
 * command line, the profile facts, the runtime package resolution, and the
 * launch-environment snapshot before any entry mounts.
 * @module @agi-fans/oh-my-dsh
 */

import { mkdtempSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FiberState, Context } from '@deepseek-ai/cordis'
import {
  boot, composeEntries, createRuntimeResolution, installFailLoud, PluginPackages,
  PROFILE_PATCH_FILENAME, resolveProfileDir, type ConfigDumpLayer, type ProfileContext,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { NAME, prepareLaunchEnvironment } from './composition.ts'
import {
  formatDeepSeekImageLimitDiagnostic,
  isDeepSeekEntryRow,
  migrateDeepSeekImageLimitFile,
  normalizeDeepSeekRuntimeConfig,
} from './deepseek-config-migration.ts'
import { composeLaunch, homePatchPath, INSTALL_ANCHOR, PROFILE_NAME } from './profile.ts'
import { omdshHome } from './config-paths.ts'
import { appendConsoleLogSync, installConsoleLogSink } from './console-log.ts'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'

export { NAME } from './composition.ts'

type PatchOptions = ConfigDumpLayer['patches'][number]

export interface MaterializedOverlays {
  readonly paths: readonly string[]
  cleanup(): void
}

export interface OverlayFsOps {
  mkdtempSync(prefix: string): string
  writeFileSync(path: string, data: string): void
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void
}

const DEFAULT_OVERLAY_FS: OverlayFsOps = { mkdtempSync, writeFileSync, rmSync }
const DEFAULT_OVERLAY_CLEANUP_ATTEMPTS = 3

/** Emit an overlay disposal failure synchronously so signal shutdown cannot drop it before `process.exit()`. */
export function reportOverlayCleanupFailure(home: string, mode: 'interactive' | 'exec' | undefined, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  const line = `omdsh: failed to remove temporary launch overlay directory: ${detail}`
  if (mode === 'exec') {
    try { writeSync(2, `${line}\n`) } catch { /* ignore stderr write failure during shutdown */ }
    return
  }
  appendConsoleLogSync(home, 'warn', line)
}

/**
 * Run temporary overlay directory cleanup with bounded retries and surface a
 * visible diagnostic if removal still fails on disposal.
 */
export function cleanupOverlayDir(
  cleanup: () => void,
  options: { maxAttempts?: number; onFailure?(error: unknown): void } = {},
): boolean {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_OVERLAY_CLEANUP_ATTEMPTS)
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      cleanup()
      return true
    } catch (error) {
      lastError = error
    }
  }
  options.onFailure?.(lastError)
  return false
}

/**
 * Materialize non-empty launch overlays into a temporary YAML file for
 * `ProfileContext.overlayPaths`. Creating and writing share one error boundary
 * so a write failure cleans up the directory without masking the original error,
 * and `cleanup()` clears its tracked path only after removal succeeds.
 */
export function materializeOverlayPaths(
  runtimeOverlays: readonly PatchOptions[],
  fsOps: OverlayFsOps = DEFAULT_OVERLAY_FS,
): MaterializedOverlays {
  if (runtimeOverlays.length === 0) {
    return { paths: [], cleanup: () => undefined }
  }
  let overlayDir: string | undefined
  const cleanup = (): void => {
    if (overlayDir === undefined) return
    const dir = overlayDir
    fsOps.rmSync(dir, { recursive: true, force: true })
    overlayDir = undefined
  }
  try {
    overlayDir = fsOps.mkdtempSync(join(tmpdir(), 'omdsh-overlays-'))
    const overlayFile = join(overlayDir, 'launch-overlays.yml')
    fsOps.writeFileSync(overlayFile, JSON.stringify(runtimeOverlays, undefined, 2) + '\n')
    return { paths: [overlayFile], cleanup }
  } catch (error) {
    try { cleanup() } catch { /* preserve the original materialization failure */ }
    throw error
  }
}

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
  // The interactive provider owns stdout; plugin console output must not write
  // into the composer. Exec keeps its own stdout/stderr routing.
  installConsoleLogSink(omdshHome())
  const app: { current?: Context } = {}
  const shutdown = createProcessShutdown(async () => { await app.current?.fiber.dispose() })
  const interrupt = (code: number): void => {
    shutdown.interrupt(code)
  }
  // SIGINT only fires outside raw mode (a raw tty delivers Ctrl-C as a
  // keypress the tui provider handles); SIGTERM is the supervisor's stop.
  process.on('SIGTERM', () => { interrupt(0) })
  process.on('SIGINT', () => { interrupt(130) })
  // Closing the terminal window delivers SIGHUP; shut down cleanly like SIGTERM.
  if (process.platform !== 'win32') process.on('SIGHUP', () => { interrupt(129) })
  installFailLoud(NAME, process, async () => { await app.current?.fiber.dispose() })
  const ctx = await mountOmdsh({ args: resume === undefined ? prompt : ['--resume', resume], exit: code => { void shutdown.shutdown(code) },
    onContext: hostCtx => { app.current = hostCtx } })
  app.current = ctx
  return { ctx, shutdown }
}

/** Mount the shared Profile for one frontend; callers own process lifetime. */
export async function mountOmdsh(options: {
  args: readonly string[]
  exit(code: number): void
  mode?: 'interactive' | 'exec'
  onContext?(ctx: Context): void
}): Promise<Context> {
  const environment = prepareLaunchEnvironment()
  const home = omdshHome()
  // Migrate writable legacy DeepSeek `imageMaxBytes` overrides in Profile and
  // home patch files before composing; Profile migration shares the same
  // `package.json` file lock as `ConfigEditor.edit()`. Read-only and `!!js`
  // configurations normalize at their composed layer via `internal/config`.
  const migrationDiagnostics = new Set<string>()
  const profileDir = resolveProfileDir(PROFILE_NAME, home)
  const migrationTargets: ReadonlyArray<{ readonly filePath: string; readonly lockPath?: string }> = [
    { filePath: join(profileDir, PROFILE_PATCH_FILENAME), lockPath: join(profileDir, 'package.json') },
    { filePath: homePatchPath() },
  ]
  for (const target of migrationTargets) {
    const result = await migrateDeepSeekImageLimitFile(target.filePath, target.lockPath === undefined ? {} : { lockPath: target.lockPath })
    for (const finding of result.findings) {
      const diagnostic = formatDeepSeekImageLimitDiagnostic(finding)
      if (diagnostic !== undefined) migrationDiagnostics.add(diagnostic)
    }
  }
  const composed = composeLaunch()
  // Headless exec keeps the host runtime but disables TUI commands and the
  // loopback OAuth callback host they own. Module watching goes too: a one-shot
  // run never observes a reload, and an unsettled first-boot refresh keeps the
  // Harness loader waiting on the timer service that is itself waiting for that
  // refresh to drain, so shutdown would never settle.
  const frontendPatches = options.mode === 'exec' ? composeEntries([composed.patches]).filter(entry =>
    entry.name === '@agi-fans/dsh-tui' || entry.name === '@agi-fans/dsh-tui/provider-local'
    || entry.name === '@agi-fans/dsh-tui/runner' || entry.name === '@agi-fans/dsh-tui/session-runtime'
    || entry.name === '@agi-fans/dsh-tui/human-interaction' || entry.name === '@agi-fans/dsh-tui/startup-notices'
    || entry.name === '@agi-fans/dsh-tui/tool-presentation' || entry.name === '@agi-fans/dsh-tui/hook-settings'
    || entry.name === '@deepseek-ai/dsh-host-webserver' || entry.name === '@deepseek-ai/dsh-hmr'
    || entry.name?.startsWith('@agi-fans/dsh-tui/command-'),
  ).map(entry => ({ id: entry.id, disabled: true })) : []
  // The Profile facts every profile-scoped plugin reads: `dsh-settings` and
  // `config-editor` persist edits into `patchPath`, and the composition
  // preflight judges profile rows against the running DSH release. Overlay
  // files sit above the Profile and home patches so a reconciliation re-derives
  // the exact runtime overlays `mountOmdsh` booted with.
  const runtimeOverlays = [...composed.overlays, ...frontendPatches]
  // Initial package table: installation packages first
  // (every `@deepseek-ai/*` and `@agi-fans/dsh-tui` module resolves from the
  // omdsh installation), then the Profile's own `node_modules`, then the
  // Profile's linked roots. Runtime plugin operations publish later tables;
  // already retained compositions keep their revisions. No fallback links are created.
  let overlays: MaterializedOverlays | undefined
  let ctx: Context
  try {
    overlays = materializeOverlayPaths(runtimeOverlays)
    const profileContext: ProfileContext = {
      name: PROFILE_NAME,
      dir: composed.profile.dir,
      patchPath: composed.profile.patchPath,
      installAnchor: INSTALL_ANCHOR,
      startedBundles: composed.profile.layers.map(layer => layer.packageName),
      cwd: process.cwd(),
      home,
      overlayPaths: overlays.paths,
      telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED,
    }
    const resolution = await createRuntimeResolution({
      installAnchor: INSTALL_ANCHOR,
      profile: composed.profile,
      home,
    })
    let ready = false
    const readyListeners = new Set<() => void>()
    const cleanupOverlays = overlays.cleanup
    ctx = await boot(NAME, composed.rootConfig, structuredClone([...composed.patches, ...frontendPatches]), async (hostCtx) => {
      options.onContext?.(hostCtx)
      const reportedDiagnostics = new Set<string>()
      const warnOnce = (message: string): void => {
        if (reportedDiagnostics.has(message)) return
        reportedDiagnostics.add(message)
        hostCtx.logger.warn(message)
      }
      for (const diagnostic of migrationDiagnostics) warnOnce(diagnostic)
      // Normalize legacy DeepSeek `imageMaxBytes` on the effective composed row
      // (covering read-only patch layers, HMR reloads, volatile updates, and
      // dynamic `!!js` expressions) without pinning an overlay above higher layers.
      hostCtx.on('internal/config', (fiber, next) => {
        const config = next()
        const entry = (fiber as { entry?: { options?: { id?: unknown; name?: unknown } } }).entry
        if (entry === undefined || (fiber.parent.fiber as { entry?: unknown } | undefined)?.entry === entry) return config
        if (entry.options === undefined || !isDeepSeekEntryRow(entry.options)) return config
        const rowId = typeof entry.options.id === 'string' ? entry.options.id : undefined
        const normalized = normalizeDeepSeekRuntimeConfig(fiber.ctx, config, rowId)
        for (const finding of normalized.findings) {
          const diagnostic = formatDeepSeekImageLimitDiagnostic(finding)
          if (diagnostic !== undefined) warnOnce(diagnostic)
        }
        return normalized.config
      })
      hostCtx.effect(() => () => {
        cleanupOverlayDir(cleanupOverlays, {
          onFailure: (error) => {
            const detail = error instanceof Error ? error.message : String(error)
            hostCtx.logger.warn('Failed to remove temporary launch overlay directory: %s', detail)
            reportOverlayCleanupFailure(home, options.mode, error)
          },
        })
      }, 'omdsh launch overlay cleanup')
      hostCtx.provide('profileContext', profileContext)
      hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
      await hostCtx.plugin(PluginPackages, { resolution })
      provideCmdline(hostCtx, {
        args: [...options.args],
        exit: options.exit,
        ready: { onReady(listener) {
          if (ready) { listener(); return () => {} }
          readyListeners.add(listener)
          return () => { readyListeners.delete(listener) }
        } },
      })
    })
    // FiberState is a published const enum, absent from native ESM exports.
    if (ctx.fiber.state === (2 as FiberState.ACTIVE) && ctx.get('loader') !== undefined) {
      ready = true
      for (const listener of readyListeners) listener()
    }
    readyListeners.clear()
  } catch (error) {
    try { overlays?.cleanup() } catch { /* preserve the original boot failure */ }
    throw error
  }
  return ctx
}
