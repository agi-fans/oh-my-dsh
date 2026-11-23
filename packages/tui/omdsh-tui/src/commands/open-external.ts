import { spawn, type SpawnOptions } from 'node:child_process'
import { win32 } from 'node:path'
import process from 'node:process'

export interface OpenExternalCommand {
  readonly file: string
  readonly args: readonly string[]
  readonly env?: NodeJS.ProcessEnv
  readonly windowsHide?: boolean
}

export interface OpenExternalInternals {
  readonly platform?: NodeJS.Platform
  readonly env?: NodeJS.ProcessEnv
  readonly spawn?: (file: string, args: readonly string[], options: SpawnOptions) => { once(event: string, listener: () => void): unknown; unref(): void }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const WINDOWS_POWERSHELL_OPEN_SCRIPT = 'Start-Process -FilePath $env:OMDSH_OPEN_URL'

/**
 * Validate an external HTTP/HTTPS URL and construct a shell-free platform
 * launcher command. Windows hands the URL through an environment variable into
 * `Start-Process` (`ShellExecuteExW`) instead of `cmd.exe /c start`, so query
 * delimiters such as `&`, `|`, and `%VAR%` can never be parsed as shell syntax.
 */
export function buildOpenExternalCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): OpenExternalCommand | undefined {
  if (/[\r\n\0]/u.test(url)) return undefined
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return undefined
  const href = parsed.href
  if (platform === 'darwin') {
    return { file: 'open', args: [href] }
  }
  if (platform === 'win32') {
    const systemRoot = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows'
    return {
      file: win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', WINDOWS_POWERSHELL_OPEN_SCRIPT],
      env: { ...env, OMDSH_OPEN_URL: href },
      windowsHide: true,
    }
  }
  return { file: 'xdg-open', args: [href] }
}

/** Best-effort browser launch; callers always retain the full URL as a fallback. */
export function openExternal(url: string, internals?: OpenExternalInternals): void {
  const command = buildOpenExternalCommand(url, internals?.platform, internals?.env)
  if (command === undefined) return
  try {
    const run = internals?.spawn ?? spawn
    const child = run(command.file, [...command.args], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      ...(command.windowsHide ? { windowsHide: true } : {}),
      ...(command.env !== undefined ? { env: command.env } : {}),
    })
    child.once('error', () => undefined)
    child.unref()
  } catch {
    // Headless and remote terminals still receive the visible URL.
  }
}
