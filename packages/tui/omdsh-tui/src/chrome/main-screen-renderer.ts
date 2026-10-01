/**
 * Main-screen renderer.
 *
 * The terminal owns native scrollback. This renderer owns only the current
 * screen and a logical boundary for rows already frozen above it. Routine
 * updates treat native history as append-only, and so does a transcript epoch:
 * replacing the document replays the new frame into a fresh index space and
 * leaves the earlier output above, where the terminal keeps it.
 *
 * Finalized rows cross the boundary by being painted at the top of the screen
 * immediately before a newline scrolls them into history. Pending rows remain
 * in the mutable screen tail. A terminal height change is the one exception:
 * the terminal itself can move visible rows across the scrollback boundary, so
 * the renderer adopts that new physical boundary instead of emitting the rows
 * again.
 *
 * reset() repairs the visible screen without replaying history. A logical
 * conversation replacement must call startEpoch() so the replacement frame is
 * laid out from a clean index space rather than diffed against rows that
 * described a different document.
 *
 * Nothing here erases native scrollback. It holds the reader's shell output
 * from before this process started, and a routine replacement has no business
 * destroying it; the seam between the two documents is content, and the
 * transcript renders it.
 *
 * The terminal provider owns input modes, including mouse tracking; the
 * renderer wraps every paint in one DEC 2026 synchronized write.
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
  /** Borrow the alternate buffer for transient full-screen surfaces. */
  alternateScreenOverlays?: boolean
}

export interface EpochOptions {
  /** Viewport adopts a refreshed projection without appending native history. */
  replay?: 'full' | 'pinned' | 'viewport'
}

interface ResizeTransition {
  oldHeight: number
  widthChanged: boolean
}

/**
 * Where a block that was reshaped maps to, given the row offsets of the same
 * blocks before and after.
 *
 * A block's span runs from its own start to the next block's. Block indices are
 * stable within a document, so the span survives a reshape that another block
 * made. The span to trust is the one the frozen boundary is *inside*: the last
 * block that starts before it, whose next start is at or beyond it. When that
 * block's span is the same length before and after, the boundary moves with it;
 * when it changed, the block's new end is where the reshaped content stops, and
 * everything from there on belongs to the reshape rather than to the reader's
 * frozen prefix.
 *
 * Returns `undefined` when there is no such block — fewer blocks than the
 * boundary, or offsets that do not describe one.
 */
