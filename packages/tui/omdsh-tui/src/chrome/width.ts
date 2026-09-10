/**
 * ANSI-aware terminal cell metrics. Frames are laid out in visible columns,
 * not string lengths — SGR / OSC sequences and wide glyphs must not shift
 * box chrome.
 * @module @agi-fans/dsh-tui
 */

const ANSI_RE = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|].[^\x07\x1b]*(?:\x07|\x1b\\))/g

/** Strip CSI / OSC sequences, leaving only displayable text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

function isWideEmojiSymbol(cp: number): boolean {
  return (
    (cp >= 0x231a && cp <= 0x231b)
    || (cp >= 0x23e9 && cp <= 0x23ec)
    || cp === 0x23f0
    || cp === 0x23f3
    || (cp >= 0x25fd && cp <= 0x25fe)
    || (cp >= 0x2614 && cp <= 0x2615)
    || (cp >= 0x2648 && cp <= 0x2653)
    || cp === 0x267f
    || cp === 0x2693
    || cp === 0x26a1
    || (cp >= 0x26aa && cp <= 0x26ab)
    || (cp >= 0x26bd && cp <= 0x26be)
    || (cp >= 0x26c4 && cp <= 0x26c5)
    || cp === 0x26ce
    || cp === 0x26d4
    || cp === 0x26ea
    || (cp >= 0x26f2 && cp <= 0x26f3)
    || cp === 0x26f5
    || cp === 0x26fa
    || cp === 0x26fd
    || cp === 0x2705
    || (cp >= 0x270a && cp <= 0x270b)
    || cp === 0x2728
    || cp === 0x274c
    || cp === 0x274e
    || (cp >= 0x2753 && cp <= 0x2755)
    || cp === 0x2757
    || (cp >= 0x2795 && cp <= 0x2797)
    || cp === 0x27b0
    || cp === 0x27bf
    || (cp >= 0x2b1b && cp <= 0x2b1c)
    || cp === 0x2b50
    || cp === 0x2b55
  )
}

/** East-Asian / emoji / combining-mark cell width of one code point. */
export function charWidth(cp: number): number {
  if (cp === 0) return 0
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0
  if (cp >= 0x300 && cp <= 0x36f) return 0
  if (cp >= 0xfe00 && cp <= 0xfe0f) return 0
  if (cp === 0x200d || cp === 0xfe0f) return 0
  // Skin-tone modifiers fold into the preceding base glyph and never advance
  // the cursor, so they must be measured as zero rather than as emoji.
  if (cp >= 0x1f3fb && cp <= 0x1f3ff) return 0
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
    || isWideEmojiSymbol(cp)
    || (cp >= 0x1f300 && cp <= 0x1f64f)
    // Transport and map symbols (🚀 U+1F680, 🛸 U+1F6F8, …). Ornamental
    // dingbats (U+1F650–U+1F67F) sit between the two emoji blocks and are
    // text-presentation, so they stay one cell.
    || (cp >= 0x1f680 && cp <= 0x1f6ff)
    // Large coloured circles and squares (U+1F7E0–U+1F7EB).
    || (cp >= 0x1f7e0 && cp <= 0x1f7eb)
    || (cp >= 0x1f900 && cp <= 0x1f9ff)
    || (cp >= 0x1fa00 && cp <= 0x1faff)
  ) return 2
  return 1
}

let clusterSegmenter: Intl.Segmenter | undefined

/**
 * Clusters that a terminal draws as a single glyph but that per-code-point
 * summing gets wrong: ZWJ sequences, emoji presentation selectors, and
 * regional-indicator pairs. Everything else — including skin-tone modifiers
 * and combining marks, which `charWidth` already reports as zero — keeps the
 * per-code-point fast path.
 */
const CLUSTER_RE = /[\u200D\uFE0F\u{1F1E6}-\u{1F1FF}]/u

const REGIONAL_PAIR_RE = /^\p{Regional_Indicator}{2}$/u

function segments(text: string): Intl.Segments {
  clusterSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return clusterSegmenter.segment(text)
}

/**
 * Cell width of one grapheme cluster.
 *
 * Clusters that fold several code points into a single terminal glyph occupy
 * two cells on mainstream terminals, so they are measured as a unit instead of
 * summing their parts (which would report a ZWJ family as eight). Clusters
 * without ZWJ, an emoji presentation selector, or a regional-indicator pair
 * fall back to per-code-point summing, which is also what makes decomposed
 * sequences such as `e` + U+0301 measure as one cell.
 */
export function graphemeWidth(cluster: string): number {
  if (cluster === '') return 0
  if (cluster.length === 1) return charWidth(cluster.codePointAt(0) ?? 0)
  if (cluster.includes('\u200D') || cluster.includes('\uFE0F')) return 2
  if (REGIONAL_PAIR_RE.test(cluster)) return 2
  let width = 0
  for (const ch of cluster) width += charWidth(ch.codePointAt(0) ?? 0)
  return width
}

