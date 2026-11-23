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

function findToolResult(body: unknown, toolUseId: string): { text: string; isError: boolean } | undefined {
  const messages = (body as { messages?: Array<{ content?: unknown }> } | undefined)?.messages ?? []
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (typeof block !== 'object' || block === null) continue
      const candidate = block as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }
      if (candidate.type !== 'tool_result' || candidate.tool_use_id !== toolUseId) continue
      const text = typeof candidate.content === 'string'
        ? candidate.content
        : Array.isArray(candidate.content)
          ? candidate.content.map(part => typeof part === 'object' && part !== null && 'text' in part ? String((part as { text?: unknown }).text ?? '') : JSON.stringify(part)).join('\n')
          : JSON.stringify(candidate.content)
      return { text, isError: candidate.is_error === true }
    }
  }
  return undefined
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

  it('omits the retired working_directory tool and subagent cwd parameter', async () => {
    const turn = await bootTuiTurn({ preset: 'standard', home: temp('omdsh-working-directory-home-') })
    expect(turn.status, turn.output.slice(-2000)).toBe(0)
    expect(requestToolNames(turn.bodies[0])).not.toContain('working_directory')
    const tools = (turn.bodies[0] as { tools: Array<{ name: string; input_schema: { properties: Record<string, unknown> } }> }).tools
    expect(tools.find(tool => tool.name === 'subagent')?.input_schema.properties).not.toHaveProperty('cwd')
  }, 180_000)

  it('offers reminder tools to standard and hides them from minimal', async () => {
    const standard = await bootTuiTurn({ preset: 'standard', home: temp('omdsh-schedule-standard-') })
    expect(standard.status, standard.output.slice(-2000)).toBe(0)
    expect(requestToolNames(standard.bodies[0])).toContain('schedule_create')
    expect(requestToolNames(standard.bodies[0])).toContain('schedule_list')
    const minimal = await bootTuiTurn({ preset: 'minimal', home: temp('omdsh-schedule-minimal-') })
    expect(minimal.status, minimal.output.slice(-2000)).toBe(0)
    expect(requestToolNames(minimal.bodies[0])).not.toContain('schedule_create')
    expect(requestToolNames(minimal.bodies[0])).not.toContain('enter_worktree')
    expect(requestToolNames(minimal.bodies[0])).not.toContain('exit_worktree')
  }, 240_000)

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

  it('exposes Cordis management, published authoring skills, and live Host inspect providers', async () => {
    const turn = await bootTuiTurn({
      preset: 'cordis',
      home: temp('omdsh-cordis-skills-'),
      toolCalls: [
        { name: 'cordis_inspect', arguments: '{}' },
        {
          name: 'cordis_inspect',
          arguments: JSON.stringify({ query: { platform: 'host', provider: 'Runtime', method: 'getVersion' } }),
        },
      ],
    })
    expect(turn.status, turn.output.slice(-2000)).toBe(0)
    expect(requestToolNames(turn.bodies[0])).toContain('plugin_manager')
    expect(requestToolNames(turn.bodies[0])).toContain('cordis_inspect')
    const firstBody = JSON.stringify(turn.bodies[0])
    expect(firstBody).toContain('dsh-doc')
    expect(firstBody).not.toContain('cordis-plugin-development')
    const directoryResult = findToolResult(turn.bodies[1], 'toolu_1')
    expect(directoryResult?.isError).toBe(false)
    for (const provider of ['Service', 'Event', 'Config', 'Runtime', 'Tool']) {
      expect(directoryResult?.text, provider).toContain(provider)
    }
    const queryResult = findToolResult(turn.bodies[2], 'toolu_2')
    expect(queryResult?.isError).toBe(false)
    expect(queryResult?.text).toContain('0.2.3-alpha.2')
    expect(turn.output).not.toContain('did not activate')
  }, 180_000)

  it('sends the PTC SDK form, hides native workflow tools, and retains in-memory REPL state across run_code calls', async () => {
    const turn = await bootTuiTurn({
      preset: 'code',
      home: temp('omdsh-ptc-state-'),
      toolCalls: [
        { name: 'run_code', arguments: JSON.stringify({ description: 'Initialize REPL state', code: "const ptcState = 'retained-across-calls'; inspect('step1')" }) },
        { name: 'run_code', arguments: JSON.stringify({ description: 'Read retained REPL state', code: 'inspect(ptcState)' }) },
      ],
    })
    expect(turn.status, turn.output.slice(-2000)).toBe(0)
    const names = requestToolNames(turn.bodies[0])
    expect(names).toContain('run_code')
    // The preset denies the host workflow tool: PTC would otherwise expose it as
    // a second model-authored orchestration surface in the generated SDK.
    expect(names).not.toContain('workflow_run')
    expect(names).not.toContain('ralph')
    const firstResult = findToolResult(turn.bodies[2], 'toolu_1')
    expect(firstResult?.isError).toBe(false)
    expect(firstResult?.text).toContain('step1')
    const secondResult = findToolResult(turn.bodies[2], 'toolu_2')
    expect(secondResult?.isError).toBe(false)
    expect(secondResult?.text).toContain('retained-across-calls')
  }, 180_000)

  it('sends the native catalog for the standard preset', async () => {
    const names = await wireToolNames('standard')
    expect(names).toContain('workflow_run')
    expect(names).toContain('enter_worktree')
    expect(names).toContain('exit_worktree')
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
