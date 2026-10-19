/**
 * Capture plugin console output while the interactive TUI owns stdout. Raw
 * console writes would land on the composer row, so the terminal host routes
 * them to a local log file instead.
 * @module @agi-fans/oh-my-dsh/console-log
 */

import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'

/** Console methods captured by the TUI log sink. */
const LEVELS = ['log', 'info', 'debug', 'warn', 'error', 'trace'] as const

/**
 * Route console output to `$OMDSH_HOME/omdsh/logs/omdsh.log` and return its path.
 * If the log cannot be opened, console methods become no-ops rather than
 * corrupting the terminal.
 * @param home - resolved omdsh home.
 * @returns the log path, or undefined when the file could not be opened.
 */
export function installConsoleLogSink(home: string): string | undefined {
  let stream: ReturnType<typeof createWriteStream> | undefined
  let path: string | undefined
  try {
    const dir = join(home, 'omdsh', 'logs')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    path = join(dir, 'omdsh.log')
    stream = createWriteStream(path, { flags: 'a', mode: 0o600 })
    stream.on('error', () => { stream = undefined })
  } catch {
    path = undefined
  }

  const write = (level: string, args: readonly unknown[]): void => {
    if (stream === undefined) return
    try {
      const message = format(...(args as Parameters<typeof format>))
      stream.write(`${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`)
    } catch { /* logging never breaks the terminal */ }
  }
  for (const level of LEVELS) {
    const method = (...args: unknown[]): void => write(level, args)
    ;(console as unknown as Record<string, unknown>)[level] = method
  }
  return path
}
