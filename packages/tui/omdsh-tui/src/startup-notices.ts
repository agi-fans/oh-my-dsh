/** Startup release notes and update-notification Cordis plugin. */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings'
import { registerCommands } from './command-registration.ts'
import type { TuiService } from './definition.ts'
import { changelogText, resolveStartupChangelog } from './release-notes.ts'
import { APP_VERSION, PACKAGE_NAME } from './package-metadata.ts'
import { TUI_SETTINGS_NAMESPACE, type TuiSettings } from './tui-settings.ts'
import { checkForUpdate, type UpdateCheckCache } from './update-check.ts'

export const name = 'omdsh-startup-notices'
export const inject = ['commands', 'settings', 'tui']

export interface Config {
  currentVersion?: string
  changelogPath?: string
  dshHome?: string
  packageName?: string
}

interface ResolvedConfig {
  currentVersion: string
  changelogPath: string
  dshHome: string
  packageName: string
}

export interface OmdshStartupService {
  /** Present one-time notices after the active session has replaced the startup transcript. */
  afterSessionStart(): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    omdshStartup: OmdshStartupService
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
}

async function readUpdateCache(path: string): Promise<UpdateCheckCache | undefined> {
  const content = await readOptional(path)
  if (content === undefined) return undefined
  try {
    const value = JSON.parse(content) as Partial<UpdateCheckCache>
    return typeof value.checkedAt === 'number' && typeof value.latestVersion === 'string'
      ? { checkedAt: value.checkedAt, latestVersion: value.latestVersion }
      : undefined
  } catch {
    return undefined
  }
}

async function fetchLatestVersion(packageName: string): Promise<string> {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`npm registry returned ${response.status}`)
  const body = await response.json() as { version?: unknown }
  if (typeof body.version !== 'string') throw new Error('npm registry response has no version')
  return body.version
}

class StartupNotices implements OmdshStartupService {
  readonly #ctx: Context
  readonly #tui: TuiService
  readonly #config: ResolvedConfig

  constructor(ctx: Context, tui: TuiService, config: ResolvedConfig) {
    this.#ctx = ctx
    this.#tui = tui
    this.#config = config
  }

  async afterSessionStart(): Promise<void> {
    const prefs = this.#ctx.settings.get(settingsNamespace(TUI_SETTINGS_NAMESPACE)) as TuiSettings | undefined
    const stateDir = join(this.#config.dshHome, 'omdsh')
    try {
      const mode = prefs?.startupChangelog ?? 'summary'
      const markerPath = join(stateDir, 'last-changelog-version')
      const changelog = await readFile(this.#config.changelogPath, 'utf8')
      const notice = await resolveStartupChangelog({
        changelog,
        currentVersion: this.#config.currentVersion,
        mode,
        readMarker: async () => (await readOptional(markerPath))?.trim() || undefined,
        writeMarker: async (version) => {
          await mkdir(stateDir, { recursive: true })
          await writeFile(markerPath, version + '\n', { encoding: 'utf8', mode: 0o600 })
        },
      })
      if (notice !== undefined) {
        if (mode === 'expanded') this.#tui.commandOutput("What's New", notice)
        else this.#tui.notice(notice)
      }
    } catch {
      // Release notes are helpful, but must never make session startup fail.
    }
    if (prefs?.checkUpdates === true) {
      try {
        const packageName = this.#config.packageName
        const cachePath = join(stateDir, 'update-check.json')
        const latest = await checkForUpdate({
          currentVersion: this.#config.currentVersion,
          now: Date.now(),
          maxAgeMs: 24 * 60 * 60 * 1_000,
          readCache: () => readUpdateCache(cachePath),
          writeCache: async (cache) => {
            await mkdir(stateDir, { recursive: true })
            await writeFile(cachePath, JSON.stringify(cache) + '\n', { encoding: 'utf8', mode: 0o600 })
          },
          fetchLatest: () => fetchLatestVersion(packageName),
        })
        if (latest !== undefined) {
          this.#tui.notice(
            `Update available · ${this.#config.currentVersion} → ${latest}\n`
            + `npm install --global ${packageName}@latest`,
          )
        }
      } catch {
        // Network and cache failures stay silent so startup remains dependable.
      }
    }
  }
}

async function showChangelog(config: ResolvedConfig, invocation: CommandInvocation): Promise<CommandResult> {
  const input = invocation.rawInput.trim().toLowerCase()
  if (input !== '' && input !== 'full') return { kind: 'error', text: 'Usage: /changelog [full]' }
  try {
    const changelog = await readFile(config.changelogPath, 'utf8')
    return { kind: 'success', text: changelogText(changelog, input === 'full') }
  } catch (error: unknown) {
    return { kind: 'error', text: 'Changelog unavailable: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  const tui = ctx.get('tui') as TuiService | undefined
  if (tui === undefined) throw new Error('omdsh-startup-notices: the tui provider must be mounted')
  const resolved: ResolvedConfig = {
    currentVersion: config.currentVersion ?? APP_VERSION,
    changelogPath: config.changelogPath ?? fileURLToPath(new URL('./CHANGELOG.md', import.meta.url)),
    dshHome: config.dshHome ?? process.env.OMDSH_HOME ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    packageName: config.packageName ?? PACKAGE_NAME,
  }
  registerCommands(ctx, [{
    name: 'changelog',
    description: 'Show recent release notes',
    input: { hint: '[full]' },
    handler: invocation => showChangelog(resolved, invocation),
  }], 'omdsh changelog command')
  ctx.provide('omdshStartup', new StartupNotices(ctx, tui, resolved))
}
