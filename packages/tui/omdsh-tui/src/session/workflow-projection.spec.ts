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
