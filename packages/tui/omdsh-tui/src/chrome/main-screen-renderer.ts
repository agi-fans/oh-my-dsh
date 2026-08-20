/**
 * Main-screen renderer.
 *
 * The terminal owns native scrollback. This renderer owns only the current
 * screen and a logical boundary for rows already frozen above it. Routine
 * updates treat native history as append-only. Explicit transcript epochs
 * clear it once and replay the replacement frame from a clean origin.
 *
 * Finalized rows cross the boundary by being painted at the top of the screen
 * immediately before a newline scrolls them into history. Pending rows remain
 * in the mutable screen tail. A terminal height change is the one exception:
 * the terminal itself can move visible rows across the scrollback boundary, so
 * the renderer adopts that new physical boundary instead of emitting the rows
 * again.
 *
 * reset() repairs the visible screen without replaying history. A logical
 * conversation replacement must call startEpoch() so stale native history is
 * cleared before the replacement transcript is replayed.
 *
 * The renderer never enables mouse tracking (1000/1006) and wraps every paint
 * in one DEC 2026 synchronized write.
 * @module @agi-fans/dsh-tui
 */
import { sanitizeDisplayLine, type Frame, type RenderSink } from './renderer.ts'

const DISABLE_AUTOWRAP = '\x1b[?7l'
const ENABLE_AUTOWRAP = '\x1b[?7h'
const SYNC_OUTPUT_BEGIN = '\x1b[?2026h'
const SYNC_OUTPUT_END = '\x1b[?2026l'
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
const ENTER_ALT_SCREEN = '\x1b[?1049h'
const EXIT_ALT_SCREEN = '\x1b[?1049l'
const CLEAR_SCROLLBACK = '\x1b[3J'
const CLEAR_SCREEN = '\x1b[2J\x1b[H'
const CLEAR_LINE = '\x1b[2K'

function csi(row: number, column: number): string {
  return `\x1b[${Math.max(1, row + 1)};${Math.max(1, column + 1)}H`
}

export interface MainScreenRendererOptions {
  /** Terminal height in rows. */
  height: number
  /** Terminal width in columns. */
  width?: number
  /** Wrap the paint in synchronized output (DEC 2026). */
  synchronized?: boolean
  /** Whether explicit transcript replacement may erase native scrollback. */
  clearScrollback?: boolean
  /** Borrow the alternate buffer for transient full-screen surfaces. */
  alternateScreenOverlays?: boolean
}

export interface EpochOptions {
  /** Full freezes the restored snapshot; pinned preserves its mutable suffix. */
  replay?: 'full' | 'pinned'
}

interface ResizeTransition {
  oldHeight: number
  widthChanged: boolean
}

interface ScreenTarget {
  rows: string[]
  start: number
  offset: number
}

interface ResizeBaseline {
  rows: string[]
  clear: boolean
}

/** Render frames into the terminal main screen while preserving native history. */
export class MainScreenRenderer {
  readonly #sink: RenderSink
  readonly #synchronized: boolean
  readonly #canClearScrollback: boolean
  readonly #alternateScreenOverlays: boolean
  #width: number
  #height: number
  #resize: ResizeTransition | undefined
  #hasFrame = false
  #reanchor = false
  #newEpoch = false
  #fullReplayOnNextEpoch = true
  #clearScrollbackOnNextRender = false
  #adoptPhysicalAfterTransient = false
  /** First logical row not frozen above the screen in the current epoch. */
  #physical = 0
  /** Exact visible rows expected on the physical screen. */
  #screen: string[]
  #transient = false
  #altActive = false
  #altScreen: string[]
  #cursorRow = 0
  #cursorCol = 0
  #cursorVisible = true

  constructor(sink: RenderSink, options: MainScreenRendererOptions) {
    this.#sink = sink
    this.#width = options.width ?? 0
    this.#height = Math.max(1, options.height)
    this.#screen = this.#blankScreen()
    this.#altScreen = this.#blankScreen()
    this.#synchronized = options.synchronized === true
    this.#canClearScrollback = options.clearScrollback !== false
    this.#alternateScreenOverlays = options.alternateScreenOverlays === true
  }

