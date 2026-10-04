/** Incremental presentation of published durable workflow records. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tool-workflow/types'
import type { TuiSubagentRoster, TuiWorkflowRun } from '../definition.ts'

export class WorkflowProjection {
  #runs = new Map<string, TuiWorkflowRun>()
  reset(events: readonly SessionEvent[]): void { this.#runs.clear(); for (const event of events) this.apply(event) }
  apply(event: SessionEvent): boolean {
    if (event.type === 'tool-workflow/run-start') {
      this.#runs.set(event.data.runId, { id: event.data.runId, name: event.data.name, status: 'open', members: [] })
      // Keep bounded history; complete data remains in the session log.
      if (this.#runs.size > 100) this.#runs.delete(this.#runs.keys().next().value as string)
      return true
    }
    if (event.type !== 'tool-workflow/run-end' && event.type !== 'tool-workflow/agent-start' && event.type !== 'tool-workflow/agent-end') return false
    const run = this.#runs.get(event.data.runId)
    if (run === undefined) return false
    if (event.type === 'tool-workflow/run-end') this.#runs.set(run.id, { ...run, status: event.data.stopReason })
    else if (event.type === 'tool-workflow/agent-start') {
      const member = { seq: event.data.seq, childId: String(event.data.childId), label: event.data.label,
        ...(event.data.phase === undefined ? {} : { phase: event.data.phase }) }
      this.#runs.set(run.id, { ...run, ...(member.phase === undefined ? {} : { phase: member.phase }), members: [...run.members, member] })
    } else {
      // Durable seq numbers are 1-based per run and pair the start/end events.
      this.#runs.set(run.id, { ...run, members: run.members.map(member => member.seq === event.data.seq ? { ...member, outcome: event.data.outcome } : member) })
    }
    return true
  }
  roster(roster: TuiSubagentRoster | undefined): TuiSubagentRoster | undefined {
    if (this.#runs.size === 0) return roster
    const workflows = [...this.#runs.values()]
    return { workflows, agents: (roster?.agents ?? []).map(agent => {
      const run = workflows.findLast(run => run.members.some(member => member.childId === agent.id))
      const member = run?.members.find(member => member.childId === agent.id)
      return run === undefined || member === undefined ? agent : { ...agent, workflow: { name: run.name,
        ...(member.phase === undefined ? {} : { phase: member.phase }), ...(member.outcome === undefined ? {} : { outcome: member.outcome }) } }
    }) }
  }
}
