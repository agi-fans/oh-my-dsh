/** Keyboard-first Trajectory ledger projected directly from durable session events. */

import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { KeyEvent } from '../input/keys.ts'
import type { Theme } from '../chrome/theme.ts'
import { padToWidth, truncateToWidth, visibleWidth, wrapText } from '../chrome/width.ts'
import { moveGraphemeLeft, moveGraphemeRight } from '../chrome/grapheme.ts'
import { firstVisibleStreamTime } from './stream-time.ts'
import { formatOverlayHint, type HotkeyRow } from './hotkey-format.ts'
import { listNavigation } from './list-navigation.ts'
import { highlightCodeLines, toolPayloadLanguage } from '../chrome/code-highlight.ts'
import { renderMarkdown } from '../chrome/markdown.ts'
import { renderTimelineOverview, trajectoryTimeline, type TimelineLane } from './trajectory-timeline.ts'
import { formatDuration, formatTokens } from '../chrome/status-line.ts'

export type TrajectoryKind = 'system' | 'user' | 'context' | 'assistant' | 'tool' | 'subtool' | 'compaction' | 'warning' | 'error'
export type TrajectoryDetailTab = 'summary' | 'payload' | 'result' | 'schema'

export interface TrajectoryRecord {
  id: string
  index: number
  seq: number
  type: string
  kind: TrajectoryKind
  turn: number | null
  step: number | null
  label: string
  /** Tool name for a call, so the pane's title can say what was called. */
  name: string
  summary: string
  /** Reasoning the model emitted for this record, when it emitted any. */
  thinking: string
  payload: string
  result: string
  schema: string
  status: 'running' | 'ok' | 'warning' | 'error' | 'retry'
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
  /** Searchable text per record; every in-place text mutation invalidates it. */
  readonly #textCache = new WeakMap<TrajectoryRecord, string>()
  readonly #fieldCache = new WeakMap<TrajectoryRecord, readonly string[]>()
  #turn: number | null = null
  #step: number | null = null
  readonly #stepStarted = new Map<string, number>()
  readonly #stepFirstToken = new Map<string, number>()
  readonly #assistantByStep = new Map<string, number>()
  readonly #toolByCallId = new Map<string, number>()
  readonly #compactionById = new Map<string, number>()
  readonly #requestByStep = new Map<string, string>()
  readonly #schemas = new Map<string, string>()
  #version = 0

  constructor(events: readonly SessionEvent[] = []) {
    for (const event of events) this.append(event)
  }

  /** Lowercased searchable fields for one record (cached per record object). */
  normalizedFields(record: TrajectoryRecord): readonly string[] {
    const cached = this.#fieldCache.get(record)
    if (cached !== undefined) return cached
    const fields = [record.type, record.label, record.summary, record.payload, record.result, record.schema, record.thinking]
      .map(field => field.toLocaleLowerCase())
    this.#fieldCache.set(record, fields)
    return fields
  }

  /** Concatenated searchable text for one record (cached per record object). */
  searchText(record: TrajectoryRecord): string {
    const cached = this.#textCache.get(record)
    if (cached !== undefined) return cached
    const text = this.normalizedFields(record).join('\n')
    this.#textCache.set(record, text)
    return text
  }

  /** Whether one record's fields contain the lowercased query (per-field, no cross-field joins). */
  recordMatches(record: TrajectoryRecord, query: string): boolean {
    return this.normalizedFields(record).some(field => field.includes(query))
  }

  /**
   * Bumped by every mutation that can change a search result, so a derived
   * match list can be reused until the ledger actually moves.
   */
  get version(): number {
    return this.#version
  }

  /** Invalidate one record's cached search text after mutating its text fields. */
  #invalidateText(record: TrajectoryRecord): void {
    this.#textCache.delete(record)
    this.#fieldCache.delete(record)
    this.#version += 1
  }

  #push(record: Omit<TrajectoryRecord, 'index'>): number {
    const index = this.records.length
    this.records.push({ ...record, index: index + 1 })
    this.#version += 1
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
      name: '',
      summary,
      thinking: '',
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
    if (eventType === 'assistant/message') {
      const message = object(data['message'])
      const text = contentText(message?.['content'] ?? data['content'], 'text')
      const reasoning = contentText(message?.['content'] ?? data['content'], 'reasoning')
      const usage = object(message?.['usage'] ?? data['usage'])
      const startedAt = this.#stepStarted.get(key) ?? event.time
      const existing = this.#assistantByStep.get(key)
      // Format-v2 messages embed the exact timed stream; derive the first
      // visible token time from it instead of live chunk events.
      if (!this.#stepFirstToken.has(key)) {
        const streamData = data['stream']
        const firstTime = Array.isArray(streamData)
          ? firstVisibleStreamTime(streamData as unknown as AssistantStreamRecord[])
          : undefined
        if (firstTime !== undefined) this.#stepFirstToken.set(key, firstTime)
      }
      if (existing === undefined) {
        const record = this.#base(event, 'assistant', 'ASSISTANT', compact(text, 'Assistant response'), data)
        record.id = `assistant:${key}`
        record.payload = this.#requestByStep.get(key) ?? record.payload
        record.result = text
        record.thinking = reasoning
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
          this.#invalidateText(record)
          record.seq = event.seq
          record.summary = compact(text, record.summary)
          record.result = text
          record.thinking = reasoning
          record.status = data['interrupted'] === true ? 'error' : 'ok'
          record.durationMs = Math.max(0, event.time - startedAt)
          record.inputTokens = tokenValue(usage, 'inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens')
          record.outputTokens = tokenValue(usage, 'outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens')
        }
      }
      return
    }
    if (eventType === 'tool/call' || eventType === 'tool/ptc-dispatch-start') {
      const callId = string(data['callId']) ?? string(data['id']) ?? `${event.seq}`
      const parentCallId = string(data['parentCallId']) ?? string(data['parentId']) ?? null
      const name = string(data['name']) ?? string(data['toolName']) ?? 'tool'
      const args = data['arguments'] ?? data['input'] ?? data
      const record = this.#base(event, parentCallId === null ? 'tool' : 'subtool', name, `${name} ${compact(json(args), '')}`.trim(), data)
      record.id = `tool:${callId}`
      record.label = parentCallId === null ? 'TOOL' : 'SUBTOOL'
      record.name = name
      record.status = 'running'
      record.parentCallId = parentCallId
      record.schema = this.#schemas.get(name) ?? ''
      this.#toolByCallId.set(callId, this.#push(record))
      return
    }
    if (eventType === 'tool/result' || eventType === 'tool/ptc-dispatch') {
      const message = object(data['message'])
      const callId = string(message?.['callId']) ?? string(data['callId']) ?? string(data['id'])
      if (callId === undefined) return
      const index = this.#toolByCallId.get(callId)
      if (index === undefined) return
      const record = this.records[index]
      if (record === undefined) return
      this.#invalidateText(record)
      record.result = contentText(message?.['content'] ?? data['result'] ?? data['output']) || json(message ?? data)
      record.status = data['error'] === true || object(data['error']) !== undefined ? 'error' : 'ok'
      record.durationMs = record.startedAt === null ? null : Math.max(0, event.time - record.startedAt)
      return
    }
    if (eventType === 'deliverables/presented') {
      const files = Array.isArray(data['files']) ? data['files'] : []
      const paths = files
        .map(file => string(object(file)?.['path']))
        .filter((path): path is string => path !== undefined)
      const record = this.#base(
        event,
        'tool',
        'DELIVERABLE',
        paths.length === 0 ? 'Deliverables declared' : compact(paths.join(' · '), 'Deliverables declared'),
        data,
      )
      record.result = paths.join('\n')
      this.#push(record)
      return
    }
    if (eventType === 'subagent/catalog') {
      const label = string(data['label'])
      const childId = string(data['childId'])
      const mode = string(data['mode'])
      const record = this.#base(
        event,
        'tool',
        'SUBAGENT',
        compact(label ?? childId ?? '', 'Subagent catalogued'),
        data,
      )
      record.result = [childId, label, mode].filter((value): value is string => value !== undefined).join('\n')
      this.#push(record)
      return
    }
    if (eventType === 'llm/retry') {
      const record = this.#base(event, 'error', 'RETRY', compact(json(data), 'Model request retry'), data)
      record.status = 'retry'
      this.#push(record)
      return
    }
    if (eventType === 'compaction/start') {
      const id = string(data['compactionId']) ?? string(data['compactId']) ?? string(data['id']) ?? `${event.seq}`
      const record = this.#base(event, 'compaction', 'COMPACT', 'Compaction started', data)
      record.id = `compaction:${id}`
      record.status = 'running'
      this.#compactionById.set(id, this.#push(record))
      return
    }
    if (eventType === 'compaction/summary' || eventType === 'compaction/end') {
      const id = string(data['compactionId']) ?? string(data['compactId']) ?? string(data['id'])
      const index = id === undefined ? [...this.#compactionById.values()].at(-1) : this.#compactionById.get(id)
      if (index === undefined) return
      const record = this.records[index]
      if (record === undefined) return
      this.#invalidateText(record)
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
      const reasonKind = string(reason?.['kind'])
      if (reasonKind === undefined || reasonKind === 'completed') return
      const isError = reasonKind === 'error' || reasonKind === 'aborted'
      const summary = reasonKind === 'max-tokens'
        ? 'Output token limit reached'
        : reasonKind === 'blocked'
          ? 'Turn blocked'
          : reasonKind === 'interrupted'
            ? 'Session interrupted'
            : reasonKind === 'aborted'
              ? 'Turn aborted'
              : compact(json(reason), 'Turn failed')
      const record = this.#base(event, isError ? 'error' : 'warning', 'TURN', summary, data)
      record.status = isError ? 'error' : 'warning'
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
  /** Index into the derived match list, or null when not located on a match. */
  searchFocus: number | null
  /** Records appended since the last follow restoration (shown while detached). */
  followNotice: number
}

/** One search hit in one record field; derived, never stored. */
export interface SearchMatch {
  readonly record: TrajectoryRecord
  readonly field: 'type' | 'label' | 'summary' | 'payload' | 'result' | 'schema' | 'thinking'
  readonly offset: number
  readonly length: number
}

const SEARCH_FIELDS: readonly SearchMatch['field'][] = ['type', 'label', 'summary', 'payload', 'result', 'schema', 'thinking']

/** Stable target captured before a ledger mutation, restored afterward. */
export interface SearchTarget {
  readonly record: TrajectoryRecord
  readonly field: SearchMatch['field']
  readonly occurrence: number
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
    searchFocus: null,
    followNotice: 0,
  }
}

