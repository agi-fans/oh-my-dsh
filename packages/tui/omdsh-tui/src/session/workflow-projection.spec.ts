import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { WorkflowProjection } from './workflow-projection.ts'

const event = (type: string, data: unknown) => ({ type, data }) as SessionEvent

describe('workflow presentation', () => {
  it('replays concurrent members by their sequence rather than settlement order', () => {
    const projection = new WorkflowProjection()
    projection.reset([
      event('tool-workflow/run-start', { runId: 'run', name: 'Review' }),
      event('tool-workflow/agent-start', { runId: 'run', seq: 1, childId: 'one', label: 'Source', phase: 'Check' }),
      event('tool-workflow/agent-start', { runId: 'run', seq: 2, childId: 'two', label: 'Tests', phase: 'Check' }),
      event('tool-workflow/agent-end', { runId: 'run', seq: 2, outcome: 'failed' }),
      event('tool-workflow/agent-end', { runId: 'run', seq: 1, outcome: 'completed' }),
      event('tool-workflow/run-end', { runId: 'run', stopReason: 'error' }),
    ])
    const roster = projection.roster({ agents: [{ id: 'two', label: 'Tests', phase: 'running', depth: 1, mode: 'one-shot', activity: [] }] })!
    expect(roster.workflows![0]).toMatchObject({ name: 'Review', status: 'error', phase: 'Check' })
    expect(roster.workflows![0]!.members.map(member => member.outcome)).toEqual(['completed', 'failed'])
    expect(roster.agents[0]).toMatchObject({ phase: 'running', workflow: { name: 'Review', phase: 'Check', outcome: 'failed' } })
    projection.reset([])
    expect(projection.roster(undefined)).toBeUndefined()
  })
  it('retains a bounded run history and ignores events from missing runs', () => {
    const projection = new WorkflowProjection()
    expect(projection.apply(event('tool-workflow/agent-end', { runId: 'missing', seq: 1, outcome: 'completed' }))).toBe(false)
    for (let index = 0; index < 120; index++) projection.apply(event('tool-workflow/run-start', { runId: `run-${index}`, name: 'Review' }))
    expect(projection.roster(undefined)!.workflows).toHaveLength(100)
  })
})

it.each(['interrupted', 'forked'])('marks only unfinished runs in the abandoned turn as interrupted (%s)', kind => {
  const events = [
    event('turn/start', { turn: 1 }),
    event('tool-workflow/run-start', { runId: 'background', name: 'Background' }),
    event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event('turn/start', { turn: 2 }),
    event('tool-workflow/run-start', { runId: 'unfinished', name: 'Current' }),
    event('tool-workflow/agent-start', { runId: 'unfinished', seq: 1, childId: 'child', label: 'Check' }),
    event('tool-workflow/run-start', { runId: 'finished', name: 'Finished' }),
    event('tool-workflow/run-end', { runId: 'finished', stopReason: 'completed' }),
    event('turn/end', { turn: 2, reason: { kind } }),
  ]
  const live = new WorkflowProjection(), replay = new WorkflowProjection()
  for (const item of events) live.apply(item)
  replay.reset(events)
  expect(replay.roster(undefined)).toEqual(live.roster(undefined))
  expect(replay.get('unfinished')?.status).toBe('interrupted')
  expect(replay.get('finished')?.status).toBe('completed')
  expect(replay.get('background')?.status).toBe('open')
  // A later durable end takes precedence over an inferred interrupted state.
  replay.apply(event('tool-workflow/run-end', { runId: 'unfinished', stopReason: 'cancelled' }))
  expect(replay.get('unfinished')?.status).toBe('cancelled')
})

it.each(['completed', 'aborted', 'error'])('does not infer workflow completion from an ordinary %s turn end', kind => {
  const projection = new WorkflowProjection()
  projection.reset([event('turn/start', { turn: 1 }), event('tool-workflow/run-start', { runId: 'run', name: 'Review' }), event('turn/end', { turn: 1, reason: { kind } })])
  expect(projection.get('run')?.status).toBe('open')
})
