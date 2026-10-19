import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bootTuiTurn } from './test-support/tui-boot.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function home(): string {
  const path = mkdtempSync(join(tmpdir(), 'omdsh-time-context-'))
  roots.push(path)
  return path
}

describe('upstream time context', () => {
  it('gives the Standard preset a clock reading', async () => {
    const turn = await bootTuiTurn({ preset: 'standard', home: home(), input: 'hello' })
    expect(turn.status).toBe(0)
    expect(JSON.stringify(turn.bodies)).toContain('Time sampled while preparing turn')
  }, 180_000)

  it('keeps the Minimal preset clock-free', async () => {
    const turn = await bootTuiTurn({ preset: 'minimal', home: home(), input: 'hello' })
    expect(turn.status).toBe(0)
    expect(JSON.stringify(turn.bodies)).not.toContain('Time sampled while preparing turn')
  }, 180_000)
})
