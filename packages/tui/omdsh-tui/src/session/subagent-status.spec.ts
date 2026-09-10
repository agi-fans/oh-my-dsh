import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { LlmAttemptId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { TuiService } from '../definition.ts'
import { SessionRuntime } from './session-controller.ts'

/** Real session events and stream routing with external Agent execution replaced. */
async function fixture() {
  const ctx = new Context()
  const agentCtx = new Context()
  await ctx.plugin(SessionStore)
  await agentCtx.plugin(CommandRuntime)
  const rootId = SessionId('status-root')
  const root = {
    id: rootId, session: ctx.sessions.create(rootId), status: 'idle',
    inbox: { nextTurn: [], nextStep: [] },
  } as unknown as Agent
  const children = Array.from({ length: 3 }, (_, index) => {
    const id = SessionId(`status-child-${index}`)
    const session = ctx.sessions.create(id, {
      meta: { parentSession: rootId, isSeeded: false, origin: 'subagent', delegationDepth: 1 },
    })
    session.append('subagent/descriptor', {
      version: 2, mode: 'continuable', provider: 'spawn', label: `Worker ${index}`,
    })
    return { id, session, status: 'running' } as unknown as Agent
  })
  const presets = {
    defaultId: 'standard', resolve: async () => ({ id: 'standard' }), mount: async () => ({ id: 'standard' }),
  }
  ctx.provide('agentPresets', presets)
  agentCtx.provide('agentPresets', presets)
  agentCtx.provide('sessionProjections', { stateOf: () => 'standard' })
  agentCtx.provide('tools', { presentAs: () => () => undefined })
  agentCtx.provide('permissionPresets', { names: [], optionOf: () => undefined, current: () => undefined })
  ctx.provide('agents', {
    create: async (options: { setup?: (context: typeof agentCtx, agent: Agent) => Promise<void> }) => {
      await options.setup?.(agentCtx, root)
      return { agent: root, dispose: async () => undefined } as unknown as AgentHandle
    },
    get: (id: string) => [root, ...children].find(agent => agent.id === id),
  })
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }),
  })
  ctx.provide('subagents', { listChildren: async () => [] })
  let inspect: (id: string) => void = () => {}
  let closeInspect: () => void = () => {}
  const calls = { setSubagents: vi.fn(), streamDelta: vi.fn(), replaceSession: vi.fn(), setInspectedSubagent: vi.fn(), event: vi.fn() }
  const tui = new Proxy({
    ...calls,
    onInspectSubagent: (handler: typeof inspect) => { inspect = handler; return () => {} },
    onInspectClose: (handler: typeof closeInspect) => { closeInspect = handler; return () => {} },
  }, {
    get(target: Record<string, unknown>, key: string) { return key in target ? target[key] : () => () => {} },
  }) as unknown as TuiService
  const runtime = new SessionRuntime(ctx, tui)
  await runtime.start()
  await Promise.resolve()
  return {
    ctx, children, calls,
    inspect: (id: string) => inspect(id), closeInspect: () => closeInspect(),
    emit: (agent: Agent, frame: AssistantStreamFrame) => ctx.emit('agent/assistant-stream', { agent, frame }),
    async dispose() { await runtime.dispose(); await ctx.fiber.dispose(); await agentCtx.fiber.dispose() },
  }
}

describe('background subagent status routing', () => {
  it('ignores background stream traffic but replays the full live prefix when inspected', async () => {
    const f = await fixture()
    try {
      const attemptId = LlmAttemptId('attempt')
      for (const child of f.children) f.emit(child, { type: 'start', attemptId, revision: 0, turn: 1, step: 1 })
      f.calls.setSubagents.mockClear()
      for (let index = 0; index < 40; index += 1) {
        for (const child of f.children) f.emit(child, {
          type: 'chunk', attemptId, revision: index + 1, index, time: index,
          chunk: { type: 'text-delta', index: 0, text: `${child.id}:${index};` },
        })
      }
      expect(f.calls.setSubagents.mock.calls.length).toBe(0)
      expect(f.calls.streamDelta).not.toHaveBeenCalled()
      const child = f.children[0]!
      f.inspect(child.id)
      expect(f.calls.streamDelta).toHaveBeenCalledTimes(40)
      expect(f.calls.streamDelta.mock.calls.map(([delta]) => delta.chunk.text).join(''))
        .toBe(Array.from({ length: 40 }, (_, index) => `${child.id}:${index};`).join(''))
      f.emit(child, {
        type: 'chunk', attemptId, revision: 41, index: 40, time: 41,
        chunk: { type: 'tool-call-delta', index: 1, id: 'call', name: 'read', argumentsDelta: '{"path":' },
      })
      expect(f.calls.streamDelta).toHaveBeenCalledTimes(41)
      f.closeInspect()
      f.calls.streamDelta.mockClear()
      f.emit(child, {
        type: 'chunk', attemptId, revision: 42, index: 41, time: 42,
        chunk: { type: 'tool-call-delta', index: 1, argumentsDelta: '"file"}' },
      })
      expect(f.calls.streamDelta).not.toHaveBeenCalled()
      expect(f.calls.setSubagents.mock.calls.length).toBe(0)
      f.emit(child, { type: 'end', attemptId, revision: 43, index: 42, outcome: { kind: 'abandoned' } })
      f.inspect(child.id)
      expect(f.calls.streamDelta).not.toHaveBeenCalled()
    } finally { await f.dispose() }
  })

  it('publishes waiting, failure and resumed running states without replaying history', async () => {
    const f = await fixture()
    try {
      const child = f.children[0]!
      const history = vi.spyOn(child.session, 'ownEvents')
      child.session.append('step/start', { turn: 1, step: 1 })
      child.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      expect(f.calls.setSubagents.mock.lastCall?.[0].agents.find((row: { id: string }) => row.id === child.id)?.phase).toBe('waiting')
      child.session.append('step/start', { turn: 2, step: 1 })
      expect(f.calls.setSubagents.mock.lastCall?.[0].agents.find((row: { id: string }) => row.id === child.id)?.phase).toBe('running')
      child.session.append('turn/end', { turn: 2, reason: { kind: 'aborted' } })
      expect(f.calls.setSubagents.mock.lastCall?.[0].agents.find((row: { id: string }) => row.id === child.id)?.phase).toBe('error')
      f.ctx.emit('agent/status', { agent: child, status: 'idle' })
      expect(f.calls.setSubagents.mock.lastCall?.[0].agents.find((row: { id: string }) => row.id === child.id)?.phase).toBe('error')
      child.session.append('step/start', { turn: 3, step: 1 })
      expect(f.calls.setSubagents.mock.lastCall?.[0].agents.find((row: { id: string }) => row.id === child.id)?.phase).toBe('running')
      expect(history).not.toHaveBeenCalled()
    } finally { await f.dispose() }
  })
})
