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
    const result = spawnPnpm(['omdsh'], {
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
