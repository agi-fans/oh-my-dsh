import { describe, expect, it, vi } from 'vitest'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applySubagentEvent,
  catalogChildren,
  descendantDepth,
  isSteerableSubagent,
  shortSessionLabel,
  SubagentRoster,
  summarizeToolCall,
} from './subagent-roster.ts'
import type { TuiSubagentView } from '../definition.ts'

function ev(type: string, data: unknown, seq = 1): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

function view(overrides: Partial<TuiSubagentView> = {}): TuiSubagentView {
  return {
    id: 'child-1',
    depth: 1,
    label: shortSessionLabel('child-1'),
    phase: 'starting',
    activity: [],
    ...overrides,
  }
}

describe('descendantDepth', () => {
  it('counts only origin-classified descendants of the requested root', () => {
    const sessions = new Map([
      ['root', { header: { id: SessionId('root') } }],
      ['child', { header: { id: SessionId('child'), parentSession: SessionId('root'), origin: 'subagent' as const } }],
      ['grand', { header: { id: SessionId('grand'), parentSession: SessionId('child'), origin: 'subagent' as const } }],
      ['fork', { header: { id: SessionId('fork'), parentSession: SessionId('root') } }],
    ])
    const lookup = (id: string) => sessions.get(id)
    expect(descendantDepth(sessions.get('child')!, 'root', lookup)).toBe(1)
    expect(descendantDepth(sessions.get('grand')!, 'root', lookup)).toBe(2)
    expect(descendantDepth(sessions.get('fork')!, 'root', lookup)).toBeUndefined()
    expect(descendantDepth(sessions.get('child')!, 'other', lookup)).toBeUndefined()
  })
})

describe('isSteerableSubagent', () => {
  it('allows follow-up only for continuable children', () => {
    expect(isSteerableSubagent('continuable')).toBe(true)
    expect(isSteerableSubagent('one-shot')).toBe(false)
    expect(isSteerableSubagent(undefined)).toBe(false)
  })
})

describe('summarizeToolCall', () => {
  it('prefers the human-facing argument for common tools', () => {
    expect(summarizeToolCall('bash', '{"command":"git status\\n--short"}')).toBe('bash git status')
    expect(summarizeToolCall('read', '{"path":"src/a.ts"}')).toBe('read src/a.ts')
    expect(summarizeToolCall('grep', '{"pattern":"TODO"}')).toBe('grep TODO')
    expect(summarizeToolCall('unknown', '{}')).toBe('unknown')
  })
})

describe('applySubagentEvent', () => {
  it('takes the durable descriptor label and folds live child tools', () => {
    let state = applySubagentEvent(view(), ev('subagent/descriptor', {
      version: 2,
      mode: 'continuable',
      provider: 'spawn',
      label: 'Explore auth',
    }))
    state = applySubagentEvent(state, ev('step/start', { turn: 1, step: 1 }))
    state = applySubagentEvent(state, ev('tool/call', {
      callId: 'c1', name: 'read', arguments: '{"path":"src/auth.ts"}',
    }))
    expect(state).toMatchObject({
      label: 'Explore auth',
      mode: 'continuable',
      phase: 'running',
      activity: [{ text: 'read src/auth.ts', status: 'running' }],
    })

    state = applySubagentEvent(state, ev('tool/result', {
      message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [] }] },
    }))
    state = applySubagentEvent(state, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(state.phase).toBe('waiting')
    expect(state.activity).toEqual([{ text: 'read src/auth.ts', status: 'ok' }])
  })


})

