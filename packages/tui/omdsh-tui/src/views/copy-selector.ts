/**
 * `/copy` picker overlay: OMP-style list of transcript copy targets.
 * Pure — the provider owns the clipboard write.
 * @module @agi-fans/dsh-tui
 */

import type { CopyPick } from './copy-targets.ts'
import type { KeyEvent } from '../input/keys.ts'
import { moveGraphemeLeft } from '../input/editor.ts'
import { rankSearchResults } from '../input/fuzzy-search.ts'
import { SYMBOL, type Theme } from '../chrome/theme.ts'
import { expandTabs, truncateToWidth, visibleWidth, wrapText } from '../chrome/width.ts'
import { formatOverlayHint, type HotkeyRow } from './hotkey-format.ts'
import { edgeIndex, listNavigation, navigateIndex } from './list-navigation.ts'
import { renderListRowWithValue } from './list-view.ts'

/** Visible picker rows. */
export const COPY_SELECTOR_MAX_VISIBLE = 8

/** Preview lines under the list. */
export const COPY_SELECTOR_PREVIEW_LINES = 4

/** First overlay-local row that paints a target. */
export const COPY_SELECTOR_ITEM_ROW = 3

/** Live overlay state. */
export interface CopySelectorState {
  items: readonly CopyPick[]
  selected: number
  search?: string
}

/** Outcome of one key against the overlay. */
export type CopySelectorCommand =
  | { kind: 'update'; state: CopySelectorState }
  | { kind: 'pick'; item: CopyPick }
  | { kind: 'close' }
  | { kind: 'ignore' }

/** Open the picker on the assembled targets. */
export function createCopySelector(items: readonly CopyPick[], selected = 0): CopySelectorState {
  return { items, selected: Math.max(0, Math.min(selected, Math.max(0, items.length - 1))) }
}

/** Filtered targets matching the active search query. */
export function filteredCopyItems(state: CopySelectorState): readonly CopyPick[] {
  const query = state.search?.trim() ?? ''
  if (query === '') return state.items
  return rankSearchResults(state.items, query, item => [item.label, item.hint, item.copyMessage, item.text])
}

/** Visible item-index window around `selected`. */
export function copySelectorVisibleRange(
  count: number,
  selected: number,
  maxVisible = COPY_SELECTOR_MAX_VISIBLE,
): { start: number; end: number } {
  const max = Math.max(1, maxVisible)
  const index = Math.max(0, Math.min(selected, Math.max(0, count - 1)))
  const start = Math.max(0, Math.min(index - Math.floor(max / 2), Math.max(0, count - max)))
  return { start, end: Math.min(count, start + max) }
}

function moveSelected(state: CopySelectorState, next: number): CopySelectorState {
  const items = filteredCopyItems(state)
  if (items.length === 0) return state
  const n = items.length
  const selected = (next % n + n) % n
  if (selected === state.selected) return state
  return { ...state, selected }
}

/** Apply one decoded event to the overlay. */
export function applyCopySelectorEvent(state: CopySelectorState, event: KeyEvent): CopySelectorCommand {
  if (event.type === 'text') {
    if (state.search === undefined && event.value === ' ') {
      const item = filteredCopyItems(state)[state.selected]
      return item === undefined ? { kind: 'ignore' } : { kind: 'pick', item }
    }
    const query = (state.search ?? '') + (event.value === '/' && state.search === undefined ? '' : event.value.replace(/[\r\n]/gu, ' '))
    return { kind: 'update', state: { ...state, search: query, selected: 0 } }
  }
  if (event.type !== 'key') return { kind: 'ignore' }
  if (state.search !== undefined && (event.id === 'backspace' || event.id === 'ctrl+u')) {
    const query = event.id === 'ctrl+u' ? '' : state.search.slice(0, moveGraphemeLeft(state.search, state.search.length))
    return { kind: 'update', state: { ...state, search: query, selected: 0 } }
  }
  // Every navigation key comes from the shared reading, so this picker cannot
  // drift from the other lists about what `tab` or `pageUp` means.
  const navigation = listNavigation(event)
  const items = filteredCopyItems(state)
  if (navigation.kind === 'close') {
    // One layer per press: an active filter clears before the picker closes.
    if (state.search !== undefined) {
      const { search: _, ...rest } = state
      return { kind: 'update', state: { ...rest, selected: 0 } }
    }
    return { kind: 'close' }
  }
  if (navigation.kind === 'confirm') {
    const item = items[state.selected]
    return item === undefined ? { kind: 'ignore' } : { kind: 'pick', item }
  }
  if (navigation.kind === 'move' || navigation.kind === 'page') {
    return { kind: 'update', state: moveSelected(state, navigateIndex(navigation, state.selected, items.length, COPY_SELECTOR_MAX_VISIBLE)) }
  }
  if (navigation.kind === 'edge') {
    return { kind: 'update', state: moveSelected(state, edgeIndex(navigation, items.length)) }
  }
  return { kind: 'ignore' }
}