export function appendTrajectoryEvent(state: TrajectoryState, event: SessionEvent): TrajectoryState {
  const beforeCount = state.ledger.records.length
  const target = captureSearchTarget(state)
  state.ledger.append(event)
  const added = state.ledger.records.length - beforeCount
  let next: TrajectoryState = target === null ? state : restoreSearchTarget(state, target)
  if (added > 0 && !state.following) {
    const visibleIds = new Set(trajectoryVisibleRecords(next).map(record => record.id))
    const displayable = state.ledger.records.slice(beforeCount).filter(record => visibleIds.has(record.id)).length
    if (displayable > 0) next = { ...next, followNotice: next.followNotice + displayable }
  }
  if (next.following) {
    next = { ...next, selectedId: trajectoryVisibleRecords(next).at(-1)?.id ?? next.selectedId }
  }
  return next
}

/** Snapshot the located match before a mutation that can move or remove it. */
export function captureSearchTarget(state: TrajectoryState): SearchTarget | null {
  if (state.searchFocus === null) return null
  const match = trajectorySearch(state).matches[state.searchFocus]
  if (match === undefined) return null
  const occurrence = trajectorySearch(state).matches
    .slice(0, state.searchFocus)
    .filter(candidate => candidate.record === match.record && candidate.field === match.field).length
  return { record: match.record, field: match.field, occurrence }
}

/** Re-find the target after a mutation; clamp or clear when it disappeared. */
export function restoreSearchTarget(state: TrajectoryState, target: SearchTarget | null): TrajectoryState {
  if (target === null) return state
  const matches = trajectorySearch(state).matches
  if (matches.length === 0) return { ...state, searchFocus: null }
  let targetIndex = -1
  let occurrence = 0
  let fieldLast = -1
  let fieldCount = 0
  for (let index = 0; index < matches.length; index += 1) {
    const candidate = matches[index]
    if (candidate === undefined) continue
    if (candidate.record === target.record && candidate.field === target.field) {
      fieldLast = index
      fieldCount += 1
      if (occurrence === target.occurrence) { targetIndex = index; break }
      occurrence += 1
    }
  }
  // The field still matches: clamp within it (an occurrence may have shrunk).
  const index = targetIndex >= 0
    ? targetIndex
    : fieldCount > 0
      ? fieldLast >= 0 ? fieldLast : Math.max(0, Math.min(matches.length - 1, state.searchFocus ?? 0))
      : Math.max(0, Math.min(matches.length - 1, state.searchFocus ?? 0))
  const match = matches[index]
  if (match === undefined) return { ...state, searchFocus: null }
  return { ...state, searchFocus: index, selectedId: match.record.id }
}

/** Whether a record is a tool call, shown or hidden by the calls fold. */
function isCall(record: TrajectoryRecord): boolean {
  return record.kind === 'tool' || record.kind === 'subtool'
}

export function trajectoryVisibleRecords(state: TrajectoryState): TrajectoryRecord[] {
  const query = state.query.trim().toLocaleLowerCase()
  const firstInCollapsed = new Set<number>()
  return state.ledger.records.filter((record) => {
    if (state.callsCollapsed && isCall(record)) return false
    if (record.turn !== null && state.collapsedTurns.has(record.turn)) {
      if (firstInCollapsed.has(record.turn)) return false
      firstInCollapsed.add(record.turn)
    }
    if (query === '') return true
    return state.ledger.recordMatches(record, query)
  })
}

/** Totals for one turn, counted over the whole ledger rather than the visible rows. */
interface TrajectoryTurnStats {
  turn: number | null
  steps: number
  errors: number
  warnings: number
  spanMs: number | null
}

interface TurnStatsCacheEntry {
  readonly version: number
  readonly stats: ReadonlyMap<string, TrajectoryTurnStats>
  /** Tool names and counts per step, keyed `${turnKey}:${step}`. */
  readonly calls: ReadonlyMap<string, readonly (readonly [string, number])[]>
}

/**
 * One pass over the ledger for everything a frame needs to describe structure:
 * turn totals and per-step call histograms.
 *
 * A folded turn still has to state how much it folded, and the calls fold has to
 * say what it hid, so both come from every record rather than from the rows that
 * survived folding. Deriving them per render would walk a 10,000-record ledger
 * several times per keystroke; the ledger already counts its own mutations, so
 * one pass lasts until it moves.
 */
