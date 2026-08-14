/**
 * omdsh end-to-end smoke: boots the full harness composition, renders a
 * human prompt, surfaces the failed turn's error notice (fake API key —
 * keyless by construction), and exits 0 on stdin EOF.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../..', import.meta.url))

describe('omdsh smoke', () => {
  it('boots, renders a prompt, reports the turn failure, exits on EOF', () => {
    const omdshHome = mkdtempSync(join(tmpdir(), 'omdsh-app-smoke-'))
    const result = spawnSync(
      'pnpm',
      ['omdsh'],
      {
        cwd: root,
        input: 'hi\n',
        encoding: 'utf8',
        timeout: 180_000,
        env: { ...process.env, OMDSH_HOME: omdshHome, DEEPSEEK_API_KEY: 'sk-invalid-key-for-smoke' },
      },
    )
    rmSync(omdshHome, { recursive: true, force: true })
    const out = (result.stdout ?? '') + (result.stderr ?? '')
    expect(result.status).toBe(0)
    expect(out).toContain('hi')
    expect(out).toContain('error:')
    expect(out).not.toContain('Current runtime context')
    expect(out).not.toContain('Unsupported platform')
  }, 200_000)

  it('routes --resume through the durable session controller', () => {
    const omdshHome = mkdtempSync(join(tmpdir(), 'omdsh-resume-smoke-'))
    const missing = 'session-does-not-exist'
    const result = spawnSync(
      'pnpm',
      ['omdsh', '--resume', missing],
      {
        cwd: root,
        input: '',
        encoding: 'utf8',
        timeout: 180_000,
        env: { ...process.env, OMDSH_HOME: omdshHome, DEEPSEEK_API_KEY: 'sk-invalid-key-for-smoke' },
      },
    )
    rmSync(omdshHome, { recursive: true, force: true })
    const out = (result.stdout ?? '') + (result.stderr ?? '')
    expect(result.status).toBe(0)
    expect(out).toContain('Resume failed:')
    expect(out).toContain(missing)
    expect(out).not.toContain('Unsupported platform')
  }, 200_000)
})