describe('SubagentRoster', () => {
  it('folds an agent-message relay frame exactly like the legacy coordinator frame', () => {
    const base = view({ phase: 'running', mode: 'continuable' })
    const frame = (kind: string) => ev('user/message', {
      content: [{ type: 'text', text: 'Keep going from the parent.' }],
      source: { kind, form: 'relay', senderSessionId: 'root' },
      role: 'user',
      id: 'm-1',
    }, 9)
    const coordinator = applySubagentEvent(base, frame('coordinator'))
    const agentMessage = applySubagentEvent(base, frame('agent-message'))
    expect(agentMessage).toEqual(coordinator)
    expect(agentMessage).toMatchObject({ label: 'Keep going from the parent.' })
  })

  it('hydrates a live child log and keeps catalog identity as a fallback', () => {
    const roster = new SubagentRoster()
    roster.reset('root')
    roster.remember({ id: 'child-1', depth: 1, label: 'Catalog label', mode: 'continuable' })
    const session = {
      id: SessionId('child-1'),
      header: {
        id: SessionId('child-1'),
        parentSession: SessionId('root'),
        origin: 'subagent' as const,
        isSeeded: true,
      },
      inheritedEventCount: 1,
      ownEvents: () => [
        ev('tool/call', { callId: 'c1', name: 'bash', arguments: '{"command":"pwd"}' }, 2),
      ],
    } as unknown as Session

    const hydrated = roster.hydrate(session, 1, 'running')
    expect(hydrated).toMatchObject({
      label: 'Catalog label',
      mode: 'continuable',
      phase: 'running',
      activity: [{ text: 'bash pwd', status: 'running' }],
    })
    expect(roster.hasRunning()).toBe(true)
    expect(roster.snapshot()?.agents).toHaveLength(1)

    roster.remember({ id: 'child-1', depth: 1, label: 'Stale catalog', phase: 'waiting' })
    expect(roster.snapshot()?.agents[0]).toMatchObject({
      label: 'Catalog label',
      phase: 'running',
    })
  })

  it('marks startup failure and interrupted completion as error instead of running', () => {
    const failed = applySubagentEvent(view({ phase: 'starting' }), ev('turn/end', {
      turn: 1, reason: { kind: 'error', error: { code: 'START', message: 'spawn failed' } },
    }))
    expect(failed.phase).toBe('error')
    const interrupted = applySubagentEvent(view({ phase: 'running', mode: 'continuable' }), ev('turn/end', {
      turn: 1, reason: { kind: 'aborted' },
    }))
    expect(interrupted.phase).toBe('error')
  })

  it('completes one-shot children and returns continuable children to waiting', () => {
    const oneShot = applySubagentEvent(view({ phase: 'running', mode: 'one-shot' }), ev('turn/end', {
      turn: 1, reason: { kind: 'completed' },
    }))
    expect(oneShot.phase).toBe('completed')
    const continued = applySubagentEvent(view({ phase: 'running', mode: 'continuable' }), ev('turn/end', {
      turn: 1, reason: { kind: 'completed' },
    }))
    expect(continued.phase).toBe('waiting')
  })

  it('hydrates a resumed completed child without leaving it running', () => {
    const roster = new SubagentRoster()
    roster.reset('root')
    const session = {
      id: SessionId('child-done'),
      header: {
        id: SessionId('child-done'),
        parentSession: SessionId('root'),
        origin: 'subagent' as const,
        isSeeded: false,
      },
      inheritedEventCount: 0,
      ownEvents: () => [
        ev('subagent/descriptor', { version: 2, mode: 'one-shot', provider: 'spawn', label: 'Done task' }, 1),
        ev('turn/start', { turn: 1 }, 2),
        ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3),
      ],
    } as unknown as Session
    expect(roster.hydrate(session, 1, 'idle')).toMatchObject({
      label: 'Done task',
      mode: 'one-shot',
      phase: 'completed',
    })
    expect(roster.hasRunning()).toBe(false)
  })

  it('clears a stale running row when the child is gone', () => {
    const roster = new SubagentRoster()
    roster.reset('root')
    roster.remember({ id: 'child-1', depth: 1, mode: 'one-shot', phase: 'running' })
    expect(roster.setAgentStatus('child-1', 'gone')?.phase).toBe('completed')
    expect(roster.hasRunning()).toBe(false)
    roster.remember({ id: 'child-2', depth: 1, mode: 'one-shot', phase: 'running' })
    expect(roster.setAgentStatus('child-2', 'gone', true)?.phase).toBe('error')
  })

  it('applies durable events once without rereading the history and caches unchanged snapshots', () => {
    const roster = new SubagentRoster()
    const events = [ev('subagent/descriptor', { version: 2, mode: 'continuable', provider: 'spawn', label: 'Worker' }, 1)]
    const ownEvents = vi.fn(() => events)
    const session = { id: SessionId('child-1'), header: {}, ownEvents } as unknown as Session
    roster.hydrate(session, 1)
    const initial = roster.snapshot()
    expect(roster.snapshot()).toBe(initial)
    ownEvents.mockClear()
    const call = ev('tool/call', { callId: 'c1', name: 'read', arguments: '{"path":"file"}' }, 2)
    events.push(call)
    roster.apply(session, 1, call, 'running')
    const active = roster.snapshot()
    expect(active).not.toBe(initial)
    expect(active?.agents[0]?.activity).toEqual([{ text: 'read file', status: 'running' }])
    roster.apply(session, 1, call, 'running')
    expect(roster.snapshot()).toBe(active)
    const result = ev('tool/result', { message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [] }] } }, 3)
    events.push(result)
    roster.apply(session, 1, result, 'running')
    expect(roster.snapshot()?.agents[0]?.activity).toEqual([{ text: 'read file', status: 'ok' }])
    const settled = roster.snapshot()
    roster.apply(session, 1, ev('step/end', {}, 4), 'running')
    expect(roster.snapshot()).toBe(settled)
    expect(ownEvents).not.toHaveBeenCalled()
  })

  it('rebuilds on a gap and on a new session instance with the same id', () => {
    const roster = new SubagentRoster()
    const events = [ev('step/start', { turn: 1, step: 1 }, 1)]
    const ownEvents = vi.fn(() => events)
    const session = { id: SessionId('child-1'), header: {}, ownEvents } as unknown as Session
    roster.hydrate(session, 1)
    events.push(ev('step/end', {}, 2), ev('turn/end', { turn: 1, reason: { kind: 'aborted' } }, 3))
    roster.apply(session, 1, events[2]!)
    expect(ownEvents).toHaveBeenCalledTimes(2)
    expect(roster.snapshot()?.agents[0]?.phase).toBe('error')
    const reopened = { ...session, ownEvents: () => [ev('step/start', { turn: 2, step: 1 }, 4)] } as unknown as Session
    roster.apply(reopened, 1, ev('step/start', { turn: 2, step: 1 }, 4), 'running')
    expect(roster.snapshot()?.agents[0]?.phase).toBe('running')
  })

})

