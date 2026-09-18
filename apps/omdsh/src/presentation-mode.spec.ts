import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bootTuiTurn, requestToolNames } from './test-support/tui-boot.ts'

const roots: string[] = []

function temp(name: string): string {
  const path = mkdtempSync(join(tmpdir(), name))
  roots.push(path)
  return path
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

/** Boot one session on `preset` against the mock LLM and return the wire tool names. */
async function wireToolNames(preset: string): Promise<string[]> {
  const turn = await bootTuiTurn({ preset, home: temp(`omdsh-presentation-${preset}-`) })
  const clean = turn.output.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, '')
  expect(turn.status, clean.slice(-2000)).toBe(0)
  expect(turn.bodies, clean.slice(-2000)).not.toHaveLength(0)
  return requestToolNames(turn.bodies[0])
}

describe('preset tool presentation on the wire', () => {
  it('sends the PTC SDK form and no native orchestration tool for the code preset', async () => {
    const names = await wireToolNames('code')
    expect(names).toContain('run_code')
    // The preset denies the host workflow tool: PTC would otherwise expose it as
    // a second model-authored orchestration surface in the generated SDK.
    expect(names).not.toContain('workflow_run')
    expect(names).not.toContain('ralph')
  }, 180_000)

  it('sends the native catalog for the standard preset', async () => {
    const names = await wireToolNames('standard')
    expect(names).toContain('workflow_run')
    expect(names).toContain('bash')
    expect(names).not.toContain('run_code')
  }, 180_000)
})
