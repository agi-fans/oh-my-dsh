import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { TuiService } from '../definition.ts'
import type { SessionRuntime } from '../session/session-controller.ts'
import * as commandSessionConfiguration from './session-configuration.ts'

describe('session configuration commands', () => {
  it('routes Agent, Workflow, and Tools selectors through their owning runtime seams', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const session = ctx.sessions.create(SessionId('session-configuration-command'))
    const agent = {
      id: session.id,
      session,
      status: 'idle',
      inbox: { nextTurn: [], nextStep: [] },
    } as unknown as Agent
    const prompt = vi.fn()
      .mockResolvedValueOnce('code')
      .mockResolvedValueOnce('both')
      .mockResolvedValueOnce('plan')
    const changeAgentPreset = vi.fn(async () => ({ agentPreset: 'code', tools: 'code', toolsSource: 'preset-default' as const }))
    const changeToolPresentation = vi.fn(() => ({ agentPreset: 'code', tools: 'both', toolsSource: 'user' as const }))
    const changeWorkflow = vi.fn(() => 'committed' as const)
    ctx.provide('tui', { prompt } as unknown as TuiService)
    ctx.provide('agentPresets', {} as never)
    ctx.provide('planMode', { get: () => ({ active: false }) } as never)
    ctx.provide('omdshSession', {
      controls: () => ({ agentPreset: 'standard', tools: 'native', plan: { active: false, pending: false } }),
      agentPresets: async () => [
        { id: 'standard', name: 'Standard', trust: 'system', path: '/standard', order: 1 },
        { id: 'code', name: 'PTC', trust: 'system', path: '/code', order: 2 },
      ],
      changeAgentPreset,
      changeToolPresentation,
      changeWorkflow,
    } as unknown as SessionRuntime)

    const fiber = await ctx.plugin(commandSessionConfiguration)
    expect(ctx.commands.list(agent).map(command => command.name)).toEqual(['agent', 'tool-mode', 'workflow'])

    await expect(ctx.commands.execute(agent, '/agent', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'success', text: 'Agent: PTC · Tools: Code' } })
    await expect(ctx.commands.execute(agent, '/tool-mode', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'success', text: 'Tools: Both' } })
    await expect(ctx.commands.execute(agent, '/workflow', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'success', text: 'Workflow: Plan' } })

    expect(changeAgentPreset).toHaveBeenCalledWith(agent, 'code')
    expect(changeToolPresentation).toHaveBeenCalledWith(agent, 'both')
    expect(changeWorkflow).toHaveBeenCalledWith(agent, true)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
