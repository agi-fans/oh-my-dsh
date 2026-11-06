import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { TuiService } from '../definition.ts'
import type { SessionRuntime } from '../session/session-controller.ts'
import * as commandSessionConfiguration from './session-configuration.ts'

describe('session configuration commands', () => {
  it.each([false, true])('starts Creator without sending a prompt or saving a default (started=%s)', async started => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const session = ctx.sessions.create(SessionId('creator-entry'))
    if (started) session.append('user/message', { content: [{ type: 'text', text: 'Earlier task' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    const agent = { id: session.id, session, status: 'idle' } as Agent
    const changeAgentPreset = vi.fn(), newSession = vi.fn(), send = vi.fn()
    ctx.provide('omdshSession', { agentPresets: async () => [{ id: 'cordis' }], changeAgentPreset, newSession, send } as unknown as SessionRuntime)
    ctx.provide('tui', {} as TuiService)
    ctx.provide('agentPresets', {} as never)
    await ctx.plugin(commandSessionConfiguration)
    const before = session.deriveMessages()
    const result = await ctx.commands.execute(agent, '/agent creator', [], new AbortController().signal)
    expect(result?.result).toMatchObject({ kind: 'success', text: expect.stringContaining('Creator is ready') })
    expect(started ? newSession : changeAgentPreset).toHaveBeenCalledWith(agent, 'cordis')
    expect(started ? changeAgentPreset : newSession).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(session.deriveMessages()).toEqual(before)
    await ctx.fiber.dispose()
  })

  it('leaves the session intact when Creator is broken', async () => {
    const ctx = new Context()
    const newSession = vi.fn(), changeAgentPreset = vi.fn()
    ctx.provide('omdshSession', { agentPresets: async () => [{ id: 'cordis', broken: 'missing dependency' }], newSession, changeAgentPreset } as unknown as SessionRuntime)
    const result = await commandSessionConfiguration.startCreator(ctx, { agent: { status: 'idle' }, signal: new AbortController().signal } as never)
    expect(result).toEqual({ kind: 'error', text: 'missing dependency' })
    expect(newSession).not.toHaveBeenCalled()
    expect(changeAgentPreset).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('reports failed declarations alongside the session’s retained composition', async () => {
    const registry = {
      compositionInventory: async () => [{ id: 'cordis', name: 'Cordis', isDefault: false, broken: 'missing dependency: demo', rows: [] }],
      inspectCompositions: () => [{ id: 'cordis', modules: [{ moduleName: 'previous-plugin' }], leakedServices: ['unsafe-service'] }],
    }
    const text = await commandSessionConfiguration.presetDiagnostics(registry as never, { ctx: {} } as Agent)
    expect(text).toContain('missing dependency: demo')
    expect(text).toContain('previous-plugin')
    expect(text).toContain('Isolation errors: unsafe-service')
    expect(text).toContain('Existing sessions retain their mounted revision')
  })

  it('routes the Agent selector through their owning runtime seams', async () => {
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
    const changeAgentPreset = vi.fn(async () => 'code')
    ctx.provide('tui', { prompt } as unknown as TuiService)
    ctx.provide('agentPresets', {} as never)
    ctx.provide('planMode', { get: () => ({ active: false }) } as never)
    ctx.provide('omdshSession', {
      controls: () => ({ agentPreset: 'standard', plan: { active: false, pending: false } }),
      agentPresets: async () => [
        { id: 'standard', name: 'Standard', trust: 'system', path: '/standard', order: 1 },
        { id: 'code', name: 'PTC', trust: 'system', path: '/code', order: 2 },
      ],
      changeAgentPreset,
    } as unknown as SessionRuntime)

    const fiber = await ctx.plugin(commandSessionConfiguration)
    expect(ctx.commands.list(agent).map(command => command.name)).toEqual(['agent'])

    await expect(ctx.commands.execute(agent, '/agent', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'success', text: 'Agent: PTC' } })
    expect(await ctx.commands.execute(agent, '/workflow', [], new AbortController().signal)).toBeUndefined()

    expect(changeAgentPreset).toHaveBeenCalledWith(agent, 'code')
    session.append('user/message', { content: [{ type: 'text', text: 'Hello' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    prompt.mockClear()
    expect((await ctx.commands.execute(agent, '/agent', [], new AbortController().signal))?.result).toMatchObject({ kind: 'success', text: expect.stringContaining('fixed for this conversation') })
    expect(prompt).not.toHaveBeenCalled()

    Object.assign(ctx.tui, { interactive: true })
    prompt.mockResolvedValueOnce('close')
    expect((await ctx.commands.execute(agent, '/agent', [], new AbortController().signal))?.result).toEqual({ kind: 'success' })
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Agent',
      question: 'The Agent preset is fixed for this conversation',
      notify: false,
    }))
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})

it.each(['/agent', '/agent inspect'])('reads composition in place and returns to its owning page (%s)', async command => {
  const ctx = new Context()
  await ctx.plugin(SessionStore); await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('composition-reader'))
  session.append('user/message', { content: [{ type: 'text', text: 'Earlier task' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  const agent = { id: session.id, session, ctx, status: 'idle' } as Agent
  const prompt = vi.fn<TuiService['prompt']>(async () => null), commandOutput = vi.fn(), copyText = vi.fn()
  ctx.provide('tui', { interactive: true, prompt, commandOutput, copyText } as unknown as TuiService)
  ctx.provide('omdshSession', {} as never)
  ctx.provide('agentPresets', { compositionInventory: async () => [{ id: 'standard', rows: [{ entryId: 'tools', moduleName: 'tool-package', enabled: true }] }], inspectCompositions: () => [] } as never)
  await ctx.plugin(commandSessionConfiguration)
  if (command === '/agent') prompt.mockResolvedValueOnce('inspect')
  prompt.mockResolvedValueOnce('copy').mockResolvedValueOnce('close')
  try {
    expect((await ctx.commands.execute(agent, command, [], new AbortController().signal))?.result).toEqual({ kind: 'success' })
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining('tool-package'), 'This page')
    const documents = prompt.mock.calls.map(([request]) => request).filter(request => request.presentation === 'document')
    expect(documents).toHaveLength(2)
    expect(documents[0]?.title).toBe('Agent composition')
    if (command === '/agent') expect(prompt.mock.lastCall?.[0]).toMatchObject({ title: 'Agent', initialValue: 'inspect' })
    expect(commandOutput).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose() }
})
