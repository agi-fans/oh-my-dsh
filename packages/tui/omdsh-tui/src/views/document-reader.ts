/** Cached source rows and navigation for terminal-owned file and diff readers. */

import type { TuiDocumentPosition, TuiDocumentSource } from '../definition.ts'
import { highlightCodeLines } from '../chrome/code-highlight.ts'
import { type Theme } from '../chrome/theme.ts'
import { expandTabs, stripAnsi, wrapCode } from '../chrome/width.ts'

export interface DocumentModel {
  lines: readonly string[]
  numbers: readonly { old?: number; next?: number }[]
  hunks: readonly number[]
}

export interface DocumentLayout {
  rows: readonly string[]
  starts: readonly number[]
  sourceRows: readonly number[]
  gutterWidth: number
}

const models = new WeakMap<TuiDocumentSource, DocumentModel>()
const layouts = new WeakMap<TuiDocumentSource, Map<string, DocumentLayout>>()
const searches = new WeakMap<TuiDocumentSource, Map<string, number[]>>()

export function documentModel(source: TuiDocumentSource): DocumentModel {
  const cached = models.get(source)
  if (cached !== undefined) return cached
  const text = stripAnsi(source.text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').replace(/\r\n?/gu, '\n')
  const lines = (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n')
  const numbers: { old?: number; next?: number }[] = []
  const hunks: number[] = []
  let old = 0, next = 0, oldRemaining = 0, nextRemaining = 0
  for (const [at, line] of lines.entries()) {
    if (!source.diff) { numbers.push({ next: at + (source.firstLine ?? 1) }); continue }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line)
    if (hunk !== null) {
      old = Number(hunk[1]); next = Number(hunk[3])
      oldRemaining = Number(hunk[2] ?? 1); nextRemaining = Number(hunk[4] ?? 1)
      hunks.push(at); numbers.push({}); continue
    }
    if (line.startsWith('-') && oldRemaining > 0) { numbers.push({ old: old++ }); oldRemaining-- }
    else if (line.startsWith('+') && nextRemaining > 0) { numbers.push({ next: next++ }); nextRemaining-- }
    else if (line.startsWith(' ') && oldRemaining > 0 && nextRemaining > 0) {
      numbers.push({ old: old++, next: next++ }); oldRemaining--; nextRemaining--
    } else numbers.push({})
  }
  const model = { lines, numbers, hunks }
  models.set(source, model)
  return model
}

/** Case-insensitive literal search; each matching source line is one destination. */
export function documentMatches(source: TuiDocumentSource, query: string): number[] {
  if (query === '') return []
  const needle = query.toLowerCase()
  let cache = searches.get(source)
  if (cache === undefined) { cache = new Map(); searches.set(source, cache) }
  const cached = cache.get(needle)
  if (cached !== undefined) return cached
  const matches = documentModel(source).lines.flatMap((line, at) => line.toLowerCase().includes(needle) ? [at] : [])
  if (cache.size >= 4) cache.clear()
  cache.set(needle, matches)
  return matches
}

/** Exact file line; diffs use the new side and reject lines outside retained hunks. */
export function documentLineRow(source: TuiDocumentSource, line: number): number | undefined {
  const at = documentModel(source).numbers.findIndex(number => number.next === line)
  return at < 0 ? undefined : at
}

/** Wrap once per source, theme, and width; scrolling only slices these rows. */
export function documentLayout(source: TuiDocumentSource, theme: Theme, width: number): DocumentLayout {
  let cache = layouts.get(source)
  if (cache === undefined) { cache = new Map(); layouts.set(source, cache) }
  const key = `${width}:${theme.name}:${theme.colors}:${theme.trueColor}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const model = documentModel(source)
  const digits = model.numbers.reduce((max, number) => Math.max(max, String(Math.max(number.old ?? 0, number.next ?? 0)).length), 1)
  const gutterWidth = source.diff ? digits * 2 + 3 : digits + 2
  const showNumbers = width > gutterWidth + 4
  const inner = Math.max(1, width - (showNumbers ? gutterWidth : 0))
  const painted = highlightCodeLines(model.lines, source.diff ? 'diff' : source.language ?? '', theme)
  const rows: string[] = [], starts: number[] = [], sourceRows: number[] = []
  for (const [at, line] of painted.entries()) {
    starts.push(rows.length)
    const number = model.numbers[at] ?? {}
    const label = source.diff
      ? `${number.old === undefined ? ''.padStart(digits) : String(number.old).padStart(digits)} ${number.next === undefined ? ''.padStart(digits) : String(number.next).padStart(digits)} `
      : `${String(number.next ?? '').padStart(digits)} `
    const segments = wrapCode(expandTabs(line), inner)
    for (const [wrap, segment] of segments.entries()) {
      rows.push((showNumbers ? ' ' + theme.fg('dim', wrap === 0 ? label : ' '.repeat(gutterWidth - 1)) : '') + segment)
      sourceRows.push(at)
    }
  }
  const layout = { rows, starts, sourceRows, gutterWidth: showNumbers ? gutterWidth : 0 }
  if (cache.size >= 2) cache.clear()
  cache.set(key, layout)
  return layout
}

export function documentStart(layout: DocumentLayout, position: TuiDocumentPosition): number {
  const row = Math.max(0, Math.min(position.row, layout.starts.length - 1))
  const start = layout.starts[row] ?? 0
  const end = layout.starts[row + 1] ?? layout.rows.length
  return start + Math.max(0, Math.min(position.wrap, end - start - 1))
}

export function documentPosition(layout: DocumentLayout, start: number, query: string): TuiDocumentPosition {
  const at = Math.max(0, Math.min(start, layout.rows.length - 1))
  const row = layout.sourceRows[at] ?? 0
  return { row, wrap: at - (layout.starts[row] ?? 0), query }
}

/** Wrap through destinations in reading order; manual scrolling chooses the nearest next one. */
export function documentDestination(rows: readonly number[], current: number, direction: 1 | -1): number | undefined {
  return direction === 1 ? rows.find(row => row > current) ?? rows[0] : rows.findLast(row => row < current) ?? rows.at(-1)
}
