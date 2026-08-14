/**
 * Ctrl+R history search: OMP token-AND overlay over in-session prompts.
 * Pure — the provider owns the live session history and key routing.
 * @module @omdsh/tui
 */

import { renderEditor } from './box.ts'
import type { KeyEvent } from './keys.ts'
import { SYMBOL, type Theme } from './theme.ts'
import { truncateToWidth } from './width.ts'

/** Visible result rows (OMP history-search window). */
export const HISTORY_SEARCH_MAX_VISIBLE = 10

/** Result cap matching OMP's overlay. */
export const HISTORY_SEARCH_LIMIT = 100

/** Live overlay state. */
export interface HistorySearchState {
  query: string
  cursor: number
  selected: number
  results: readonly string[]
}

/** Outcome of one key against the overlay. */
export type HistorySearchCommand =
  | { kind: 'update'; state: HistorySearchState }
  | { kind: 'select'; text: string }
  | { kind: 'cancel' }
  | { kind: 'ignore' }

/** Split a query the way OMP's history storage tokenizes it. */
export function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((tok) => tok.length > 0)
}

/**
 * Newest-first filter. Empty query lists recent prompts; a non-empty query
 * keeps entries that contain every token as a case-insensitive substring.
 */
export function searchHistory(
  history: readonly string[],
  query: string,
  limit = HISTORY_SEARCH_LIMIT,
): string[] {
  const newest = history.slice().reverse()
  const tokens = queryTokens(query.trim())
  const matched = tokens.length === 0
    ? newest
    : newest.filter((prompt) => {
      const lower = prompt.toLowerCase()
      return tokens.every((tok) => lower.includes(tok))
    })
  return matched.slice(0, Math.max(0, limit))
}

/** Open the overlay on the current session history. */
export function createHistorySearch(history: readonly string[]): HistorySearchState {
  return { query: '', cursor: 0, selected: 0, results: searchHistory(history, '') }
}

function refresh(state: HistorySearchState, history: readonly string[], resetSelected: boolean): HistorySearchState {
  const results = searchHistory(history, state.query)
  const selected = resetSelected
    ? 0
    : Math.min(state.selected, Math.max(0, results.length - 1))
  return { query: state.query, cursor: state.cursor, selected, results }
}

function insertQuery(state: HistorySearchState, value: string, history: readonly string[]): HistorySearchState {
  if (value === '') return state
  const query = state.query.slice(0, state.cursor) + value + state.query.slice(state.cursor)
  return refresh({ ...state, query, cursor: state.cursor + value.length, selected: 0 }, history, true)
}

function deleteRange(
  state: HistorySearchState,
  start: number,
  end: number,
  history: readonly string[],
): HistorySearchState {
  if (start < 0 || start >= end) return state
  const query = state.query.slice(0, start) + state.query.slice(end)
  return refresh({ ...state, query, cursor: start, selected: 0 }, history, true)
}

function moveQuery(state: HistorySearchState, cursor: number): HistorySearchState {
  const next = Math.max(0, Math.min(state.query.length, cursor))
  if (next === state.cursor) return state
  return { ...state, cursor: next }
}

function moveWordLeft(text: string, cursor: number): number {
  let i = cursor
  while (i > 0 && /\s/.test(text[i - 1] ?? '')) i -= 1
  while (i > 0 && !/\s/.test(text[i - 1] ?? '')) i -= 1
  return i
}

function moveSelected(state: HistorySearchState, next: number): HistorySearchState {
  if (state.results.length === 0) return state
  const selected = Math.max(0, Math.min(state.results.length - 1, next))
  if (selected === state.selected) return state
  return { ...state, selected }
}

