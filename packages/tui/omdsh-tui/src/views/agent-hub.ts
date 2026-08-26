/** Keyboard-first full-screen roster and inspector for descendant subagents. */

import type { KeyEvent } from '../input/keys.ts'
import type { Theme } from '../chrome/theme.ts'
import { padToWidth, truncateToWidth, visibleWidth, wrapText } from '../chrome/width.ts'
import type { TuiSubagentRoster, TuiSubagentView } from '../definition.ts'

export interface AgentHubState {
  roster: TuiSubagentRoster
  selectedId: string | null
  inspector: boolean
  detailScroll: number
  tree: boolean
}

export type AgentHubCommand = { state: AgentHubState } | { close: true } | { open: string }

export function createAgentHub(roster: TuiSubagentRoster): AgentHubState {
  return {
    roster,
    selectedId: roster.agents[0]?.id ?? null,
    inspector: false,
    detailScroll: 0,
    tree: true,
  }
}

export function updateAgentHub(state: AgentHubState, roster: TuiSubagentRoster): AgentHubState {
  const selectedId = roster.agents.some(agent => agent.id === state.selectedId)
    ? state.selectedId
    : roster.agents[0]?.id ?? null
  return { ...state, roster, selectedId, detailScroll: selectedId === state.selectedId ? state.detailScroll : 0 }
}

function selectedAgent(state: AgentHubState): TuiSubagentView | undefined {
  return state.roster.agents.find(agent => agent.id === state.selectedId)
}

function move(state: AgentHubState, delta: number): AgentHubState {
  const agents = state.roster.agents
  if (agents.length === 0) return state
  const current = Math.max(0, agents.findIndex(agent => agent.id === state.selectedId))
  const index = Math.max(0, Math.min(agents.length - 1, current + delta))
  return { ...state, selectedId: agents[index]?.id ?? null, detailScroll: 0 }
}

export function applyAgentHubEvent(state: AgentHubState, event: KeyEvent): AgentHubCommand {
  if (event.type === 'text' && event.value.toLowerCase() === 't') return { state: { ...state, tree: !state.tree } }
  if (event.type !== 'key') return { state }
  if (event.id === 'escape' || event.id === 'ctrl+c') {
    if (state.inspector) return { state: { ...state, inspector: false, detailScroll: 0 } }
    return { close: true }
  }
  if (event.id === 'up') return { state: move(state, -1) }
  if (event.id === 'down') return { state: move(state, 1) }
  if (event.id === 'home') return { state: { ...state, selectedId: state.roster.agents[0]?.id ?? null, detailScroll: 0 } }
  if (event.id === 'end') return { state: { ...state, selectedId: state.roster.agents.at(-1)?.id ?? null, detailScroll: 0 } }
  if (event.id === 'pageUp') return { state: { ...state, detailScroll: Math.max(0, state.detailScroll - 10) } }
  if (event.id === 'pageDown') return { state: { ...state, detailScroll: state.detailScroll + 10 } }
  if (event.id === 'tab' || event.id === 'left' || event.id === 'right') {
    return { state: { ...state, inspector: !state.inspector, detailScroll: 0 } }
  }
  if (event.id === 'enter') {
    const agent = selectedAgent(state)
    return agent === undefined ? { state } : { open: agent.id }
  }
  return { state }
}

function phaseColor(phase: TuiSubagentView['phase']): 'accent' | 'success' | 'warning' | 'error' | 'dim' {
  if (phase === 'running' || phase === 'starting') return 'accent'
  if (phase === 'completed') return 'success'
  if (phase === 'waiting') return 'warning'
  if (phase === 'error') return 'error'
  return 'dim'
}

