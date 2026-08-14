/**
 * ANSI-aware terminal cell metrics. Frames are laid out in visible columns,
 * not string lengths — SGR / OSC sequences and wide glyphs must not shift
 * box chrome.
 * @module @omdsh/tui
 */

const ANSI_RE = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|].[^\x07\x1b]*(?:\x07|\x1b\\))/g

/** Strip CSI / OSC sequences, leaving only displayable text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

/** East-Asian / emoji / combining-mark cell width of one code point. */
export function charWidth(cp: number): number {
  if (cp === 0) return 0
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0
  if (cp >= 0x300 && cp <= 0x36f) return 0
  if (cp >= 0xfe00 && cp <= 0xfe0f) return 0
  if (cp === 0x200d || cp === 0xfe0f) return 0
  if (
    (cp >= 0x1100 && cp <= 0x115f)
    || cp === 0x2329
    || cp === 0x232a
    || (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f)
    || (cp >= 0xac00 && cp <= 0xd7a3)
    || (cp >= 0xf900 && cp <= 0xfaff)
    || (cp >= 0xfe10 && cp <= 0xfe19)
    || (cp >= 0xfe30 && cp <= 0xfe6f)
    || (cp >= 0xff00 && cp <= 0xff60)
    || (cp >= 0xffe0 && cp <= 0xffe6)
    || (cp >= 0x1f300 && cp <= 0x1f64f)
    || (cp >= 0x1f900 && cp <= 0x1f9ff)
    || (cp >= 0x1fa00 && cp <= 0x1faff)
  ) return 2
  return 1
}

/** Visible column count, ignoring ANSI and counting wide glyphs as two cells. */
export function visibleWidth(text: string): number {
  let width = 0
  for (const ch of stripAnsi(text)) {
    width += charWidth(ch.codePointAt(0) ?? 0)
  }
  return width
}

/** Split `text` into ANSI vs printable runs. */
export function splitAnsi(text: string): { ansi: boolean; value: string }[] {
  const parts: { ansi: boolean; value: string }[] = []
  let last = 0
  for (const match of text.matchAll(ANSI_RE)) {
    const index = match.index
    if (index > last) parts.push({ ansi: false, value: text.slice(last, index) })
    parts.push({ ansi: true, value: match[0] ?? '' })
    last = index + (match[0]?.length ?? 0)
  }
  if (last < text.length) parts.push({ ansi: false, value: text.slice(last) })
  return parts
}

/** `n` spaces, or empty when n < 1. */
export function padding(n: number): string {
  return n > 0 ? ' '.repeat(n) : ''
}

/**
 * Truncate to `width` cells, preserving leading ANSI and appending an ellipsis.
 * Closes SGR so a cut mid-style cannot bleed into the next cell.
 */
export function truncateToWidth(text: string, width: number, ellipsis = '…'): string {
  if (width <= 0) return ''
  if (visibleWidth(text) <= width) return text
  const ellW = visibleWidth(ellipsis)
  const budget = Math.max(0, width - ellW)
  let out = ''
  let used = 0
  for (const part of splitAnsi(text)) {
    if (part.ansi) {
      out += part.value
      continue
    }
    for (const ch of part.value) {
      const cw = charWidth(ch.codePointAt(0) ?? 0)
      if (used + cw > budget) return out + ellipsis + '\x1b[0m'
      out += ch
      used += cw
    }
  }
  return out + ellipsis + '\x1b[0m'
}

/** Pad (or truncate) so the line occupies exactly `width` cells. */
export function padToWidth(text: string, width: number): string {
  const used = visibleWidth(text)
  if (used === width) return text
  if (used > width) return truncateToWidth(text, width)
  return text + padding(width - used)
}

function splitWordsPreservingAnsi(text: string): string[] {
  const words: string[] = []
  let buf = ''
  let inEsc = false
  for (const ch of text) {
    if (ch === '\x1b') {
      inEsc = true
      buf += ch
      continue
    }
    if (inEsc) {
      buf += ch
      if (ch >= '@' && ch <= '~') inEsc = false
      continue
    }
    if (ch === ' ') {
      if (buf !== '') words.push(buf)
      buf = ''
    } else {
      buf += ch
    }
  }
  if (buf !== '') words.push(buf)
  return words
}

