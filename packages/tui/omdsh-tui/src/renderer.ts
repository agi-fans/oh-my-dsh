/**
 * Pure ANSI differential line renderer.

 * A frame is an array of display lines; render() rewrites only the lines
 * that differ from the previous frame and repositions the cursor. The
 * renderer is escape-sequence-literate but style-agnostic: lines pass
 * through verbatim, so callers own all styling (see ./style.ts).

 * Cursor contract: after every render the cursor sits exactly at the
 * frame's requested cursor position (default: the start of the line after
 * the last frame line), and the renderer tracks that position so the next
 * render diffs correctly from it — a render whose cursor sits on the input
 * line must not shift the following frame. All emitted movement stays
 * inside the frame, so a frame that fills the terminal never scrolls it.
 * The renderer assumes exclusive write access to the output stream and a
 * terminal cursor that starts at row 0 column 0 when the first frame is
 * rendered.
 * @module @oh-my-dsh/dsh-tui
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
  /** Rounded editor hit box (frame rows); omitted when an overlay replaced it. */
  editor?: { start: number; rows: number }
  /** Slash popup or settings list hit box (frame rows). */
  overlay?: {
    kind: 'autocomplete' | 'settings' | 'search' | 'copy' | 'prompt'
    start: number
    resultsRow?: number
    itemRows?: readonly (number | undefined)[]
    document?: { start: number; maxStart: number; pageSize: number }
  }
}

/** The write sink a renderer emits into (stdout or a test capture). */
export interface RenderSink {
  write(chunk: string): void
}

/**
 * Line diff between two frames: the write/clear operations that transform
 * `oldLines` into `nextLines`. Rows are 0-based absolute indices into the
 * frame; changed rows are rewritten, old-only rows are cleared in place.
 * Pure — unit-testable without a terminal.
 */
export interface LineDiff {
  /** Rows to write: absolute row index (0-based) and exact line text. */
  writes: { row: number; text: string }[]
  /** Stale rows (old-only) whose content must be cleared. */
  clears: number[]
}

/**
 * Compute the line diff between two frames.
 * @param oldLines - previously rendered lines.
 * @param nextLines - lines to render now.
 * @returns operations transforming old into next.
 */
export function computeLineDiff(oldLines: readonly string[], nextLines: readonly string[]): LineDiff {
  let prefix = 0
  while (prefix < oldLines.length && prefix < nextLines.length && oldLines[prefix] === nextLines[prefix]) prefix += 1
  let suffix = 0
  // Suffix rows keep their screen row only when both frames have the same
  // length; a grow/shrink shifts every row after the change, so the tail
  // must be rewritten rather than skipped.
  if (oldLines.length === nextLines.length) {
    while (
      suffix < oldLines.length - prefix
      && oldLines[oldLines.length - 1 - suffix] === nextLines[nextLines.length - 1 - suffix]
    ) suffix += 1
  }
  const changedOld = oldLines.length - prefix - suffix
  const changedNew = nextLines.length - prefix - suffix
  const writes: LineDiff['writes'] = []
  for (let i = 0; i < changedNew; i += 1) {
    writes.push({ row: prefix + i, text: nextLines[prefix + i] ?? '' })
  }
  const clears: number[] = []
  for (let i = changedNew; i < changedOld; i += 1) clears.push(prefix + i)
  return { writes, clears }
}

/**
 * Stateful ANSI renderer: executes line diffs into a sink, tracking the
 * cursor position so consecutive frames diff correctly.
 */
export class LineRenderer {
  #last: string[] = []
  /** Terminal cursor row after the last render (0-based, screen-relative). */
  #row = 0
  /** Terminal cursor column after the last render (0-based). */
  #col = 0
  #cursorVisible = true
  readonly #sink: RenderSink
  readonly #synchronized: boolean

