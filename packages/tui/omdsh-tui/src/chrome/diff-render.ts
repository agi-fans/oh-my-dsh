/**
 * Align Harness FileDiff hunks and paint them as a terminal edit card.
 * Line alignment recovers context that the presenter stores on both sides; a 1:1
 * replacement also marks changed tokens with inverse video.
 */

import type { FileDiff } from '@deepseek-ai/dsh-tools'
import { diffArrays } from 'diff'
import { highlightCodeLines, languageFromPath } from './code-highlight.ts'
import type { Theme } from './theme.ts'
import { expandTabs, wrapCode } from './width.ts'

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
  /** Resolved language id carried on `ctx` rows for syntax highlighting. */
  readonly language?: string
}

export interface DiffStats {
  readonly added: number
  readonly removed: number
}

/** Bound work by edit distance so large, mostly unchanged hunks still align. */
const MAX_LINE_EDITS = 400
const ALIGN_LINE_LIMIT = 10_000

/** Minified or extensively rewritten lines keep their red/green row marking. */
const INTRA_LINE_CHAR_LIMIT = 8_192
const MAX_WORD_EDITS = 200

/** Inverse-off after each wrapped visual row so frame padding cannot inherit it. */
const INVERSE_OFF = '\x1b[27m'

/** Foreground-off after each wrapped visual row so syntax colors cannot leak into borders. */
const FG_RESET = '\x1b[39m'

const diffSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Keep identifiers and spacing intact, with punctuation as separate tokens.
 * Emoji and combining sequences must not acquire ANSI inside one grapheme. */
function wordTokens(text: string): string[] {
  const tokens: string[] = []
  let previousKind = ''
  for (const { segment } of diffSegmenter.segment(text)) {
    const kind = /^[\p{L}\p{M}\p{N}_]+$/u.test(segment) ? 'word' : /^\s+$/u.test(segment) ? 'space' : 'punctuation'
    if (kind !== 'punctuation' && previousKind === kind) tokens[tokens.length - 1] += segment
    else tokens.push(segment)
    previousKind = kind
  }
  return tokens
}

function plainRow(kind: DiffKind, text: string): DiffRow {
  return { kind, tokens: [{ text }] }
}

/** A context row carrying the file's resolved language for syntax highlighting. */
function ctxRow(text: string, language: string | undefined): DiffRow {
  if (language === undefined) return { kind: 'ctx', tokens: [{ text }] }
  return { kind: 'ctx', tokens: [{ text }], language }
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

function highlightPair(oldText: string, newText: string): { removed: DiffRow; added: DiffRow } {
  if (oldText.length > INTRA_LINE_CHAR_LIMIT || newText.length > INTRA_LINE_CHAR_LIMIT) {
    return { removed: plainRow('del', oldText), added: plainRow('add', newText) }
  }
  const aligned = diffArrays(wordTokens(oldText), wordTokens(newText), { maxEditLength: MAX_WORD_EDITS })
  if (aligned === undefined) return { removed: plainRow('del', oldText), added: plainRow('add', newText) }
  const removed: DiffToken[] = []
  const added: DiffToken[] = []
  for (const part of aligned) {
    const text = part.value.join('')
    if (part.removed) {
      removed.push({ text, changed: true })
    } else if (part.added) {
      added.push({ text, changed: true })
    } else {
      removed.push({ text })
      added.push({ text })
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

function alignHunk(oldText: string | null, newText: string, language: string | undefined): DiffRow[] {
  if (oldText === null) return contentLines(newText).map(line => plainRow('add', line))
  const oldLines = contentLines(oldText)
  const newLines = contentLines(newText)
  const changes = oldLines.length > ALIGN_LINE_LIMIT || newLines.length > ALIGN_LINE_LIMIT
    ? undefined
    : diffArrays(oldLines, newLines, { maxEditLength: MAX_LINE_EDITS })
  if (changes === undefined) {
    return [
      ...oldLines.map(line => plainRow('del', line)),
      ...newLines.map(line => plainRow('add', line)),
    ]
  }
  const aligned = changes.flatMap(part => part.value.map(text =>
    part.removed ? plainRow('del', text) : part.added ? plainRow('add', text) : ctxRow(text, language),
  ))
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
    const language = languageFromPath(diff.path)
    rows.push(...alignHunk(diff.oldText, diff.newText, language))
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

/**
 * Highlight consecutive context rows that share a resolved language as one
 * block, returning a map from row index to its syntax-painted body. Rows
 * without a language (path, gap, add, delete, or unknown-file context) are
 * absent and fall back to {@link paintDiffRow}. The context style keeps the
 * unchanged-line ink dim while keywords and literals light up, so added and
 * deleted rows keep unambiguous green and red semantics.
 */
function highlightContextBodies(rows: readonly DiffRow[], theme: Theme): Map<number, string> {
  const map = new Map<number, string>()
  if (!theme.colors) return map
  let runStart = -1
  let runLang = ''
  const flush = (end: number): void => {
    if (runStart === -1) return
    const texts: string[] = []
    for (let i = runStart; i < end; i += 1) texts.push(rowText(rows[i]!))
    const highlighted = highlightCodeLines(texts, runLang, theme, { color: 'toolDiffContext' })
    for (let i = 0; i < highlighted.length; i += 1) map.set(runStart + i, highlighted[i] ?? '')
    runStart = -1
    runLang = ''
  }
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!
    if (row.kind === 'ctx' && row.language !== undefined) {
      if (runStart === -1) {
        runStart = i
        runLang = row.language
      } else if (row.language !== runLang) {
        flush(i)
        runStart = i
        runLang = row.language
      }
    } else {
      flush(i)
    }
  }
  flush(rows.length)
  return map
}

/** Paint a syntax-highlighted context row: dim gutter, highlighted body. */
function paintContextRow(highlightedBody: string, theme: Theme): string {
  return theme.fg('toolDiffContext', '  ') + highlightedBody
}

export function paintDiffStats(added: number, removed: number, theme: Theme): string {
  const label = formatDiffStats(added, removed)
  if (label === undefined) return ''
  const parts: string[] = []
  if (added > 0) parts.push(theme.fg('toolDiffAdded', `+${added}`))
  if (removed > 0) parts.push(theme.fg('toolDiffRemoved', `-${removed}`))
  return parts.join(theme.fg('dim', '/'))
}

/** Paint, expand tabs, wrap to the framed-body width, and close inverse and foreground per row. */
export function wrapPaintedDiffRows(rows: readonly DiffRow[], theme: Theme, width: number): string[] {
  const inner = Math.max(1, width - 4)
  const lines: string[] = []
  const ctxBodies = highlightContextBodies(rows, theme)
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!
    const ctxBody = ctxBodies.get(i)
    const painted = ctxBody === undefined ? paintDiffRow(row, theme) : paintContextRow(ctxBody, theme)
    const expanded = expandTabs(painted, 8, 2)
    for (const segment of wrapCode(expanded, inner)) {
      lines.push(theme.colors ? segment + INVERSE_OFF + FG_RESET : segment)
    }
  }
  return lines
}