const turnStatsCache = new WeakMap<TrajectoryLedger, TurnStatsCacheEntry>()

function trajectoryIndex(ledger: TrajectoryLedger): TurnStatsCacheEntry {
  const cached = turnStatsCache.get(ledger)
  if (cached !== undefined && cached.version === ledger.version) return cached
  const spans = new Map<string, { turn: number | null; steps: Set<number>; errors: number; warnings: number; earliest: number; latest: number }>()
  const calls = new Map<string, Map<string, number>>()
  for (const record of ledger.records) {
    const key = record.turn === null ? 'between' : String(record.turn)
    let entry = spans.get(key)
    if (entry === undefined) {
      entry = { turn: record.turn, steps: new Set(), errors: 0, warnings: 0, earliest: Number.POSITIVE_INFINITY, latest: Number.NEGATIVE_INFINITY }
      spans.set(key, entry)
    }
    if (record.step !== null) entry.steps.add(record.step)
    if (record.status === 'error') entry.errors += 1
    if (record.status === 'warning') entry.warnings += 1
    if (record.startedAt !== null) {
      entry.earliest = Math.min(entry.earliest, record.startedAt)
      // A running record has no end yet. Counting its start as its end keeps the
      // span from inventing elapsed time the ledger never recorded.
      entry.latest = Math.max(entry.latest, record.startedAt + (record.durationMs ?? 0))
    }
    if (!isCall(record)) continue
    const callKey = `${key}:${record.step ?? 'none'}`
    const counts = calls.get(callKey) ?? new Map<string, number>()
    const name = record.summary.split(/\s/u)[0] ?? record.label
    counts.set(name, (counts.get(name) ?? 0) + 1)
    calls.set(callKey, counts)
  }
  const stats = new Map<string, TrajectoryTurnStats>()
  for (const [key, entry] of spans) {
    stats.set(key, {
      turn: entry.turn,
      steps: entry.steps.size,
      errors: entry.errors,
      warnings: entry.warnings,
      spanMs: entry.latest > entry.earliest ? entry.latest - entry.earliest : null,
    })
  }
  const entry: TurnStatsCacheEntry = {
    version: ledger.version,
    stats,
    calls: new Map([...calls].map(([key, counts]) => [key, [...counts]])),
  }
  turnStatsCache.set(ledger, entry)
  return entry
}

/** One rendered list row: a turn rule, a step group, or a record. */
type TrajectoryRow =
  | { kind: 'turn'; id: string; stats: TrajectoryTurnStats; collapsed: boolean }
  | { kind: 'step'; id: string; step: number; hiddenCalls: readonly (readonly [string, number])[] }
  | { kind: 'record'; id: string; record: TrajectoryRecord }

/**
 * The ledger as three levels, the shape the desktop client settled on.
 *
 * A turn is the question, a step is one model request and the calls it made, and
 * a record is one event. The flat list this replaced gave a user message and a
 * tool result the same weight, so answering "which step took sixteen minutes"
 * meant reading a location column on every row and adding durations up by hand.
 * Step headers also give the calls fold somewhere to report what it hid, which is
 * why the histogram comes from the whole ledger and not from the visible rows.
 */
function trajectoryRows(state: TrajectoryState): TrajectoryRow[] {
  const index = trajectoryIndex(state.ledger)
  const rows: TrajectoryRow[] = []
  const buckets: { turn: number | null; records: TrajectoryRecord[] }[] = []
  for (const record of trajectoryVisibleRecords(state)) {
    const last = buckets.at(-1)
    if (last !== undefined && last.turn === record.turn) last.records.push(record)
    else buckets.push({ turn: record.turn, records: [record] })
  }
  for (const bucket of buckets) {
    const key = bucket.turn === null ? 'between' : String(bucket.turn)
    rows.push({
      kind: 'turn',
      id: `turn:${key}`,
      stats: index.stats.get(key) ?? { turn: bucket.turn, steps: 0, errors: 0, warnings: 0, spanMs: null },
      collapsed: bucket.turn !== null && state.collapsedTurns.has(bucket.turn),
    })
    let step: number | null | undefined
    let group: TrajectoryRecord[] = []
    const flush = (): void => {
      if (group.length === 0) return
      if (step !== null && step !== undefined) {
        rows.push({
          kind: 'step',
          id: `step:${key}:${step}`,
          step,
          hiddenCalls: state.callsCollapsed ? index.calls.get(`${key}:${step}`) ?? [] : [],
        })
      }
      for (const record of group) rows.push({ kind: 'record', id: record.id, record })
      group = []
    }
    for (const record of bucket.records) {
      if (record.step !== step) {
        flush()
        step = record.step
      }
      group.push(record)
    }
    flush()
  }
  return rows
}

/** Derived search result: matches in ledger order plus per-record hit counts. */
export interface TrajectorySearchResult {
  readonly matches: readonly SearchMatch[]
  readonly counts: ReadonlyMap<string, number>
}

interface SearchCacheEntry {
  readonly version: number
  readonly query: string
  readonly result: TrajectorySearchResult
}

/** Shared result for the empty query, which matches nothing by definition. */
const EMPTY_SEARCH: TrajectorySearchResult = { matches: [], counts: new Map() }

/**
 * Cached by ledger identity, so an entry dies with its ledger, and validated by
 * the ledger's mutation version plus the normalized query. Both navigation and
 * every rendered frame derive the match list, and on a 10,000-record session a
 * single derivation measured 18 ms: without this, `/` search costs two
 * derivations per keystroke and two more per frame.
 */
const searchCache = new WeakMap<TrajectoryLedger, SearchCacheEntry>()

/** Full-ledger search: matches and per-record counts, reused until the ledger or query moves. */
export function trajectorySearch(state: TrajectoryState): TrajectorySearchResult {
  const query = state.query.trim().toLocaleLowerCase()
  if (query === '') return EMPTY_SEARCH
  const cached = searchCache.get(state.ledger)
  if (cached !== undefined && cached.version === state.ledger.version && cached.query === query) return cached.result
  const matches: SearchMatch[] = []
  const counts = new Map<string, number>()
  for (const record of state.ledger.records) {
    const lowerFields = state.ledger.normalizedFields(record)
    let total = 0
    for (let fieldIndex = 0; fieldIndex < SEARCH_FIELDS.length; fieldIndex += 1) {
      const field = SEARCH_FIELDS[fieldIndex]
      if (field === undefined) continue
      const lower = lowerFields[fieldIndex] ?? ''
      if (lower === '') continue
      const original = record[field]
      // Case folding can expand code points (e.g. U+0130); only then are the
      // lowercase offsets valid against the original text.
      const offsetsExact = Array.from(lower).length === Array.from(original).length
      if (!offsetsExact) {
        if (lower.includes(query)) {
          matches.push({ record, field, offset: 0, length: original.length })
          total += 1
        }
        continue
      }
      let from = 0
      for (;;) {
        const at = lower.indexOf(query, from)
        if (at < 0) break
        matches.push({ record, field, offset: at, length: query.length })
        total += 1
        from = at + Math.max(1, query.length)
      }
    }
    if (total > 0) counts.set(record.id, total)
  }
  const result: TrajectorySearchResult = { matches, counts }
  searchCache.set(state.ledger, { version: state.ledger.version, query, result })
  return result
}

