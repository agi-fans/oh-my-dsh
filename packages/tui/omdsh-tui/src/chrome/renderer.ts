/**
 * Shared frame definitions and display-line sanitization for the renderers.
 *
 * The main-screen renderer owns the live ANSI painting; this module keeps
 * the frame shape, the write sink, and sanitization used by both it and the
 * pure view pipeline.
 * @module @agi-fans/dsh-tui
 */

/** Transcript viewport after the height clip (OMP ScrollView equivalent). */
export interface TranscriptScroll {
  /** First body row shown (0 = top of the welcome/transcript). */
  start: number
  /** Largest start that still pins the tail. */
  maxStart: number
  /** Rows budgeted for the transcript window (indicators included). */
  budget: number
  /** Body rows above the window. */
  hiddenAbove: number
  /** Body rows below the window. */
  hiddenBelow: number
  /**
   * Which of the transcript body's rows the window shows, and where in `lines`
   * they start; see {@link Frame.documentRows} for the three states.
   */
  documentRows?: DocumentRows | null
  /**
   * Body row offset of each transcript block, so a host key binding can aim at
   * the block the reader is actually looking at rather than the newest one.
   */
  blockStarts?: readonly number[]
  /**
   * Which runs, calls, and thoughts are open, as one comparable string.
   *
   * When it changes, rows above the screen changed shape in place, and the
   * host has to tell the renderer so its frozen-history boundary follows.
   */
  foldShape?: string
  /** Every open surface — a run's shape, an opened call or thought — and its body row. */
  foldMarks?: readonly FoldMark[]
  /** Frame row, in a frame that follows the tail, where the transcript body starts. */
  bodyRow?: number
  /**
   * First body row of each block's own drawn span, when a search moved that
   * block's `blockStarts` elsewhere.
   *
   * A search may aim the reader at the thought a block also carries, which is a
   * row *before* the block's words. The boundary mapper infers a block's span
   * from its neighbours' offsets, so it must not be given that navigation
   * offset: the span would read as starting earlier, its length would appear to
   * change, and the mapper would freeze from the wrong place. This is the
   * block's own drawn start, which does not move for a search.
   */
  blockDrawStarts?: readonly number[]
}

/** One open surface of the transcript, keyed by what it is and how it is open. */
export interface FoldMark {
  key: string
  /** Body row where the surface starts. */
  row: number
}

/**
 * The document rows a frame's body was drawn from.
 *
 * Half-open. `Frame.lines`' `[frameStart, frameStart + L)` correspond row by
 * row to `[documentStart, documentEnd)`, in the same coordinate space the
 * renderer's frozen boundary counts — absolute rows including the header, not
 * an offset within the transcript.
 */
export interface DocumentRows {
  documentStart: number
  documentEnd: number
  frameStart: number
}

/** One display frame: exact lines plus an optional final cursor position. */
export interface Frame {
  /** Viewport-only prompt labels, active within half-open document row ranges. */
  stickyHeaders?: readonly { start: number; end: number; text: string }[]
  /** Click target for returning from transcript browsing, in zero-based frame cells. */
  jumpToLatest?: { row: number; column: number; width: number }
  /** Display lines, exactly as written (ANSI escapes allowed). */
  lines: readonly string[]
  /**
   * Which document rows this frame's body was drawn from.
   *
   * Three states, and the difference matters: an object is a known range, `null`
   * is a frame that deliberately drew no body — an overlay, or a window with
   * nothing but an overflow marker — and leaving it out is *unknown*, which is a
   * gap in the information rather than an answer. A renderer may not read an
   * unknown source as "no body" and clear its record, nor keep crediting the
   * previous frame's range to it. Every frame the product builds states it.
   */
  documentRows?: DocumentRows | null
  /** Final cursor position, 0-based; defaults to (lines.length, 0). */
  cursor?: { row: number; column: number }
  /** False for non-editable overlays that use a painted selection marker. */
  cursorVisible?: boolean
  /** Clipped transcript window; omitted when the view has no body budget. */
  transcript?: TranscriptScroll
  /** Full-screen prompt review document scroll state, when one is active. */
  promptDocument?: { start: number; maxStart: number; pageSize: number }
  /** First line that is still live/mutable for main-screen scrollback; rows before this are committed. */
  liveStart?: number
  /** True when the live region must stay in the viewport instead of scrolling as frozen snapshots. */
  livePinned?: boolean
  /**
   * Why a frame with {@link liveStart} zero is transient. Both reasons paint into
   * the mutable screen instead of scrolling history, but they want opposite
   * handling: a full-screen overlay may borrow the alternate buffer, while
   * browsing history must stay on the main screen so the terminal's own
   * scrollback keeps working. Omitted keeps the overlay behavior.
   */
  transientSurface?: 'overlay' | 'scroll'
}

/** The write sink a renderer emits into (stdout or a test capture). */
export interface RenderSink {
  write(chunk: string): void
}

const DISPLAY_ESCAPE = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/gu
const UNSAFE_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu

// Bound memo: settled rows stay byte-identical across paints, so a long
// session repaints without re-sanitizing the whole history every frame.
const sanitizeCache = new Map<string, string>()
const SANITIZE_CACHE_LIMIT = 20_000

/** Keep styling/link escapes but remove content-owned cursor and screen controls. */
export function sanitizeDisplayLine(value: string): string {
  const cached = sanitizeCache.get(value)
  if (cached !== undefined) return cached
  const plain = (text: string): string => text
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .replace(UNSAFE_CONTROL, '')
  let output = ''
  let cursor = 0
  for (const match of value.matchAll(DISPLAY_ESCAPE)) {
    output += plain(value.slice(cursor, match.index))
    const sequence = match[0]
    if ((sequence.startsWith('\x1b[') && sequence.endsWith('m')) || sequence.startsWith('\x1b]8;')) {
      output += sequence
    }
    cursor = match.index + sequence.length
  }
  const result = output + plain(value.slice(cursor))
  if (sanitizeCache.size >= SANITIZE_CACHE_LIMIT) sanitizeCache.clear()
  sanitizeCache.set(value, result)
  return result
}
