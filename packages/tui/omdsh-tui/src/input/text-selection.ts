/** Text selection over the last painted viewport, measured in terminal cells. */
import { graphemeWidth, splitAnsi, stripAnsi } from '../chrome/width.ts'

export interface SelectionPoint { row: number; column: number }
interface Unit { text: string; start: number; end: number; index: number; endIndex: number }
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function units(line: string): Unit[] {
  let column = 0
  return Array.from(segmenter.segment(stripAnsi(line)), part => {
    const start = column
    column += graphemeWidth(part.segment)
    return { text: part.segment, start, end: column, index: part.index, endIndex: part.index + part.segment.length }
  })
}

function compare(a: SelectionPoint, b: SelectionPoint): number {
  return a.row - b.row || a.column - b.column
}

/** Highlight whole graphemes while preserving existing styles and links. */
export function highlightCells(line: string, start: number, end: number): string {
  const glyphs = units(line)
  let index = 0
  let glyphIndex = 0
  let selected = false
  let inverse = false
  let out = ''
  for (const part of splitAnsi(line)) {
    if (part.ansi) {
      out += part.value
      if (part.value.startsWith('\x1b[') && part.value.endsWith('m')) {
        const codes = part.value.slice(2, -1).split(';').map(Number)
        for (let i = 0; i < codes.length; i++) {
          const code = codes[i]
          if (code === 38 || code === 48 || code === 58) {
            i += codes[i + 1] === 2 ? 4 : codes[i + 1] === 5 ? 2 : 0
          } else if (code === 0 || code === 27) inverse = false
          else if (code === 7) inverse = true
        }
        if (selected) out += '\x1b[7m'
      }
      continue
    }
    for (const ch of part.value) {
      while (glyphIndex + 1 < glyphs.length && glyphs[glyphIndex]!.endIndex <= index) glyphIndex++
      const glyph = glyphs[glyphIndex]
      const next = glyph !== undefined && glyph.start < end && glyph.end > start
      if (next !== selected) out += next || inverse ? '\x1b[7m' : '\x1b[27m'
      selected = next
      out += ch
      index += ch.length
    }
  }
  if (selected) out += inverse ? '\x1b[7m' : '\x1b[27m'
  return out
}

/** Keeps copied text tied to what the user actually saw, never to a newer projection. */
export class TextSelection {
  #rows: readonly string[] = []
  #anchor: SelectionPoint | undefined
  #focus: SelectionPoint | undefined
  #initial: { start: SelectionPoint; end: SelectionPoint } | undefined
  #granularity: 'character' | 'word' | 'line' = 'character'
  #pressed = false
  #moved = false
  #lastClick: { point: SelectionPoint; time: number; count: number } | undefined

  get active(): boolean { return this.#anchor !== undefined }
  get dragging(): boolean { return this.#pressed }

  clear(): void {
    this.#anchor = undefined
    this.#focus = undefined
    this.#initial = undefined
    this.#rows = []
    this.#pressed = false
    this.#moved = false
    this.#lastClick = undefined
  }

  begin(rows: readonly string[], point: SelectionPoint, time = Date.now(), extend = false): void {
    if (extend && this.#anchor !== undefined && this.valid(rows)) {
      this.#pressed = true
      this.#moved = true
      this.move(point)
      return
    }
    const previous = this.#lastClick
    const count = previous !== undefined && time - previous.time <= 500
      && compare(previous.point, point) === 0 ? previous.count % 3 + 1 : 1
    this.#rows = rows.map(stripAnsi)
    this.#anchor = this.#clamp(point)
    this.#focus = this.#anchor
    this.#pressed = true
    this.#moved = false
    this.#granularity = count === 2 ? 'word' : count === 3 ? 'line' : 'character'
    this.#initial = this.#unitRange(this.#anchor)
    this.#lastClick = { point, time, count }
  }

  move(point: SelectionPoint): void {
    if (!this.#pressed || this.#anchor === undefined) return
    const focus = this.#clamp(point)
    if (compare(focus, this.#anchor) !== 0) this.#moved = true
    this.#focus = focus
  }

  release(point: SelectionPoint): string | undefined {
    if (!this.#pressed) return undefined
    this.move(point)
    this.#pressed = false
    if (!this.#moved && this.#granularity === 'character') {
      // Retain the click count for a subsequent double or triple click.
      this.#anchor = undefined
      this.#focus = undefined
      return undefined
    }
    return this.text()
  }

  valid(rows: readonly string[]): boolean {
    const range = this.#range()
    if (range === undefined) return !this.active
    if (rows.length !== this.#rows.length) return false
    for (let row = range.start.row; row <= range.end.row; row++) {
      if (stripAnsi(rows[row] ?? '') !== this.#rows[row]) return false
    }
    return true
  }

  text(): string | undefined {
    const range = this.#range()
    if (range === undefined || (!this.#moved && this.#granularity === 'character')) return undefined
    const lines: string[] = []
    for (let row = range.start.row; row <= range.end.row; row++) {
      const start = row === range.start.row ? range.start.column : 0
      const end = row === range.end.row ? range.end.column : Number.POSITIVE_INFINITY
      lines.push(units(this.#rows[row] ?? '').filter(unit => unit.start < end && unit.end > start)
        .map(unit => unit.text).join('').trimEnd())
    }
    const text = lines.join('\n')
    return text.trim() === '' ? undefined : text
  }

  /** Decorate only the viewport; a changed projection cancels a stale selection. */
  paint(rows: readonly string[]): readonly string[] {
    if (!this.active) return rows
    if (!this.valid(rows)) { this.clear(); return rows }
    const range = this.#range()
    if (range === undefined || this.text() === undefined) return rows
    return rows.map((line, row) => row < range.start.row || row > range.end.row ? line
      : highlightCells(line, row === range.start.row ? range.start.column : 0,
        row === range.end.row ? range.end.column : Number.POSITIVE_INFINITY))
  }

  #clamp(point: SelectionPoint): SelectionPoint {
    return { row: Math.max(0, Math.min(this.#rows.length - 1, point.row)), column: Math.max(0, point.column) }
  }

  #unitRange(point: SelectionPoint): { start: SelectionPoint; end: SelectionPoint } {
    const line = units(this.#rows[point.row] ?? '')
    let first = line.findIndex(unit => point.column < unit.end)
    if (first < 0) return { start: point, end: point }
    let last = first
    if (this.#granularity === 'line') { first = 0; last = line.length - 1 }
    else if (this.#granularity === 'word') {
      const category = (text: string): string => /^\s+$/u.test(text) ? 'space'
        : /^[\p{L}\p{N}_./~:@%+\\-]+$/u.test(text) ? 'word' : 'punctuation'
      const kind = category(line[first]!.text)
      if (kind !== 'punctuation') {
        while (first > 0 && category(line[first - 1]!.text) === kind) first--
        while (last + 1 < line.length && category(line[last + 1]!.text) === kind) last++
      }
    }
    return { start: { row: point.row, column: line[first]!.start }, end: { row: point.row, column: line[last]!.end } }
  }

  #range(): { start: SelectionPoint; end: SelectionPoint } | undefined {
    if (this.#anchor === undefined || this.#focus === undefined || this.#initial === undefined) return undefined
    const focus = this.#unitRange(this.#focus)
    return compare(this.#focus, this.#anchor) < 0
      ? { start: focus.start, end: this.#initial.end }
      : { start: this.#initial.start, end: focus.end }
  }
}
