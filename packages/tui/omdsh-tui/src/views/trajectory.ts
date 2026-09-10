/** Keyboard-first Trajectory ledger projected directly from durable session events. */

import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { KeyEvent } from '../input/keys.ts'
import type { Theme } from '../chrome/theme.ts'
import { padToWidth, truncateToWidth, visibleWidth, wrapText } from '../chrome/width.ts'
import { moveGraphemeLeft, moveGraphemeRight } from '../chrome/grapheme.ts'
import { firstVisibleStreamTime } from './stream-time.ts'
import { formatOverlayHint, type HotkeyRow } from './hotkey-format.ts'

export type TrajectoryKind = 'system' | 'user' | 'context' | 'assistant' | 'tool' | 'subtool' | 'compaction' | 'warning' | 'error'
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
    const fields = [record.type, record.label, record.summary, record.payload, record.result, record.schema]
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
    if (eventType === 'assistant/message') {
      const message = object(data['message'])
      const text = contentText(message?.['content'] ?? data['content'], 'text')
      const reasoning = contentText(message?.['content'] ?? data['content'], 'reasoning')
      const usage = object(message?.['usage'] ?? data['usage'])
      const startedAt = this.#stepStarted.get(key) ?? event.time
      const existing = this.#assistantByStep.get(key)
      const result = reasoning === '' ? text : `Thinking\n${reasoning}\n\nAnswer\n${text}`
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
          this.#invalidateText(record)
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
    if (eventType === 'tool/call' || eventType === 'tool/ptc-dispatch-start') {
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
  readonly field: 'type' | 'label' | 'summary' | 'payload' | 'result' | 'schema'
  readonly offset: number
  readonly length: number
}

const SEARCH_FIELDS: readonly SearchMatch['field'][] = ['type', 'label', 'summary', 'payload', 'result', 'schema']

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
    return state.ledger.recordMatches(record, query)
  })
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
    callsCollapsed: state.callsCollapsed && record.kind !== 'subtool',
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

const DETAIL_TABS: readonly TrajectoryDetailTab[] = ['summary', 'payload', 'result', 'schema', 'timing']

function moveTab(state: TrajectoryState, delta: number): TrajectoryState {
  const current = DETAIL_TABS.indexOf(state.detailTab)
  const next = (current + delta + DETAIL_TABS.length) % DETAIL_TABS.length
  return { ...state, detailTab: DETAIL_TABS[next] ?? 'summary', detailScroll: 0 }
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
  if (event.type !== 'key') return { state }
  if (event.id === 'escape' || event.id === 'ctrl+c') {
    if (state.details) return { state: { ...state, details: false, detailScroll: 0 } }
    return { close: true }
  }
  if (event.id === 'up') return { state: move(state, -1) }
  if (event.id === 'down') return { state: move(state, 1) }
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
  if (event.id === 'tab' || event.id === 'right') return { state: moveTab(state, 1) }
  if (event.id === 'shift+tab' || event.id === 'left') return { state: moveTab(state, -1) }
  return { state }
}

// Every key `applyTrajectoryEvent` accepts. Rows whose first word is the footer
// label are also printed by the overlay's toolbar and footer.
const HOTKEY_NAVIGATE: HotkeyRow = { keys: '↑↓', action: 'Navigate records' }
const HOTKEY_EDGE: HotkeyRow = { keys: 'Home / End', action: 'Jump to the first record, or follow the newest' }
const HOTKEY_PAGE: HotkeyRow = { keys: 'PgUp / PgDn', action: 'Scroll — page the detail or the record list' }
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

/** List paging capacity in records for one body height (pure, shared with rendering). */
export function trajectoryListMetrics(state: TrajectoryState, height: number): { pageSize: number } {
  const body = Math.max(0, height - 4)
  if (body <= 0) return { pageSize: 0 }
  const layout = rowLayout(state)
  if (layout.length === 0) return { pageSize: 1 }
  const selected = Math.max(0, layout.findIndex(row => row.id === state.selectedId))
  const start = Math.max(0, Math.min(layout.length - 1, selected - Math.floor(body / 2)))
  // Count record rows inside the window; turn headers only occupy space.
  let rows = 0
  let count = 0
  for (let index = start; index < layout.length; index += 1) {
    rows += 1
    if (rows > body) break
    if (layout[index]?.turnHeader !== true) count += 1
  }
  return { pageSize: Math.max(1, count) }
}

/** Per-record row layout (turn headers included), consumed by rendering and metrics. */
function rowLayout(state: TrajectoryState): { id: string; turnHeader: boolean }[] {
  const layout: { id: string; turnHeader: boolean }[] = []
  let previousTurn: number | null | undefined
  for (const record of trajectoryVisibleRecords(state)) {
    if (record.turn !== previousTurn) {
      previousTurn = record.turn
      layout.push({ id: `turn:${record.turn ?? 'between'}`, turnHeader: true })
    }
    layout.push({ id: record.id, turnHeader: false })
  }
  return layout
}

