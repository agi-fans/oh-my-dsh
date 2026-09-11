// Shared launch + polling helpers for the *.mjs smoke scripts.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** Isolated OMDSH_HOME removed when the smoke process exits. */
export function smokeHome(prefix) {
  const home = mkdtempSync(join(tmpdir(), prefix))
  process.on('exit', () => { rmSync(home, { recursive: true, force: true }) })
  return home
}

/**
 * [command, args] that boots omdsh. OMDSH_RUN_MODE=built exercises the shipped
 * artifact (lib/bin.js); the default exercises the tsx source launch. Windows
 * resolves pnpm through a .cmd shim, so it needs a command shell.
 */
export function omdshCommand() {
  if (process.env.OMDSH_RUN_MODE === 'built') {
    return [process.execPath, ['apps/omdsh/lib/bin.js']]
  }
  return process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', 'pnpm', '--dir', 'apps/omdsh', 'omdsh']]
    : ['pnpm', ['--dir', 'apps/omdsh', 'omdsh']]
}

/** Smoke environment: isolated home, no color, plus per-script extras. */
export function smokeEnv(home, extra = {}) {
  return { ...process.env, OMDSH_HOME: home, NO_COLOR: '1', ...extra }
}

/** Strip ANSI escapes and carriage returns from captured terminal output. */
export function cleanOutput(value) {
  return value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '')
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Poll until predicate holds or the absolute deadline passes. */
export async function waitFor(predicate, label, deadline, intervalMs = 200) {
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(intervalMs)
  }
  console.error('FAIL: timed out waiting for ' + label)
  return false
}
