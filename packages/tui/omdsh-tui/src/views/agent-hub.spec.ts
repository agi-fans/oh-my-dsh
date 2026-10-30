import { describe, expect, it } from 'vitest'
import { createTheme } from '../chrome/theme.ts'
import { visibleWidth } from '../chrome/width.ts'
import type { TuiSubagentRoster } from '../definition.ts'
import { applyAgentHubEvent, createAgentHub, renderAgentHub, updateAgentHub } from './agent-hub.ts'

const roster: TuiSubagentRoster = {
  agents: [
    {
      id: 'child-a',
      depth: 1,
      label: 'Inspect authentication',
      mode: 'continuable',
      phase: 'running',
      startedAt: 1_000,
      updatedAt: 2_000,
      activity: [{ text: 'read src/auth.ts', status: 'running' }],
    },
    {
      id: 'child-b',
      parentId: 'child-a',
      depth: 2,
      label: 'Review tests',
      mode: 'one-shot',
      phase: 'completed',
      startedAt: 1_000,
      updatedAt: 4_000,
      activity: [{ text: 'bash pnpm test', status: 'ok' }],
    },
  ],
}

describe('Agent Hub', () => {
  it('keeps external executions in the inspector rather than opening a nonexistent transcript', () => {
    const state = createAgentHub({ agents: [{ id: 'external', mode: 'external', label: 'Codex', depth: 1, phase: 'running', activity: [] }] })
    const command = applyAgentHubEvent(state, { type: 'key', id: 'enter' })
    expect(command).toEqual({ state: { ...state, inspector: true, detailScroll: 0 } })
    expect(renderAgentHub(state, createTheme('dark', false), 120, 20).lines.join('\n')).toContain('results appear in the parent session')
  })

  it('navigates, scrolls details, and opens the selected transcript', () => {
    let state = createAgentHub(roster)
    state = (applyAgentHubEvent(state, { type: 'key', id: 'down' }) as { state: typeof state }).state
    expect(state.selectedId).toBe('child-b')
    state = (applyAgentHubEvent(state, { type: 'key', id: 'pageDown' }) as { state: typeof state }).state
    expect(state.detailScroll).toBe(10)
    expect(applyAgentHubEvent(state, { type: 'key', id: 'enter' })).toEqual({ open: 'child-b' })
  })

  it('keeps selection when the roster refreshes and falls back when it disappears', () => {
    const selected = { ...createAgentHub(roster), selectedId: 'child-b' }
    expect(updateAgentHub(selected, { agents: [...roster.agents] }).selectedId).toBe('child-b')
    expect(updateAgentHub(selected, { agents: [roster.agents[0]!] }).selectedId).toBe('child-a')
  })

  it('renders exact-height display-cell-safe wide and narrow frames', () => {
    for (const width of [72, 120]) {
      const frame = renderAgentHub(createAgentHub(roster), createTheme(false), width, 18, 5_000)
      expect(frame.lines).toHaveLength(18)
      expect(frame.lines.every(line => visibleWidth(line) <= width)).toBe(true)
      expect(frame.lines.join('\n')).toContain('Agent Hub')
      expect(frame.lines.join('\n')).toContain('Inspect authentication')
    }
  })
})


it('presents Workflow outcomes separately from live child state within display-cell bounds', () => {
  const workflows = [{ id: 'review', name: '审查 🐳', status: 'error', phase: '测试', members: [] }]
  const workflow = { name: '审查 🐳', phase: '测试', outcome: 'failed' as const }
  for (const color of [false, true]) for (const width of [32, 80]) {
    const state = createAgentHub({ workflows, agents: [{ ...roster.agents[0]!, workflow }] })
    const frame = renderAgentHub(state, createTheme(color), width, 22, 5000)
    expect(frame.lines).toHaveLength(22)
    expect(frame.lines.every(line => visibleWidth(line) <= width)).toBe(true)
    expect(frame.lines.join('\n')).toContain('Workflow')
    if (width === 80) {
      const inspector = renderAgentHub({ ...state, inspector: true }, createTheme(color), width, 22, 5000)
      expect(inspector.lines.join('\n')).toContain('failed')
      expect(inspector.lines.join('\n')).toContain('running')
    }
  }
})

describe('the inspector says where a child spent its time', () => {
  it('annotates each step with how long it held', () => {
    const state = {
      roster: {
        agents: [{
          id: 'child-1', depth: 1, label: 'review auth', phase: 'running' as const, startedAt: 0, updatedAt: 10_000,
          activity: [
            { text: '$ rg -n "jwt" src', status: 'running' as const, at: 0 },
            { text: 'Read src/auth.ts', status: 'ok' as const, at: 3_000 },
          ],
        }],
      },
      selectedId: 'child-1',
      inspector: true,
      detailScroll: 0,
      tree: true,
    }
    const lines = renderAgentHub(state, createTheme(false), 80, 24, 10_000).lines.join('\n')
    expect(lines).toContain('3.0s')
    expect(lines).toContain('7.0s')
  })
})