  /**
   * @param sink - output stream receiving escape sequences and text.
   * @param options.synchronized - wrap each paint in CSI 2026 (OMP flicker guard).
   */
  constructor(sink: RenderSink, options?: { synchronized?: boolean }) {
    this.#sink = sink
    this.#synchronized = options?.synchronized === true
  }

  /** Render a frame, rewriting only the lines that changed. */
  render(frame: Frame): void {
    const next = frame.lines.map((line) => String(line))
    const diff = computeLineDiff(this.#last, next)
    let out = ''
    // Simulate the cursor through the emitted operations so the final
    // positioning never depends on assumptions about where the ops left it.
    let row = this.#row
    let col = this.#col
    if (diff.writes.length > 0 || diff.clears.length > 0) {
      // Move from the tracked cursor to the first rewritten row — the
      // previous render may have left the cursor on the input line, which
      // the diff must not treat as a fixed reference row.
      const prefix = diff.writes[0]?.row ?? diff.clears[0] ?? 0
      if (row > prefix) out += `\x1b[${row - prefix}A`
      else if (row < prefix) out += `\x1b[${prefix - row}B`
      row = prefix
      if (col > 0) {
        out += '\r'
        col = 0
      }
      for (const write of diff.writes) {
        out += '\r\x1b[K' + write.text
        row = write.row
        col = write.text.length
        if (write.row < next.length - 1) {
          out += '\r\n'
          row += 1
          col = 0
        }
      }
      if (diff.clears.length > 0) {
        // Walk down through the stale rows, clearing each in place, then
        // return to the last written row (or the first rewritten row).
        for (let i = 0; i < diff.clears.length; i += 1) {
          if (i > 0 || diff.writes.length > 0) {
            out += '\r\n'
            row += 1
            col = 0
          }
          out += '\x1b[K'
        }
        const back = diff.clears.length - (diff.writes.length > 0 ? 0 : 1)
        if (back > 0) {
          out += `\x1b[${back}A`
          row -= back
        }
      }
      // Styled lines may contain escape bytes, so the column after a text
      // write is not meaningful; normalize to the line start before the
      // final positioning move.
      if (col > 0) {
        out += '\r'
        col = 0
      }
    }
    this.#last = next
    const target = frame.cursor ?? { row: next.length, column: 0 }
    const cursorVisible = frame.cursorVisible !== false
    let move = ''
    if (target.row !== row || target.column !== col) {
      if (target.row < row) move += `\x1b[${row - target.row}A`
      else if (target.row > row) move += `\x1b[${target.row - row}B`
      if (target.column < col) move += `\x1b[${col - target.column}D`
      else if (target.column > col) move += `\x1b[${target.column - col}C`
    }
    const hide = !cursorVisible && this.#cursorVisible ? '\x1b[?25l' : ''
    const show = cursorVisible && !this.#cursorVisible ? '\x1b[?25h' : ''
    const payload = hide + out + move + show
    if (payload !== '') {
      this.#sink.write(this.#synchronized ? `\x1b[?2026h${payload}\x1b[?2026l` : payload)
    }
    this.#row = target.row
    this.#col = target.column
    this.#cursorVisible = cursorVisible
  }

  /**
   * Move to the start of the frame's final row so a following newline exits
   * below the UI instead of overwriting rows beneath the editor cursor.
   */
  finish(): void {
    const targetRow = Math.max(0, this.#last.length - 1)
    let out = ''
    if (this.#row > targetRow) out += `\x1b[${this.#row - targetRow}A`
    else if (this.#row < targetRow) out += `\x1b[${targetRow - this.#row}B`
    if (this.#col > 0) out += '\r'
    if (!this.#cursorVisible) out += '\x1b[?25h'
    if (out !== '') this.#sink.write(out)
    this.#row = targetRow
    this.#col = 0
    this.#cursorVisible = true
  }

  /** Forget the rendered state; the next render treats the screen as empty. */
  reset(): void {
    this.#last = []
    this.#row = 0
    this.#col = 0
  }
}