/** Locate one match: expand its turn/subtool and select the carrying record. */
function locateMatch(state: TrajectoryState, index: number): TrajectoryState {
  const match = trajectorySearch(state).matches[index]
  if (match === undefined) return state
  const record = match.record
  let collapsedTurns = state.collapsedTurns
  if (record.turn !== null && collapsedTurns.has(record.turn)) {
    const next = new Set(collapsedTurns)
    next.delete(record.turn)
    collapsedTurns = next
  }
  return {
    ...state,
    searchFocus: index,
    selectedId: record.id,
    collapsedTurns,
    callsCollapsed: state.callsCollapsed && !isCall(record),
    detailScroll: 0,
    following: false,
  }
}

function moveMatch(state: TrajectoryState, delta: number): TrajectoryState {
  const matches = trajectorySearch(state).matches
  if (matches.length === 0) return state
  const current = state.searchFocus
  const next = current === null
    ? delta > 0 ? 0 : matches.length - 1
    : (current + delta + matches.length) % matches.length
  return locateMatch(state, next)
}

export type TrajectoryCommand = { state: TrajectoryState } | { close: true }

function move(state: TrajectoryState, delta: number): TrajectoryState {
  const visible = trajectoryVisibleRecords(state)
  if (visible.length === 0) return state
  const current = Math.max(0, visible.findIndex(record => record.id === state.selectedId))
  const index = Math.max(0, Math.min(visible.length - 1, current + delta))
  const following = index === visible.length - 1
  return {
    ...state,
    selectedId: visible[index]?.id ?? null,
    detailScroll: 0,
    following,
    ...(following ? { followNotice: 0 } : {}),
  }
}

let trajectorySegmenter: Intl.Segmenter | undefined

function graphemes(text: string): Iterable<{ index: number; segment: string }> {
  trajectorySegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return trajectorySegmenter.segment(text)
}

/**
 * Tabs a record can actually fill.
 *
 * The tabs used to be fixed, so most records offered four that said "No payload
 * recorded." and the reader pressed `Tab` through them to find the one with
 * content. The desktop client instead asks each record which sections it has,
 * which is also why its tab row never shows a dead one. Timing was a section of
 * its own until it became clear that the numbers a reader wants first belong in
 * the summary, beside the record's identity.
 */
function detailTabsFor(record: TrajectoryRecord | undefined): readonly TrajectoryDetailTab[] {
  if (record === undefined) return ['summary']
  const tabs: TrajectoryDetailTab[] = ['summary']
  if (record.payload !== '') tabs.push('payload')
  if (record.result !== '') tabs.push('result')
  if (record.schema !== '') tabs.push('schema')
  return tabs
}

/**
 * The tab the pane is actually showing.
 *
 * The state keeps the reader's last choice, so returning to a record brings the
 * same section back; a record without that section falls back to its first one
 * instead of printing an empty placeholder.
 */
function activeTab(state: TrajectoryState): TrajectoryDetailTab {
  const tabs = detailTabsFor(selectedRecord(state))
  return tabs.includes(state.detailTab) ? state.detailTab : tabs[0] ?? 'summary'
}

function moveTab(state: TrajectoryState, delta: number): TrajectoryState {
  const tabs = detailTabsFor(selectedRecord(state))
  const current = Math.max(0, tabs.indexOf(activeTab(state)))
  const next = (current + delta + tabs.length) % tabs.length
  return { ...state, detailTab: tabs[next] ?? 'summary', detailScroll: 0 }
}

export interface TrajectoryViewOptions {
  /** List navigation page size in records; 0 means no-op at tiny heights. */
  pageSize?: number
  /** Detail-page scroll step in wrapped lines. */
  detailPageLines?: number
}

const DEFAULT_PAGE_SIZE = 10
const DEFAULT_DETAIL_PAGE_LINES = 10

export function applyTrajectoryEvent(
  state: TrajectoryState,
  event: KeyEvent,
  options: TrajectoryViewOptions = {},
): TrajectoryCommand {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const detailPageLines = options.detailPageLines ?? DEFAULT_DETAIL_PAGE_LINES
  if (state.searching) {
    // Editing state: every printable character (including / n N c t) is a
    // literal query character; navigation uses control keys only.
    if (event.type === 'text') {
      return { state: { ...state, query: state.query + event.value, searchFocus: null, following: false } }
    }
    if (event.type !== 'key') return { state }
    if (event.id === 'backspace') {
      const start = moveGraphemeLeft(state.query, state.query.length)
      return { state: { ...state, query: state.query.slice(0, start), searchFocus: null } }
    }
    if (event.id === 'ctrl+n') return { state: moveMatch(state, 1) }
    if (event.id === 'ctrl+p') return { state: moveMatch(state, -1) }
    if (event.id === 'enter') {
      const located = locateMatch(state, state.searchFocus ?? 0)
      return { state: { ...located, searching: false } }
    }
    if (event.id === 'escape' || event.id === 'ctrl+c') return { state: { ...state, searching: false } }
    return { state }
  }
  if (event.type === 'text') {
    const lower = event.value.toLowerCase()
    if (event.value === '/' && state.query === '') {
      return { state: { ...state, searching: true, following: false } }
    }
    if (event.value === '/' && state.query !== '') {
      // Result state: '/' re-enters editing without inserting.
      return { state: { ...state, searching: true, following: false } }
    }
    if (lower === 'n' && state.query !== '') return { state: moveMatch(state, event.value === 'N' ? -1 : 1) }
    if (lower === 'c') return { state: { ...state, callsCollapsed: !state.callsCollapsed } }
    if (lower === 't') {
      const selected = state.ledger.records.find(record => record.id === state.selectedId)
      if (selected?.turn === null || selected?.turn === undefined) return { state }
      const collapsed = new Set(state.collapsedTurns)
      if (collapsed.has(selected.turn)) collapsed.delete(selected.turn)
      else collapsed.add(selected.turn)
      const first = state.ledger.records.find(record => record.turn === selected.turn)
      return { state: { ...state, collapsedTurns: collapsed, selectedId: first?.id ?? state.selectedId } }
    }
    if (state.query !== '') {
      // Any other printable character in the result state starts a new query.
      return { state: { ...state, query: event.value, searching: true, following: false, searchFocus: null } }
    }
    return { state }
  }
  /**
   * A wheel gesture scrolls whatever the reader is reading.
   *
   * The view received wheel events already but ignored everything that was not a
   * key, so a mouse reader found the only way to scroll the detail pane was
   * `PgUp`/`PgDn` — while the wheel silently did nothing at all. It now scrolls
   * the detail when one is open and moves the selection otherwise, which is what
   * the same gesture does in the transcript.
   */
  if (event.type === 'wheel') {
    const step = Math.max(1, Math.round(detailPageLines / 2))
    if (state.details) {
      const delta = event.direction === 'up' ? -step : step
      return { state: { ...state, detailScroll: Math.max(0, state.detailScroll + delta) } }
    }
    return { state: move(state, (event.direction === 'up' ? -1 : 1) * 3) }
  }
  if (event.type !== 'key') return { state }
  // This ledger keeps three keys that the shared reading would move through a
  // list: `tab` switches the detail tab, `pageUp`/`pageDown` scroll an open
  // detail pane, and `home`/`end` carry following state. They are read first, so
  // the shared reading below only ever answers for the keys this surface really
  // shares — up, down, and closing one layer.
  if (event.id === 'tab' || event.id === 'right') return { state: moveTab(state, 1) }
  if (event.id === 'shift+tab' || event.id === 'left') return { state: moveTab(state, -1) }
  /**
   * With the detail pane open, the arrows belong to it.
   *
   * They used to move the record selection even then, so a reader scrolling a long
   * payload changed which record the pane described instead of scrolling: the
   * content jumped out from under them and the pane snapped back to the top of a
   * different record. `Tab` still switches tabs and `Esc` still closes the pane,
   * so nothing is lost — the selection simply stops competing with the text.
   */
  if (state.details && (event.id === 'up' || event.id === 'down')) {
    const delta = event.id === 'up' ? -1 : 1
    return { state: { ...state, detailScroll: Math.max(0, state.detailScroll + delta) } }
  }
  const navigation = listNavigation(event)
  if (navigation.kind === 'close') {
    // One layer per press: an open detail panel closes before the ledger does.
    if (state.details) return { state: { ...state, details: false, detailScroll: 0 } }
    return { close: true }
  }
  if (navigation.kind === 'move') return { state: move(state, navigation.delta) }
  if (event.id === 'pageUp') {
    if (state.details) return { state: { ...state, detailScroll: Math.max(0, state.detailScroll - detailPageLines) } }
    if (pageSize === 0) return { state }
    return { state: move(state, -pageSize) }
  }
  if (event.id === 'pageDown') {
    if (state.details) return { state: { ...state, detailScroll: state.detailScroll + detailPageLines } }
    if (pageSize === 0) return { state }
    return { state: move(state, pageSize) }
  }
  if (event.id === 'home') {
    const first = trajectoryVisibleRecords(state)[0]
    return { state: { ...state, selectedId: first?.id ?? null, following: false } }
  }
  if (event.id === 'end') {
    const last = trajectoryVisibleRecords(state).at(-1)
    return { state: { ...state, selectedId: last?.id ?? null, following: true, followNotice: 0 } }
  }
  if (event.id === 'enter') return { state: { ...state, details: !state.details, detailScroll: 0 } }
  return { state }
}

