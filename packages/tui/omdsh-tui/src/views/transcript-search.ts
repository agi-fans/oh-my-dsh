/**
 * Transcript text search over settled blocks. Matching is a pure derivation
 * from the supplied block texts on every event; only the query, the edit flag,
 * and the focused match index live in the state.
 * @module @agi-fans/dsh-tui
 */

import type { KeyEvent } from '../input/keys.ts'
import { moveGraphemeLeft } from '../chrome/grapheme.ts'
import { visibleWidth } from '../chrome/width.ts'
import { formatOverlayHint, type HotkeyRow } from './hotkey-format.ts'
import { listNavigation } from './list-navigation.ts'

/** Transcript search state owned by the local terminal provider. */
export interface TranscriptSearchState {
  /** Case-insensitive literal query. */
  query: string
  /** True while the query is being edited. */
  editing: boolean
  /** Index into the derived match list; -1 when nothing matches. */
  focus: number
}

/** One state transition for the transcript search overlay. */
export type TranscriptSearchCommand =
  | { kind: 'update'; state: TranscriptSearchState }
  | { kind: 'focus'; state: TranscriptSearchState; match: TranscriptSearchMatch }
  | { kind: 'close' }

export function createTranscriptSearch(): TranscriptSearchState {
  return { query: '', editing: true, focus: -1 }
}

function needleOf(query: string): string {
  return query.trim().toLowerCase()
}

/**
 * One occurrence of the query, addressed by block and by rendered row.
 *
 * Searching used to yield block indexes, so a long reply that mentioned a word
 * five times produced one match: `n` jumped past the other four, and every row of
 * the block was painted instead of the word. A match is now the occurrence, with
 * the display columns it covers on its own row.
 */
export interface TranscriptSearchMatch {
  /** Index into the block list, as the renderer orders blocks. */
  block: number
  /** Zero-based row within that block's rendered lines. */
  row: number
  /** First display cell of the occurrence on that row. */
  start: number
  /** Display cells the occurrence covers. */
  width: number
}

/** One block's rendered lines, already stripped of SGR. */
export interface SearchableBlock {
  block: number
  lines: readonly string[]
}

/**
 * Every occurrence the query has across the rendered transcript, in reading order.
 *
 * Occurs more than once per row are all reported: the reader stepping with `n`
 * should visit each one rather than each row.
 */
export function searchMatches(blocks: readonly SearchableBlock[], query: string): TranscriptSearchMatch[] {
  const needle = needleOf(query)
  if (needle === '') return []
  const matches: TranscriptSearchMatch[] = []
  for (const { block, lines } of blocks) {
    for (const [row, line] of lines.entries()) {
      const lower = line.toLowerCase()
      const width = visibleWidth(needle)
      let from = 0
      for (;;) {
        const at = lower.indexOf(needle, from)
        if (at < 0) break
        matches.push({ block, row, start: visibleWidth(line.slice(0, at)), width })
        // Advance past this occurrence so overlapping repeats stay distinct and
        // the scan cannot stall on a zero-width needle.
        from = at + Math.max(1, needle.length)
      }
    }
  }
  return matches
}

/** Rows of one block that carry a hit, for painting. */
export function matchedRows(matches: readonly TranscriptSearchMatch[], block: number): Map<number, readonly { start: number; width: number }[]> {
  const rows = new Map<number, { start: number; width: number }[]>()
  for (const match of matches) {
    if (match.block !== block) continue
    const spans = rows.get(match.row)
    if (spans === undefined) rows.set(match.row, [{ start: match.start, width: match.width }])
    else spans.push({ start: match.start, width: match.width })
  }
  return rows
}

/** True when one block's text contains the query, used to open a folded run. */
export function blockMatchesQuery(text: string, query: string): boolean {
  const needle = needleOf(query)
  return needle !== '' && text.toLowerCase().includes(needle)
}

