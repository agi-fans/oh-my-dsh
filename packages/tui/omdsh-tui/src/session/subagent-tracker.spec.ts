import { describe, expect, it } from 'vitest'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { TuiSubagentRoster } from '../definition.ts'
import { SubagentTracker, type SubagentCatalogEntry, type SubagentTrackerDeps } from './subagent-tracker.ts'

function ev(type: string, data: unknown, seq = 1): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

function fakeSession(id: string, parent?: string, events: SessionEvent[] = []): Session {
  return {
    id: SessionId(id),
    header: { parentSession: parent === undefined ? undefined : SessionId(parent) },
    inheritedEventCount: 0,
    ownEvents: () => events,
  } as unknown as Session
}

function make(overrides: Partial<SubagentTrackerDeps> = {}) {
  const published: (TuiSubagentRoster | undefined)[] = []
  const sessions = new Map<string, Session>()
  const deps: SubagentTrackerDeps = {
    rootId: () => 'root',
    // Depth here means "is the session registered under the root" — the real
    // controller computes ancestry via descendantDepth.
    depth: session => (sessions.has(session.id) ? 1 : undefined),
    agentStatus: () => undefined,
    sessions: () => [...sessions.values()],
    listChildren: () => undefined,
    publish: roster => { published.push(roster) },
    ...overrides,
  }
  return { tracker: new SubagentTracker(deps), published, sessions }
}

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

describe('SubagentTracker.noteSession/noteEvent', () => {
  it('remembers a descendant and publishes once per change', () => {
    const { tracker, published, sessions } = make()
    const child = fakeSession('child-1', 'root')
    sessions.set('child-1', child)
    tracker.noteSession(child)
    expect(published).toHaveLength(1)
    expect(published[0]?.agents[0]).toMatchObject({ id: 'child-1', depth: 1, phase: 'starting' })
    // A stranger session is not a descendant: no row, no publish.
    tracker.noteSession(fakeSession('other'))
    expect(published).toHaveLength(1)
  })

  it('folds durable events and dedups unchanged snapshots', () => {
    const { tracker, published, sessions } = make()
    const log: SessionEvent[] = []
    const child = fakeSession('child-1', 'root', log)
    sessions.set('child-1', child)
    tracker.noteSession(child)
    log.push(ev('subagent/descriptor', { version: 2, mode: 'one-shot', provider: 'spawn', label: 'Job' }, 1))
    tracker.noteEvent(child, log[0]!)
    const call = ev('tool/call', { callId: 'c1', name: 'read', arguments: '{"path":"f"}' }, 2)
    log.push(call)
    tracker.noteEvent(child, call)
    expect(published.at(-1)?.agents[0]?.activity).toEqual([{ text: 'read f', status: 'running' }])
    const seen = published.length
    tracker.noteEvent(child, ev('step/end', {}, 3))
    expect(published).toHaveLength(seen)
  })
})

describe('SubagentTracker.noteStatus/noteGone', () => {
  it('hydrates an unknown descendant on first status, then updates in place', () => {
    const { tracker, published, sessions } = make({ agentStatus: () => 'running' })
    const child = fakeSession('child-1', 'root')
    sessions.set('child-1', child)
    tracker.noteStatus(child, 'running')
    expect(published.at(-1)?.agents[0]?.phase).toBe('running')
    tracker.noteStatus(child, 'idle')
    expect(published.at(-1)?.agents[0]?.phase).toBe('waiting')
  })

  it('marks a disposed session gone', () => {
    const { tracker, published, sessions } = make()
    const log = [ev('subagent/descriptor', { version: 2, mode: 'one-shot', provider: 'spawn', label: 'Job' }, 1)]
    const child = fakeSession('child-1', 'root', log)
    sessions.set('child-1', child)
    tracker.noteEvent(child, log[0]!)
    tracker.noteGone(child)
    expect(published.at(-1)?.agents[0]?.phase).toBe('completed')
    tracker.noteGone(fakeSession('ghost'))
    expect(published).toHaveLength(2)
  })
})

describe('SubagentTracker.observeCatalog/sync', () => {
  it('adds catalog children declared by a session log', () => {
    const { tracker, published } = make()
    const parent = fakeSession('root', undefined, [
      ev('subagent/catalog', { childId: 'cold-1', label: 'Cold task', mode: 'one-shot' }, 1),
    ])
    tracker.observeCatalog(parent, parent.ownEvents())
    expect(published.at(-1)?.agents.map(a => a.id)).toContain('cold-1')
  })

  it('rebuilds from sessions then merges the durable child listing', async () => {
    const entries: SubagentCatalogEntry[] = [
      { kind: 'child', id: 'cold-1', mode: 'one-shot', label: 'Cold task', activity: 'inactive' },
      { kind: 'child', id: 'cold-2', mode: 'continuable', activity: 'running' },
    ]
    const { tracker, published, sessions } = make({ listChildren: () => Promise.resolve(entries) })
    const child = fakeSession('child-1', 'root', [ev('subagent/descriptor', { version: 2, mode: 'continuable', provider: 'spawn', label: 'Worker' }, 1)])
    sessions.set('child-1', child)
    tracker.sync()
    expect(published.at(-1)?.agents.map(a => a.id)).toEqual(['child-1'])
    await tick()
    const merged = published.at(-1)
    expect(merged?.agents.map(a => a.id).sort()).toEqual(['child-1', 'cold-1', 'cold-2'])
    expect(merged?.agents.find(a => a.id === 'cold-1')).toMatchObject({ label: 'Cold task', phase: 'waiting' })
    expect(merged?.agents.find(a => a.id === 'cold-2')?.phase).toBe('running')
  })

  it('drops a stale listing when the root changed mid-flight', async () => {
    const entries: SubagentCatalogEntry[] = [{ kind: 'child', id: 'cold-1', activity: 'inactive' }]
    const { tracker, published } = make({ listChildren: () => Promise.resolve(entries) })
    tracker.sync()
    tracker.reset()
    await tick()
    // The stale listing must not resurrect rows after the reset.
    expect(published.at(-1)?.agents ?? []).toEqual([])
    expect(tracker.snapshot()).toBeUndefined()
  })

  it('publishes an empty roster once when no root is active', () => {
    const { tracker, published, sessions } = make({ rootId: () => undefined })
    sessions.set('child-1', fakeSession('child-1', 'root'))
    tracker.noteSession(sessions.get('child-1')!)
    expect(published.at(-1)?.agents).toHaveLength(1)
    tracker.sync()
    expect(published.at(-1)).toBeUndefined()
  })
})
