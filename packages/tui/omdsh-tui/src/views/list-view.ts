/**
 * The one shape every interactive list in omdsh draws.
 *
 * Each surface once grew its own list renderer — autocomplete, prompt selectors,
 * settings, history search, the plugin browser — and each arrived at a
 * slightly different cursor glyph, column layout, and scroll counter. A reader learns the list idiom once, so it should look the same
 * everywhere: a single-cell selection prefix, an optional primary column held to
 * one width so descriptions line up, a right-aligned value or counter, and the
 * same `(n/total)` footnote when the list is windowed.
 *
 * Pure: no terminal, no state. Callers own selection and filtering.
 * @module @agi-fans/dsh-tui
 */

import type { Theme } from '../chrome/theme.ts'
import { padToWidth, truncateToWidth, visibleWidth } from '../chrome/width.ts'

/** The two cells every row reserves so selection does not shift its text. */
export const LIST_CURSOR_CELLS = 2
/** Minimum gap between a primary column and its description. */
const COLUMN_GAP = 2
/** A description narrower than this says too little to be worth a column. */
const MIN_DESCRIPTION_WIDTH = 12

export interface ListRow {
  /** Primary column: the name the reader is choosing. */
  readonly label: string
  readonly description?: string
  /** Right-aligned value, badge, or state; drawn after the description. */
  readonly value?: string
  /** Painted dim and not selectable; the caller is expected to skip it. */
  readonly heading?: boolean
  /** Reserve the cursor cell but draw no cursor, for a row that is disabled. */
  readonly secondary?: boolean
  /**
   * Tone of the primary column when the row is not selected.
   *
   * A list that mixes kinds — slash commands among file paths — needs to say so
   * without relying on the reader's eye catching a leading character.
   */
  readonly tone?: 'accent' | 'muted'
}

export interface ListRowOptions {
  readonly selected: boolean
  /** Glyph in the cursor cell; `❯` by default so every list agrees. */
  readonly cursor?: string
  /** Tint the description column; off for lists that already carry one. */
  readonly dimDescription?: boolean
  /** Draw a leading `↑`/`↓` scroll mark in the cursor cell of an edge row. */
  readonly edge?: 'up' | 'down'
  /** Selection was moved with a reorder gesture rather than a plain move. */
  readonly moving?: boolean
}

export interface ListOptions {
  /** Rows to draw, already filtered and in display order. */
  readonly rows: readonly ListRow[]
  readonly selected: number
  readonly width: number
  /**
   * How many rows the surface can show. When the list is longer, it is windowed
   * around the selection and a `(n/total)` footnote is appended.
   */
  readonly maxVisible?: number
}

/**
 * Choose the rows a windowed list shows.
 *
 * Centred on the selection with both ends clamped, so the first and last rows
 * are reachable without the list jumping; there is no wrap-around, because a
 * filtered list that silently returns to its top reads as a lost selection.
 */
export function listVisibleRange(
  count: number,
  selected: number,
  maxVisible: number,
): { start: number; end: number } {
  const max = Math.max(1, Math.floor(maxVisible))
  if (count <= max) return { start: 0, end: count }
  const index = Math.max(0, Math.min(selected, count - 1))
  const start = Math.max(0, Math.min(index - Math.floor(max / 2), count - max))
  return { start, end: start + max }
}

/**
 * Width of the primary column.
 *
 * Held to one value per list rather than per row: a description column that
 * starts at a different place on every line is the single most common reason a
 * hand-rolled list looks unfinished.
 */
export function listPrimaryColumnWidth(rows: readonly ListRow[], totalWidth: number): number {
  const widest = rows.reduce((widest, row) => Math.max(widest, visibleWidth(row.label)), 0)
  const room = Math.max(0, totalWidth - LIST_CURSOR_CELLS - COLUMN_GAP)
  // Leave at least a description-sized column before agreeing to align at all.
  const ceiling = Math.max(0, room - MIN_DESCRIPTION_WIDTH)
  return Math.max(0, Math.min(widest, ceiling))
}

/**
 * The first cell of a row: an edge mark, the cursor, or blank.
 *
 * An edge mark outranks the cursor because it answers a question the cursor
 * cannot — "is there more above me?" — and it is drawn on whichever row sits at
 * the boundary, selected or not.
 */
function listCursorCell(theme: Theme, options: ListRowOptions): string {
  if (options.edge !== undefined) return theme.fg('dim', (options.edge === 'up' ? '↑' : '↓') + ' ')
  if (!options.selected) return ' '.repeat(LIST_CURSOR_CELLS)
  return theme.fg('accent', (options.moving === true ? '↕' : options.cursor ?? '❯') + ' ')
}