/** Detail scroll step in wrapped lines for one body height (pure, shared with rendering). */
export function trajectoryDetailMetrics(_state: TrajectoryState, height: number): { pageLines: number } {
  const body = Math.max(0, height - 4)
  const viewport = Math.max(0, body - 2)
  return { pageLines: Math.max(1, viewport) }
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
  const locationLabel = record.turn === null ? ' —   ' : `T${record.turn}${record.step === null ? '' : `·${record.step}`}`.padEnd(5)
  const kind = theme.fg(kindColor(record.kind), record.label.padEnd(9).slice(0, 9))
  const elapsed = duration(record).padStart(6)
  const badge = matchCount === undefined ? '' : ` ${theme.fg('dim', `×${matchCount}`)}`
  const prefix = `${marker} ${String(record.index).padStart(4)} ${locationLabel} ${kind} ${elapsed}  `
  const bodyWidth = Math.max(0, width - visibleWidth(prefix) - visibleWidth(badge))
  const body = summaryOverride ?? highlightSummary(record.summary, highlightSpans)
  return prefix + truncateToWidth(body, bodyWidth) + badge
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
  const { matches, counts } = trajectorySearch(state)
  const focused = state.searchFocus === null ? undefined : matches[state.searchFocus]
  const highlighted = new Map<string, SearchMatch[]>()
  for (const match of matches) {
    const list = highlighted.get(match.record.id) ?? []
    list.push(match)
    highlighted.set(match.record.id, list)
  }
  const lines: { id: string; text: string }[] = []
  const layout = rowLayout(state)
  let previousTurn: number | null | undefined
  for (const record of visible) {
    if (record.turn !== previousTurn) {
      previousTurn = record.turn
      const label = record.turn === null ? 'Between turns' : `Turn ${record.turn}`
      const collapsed = record.turn !== null && state.collapsedTurns.has(record.turn) ? ' · collapsed' : ''
      lines.push({ id: `turn:${record.turn ?? 'between'}`, text: theme.fg('accent', `── ${label}${collapsed} `) })
    }
    const recordMatches = highlighted.get(record.id) ?? []
    const focusedForRecord = focused?.record === record ? focused : undefined
    const headField = focusedForRecord !== undefined ? focusedForRecord.field : recordMatches[0]?.field
    const headSpans = recordMatches.filter(match => match.field === headField)
    const summary = headField === undefined || headField === 'summary'
      ? highlightSummary(record.summary, headSpans, theme)
      : fieldSnippet(record, headField, headSpans, Math.max(0, width - 24), theme, focusedForRecord)
    lines.push({
      id: record.id,
      text: recordLine(record, record.id === state.selectedId, theme, width,
        headField === 'summary' ? headSpans : [],
        state.query === '' ? undefined : counts.get(record.id),
        summary,
      ),
    })
  }
  const selectedIndex = Math.max(0, layout.findIndex(row => row.id === state.selectedId))
  const start = Math.max(0, Math.min(layout.length - 1, selectedIndex - Math.floor(height / 2)))
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

/** `(3/10)`-style position while the search is active, or ''. */
function searchPosition(state: TrajectoryState): string {
  const matches = trajectorySearch(state).matches
  if (matches.length === 0) return '(0/0)'
  const focus = Math.max(0, state.searchFocus ?? 0)
  return `(${Math.min(focus + 1, matches.length)}/${matches.length})`
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
  const warnings = records.filter(record => record.status === 'warning').length
  const requests = records.filter(record => record.kind === 'assistant').length
  const tools = records.filter(record => record.kind === 'tool' || record.kind === 'subtool').length
  const header = truncateToWidth(theme.bold(' Trajectory ') + theme.fg('dim', `${records.length} records · ${requests} requests · ${tools} calls · ${warnings} warnings · ${errors} errors`), safeWidth)
  const searchInfo = state.query === '' ? '' : ` · ${searchPosition(state)}`
  const followInfo = state.following ? '' : state.followNotice > 0 ? ` · End: follow · +${state.followNotice} new` : ''
  const toolbar = truncateToWidth(theme.fg('dim', state.details
    ? `${searchInfo.slice(2)}${followInfo} · ${formatOverlayHint([HOTKEY_NAVIGATE, HOTKEY_PAGE, HOTKEY_SECTION, HOTKEY_CLOSE])}`
    : `${searchInfo.slice(2)}${followInfo} · ${formatOverlayHint([HOTKEY_NAVIGATE, HOTKEY_DETAILS, HOTKEY_SEARCH, HOTKEY_MATCH, HOTKEY_TURN, HOTKEY_CALLS, HOTKEY_EDGE])}${state.following ? ' ●' : ''}`), safeWidth)
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
      ? ' ' + formatOverlayHint([HOTKEY_PAGE, HOTKEY_SECTION, HOTKEY_CLOSE])
      : ' ' + formatOverlayHint([HOTKEY_CLOSE])
  const footer = truncateToWidth(theme.fg(state.searching ? 'accent' : 'dim', footerText), safeWidth)
  const lines = [header, toolbar, divider, ...body.slice(0, bodyHeight), footer].slice(0, safeHeight)
  while (lines.length < safeHeight) lines.push('')
  return {
    lines,
    cursor: { row: safeHeight - 1, column: Math.min(safeWidth, visibleWidth(` Search: ${state.query}`)) },
    cursorVisible: state.searching,
  }
}