  /** Record terminal geometry; the terminal has already performed the resize. */
  resize(width: number, height: number): void {
    const nextHeight = Math.max(1, height)
    if (width === this.#width && nextHeight === this.#height) return
    const transition = this.#resize ?? { oldHeight: this.#height, widthChanged: false }
    transition.widthChanged ||= width !== this.#width
    this.#resize = transition
    this.#width = width
    this.#height = nextHeight
  }

  /** Repaint the current viewport without replaying frozen history. */
  reset(): void {
    this.#reanchor = true
  }

  /** Replace native history with a new logical transcript on the next paint. */
  startEpoch(options: EpochOptions = {}): void {
    this.#newEpoch = true
    this.#fullReplayOnNextEpoch = options.replay !== 'pinned'
    this.#clearScrollbackOnNextRender = true
    this.#reanchor = true
    this.#adoptPhysicalAfterTransient = false
  }

  /** Put the cursor below the UI before terminal ownership is released. */
  finish(): void {
    const targetRow = Math.max(0, this.#height - 1)
    let out = ''
    if (this.#altActive) {
      out += EXIT_ALT_SCREEN
      this.#altActive = false
      this.#altScreen = this.#blankScreen()
    }
    if (!this.#cursorVisible) out += SHOW_CURSOR
    out += csi(targetRow, 0)
    if (out !== '') this.#sink.write(out)
    this.#cursorRow = targetRow
    this.#cursorCol = 0
    this.#cursorVisible = true
  }

  /** Render a frame, appending only finalized rows during a stable geometry epoch. */
  render(frame: Frame): void {
    const next = frame.lines.map(line => sanitizeDisplayLine(String(line)))
    const liveStart = Math.max(0, Math.min(frame.liveStart ?? 0, next.length))
    const livePinned = frame.livePinned !== false
    const cursor = frame.cursor ?? { row: next.length, column: 0 }
    const cursorVisible = frame.cursorVisible !== false
    const paint = liveStart === 0
      ? this.#paintTransient(next, cursor, cursorVisible)
      : this.#paintFollow(next, liveStart, livePinned, cursor, cursorVisible)
    if (paint !== '') this.#sink.write(paint)
  }

  #paintTransient(
    next: readonly string[],
    cursor: { row: number; column: number },
    cursorVisible: boolean,
  ): string {
    const target = this.#target(next, 0, 'top')
    if (this.#alternateScreenOverlays) {
      const clear = !this.#altActive || this.#resize !== undefined
      let body = this.#altActive ? '' : ENTER_ALT_SCREEN
      body += this.#paintScreen(target.rows, clear ? this.#blankScreen() : this.#altScreen, clear)
      const targetRow = this.#screenRow(cursor.row, target, next.length)
      body += csi(targetRow, cursor.column)
      body += cursorVisible ? SHOW_CURSOR : HIDE_CURSOR
      this.#altActive = true
      this.#altScreen = target.rows
      this.#cursorVisible = cursorVisible
      return this.#wrap(body)
    }
    const resized = this.#takeResizeBaseline()
    const body = this.#paintScreen(target.rows, resized.rows, this.#reanchor || resized.clear)
    this.#reanchor = false
    this.#transient = true
    return this.#finishPaint(body, target, next.length, cursor, cursorVisible)
  }

  #paintFollow(
    next: readonly string[],
    liveStart: number,
    livePinned: boolean,
    cursor: { row: number; column: number },
    cursorVisible: boolean,
  ): string {
    const exitAlt = this.#altActive ? EXIT_ALT_SCREEN : ''
    if (this.#altActive) {
      this.#altActive = false
      this.#altScreen = this.#blankScreen()
    }
    const viewStart = Math.max(0, next.length - this.#height)
    const candidatePhysical = livePinned ? Math.min(liveStart, viewStart) : viewStart
    let effectiveStart = viewStart
    let target = this.#target(next, effectiveStart, 'bottom')
    let body = ''

    if (!this.#hasFrame || this.#newEpoch) {
      // An explicit replacement follows ED3, so it must rebuild the complete
      // logical frame. Durable logs can end with an orphaned streaming/tool
      // block; applying the ordinary pending seam here would silently omit its
      // off-screen middle from the restored transcript.
      const replayPhysical = this.#newEpoch && this.#fullReplayOnNextEpoch ? viewStart : candidatePhysical
      body = this.#paintFlush(next, 0, replayPhysical, viewStart, true)
      this.#physical = replayPhysical
      this.#newEpoch = false
      this.#fullReplayOnNextEpoch = true
      this.#resize = undefined
    } else if (this.#resize !== undefined) {
      const transition = this.#resize
      const baseline = this.#resizedScreen(transition.oldHeight)
      body = this.#paintScreen(target.rows, baseline, transition.widthChanged)
      // The terminal has already moved rows between screen and scrollback.
      // Adopt that physical boundary rather than replaying those rows.
      this.#physical = viewStart
      this.#resize = undefined
    } else if (this.#reanchor) {
      if (candidatePhysical > this.#physical) {
        body = this.#paintFlush(next, this.#physical, candidatePhysical, viewStart, true)
        this.#physical = candidatePhysical
      } else if (next.length <= this.#physical) {
        body = this.#paintFlush(next, 0, candidatePhysical, viewStart, true)
        this.#physical = candidatePhysical
      } else {
        effectiveStart = Math.max(this.#physical, viewStart)
        target = this.#target(next, effectiveStart, 'bottom')
        body = this.#paintScreen(target.rows, this.#screen, true)
      }
      this.#reanchor = false
    } else if (this.#transient) {
      if (this.#adoptPhysicalAfterTransient) {
        body = this.#paintScreen(target.rows, this.#screen, true)
        this.#physical = viewStart
        this.#adoptPhysicalAfterTransient = false
      } else if (candidatePhysical > this.#physical) {
        body = this.#paintFlush(next, this.#physical, candidatePhysical, viewStart, false)
        this.#physical = candidatePhysical
      } else {
        effectiveStart = candidatePhysical < this.#physical && next.length > this.#physical
          ? Math.max(this.#physical, viewStart)
          : viewStart
        target = this.#target(next, effectiveStart, 'bottom')
        body = this.#paintScreen(target.rows, this.#screen, true)
      }
    } else if (next.length <= this.#physical) {
      // A logical clear/replace that was not explicitly signalled still needs
      // an independent index space. Keep old history and append the new epoch.
      body = this.#paintFlush(next, 0, candidatePhysical, viewStart, true)
      this.#physical = candidatePhysical
    } else if (candidatePhysical > this.#physical) {
      body = this.#paintFlush(next, this.#physical, candidatePhysical, viewStart, false)
      this.#physical = candidatePhysical
    } else {
      if (candidatePhysical < this.#physical) effectiveStart = Math.max(this.#physical, viewStart)
      target = this.#target(next, effectiveStart, 'bottom')
      body = this.#paintScreen(target.rows, this.#screen, false)
    }

    this.#transient = false
    return this.#finishPaint(exitAlt + body, target, next.length, cursor, cursorVisible)
  }

  /** Emit finalized rows followed by the bounded live tail. */
  #paintFlush(
    next: readonly string[],
    start: number,
    committedEnd: number,
    viewStart: number,
    clearScreen: boolean,
  ): string {
    const rows = [
      ...next.slice(start, committedEnd),
      ...next.slice(viewStart, viewStart + this.#height),
    ]
    let out = clearScreen ? CLEAR_SCREEN : csi(0, 0)
    if (rows.length < this.#height) out += csi(this.#height - rows.length, 0)
    for (let i = 0; i < rows.length; i += 1) {
      if (i > 0) out += '\r\n'
      // EL is required before a shorter final row scrolls into history.
      out += CLEAR_LINE + (rows[i] ?? '')
    }
    return out
  }

  #paintScreen(next: readonly string[], old: readonly string[], clear: boolean): string {
    return (clear ? CLEAR_SCREEN : '') + this.#paintDiff(next, clear ? this.#blankScreen() : old)
  }

  #paintDiff(next: readonly string[], old: readonly string[]): string {
    let out = ''
    let runStart = -1
    let runEnd = -1
    for (let row = 0; row < this.#height; row += 1) {
      const before = old[row] ?? ''
      const after = next[row] ?? ''
      if (before !== after) {
        if (runStart === -1) runStart = row
        runEnd = row
      } else if (runStart !== -1) {
        out += this.#writeRun(next, runStart, runEnd)
        runStart = -1
        runEnd = -1
      }
    }
    if (runStart !== -1) out += this.#writeRun(next, runStart, runEnd)
    return out
  }

  #writeRun(lines: readonly string[], start: number, end: number): string {
    let out = csi(start, 0)
    for (let row = start; row <= end; row += 1) {
      if (row > start) out += '\r\n'
      out += CLEAR_LINE + (lines[row] ?? '')
    }
    return out
  }

  #target(next: readonly string[], start: number, anchor: 'top' | 'bottom'): ScreenTarget {
    const content = next.slice(start, start + this.#height).map(line => line ?? '')
    const offset = anchor === 'bottom' ? Math.max(0, this.#height - content.length) : 0
    const rows = this.#blankScreen()
    for (let i = 0; i < content.length; i += 1) rows[offset + i] = content[i] ?? ''
    return { rows, start, offset }
  }

  #takeResizeBaseline(): ResizeBaseline {
    if (this.#resize === undefined) return { rows: this.#screen, clear: false }
    const transition = this.#resize
    this.#resize = undefined
    this.#adoptPhysicalAfterTransient = true
    return {
      rows: transition.widthChanged ? this.#blankScreen() : this.#resizedScreen(transition.oldHeight),
      clear: transition.widthChanged,
    }
  }

  #resizedScreen(oldHeight: number): string[] {
    if (this.#height < oldHeight) return this.#screen.slice(oldHeight - this.#height)
    if (this.#height > oldHeight) {
      return [...Array.from({ length: this.#height - oldHeight }, () => ''), ...this.#screen]
    }
    return this.#screen.slice(0, this.#height)
  }

  #finishPaint(
    body: string,
    target: ScreenTarget,
    length: number,
    cursor: { row: number; column: number },
    cursorVisible: boolean,
  ): string {
    const targetRow = this.#screenRow(cursor.row, target, length)
    const targetCol = cursor.column
    const hide = !cursorVisible && this.#cursorVisible ? HIDE_CURSOR : ''
    const show = cursorVisible && !this.#cursorVisible ? SHOW_CURSOR : ''
    const moved = targetRow !== this.#cursorRow || targetCol !== this.#cursorCol
    const visibilityChanged = cursorVisible !== this.#cursorVisible
    const cursorOut = body !== '' || moved || visibilityChanged ? csi(targetRow, targetCol) : ''

    const clearScrollback = this.#clearScrollbackOnNextRender && this.#canClearScrollback
    this.#clearScrollbackOnNextRender = false
    this.#cursorRow = targetRow
    this.#cursorCol = targetCol
    this.#cursorVisible = cursorVisible
    this.#screen = target.rows
    this.#hasFrame = true
    return this.#wrap((clearScrollback ? CLEAR_SCROLLBACK : '') + body + cursorOut + hide + show)
  }

  #screenRow(logicalRow: number, target: ScreenTarget, length: number): number {
    const clamped = Math.max(0, Math.min(Math.max(0, length - 1), logicalRow))
    return Math.max(0, Math.min(this.#height - 1, target.offset + clamped - target.start))
  }

  #blankScreen(): string[] {
    return Array.from({ length: this.#height }, () => '')
  }

  #wrap(payload: string): string {
    if (payload === '') return ''
    return this.#synchronized
      ? SYNC_OUTPUT_BEGIN + DISABLE_AUTOWRAP + payload + ENABLE_AUTOWRAP + SYNC_OUTPUT_END
      : DISABLE_AUTOWRAP + payload + ENABLE_AUTOWRAP
  }
}