// Every key `applyTrajectoryEvent` accepts. Rows whose first word is the footer
// label are also printed by the overlay's toolbar and footer.
const HOTKEY_NAVIGATE: HotkeyRow = { keys: '↑↓', action: 'Navigate records, or scroll an open detail' }
const HOTKEY_EDGE: HotkeyRow = { keys: 'Home / End', action: 'Jump to the first record, or follow the newest' }
const HOTKEY_PAGE: HotkeyRow = { keys: '↑↓ / PgUp / PgDn', action: 'Scroll the open detail, or page the record list' }
const HOTKEY_DETAILS: HotkeyRow = { keys: 'Enter', action: 'Details — open or close the detail panel' }
const HOTKEY_SECTION: HotkeyRow = { keys: 'Tab / ←→', action: 'Section — switch the detail tab' }
const HOTKEY_SEARCH: HotkeyRow = { keys: '/', action: 'Search the ledger' }
const HOTKEY_MATCH: HotkeyRow = { keys: 'n/N', action: 'Match — step to the next or previous hit' }
const HOTKEY_MATCH_EDIT: HotkeyRow = { keys: 'Ctrl+N / Ctrl+P', action: 'Match while typing — step to the next or previous hit' }
const HOTKEY_TURN: HotkeyRow = { keys: 't', action: 'Turn — collapse or expand the selected turn' }
const HOTKEY_CALLS: HotkeyRow = { keys: 'c', action: 'Calls — collapse or expand tool-call rows' }
const HOTKEY_QUERY: HotkeyRow = { keys: 'Text', action: 'Query — type the search text' }
const HOTKEY_BACKSPACE: HotkeyRow = { keys: 'Backspace', action: 'Delete — remove the last query character' }
const HOTKEY_CLOSE: HotkeyRow = { keys: 'Esc / Ctrl+C', action: 'Close — leave the detail panel, or the ledger' }

/** Keys the trajectory ledger accepts; `/help` and its toolbar and footer read this list. */
export const TRAJECTORY_HOTKEYS: readonly HotkeyRow[] = [
  HOTKEY_NAVIGATE,
  HOTKEY_EDGE,
  HOTKEY_PAGE,
  HOTKEY_DETAILS,
  HOTKEY_SECTION,
  HOTKEY_SEARCH,
  HOTKEY_MATCH,
  HOTKEY_MATCH_EDIT,
  HOTKEY_TURN,
  HOTKEY_CALLS,
  HOTKEY_QUERY,
  HOTKEY_BACKSPACE,
  HOTKEY_CLOSE,
]

/**
 * Rows the timing overview occupies, or 0 when it is not drawn.
 *
 * Rendering and paging both need this: the overview sits between the toolbar and
 * the ledger, so a page that ignored it would scroll three rows further than the
 * frame can show.
 */
export function trajectoryOverviewHeight(state: TrajectoryState, width = Number.POSITIVE_INFINITY): number {
  if (state.details || state.query !== '') return 0
  if (width < 24) return 0
  let steps = 0
  for (const stats of trajectoryIndex(state.ledger).stats.values()) steps += stats.steps
  if (steps < 2) return 0
  const overview = trajectoryTimeline(state.ledger.records, { width: 1 })
  return overview === undefined ? 0 : overview.lanes.filter(span => span.ms > 0).length
}

/** List paging capacity in records for one body height (pure, shared with rendering). */
export function trajectoryListMetrics(state: TrajectoryState, height: number, width = Number.POSITIVE_INFINITY): { pageSize: number } {
  const body = Math.max(0, height - 4 - trajectoryOverviewHeight(state, width))
  if (body <= 0) return { pageSize: 0 }
  const rows = trajectoryRows(state)
  if (rows.length === 0) return { pageSize: 1 }
  const selected = rows.findIndex(row => row.kind === 'record' && row.id === state.selectedId)
  const start = Math.max(0, Math.min(rows.length - 1, Math.max(0, selected) - Math.floor(body / 2)))
  // Count record rows inside the window; turn and step headers only occupy space.
  let count = 0
  for (let index = start; index < rows.length && index - start < body; index += 1) {
    if (rows[index]?.kind === 'record') count += 1
  }
  return { pageSize: Math.max(1, count) }
}

/** Detail scroll step in wrapped lines for one body height (pure, shared with rendering). */
export function trajectoryDetailMetrics(_state: TrajectoryState, height: number): { pageLines: number } {
  // The frame spends four rows on its own chrome and the pane three on its title,
  // its sections and the gap between them.
  const body = Math.max(0, height - 4)
  const viewport = Math.max(0, body - 3)
  return { pageLines: Math.max(1, viewport) }
}

function duration(record: TrajectoryRecord): string {
  if (record.durationMs === null) return record.status === 'running' ? 'live' : '—'
  return formatDuration(record.durationMs)
}

/** `12.4K→812` for a model request, or '' for a record that reported no usage. */
function tokenPair(record: TrajectoryRecord): string {
  if (record.kind !== 'assistant') return ''
  if (record.inputTokens === null && record.outputTokens === null) return ''
  const side = (value: number | null): string => value === null ? '—' : formatTokens(value)
  // The incoming side is padded so the arrow, and therefore the duration column
  // beside it, stays on one column across every request in the ledger.
  return `${side(record.inputTokens).padStart(6)}→${side(record.outputTokens)}`
}

