/** Keyboard-first Trajectory ledger projected directly from durable session events. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { KeyEvent } from '../input/keys.ts'
import type { Theme } from '../chrome/theme.ts'
import { padToWidth, truncateToWidth, visibleWidth, wrapText } from '../chrome/width.ts'

export type TrajectoryKind = 'system' | 'user' | 'context' | 'assistant' | 'tool' | 'subtool' | 'compaction' | 'error'
export type TrajectoryDetailTab = 'summary' | 'payload' | 'result' | 'schema' | 'timing'

export interface TrajectoryRecord {
  id: string
  index: number
  seq: number
  type: string
  kind: TrajectoryKind
  turn: number | null
  step: number | null
  label: string
  summary: string
  payload: string
  result: string
  schema: string
  status: 'running' | 'ok' | 'error' | 'retry'
  startedAt: number | null
  durationMs: number | null
  ttftMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  parentCallId: string | null
}

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function compact(text: string, fallback: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  return normalized === '' ? fallback : normalized
}

function json(value: unknown): string {
  try {
    const encoded = JSON.stringify(value, null, 2)
    return encoded === undefined ? String(value) : encoded
  } catch {
    return String(value)
  }
}

function contentText(value: unknown, wanted?: 'text' | 'reasoning'): string {
  if (typeof value === 'string') return wanted === 'reasoning' ? '' : value
  if (Array.isArray(value)) return value.map(item => contentText(item, wanted)).filter(Boolean).join('\n')
  const row = object(value)
  if (row === undefined) return ''
  const type = string(row['type'])
  if (wanted === 'reasoning' && type !== undefined && !type.includes('reason')) return ''
  if (wanted === 'text' && type !== undefined && type.includes('reason')) return ''
  for (const key of ['text', 'content', 'reasoning', 'output', 'result']) {
    const found = row[key]
    if (typeof found === 'string') return found
    if (Array.isArray(found)) return contentText(found, wanted)
  }
  return ''
}

function location(data: JsonObject, fallbackTurn: number | null, fallbackStep: number | null): { turn: number | null; step: number | null } {
  const nested = object(data['location'])
  return {
    turn: number(data['turn']) ?? number(nested?.['turn']) ?? fallbackTurn,
    step: number(data['step']) ?? number(nested?.['step']) ?? fallbackStep,
  }
}

function stepKey(turn: number | null, step: number | null): string {
  return `${turn ?? 'between'}:${step ?? 0}`
}

function tokenValue(source: JsonObject | undefined, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = number(source?.[key])
    if (value !== undefined) return value
  }
  return null
}

/** Incremental projection. Opening a long session is O(events); live updates are O(1). */
export class TrajectoryLedger {
  readonly records: TrajectoryRecord[] = []
  #turn: number | null = null
  #step: number | null = null
  readonly #stepStarted = new Map<string, number>()
  readonly #stepFirstToken = new Map<string, number>()
  readonly #assistantByStep = new Map<string, number>()
  readonly #toolByCallId = new Map<string, number>()
  readonly #compactionById = new Map<string, number>()
  readonly #requestByStep = new Map<string, string>()
  readonly #schemas = new Map<string, string>()

  constructor(events: readonly SessionEvent[] = []) {
    for (const event of events) this.append(event)
  }