/** Draw one row at exactly `width` display cells. */
export function renderListRow(row: ListRow, theme: Theme, width: number, options: ListRowOptions): string {
  const room = Math.max(1, width)
  if (row.heading === true) {
    return truncateToWidth(' '.repeat(LIST_CURSOR_CELLS) + theme.fg('dim', row.label), room)
  }
  const cursor = listCursorCell(theme, options)
  const label = options.selected
    ? theme.bold(theme.fg('accent', row.label))
    : row.tone === 'accent' ? theme.fg('accent', row.label)
      : row.secondary === true ? theme.fg('dim', row.label) : row.label
  const value = row.value === undefined || row.value === ''
    ? ''
    : theme.fg(options.selected ? 'accent' : 'muted', row.value)
  const fixed = LIST_CURSOR_CELLS + visibleWidth(row.value ?? '') + (value === '' ? 0 : 0)
  const descriptionRoom = room - fixed - (row.value === undefined || row.value === '' ? 0 : visibleWidth(row.value))
  const description = row.description === undefined || row.description === '' || descriptionRoom <= MIN_DESCRIPTION_WIDTH
    ? ''
    : '  ' + (options.dimDescription === false ? row.description : theme.fg('muted', row.description))
  if (value === '') {
    const body = cursor + label + truncateToWidth(description, Math.max(0, room - fixed - visibleWidth(row.label)))
    return truncateToWidth(row.description === undefined ? body.replace(/\s+$/u, '') : body, room)
  }
  const gap = Math.max(2, descriptionRoom - visibleWidth(description) - visibleWidth(row.label))
  return truncateToWidth(cursor + label + truncateToWidth(description, Math.max(0, descriptionRoom - visibleWidth(row.label))) + ' '.repeat(gap) + value, room)
}

/** The `(n/total)` line a windowed list prints below itself. */
export function renderListCounter(theme: Theme, selected: number, count: number, width: number): string {
  return truncateToWidth(
    ' '.repeat(LIST_CURSOR_CELLS) + theme.fg('dim', `(${Math.max(0, selected) + 1}/${count})`),
    Math.max(1, width),
  )
}

/**
 * Draw a whole list: the visible window, the scroll marks, and the counter.
 *
 * Every list surface calls this instead of slicing its own window, which is what
 * keeps the counter, the edge marks, and the cursor agreed about where the
 * reader is.
 */
export function renderList(list: ListOptions, theme: Theme, rowOptions: Omit<ListRowOptions, 'selected' | 'edge' | 'moving'> = {}): string[] {
  const { rows, selected, width } = list
  if (rows.length === 0) return []
  const index = Math.max(0, Math.min(selected, rows.length - 1))
  const maxVisible = list.maxVisible ?? rows.length
  const { start, end } = listVisibleRange(rows.length, index, maxVisible)
  const lines: string[] = []
  for (let at = start; at < end; at += 1) {
    const row = rows[at]
    if (row === undefined) continue
    const edge = at === start && start > 0 ? 'up' : at === end - 1 && end < rows.length ? 'down' : undefined
    lines.push(renderListRow(row, theme, width, { ...rowOptions, selected: at === index, ...(edge === undefined ? {} : { edge }) }))
  }
  if (end - start < rows.length) lines.push(renderListCounter(theme, index, rows.length, width))
  return lines
}

/**
 * Draw a row whose primary column is held to a fixed width for the whole list.
 *
 * Settings and status rows put a value hard against the right edge, which needs
 * the full frame width rather than a trailing description column. The layout is
 * additive and exact: cursor cells, the padded primary column, a two-cell gap,
 * the description, then fill, then the right-aligned value — so the row lands on
 * exactly `width` cells whatever the labels measure in.
 */
export function renderListRowWithValue(
  row: ListRow,
  theme: Theme,
  width: number,
  primaryWidth: number,
  options: ListRowOptions,
): string {
  const room = Math.max(1, width)
  const cursor = listCursorCell(theme, options)
  const label = options.selected
    ? theme.bold(theme.fg('accent', row.label))
    : row.tone === 'accent' ? theme.fg('accent', row.label)
      : row.secondary === true ? theme.fg('dim', row.label) : row.label
  const value = row.value === undefined || row.value === '' ? '' : theme.fg(options.selected ? 'accent' : 'muted', row.value)
  const primaryCells = Math.max(primaryWidth, visibleWidth(row.label))
  const primary = label + ' '.repeat(Math.max(0, primaryCells - visibleWidth(row.label)))
  const valueCells = visibleWidth(row.value ?? '')
  const descriptionRoom = room - LIST_CURSOR_CELLS - primaryCells - COLUMN_GAP - valueCells
  const descriptionText = row.description === undefined || row.description === '' || descriptionRoom <= MIN_DESCRIPTION_WIDTH
    ? ''
    : truncateToWidth(row.description, descriptionRoom)
  const description = descriptionText === '' ? '' : COLUMN_GAP_SPACE + (options.dimDescription === false ? descriptionText : theme.fg('muted', descriptionText))
  const body = cursor + primary + description
  // Only a right-aligned value earns trailing padding. A row that ends in its
  // description stops there, so the line's last cell still belongs to something
  // the reader can see — and two adjacent rows never differ by invisible spaces.
  if (value === '') return truncateToWidth(body.trimEnd() === '' ? body : body, room)
  const fill = Math.max(1, room - LIST_CURSOR_CELLS - primaryCells - visibleWidth(description) - valueCells)
  return truncateToWidth(body + ' '.repeat(fill) + value, room)
}

/**
 * The two-cell gap between a primary column and its description.
 *
 * One cell reads as a typo and three push the description too far from the name
 * it belongs to, so it is a named constant rather than a scatter of literals.
 */
const COLUMN_GAP_SPACE = ' '.repeat(COLUMN_GAP)

/** Pad a row to the full width so a background surface paints edge to edge. */
export function padListRow(text: string, width: number): string {
  return padToWidth(text, Math.max(0, width))
}