function kindColor(kind: TrajectoryKind): 'accent' | 'warning' | 'success' | 'error' | 'dim' | 'text' {
  if (kind === 'user') return 'accent'
  if (kind === 'assistant') return 'text'
  if (kind === 'tool' || kind === 'subtool') return 'success'
  if (kind === 'error') return 'error'
  if (kind === 'compaction' || kind === 'warning') return 'warning'
  return 'dim'
}

function highlightSummary(summary: string, spans: readonly SearchMatch[], theme?: Theme): string {
  if (spans.length === 0) return summary
  if (theme?.colors === false) return summary
  // Spans live on summary text (offsets from the derived search); decorations
  // are inserted before width truncation and survive splitAnsi.
  let out = ''
  let cursor = 0
  for (const span of spans) {
    if (span.offset < cursor) continue
    out += summary.slice(cursor, span.offset)
    out += '\x1b[7m' + summary.slice(span.offset, span.offset + span.length) + '\x1b[27m'
    cursor = span.offset + span.length
  }
  return out + summary.slice(cursor)
}

function recordLine(
  record: TrajectoryRecord,
  selected: boolean,
  theme: Theme,
  width: number,
  highlightSpans: readonly SearchMatch[],
  matchCount: number | undefined,
  summaryOverride?: string,
): string {
  const marker = selected ? theme.fg('accent', '›') : ' '
  /*
   * No location column: the turn rule and the step header above already say
   * where this row is, and `T1·1` on every line spent five cells restating it in
   * a form nobody reads. The right edge instead carries what the row cost:
   * tokens for a model request, duration for everything.
   */
  const prefix = `${marker} ${theme.fg('dim', `#${String(record.index).padStart(3)}`)}  ${theme.fg(kindColor(record.kind), record.label.padEnd(9).slice(0, 9))}  `
  const badge = matchCount === undefined ? '' : ` ${theme.fg('dim', `×${matchCount}`)}`
  // A record with no recorded duration prints nothing rather than an em dash:
  // a column of `—` where most rows have a time reads as missing data, when in
  // fact a user message simply never had a duration.
  const elapsed = record.durationMs === null && record.status !== 'running' ? '' : duration(record)
  const tokens = tokenPair(record)
  const right = (withTokens: boolean): string => withTokens ? `${tokens}  ${elapsed}` : elapsed
  const fixed = visibleWidth(prefix) + visibleWidth(badge)
  // Tokens are the first thing to go: the pane still has them, and the duration
  // is the reason this view exists.
  const columns = tokens === '' || width - fixed - visibleWidth(right(true)) - 12 < 0 ? right(false) : right(true)
  const body = summaryOverride ?? highlightSummary(record.summary, highlightSpans)
  const bodyWidth = Math.max(0, width - fixed - visibleWidth(columns) - 2)
  const text = truncateToWidth(body, bodyWidth)
  const gap = Math.max(1, width - fixed - visibleWidth(text) - visibleWidth(columns))
  return prefix + text + ' '.repeat(Math.max(0, gap)) + columns + badge
}

/** Snippet of one record field around its first hit (non-summary fields). */
function fieldSnippet(
  record: TrajectoryRecord,
  field: SearchMatch['field'],
  highlightSpans: readonly SearchMatch[],
  width: number,
  theme: Theme,
  focused?: SearchMatch,
): string {
  const text = record[field]
  if (text === '') return highlightSummary(record.summary, highlightSpans, theme)
  const span = focused ?? highlightSpans.find(match => match.field === field)
  if (span === undefined) return highlightSummary(record.summary, highlightSpans, theme)
  if (field === 'summary') return highlightSummary(text, highlightSpans, theme)
  const from = graphemeStart(text, Math.max(0, span.offset - 16))
  const to = moveGraphemeRight(text, Math.min(text.length, span.offset + span.length + 24))
  const snippet = text.slice(from, to).replaceAll('\n', ' ')
  const shifted = highlightSummary(snippet, [{ ...span, offset: span.offset - from }], theme)
  return `${field}: ${truncateToWidth(shifted, width)}`
}

/** Start index of the grapheme containing or preceding `cursor`. */
function graphemeStart(text: string, cursor: number): number {
  let last = 0
  for (const part of graphemes(text)) {
    if (part.index >= cursor) return last
    last = part.index
  }
  return last
}

function selectedRecord(state: TrajectoryState): TrajectoryRecord | undefined {
  return state.ledger.records.find(record => record.id === state.selectedId)
}

/**
 * How a detail section should be drawn.
 *
 * Not every section is source. The pane used to print every section as code —
 * a line-number gutter down prose, syntax colouring over a three-word status —
 * which is why nothing in it read as written language. A section says which of
 * the three shapes it is and the pane draws it that way.
 */
type DetailSection =
  | { kind: 'fields'; rows: readonly DetailField[] }
  | { kind: 'prose'; text: string }
  | { kind: 'code'; text: string; language: string | undefined }

interface DetailField {
  readonly label: string
  readonly value: string
  /** Prose values wrap; a label value is one line and never does. */
  readonly wrap?: boolean
}

