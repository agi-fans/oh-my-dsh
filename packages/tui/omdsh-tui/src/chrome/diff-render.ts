/**
 * Align Harness FileDiff hunks and paint them as a terminal edit card.
 * Line LCS recovers context that the presenter stores on both sides; a 1:1
 * replacement also marks changed tokens with inverse video.
 */

import type { FileDiff } from '@deepseek-ai/dsh-tools'
import type { Theme } from './theme.ts'
import { expandTabs, wrapText } from './width.ts'

/** One painted role inside an aligned diff. */
export type DiffKind = 'path' | 'gap' | 'ctx' | 'del' | 'add'

/** A word or whitespace run inside a changed line. */
export interface DiffToken {
  readonly text: string
  readonly changed?: boolean
}

/** One display row of an aligned file diff. */
export interface DiffRow {
  readonly kind: DiffKind
  readonly tokens: readonly DiffToken[]
}

export interface DiffStats {
  readonly added: number
  readonly removed: number
}

/** Skip Myers/LCS when a side is this long; dump old then new instead. */
const ALIGN_LINE_LIMIT = 200

/** Inverse-off after each wrapped visual row so frame padding cannot inherit it. */
const INVERSE_OFF = '\x1b[27m'

function plainRow(kind: DiffKind, text: string): DiffRow {
  return { kind, tokens: [{ text }] }
}

/** Split a side's text into content lines. A trailing newline is a terminator. */
export function contentLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

export function rowText(row: DiffRow): string {
  return row.tokens.map(token => token.text).join('')
}

/**
 * Longest common subsequence walk. Equal remaining scores prefer a deletion so
 * replacements emit as a deleted run followed by an added run.
 */
function alignSequences(oldItems: readonly string[], newItems: readonly string[]): { kind: 'ctx' | 'del' | 'add'; text: string }[] {
  const oldCount = oldItems.length
  const newCount = newItems.length
  const table: Uint16Array[] = Array.from({ length: oldCount + 1 }, () => new Uint16Array(newCount + 1))
  for (let oldIndex = oldCount - 1; oldIndex >= 0; oldIndex -= 1) {
    const oldRow = table[oldIndex]
    const nextRow = table[oldIndex + 1]
    if (oldRow === undefined || nextRow === undefined) continue
    for (let newIndex = newCount - 1; newIndex >= 0; newIndex -= 1) {
      oldRow[newIndex] = oldItems[oldIndex] === newItems[newIndex]
        ? (nextRow[newIndex + 1] ?? 0) + 1
        : Math.max(nextRow[newIndex] ?? 0, oldRow[newIndex + 1] ?? 0)
    }
  }

  const rows: { kind: 'ctx' | 'del' | 'add'; text: string }[] = []
  let oldIndex = 0
  let newIndex = 0
  while (oldIndex < oldCount && newIndex < newCount) {
    if (oldItems[oldIndex] === newItems[newIndex]) {
      rows.push({ kind: 'ctx', text: oldItems[oldIndex] ?? '' })
      oldIndex += 1
      newIndex += 1
      continue
    }
    const down = table[oldIndex + 1]?.[newIndex] ?? 0
    const right = table[oldIndex]?.[newIndex + 1] ?? 0
    if (down >= right) {
      rows.push({ kind: 'del', text: oldItems[oldIndex] ?? '' })
      oldIndex += 1
    } else {
      rows.push({ kind: 'add', text: newItems[newIndex] ?? '' })
      newIndex += 1
    }
  }
  while (oldIndex < oldCount) {
    rows.push({ kind: 'del', text: oldItems[oldIndex] ?? '' })
    oldIndex += 1
  }
  while (newIndex < newCount) {
    rows.push({ kind: 'add', text: newItems[newIndex] ?? '' })
    newIndex += 1
  }
  return rows
}

function tokenize(text: string): string[] {
  return text.split(/(\s+)/u).filter(part => part !== '')
}

function highlightPair(oldText: string, newText: string): { removed: DiffRow; added: DiffRow } {
  const oldTokens = tokenize(oldText)
  const newTokens = tokenize(newText)
  if (oldTokens.length === 0 && newTokens.length === 0) {
    return { removed: plainRow('del', oldText), added: plainRow('add', newText) }
  }
  const aligned = alignSequences(oldTokens, newTokens)
  const removed: DiffToken[] = []
  const added: DiffToken[] = []
  for (const part of aligned) {
    if (part.kind === 'ctx') {
      removed.push({ text: part.text })
      added.push({ text: part.text })
    } else if (part.kind === 'del') {
      removed.push({ text: part.text, changed: true })
    } else {
      added.push({ text: part.text, changed: true })
    }
  }
  return {
    removed: { kind: 'del', tokens: removed },
    added: { kind: 'add', tokens: added },
  }
}