// Every key `applyCopySelectorEvent` accepts. Rows whose first word is the
// footer label are also printed by the overlay's bottom hint.
const HOTKEY_NAVIGATE: HotkeyRow = { keys: '↑↓', action: 'Navigate targets' }
const HOTKEY_TAB: HotkeyRow = { keys: 'Tab / Shift+Tab', action: 'Navigate targets, like ↑↓' }
const HOTKEY_PAGE: HotkeyRow = { keys: 'PgUp / PgDn', action: 'Page — jump one page of targets' }
const HOTKEY_EDGE: HotkeyRow = { keys: 'Home / End', action: 'Jump to the first or last target' }
const HOTKEY_FILTER: HotkeyRow = { keys: '/ or Text', action: 'Filter copy targets by label, kind, or content' }
const HOTKEY_EDIT_FILTER: HotkeyRow = { keys: 'Backspace / Ctrl+U', action: 'Edit or clear the active filter' }
const HOTKEY_COPY: HotkeyRow = { keys: 'Enter', action: 'Copy the selected target' }
const HOTKEY_COPY_SPACE: HotkeyRow = { keys: 'Space', action: 'Copy the selected target, like Enter' }
const HOTKEY_CLOSE: HotkeyRow = { keys: 'Esc / Ctrl+C', action: 'Clear filter or close the picker' }

/** Keys the copy picker accepts; `/help` and its bottom hint read this list. */
export const COPY_SELECTOR_HOTKEYS: readonly HotkeyRow[] = [
  HOTKEY_NAVIGATE,
  HOTKEY_TAB,
  HOTKEY_PAGE,
  HOTKEY_EDGE,
  HOTKEY_FILTER,
  HOTKEY_EDIT_FILTER,
  HOTKEY_COPY,
  HOTKEY_COPY_SPACE,
  HOTKEY_CLOSE,
]

/** Overlay frame: title, windowed rows, preview, hints. */
export function renderCopySelector(
  state: CopySelectorState,
  theme: Theme,
  width: number,
  maxVisible = COPY_SELECTOR_MAX_VISIBLE,
): { lines: string[]; cursor: { row: number; column: number } } {
  const items = filteredCopyItems(state)
  const count = items.length
  const index = Math.max(0, Math.min(state.selected, Math.max(0, count - 1)))
  const searchBadge = state.search === undefined
    ? ''
    : theme.fg('dim', ' · Search: ') + (state.search === '' ? theme.fg('muted', 'type to filter') : theme.fg('text', state.search))
  const title = truncateToWidth(' ' + theme.bold(theme.fg('accent', '⎘ Copy')) + searchBadge, width)
  const { start, end } = copySelectorVisibleRange(count, index, maxVisible)
  const rows: string[] = []
  if (count === 0) {
    rows.push('  ' + theme.fg('muted', SYMBOL.info + (state.search ? ' No matching copy targets.' : ' Nothing to copy.')))
  } else {
    for (let i = start; i < end; i += 1) {
      const item = items[i]
      if (item === undefined) continue
      rows.push(renderCopyRow(item, i === index, theme, width))
    }
    if (count > maxVisible) {
      rows.push(theme.fg('dim', '  ' + String(index + 1) + '/' + String(count)))
    }
  }
  const preview = renderCopyPreview(items[index], theme, width)
  const hints = ' ' + theme.fg('dim', formatOverlayHint([HOTKEY_NAVIGATE, HOTKEY_FILTER, HOTKEY_COPY, HOTKEY_CLOSE]))
  const lines = ['', title, '', ...rows, '', ...preview, '', truncateToWidth(hints, width)]
  return {
    lines,
    cursor: { row: COPY_SELECTOR_ITEM_ROW + (index - start), column: 2 },
  }
}

function renderCopyRow(item: CopyPick, selected: boolean, theme: Theme, width: number): string {
  return renderListRowWithValue(
    { label: item.label, ...(item.hint === '' ? {} : { value: item.hint }) },
    theme,
    width,
    visibleWidth(item.label),
    { selected },
  )
}

function renderCopyPreview(item: CopyPick | undefined, theme: Theme, width: number): string[] {
  const header = '  ' + theme.fg('dim', item === undefined ? 'Preview' : 'Preview · ' + item.hint)
  if (item === undefined) return [header]
  // The preview body is painted behind a two-space gutter, so a tab inside the
  // copied text resolves against that column rather than against column zero.
  const wrapped = wrapText(expandTabs(item.text, 8, 2), Math.max(1, width - 2))
  const cap = COPY_SELECTOR_PREVIEW_LINES
  const visible = wrapped.slice(0, cap)
  const extra = wrapped.length > cap ? wrapped.length - cap : 0
  const body = visible.map((line) => truncateToWidth('  ' + theme.fg('muted', line), width))
  if (extra > 0) body.push(theme.fg('dim', '  … ' + String(extra) + ' more lines'))
  return [header, ...body]
}