/** Clock time, which is what a reader compares against a log line. */
function clockTime(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * Label/value pairs for one record, omitting what it does not have.
 *
 * The title already states where the record sits and how long it took, so this
 * block does not repeat either: it answers what the record is, when it happened,
 * and what it cost the model.
 */
function summaryFields(record: TrajectoryRecord): DetailField[] {
  const rows: DetailField[] = []
  rows.push({ label: 'Event', value: `${record.type} · #${record.seq}` })
  if (record.startedAt !== null) rows.push({ label: 'Started', value: clockTime(record.startedAt) })
  if (record.ttftMs !== null) rows.push({ label: 'First token', value: formatDuration(record.ttftMs) })
  if (record.inputTokens !== null || record.outputTokens !== null) {
    const side = (value: number | null): string => value === null ? '—' : formatTokens(value)
    rows.push({ label: 'Tokens', value: `${side(record.inputTokens)} in · ${side(record.outputTokens)} out` })
  }
  // `ok` on every record is the kind of field that teaches nothing; the ones
  // worth a line are the ones that went wrong.
  if (record.status !== 'ok') rows.push({ label: 'Status', value: record.status })
  return rows
}

/** The assistant's reasoning and answer are two pieces of writing, not one blob. */
function assistantWriting(record: TrajectoryRecord, theme: Theme, width: number): string[] {
  const out: string[] = []
  if (record.thinking !== '') {
    out.push(theme.fg('dim', 'Thinking'), ...renderMarkdown(record.thinking, theme, width))
    if (record.result !== '') out.push('', theme.fg('dim', 'Answer'))
  }
  if (record.result !== '') out.push(...renderMarkdown(record.result, theme, width))
  return out
}

function detailSection(tab: TrajectoryDetailTab, record: TrajectoryRecord | undefined): DetailSection {
  if (record === undefined) return { kind: 'prose', text: 'No trajectory record selected.' }
  if (tab === 'summary') return { kind: 'fields', rows: summaryFields(record) }
  if (tab === 'payload') return { kind: 'code', text: record.payload, language: 'json' }
  if (tab === 'schema') return { kind: 'code', text: record.schema, language: 'json' }
  // A model's answer is prose; a tool's output is whatever the tool spoke.
  const spoken = record.kind === 'assistant' || record.kind === 'compaction'
  if (spoken) return { kind: 'prose', text: record.result }
  return {
    kind: 'code',
    text: record.result,
    language: toolPayloadLanguage(record.type === 'tool/call' ? record.label.toLowerCase() : ''),
  }
}

function ledgerRows(state: TrajectoryState, theme: Theme, width: number, height: number): string[] {
  const rows = trajectoryRows(state)
  if (!rows.some(row => row.kind === 'record')) {
    return [theme.fg('dim', state.query === '' ? '  No trajectory records.' : '  No matching trajectory records.')]
  }
  const { matches, counts } = trajectorySearch(state)
  const focused = state.searchFocus === null ? undefined : matches[state.searchFocus]
  const highlighted = new Map<string, SearchMatch[]>()
  for (const match of matches) {
    const list = highlighted.get(match.record.id) ?? []
    list.push(match)
    highlighted.set(match.record.id, list)
  }
  const lines = rows.map((row): string => {
    if (row.kind === 'turn') return turnLine(row.stats, row.collapsed, theme, width)
    if (row.kind === 'step') return stepLine(row.step, row.hiddenCalls, theme, width)
    const record = row.record
    const recordMatches = highlighted.get(record.id) ?? []
    const focusedForRecord = focused?.record === record ? focused : undefined
    const headField = focusedForRecord !== undefined ? focusedForRecord.field : recordMatches[0]?.field
    const headSpans = recordMatches.filter(match => match.field === headField)
    const summary = headField === undefined || headField === 'summary'
      ? highlightSummary(record.summary, headSpans, theme)
      : fieldSnippet(record, headField, headSpans, Math.max(0, width - 24), theme, focusedForRecord)
    return recordLine(record, record.id === state.selectedId, theme, width,
      headField === 'summary' ? headSpans : [],
      state.query === '' ? undefined : counts.get(record.id),
      summary,
    )
  })
  const selectedIndex = Math.max(0, rows.findIndex(row => row.kind === 'record' && row.id === state.selectedId))
  const start = Math.max(0, Math.min(rows.length - 1, selectedIndex - Math.floor(height / 2)))
  return lines.slice(start, start + height).map(line => truncateToWidth(line, width))
}

/**
 * The detail pane.
 *
 * Two rows of header — the record's identity and its section names — then the
 * section itself. Position and scroll hint ride on the section row rather than
 * taking a line of their own, and the sections are separated from the content by
 * whitespace instead of a rule, because in the split view a rule would sit one
 * column from the pane's own border.
 */
function detailRows(state: TrajectoryState, theme: Theme, width: number, height: number): string[] {
  const record = selectedRecord(state)
  const tab = activeTab(state)
  const tabs = detailTabsFor(record)
  const section = detailSection(tab, record)
  const inner = Math.max(1, width - 2)
  const body = section.kind === 'fields'
    ? summaryBlock(section.rows, record, theme, inner)
    : section.kind === 'prose'
      ? (record !== undefined && record.kind === 'assistant' && tab === 'result'
        ? assistantWriting(record, theme, inner)
        : renderMarkdown(section.text, theme, inner))
      : codeRows(section.text, section.language, theme, inner)
  const viewport = Math.max(0, height - 3)
  const maxScroll = Math.max(0, body.length - viewport)
  const start = Math.min(state.detailScroll, maxScroll)
  const end = Math.min(body.length, start + viewport)
  const first = truncateToWidth(titleLine(record, theme, width), width)
  /*
   * The active section is marked, not only coloured. Every style helper is a
   * no-op when the terminal has no colour, so colour alone would leave a reader
   * on such a terminal unable to tell which section they are looking at. `›` is
   * the same "this one" the ledger uses for its selected row.
   */
  const tabsText = tabs.map(candidate => candidate === tab
    ? theme.bold(theme.fg('accent', `› ${candidate}`))
    : theme.fg('dim', `  ${candidate}`)).join('  ')
  const position = body.length > viewport ? theme.fg('dim', `${start + 1}-${end} / ${body.length}`) : ''
  const gap = Math.max(1, width - visibleWidth(tabsText) - visibleWidth(position))
  const second = truncateToWidth(tabsText + ' '.repeat(gap) + position, width)
  return [first, second, '', ...body.slice(start, end).map(line => truncateToWidth(' ' + line, width))]
}

/** `#3  TOOL` — which record this pane is about, and what it cost. */
function titleLine(record: TrajectoryRecord | undefined, theme: Theme, width: number): string {
  if (record === undefined) return ''
  const where = record.turn === null ? 'Between turns' : `Turn ${record.turn}`
  const place = record.step === null ? where : `${where} · Step ${record.step}`
  const called = record.name === '' ? '' : theme.fg('text', ` ${record.name}`)
  const left = theme.bold(`#${record.index} ${record.label}`) + called + theme.fg('dim', `  ${place}`)
  const right = record.durationMs === null ? '' : theme.fg('dim', duration(record))
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right))
  return left + ' '.repeat(gap) + right
}

/**
 * The facts, then the record's own text when no other section holds it.
 *
 * A record whose text has a section of its own — an answer in `result`, a call in
 * `payload` — would only see that text flattened into one row here, which is what
 * made the pane read as a wall of code. A record with nowhere else to put it (a
 * turn that failed, a message the user sent) gets it as writing, below the facts.
 */
function summaryBlock(rows: readonly DetailField[], record: TrajectoryRecord | undefined, theme: Theme, width: number): string[] {
  const facts = fieldRows(rows, theme, width)
  if (record === undefined || record.result !== '' || record.summary === '') return facts
  return [...facts, '', ...renderMarkdown(record.summary, theme, width)]
}

/** Label/value rows with the label column as wide as the widest label needs. */
function fieldRows(rows: readonly DetailField[], theme: Theme, width: number): string[] {
  const labelWidth = Math.max(...rows.map(field => field.label.length))
  const out: string[] = []
  for (const field of rows) {
    const room = Math.max(1, width - labelWidth - 2)
    const wrapped = field.wrap === true ? wrapText(field.value, room) : [truncateToWidth(field.value, room)]
    out.push(theme.fg('dim', field.label.padEnd(labelWidth)) + '  ' + (wrapped[0] ?? ''))
    // A long value continues under itself rather than under its label.
    for (const line of wrapped.slice(1)) out.push(' '.repeat(labelWidth + 2) + line)
  }
  return out
}

/**
 * Code, numbered only once it wraps.
 *
 * The gutter used to number every wrapped row, so a JSON line spread over four
 * rows read as four source lines and nothing lined up. Numbers now belong to
 * source lines, a wrapped continuation leaves the column blank, and the gutter
 * appears at all only when some line is too long to fit — a short payload reads
 * better as the block it is.
 */
function codeRows(text: string, language: string | undefined, theme: Theme, width: number): string[] {
  if (text === '') return [theme.fg('dim', 'Nothing recorded.')]
  const source = text.split('\n')
  const digits = String(source.length).length
  const gutter = digits + 1
  const unwrapped = source.every(line => visibleWidth(line) <= width)
  const room = Math.max(1, width - (unwrapped ? 0 : gutter))
  const painted = language === undefined
    ? source
    : highlightCodeLines(source, language, theme)
  const out: string[] = []
  for (const [index, line] of painted.entries()) {
    const rows = wrapText(line, room)
    out.push(unwrapped ? (rows[0] ?? '') : theme.fg('dim', String(index + 1).padStart(digits) + ' ') + (rows[0] ?? ''))
    for (const rest of rows.slice(1)) out.push(' '.repeat(unwrapped ? 0 : gutter) + rest)
  }
  return out
}

