/**
 * omdsh end-to-end smoke: boots the full harness composition, renders a
 * human prompt, surfaces the failed turn's error notice (fake API key —
 * keyless by construction), and exits 0 on stdin EOF.
 */
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('omdsh smoke', () => {
  it('boots, renders a prompt, reports the turn failure, exits on EOF', () => {
    const result = spawnSync(
      'pnpm',
      ['--filter', '@omdsh/app', 'omdsh'],
      {
        input: 'hi\n',
        encoding: 'utf8',
        timeout: 180_000,
        env: { ...process.env, DEEPSEEK_API_KEY: 'sk-invalid-key-for-smoke' },
      },
    )
    const out = (result.stdout ?? '') + (result.stderr ?? '')
    expect(result.status).toBe(0)
    expect(out).toContain('hi')
    expect(out).toContain('error:')
    expect(out).not.toContain('Current runtime context')
  }, 200_000)
})