/** Iterate `text` as grapheme clusters, using code points when that suffices. */
function* clusters(text: string): Generator<string> {
  if (!CLUSTER_RE.test(text)) {
    for (const ch of text) yield ch
    return
  }
  for (const part of segments(text)) yield part.segment
}

/**
 * Grapheme spans with their UTF-16 offsets. Callers that must map a cursor
 * back onto a wrapped row need both the cluster text and where it starts, so
 * the offsets stay valid indices into the original string.
 */
function clusterSpans(text: string): { index: number; cluster: string }[] {
  const spans: { index: number; cluster: string }[] = []
  if (!CLUSTER_RE.test(text)) {
    for (let i = 0; i < text.length;) {
      const ch = String.fromCodePoint(text.codePointAt(i) ?? 0)
      spans.push({ index: i, cluster: ch })
      i += ch.length
    }
    return spans
  }
  for (const part of segments(text)) spans.push({ index: part.index, cluster: part.segment })
  return spans
}

/** Visible column count, ignoring ANSI and counting wide glyphs as two cells. */
export function visibleWidth(text: string): number {
  const plain = stripAnsi(text)
  if (!CLUSTER_RE.test(plain)) {
    let width = 0
    for (const ch of plain) width += charWidth(ch.codePointAt(0) ?? 0)
    return width
  }
  let width = 0
  for (const part of segments(plain)) width += graphemeWidth(part.segment)
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

/**
 * Replace tabs with spaces using terminal tab stops while preserving ANSI.
 * `initialColumn` is the screen column where the text will begin.
 */
export function expandTabs(text: string, tabWidth = 8, initialColumn = 0): string {
  const size = Math.max(1, Math.trunc(tabWidth))
  let column = Math.max(0, Math.trunc(initialColumn))
  let out = ''
  for (const part of splitAnsi(text)) {
    if (part.ansi) {
      out += part.value
      continue
    }
    for (const cluster of clusters(part.value)) {
      if (cluster === '\t') {
        const spaces = size - (column % size)
        out += ' '.repeat(spaces)
        column += spaces
      } else {
        out += cluster
        if (cluster === '\n') column = Math.max(0, Math.trunc(initialColumn))
        else column += graphemeWidth(cluster)
      }
    }
  }
  return out
}

/** `n` spaces, or empty when n < 1. */
export function padding(n: number): string {
  return n > 0 ? ' '.repeat(n) : ''
}

/**
 * Truncate to `width` cells, preserving leading ANSI and appending an ellipsis.
 * Clusters are atomic: a ZWJ sequence, emoji presentation sequence, or flag is
 * either kept whole or dropped, never cut into a dangling joiner. Closes SGR so
 * a cut mid-style cannot bleed into the next cell.
 */
export function truncateToWidth(text: string, width: number, ellipsis = '…'): string {
  if (width <= 0) return ''
  if (visibleWidth(text) <= width) return text
  const ellW = visibleWidth(ellipsis)
  const budget = Math.max(0, width - ellW)
  let out = ''
  let used = 0
  let reset = ''
  for (const part of splitAnsi(text)) {
    if (part.ansi) {
      out += part.value
      if (part.value.endsWith('m')) reset = '\x1b[0m'
      continue
    }
    for (const cluster of clusters(part.value)) {
      const cw = graphemeWidth(cluster)
      if (used + cw > budget) return out + ellipsis + reset
      out += cluster
      used += cw
    }
  }
  return out + ellipsis + reset
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
    for (const cluster of clusters(part.value)) {
      const cw = graphemeWidth(cluster)
      if (currentW + cw > width && currentW > 0) {
        lines.push(current)
        current = ''
        currentW = 0
      }
      current += pending + cluster
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
  // A tab carries no cell width of its own, so a paragraph that still holds one
  // would be measured short and overflow its row. Callers that prefix padding
  // expand before adding it, so the tab stop accounts for that padding; the
  // expansion here covers the remaining entry points from column zero.
  const expanded = text.includes('\t') ? expandTabs(text, 8, 0) : text
  const out: string[] = []
  for (const para of expanded.split('\n')) {
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

/** Tracked SGR attributes carried across wrapped visual rows. */
interface SgrState {
  /** Last opened foreground escape (e.g. `\x1b[31m`, `\x1b[38;2;...m`) or '' when reset to default. */
  fg: string
  inverse: boolean
  bold: boolean
  italic: boolean
}

const SGR_PARAM_RE = /\x1b\[([0-9;]*)m/g

/** Apply one SGR escape to `state`, returning the new state. */
function applySgr(state: SgrState, params: string): SgrState {
  if (params === '') return { fg: '', inverse: false, bold: false, italic: false }
  const codes = params.split(';').map(Number)
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i] ?? 0
    if (code === 0) return { fg: '', inverse: false, bold: false, italic: false }
    if (code === 39) return { ...state, fg: '' }
    if (code === 7) state = { ...state, inverse: true }
    else if (code === 27) state = { ...state, inverse: false }
    else if (code === 1) state = { ...state, bold: true }
    else if (code === 22) state = { ...state, bold: false }
    else if (code === 3) state = { ...state, italic: true }
    else if (code === 23) state = { ...state, italic: false }
    else if (code === 38) {
      // 38;...m foreground sequence (256-color or truecolor): consume the rest.
      state = { ...state, fg: `\x1b[${params}m` }
      break
    } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      state = { ...state, fg: `\x1b[${code}m` }
    }
  }
  return state
}

/** Build the reopen sequence that restores `state` at a continuation start. */
function reopenSgr(state: SgrState): string {
  let out = state.fg
  if (state.bold) out += '\x1b[1m'
  if (state.italic) out += '\x1b[3m'
  if (state.inverse) out += '\x1b[7m'
  return out
}

/**
 * Reopen active SGR (foreground, inverse, bold, italic) at the start of each
 * continuation row. `wrapText` keeps ANSI attached to the following glyph but
 * does not synthesize a reopening sequence when a row closes an attribute and
 * the next row begins with plain text — so narrow wrapped styled rows lose
 * their semantic color or inverse at line breaks. This restabilizes each row
 * by tracking the SGR state accumulated from all preceding rows and prepending
 * the reopen sequence. No-op for unstyled or single-row output.
 */
export function restabilizeWrapSegments(segments: readonly string[]): string[] {
  if (segments.length <= 1) return [...segments]
  const out: string[] = [segments[0] ?? '']
  let state: SgrState = { fg: '', inverse: false, bold: false, italic: false }
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i] ?? ''
    // Reopen the state accumulated from *prior* rows before this row's own
    // escapes run, so the continuation inherits the active style rather than
    // re-applying escapes that already occur in this row.
    if (i > 0) {
      const reopen = reopenSgr(state)
      out.push(reopen === '' ? seg : reopen + seg)
    }
    SGR_PARAM_RE.lastIndex = 0
    for (const match of seg.matchAll(SGR_PARAM_RE)) {
      state = applySgr(state, match[1] ?? '')
    }
  }
  return out
}

