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
  it('samples child model selection into new-session tools while fork keeps its parent route', async () => {
    const turn = await bootTuiTurn({ preset: 'standard', home: temp('omdsh-subagent-routes-'), toolCall: { name: 'list_subagent_models', arguments: '{}' }, patch: [
      '- id: subagent-model-selection-settings', '  config:', '    enabled: true', '    allowedModels:',
      '      - provider: deepseek-official', '        model: deepseek-flash', '',
    ].join('\n') })
    expect(turn.status, turn.output.slice(-2000)).toBe(0)
    const tools = (turn.bodies[0] as { tools: Array<{ name: string; input_schema: { properties: Record<string, unknown> } }> }).tools
    const spawn = tools.find(tool => tool.name === 'subagent')!
    expect(spawn.input_schema.properties).toHaveProperty('model')
    expect(requestToolNames(turn.bodies[0])).toContain('list_subagent_models')
    expect(JSON.stringify(turn.bodies.at(-1))).toContain('deepseek-flash')
    const fork = tools.find(tool => tool.name === 'subagent_fork')!
    expect(fork.input_schema.properties).not.toHaveProperty('model')
  }, 180_000)

  it('exposes Cordis management and published authoring skills', async () => {
    const turn = await bootTuiTurn({ preset: 'cordis', home: temp('omdsh-cordis-skills-') })
    expect(turn.status, turn.output.slice(-2000)).toBe(0)
    expect(requestToolNames(turn.bodies[0])).toContain('plugin_manager')
    const body = JSON.stringify(turn.bodies[0])
    expect(body).toContain('cordis-plugin-development')
    expect(body).toContain('editing-cordis-compositions')
    expect(body).toContain('cordis-composition-reference')
    expect(turn.output).not.toContain('did not activate')
  }, 180_000)

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
    // Exactly one shell stack mounts per host: the bash tool gates off Windows
    // and its PowerShell twin gates off everything else.
    expect(names).toContain(process.platform === 'win32' ? 'pwsh' : 'bash')
    expect(names).not.toContain('run_code')
  }, 180_000)
})