/** Apply one decoded event to the overlay. */
export function applyHistorySearchEvent(
  state: HistorySearchState,
  event: KeyEvent,
  history: readonly string[],
): HistorySearchCommand {
  if (event.type === 'text') {
    const value = event.value.replace(/[\r\n]/g, '')
    if (value === '') return { kind: 'ignore' }
    return { kind: 'update', state: insertQuery(state, value, history) }
  }
  if (event.type !== 'key') return { kind: 'ignore' }
  switch (event.id) {
    case 'enter': {
      const text = state.results[state.selected]
      return text === undefined ? { kind: 'ignore' } : { kind: 'select', text }
    }
    case 'escape':
    case 'ctrl+c':
      return { kind: 'cancel' }
    case 'up':
    case 'shift+tab':
      return { kind: 'update', state: moveSelected(state, state.selected - 1) }
    case 'down':
    case 'tab':
      return { kind: 'update', state: moveSelected(state, state.selected + 1) }
    case 'pageUp':
      return { kind: 'update', state: moveSelected(state, state.selected - HISTORY_SEARCH_MAX_VISIBLE) }
    case 'pageDown':
      return { kind: 'update', state: moveSelected(state, state.selected + HISTORY_SEARCH_MAX_VISIBLE) }
    case 'home':
      return { kind: 'update', state: moveSelected(state, 0) }
    case 'end':
      return { kind: 'update', state: moveSelected(state, state.results.length - 1) }
    case 'left':
    case 'ctrl+b':
      return { kind: 'update', state: moveQuery(state, state.cursor - 1) }
    case 'right':
    case 'ctrl+f':
      return { kind: 'update', state: moveQuery(state, state.cursor + 1) }
    case 'ctrl+a':
      return { kind: 'update', state: moveQuery(state, 0) }
    case 'ctrl+e':
      return { kind: 'update', state: moveQuery(state, state.query.length) }
    case 'backspace':
      return { kind: 'update', state: deleteRange(state, state.cursor - 1, state.cursor, history) }
    case 'delete':
    case 'ctrl+d':
      if (state.query === '') return { kind: 'cancel' }
      return { kind: 'update', state: deleteRange(state, state.cursor, state.cursor + 1, history) }
    case 'ctrl+w':
    case 'alt+backspace':
      return { kind: 'update', state: deleteRange(state, moveWordLeft(state.query, state.cursor), state.cursor, history) }
    case 'ctrl+u':
      return { kind: 'update', state: deleteRange(state, 0, state.cursor, history) }
    case 'ctrl+k':
      return { kind: 'update', state: deleteRange(state, state.cursor, state.query.length, history) }
    default:
      return { kind: 'ignore' }
  }
}

/** Paint token hits in accent so they line up with `queryTokens`. */
export function highlightTokens(text: string, tokens: readonly string[], theme: Theme): string {
  if (tokens.length === 0) return text
  const lower = text.toLowerCase()
  const ranges: [number, number][] = []
  for (const tok of tokens) {
    let from = lower.indexOf(tok)
    while (from !== -1) {
      ranges.push([from, from + tok.length])
      from = lower.indexOf(tok, from + tok.length)
    }
  }
  if (ranges.length === 0) return text
  ranges.sort((a, b) => a[0] - b[0])
  let out = ''
  let pos = 0
  for (const [start, end] of ranges) {
    if (end <= pos) continue
    const from = Math.max(start, pos)
    if (from > pos) out += text.slice(pos, from)
    out += theme.fg('accent', text.slice(from, end))
    pos = end
  }
  if (pos < text.length) out += text.slice(pos)
  return out
}

/** Overlay frame: title, query editor, results, hints. */
export function renderHistorySearch(
  state: HistorySearchState,
  theme: Theme,
  width: number,
  maxVisible = HISTORY_SEARCH_MAX_VISIBLE,
): { lines: string[]; cursor: { row: number; column: number } } {
  const title = ' ' + theme.bold(theme.fg('accent', '↺ Search History'))
  const editor = renderEditor({
    width,
    input: state.query,
    inputCursor: state.cursor,
    status: ' ' + theme.fg('accent', 'search') + ' ',
    border: 'accent',
  }, theme)
  const tokens = queryTokens(state.query.trim())
  const visible = Math.max(1, maxVisible)
  const resultLines = renderHistoryResults(state, tokens, theme, width, visible)
  const hints = ' ' + theme.fg('dim', '↑↓ navigate') + theme.fg('dim', ' · ')
    + theme.fg('dim', 'enter select') + theme.fg('dim', ' · ')
    + theme.fg('dim', 'esc cancel')
  const lines = ['', title, '', ...editor.lines, '', ...resultLines, '', hints]
  return {
    lines,
    cursor: { row: 3 + editor.cursor.row, column: editor.cursor.column },
  }
}

function renderHistoryResults(
  state: HistorySearchState,
  tokens: readonly string[],
  theme: Theme,
  width: number,
  maxVisible: number,
): string[] {
  if (state.results.length === 0) {
    const message = tokens.length > 0 ? 'No matching history' : 'No history yet'
    return ['  ' + theme.fg('muted', SYMBOL.info + ' ' + message)]
  }
  const index = Math.max(0, Math.min(state.selected, state.results.length - 1))
  const start = Math.max(0, Math.min(index - Math.floor(maxVisible / 2), Math.max(0, state.results.length - maxVisible)))
  const end = Math.min(state.results.length, start + maxVisible)
  const lines: string[] = []
  for (let i = start; i < end; i += 1) {
    const prompt = state.results[i] ?? ''
    const isSelected = i === index
    const cursor = isSelected ? theme.fg('accent', SYMBOL.cursor + ' ') : '  '
    const normalized = prompt.replace(/\s+/g, ' ').trim()
    const plain = truncateToWidth(normalized, Math.max(1, width - 2))
    const painted = highlightTokens(plain, tokens, theme)
    const body = isSelected ? theme.bold(painted) : painted
    lines.push(truncateToWidth(cursor + body, width))
  }
  if (state.results.length > maxVisible) {
    lines.push(theme.fg('dim', '  ' + String(index + 1) + '/' + String(state.results.length)))
  }
  return lines
}