/**
 * A turn rule: the label on the left, the time it took against the right edge.
 *
 * The time is the whole reason this view exists, and "where did sixteen minutes
 * go" is answered top-down: the turn states its span, the step headers break it
 * into requests, and each record states its own duration.
 */
function turnLine(stats: TrajectoryTurnStats, collapsed: boolean, theme: Theme, width: number): string {
  const notes: string[] = []
  // Steps are only worth counting where they are not visible.
  if (collapsed) notes.push(`${stats.steps} ${stats.steps === 1 ? 'step' : 'steps'}`, 'collapsed')
  if (stats.errors > 0) notes.push(`${stats.errors} ${stats.errors === 1 ? 'error' : 'errors'}`)
  if (stats.warnings > 0) notes.push(`${stats.warnings} ${stats.warnings === 1 ? 'warning' : 'warnings'}`)
  const label = stats.turn === null ? 'Between turns' : `Turn ${stats.turn}`
  const left = `── ${label}${notes.length === 0 ? '' : ` · ${notes.join(' · ')}`} `
  const right = stats.spanMs === null ? '' : ` ${formatDuration(stats.spanMs)}`
  const room = Math.max(0, width - visibleWidth(left) - visibleWidth(right))
  return theme.fg('accent', left) + theme.fg('border', '─'.repeat(room)) + theme.fg('dim', right)
}

/** A step group: the request's boundary, and what the calls fold is hiding. */
function stepLine(step: number, hiddenCalls: readonly (readonly [string, number])[], theme: Theme, width: number): string {
  const tools = hiddenCalls.map(([name, count]) => count > 1 ? `${name}×${count}` : name).join(' ')
  const left = `   Step ${step}${tools === '' ? '' : ` · ${tools}`} `
  const room = Math.max(0, width - visibleWidth(left) - 1)
  return theme.fg('dim', left + '·'.repeat(room))
}

/** `(3/10)`-style position while the search is active, or ''. */
function searchPosition(state: TrajectoryState): string {
  const matches = trajectorySearch(state).matches
  if (matches.length === 0) return '(0/0)'
  const focus = Math.max(0, state.searchFocus ?? 0)
  return `(${Math.min(focus + 1, matches.length)}/${matches.length})`
}

/** Render the full-screen ledger without touching the ordinary transcript viewport. */
/** Lane ink, matching how the ledger paints the same kinds. */
const LANE_TONE: Readonly<Record<TimelineLane, 'accent' | 'success' | 'dim'>> = {
  llm: 'accent',
  tools: 'success',
  other: 'dim',
}

/**
 * The overview rows, or `undefined` when no record recorded a duration.
 *
 * A session that has only just started has nothing to show, and an empty
 * three-lane bar would read as "all lanes are zero" rather than "not yet".
 */
function timelineRows(state: TrajectoryState, theme: Theme, width: number): string[] | undefined {
  const overview = trajectoryTimeline(state.ledger.records, { width })
  if (overview === undefined || width < 24) return undefined
  return renderTimelineOverview(overview, {
    width,
    // The same precision the ledger rows use: a lane that took 0.4 s must not
    // read `0s` beside a row that says `0.4s`.
    formatDuration,
    paint: (lane, text) => theme.fg(LANE_TONE[lane], text),
    paintEmpty: text => theme.fg('borderMuted', text),
  }).map(row => truncateToWidth(' ' + row, width))
}

export function renderTrajectory(
  state: TrajectoryState,
  theme: Theme,
  width: number,
  height: number,
): { lines: string[]; cursor: { row: number; column: number }; cursorVisible: boolean } {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  /*
   * Human nouns, not internal ones. `12 records · 6 requests · 9 calls` counted
   * events the reader never named; a turn and a step are what the ledger is made
   * of, and the span is the question. Counts of problems appear only when there
   * are problems.
   */
  const stats = [...trajectoryIndex(state.ledger).stats.values()]
  const turns = stats.filter(entry => entry.turn !== null).length
  const steps = stats.reduce((sum, entry) => sum + entry.steps, 0)
  const spanMs = stats.reduce((sum, entry) => sum + (entry.spanMs ?? 0), 0)
  const errors = stats.reduce((sum, entry) => sum + entry.errors, 0)
  const warnings = stats.reduce((sum, entry) => sum + entry.warnings, 0)
  const summary = [
    turns === 0 ? '' : `${turns} ${turns === 1 ? 'turn' : 'turns'}`,
    steps === 0 ? '' : `${steps} ${steps === 1 ? 'step' : 'steps'}`,
    spanMs === 0 ? '' : formatDuration(spanMs),
    errors === 0 ? '' : `${errors} ${errors === 1 ? 'error' : 'errors'}`,
    warnings === 0 ? '' : `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`,
  ].filter(part => part !== '').join(' · ')
  const header = truncateToWidth(theme.bold(' Trajectory ') + theme.fg('dim', summary), safeWidth)
  const searchInfo = state.query === '' ? '' : ` · ${searchPosition(state)}`
  const followInfo = state.following ? '' : state.followNotice > 0 ? ` · End: follow · +${state.followNotice} new` : ''
  const toolbar = truncateToWidth(theme.fg('dim', state.details
    ? `${searchInfo.slice(2)}${followInfo} · ${formatOverlayHint([HOTKEY_NAVIGATE, HOTKEY_PAGE, HOTKEY_SECTION, HOTKEY_CLOSE])}`
    : `${searchInfo.slice(2)}${followInfo} · ${formatOverlayHint([HOTKEY_NAVIGATE, HOTKEY_DETAILS, HOTKEY_SEARCH, HOTKEY_TURN, HOTKEY_CALLS])}${state.following ? ' ●' : ''}`), safeWidth)
  const divider = theme.fg('border', '─'.repeat(safeWidth))
  /*
   * The overview answers "where did the time go" before the reader has to open a
   * single record. It sits between the toolbar and the ledger, only in the list
   * view: the detail panel is already about one record's timing, and repeating
   * the project-wide bars beside it would split attention for no gain.
   *
   * It is also gated on there being more than one step. A single request drawn as
   * `LLM 80% / Tools 20%` restates what the one row below it already says, and two
   * rows of restatement on a six-row body is the kind of chrome this view was
   * meant to replace. Searching hides it for the same reason: the reader is
   * looking for text, not for time.
   */
  const overview = trajectoryOverviewHeight(state, safeWidth) === 0 ? undefined : timelineRows(state, theme, safeWidth)
  const bodyHeight = Math.max(0, safeHeight - 4 - (overview?.length ?? 0))
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
      ? ' ' + formatOverlayHint([HOTKEY_PAGE, HOTKEY_SECTION, HOTKEY_CLOSE])
      : ' ' + formatOverlayHint([HOTKEY_CLOSE])
  const footer = truncateToWidth(theme.fg(state.searching ? 'accent' : 'dim', footerText), safeWidth)
  const lines = [header, toolbar, divider, ...(overview ?? []), ...body.slice(0, bodyHeight), footer].slice(0, safeHeight)
  while (lines.length < safeHeight) lines.push('')
  return {
    lines,
    cursor: { row: safeHeight - 1, column: Math.min(safeWidth, visibleWidth(` Search: ${state.query}`)) },
    cursorVisible: state.searching,
  }
}
