import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createToolPresentationBridge } from './tool-presentation.ts'

describe('ToolPresentationBridge', () => {
  it('retains the directory at call start across working-directory changes and replay', () => {
    const call = { type: 'tool/call', seq: 1, data: { callId: 'c1', name: 'owned', arguments: '{}' } } as unknown as SessionEvent
    const change = { type: 'working-directory/change', seq: 2, data: { cwd: '/later' } } as SessionEvent
    const result = { type: 'tool/result', seq: 3, data: { message: { source: { callId: 'c1' }, content: [] } } } as unknown as SessionEvent
    const next = { type: 'tool/ptc-dispatch-start', seq: 4, data: { subCallId: 'sub', name: 'owned', arguments: {} } } as unknown as SessionEvent
    const childResult = { type: 'tool/ptc-dispatch', seq: 6, data: { subCallId: 'sub', name: 'owned', arguments: {}, content: [] } } as unknown as SessionEvent
    const events = [call, change, result, next, { ...change, seq: 5, data: { cwd: '/last' } }, childResult]
    let cwd = '/original'
    const agent = { session: { header: { cwd }, snapshotEvents: () => events } } as unknown as Agent
    const bridge = createToolPresentationBridge({ tools: { get: () => ({ presentCall: () => ({ card: 'generic', title: 'Read', locations: [{ path: 'a.ts' }] }) }) },
      get: () => ({ get: () => cwd, defaultDirectory: '/fallback' }) } as unknown as Context)
    expect(bridge.event(agent, call)?.cwd).toBe('/original')
    cwd = '/later'
    expect(bridge.event(agent, result)?.cwd).toBe('/original')
    expect(bridge.event(agent, next)?.cwd).toBe('/later')
    cwd = '/last'
    expect(bridge.event(agent, childResult)?.cwd).toBe('/later')
    const replay = bridge.session(agent, events)
    expect(replay.get(3)?.cwd).toBe('/original')
    expect(replay.get(6)?.cwd).toBe('/later')
    // Inspection can replay only the child's owned suffix, after inherited cwd changes.
    expect(bridge.session(agent, events.slice(3)).get(6)?.cwd).toBe('/later')
  })
  it('gives a PTC sub-call the same cards a native call of that tool gets', () => {
    const start = {
      type: 'tool/ptc-dispatch-start', seq: 2, time: 2, surfaceOp: 'append',
      data: {
        rootCallId: 'run-1', parentCallId: 'run-1', subCallId: 'run-1:ptc:1',
        name: 'owned-tool', arguments: { path: 'a.ts' },
      },
    } as unknown as SessionEvent
    const settled = {
      type: 'tool/ptc-dispatch', seq: 3, time: 3, surfaceOp: 'append',
      data: {
        rootCallId: 'run-1', parentCallId: 'run-1', subCallId: 'run-1:ptc:1',
        name: 'owned-tool', arguments: { path: 'a.ts' }, isError: false,
        content: [{ type: 'text', text: 'raw' }],
      },
    } as unknown as SessionEvent
    // The program call carries no tool/result, so a lookup by call id would
    // find nothing; a dispatch event has to resolve from what it already holds.
    const agent = { session: { snapshotEvents: () => [] } } as unknown as Agent
    const presentCall = vi.fn(() => ({ card: 'generic' as const, title: 'Read a.ts', kind: 'read' as const }))
    const presentResult = vi.fn(() => ({ card: 'read' as const, path: 'a.ts' }))
    const get = vi.fn(() => ({ presentCall, presentResult }))
    const bridge = createToolPresentationBridge({ tools: { get } } as unknown as Context)

    expect(bridge.event(agent, start)).toEqual({ call: { card: 'generic', title: 'Read a.ts', kind: 'read' } })
    expect(bridge.event(agent, settled)).toMatchObject({
      call: { card: 'generic', title: 'Read a.ts' },
      result: { card: 'read', path: 'a.ts' },
    })
    expect(presentCall).toHaveBeenCalledWith({ path: 'a.ts' })
    expect(presentResult).toHaveBeenCalledWith({ path: 'a.ts' }, {
      content: [{ type: 'text', text: 'raw' }],
      isError: false,
    })
    // Replay keys presentations by sequence, exactly as it does for native calls.
    expect(bridge.session(agent, [start, settled]).get(3)).toMatchObject({ result: { card: 'read' } })
  })

  it('survives a presenter that throws on a sub-call', () => {
    const start = {
      type: 'tool/ptc-dispatch-start', seq: 1, time: 1, surfaceOp: 'append',
      data: { rootCallId: 'r', parentCallId: 'r', subCallId: 'r:ptc:1', name: 'boom', arguments: {} },
    } as unknown as SessionEvent
    const agent = { session: { snapshotEvents: () => [] } } as unknown as Agent
    const get = vi.fn(() => ({ presentCall: () => { throw new Error('nope') } }))
    const bridge = createToolPresentationBridge({ tools: { get } } as unknown as Context)

    expect(bridge.event(agent, start)).toBeUndefined()
  })


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
          id: 'm1', role: 'tool', source: { kind: 'tool', callId: 'c1' }, toolCallId: 'c1',
          content: [{ type: 'text', text: 'raw' }],
        },
        meta: { lines: 1 },
      },
    } as unknown as SessionEvent
    const agent = { session: { snapshotEvents: () => [call, result] } } as unknown as Agent
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

  it('resolves live results through the streamed call index without rescanning the log', () => {
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
          id: 'm1', role: 'tool', source: { kind: 'tool', callId: 'c1' }, toolCallId: 'c1',
          content: [],
        },
      },
    } as unknown as SessionEvent
    const snapshotEvents = vi.fn(() => [call, result])
    const agent = { session: { snapshotEvents } } as unknown as Agent
    const bridge = createToolPresentationBridge({
      tools: { get: () => ({ presentCall: () => ({ card: 'generic' as const, title: 'Read', kind: 'read' as const }) }) },
    } as unknown as Context)

    bridge.event(agent, call)
    expect(bridge.event(agent, result)).toBeDefined()
    expect(snapshotEvents).not.toHaveBeenCalled()

    // A result whose call never streamed through `event()` still resolves via
    // the cold log scan — e.g. the call settled before the listener attached.
    const coldSnapshot = vi.fn(() => [call, result])
    const cold = { session: { snapshotEvents: coldSnapshot } } as unknown as Agent
    expect(bridge.event(cold, result)).toBeDefined()
    expect(coldSnapshot).toHaveBeenCalled()
  })

  it('falls back safely when a tool has no presenter or a presenter throws', () => {
    const event = {
      type: 'tool/call', seq: 1, time: 1, surfaceOp: 'append',
      data: { turn: 1, step: 1, callId: 'c1', name: 'unknown', arguments: '{}' },
    } as unknown as SessionEvent
    const agent = { session: { snapshotEvents: () => [event] } } as unknown as Agent
    const missing = createToolPresentationBridge({ tools: { get: () => undefined } } as unknown as Context)
    const broken = createToolPresentationBridge({
      tools: { get: () => ({ presentCall: () => { throw new Error('broken') } }) },
    } as unknown as Context)

    expect(missing.event(agent, event)).toBeUndefined()
    expect(broken.event(agent, event)).toBeUndefined()
  })
})
