import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as commandMode from './command-mode.ts'
import type { TuiService } from './definition.ts'

interface ModeHarness {
  ctx: Context
  agent: Agent
  prompt: ReturnType<typeof vi.fn>
  switched: ReturnType<typeof vi.fn>
}

async function modeHarness(answers: readonly string[]): Promise<ModeHarness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const prompt = vi.fn()
  for (const answer of answers) prompt.mockResolvedValueOnce(answer)
  const modes = [
    { value: 'read-only', name: 'Read only', description: 'Inspect without writing.' },
    { value: 'workspace-write', name: 'Workspace write', description: 'Write inside the workspace.' },
    { value: 'danger-full-access', name: 'Full access', description: 'No sandbox or approval prompts.' },
  ]
  ctx.provide('tui', { prompt } as unknown as TuiService)
  ctx.provide('permissionPresets', {
    names: modes.map(mode => mode.value),
    current: () => 'workspace-write',
    optionOf: (value: string) => modes.find(mode => mode.value === value),
  } as never)
  const switched = vi.fn(({ rawInput }: { rawInput: string }) => ({ kind: 'success' as const, text: `preset ${rawInput.trim()}` }))
  ctx.commands.register({
    name: 'permission',
    description: 'Internal permission write path',
    handler: switched,
  })
  await ctx.plugin(commandMode)
  const session = ctx.sessions.create(SessionId('mode-command-test'))
  const agent = {
    id: session.id,
    session,
    status: 'idle',
    inbox: { nextTurn: [], nextStep: [] },
  } as unknown as Agent
  return { ctx, agent, prompt, switched }
}

describe('mode command', () => {
  it('opens a fixed-choice picker preselected to the current mode', async () => {
    const { ctx, agent, prompt, switched } = await modeHarness(['read-only'])
    const execution = await ctx.commands.execute(agent, '/mode', new AbortController().signal)

    expect(prompt).toHaveBeenCalledOnce()
    expect(prompt.mock.calls[0]?.[0]).toMatchObject({
      title: 'Access mode',
      initialValue: 'workspace-write',
      allowCustom: false,
      options: [
        { label: 'Read only', value: 'read-only' },
        { label: 'Workspace write', value: 'workspace-write', description: expect.stringContaining('Current') },
        { label: 'Full access', value: 'danger-full-access' },
      ],
    })
    expect(switched).toHaveBeenCalledWith(expect.objectContaining({ rawInput: ' read-only' }))
    expect(execution?.result).toEqual({ kind: 'success', text: 'Access mode: Read only' })

    const invalid = await ctx.commands.execute(agent, '/mode read-only', new AbortController().signal)
    expect(invalid?.result).toEqual({ kind: 'error', text: 'Usage: /mode' })
    expect(prompt).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('requires a fixed-choice confirmation before full access', async () => {
    const { ctx, agent, prompt, switched } = await modeHarness(['danger-full-access', 'cancel'])
    const execution = await ctx.commands.execute(agent, '/mode', new AbortController().signal)

    expect(prompt).toHaveBeenCalledTimes(2)
    expect(prompt.mock.calls[1]?.[0]).toMatchObject({
      title: 'Full access',
      initialValue: 'cancel',
      allowCustom: false,
    })
    expect(switched).not.toHaveBeenCalled()
    expect(execution?.result).toEqual({ kind: 'success' })
    await ctx.fiber.dispose()
  })
})