/**
 * Word-wrap styled `text` to `width` and restabilize SGR at every continuation
 * row so foreground, inverse, bold, and italic attributes survive line breaks.
 */
export function wrapTextStable(text: string, width: number): string[] {
  return restabilizeWrapSegments(wrapText(text, width))
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
 *
 * Tabs are deliberately not expanded here: a literal tab is a completion key in
 * the composer rather than buffer content, and expanding would invalidate the
 * UTF-16 offsets this returns. A tab that did reach the buffer would measure as
 * zero cells, so callers must keep it out of the text.
 */
export function wrapIndexed(text: string, width: number): IndexedLine[] {
  if (width <= 0) return [{ text: '', start: 0, end: 0 }]
  const lines: IndexedLine[] = []
  const spans = clusterSpans(text)
  let start = 0
  let used = 0
  let breakAt = -1
  const flush = (end: number): void => {
    lines.push({ text: text.slice(start, end), start, end })
  }
  for (const span of spans) {
    const i = span.index
    const cluster = span.cluster
    if (cluster === '\n') {
      flush(i)
      start = i + 1
      used = 0
      breakAt = -1
      continue
    }
    const cw = graphemeWidth(cluster)
    if (used + cw > width && i > start) {
      const cut = breakAt >= start ? breakAt : i
      flush(cut)
      start = breakAt >= start ? breakAt + 1 : i
      used = 0
      breakAt = -1
      for (const inner of spans) {
        if (inner.index < start) continue
        if (inner.index >= i) break
        if (inner.cluster === ' ') breakAt = inner.index
        used += graphemeWidth(inner.cluster)
      }
    }
    if (cluster === ' ') breakAt = i
    used += cw
  }
  flush(text.length)
  return lines.length > 0 ? lines : [{ text: '', start: 0, end: 0 }]
}

/** Map a visible column on a wrapped row back to a source index. */
export function indexOnWrapped(line: IndexedLine, column: number, source: string): number {
  const target = Math.max(0, column)
  let col = 0
  for (const span of clusterSpans(source.slice(line.start, line.end))) {
    const width = graphemeWidth(span.cluster)
    if (col + width > target) return line.start + span.index
    col += width
  }
  return line.end
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
