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
  it('keeps pipe mode alive for a managed child and its settlement delivered to the parent', async () => {
    const turn = await bootTuiTurn({ preset: 'standard', home: temp('omdsh-managed-child-'), repeatLast: true,
      toolCall: { name: 'subagent', arguments: JSON.stringify({ description: 'Child task', prompt: 'Reply with ok.' }) } })
    expect(turn.status, turn.output.slice(-3000)).toBe(0)
    const requests = turn.bodies.map(body => JSON.stringify(body))
    expect(requests.some(body => body.includes('started subagent')), turn.output).toBe(true)
    expect(requests.some(body => body.includes('finished and will do no further work') && body.includes('Its closing message:'))).toBe(true)
    expect(requests.length).toBeGreaterThanOrEqual(3)
  }, 180_000)

  it('commits a working-directory change and sends the updated model context on the next request', async () => {
    const cwd = temp('omdsh-current-directory-')
    const turn = await bootTuiTurn({ preset: 'standard', home: temp('omdsh-working-directory-home-'),
      toolCall: { name: 'working_directory', arguments: JSON.stringify({ cd: cwd }) } })
    expect(turn.status, turn.output.slice(-2000)).toBe(0)
    expect(requestToolNames(turn.bodies[0])).toContain('working_directory')
    const lastRequest = JSON.stringify(turn.bodies.at(-1))
    expect(lastRequest).toContain(cwd)
    expect(lastRequest).toContain('The working directory changed')
  }, 180_000)

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
    expect(names).not.toContain('create_worktree')
    // Exactly one shell stack mounts per host: the bash tool gates off Windows
    // and its PowerShell twin gates off everything else.
    expect(names).toContain(process.platform === 'win32' ? 'pwsh' : 'bash')
    expect(names).not.toContain('run_code')
  }, 180_000)
})


describe('shipped command catalog', () => {
  it('does not register the retired reasoning reader, including with its old Profile options', async () => {
    const run = await bootTuiTurn({ home: temp('omdsh-retired-reasoning-'), preset: 'standard', input: '/reasoning\n',
      patch: '- id: tui-command-reasoning\n  config:\n    enabled: true\n    provider: deepseek-official\n    targetLanguage: zh-CN\n' })
    expect(run.status, run.output.slice(-2000)).toBe(0)
    expect(run.output).toContain('Unknown command: /reasoning')
    expect(run.output).not.toContain('did not activate')
    expect(run.bodies).toEqual([])
  }, 180_000)
})