function duration(agent: TuiSubagentView, now: number): string {
  if (agent.startedAt === undefined) return '—'
  const end = agent.phase === 'running' || agent.phase === 'starting' ? now : agent.updatedAt ?? now
  const ms = Math.max(0, end - agent.startedAt)
  if (ms < 1_000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1_000)}s`
}

function rosterLine(agent: TuiSubagentView, selected: boolean, tree: boolean, theme: Theme, width: number, now: number): string {
  const marker = selected ? theme.fg('accent', '›') : ' '
  const indent = tree ? '  '.repeat(Math.max(0, agent.depth - 1)) : ''
  const phase = theme.fg(phaseColor(agent.phase), agent.phase.padEnd(9))
  const elapsed = duration(agent, now).padStart(7)
  const prefix = `${marker} ${indent}${phase} ${elapsed}  `
  return prefix + truncateToWidth(agent.label, Math.max(0, width - visibleWidth(prefix)))
}

function rosterRows(state: AgentHubState, theme: Theme, width: number, height: number, now: number): string[] {
  if (state.roster.agents.length === 0) return [theme.fg('dim', ' No subagents are available in this session.')]
  const selected = Math.max(0, state.roster.agents.findIndex(agent => agent.id === state.selectedId))
  const start = Math.max(0, Math.min(state.roster.agents.length - height, selected - Math.floor(height / 2)))
  return state.roster.agents.slice(start, start + height)
    .map(agent => truncateToWidth(rosterLine(agent, agent.id === state.selectedId, state.tree, theme, width, now), width))
}

function inspectorText(agent: TuiSubagentView | undefined, now: number): string {
  if (agent === undefined) return 'No subagent selected.'
  const current = agent.activity.at(-1)
  const activity = agent.activity.length === 0
    ? ['No activity recorded.']
    : agent.activity.map(item => `${item.status.padEnd(8)} ${item.text}`)
  return [
    agent.label,
    '',
    `Status: ${agent.phase}`,
    `Mode: ${agent.mode ?? 'unknown'}`,
    `Elapsed: ${duration(agent, now)}`,
    `Session: ${agent.id}`,
    `Parent: ${agent.parentId ?? 'root session'}`,
    `Depth: ${agent.depth}`,
    `Current: ${current?.text ?? '—'}`,
    '',
    'Recent activity',
    ...activity,
  ].join('\n')
}

function inspectorRows(state: AgentHubState, theme: Theme, width: number, height: number, now: number): string[] {
  const body = wrapText(inspectorText(selectedAgent(state), now), Math.max(1, width - 2))
  const viewportHeight = Math.max(0, height - 2)
  const maxScroll = Math.max(0, body.length - viewportHeight)
  const start = Math.min(state.detailScroll, maxScroll)
  const end = Math.min(body.length, start + viewportHeight)
  const position = body.length > viewportHeight
    ? theme.fg('dim', ` ${start + 1}-${end} / ${body.length} lines · PgUp/PgDn scroll`)
    : ''
  return [theme.bold(theme.fg('accent', ' Inspector')), truncateToWidth(position, width), ...body.slice(start, end)]
}

export function renderAgentHub(
  state: AgentHubState,
  theme: Theme,
  width: number,
  height: number,
  now = Date.now(),
): { lines: string[]; cursor: { row: number; column: number }; cursorVisible: boolean } {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const running = state.roster.agents.filter(agent => agent.phase === 'running' || agent.phase === 'starting').length
  const waiting = state.roster.agents.filter(agent => agent.phase === 'waiting').length
  const header = truncateToWidth(theme.bold(' Agent Hub ') + theme.fg('dim', `${state.roster.agents.length} agents · ${running} active · ${waiting} waiting`), safeWidth)
  const toolbar = truncateToWidth(theme.fg('dim', ' ↑↓ navigate · Enter transcript · Tab inspector · PgUp/PgDn detail · t tree · Esc close'), safeWidth)
  const divider = theme.fg('border', '─'.repeat(safeWidth))
  const bodyHeight = Math.max(0, safeHeight - 4)
  const wide = safeWidth >= 96
  let body: string[]
  if (wide) {
    const leftWidth = Math.max(36, Math.floor(safeWidth * 0.46))
    const rightWidth = Math.max(1, safeWidth - leftWidth - 1)
    const left = rosterRows(state, theme, leftWidth, bodyHeight, now)
    const right = inspectorRows(state, theme, rightWidth, bodyHeight, now)
    body = Array.from({ length: bodyHeight }, (_, index) =>
      padToWidth(left[index] ?? '', leftWidth) + theme.fg('border', '│') + truncateToWidth(right[index] ?? '', rightWidth))
  } else if (state.inspector) {
    body = inspectorRows(state, theme, safeWidth, bodyHeight, now)
  } else {
    body = rosterRows(state, theme, safeWidth, bodyHeight, now)
  }
  while (body.length < bodyHeight) body.push('')
  const footer = truncateToWidth(theme.fg('dim', wide || state.inspector
    ? ' PgUp/PgDn scroll · Enter transcript · Esc close'
    : ' Tab inspector · Enter transcript · Esc close'), safeWidth)
  const lines = [header, toolbar, divider, ...body.slice(0, bodyHeight), footer].slice(0, safeHeight)
  while (lines.length < safeHeight) lines.push('')
  return { lines, cursor: { row: safeHeight - 1, column: 0 }, cursorVisible: false }
}
