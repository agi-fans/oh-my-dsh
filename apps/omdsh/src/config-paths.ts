/**
 * Shared discovery paths for omdsh's native configuration adapters: the user
 * directory (`$OMDSH_HOME` / `$DSH_HOME`, else `~/.dsh`) and the project root a
 * `.dsh/` directory belongs to.
 * @module @agi-fans/oh-my-dsh
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** Resolve the native user-level configuration directory. */
export function omdshHome(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.OMDSH_HOME?.trim() || environment.DSH_HOME?.trim()
  return configured === undefined
    ? join(homedir(), '.dsh')
    : (isAbsolute(configured) ? configured : resolve(configured))
}

/** Nearest ancestor holding `.git`, else the resolved cwd. */
export function projectRoot(cwd: string): string {
  const fallback = resolve(cwd)
  let current = fallback
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return fallback
    current = parent
  }
}
