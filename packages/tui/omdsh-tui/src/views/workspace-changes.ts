/**
 * Pure rendering of one turn's changed-file summary.
 *
 * The Harness keeps the summary on the host and announces only the turn, so
 * this module renders both the served form and the turn-only fallback a
 * resumed or replayed log has. Everything here is a pure function of the
 * block, theme and width: no terminal, no service, no clock.
 * @module @agi-fans/dsh-tui
 */

import type {} from '@deepseek-ai/dsh-workspace-changes'
import type { WorkspaceChangesSummary } from '@deepseek-ai/dsh-workspace-changes'
import { paintDiffStats } from '../chrome/diff-render.ts'
import type { Theme } from '../chrome/theme.ts'
import { truncateToWidth, visibleWidth } from '../chrome/width.ts'
import type { WorkspaceBlock } from './transcript-types.ts'

/** File rows a collapsed changed-files block paints before folding. */
export const WORKSPACE_COLLAPSED_LINES = 8

/** Left inset shared by the header and every file row. */
const HEADER_PREFIX = '  '

/** Continuation indent under the header. */
const FILE_PREFIX = '    '

/** Columns between the path and its counts. */
const GUTTER = '  '

/** One changed file as this view needs it, decoupled from the host payload. */
interface WorkspaceFileRow {
  display: string
  added: number
  deleted: number
  note?: string
}

/**
 * Build one render row, omitting `note` entirely for a file whose line counts
 * are meaningful. The row type declares `note` as an optional string rather
 * than `string | undefined`, so an absent note cannot be passed explicitly.
 */
function toRow(file: { display: string; added: number; deleted: number; binary?: true; oversized?: true }): WorkspaceFileRow {
  const note = fileNote(file)
  return note === undefined
    ? { display: file.display, added: file.added, deleted: file.deleted }
    : { display: file.display, added: file.added, deleted: file.deleted, note }
}

/**
 * Headline for a turn whose summary the host no longer serves.
 *
 * A resumed log replays the durable event but has no recorder behind it, and a
 * composition without the plugin never had one. Both cases must read as a
 * record that exists rather than as a failure.
 */
function fallbackLines(block: WorkspaceBlock, theme: Theme, width: number): string[] {
  const text = theme.fg('dim', `Workspace changes recorded for turn ${block.turn}`)
  return [truncateToWidth(HEADER_PREFIX + text, width)]
}

/**
 * Plain-language marker for a file whose line counts are not meaningful.
 */
function fileNote(row: { binary?: true; oversized?: true }): string | undefined {
  if (row.binary === true) return 'binary'
  if (row.oversized === true) return 'too large'
  return undefined
}

/** Plain width of a row's trailing label, which sizes the stats column. */
function statsWidth(row: WorkspaceFileRow): number {
  if (row.note !== undefined) return visibleWidth(row.note)
  const parts: string[] = []
  if (row.added > 0) parts.push(`+${row.added}`)
  if (row.deleted > 0) parts.push(`-${row.deleted}`)
  return parts.length === 0 ? 0 : parts.join('/').length
}

/**
 * Paint the file rows, aligning the counts into one column sized to the widest
 * visible path rather than to the terminal edge, so a short list reads as a
 * list instead of as a full-width ruler.
 *
 * @param rows - the visible rows, already folded.
 * @param theme - active theme.
 * @param width - terminal width in display cells.
 * @returns one painted line per row.
 */
function paintRows(rows: readonly WorkspaceFileRow[], theme: Theme, width: number): string[] {
  const widestStats = rows.reduce((widest, row) => Math.max(widest, statsWidth(row)), 0)
  const column = Math.max(1, Math.min(
    rows.reduce((widest, row) => Math.max(widest, visibleWidth(row.display)), 0),
    width - visibleWidth(FILE_PREFIX) - GUTTER.length - widestStats,
  ))
  return rows.map((row) => {
    const path = visibleWidth(row.display) > column
      ? `…${row.display.slice(-(column - 1))}`
      : row.display
    const stats = row.note === undefined
      ? paintDiffStats(row.added, row.deleted, theme)
      : theme.fg('dim', row.note)
    return truncateToWidth(
      FILE_PREFIX + theme.fg('muted', path)
      + ' '.repeat(Math.max(GUTTER.length, column - visibleWidth(path) + GUTTER.length))
      + stats,
      width,
    )
  })
}

/**
 * Render the changed-file rows of one summary, folding past the collapsed
 * limit and reporting how many files the cap omitted.
 */
export function paintWorkspaceFileRows(
  summary: WorkspaceChangesSummary,
  theme: Theme,
  width: number,
  expanded: boolean,
): string[] {
  const rows: WorkspaceFileRow[] = summary.files.map(toRow)
  const visible = expanded ? rows : rows.slice(0, WORKSPACE_COLLAPSED_LINES)
  const lines = paintRows(visible, theme, width)
  if (!expanded && rows.length > visible.length) {
    lines.push(truncateToWidth(
      FILE_PREFIX + theme.fg('dim', `… ${rows.length - visible.length} more files · ⟨Ctrl+O: Expand⟩`),
      width,
    ))
  }
  const omitted = summary.total - summary.files.length
  if (omitted > 0) {
    lines.push(truncateToWidth(
      FILE_PREFIX + theme.fg('dim', `… ${omitted} more files not listed`),
      width,
    ))
  }
  return lines
}

/**
 * Render one changed-files block: a headline naming the file count and the
 * turn's line totals, then the file rows.
 *
 * A turn that changed nothing still produces a block; it says so rather than
 * rendering an empty list, so the transcript shows the turn was measured.
 */
export function workspaceBlockLines(
  block: WorkspaceBlock,
  theme: Theme,
  width: number,
  toolsExpanded: boolean,
): string[] {
  const summary = block.summary
  if (summary === undefined) return fallbackLines(block, theme, width)
  const count = summary.total === 1 ? '1 file' : `${summary.total} files`
  const label = `${HEADER_PREFIX}Changed ${count}`
  const stats = paintDiffStats(summary.added, summary.deleted, theme)
  const headline = stats === '' ? theme.fg('dim', label) : theme.fg('dim', `${label} `) + stats
  const lines = [truncateToWidth(headline, width)]
  if (summary.files.length === 0) {
    lines.push(truncateToWidth(FILE_PREFIX + theme.fg('dim', 'No file changes'), width))
    return lines
  }
  lines.push(...paintWorkspaceFileRows(summary, theme, width, toolsExpanded))
  return lines
}
