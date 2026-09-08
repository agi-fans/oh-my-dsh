/**
 * Test-only process launchers. On Windows package-manager and package-bin
 * entries are `.cmd` shims that a shell-less `spawnSync` cannot execute, so
 * those calls go through a command shell there; POSIX keeps the direct exec.
 * @module @agi-fans/oh-my-dsh/test-support
 */

import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process'

/** Run one host executable, resolving a Windows `.cmd` shim through a shell. */
export function spawnTool(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions = {},
): SpawnSyncReturns<string> {
  return spawnSync(command, [...args], {
    ...options,
    shell: process.platform === 'win32',
    encoding: 'utf8',
  })
}

/** Run `pnpm` with the platform's executable resolution. */
export function spawnPnpm(args: readonly string[], options: SpawnSyncOptions = {}): SpawnSyncReturns<string> {
  return spawnTool('pnpm', args, options)
}