function applyIntraLine(rows: readonly DiffRow[]): DiffRow[] {
  const out: DiffRow[] = []
  let index = 0
  while (index < rows.length) {
    const row = rows[index]
    if (row?.kind !== 'del') {
      if (row !== undefined) out.push(row)
      index += 1
      continue
    }
    const deleted: DiffRow[] = []
    while (index < rows.length && rows[index]?.kind === 'del') {
      const next = rows[index]
      if (next !== undefined) deleted.push(next)
      index += 1
    }
    const added: DiffRow[] = []
    while (index < rows.length && rows[index]?.kind === 'add') {
      const next = rows[index]
      if (next !== undefined) added.push(next)
      index += 1
    }
    if (deleted.length === 1 && added.length === 1) {
      const pair = highlightPair(rowText(deleted[0]!), rowText(added[0]!))
      out.push(pair.removed, pair.added)
    } else {
      out.push(...deleted, ...added)
    }
  }
  return out
}

function alignHunk(oldText: string | null, newText: string): DiffRow[] {
  if (oldText === null) return contentLines(newText).map(line => plainRow('add', line))
  const oldLines = contentLines(oldText)
  const newLines = contentLines(newText)
  if (oldLines.length > ALIGN_LINE_LIMIT || newLines.length > ALIGN_LINE_LIMIT) {
    return [
      ...oldLines.map(line => plainRow('del', line)),
      ...newLines.map(line => plainRow('add', line)),
    ]
  }
  const aligned = alignSequences(oldLines, newLines).map(part => plainRow(part.kind, part.text))
  return applyIntraLine(aligned)
}

/** Align every hunk, inserting a path header or a same-file gap. */
export function alignFileDiffs(diffs: readonly FileDiff[]): DiffRow[] {
  const rows: DiffRow[] = []
  let previousPath: string | undefined
  for (const diff of diffs) {
    if (diff.path !== previousPath) rows.push(plainRow('path', diff.path))
    else rows.push(plainRow('gap', '⋯'))
    previousPath = diff.path
    rows.push(...alignHunk(diff.oldText, diff.newText))
  }
  return rows
}

export function countDiffStats(rows: readonly DiffRow[]): DiffStats {
  let added = 0
  let removed = 0
  for (const row of rows) {
    if (row.kind === 'add') added += 1
    else if (row.kind === 'del') removed += 1
  }
  return { added, removed }
}

/** Compact uncolored `+3/-1` label, omitted when both counts are zero. */
export function formatDiffStats(added: number, removed: number): string | undefined {
  if (added === 0 && removed === 0) return undefined
  const parts: string[] = []
  if (added > 0) parts.push(`+${added}`)
  if (removed > 0) parts.push(`-${removed}`)
  return parts.join('/')
}

export function formatDiffRow(row: DiffRow): string {
  const text = rowText(row)
  switch (row.kind) {
    case 'path':
    case 'gap':
      return text
    case 'ctx':
      return `  ${text}`
    case 'del':
      return `- ${text}`
    case 'add':
      return `+ ${text}`
  }
}

export function formatDiffRows(rows: readonly DiffRow[]): string[] {
  return rows.map(formatDiffRow)
}

function paintTokens(tokens: readonly DiffToken[], theme: Theme): string {
  let firstChanged = true
  let out = ''
  for (const token of tokens) {
    if (token.changed !== true) {
      out += token.text
      continue
    }
    let value = token.text
    if (firstChanged) {
      const lead = /^\s*/u.exec(value)?.[0] ?? ''
      if (lead !== '') {
        out += lead
        value = value.slice(lead.length)
      }
      firstChanged = false
    }
    if (value !== '') out += theme.inverse(value)
  }
  return out
}

/** Color a already-prefixed plain diff line (`- `, `+ `, `  `, path, or gap). */
export function paintPrefixedDiffLine(line: string, theme: Theme): string {
  if (line.startsWith('- ')) return theme.fg('toolDiffRemoved', line)
  if (line.startsWith('+ ')) return theme.fg('toolDiffAdded', line)
  if (line.startsWith('  ')) return theme.fg('toolDiffContext', line)
  return theme.fg('dim', line)
}

export function paintDiffRow(row: DiffRow, theme: Theme): string {
  const body = paintTokens(row.tokens, theme)
  switch (row.kind) {
    case 'path':
    case 'gap':
      return theme.fg('dim', rowText(row))
    case 'ctx':
      return theme.fg('toolDiffContext', `  ${body}`)
    case 'del':
      return theme.fg('toolDiffRemoved', `- ${body}`)
    case 'add':
      return theme.fg('toolDiffAdded', `+ ${body}`)
  }
}

export function paintDiffStats(added: number, removed: number, theme: Theme): string {
  const label = formatDiffStats(added, removed)
  if (label === undefined) return ''
  const parts: string[] = []
  if (added > 0) parts.push(theme.fg('toolDiffAdded', `+${added}`))
  if (removed > 0) parts.push(theme.fg('toolDiffRemoved', `-${removed}`))
  return parts.join(theme.fg('dim', '/'))
}

/** Paint, expand tabs, wrap to the framed-body width, and close inverse per row. */
export function wrapPaintedDiffRows(rows: readonly DiffRow[], theme: Theme, width: number): string[] {
  const inner = Math.max(1, width - 4)
  const lines: string[] = []
  for (const row of rows) {
    const painted = expandTabs(paintDiffRow(row, theme), 8, 2)
    for (const segment of wrapText(painted, inner)) {
      lines.push(theme.colors ? segment + INVERSE_OFF : segment)
    }
  }
  return lines
}
