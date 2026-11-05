/** Workflow identities and statuses projected into existing roster and tree controls. */
import type { TuiPrompt, TuiSubagentRoster, TuiSubagentView, TuiWorkflowRun } from '../definition.ts'

export type RosterItem =
  | { key: string; kind: 'agent'; agent: TuiSubagentView }
  | { key: string; kind: 'workflow'; run: TuiWorkflowRun }

export function rosterItems(roster: TuiSubagentRoster | undefined): RosterItem[] {
  return [
    ...(roster?.workflows ?? []).map(run => ({ key: `workflow:${run.id}`, kind: 'workflow' as const, run })),
    ...(roster?.agents ?? []).map(agent => ({ key: `agent:${agent.id}`, kind: 'agent' as const, agent })),
  ]
}

export function workflowStatus(status: string): string {
  return ({ open: 'Running', completed: 'Completed', error: 'Failed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' } as Record<string, string>)[status] ?? status
}

export function workflowMemberStatus(run: TuiWorkflowRun, member: TuiWorkflowRun['members'][number]): string {
  return member.outcome ?? (run.status === 'interrupted' ? 'interrupted' : 'open')
}

function badge(status: string): NonNullable<NonNullable<TuiPrompt['options']>[number]['badge']> {
  return { label: workflowStatus(status), tone: status === 'completed' ? 'success' : status === 'failed' || status === 'error' ? 'error' : status === 'open' ? 'muted' : 'warning' }
}

/** Only actual member starts create groups; absent and empty phase names stay distinct. */
export function workflowOptions(run: TuiWorkflowRun, canOpen: (member: TuiWorkflowRun['members'][number]) => boolean): NonNullable<TuiPrompt['options']> {
  const options: NonNullable<TuiPrompt['options']>[number][] = [
    { label: run.name, value: 'run', disabled: true, badge: badge(run.status) },
  ]
  const phases = new Map<string | undefined, TuiWorkflowRun['members'][number][]>()
  for (const member of run.members) {
    const members = phases.get(member.phase) ?? []
    members.push(member)
    phases.set(member.phase, members)
  }
  for (const [phase, members] of phases) {
    const value = phase === undefined ? 'phase:missing' : `phase:value:${phase}`
    const statuses = members.map(member => workflowMemberStatus(run, member))
    const status = ['failed', 'interrupted', 'cancelled', 'open', 'completed'].find(status => statuses.includes(status)) ?? 'open'
    options.push({ label: phase === undefined ? '—' : phase === '' ? '“”' : phase, value, parentValue: 'run', disabled: true,
      badge: { ...badge(status), label: `${members.length} · ${workflowStatus(status)}` } })
    for (const member of members) {
      const available = canOpen(member)
      const status = workflowMemberStatus(run, member)
      options.push({ label: member.label, value: `member:${member.seq}`, parentValue: value,
        badge: status === 'open' && !available ? { ...badge(status), label: 'Running · Not available to open' } : badge(status), disabled: !available, submitLabel: 'open' })
    }
  }
  return options
}
