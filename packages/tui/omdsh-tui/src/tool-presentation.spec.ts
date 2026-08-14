import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createToolPresentationBridge } from './tool-presentation.ts'

describe('ToolPresentationBridge', () => {
  it('uses the active scoped ToolDefinition for live calls and durable replay', () => {
    const call = {
      type: 'tool/call', seq: 1, time: 1, surfaceOp: 'append',
      data: { turn: 1, step: 1, callId: 'c1', name: 'owned-tool', arguments: '{"path":"a.ts"}' },
    } as unknown as SessionEvent
    const result = {
      type: 'tool/result', seq: 2, time: 2, surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'm1', role: 'user', source: { kind: 'tool', callId: 'c1' },
          content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'raw' }] }],
        },
        meta: { lines: 1 },
      },
    } as unknown as SessionEvent
    const agent = { session: { events: [call, result] } } as unknown as Agent
    const presentCall = vi.fn(() => ({ card: 'generic' as const, title: 'Read a.ts', kind: 'read' as const }))
    const presentResult = vi.fn(() => ({
      card: 'read' as const,
      path: 'a.ts',
      offset: 1,
      totalLines: 1,
      lines: [{ number: 1, text: 'hello' }],
    }))
    const get = vi.fn(() => ({ presentCall, presentResult }))
    const bridge = createToolPresentationBridge({ tools: { get } } as unknown as Context)

    expect(bridge.event(agent, call)).toEqual({ call: { card: 'generic', title: 'Read a.ts', kind: 'read' } })
    expect(bridge.event(agent, result)).toEqual({
      call: { card: 'generic', title: 'Read a.ts', kind: 'read' },
      result: { card: 'read', path: 'a.ts', offset: 1, totalLines: 1, lines: [{ number: 1, text: 'hello' }] },
    })
    expect(presentCall).toHaveBeenCalledWith({ path: 'a.ts' })
    expect(presentResult).toHaveBeenCalledWith({ path: 'a.ts' }, {
      content: [{ type: 'text', text: 'raw' }],
      isError: false,
      meta: { lines: 1 },
    })
    expect(bridge.session(agent, [call, result]).get(2)?.result).toMatchObject({ card: 'read', path: 'a.ts' })
    expect(get).toHaveBeenCalledWith('owned-tool', agent)
  })

  it('falls back safely when a tool has no presenter or a presenter throws', () => {
    const event = {
      type: 'tool/call', seq: 1, time: 1, surfaceOp: 'append',
      data: { turn: 1, step: 1, callId: 'c1', name: 'unknown', arguments: '{}' },
    } as unknown as SessionEvent
    const agent = { session: { events: [event] } } as unknown as Agent
    const missing = createToolPresentationBridge({ tools: { get: () => undefined } } as unknown as Context)
    const broken = createToolPresentationBridge({
      tools: { get: () => ({ presentCall: () => { throw new Error('broken') } }) },
    } as unknown as Context)

    expect(missing.event(agent, event)).toBeUndefined()
    expect(broken.event(agent, event)).toBeUndefined()
  })
})
