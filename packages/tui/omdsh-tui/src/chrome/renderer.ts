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
}

/** One display frame: exact lines plus an optional final cursor position. */
export interface Frame {
  /** Display lines, exactly as written (ANSI escapes allowed). */
  lines: readonly string[]
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
