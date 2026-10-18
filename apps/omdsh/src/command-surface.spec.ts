import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { spawnPnpm } from './test-support/pnpm.ts'

const root = fileURLToPath(new URL('../../..', import.meta.url))

describe('retired command surface', () => {
  it('rejects /feedback and /sessions at the real entry', () => {
    const home = mkdtempSync(join(tmpdir(), 'omdsh-command-surface-'))
    const result = spawnPnpm(['--dir', 'apps/omdsh', 'omdsh'], {
      cwd: root,
      input: '/feedback probe\n/sessions\n',
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, OMDSH_HOME: home, DEEPSEEK_API_KEY: 'sk-invalid-key-for-smoke' },
    })
    rmSync(home, { recursive: true, force: true })
    const out = (result.stdout ?? '') + (result.stderr ?? '')
    expect(result.status, out).toBe(0)
    expect(out).toMatch(/Unknown command: \/feedback/u)
    expect(out).toMatch(/Unknown command: \/sessions/u)
    expect(out).not.toContain('Feedback recorded')
  }, 150_000)
})