  #push(record: Omit<TrajectoryRecord, 'index'>): number {
    const index = this.records.length
    this.records.push({ ...record, index: index + 1 })
    return index
  }

  #base(event: SessionEvent, kind: TrajectoryKind, label: string, summary: string, data: JsonObject): Omit<TrajectoryRecord, 'index'> {
    const place = location(data, this.#turn, this.#step)
    return {
      id: `${event.seq}:${event.type}`,
      seq: event.seq,
      type: event.type,
      kind,
      turn: place.turn,
      step: place.step,
      label,
      summary,
      payload: json(event.data),
      result: '',
      schema: '',
      status: 'ok',
      startedAt: event.time,
      durationMs: null,
      ttftMs: null,
      inputTokens: null,
      outputTokens: null,
      parentCallId: null,
    }
  }

  append(event: SessionEvent): void {
    const eventType: string = event.type
    const data = object(event.data) ?? {}
    const place = location(data, this.#turn, this.#step)
    const key = stepKey(place.turn, place.step)

    if (eventType === 'turn/start') {
      this.#turn = place.turn ?? (this.#turn ?? 0) + 1
      this.#step = null
      return
    }
    if (eventType === 'step/start') {
      this.#turn = place.turn
      this.#step = place.step
      this.#stepStarted.set(key, event.time)
      return
    }
    if (eventType === 'request/header') {
      this.#requestByStep.set(key, json(event.data))
      const prompt = object(data['prompt'])
      const tools = prompt?.['tools']
      if (Array.isArray(tools)) {
        for (const tool of tools) {
          const row = object(tool)
          const name = string(row?.['name'])
          if (name !== undefined) this.#schemas.set(name, json(tool))
        }
      }
      return
    }
    if (eventType === 'user/message') {
      const source = object(data['source'])
      const isUser = source?.['kind'] === 'user'
      const text = contentText(data['content'])
      this.#push(this.#base(event, isUser ? 'user' : 'context', isUser ? 'USER' : 'CONTEXT', compact(text, 'Injected context'), data))
      return
    }
    if (eventType === 'assistant/chunk') {
      const chunk = object(data['chunk'])
      const chunkType = string(chunk?.['type'])
      if (chunkType !== 'text-delta' && chunkType !== 'reasoning-delta') return
      const delta = string(chunk?.['text']) ?? ''
      if (!this.#stepFirstToken.has(key)) this.#stepFirstToken.set(key, event.time)
      const existing = this.#assistantByStep.get(key)
      if (existing === undefined) {
        const startedAt = this.#stepStarted.get(key) ?? event.time
        const record = this.#base(event, 'assistant', 'ASSISTANT', compact(delta, chunkType === 'reasoning-delta' ? 'Thinking…' : 'Streaming…'), data)
        record.id = `assistant:${key}`
        record.status = 'running'
        record.startedAt = startedAt
        record.ttftMs = event.time - startedAt
        record.payload = this.#requestByStep.get(key) ?? record.payload
        this.#assistantByStep.set(key, this.#push(record))
      } else {
        const record = this.records[existing]
        if (record !== undefined && delta !== '') record.summary = compact(`${record.summary} ${delta}`, record.summary)
      }
      return
    }
    if (eventType === 'assistant/message') {
      const message = object(data['message'])
      const text = contentText(message?.['content'] ?? data['content'], 'text')
      const reasoning = contentText(message?.['content'] ?? data['content'], 'reasoning')
      const usage = object(message?.['usage'] ?? data['usage'])
      const startedAt = this.#stepStarted.get(key) ?? event.time
      const existing = this.#assistantByStep.get(key)
      const result = reasoning === '' ? text : `Thinking\n${reasoning}\n\nAnswer\n${text}`
      if (existing === undefined) {
        const record = this.#base(event, 'assistant', 'ASSISTANT', compact(text, 'Assistant response'), data)
        record.id = `assistant:${key}`
        record.payload = this.#requestByStep.get(key) ?? record.payload
        record.result = result
        record.startedAt = startedAt
        record.durationMs = Math.max(0, event.time - startedAt)
        const first = this.#stepFirstToken.get(key)
        record.ttftMs = first === undefined ? null : Math.max(0, first - startedAt)
        record.inputTokens = tokenValue(usage, 'inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens')
        record.outputTokens = tokenValue(usage, 'outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens')
        this.#assistantByStep.set(key, this.#push(record))
      } else {
        const record = this.records[existing]
        if (record !== undefined) {
          record.seq = event.seq
          record.summary = compact(text, record.summary)
          record.result = result
          record.status = data['interrupted'] === true ? 'error' : 'ok'
          record.durationMs = Math.max(0, event.time - startedAt)
          record.inputTokens = tokenValue(usage, 'inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens')
          record.outputTokens = tokenValue(usage, 'outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens')
        }
      }
      return
    }
    if (eventType === 'tool/call' || eventType === 'tool/code-dispatch-start') {
      const callId = string(data['callId']) ?? string(data['id']) ?? `${event.seq}`
      const parentCallId = string(data['parentCallId']) ?? string(data['parentId']) ?? null
      const name = string(data['name']) ?? string(data['toolName']) ?? 'tool'
      const args = data['arguments'] ?? data['input'] ?? data
      const record = this.#base(event, parentCallId === null ? 'tool' : 'subtool', name, `${name} ${compact(json(args), '')}`.trim(), data)
      record.id = `tool:${callId}`
      record.label = parentCallId === null ? 'TOOL' : 'SUBTOOL'
      record.status = 'running'
      record.parentCallId = parentCallId
      record.schema = this.#schemas.get(name) ?? ''
      this.#toolByCallId.set(callId, this.#push(record))
      return
    }
    if (eventType === 'tool/result' || eventType === 'tool/code-dispatch') {
      const message = object(data['message'])
      const callId = string(message?.['callId']) ?? string(data['callId']) ?? string(data['id'])
      if (callId === undefined) return
      const index = this.#toolByCallId.get(callId)
      if (index === undefined) return
      const record = this.records[index]
      if (record === undefined) return
      record.result = contentText(message?.['content'] ?? data['result'] ?? data['output']) || json(message ?? data)
      record.status = data['error'] === true || object(data['error']) !== undefined ? 'error' : 'ok'
      record.durationMs = record.startedAt === null ? null : Math.max(0, event.time - record.startedAt)
      return
    }
    if (eventType === 'llm/retry') {
      const record = this.#base(event, 'error', 'RETRY', compact(json(data), 'Model request retry'), data)
      record.status = 'retry'
      this.#push(record)
      return
    }
    if (eventType === 'compaction/start') {
      const id = string(data['compactId']) ?? string(data['id']) ?? `${event.seq}`
      const record = this.#base(event, 'compaction', 'COMPACT', 'Compaction started', data)
      record.id = `compaction:${id}`
      record.status = 'running'
      this.#compactionById.set(id, this.#push(record))
      return
    }
    if (eventType === 'compaction/summary' || eventType === 'compaction/end') {
      const id = string(data['compactId']) ?? string(data['id'])
      const index = id === undefined ? [...this.#compactionById.values()].at(-1) : this.#compactionById.get(id)
      if (index === undefined) return
      const record = this.records[index]
      if (record === undefined) return
      if (eventType === 'compaction/summary') record.result = contentText(data['summary']) || json(data['summary'])
      else {
        record.status = data['error'] === undefined ? 'ok' : 'error'
        record.durationMs = record.startedAt === null ? null : Math.max(0, event.time - record.startedAt)
        record.summary = record.status === 'ok' ? 'Compaction completed' : 'Compaction failed'
      }
      return
    }
    if (eventType === 'step/end') {
      const index = this.#assistantByStep.get(key)
      const record = index === undefined ? undefined : this.records[index]
      const reason = object(data['reason'])
      if (record !== undefined) {
        if (reason?.['kind'] === 'error' || data['error'] !== undefined) record.status = 'error'
        if (record.durationMs === null && record.startedAt !== null) record.durationMs = Math.max(0, event.time - record.startedAt)
      }
      return
    }
    if (eventType === 'turn/end') {
      const reason = object(data['reason'])
      if (reason?.['kind'] !== 'error' && reason?.['kind'] !== 'aborted') return
      const record = this.#base(event, 'error', 'TURN', compact(json(reason), 'Turn interrupted'), data)
      record.status = 'error'
      this.#push(record)
    }
  }
}

export interface TrajectoryState {
  ledger: TrajectoryLedger
  selectedId: string | null
  query: string
  searching: boolean
  details: boolean
  detailTab: TrajectoryDetailTab
  detailScroll: number
  collapsedTurns: ReadonlySet<number>
  callsCollapsed: boolean
  following: boolean
}

export function createTrajectory(events: readonly SessionEvent[]): TrajectoryState {
  const ledger = new TrajectoryLedger(events)
  return {
    ledger,
    selectedId: ledger.records.at(-1)?.id ?? null,
    query: '',
    searching: false,
    details: false,
    detailTab: 'summary',
    detailScroll: 0,
    collapsedTurns: new Set(),
    callsCollapsed: false,
    following: true,
  }
}

export function appendTrajectoryEvent(state: TrajectoryState, event: SessionEvent): TrajectoryState {
  state.ledger.append(event)
  return state.following
    ? { ...state, selectedId: trajectoryVisibleRecords(state).at(-1)?.id ?? state.selectedId }
    : state
}

export function trajectoryVisibleRecords(state: TrajectoryState): TrajectoryRecord[] {
  const query = state.query.trim().toLocaleLowerCase()
  const firstInCollapsed = new Set<number>()
  return state.ledger.records.filter((record) => {
    if (state.callsCollapsed && record.kind === 'subtool') return false
    if (record.turn !== null && state.collapsedTurns.has(record.turn)) {
      if (firstInCollapsed.has(record.turn)) return false
      firstInCollapsed.add(record.turn)
    }
    if (query === '') return true
    return `${record.type}\n${record.label}\n${record.summary}\n${record.payload}\n${record.result}\n${record.schema}`
      .toLocaleLowerCase().includes(query)
  })
}

export type TrajectoryCommand = { state: TrajectoryState } | { close: true }

function move(state: TrajectoryState, delta: number): TrajectoryState {
  const visible = trajectoryVisibleRecords(state)
  if (visible.length === 0) return state
  const current = Math.max(0, visible.findIndex(record => record.id === state.selectedId))
  const index = Math.max(0, Math.min(visible.length - 1, current + delta))
  return { ...state, selectedId: visible[index]?.id ?? null, detailScroll: 0, following: index === visible.length - 1 }
}

const DETAIL_TABS: readonly TrajectoryDetailTab[] = ['summary', 'payload', 'result', 'schema', 'timing']

function moveTab(state: TrajectoryState, delta: number): TrajectoryState {
  const current = DETAIL_TABS.indexOf(state.detailTab)
  const next = (current + delta + DETAIL_TABS.length) % DETAIL_TABS.length
  return { ...state, detailTab: DETAIL_TABS[next] ?? 'summary', detailScroll: 0 }
}

export function applyTrajectoryEvent(state: TrajectoryState, event: KeyEvent): TrajectoryCommand {
  if (state.searching) {
    if (event.type === 'text') return { state: { ...state, query: state.query + event.value, following: false } }
    if (event.type !== 'key') return { state }
    if (event.id === 'backspace') return { state: { ...state, query: state.query.slice(0, -1) } }
    if (event.id === 'enter') return { state: { ...state, searching: false } }
    if (event.id === 'escape' || event.id === 'ctrl+c') return { state: { ...state, searching: false } }
    return { state }
  }
  if (event.type === 'text') {
    if (event.value === '/') return { state: { ...state, searching: true, following: false } }
    if (event.value.toLowerCase() === 'c') return { state: { ...state, callsCollapsed: !state.callsCollapsed } }
    if (event.value.toLowerCase() === 't') {
      const selected = state.ledger.records.find(record => record.id === state.selectedId)
      if (selected?.turn === null || selected?.turn === undefined) return { state }
      const collapsed = new Set(state.collapsedTurns)
      if (collapsed.has(selected.turn)) collapsed.delete(selected.turn)
      else collapsed.add(selected.turn)
      const first = state.ledger.records.find(record => record.turn === selected.turn)
      return { state: { ...state, collapsedTurns: collapsed, selectedId: first?.id ?? state.selectedId } }
    }
    return { state }
  }
  if (event.type !== 'key') return { state }
  if (event.id === 'escape' || event.id === 'ctrl+c') {
    if (state.details) return { state: { ...state, details: false, detailScroll: 0 } }
    return { close: true }
  }
  if (event.id === 'up') return { state: move(state, -1) }
  if (event.id === 'down') return { state: move(state, 1) }
  if (event.id === 'pageUp') {
    if (state.details) return { state: { ...state, detailScroll: Math.max(0, state.detailScroll - 10) } }
    return { state: move(state, -10) }
  }
  if (event.id === 'pageDown') {
    if (state.details) return { state: { ...state, detailScroll: state.detailScroll + 10 } }
    return { state: move(state, 10) }
  }
  if (event.id === 'home') {
    const first = trajectoryVisibleRecords(state)[0]
    return { state: { ...state, selectedId: first?.id ?? null, following: false } }
  }
  if (event.id === 'end') {
    const last = trajectoryVisibleRecords(state).at(-1)
    return { state: { ...state, selectedId: last?.id ?? null, following: true } }
  }
  if (event.id === 'enter') return { state: { ...state, details: !state.details, detailScroll: 0 } }
  if (event.id === 'tab' || event.id === 'right') return { state: moveTab(state, 1) }
  if (event.id === 'shift+tab' || event.id === 'left') return { state: moveTab(state, -1) }
  return { state }
}

function duration(record: TrajectoryRecord): string {
  if (record.durationMs === null) return record.status === 'running' ? 'live' : '—'
  if (record.durationMs < 1_000) return `${Math.round(record.durationMs)}ms`
  return `${(record.durationMs / 1_000).toFixed(record.durationMs < 10_000 ? 1 : 0)}s`
}

function kindColor(kind: TrajectoryKind): 'accent' | 'warning' | 'success' | 'error' | 'dim' | 'text' {
  if (kind === 'user') return 'accent'
  if (kind === 'assistant') return 'text'
  if (kind === 'tool' || kind === 'subtool') return 'success'
  if (kind === 'error') return 'error'
  if (kind === 'compaction') return 'warning'
  return 'dim'
}

function recordLine(record: TrajectoryRecord, selected: boolean, theme: Theme, width: number): string {
  const marker = selected ? theme.fg('accent', '›') : ' '
  const locationLabel = record.turn === null ? ' —   ' : `T${record.turn}${record.step === null ? '' : `·${record.step}`}`.padEnd(5)
  const kind = theme.fg(kindColor(record.kind), record.label.padEnd(9).slice(0, 9))
  const elapsed = duration(record).padStart(6)
  const prefix = `${marker} ${String(record.index).padStart(4)} ${locationLabel} ${kind} ${elapsed}  `
  return prefix + truncateToWidth(record.summary, Math.max(0, width - visibleWidth(prefix)))
}

function selectedRecord(state: TrajectoryState): TrajectoryRecord | undefined {
  return state.ledger.records.find(record => record.id === state.selectedId)
}

function timingText(record: TrajectoryRecord): string {
  return [
    `Event: ${record.type} (#${record.seq})`,
    `Started: ${record.startedAt === null ? '—' : new Date(record.startedAt).toISOString()}`,
    `Duration: ${record.durationMs === null ? '—' : `${Math.round(record.durationMs)} ms`}`,
    `TTFT: ${record.ttftMs === null ? '—' : `${Math.round(record.ttftMs)} ms`}`,
    `Tokens: ${record.inputTokens ?? '—'} in · ${record.outputTokens ?? '—'} out`,
    `Status: ${record.status}`,
  ].join('\n')
}

function detailText(state: TrajectoryState, record: TrajectoryRecord | undefined): string {
  if (record === undefined) return 'No trajectory record selected.'
  if (state.detailTab === 'payload') return record.payload || 'No payload recorded.'
  if (state.detailTab === 'result') return record.result || 'No result recorded.'
  if (state.detailTab === 'schema') return record.schema || 'No tool schema recorded.'
  if (state.detailTab === 'timing') return timingText(record)
  return [
    `${record.label} · ${record.type}`,
    `Turn ${record.turn ?? 'between'} · Step ${record.step ?? '—'} · ${duration(record)}`,
    '',
    record.summary,
  ].join('\n')
}

function ledgerRows(state: TrajectoryState, theme: Theme, width: number, height: number): string[] {
  const visible = trajectoryVisibleRecords(state)
  if (visible.length === 0) return [theme.fg('dim', state.query === '' ? '  No trajectory records.' : '  No matching trajectory records.')]
  const lines: { id: string; text: string }[] = []
  let previousTurn: number | null | undefined
  for (const record of visible) {
    if (record.turn !== previousTurn) {
      previousTurn = record.turn
      const label = record.turn === null ? 'Between turns' : `Turn ${record.turn}`
      const collapsed = record.turn !== null && state.collapsedTurns.has(record.turn) ? ' · collapsed' : ''
      lines.push({ id: `turn:${record.turn ?? 'between'}`, text: theme.fg('accent', `── ${label}${collapsed} `) })
    }
    lines.push({ id: record.id, text: recordLine(record, record.id === state.selectedId, theme, width) })
  }
  const selectedLine = Math.max(0, lines.findIndex(line => line.id === state.selectedId))
  const start = Math.max(0, Math.min(lines.length - height, selectedLine - Math.floor(height / 2)))
  return lines.slice(start, start + height).map(line => truncateToWidth(line.text, width))
}

function detailRows(state: TrajectoryState, theme: Theme, width: number, height: number): string[] {
  const tabs = DETAIL_TABS.map(tab => tab === state.detailTab ? theme.fg('accent', `[${tab}]`) : theme.fg('dim', tab)).join(' ')
  const body = wrapText(detailText(state, selectedRecord(state)), Math.max(1, width - 2))
  const viewportHeight = Math.max(0, height - 2)
  const maxScroll = Math.max(0, body.length - viewportHeight)
  const start = Math.min(state.detailScroll, maxScroll)
  const end = Math.min(body.length, start + viewportHeight)
  const position = body.length > viewportHeight
    ? theme.fg('dim', ` ${start + 1}-${end} / ${body.length} lines · PgUp/PgDn scroll`)
    : ''
  return [truncateToWidth(tabs, width), truncateToWidth(position, width), ...body.slice(start, end)]
}

/** Render the full-screen ledger without touching the ordinary transcript viewport. */
export function renderTrajectory(
  state: TrajectoryState,
  theme: Theme,
  width: number,
  height: number,
): { lines: string[]; cursor: { row: number; column: number }; cursorVisible: boolean } {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const records = state.ledger.records
  const errors = records.filter(record => record.status === 'error').length
  const requests = records.filter(record => record.kind === 'assistant').length
  const tools = records.filter(record => record.kind === 'tool' || record.kind === 'subtool').length
  const header = truncateToWidth(theme.bold(' Trajectory ') + theme.fg('dim', `${records.length} records · ${requests} requests · ${tools} calls · ${errors} errors`), safeWidth)
  const toolbar = truncateToWidth(theme.fg('dim', state.details
    ? ' ↑↓ records · PgUp/PgDn detail · Tab/←→ section · Esc back'
    : ` ↑↓ navigate · Enter details · / search · t turn · c calls · End follow${state.following ? ' ●' : ''}`), safeWidth)
  const divider = theme.fg('border', '─'.repeat(safeWidth))
  const bodyHeight = Math.max(0, safeHeight - 4)
  const wideDetails = state.details && safeWidth >= 96
  let body: string[]
  if (wideDetails) {
    const leftWidth = Math.max(40, Math.floor(safeWidth * 0.58))
    const rightWidth = Math.max(1, safeWidth - leftWidth - 1)
    const left = ledgerRows(state, theme, leftWidth, bodyHeight)
    const right = detailRows(state, theme, rightWidth, bodyHeight)
    body = Array.from({ length: bodyHeight }, (_, index) =>
      padToWidth(left[index] ?? '', leftWidth) + theme.fg('border', '│') + truncateToWidth(right[index] ?? '', rightWidth))
  } else if (state.details) {
    body = detailRows(state, theme, safeWidth, bodyHeight)
  } else {
    body = ledgerRows(state, theme, safeWidth, bodyHeight)
  }
  while (body.length < bodyHeight) body.push('')
  const footerText = state.searching
    ? ` Search: ${state.query}`
    : state.details
      ? ' PgUp/PgDn scroll · Tab/←→ section · Esc back'
      : ' Esc close'
  const footer = truncateToWidth(theme.fg(state.searching ? 'accent' : 'dim', footerText), safeWidth)
  const lines = [header, toolbar, divider, ...body.slice(0, bodyHeight), footer].slice(0, safeHeight)
  while (lines.length < safeHeight) lines.push('')
  return {
    lines,
    cursor: { row: safeHeight - 1, column: Math.min(safeWidth, visibleWidth(` Search: ${state.query}`)) },
    cursorVisible: state.searching,
  }
}