function hardWrapAnsi(text: string, width: number): string[] {
  const lines: string[] = []
  let current = ''
  let currentW = 0
  let pending = ''
  for (const part of splitAnsi(text)) {
    if (part.ansi) {
      pending += part.value
      continue
    }
    for (const ch of part.value) {
      const cw = charWidth(ch.codePointAt(0) ?? 0)
      if (currentW + cw > width && currentW > 0) {
        lines.push(current)
        current = ''
        currentW = 0
      }
      current += pending + ch
      pending = ''
      currentW += cw
    }
  }
  if (pending !== '') current += pending
  if (current !== '' || lines.length === 0) lines.push(current)
  return lines
}

/**
 * Word-wrap `text` to `width` cells, keeping ANSI attached to the following
 * glyph. Newlines are hard breaks. Words longer than `width` are split.
 */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return ['']
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (para === '') {
      out.push('')
      continue
    }
    if (visibleWidth(para) <= width) {
      out.push(para)
      continue
    }
    const words = splitWordsPreservingAnsi(para)
    let line = ''
    let lineW = 0
    for (const word of words) {
      const wordW = visibleWidth(word)
      const extra = line === '' ? 0 : 1
      if (lineW + extra + wordW <= width) {
        line += (line === '' ? '' : ' ') + word
        lineW += extra + wordW
      } else if (wordW <= width) {
        if (line !== '') out.push(line)
        line = word
        lineW = wordW
      } else {
        if (line !== '') out.push(line)
        const chunks = hardWrapAnsi(word, width)
        out.push(...chunks.slice(0, -1))
        line = chunks[chunks.length - 1] ?? ''
        lineW = visibleWidth(line)
      }
    }
    if (line !== '') out.push(line)
  }
  return out.length > 0 ? out : ['']
}

/** One wrapped row with its source-index span in the original (unstyled) string. */
export interface IndexedLine {
  text: string
  start: number
  end: number
}

/**
 * Wrap plain `text` (no ANSI) to `width`, carrying source offsets so a cursor
 * index can be mapped to (row, column).
 */
export function wrapIndexed(text: string, width: number): IndexedLine[] {
  if (width <= 0) return [{ text: '', start: 0, end: 0 }]
  const lines: IndexedLine[] = []
  let start = 0
  let used = 0
  let breakAt = -1
  const flush = (end: number): void => {
    lines.push({ text: text.slice(start, end), start, end })
  }
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i) ?? 0
    const ch = String.fromCodePoint(cp)
    if (ch === '\n') {
      flush(i)
      i += ch.length
      start = i
      used = 0
      breakAt = -1
      continue
    }
    const cw = charWidth(cp)
    if (used + cw > width && i > start) {
      const cut = breakAt >= start ? breakAt : i
      flush(cut)
      start = breakAt >= start ? breakAt + 1 : i
      used = 0
      breakAt = -1
      for (let j = start; j < i; ) {
        const cp2 = text.codePointAt(j) ?? 0
        const ch2 = String.fromCodePoint(cp2)
        if (ch2 === ' ') breakAt = j
        used += charWidth(cp2)
        j += ch2.length
      }
    }
    if (ch === ' ') breakAt = i
    used += cw
    i += ch.length
  }
  flush(text.length)
  return lines.length > 0 ? lines : [{ text: '', start: 0, end: 0 }]
}

/** Map a source cursor index onto wrapped rows. */
export function cursorOnWrapped(
  lines: readonly IndexedLine[],
  cursor: number,
  source: string,
): { row: number; column: number } {
  if (lines.length === 0) return { row: 0, column: 0 }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line === undefined) continue
    const next = lines[i + 1]
    if (next !== undefined && cursor === line.end && next.start === cursor) continue
    if (cursor >= line.start && cursor <= line.end) {
      return { row: i, column: visibleWidth(source.slice(line.start, cursor)) }
    }
  }
  const last = lines[lines.length - 1]
  if (last === undefined) return { row: 0, column: 0 }
  return { row: lines.length - 1, column: visibleWidth(last.text) }
}
