import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { spawnPnpm } from './test-support/pnpm.ts'

const root = fileURLToPath(new URL('../../..', import.meta.url))

describe('/schedule command at the real entry', () => {
  it('boots the schedule service and reports an empty list', () => {
    const home = mkdtempSync(join(tmpdir(), 'omdsh-schedule-home-'))
    // `--dir apps/omdsh omdsh` runs the shipped entry through `tsx` and does not
    // rebuild the workspace. The root `omdsh` script starts with `pnpm -r build`,
    // which takes the pnpm store lock — and a suite that is already running under
    // `pnpm -r test` holds it, so the boot died on a lock conflict instead of
    // testing the schedule command.
    const result = spawnPnpm(['--dir', 'apps/omdsh', 'omdsh'], {
      cwd: root,
      input: '/schedule\n',
      encoding: 'utf8',
      timeout: 180_000,
      env: { ...process.env, OMDSH_HOME: home, DEEPSEEK_API_KEY: 'sk-invalid-key-for-smoke' },
    })
    rmSync(home, { recursive: true, force: true })
    const out = (result.stdout ?? '') + (result.stderr ?? '')
    expect(result.status, out).toBe(0)
    expect(out).toContain('No scheduled tasks in this session')
  }, 200_000)
})
