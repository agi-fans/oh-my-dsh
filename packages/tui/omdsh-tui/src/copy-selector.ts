/**
 * `/copy` picker overlay: OMP-style list of transcript copy targets.
 * Pure — the provider owns the clipboard write.
 * @module @agi-fans/dsh-tui
 */

import type { CopyPick } from './copy-targets.ts'
import type { KeyEvent } from './keys.ts'
import { SYMBOL, type Theme } from './theme.ts'
import { truncateToWidth, visibleWidth, wrapText } from './width.ts'

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

/** Item index under an overlay-local row, or undefined on chrome. */
export function hitTestCopySelector(
  count: number,
  selected: number,
  localRow: number,
  maxVisible = COPY_SELECTOR_MAX_VISIBLE,
): number | undefined {
  const { start, end } = copySelectorVisibleRange(count, selected, maxVisible)
  const index = start + (localRow - COPY_SELECTOR_ITEM_ROW)
  if (index < start || index >= end) return undefined
  return index
}

/** Move the highlight to `index` without copying. */
export function selectCopyTarget(state: CopySelectorState, index: number): CopySelectorState {
  if (state.items.length === 0) return state
  const selected = Math.max(0, Math.min(index, state.items.length - 1))
  if (selected === state.selected) return state
  return { ...state, selected }
}

function moveSelected(state: CopySelectorState, next: number): CopySelectorState {
  if (state.items.length === 0) return state
  const n = state.items.length
  const selected = (next % n + n) % n
  if (selected === state.selected) return state
  return { ...state, selected }
}

/** Apply one decoded event to the overlay. */
export function applyCopySelectorEvent(state: CopySelectorState, event: KeyEvent): CopySelectorCommand {
  if (event.type === 'text' && event.value === ' ') {
    const item = state.items[state.selected]
    return item === undefined ? { kind: 'ignore' } : { kind: 'pick', item }
  }
  if (event.type !== 'key') return { kind: 'ignore' }
  switch (event.id) {
    case 'enter': {
      const item = state.items[state.selected]
      return item === undefined ? { kind: 'ignore' } : { kind: 'pick', item }
    }
    case 'escape':
    case 'ctrl+c':
      return { kind: 'close' }
    case 'up':
    case 'shift+tab':
      return { kind: 'update', state: moveSelected(state, state.selected - 1) }
    case 'down':
    case 'tab':
      return { kind: 'update', state: moveSelected(state, state.selected + 1) }
    case 'pageUp':
      return { kind: 'update', state: moveSelected(state, state.selected - COPY_SELECTOR_MAX_VISIBLE) }
    case 'pageDown':
      return { kind: 'update', state: moveSelected(state, state.selected + COPY_SELECTOR_MAX_VISIBLE) }
    case 'home':
      return { kind: 'update', state: moveSelected(state, 0) }
    case 'end':
      return { kind: 'update', state: moveSelected(state, state.items.length - 1) }
    default:
      return { kind: 'ignore' }
  }
}

/** Overlay frame: title, windowed rows, preview, hints. */
export function renderCopySelector(
  state: CopySelectorState,
  theme: Theme,
  width: number,
  maxVisible = COPY_SELECTOR_MAX_VISIBLE,
): { lines: string[]; cursor: { row: number; column: number } } {
  const count = state.items.length
  const index = Math.max(0, Math.min(state.selected, Math.max(0, count - 1)))
  const title = ' ' + theme.bold(theme.fg('accent', '⎘ Copy'))
  const { start, end } = copySelectorVisibleRange(count, index, maxVisible)
  const rows: string[] = []
  if (count === 0) {
    rows.push('  ' + theme.fg('muted', SYMBOL.info + ' Nothing to copy.'))
  } else {
    for (let i = start; i < end; i += 1) {
      const item = state.items[i]
      if (item === undefined) continue
      rows.push(renderCopyRow(item, i === index, theme, width))
    }
    if (count > maxVisible) {
      rows.push(theme.fg('dim', '  ' + String(index + 1) + '/' + String(count)))
    }
  }
  const preview = renderCopyPreview(state.items[index], theme, width)
  const hints = ' ' + theme.fg('dim', '↑↓ navigate') + theme.fg('dim', ' · ')
    + theme.fg('dim', 'enter copy') + theme.fg('dim', ' · ')
    + theme.fg('dim', 'esc close')
  const lines = ['', title, '', ...rows, '', ...preview, '', hints]
  return {
    lines,
    cursor: { row: COPY_SELECTOR_ITEM_ROW + (index - start), column: 2 },
  }
}

function renderCopyRow(item: CopyPick, selected: boolean, theme: Theme, width: number): string {
  const cursor = selected ? theme.fg('accent', SYMBOL.cursor + ' ') : '  '
  const label = selected ? theme.bold(theme.fg('accent', item.label)) : item.label
  const hint = item.hint === '' ? '' : theme.fg('dim', item.hint)
  const fill = Math.max(1, width - visibleWidth(cursor) - visibleWidth(label) - visibleWidth(hint))
  return truncateToWidth(cursor + label + ' '.repeat(fill) + hint, width)
}

function renderCopyPreview(item: CopyPick | undefined, theme: Theme, width: number): string[] {
  const header = '  ' + theme.fg('dim', item === undefined ? 'Preview' : 'Preview · ' + item.hint)
  if (item === undefined) return [header]
  const wrapped = wrapText(item.text.replace(/\t/g, '  '), Math.max(1, width - 2))
  const cap = COPY_SELECTOR_PREVIEW_LINES
  const visible = wrapped.slice(0, cap)
  const extra = wrapped.length > cap ? wrapped.length - cap : 0
  const body = visible.map((line) => truncateToWidth('  ' + theme.fg('muted', line), width))
  if (extra > 0) body.push(theme.fg('dim', '  … ' + String(extra) + ' more lines'))
  return [header, ...body]
}
