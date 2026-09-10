/**
 * Transcript text search over settled blocks. Matching is a pure derivation
 * from the supplied block texts on every event; only the query, the edit flag,
 * and the focused match index live in the state.
 * @module @agi-fans/dsh-tui
 */

import type { KeyEvent } from '../input/keys.ts'
import { moveGraphemeLeft } from '../chrome/grapheme.ts'

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
  | { kind: 'focus'; state: TranscriptSearchState; block: number }
  | { kind: 'close' }

export function createTranscriptSearch(): TranscriptSearchState {
  return { query: '', editing: true, focus: -1 }
}

function needleOf(query: string): string {
  return query.trim().toLowerCase()
}

/** Block indexes whose text contains the query, in render order. */
export function searchBlockIndexes(texts: readonly string[], query: string): number[] {
  const needle = needleOf(query)
  if (needle === '') return []
  const matches: number[] = []
  for (let index = 0; index < texts.length; index += 1) {
    if ((texts[index] ?? '').toLowerCase().includes(needle)) matches.push(index)
  }
  return matches
}

/** True when one block's text contains the query, used to paint matches. */
export function blockMatchesQuery(text: string, query: string): boolean {
  const needle = needleOf(query)
  return needle !== '' && text.toLowerCase().includes(needle)
}

/** One-line composer hint describing the active search. */
export function transcriptSearchHint(state: TranscriptSearchState, total: number): string {
  const position = total === 0 ? '0/0' : `${Math.min(state.focus + 1, total)}/${total}`
  if (state.editing) return `Search: ${state.query} (${position}) · Enter confirm · Esc close`
  return `Search (${position}) · n/N next · Esc close`
}

/**
 * Fold one raw key event into the search state.
 * @param state - current search state.
 * @param event - decoded terminal event.
 * @param texts - block texts in render order, indexed like the transcript.
 * @returns the next state, a focus move, or a close request.
 */
export function applyTranscriptSearchEvent(
  state: TranscriptSearchState,
  event: KeyEvent,
  texts: readonly string[],
): TranscriptSearchCommand {
  if (event.type === 'key' && (event.id === 'escape' || event.id === 'ctrl+c')) return { kind: 'close' }
  const matches = searchBlockIndexes(texts, state.query)
  const step = (delta: number): TranscriptSearchCommand => {
    if (matches.length === 0) return { kind: 'update', state: { ...state, focus: -1 } }
    const base = state.focus < 0 ? (delta > 0 ? -1 : 0) : state.focus
    const next = (base + delta + matches.length) % matches.length
    return { kind: 'focus', state: { ...state, focus: next }, block: matches[next]! }
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