// Every key `applyTranscriptSearchEvent` accepts. Rows whose first word is the
// footer label are also printed by the composer hint below the transcript.
const HOTKEY_TEXT: HotkeyRow = { keys: 'Text', action: 'Query — type the search text' }
const HOTKEY_BACKSPACE: HotkeyRow = { keys: 'Backspace', action: 'Delete — remove the last query character' }
const HOTKEY_STEP_EDIT: HotkeyRow = { keys: 'Ctrl+N / Ctrl+P', action: 'Match — step through matches while typing' }
const HOTKEY_CONFIRM: HotkeyRow = { keys: 'Enter', action: 'Confirm — keep the query and jump to the match' }
const HOTKEY_STEP: HotkeyRow = { keys: 'n/N', action: 'Next — step to the next match, or back with N' }
const HOTKEY_EDIT: HotkeyRow = { keys: '/', action: 'Edit — return to the query editor' }
const HOTKEY_CLOSE: HotkeyRow = { keys: 'Esc / Ctrl+C', action: 'Close the search' }

/** Keys the transcript search accepts; `/help` and its composer hint read this list. */
export const TRANSCRIPT_SEARCH_HOTKEYS: readonly HotkeyRow[] = [
  HOTKEY_TEXT,
  HOTKEY_BACKSPACE,
  HOTKEY_STEP_EDIT,
  HOTKEY_CONFIRM,
  HOTKEY_STEP,
  HOTKEY_EDIT,
  HOTKEY_CLOSE,
]

/** One-line composer hint describing the active search. */
export function transcriptSearchHint(state: TranscriptSearchState, total: number): string {
  const position = total === 0 ? '0/0' : `${Math.min(state.focus + 1, total)}/${total}`
  if (state.editing) {
    return `Search: ${state.query} (${position}) · ${formatOverlayHint([HOTKEY_CONFIRM, HOTKEY_CLOSE])}`
  }
  return `Search (${position}) · ${formatOverlayHint([HOTKEY_STEP, HOTKEY_CLOSE])}`
}

/**
 * Fold one raw key event into the search state.
 * @param state - current search state.
 * @param event - decoded terminal event.
 * @param matches - every occurrence in the rendered transcript, in reading order.
 * @returns the next state, a focus move, or a close request.
 */
export function applyTranscriptSearchEvent(
  state: TranscriptSearchState,
  event: KeyEvent,
  matches: readonly TranscriptSearchMatch[],
): TranscriptSearchCommand {
  // The shared reading supplies the closing keys and the "next/previous match"
  // pair; this surface has no list, so it takes nothing else from it.
  const navigation = listNavigation(event)
  if (navigation.kind === 'close') return { kind: 'close' }
  const step = (delta: number): TranscriptSearchCommand => {
    if (matches.length === 0) return { kind: 'update', state: { ...state, focus: -1 } }
    const base = state.focus < 0 ? (delta > 0 ? -1 : 0) : state.focus
    const next = (base + delta + matches.length) % matches.length
    return { kind: 'focus', state: { ...state, focus: next }, match: matches[next]! }
  }
  if (event.type === 'key' && (event.id === 'ctrl+n' || event.id === 'ctrl+p')) {
    return step(event.id === 'ctrl+n' ? 1 : -1)
  }
  if (!state.editing) {
    if (event.type === 'text') {
      if (event.value === '/') return { kind: 'update', state: { ...state, editing: true } }
      if (event.value === 'n') return step(1)
      if (event.value === 'N') return step(-1)
      if (event.value.trim() !== '') {
        return { kind: 'update', state: { query: event.value, editing: true, focus: -1 } }
      }
    }
    return { kind: 'update', state }
  }
  if (event.type === 'key' && event.id === 'enter') return { kind: 'update', state: { ...state, editing: false } }
  if (event.type === 'key' && event.id === 'backspace') {
    const cursor = moveGraphemeLeft(state.query, state.query.length)
    return { kind: 'update', state: { query: state.query.slice(0, cursor), editing: true, focus: -1 } }
  }
  if (event.type === 'text' && event.value !== '') {
    return { kind: 'update', state: { query: state.query + event.value, editing: true, focus: -1 } }
  }
  return { kind: 'update', state }
}