export function mapBlockSpan(input: {
  oldStarts: readonly number[]
  newStarts: readonly number[]
  oldBody: number
  newBody: number
  physical: number
  oldTail: number
  newTail: number
}): number | undefined {
  const { oldStarts, newStarts, oldBody, newBody, physical, oldTail, newTail } = input
  if (newStarts.length < oldStarts.length) return undefined
  const index = oldStarts.findLastIndex(row => oldBody + row < physical)
  if (index < 0) return undefined
  const oldStart = oldBody + oldStarts[index]!
  const newStart = newBody + newStarts[index]!
  const oldEnd = oldBody + (oldStarts[index + 1] ?? oldTail - oldBody)
  let nextIndex = index + 1
  while (nextIndex < newStarts.length && newStarts[nextIndex]! === newStarts[index]) nextIndex += 1
  const newEnd = newBody + (newStarts[nextIndex] ?? newTail - newBody)
  return oldEnd - oldStart === newEnd - newStart
    ? newStart + physical - oldStart
    : newEnd
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
  readonly #alternateScreenOverlays: boolean
  #width: number
  #height: number
  #resize: ResizeTransition | undefined
  #hasFrame = false
  #reanchor = false
  #newEpoch = false
  #epochReplay: NonNullable<EpochOptions['replay']> = 'full'
  #adoptPhysicalAfterTransient = false
  /** First frame row a fold reshaped since the last followed frame, if any. */
  #reflowFrom: number | undefined
  /** First logical row not frozen above the screen in the current epoch. */
  #physical = 0
  /** Last followed document, retained for mapping a reshape's frozen boundary. */
  #followRows: readonly string[] = []
  /** End of transcript rows; changing live chrome must not break suffix matching. */
  #followEnd = 0
  #followTranscript: Frame['transcript']
  /** A reshape can bring frozen rows back into the viewport without thawing them. */
  #frozenViewport = false
  /**
   * First document row the previous painted frame showed. A resize makes the
   * terminal commit rows from the top of *that* screen, which after a reflow is
   * not the frozen boundary — the boundary deliberately sits above the screen
   * top, so the two have to be tracked separately.
   */
  #screenSource: { start: number; end: number } | null = null
  #screenSourceKnown = false
  /** The rows the last painted frame showed on the main screen. */
  #screenRows: readonly string[] = []
  /** Document row each physical row of the last frame showed, if any. */
  #screenRowSource: (number | undefined)[] = []
  /**
   * Blank padding rows the previous frame showed above its content. The
   * terminal pushes padding up when the window shrinks, and a pushed blank row
   * is not a committed document row — treating it as one skips real rows that
   * have never been shown.
   */
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

  /**
   * The document changed shape in place from `fromRow` down: a run folded or
   * opened, or a call or thought was opened.
   *
   * The frozen boundary is a row index, and a fold moves every row after it.
   * A reshape below the boundary is ordinary: those rows were never frozen, and
   * the next paint commits them in their new shape. A reshape above it moved
   * rows the terminal already holds, so the index stops naming the row it
   * froze — a shrink showed only the rows past the stale index over a blank
   * screen, a larger one read as a replaced document and replayed the whole
   * transcript, and a growth pushed rows already in history a second time. For
   * that case the renderer repaints the screen with the document's tail and
   * maps the frozen boundary into its new row indices. Frozen rows may reappear
   * in the viewport without being committed again. What history holds stays
   * as it was shown: a snapshot, which is the contract, not a defect.
   *
   * The mark survives frames that browse history and applies on the next frame
   * that follows the tail.
   */
  reflow(fromRow = 0): void {
    this.#reflowFrom = Math.min(this.#reflowFrom ?? fromRow, fromRow)
  }

  /** Adopt a new logical transcript while retaining native history. */
  startEpoch(options: EpochOptions = {}): void {
    this.#newEpoch = true
    this.#epochReplay = options.replay ?? 'full'
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
      ? this.#paintTransient(next, cursor, cursorVisible, frame.transientSurface, frame)
      : this.#paintFollow(next, liveStart, livePinned, cursor, cursorVisible, frame)
    if (paint !== '') this.#sink.write(paint)
  }

  #paintTransient(
    next: readonly string[],
    cursor: { row: number; column: number },
    cursorVisible: boolean,
    surface: 'overlay' | 'scroll' | undefined,
    frame: Frame,
  ): string {
    const target = this.#target(next, 0, 'top')
    // Browsing history is not an overlay: the alternate buffer would hide the
    // terminal's own scrollback, which is exactly what the user is scrolling
    // through, so a scroll frame repaints the main screen instead.
    if (this.#alternateScreenOverlays && surface !== 'scroll') {
      const clear = !this.#altActive || this.#resize !== undefined
      let body = this.#altActive ? '' : ENTER_ALT_SCREEN
      body += this.#paintScreen(target.rows, clear ? this.#blankScreen() : this.#altScreen, clear)
      const targetRow = this.#screenRow(cursor.row, target, next.length)
      body += csi(targetRow, cursor.column)
      body += cursorVisible ? SHOW_CURSOR : HIDE_CURSOR
      this.#altActive = true
      this.#altScreen = target.rows
      this.#cursorVisible = cursorVisible
      // The clear above already reconciled the resize and the re-anchor; leaving
      // them pending would clear the overlay again on every following frame.
      this.#resize = undefined
      this.#reanchor = false
      return this.#wrap(body)
    }
    const leavingAlt = this.#altActive
    const exitAlt = leavingAlt ? EXIT_ALT_SCREEN : ''
    const resized = this.#takeResizeBaseline()
    // Leaving the alternate buffer restores whatever the main screen held before
    // it was entered, so that snapshot is the baseline to diff against.
    const baseline = leavingAlt ? this.#screen : resized.rows
    if (leavingAlt) {
      this.#altActive = false
      this.#altScreen = this.#blankScreen()
    }
    const body = this.#paintScreen(target.rows, baseline, this.#reanchor || resized.clear || leavingAlt)
    this.#reanchor = false
    this.#transient = true
    // Every frame painted on the main screen replaces what the main screen
    // showed — a browse, but also a main-screen overlay, which is a different
    // thing entirely and must clear the document range rather than leave the
    // previous one standing. An alternate-buffer frame is a different buffer and
    // is filtered inside the recorder, not here.
    this.#screenRows = target.rows
    this.#recordSource(frame, target)
    return this.#finishPaint(exitAlt + body, target, next.length, cursor, cursorVisible)
  }

  #paintFollow(
    next: readonly string[],
    liveStart: number,
    livePinned: boolean,
    cursor: { row: number; column: number },
    cursorVisible: boolean,
    frame: Frame,
  ): string {
    const transcript = frame.transcript
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
      // Document replacement replays its snapshot; a projection refresh only
      // adopts its viewport. Both need a fresh row index, but a refresh must
      // not append a second copy of the document to native history.
      const replayPhysical = this.#newEpoch && this.#epochReplay === 'full' ? viewStart : candidatePhysical
      body = this.#newEpoch && this.#epochReplay === 'viewport'
        ? this.#paintScreen(target.rows, this.#screen, true)
        : this.#paintFlush(next, 0, replayPhysical, viewStart, true)
      this.#physical = replayPhysical
      this.#frozenViewport = false
      this.#newEpoch = false
      this.#epochReplay = 'full'
      this.#resize = undefined
    } else if (this.#resize !== undefined) {
      const transition = this.#resize
      const baseline = this.#resizedScreen(transition.oldHeight)
      body = this.#paintScreen(target.rows, baseline, transition.widthChanged)
      // A height change moves rows between screen and scrollback by itself, but
      // that is a screen-level event, not a document one, and it does not move
      // the frozen boundary at all. A taller window brings back what scrollback
      // holds — snapshots of how rows looked when they were pushed there, not
      // the current document's rows — so those rows say nothing about where
      // this document's boundary is. Moving the boundary by the height delta
      // instead stepped it *past* frozen rows and unfroze them, and the next
      // growth committed those rows to history a second time. Deriving it from
      // `viewStart` was the original defect: that discards the boundary
      // outright and hands the whole frozen head to the next flush.
      //
      // A reshape may be pending in the same frame, and this branch runs before
      // the reflow one. Deferring it is not an option: the next frame records
      // the rows this document now has, so the mapping would compare the new
      // shape against itself and skip the rows between the stale boundary and
      // the real one — rows that had never been shown and never committed.
      // So the mapping happens here, and this frame counts as the reflow.
      const reshaped = this.#reflowFrom !== undefined && this.#reflowFrom < this.#physical
      if (reshaped) {
        this.#physical = Math.max(candidatePhysical,
          this.#reshapedBoundary(next, Math.max(liveStart, candidatePhysical), transcript))
        this.#frozenViewport = this.#physical > candidatePhysical
        this.#reflowFrom = undefined
        this.#reanchor = false
        this.#adoptPhysicalAfterTransient = false
      } else if (candidatePhysical > this.#physical) {
        // The document grew in this frame. Two different things bound where the
        // flush may start, and both are needed. The screen top says what the
        // terminal committed on its own: a shorter window pushed that many rows
        // up from there, and sending them again repeats them. The frozen
        // What still needs committing, as a set difference rather than one
        // number. The frozen boundary is the floor — an earlier frame already
        // committed everything above it. The terminal's own move removes a
        // *range* from what is left, and that range need not touch the floor:
        // a browse window that starts past it leaves a gap between the two that
        // a single `max` would silently drop. So: commit the part of
        // [floor, candidate) below the committed range, and the part above it.
        const committed = this.#committedByTerminal(transition, this.#screenSourceKnown, next)
        const floor = Math.min(candidatePhysical, Math.max(0, this.#physical))
        if (floor < candidatePhysical) {
          const spans = committed === undefined || committed.end <= floor
            ? [[floor, candidatePhysical] as const]
            : committed.start > candidatePhysical
              ? [[floor, candidatePhysical] as const]
              : [
                ...(committed.start > floor ? [[floor, committed.start] as const] : []),
                ...(committed.end < candidatePhysical ? [[committed.end, candidatePhysical] as const] : []),
              ]
          if (spans.some(([from, to]) => from < to)) {
            // One pass, so the two halves cannot clear each other's output.
            body = this.#paintFlushRanges(next, spans, viewStart)
          }
        }
        this.#physical = candidatePhysical
        this.#frozenViewport = false
      } else if (this.#physical > candidatePhysical) {
        this.#physical = Math.max(0, Math.min(this.#physical, next.length))
        this.#frozenViewport = true
      } else {
        this.#physical = viewStart
        this.#frozenViewport = false
      }
      this.#resize = undefined
    } else if (this.#reflowFrom !== undefined && this.#reflowFrom < this.#physical) {
      body = this.#paintScreen(target.rows, this.#screen, true)
      // Preserve unchanged frozen rows in their new index space. A shrink may
      // bring them onto screen; repainting them does not make them unfrozen.
      this.#physical = Math.max(candidatePhysical, this.#reshapedBoundary(next, Math.max(liveStart, candidatePhysical), transcript))
      this.#frozenViewport = this.#physical > candidatePhysical
      this.#reanchor = false
      this.#adoptPhysicalAfterTransient = false
    } else if (this.#reanchor) {
      if (candidatePhysical > this.#physical) {
        body = this.#paintFlush(next, this.#physical, candidatePhysical, viewStart, true)
        this.#physical = candidatePhysical
      } else if (!this.#frozenViewport && next.length <= this.#physical) {
        body = this.#paintFlush(next, 0, candidatePhysical, viewStart, true)
        this.#physical = candidatePhysical
      } else {
        effectiveStart = this.#frozenViewport ? viewStart : Math.max(this.#physical, viewStart)
        target = this.#target(next, effectiveStart, 'bottom')
        body = this.#paintScreen(target.rows, this.#screen, true)
      }
      this.#reanchor = false
    } else if (this.#transient) {
      if (this.#adoptPhysicalAfterTransient) {
        body = this.#paintScreen(target.rows, this.#screen, true)
        // Coming back from an overlay or a browse, a reflow that had already
        // mapped the frozen boundary keeps it: a geometry change moves rows on
        // the screen, and a taller window pulls back rows that were never
        // frozen, so the boundary does not move. Re-deriving it from the
        // viewport start here forgot rows the terminal already held and the next
        // growth committed them a second time. A boundary that was never
        // mapped still comes from the viewport, since the rows above it are
        // whatever the terminal left behind.
        const mapped = this.#physical > candidatePhysical
        this.#physical = mapped
          ? Math.max(0, Math.min(this.#physical, next.length))
          : viewStart
        this.#frozenViewport = mapped
          this.#adoptPhysicalAfterTransient = false
      } else if (candidatePhysical > this.#physical) {
        body = this.#paintFlush(next, this.#physical, candidatePhysical, viewStart, false)
        this.#physical = candidatePhysical
      } else {
        effectiveStart = !this.#frozenViewport && candidatePhysical < this.#physical && next.length > this.#physical
          ? Math.max(this.#physical, viewStart)
          : viewStart
        target = this.#target(next, effectiveStart, 'bottom')
        body = this.#paintScreen(target.rows, this.#screen, true)
      }
    } else if (!this.#frozenViewport && next.length <= this.#physical) {
      // A logical clear/replace that was not explicitly signalled still needs
      // an independent index space. Keep old history and append the new epoch.
      body = this.#paintFlush(next, 0, candidatePhysical, viewStart, true)
      this.#physical = candidatePhysical
    } else if (candidatePhysical > this.#physical) {
      body = this.#paintFlush(next, this.#physical, candidatePhysical, viewStart, false)
      this.#physical = candidatePhysical
    } else {
      if (!this.#frozenViewport && candidatePhysical < this.#physical) effectiveStart = Math.max(this.#physical, viewStart)
      target = this.#target(next, effectiveStart, 'bottom')
      body = this.#paintScreen(target.rows, this.#screen, false)
    }

    this.#transient = false
    this.#screenRows = target.rows
    this.#recordSource(frame, target)
    this.#reflowFrom = undefined
    if (candidatePhysical >= this.#physical) this.#frozenViewport = false
    this.#followRows = next
    this.#followEnd = Math.max(liveStart, this.#physical)
    this.#followTranscript = transcript
    return this.#finishPaint(exitAlt + body, target, next.length, cursor, cursorVisible)
  }

  /** Map a frozen row index across a changed span, keeping its suffix aligned. */
  #reshapedBoundary(next: readonly string[], end: number, transcript: Frame['transcript']): number {
    const before = this.#followRows
    let prefix = Math.min(this.#reflowFrom ?? 0, this.#followEnd, end)
    while (prefix < this.#followEnd && prefix < end && before[prefix] === next[prefix]) prefix += 1
    if (this.#physical <= prefix) return this.#physical
    // Block indices remain stable within a document, even if new turns arrive
    // during browsing. They keep appended content out of the reshaped span.
    const oldStarts = this.#followTranscript?.blockDrawStarts ?? this.#followTranscript?.blockStarts
    const newStarts = transcript?.blockDrawStarts ?? transcript?.blockStarts
    if (oldStarts !== undefined && newStarts !== undefined) {
      const mapped = mapBlockSpan({
        oldStarts, newStarts,
        oldBody: this.#followTranscript?.bodyRow ?? 0,
        newBody: transcript?.bodyRow ?? 0,
        physical: this.#physical,
        oldTail: this.#followEnd,
        newTail: end,
      })
      if (mapped !== undefined) return mapped
    }
    let oldEnd = this.#followEnd
    let newEnd = end
    while (oldEnd > prefix && newEnd > prefix && before[oldEnd - 1] === next[newEnd - 1]) {
      oldEnd -= 1
      newEnd -= 1
    }
    // Changed frozen rows retain their old snapshot. Only the unchanged suffix
    // has a precise correspondence; never replay the reshaped span itself.
    return this.#physical < oldEnd ? newEnd : newEnd + this.#physical - oldEnd
  }

  /** Emit finalized rows followed by the bounded live tail. */
  /**
   * Commit several disjoint stretches in one paint, then the live viewport.
   *
   * The stretches exist because what the terminal committed on its own is a
   * range that need not touch the frozen boundary: a browse window that starts
   * past it leaves a gap between the two, and a single upper bound would drop
   * that gap. They go out together because each pass starts by clearing the
   * screen, so two passes would erase the first one's rows.
   */
  #paintFlushRanges(
    next: readonly string[],
    ranges: readonly (readonly [number, number])[],
    viewStart: number,
  ): string {
    const rows = [
      ...ranges.flatMap(([from, to]) => next.slice(from, to)),
      ...next.slice(viewStart, viewStart + this.#height),
    ]
    let out = CLEAR_SCREEN
    if (rows.length < this.#height) out += csi(this.#height - rows.length, 0)
    for (let i = 0; i < rows.length; i += 1) {
      if (i > 0) out += '\r\n'
      // EL is required before a shorter final row scrolls into history.
      out += CLEAR_LINE + (rows[i] ?? '')
    }
    return out
  }

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

  /**
   * Note which document rows the main screen now shows, in document
   * coordinates, clipped to the rows the screen actually displays.
   *
   * The three states are kept apart on purpose. A frame that drew no body clears
   * the range; a frame whose source is unknown marks it unknown, which is not
   * the same as having none and must not be read as such. An alternate-buffer
   * frame is a different buffer entirely and leaves the main screen's record
   * alone.
   */
  #recordSource(frame: Frame, target: ScreenTarget): void {
    if (this.#altActive) return
    const range = frame.documentRows
    if (range === null) {
      this.#screenSource = null
      this.#screenSourceKnown = true
      return
    }
    if (range === undefined) {
      this.#screenSource = null
      this.#screenSourceKnown = false
      return
    }
    // A physical row is a document row only through the frame's own mapping:
    // physical row `at` is frame row `target.start + at - target.offset`, and
    // frame row `f` is document row `documentStart + (f - frameStart)` when
    // that lands inside the declared range. Padding above the content and the
    // overflow markers around it map to no document row, which is what keeps a
    // terminal that pushed one of them from being credited with a document row.
    this.#screenRowSource = []
    let lowest: number | undefined
    let highest: number | undefined
    for (let at = 0; at < target.rows.length; at += 1) {
      const frameRow = target.start + at - target.offset
      const document = range.documentStart + (frameRow - range.frameStart)
      const inside = frameRow >= range.frameStart && document >= range.documentStart && document < range.documentEnd
      this.#screenRowSource[at] = inside ? document : undefined
      if (!inside) continue
      lowest = lowest === undefined ? document : Math.min(lowest, document)
      highest = highest === undefined ? document : Math.max(highest, document) + 1
    }
    this.#screenSource = lowest === undefined || highest === undefined
      ? { start: range.documentStart, end: range.documentStart }
      : { start: lowest, end: highest }
    this.#screenSourceKnown = true
  }

  /**
   * The document rows the terminal committed by itself when it moved rows off
   * the top of the last screen, as a half-open interval, or `undefined` when it
   * committed none.
   *
   * Three things this has to get right, each of which was wrong at least once.
   * A window that commits nothing must say so rather than naming its first
   * row: crediting that would skip everything between the frozen boundary and
   * the window. A pushed row that is not a document row — padding, an overflow
   * marker — is *skipped*, not treated as the end: a terminal that pushed a
   * marker and the first document row below it committed that document row, and
   * stopping at the marker would leave it uncommitted. And a pushed row counts
   * only while the document still reads the same at that position: new text
   * taking a position over means the old row entering history says nothing
   * about the new one, and the run of committed rows ends there.
   */
  #committedByTerminal(
    transition: ResizeTransition,
    known: boolean,
    next: readonly string[],
  ): { start: number; end: number } | undefined {
    const source = this.#screenSource
    if (!known || source === null) return undefined
    const pushed = transition.oldHeight - this.#height
    if (pushed <= 0) return undefined
    let start: number | undefined
    let end: number | undefined
    for (let at = 0; at < pushed; at += 1) {
      const document = this.#screenRowSource[at]
      if (document === undefined) continue
      const shown = this.#screenRows[at]
      if (shown === undefined) break
      // Leading whitespace is part of the row: `'    a'` and `'a'` are different
      // text, and indenting code is exactly when a row changes that way. Only
      // the right edge is normalized, because a row is padded to the frame width
      // and the padding follows the terminal rather than the document.
      if (shown.replace(/\s+$/u, '') !== (next[document] ?? '').replace(/\s+$/u, '')) break
      start = start === undefined ? document : Math.min(start, document)
      end = end === undefined ? document + 1 : Math.max(end, document + 1)
    }
    return start === undefined || end === undefined ? undefined : { start, end }
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

    this.#cursorRow = targetRow
    this.#cursorCol = targetCol
    this.#cursorVisible = cursorVisible
    this.#screen = target.rows
    this.#hasFrame = true
    return this.#wrap(body + cursorOut + hide + show)
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