describe('catalogChildren', () => {
  it('reads the durable directory and keeps the latest fact per child', () => {
    expect(catalogChildren([
      ev('subagent/catalog', { version: 0, childId: 'child-1', childCreatedAt: 1, mode: 'one-shot' }, 1),
      ev('subagent/catalog', { version: 0, childId: 'child-2', childCreatedAt: 2, mode: 'continuable', label: 'Worker' }, 2),
      ev('subagent/catalog', { version: 0, childId: 'child-1', childCreatedAt: 1, mode: 'continuable', label: 'Renamed' }, 3),
      ev('tool/call', { callId: 'c1', name: 'bash' }, 4),
    ])).toEqual([
      { id: 'child-1', mode: 'continuable', label: 'Renamed' },
      { id: 'child-2', mode: 'continuable', label: 'Worker' },
    ])
  })

  it('omits an absent or blank label instead of inventing a row title', () => {
    expect(catalogChildren([
      ev('subagent/catalog', { version: 0, childId: 'child-1', childCreatedAt: 1, mode: 'one-shot' }, 1),
      ev('subagent/catalog', { version: 0, childId: 'child-2', childCreatedAt: 2, mode: 'one-shot', label: '   ' }, 2),
    ])).toEqual([
      { id: 'child-1', mode: 'one-shot' },
      { id: 'child-2', mode: 'one-shot' },
    ])
  })
})

describe('SubagentRoster.observeCatalog', () => {
  it('lists the durable children a resumed parent would otherwise lose', () => {
    const roster = new SubagentRoster()
    roster.reset('root')
    expect(roster.observeCatalog('root', [
      ev('subagent/catalog', { version: 0, childId: 'child-1', childCreatedAt: 1, mode: 'continuable', label: 'Worker' }, 1),
      ev('subagent/catalog', { version: 0, childId: 'child-2', childCreatedAt: 2, mode: 'one-shot' }, 2),
    ])).toBe(true)
    expect(roster.snapshot()?.agents).toMatchObject([
      { id: 'child-1', parentId: 'root', depth: 1, label: 'Worker', mode: 'continuable', phase: 'completed' },
      { id: 'child-2', parentId: 'root', depth: 1, mode: 'one-shot', phase: 'completed' },
    ])
  })

  it('leaves a child the live path already tracks on its own state', () => {
    const roster = new SubagentRoster()
    roster.reset('root')
    roster.remember({ id: 'child-1', parentId: 'root', depth: 1, phase: 'running' })
    expect(roster.observeCatalog('root', [
      ev('subagent/catalog', { version: 0, childId: 'child-1', childCreatedAt: 1, mode: 'continuable', label: 'Late label' }, 1),
    ])).toBe(false)
    expect(roster.snapshot()?.agents).toMatchObject([
      { id: 'child-1', phase: 'running', label: shortSessionLabel('child-1') },
    ])
  })
})
