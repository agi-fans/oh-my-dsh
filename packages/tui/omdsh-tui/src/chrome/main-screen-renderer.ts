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
import { deleteImage, imageSequence, type ImagePlacement } from './terminal-images.ts'
import { sanitizeDisplayLine, type Frame, type RenderSink } from './renderer.ts'
import { visibleWidth } from './width.ts'

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

/**
 * The physical state of the normal buffer at one moment, as a value rather than a set of
 * live fields. `sourceKnown` and `source` describe which document the rows came from, and
 * are deliberately separate from the tail's trust: an untrusted tail says the order of
 * native history is unknown, not that a shown row has no document.
 */
interface NormalLayout {
  screen: readonly string[]
  rowSource: readonly (number | undefined)[]
  cursorRow: number
  source: { start: number; end: number } | null
  sourceKnown: boolean
}

interface ResizeTransition {
  oldHeight: number
  widthChanged: boolean
  /** The narrowest column count in force before the move, to test rows for wrapping. */
  narrowestWidth: number
  /**
   * Every height the window passed through before the frame that consumes this
   * transition, excluding `oldHeight` and the current one. A burst of resizes
   * collapses into one transition, so comparing only the first and last height
   * cannot tell a 5 -> 5 that never moved from a 5 -> 2 -> 5 that did.
   */
  intermediateHeights: number[]
}

/**
 * A main-screen move that happened while an overlay covered it, and the state of
 * that screen as it stood before the terminal made it. Held in one record so that
 * settling the comparison never has to block painting, and so that the comparison
 * reads one consistent set of values rather than live fields the overlay has since
 * replaced.
 */
interface ParkedMove {
  transition: ResizeTransition
  /**
   * The height the window came to rest at **when this move happened**, not the
   * height it has when the comparison is finally made. The two differ whenever a
   * later resize lands before an earlier comparison finishes, and using the newer
   * height re-reads the older event as having moved more rows than it did — which
   * credits rows that never entered history and drops them from the document.
   */
  newHeight: number
  /** Cursor row on the main screen, before the terminal's own move. */
  cursorRow: number
  /**
   * For a grow: the **requested** count — the most the terminal could pull back under the
   * bottom cursor, from `pulledBackFor`. It is a limit, not a result: the geometry guards, a
   * stale tail, or a tail that does not reach back that far can all leave fewer rows actually
   * taken. The instances really taken are recorded separately on `pulledRows`, and it is those,
   * not this number, that a move may not be credited for.
   */
  pulledBack?: number
  /**
   * Whether this record's rows can be tied to document rows at all. A move whose
   * screen layout is not known cannot be, and says so rather than reporting an
   * empty mapping — "unknown" and "nothing to credit" must not share a value.
   */
  sourceUsable: boolean
  /** Whether this move's push/pop has already been applied to the stack. */
  stackApplied?: boolean

  /**
   * The instances this move pulled back out of history, in the order they returned.
   * Kept even when `after` is unknown: the move's *geometry* may be unaccountable while
   * the identity of these rows is not — they were on this account's stack, so it knows
   * their text and their source.
   */
  pulledRows?: PushedRow[]

  /**
   * The instances from the screen before the move that a same-width grow leaves in
   * place. A grow adds rows at the bottom or pulls them in at the top; it does not
   * disturb what is already shown.
   */
  keptRows?: PushedRow[]
  /**
   * The screen this move leaves behind. The next move in the same stay starts from
   * it, so no move has to guess the current geometry from the live fields or from
   * whether an earlier record is still queued.
   */
  after?: { screen: string[]; rowSource: (number | undefined)[]; cursorRow: number } | undefined
  /**
   * Whether this move's starting geometry was actually accounted for. A move does not
   * make an unaccounted screen accounted for: the rows it reports are then a guess,
   * and a later move must not read them as fact. Only a real paint on the main screen
   * establishes a trustworthy layout again.
   */
  geometryTrusted: boolean
  /**
   * Whether the layout this move **leaves** is accounted for. A move can start from an
   * accounted screen and still end somewhere unknown — a grow that could not trace the
   * rows it pulled back, or a width change — and the next move inherits *this*, not
   * whether its own start was trustworthy.
   */
  outputTrusted: boolean
  /**
   * The rows this move put on the stack. Confirmation edits **these objects**, not
   * whichever entry happens to hold the same document number: an earlier move can
   * have pushed that same line, and crediting it there would attach this move's
   * confirmation to a row that has already gone.
   */
  pushedRows?: PushedRow[]
  /** The main screen as last painted — what the terminal had on it. */
  screen: readonly string[]
  /** Per-row document mapping for `screen`. */
  rowSource: (number | undefined)[]
  source: { start: number; end: number } | null
  sourceKnown: boolean
}

/**
 * A row the terminal pushed into native history: which document line it held, and
 * the text that line was confirmed to read. `text === undefined` means the row is
 * on the stack but its contents have not been checked against the document yet.
 *
 * The stack **is** the ledger. A row is credited exactly while it stands on the
 * stack and its text still matches, so a withdrawal is a pop and a confirmation is
 * an edit to one entry — neither has to be kept in step with a parallel list.
 */
interface PushedRow {
  /** The document line this position held, or `undefined` for chrome. */
  document: number | undefined
  /** The text the line was confirmed to read, once a frame has checked it. */
  text: string | undefined
  /**
   * The text the position held when the terminal moved it there. Kept even after the
   * row stops being deductible, because a later grow pulls the position back onto
   * the screen and needs to know what stood there — not what the document says now.
   */
  shown: string
  /**
   * Whether this position may still be deducted from a flush. Retirement clears this
   * and nothing else: the position is still in native history, so it still occupies
   * the tail a grow pulls from.
   */
  credited: boolean
  /** Whether this position came from a protection scroll rather than a move. */
  settledByProtection?: boolean
  /**
   * Set when this instance stops being eligible for a late confirmation: it was retired, or its
   * place in native history is no longer provable. The position stays on the stack — the
   * terminal still holds it — so presence alone cannot answer this, and a cleared `credited`
   * means "not deductible now", not "still waiting to be confirmed".
   */
  confirmationClosed?: boolean
}

/**
 * A document row the terminal committed, and the text it read when that was
 * confirmed. Keeping the text is what lets a credit be re-checked before it is
 * spent: the same row may have been rewritten since.
 */
interface ConfirmedRow {
  start: number
  end: number
  text: string
}

/**
 * The committed rows whose text still reads as it did when they were confirmed, as
 * ranges. A row that has since been rewritten carries no credit: the terminal
 * committed *that other* row, and the row now standing there still owes a commit
 * of its own.
 */
/**
 * The credited rows on the stack, as ranges: entries that hold a document line and
 * whose text has been confirmed. This is the ledger — derived, not maintained
 * alongside.
 */
function creditedRows(stack: readonly PushedRow[], next?: readonly string[]): { start: number; end: number }[] {
  return mergeRanges(stack
    .filter(row => row.credited)
    .filter((row): row is PushedRow & { document: number; text: string } =>
      row.document !== undefined && row.text !== undefined)
    .filter(row => next === undefined || (next[row.document] ?? '') === row.text)
    .map(row => ({ start: row.document, end: row.document + 1 })))
}

/**
 * The rows that are still credited, for the pending set.
 *
 * Three states, and they are not interchangeable. A row the frame shows with the
 * same text is still credited. A row the frame shows with **different** text has
 * been rewritten, so the terminal's commit was about a row that no longer exists
 * and the credit is dropped. A row the frame cannot speak for — a window that
 * does not contain it, or a frame that declares no body range — is **unknown**,
 * and an unknown row keeps its credit: discarding it would mean the terminal's own
 * commit is forgotten and the row is sent again.
 *
 * The lookup goes through the frame's declared range, so a browse window that
 * *does* contain the row is checked at the window's own offset rather than at an
 * absolute document index.
 */

/**
 * Where a document row's text sits in this frame, or `undefined` when the frame
 * cannot speak for that row. A frame with no declared range says nothing about
 * what it is showing; a frame that declares one speaks only for the rows inside
 * it, since `next` also holds chrome.
 */
function frameTextIndex(
  frame: Frame | undefined,
  next: readonly string[],
  document: number,
): number | undefined {
  const range = frame?.documentRows
  if (range === undefined || range === null) return undefined
  if (document < range.documentStart || document >= range.documentEnd) return undefined
  const index = document - range.documentStart + range.frameStart
  return index < 0 || index >= next.length ? undefined : index
}

/**
 * How many rows a grow pulled back out of history: the number of new rows it added,
 * when the cursor sat at the bottom, and nothing otherwise. A grow whose cursor is
 * not at the bottom only stands blanks at the foot of the screen.
 */
function pulledBackFor(
  oldHeight: number, newHeight: number, cursorRow: number,
): number {
  if (newHeight <= oldHeight) return 0
  return cursorRow >= oldHeight - 1 ? newHeight - oldHeight : 0
}

/**
 * The union of a list of committed ranges: adjacent or overlapping ones collapse
 * into a single span, and two ranges with a gap between them stay apart. The gap is
 * rows the terminal did not commit and the renderer may still owe, so merging
 * across it would claim them.
 */
function mergeRanges(ranges: readonly { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

/**
 * `[from, to)` minus the ranges this frame has already committed by other means, as the
 * spans it still owes.
 */
function subtractFromRange(
  from: number,
  to: number,
  committed: readonly { start: number; end: number }[],
): [number, number][] {
  const spans: [number, number][] = []
  let at = from
  for (const range of [...committed].sort((a, b) => a.start - b.start)) {
    if (range.end <= at || range.start >= to) continue
    if (range.start > at) spans.push([at, Math.min(range.start, to)])
    at = Math.max(at, range.end)
  }
  if (at < to) spans.push([at, to])
  return spans
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
  #image: ImagePlacement | undefined
  readonly #imageId = Math.floor(Math.random() * 0x7ffffffe) + 1
  #imageChanged = false
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
  #decoratedRows: readonly string[] | undefined
  #transient = false
  #altActive = false

  #altScreen: string[]
  #cursorRow = 0
  #cursorCol = 0
  #cursorVisible = true

  /**
   * The main screen's own resize transition, parked while an overlay is up.
   *
   * A terminal resizes both buffers, so a resize that arrives with an overlay
   * frame also moves the hidden main screen and puts rows into its history. The
   * overlay branch reconciles only its own layout, so this is kept — along with
   * the main screen's cursor and source snapshot as of before the move — for the
   * frame that returns to the main screen to settle. Parked rather than stored on
   * `#resize`, because that field is the *active* buffer's transition and the two
   * must not consume each other.
   */
  /**
   * The parked move and the main screen as it stood before it, held in one
   * record so that settling the comparison never has to block painting: the live
   * fields are free to follow the frames the user is asking for, and this record
   * stays put until a frame can finish reading it.
   */
  /**
   * Every main-screen move made while an overlay was up, in the order they
   * happened. One per move, not one per stay: an overlay can be resized more than
   * once, and each resize moves the hidden screen by its own amount.
   */
  #mainResizeRecords: ParkedMove[] = []

  /** What the parked move committed on its own, for the flush to subtract. */
  /**
   * The rows the terminal has pushed into native history, in the order it pushed
   * them, newest last — one entry per physical row, with `undefined` wherever the
   * row held no document line (chrome: a marker, padding, the composer).
   *
   * This is the shape a withdrawal needs. Growing pulls rows back off the **top of
   * history**, which is the newest end here, so a pull takes the last entries and
   * leaves the rest — and a pulled row that was chrome takes nothing with it. A set
   * of document numbers can express neither: it loses the push order, has no place
   * for chrome, and bans a row forever instead of withdrawing one commit.
   */
  #pushed: PushedRow[] = []

  /**
   * Whether native history has moved in a way this account did not follow. From then
   * on the tail describes positions that were pushed, not necessarily the newest ones,
   * so a pull may not take its end for the real end of history. Only knowing what the
   * terminal actually did can clear this.
   */
  #tailStale = false

  /**
   * Instances this account knows will be on the main screen when a protection scroll runs,
   * with the text and source they had. Collected from the moves that put them there — a
   * pulled instance keeps its identity even when the layout after the move is unknown.
   *
   * The protection consumes this rather than the screen memory: `#screen` holds what this
   * renderer last *painted*, which after an overlay stay is not what the terminal shows.
   */
  /**
   * The physical state of the **normal** buffer, kept apart from the pending text queue so a
   * retiring record cannot erase it.
   *
   * `undefined` means no normal paint has happened yet; `'unknown'` means a move left the
   * layout unaccounted for and stays that way until a real paint rebuilds it. There is no
   * fall back to the live fields: restoring trust from them would turn an unaccounted move
   * back into a fact.
   */
  #normalLayout: NormalLayout | 'unknown' | undefined

  #knownOnScreen: PushedRow[] = []

  /**
   * Instances a protection scroll created but could not confirm, kept by identity so a later
   * normal frame can settle them. A protection scroll is one physical commit: its copies stay
   * in `#pushed` whatever happens, and until one is confirmed or resolved they may not be
   * deducted — which is exactly why they must be held rather than dropped when the move that
   * created them stops being compared.
   */
  #unconfirmedProtection: PushedRow[] = []


  /**
   * How many of the **newest** positions are known to be in physical order, counted from a real
   * flush. A pull inside this range consumes order and decreases the count; a pull that reaches
   * past it has left the proven order and is unknown, however much of the collection is left. The
   * collection and this count must describe the same newest end.
   */
  #provenTail = 0

  /**
   * The newest positions whose existence was really sent but whose **arrangement** is unknown: a
   * protection scroll pushes `#height` of them. They are counted, never named. A pull that reaches
   * into this range knows how many rows it took without knowing which they were.
   */
  #unknownFront = 0

  /**
   * A pull that reached into the unknown front and is waiting to be undone. Those rows are known
   * to be on the screen top but cannot be named, so the honest restoration is to scroll them back
   * down before the next overwrite, by count, in screen order.
   */
  #pendingReverse: { count: number; height: number } | undefined

  /**
   * Set while a caller has already written the alternate-buffer exit as part of its own plan, so
   * the paint functions must not emit a second one. The exit belongs to exactly one level.
   */
  #exitOwnedByCaller = false

  /**
   * Whether a move may have brought rows onto the screen that this account never painted,
   * because it asked for more than the tail could account for. The exact count is not
   * knowable; this records only that the situation may exist.
   */
  #unknownOnScreen = false







  /** The move this frame fixed and applied, for whichever draw path runs. */
  #pendingEvent: ParkedMove | undefined


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
    const transition = this.#resize
      ?? { oldHeight: this.#height, widthChanged: false, narrowestWidth: this.#width, intermediateHeights: [] }
    if (transition !== this.#resize) {
      this.#resize = transition
    } else {
      // Remember the height being left behind, so a burst that returns to where
      // it started still records that the window moved in between.
      if (this.#height !== transition.oldHeight) transition.intermediateHeights.push(this.#height)
    }
    if (width !== this.#width) {
      transition.widthChanged = true
      transition.narrowestWidth = Math.min(transition.narrowestWidth, this.#width, width)
    }
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
    let out = this.#image?.protocol === 'kitty' ? deleteImage(this.#imageId) : ''
    this.#image = undefined
    out += this.#decoratedRows === undefined ? '' : this.#paintDiff(this.#screen, this.#decoratedRows)
    this.#decoratedRows = undefined
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

  /** Canonical physical rows, including viewport-only prompt headers. */
  viewport(): readonly string[] { return [...(this.#altActive ? this.#altScreen : this.#screen)] }

  /** Render canonical content, then decorate the viewport without changing history. */
  render(frame: Frame, decorate?: (rows: readonly string[]) => readonly string[]): void {
    // Remove the previous selection before any canonical rows can cross into history.
    // A resize invalidates its physical coordinates; repaint the new viewport instead.
    const hadDecoration = this.#decoratedRows !== undefined
    const resizedDecoration = hadDecoration && this.#resize !== undefined
    const undecorate = hadDecoration && !resizedDecoration
      ? this.#paintDiff(this.#screen, this.#decoratedRows!) : ''
    this.#decoratedRows = undefined
    // The event slot is per-frame. A frame that prepares no move must not inherit the last
    // one's record: the confirmation steps are written against "the move this frame made",
    // and a leftover slot would let them check against rows a previous frame moved. A move
    // that still needs confirming lives in the pending queue, which is what the retry reads —
    // that lifecycle is explicit and not a side effect of this field.
    this.#pendingEvent = undefined
    const graphic = frame.transientSurface === 'scroll' || (frame.liveStart ?? 0) !== 0 ? undefined : frame.image
    const oldGraphic = this.#image
    this.#imageChanged = oldGraphic?.image !== graphic?.image || oldGraphic?.protocol !== graphic?.protocol
      || oldGraphic?.row !== graphic?.row || oldGraphic?.column !== graphic?.column
      || oldGraphic?.columns !== graphic?.columns || oldGraphic?.rows !== graphic?.rows || this.#resize !== undefined
      || (graphic !== undefined && (this.#reanchor || !this.#altActive))
    const removeGraphic = this.#imageChanged && oldGraphic?.protocol === 'kitty' ? deleteImage(this.#imageId) : ''
    this.#image = graphic
    const next = frame.lines.map(line => sanitizeDisplayLine(String(line)))
    const liveStart = Math.max(0, Math.min(frame.liveStart ?? 0, next.length))
    const livePinned = frame.livePinned !== false
    const cursor = frame.cursor ?? { row: next.length, column: 0 }
    const cursorVisible = frame.cursorVisible !== false
    // Settle a main-screen resize that was parked while an overlay was up, but
    // only on a frame that actually comes **back** to the main screen. An overlay
    // repaint is not that frame: restoring there would check the parked snapshot
    // against the *overlay's* lines, find no matching document rows, credit
    // nothing, and drop the pending move — so the rows the terminal committed
    // would be sent a second time when the overlay is finally dismissed. Both
    // paint paths can be the returning frame, a following transcript and a scroll
    // browse alike, so this runs in `render` rather than in either of them.
    // Settles on the frame that comes **back** to the main screen, and afterwards
    // on any further frame that can finish an open comparison. The retry cannot
    // depend on the overlay still being up: after the real exit it is not, and a
    // record left open then would never be read again.
    // Any frame that draws the normal screen may settle an open comparison. The test is the
    // **same predicate the draw dispatch uses**, not a name from the frame: a frame with no
    // `liveStart` goes to the alternate buffer whenever overlays are enabled and it is not a
    // scroll, while a frame naming `overlay` with overlays disabled stays on the normal
    // screen — so `surface`
    // alone would settle records on a frame that painted the other buffer, and refuse to on
    // one that painted this one. An alternate frame may still apply a normal resize event;
    // what it must not do is confirm main-screen sources from overlay text.
    const drawsAlternate = liveStart === 0
      && (this.#alternateScreenOverlays || graphic !== undefined)
      && frame.transientSurface !== 'scroll'
    // Fixed and applied once, after the target buffer is known and before the queue is read, so
    // this frame's own move is part of its own comparison. The draw paths receive the result
    // instead of looking for a field that has already been cleared.
    const pendingTransition = this.#resize
    if (pendingTransition !== undefined) this.#resize = undefined
    this.#pendingEvent = pendingTransition === undefined
      ? undefined
      : this.#prepareNormalMove(pendingTransition)
    if (this.#pendingEvent !== undefined) this.#mainResizeRecords.push(this.#pendingEvent)
    // A normal frame settles the outstanding protection copies before it decides what to
    // commit, so a copy confirmed here takes part in this frame's difference. An alternate
    // frame must not: its lines are not main-screen text and cannot confirm anything.
    let restoreBytes = ''
    const restore = drawsAlternate ? undefined : this.#pendingReverse
    if (restore !== undefined) {
      // The instances this pull took were already collected by `#applyMove` when the risk stood,
      // so they are not pushed again here: the same objects entering the list twice would let one
      // physical instance be confirmed twice.
      //
      // The rows coming back are again positions beyond the proven suffix — native history holds
      // them once more — so the counted front grows by exactly what this move returns.
      this.#unknownFront += restore.count
      // The reverse move is this event's answer to the risk its own pull raised, so that risk is
      // spent: leaving it standing would make the next frame scroll the whole window out over
      // rows that have already been put back.
      this.#unknownOnScreen = false
      this.#pendingReverse = undefined
    }
    if (!drawsAlternate) this.#settleProtection(next, frame)
    const returning = !drawsAlternate
    if (returning && this.#mainResizeRecords.length > 0) {
      // Every move in the stay is settled, oldest first, because each was made
      // against the screen the previous one left.
      const records = this.#mainResizeRecords
      this.#mainResizeRecords = []
      // Records are settled oldest first, and each was made against the screen the
      // previous one left. Once one cannot be checked the rest have lost their
      // context too, so the unresolved remainder is kept for a later frame rather
      // than being thrown away.
      let unresolvedFrom: number | undefined
      for (let at = 0; at < records.length; at += 1) {
      const record = records[at] as ParkedMove
      // Three separate questions, kept apart because conflating any two of them
      // produces a different defect:
      //
      // 1. **May the main screen be painted?** Always, once the frame asks for it.
      //    Settling the accounting must never swallow the frame: the user asked
      //    for this window, and leaving the overlay up because a document
      //    comparison is still open is a display bug, not bookkeeping.
      // 2. **What did the terminal move on its own?** The credit, checked against
      //    the snapshot's rows and the returning frame's text.
      // 3. **Is the comparison complete?** A frame may confirm part of the
      //    snapshot and leave the rest unchecked — a browse window that covers
      //    only the first of two committed rows, or a frame that declares no body
      //    range. "Unchecked" is not "committed nothing", so the unconfirmed
      //    remainder is kept for a later frame.
      const check = this.#creditAgainst(next, frame, record)
      // Every confirmed range is **added**, not assigned. A credit that has been
      // confirmed but not yet retired is still owed its subtraction: going back
      // into the overlay and shrinking again yields a *second* natural commit,
      // and replacing the first with the second would drop rows the terminal had
      // already committed — which then get sent a second time.
      // The move's physical effect on history is applied **once**, from its own
      // geometry and row mapping — not from whether the text check happened to
      // finish. The terminal moved those rows a single time, however many frames it
      // takes to work out what they held; re-applying on a retry would record one
      // move as several, and skipping it because a browse could not read one row
      // would lose it entirely.
      // A confirmation edits the **existing** entries; it never adds to the stack.
      // A row the frame could not read stays unconfirmed and is re-checked on a
      // later frame, without the move being recorded twice.
      for (const row of check.confirmed) {
        const entry = record.pushedRows?.find(
          item => item.document === row.start && item.text === undefined,
        )
        if (entry !== undefined) {
          entry.text = row.text
          entry.credited = true
        }
      }
      if (check.remaining !== undefined && unresolvedFrom === undefined) unresolvedFrom = at

      // A confirmed credit is subtracted from what the flush owes rather than
      // folded into the boundary, because the rows between the two are still owed:
      // with `liveStart` 8, only 0..7 are committed, and a natural commit of
      // [20,22) still leaves [8,20) owed. Advancing the boundary to the end of
      // the commit would mark all of it done and those rows would never be sent.
      // A row that touches the frozen boundary is settled by moving the boundary over
      // it; the rest stays on the stack for the flush to subtract.
      this.#settleBoundary()

      // The snapshot lives in its own record, separate from `#resize` and from
      // the live screen memory, so it survives a frame that could not finish the
      // comparison without holding up the paint. A transition that arrived after
      // this record was parked belongs to a **later** move and is left alone:
      // consuming it here would settle a resize the record never described.
      }
      if (unresolvedFrom !== undefined) this.#mainResizeRecords = records.slice(unresolvedFrom)
    }

    // The reverse move belongs to the normal buffer, so the plan exits the alternate buffer
    // itself — in its own position, before the scroll — and the paint is told not to emit that
    // exit again. The buffer state is read here, before any paint has had the chance to change it.
    if (restore !== undefined && !drawsAlternate && this.#altActive) {
      restoreBytes = EXIT_ALT_SCREEN
        + csi(this.#height - 1, 0)
        + '\n'.repeat(restore.count)
      // Only the ownership flag is set here. Clearing `#altActive` here would make the paint's own
      // `leavingAlt` false, changing which baseline it picks and skipping the forced repaint that
      // leaving the buffer requires; the buffer is left for the paint to close as it always did,
      // with its exit suppressed.
      this.#exitOwnedByCaller = true
    } else if (restore !== undefined && !drawsAlternate) {
      restoreBytes = csi(this.#height - 1, 0) + '\n'.repeat(restore.count)
    }
    const paint = liveStart === 0
      ? this.#paintTransient(next, cursor, cursorVisible, frame.transientSurface, frame)
      : this.#paintFollow(next, liveStart, livePinned, cursor, cursorVisible, frame)
    // The reverse move is a prefix of this frame's output and is emitted before any of it can
    // overwrite the rows: position at the bottom of the normal screen, then scroll down by the
    // exact count that was taken there. It is put in front of the frame body rather than into a
    // separate write so nothing drawn later can displace it.
    // The reverse move belongs to the normal buffer. This prefix is correct for a frame that is
    // already on it, which is the case the current regression covers.
    //
    // Known gap, not solved here: `paint` is `#finishPaint`'s output and is already packaged by
    // `#wrap`, so the `1049` exit a leaving-alt frame carries is **not** at its front — searching
    // for it there matches nothing and the prefix still runs while the alternate buffer is in
    // effect. Ordering this correctly needs the exit, the reverse move, the baseline and the main
    // paint to be sequenced as a structured plan **before** wrapping, with one owner for the exit;
    // it cannot be repaired by inspecting the packaged string. Until that exists, a frame that
    // leaves the alternate buffer does not run the reverse move on the right buffer.
    this.#exitOwnedByCaller = false
    // One packaging for the whole frame: the reverse prefix and the body are wrapped together
    // rather than the body being wrapped on its own and the prefix left outside it.
    const viewport = this.#altActive ? this.#altScreen : this.#screen
    const decorated = decorate?.(viewport) ?? viewport
    const decoration = this.#paintDiff(decorated, viewport)
    if (decoration !== '') this.#decoratedRows = decorated
    const repaint = resizedDecoration ? this.#writeRun(viewport, 0, this.#height - 1) : ''
    const restoreCursor = undecorate !== '' || decoration !== '' || repaint !== ''
      ? csi(this.#cursorRow, this.#cursorCol) : ''
    const graphics = graphic !== undefined && this.#imageChanged ? imageSequence(graphic, this.#imageId) + csi(this.#cursorRow, this.#cursorCol) : ''
    const frameBytes = removeGraphic + undecorate + restoreBytes + paint + repaint + decoration + restoreCursor + graphics
    if (frameBytes !== '') this.#sink.write(this.#wrap(frameBytes))
  }

  #paintTransient(
    next: readonly string[],
    cursor: { row: number; column: number },
    cursorVisible: boolean,
    surface: 'overlay' | 'scroll' | undefined,
    frame: Frame,
  ): string {
    const target = this.#target(next, 0, 'top')
    // The transition is fixed here, before the buffer is chosen, so the alternate branch and
    // the baseline path below consume the same event instead of each looking for it later —
    // by which time one of them would already have cleared the shared field.
    const transitionForAlt = this.#pendingEvent?.transition
    // Browsing history is not an overlay: the alternate buffer would hide the
    // terminal's own scrollback, which is exactly what the user is scrolling
    // through, so a scroll frame repaints the main screen instead.
    if ((this.#alternateScreenOverlays || frame.image !== undefined) && surface !== 'scroll') {
      // A transition present here is the overlay's own: the main screen's is parked
      // on `#mainResizeRecord`, so a restore never re-arms this clear.
      const clear = !this.#altActive || transitionForAlt !== undefined || this.#imageChanged
      let body = this.#altActive ? '' : ENTER_ALT_SCREEN
      body += this.#paintScreen(target.rows, clear ? this.#blankScreen() : this.#altScreen, clear)
      const targetRow = this.#screenRow(cursor.row, target, next.length)
      body += csi(targetRow, cursor.column)
      body += cursorVisible ? SHOW_CURSOR : HIDE_CURSOR
      this.#altActive = true
      this.#altScreen = target.rows
      this.#cursorVisible = cursorVisible
      // The clear above already reconciled the overlay's own layout; leaving
      // its re-anchor pending would clear the overlay again on every following
      // frame.
      //
      // A resize arriving with this frame also moved the *main* screen: a
      // terminal resizes both buffers, and the hidden one is not exempt. So the
      // transition is parked on `#mainResizeRecord` rather than dropped, together with
      // the main screen's own cursor and source snapshot. The overlay settles its
      // layout and leaves the main screen to be reconciled by the frame that comes
      // back to it.
      // Park only a real transition, and never overwrite one that is already
      // parked. An ordinary overlay repaint arrives with no new transition, and
      // assigning unconditionally would replace a pending main-screen move with
      // `undefined` — losing the move and its snapshot entirely. The main screen
      // may have been resized while this overlay was up and again while it stayed
      // up; the first move is the one the boundary has to account for, and a later
      // one cannot be folded into it.
      // Every move in this overlay stay gets its own record. Keeping only the
      // first would leave the second resize's rows unaccounted for, and they would
      // be sent a second time when the overlay finally comes down.
      //
      // The snapshot is **advanced** past any earlier unsettled move first. No
      // frame repainted the main screen in between, so the live fields still show
      // the screen as it was before the earlier move; taking them as they stand
      // would describe the wrong rows. A push shifts the screen up by exactly the
      // rows it pushed, so the earlier move's own geometry says how far to shift.
      // Only advance from the queue when nothing repainted the main screen since.
      // A record can outlive its stay — kept because its comparison is unfinished —
      // while the main screen has meanwhile been painted for real. Its snapshot then
      // describes a screen that no longer exists, and advancing from it invents
      // committed rows that were never committed. The live fields are accurate
      // exactly in that case, because a real paint wrote them.
      if (transitionForAlt !== undefined) {
        // Only advance from an earlier record when nothing repainted the main screen
        // since. A record can outlive its stay — kept because its comparison is
        // unfinished — while the main screen has meanwhile been painted for real. Its
        // snapshot then describes a screen that no longer exists, and the move's own
        // `after` is not built at all, so the following move inherits an unaccounted
        // layout rather than a guess at one.
        // The starting layout no longer lives in this branch: it is the shared
        // `#normalLayout`, which records whichever physical action established the normal
        // buffer last. Keeping a second answer here — the queue's own `after`, or the live
        // fields — is what let the two timelines disagree about the same move.
        // A grow takes back **exactly the rows the terminal pulls down**, and no
        // more. Verified against @xterm/headless 6.0.0: ten rows showing `line-20`
        // to `line-29` over history `line-0..7`, shrunk to six, commits
        // `line-20..23`; growing back to seven with the cursor at the bottom pulls
        // **only `line-23`** down again, leaving `line-20..22` in history. So the
        // withdrawal is the rows the stack holds at its newest end — the positions the
        // terminal pushed last, which are not the same thing as the highest document
        // numbers, and include rows holding no document line at all. A grow whose
        // cursor is not at the bottom pulls back nothing.
        //
        // Withdrawing the whole ledger instead re-sends rows that are still in
        // history, and history cannot be rewritten once it has scrolled.
        // The rows taken back are recorded on the grow's own move. The move's effect
        // on history is applied when it is **parked** (see `#applyMove`), not here:
        // a following move in the same stay has to see the tail this one leaves.
        // The cursor the move starts from comes from the shared layout, not the live
        // field: during a stay the live cursor still holds the main screen's position from
        // *before* the stay, so it cannot decide whether the hidden screen sat at the
        // bottom.
        // The hidden buffer's move goes through the same preparation as the main screen's,
        // so one normal physical timeline covers both and a later frame returning to the
        // main screen reads the state this move leaves rather than an older snapshot.

      }
      this.#resize = undefined
      this.#reanchor = false
      return body
    }
    const leavingAlt = this.#altActive
    const exitAlt = leavingAlt && !this.#exitOwnedByCaller ? EXIT_ALT_SCREEN : ''

    const resized = this.#takeResizeBaseline(transitionForAlt)
    // Leaving the alternate buffer restores whatever the main screen held before
    // it was entered, so that snapshot is the baseline to diff against.
    const baseline = leavingAlt ? this.#screen : resized.rows
    if (leavingAlt) {
      this.#altActive = false
      this.#altScreen = this.#blankScreen()
    }
    // A frame that comes back to the main screen also has to settle what the
    // terminal committed while the overlay covered it. A browse window repaints
    // itself whole and commits nothing, so the rows between the frozen boundary
    // and the parked commit are owed here — and the parked rows must not be sent
    // again. Both paths need it, so it runs whichever of them this frame takes.
    // A browse window is not the document, so it cannot settle a document-level
    // commit: the rows it shows are a window, and crediting against it would
    // compare the wrong text. The credit stays parked for the next frame that
    // carries the document — and the rows between the boundary and the commit
    // are still owed, so the boundary does not move either.
    // A transient frame covers the main screen too, so it consumes the same protection
    // risk before it paints. `leavingAlt` is handled above by the caller having already
    // exited the alternate buffer: the scroll has to act on the main screen.
    const protect = leavingAlt || !this.#altActive
      ? this.#planProtection(next, frame)
      : { lead: '', confirmed: [] }
    const flush = ''
    // The scroll blanked the window, so the protected baseline is not what is on screen
    // any more: diffing against it would skip every row that now reads blank and record
    // lines the terminal does not hold. A protection scroll therefore forces the repaint
    // exactly as a clear does.
    const body = protect.lead
      + this.#paintScreen(
        target.rows,
        protect.lead === '' ? baseline : this.#blankScreen(),
        this.#reanchor || resized.clear || leavingAlt || protect.lead !== '',
      )
    this.#reanchor = false
    this.#transient = true
    // Every frame painted on the main screen replaces what the main screen
    // showed — a browse, but also a main-screen overlay, which is a different
    // thing entirely and must clear the document range rather than leave the
    // previous one standing. An alternate-buffer frame is a different buffer and
    // is filtered inside the recorder, not here.
    const header = this.#paintStickyHeader(frame, target)
    this.#screenRows = target.rows
    this.#recordSource(frame, target)
    return this.#finishPaint(exitAlt + body + flush + header, target, next.length, cursor, cursorVisible)
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
    const leavingAlt = this.#altActive
    const exitAlt = leavingAlt && !this.#exitOwnedByCaller ? EXIT_ALT_SCREEN : ''
    if (leavingAlt) {
      this.#altActive = false
      this.#altScreen = this.#blankScreen()
    }
    const viewStart = Math.max(0, next.length - this.#height)
    const candidatePhysical = livePinned ? Math.min(liveStart, viewStart) : viewStart
    // A fold can start exactly at the frozen boundary: its unchanged prefix
    // remains in history, but now fits in the live viewport again.
    const reshaped = this.#reflowFrom !== undefined && (this.#reflowFrom < this.#physical
      || (this.#reflowFrom === this.#physical && candidatePhysical < this.#physical))
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
    } else if (this.#pendingEvent !== undefined
      || (!this.#tailStale && creditedRows(this.#pushed, next).length > 0)) {
      const transition = this.#pendingEvent?.transition
      const baseline = transition === undefined
        ? { rows: this.#screen.slice(0, this.#height), clear: true }
        : this.#resizedScreen(transition)
      body = this.#paintScreen(
        target.rows, baseline.rows,
        transition === undefined ? true : transition.widthChanged || baseline.clear,
      )
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
      // The move's physical effect on history happens **once**, before the branches
      // decide anything, and whichever branch this frame then takes works from the
      // same history. Applying it inside one branch meant a frame that took another
      // branch never recorded the push at all — a visible grow's pull, for instance,
      // was written in the fallback branch while a frame with credits pending went
      // to the branch above it, so the row the terminal took back kept its credit and
      // the flush skipped it.
      // The move for this frame was fixed and applied by the single producer in `render`, whose
      // record carries the trust it was applied under. Re-judging it here from the live screen
      // would interpret the same event a second time, against a screen that has already moved.

      if (reshaped) {
        this.#physical = Math.max(candidatePhysical,
          this.#reshapedBoundary(next, Math.max(liveStart, candidatePhysical), transcript))
        this.#frozenViewport = this.#physical > candidatePhysical
        this.#reflowFrom = undefined
        this.#reanchor = false
        this.#adoptPhysicalAfterTransient = false
      } else if (candidatePhysical > this.#physical || (!this.#tailStale && creditedRows(this.#pushed, next).length > 0)) {
        // What still needs committing, as a set difference rather than one
        // number. The frozen boundary is the floor — an earlier frame already
        // committed everything above it. The terminal's own move removes a
        // *range* from what is left, and that range need not touch the floor:
        // a browse window that starts past it leaves a gap between the two that
        // a single `max` would silently drop. So: commit the part of
        // [floor, candidate) below the committed range, and the part above it.
        // The comparison for this frame's move already ran: the single producer in `render` kept
        // the event, and the central queue confirmed it before any draw path was chosen. Doing it
        // again here would give one move two ledgers to be checked against, and the second one is
        // built from a screen the first has already changed.
        // A visible resize's confirmations go into the same ledger the parked ones
        // use, **before** anything is retired. A confirmation that reaches past the
        // candidate has not been settled by this frame — with `liveStart` 8 and a
        // commit of [20,22), a frame whose candidate is 10 owes nothing of it — and
        // dropping it here loses the fact that those rows are in history, so a later
        // frame that does reach them sends them again.
        // Re-checked at the moment of use: a credit confirmed against text that has
        // since been rewritten is no longer evidence about this document, while one
        // the frame cannot see stays credited.
        // A credited position is only usable as a deduction while the tail still describes
    // real history: an unfollowed move may have pulled that very instance back off it,
    // and skipping a row the terminal no longer holds would drop it entirely rather
    // than merely sending it twice.
    const committed = this.#tailStale ? [] : creditedRows(this.#pushed, next)
        const floor = Math.min(candidatePhysical, Math.max(0, this.#physical))
        // Rows this flush actually settled stop being deductible — their positions
        // stay, because the terminal still holds them and a grow pulls from exactly
        // there. A row past the candidate has not been reached at all and keeps its
        // claim for the frame that does reach it.
        for (const row of this.#pushed) {
          if (row.credited && row.document !== undefined && row.document < candidatePhysical) {
            row.credited = false
            // Same rule as the boundary settlement: retiring settles the position, so its
            // confirmation is closed while the position itself stays.
            row.confirmationClosed = true
          }
        }
        // The plan itself is not gated on there being rows to commit: a protection scroll
        // covers the main screen whether or not this frame owes anything, and the target
        // viewport has to be drawn again afterwards either way.
        const protect = this.#planProtection(next, frame)
        const owed = floor < candidatePhysical
          ? subtractFromRange(floor, candidatePhysical, [...protect.confirmed, ...committed])
          : []
        if (owed.some(([from, to]) => from < to)) {
          // One pass, so the two halves cannot clear each other's output.
          body = protect.lead + this.#paintFlushRanges(next, owed, viewStart)
        } else if (protect.lead !== '') {
          // Nothing left to commit, but the scroll just blanked the window: paint the
          // target viewport so the frame shows what it says it shows. Leaving the
          // newlines alone left an empty screen that `#finishPaint` then recorded as the
          // target — a frame wrong on screen and wrong in memory for the next diff.
          body = protect.lead + this.#paintScreen(this.#target(next, viewStart, 'bottom').rows, this.#blankScreen(), true)
        }
        // This boundary has already been moved down where a real pull took instances back out of
        // history: the shared entry records what it actually took, so the proof is settled before
        // this point. What is left is a commit frame — the rows it sent end at the candidate — so
        // the boundary may advance, and it may not retreat. A smaller candidate is not evidence
        // that rows left the terminal, and a requested pull is a limit, not a result.
        this.#physical = Math.max(this.#physical, candidatePhysical)
        this.#frozenViewport = this.#physical > candidatePhysical
      } else if (this.#physical > candidatePhysical) {
        this.#physical = Math.max(0, Math.min(this.#physical, next.length))
        this.#frozenViewport = true
      } else {
        // The candidate has not moved, yet the viewport now reaches further back
        // into the document than it did. How many of those rows the terminal
        // already moved into native history is a **count**, not a yes/no, and it
        // is not the height difference: the terminal removes blanks from the
        // bottom first and only pushes what is left over off the top. For a
        // same-width shrink the count is `oldCursorRow + 1 - newHeight`, floored
        // at zero, and every one of the three shapes is real. Checked against
        // @xterm/headless 6.0.0, all on a 5-row screen holding `[p1..p5]` over
        // history `[a,b]` shrinking to 2 rows:
        //
        // - cursor on row 0: history stays `[a,b]`, nothing is pushed;
        // - cursor on row 3: history becomes `[a,b,p1,p2]`, two rows pushed;
        // - cursor on row 4: history becomes `[a,b,p1,p2,p3]`, all three pushed.
        //
        // Treating it as "at the bottom or not" gets the middle case wrong, and
        // both endpoint answers do too: crediting `viewStart` when the count is
        // zero freezes rows that never entered history, and holding at the
        // candidate when the count is positive flushes rows the terminal already
        // moved, duplicating them.
        //
        // `#cursorRow` still holds the position from before the resize, since the
        // frame that would move it has not been painted yet, and that is the same
        // signal the terminal itself uses.
        //
        // A **width** change is not a case of "no rows moved". Verified against
        // @xterm/headless 6.0.0: a 5-row screen holding `[p1..p5]` over history
        // `[a,b]` with the cursor on the last row, resized to 100 columns and 2
        // rows, ends on `[p4,p5]` with `[a,b,p1,p2,p3]` in history — the short
        // lines do not wrap, so the same three rows are committed as in a
        // same-width shrink. Treating a width change as a known zero would credit
        // nothing and make the next flush commit those rows a second time.
        //
        // The same source-aware accounting as every other resize branch. A count
        // of pushed rows says how many left the screen, not *which document rows*
        // they were: with `liveStart` 8 and a ten-row window showing 20..29, the
        // count is two but the rows the terminal committed are 20 and 21 — not the
        // 8 and 9 that lie next to the frozen boundary. Advancing the boundary by
        // the count would claim 8 and 9 as committed, and they would never be sent
        // by any later frame.
        // The event prepared for this frame, not an object rebuilt beside it: a substitute
        // mixing live fields with the event's trust describes a move that never happened,
        // and the confirmation would be about rows the application never touched.
        // Confirmed centrally, for the same reason as above: this path reads the ledger the
        // comparison left behind and never confirms an instance of its own.
        // Only the rows touching the boundary are settled here; the rest stay on the
        // stack for the flush to subtract.
        this.#settleBoundary()
        this.#frozenViewport = false
      }
      // No re-queue here: the move this frame made was already kept by the single producer in
      // `render`, before the comparison ran. Keeping a second copy from the follow path would
      // leave two records for one move and two chances to confirm it.
      this.#resize = undefined
    } else if (reshaped) {
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
        // Returning from an overlay or a browse. A boundary already mapped past the candidate
        // is kept: the frozen rows are still in native history, and a grow pulls exactly those
        // instances back — which is what `#pulledFromHistory` accounts for, not a reason to
        // claim they never were frozen. A boundary **below** the candidate has rows that were
        // never sent at all, and those are committed for real before the boundary follows them.
        // A repaint on its own proves nothing and may not move it.
        const mapped = this.#physical > candidatePhysical
        if (mapped) {
          this.#physical = Math.max(0, Math.min(this.#physical, next.length))
          this.#frozenViewport = true
          body = this.#paintScreen(target.rows, this.#screen, true)
        } else if (candidatePhysical > this.#physical) {
          // The flush emits the owed range and the live window together, so the target is
          // already drawn; adding a screen paint after it would clear and repaint the same rows
          // without proving anything new. Rows below the candidate were never sent, and only
          // now that they are does the boundary follow them.
          body = this.#paintFlush(next, this.#physical, candidatePhysical, viewStart, false)
          this.#physical = candidatePhysical
          this.#frozenViewport = false
        } else {
          // Nothing to send and nothing proven to move: the frame paints, the boundary stays
          // where the last real commit left it.
          body = this.#paintScreen(target.rows, this.#screen, true)
          this.#frozenViewport = false
        }
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
      // The draw plan: settle the protection's own history event first, take its rows out
      // of what this frame still owes, and only then generate the bytes.
      const protect = this.#planProtection(next, frame)
      const owed = subtractFromRange(this.#physical, candidatePhysical, protect.confirmed)
      body = protect.lead + (owed.length === 1
        ? this.#paintFlush(next, owed[0]![0], owed[0]![1], viewStart, false)
        : this.#paintFlushRanges(next, owed, viewStart))
      this.#physical = candidatePhysical
    } else {
      if (!this.#frozenViewport && candidatePhysical < this.#physical) effectiveStart = Math.max(this.#physical, viewStart)
      target = this.#target(next, effectiveStart, 'bottom')
      // The hidden normal buffer may no longer match the last painted snapshot.
      // Restore the live viewport explicitly, even when its logical rows are unchanged.
      body = this.#paintScreen(target.rows, this.#screen, leavingAlt)
    }

    this.#transient = false
    const header = this.#paintStickyHeader(frame, target)
    this.#screenRows = target.rows
    this.#recordSource(frame, target)
    this.#reflowFrom = undefined
    if (candidatePhysical >= this.#physical) this.#frozenViewport = false
    this.#followRows = next
    this.#followEnd = Math.max(liveStart, this.#physical)
    this.#followTranscript = transcript
    return this.#finishPaint(exitAlt + body + header, target, next.length, cursor, cursorVisible)
  }

  #stickyHeader(frame: Frame, target: ScreenTarget): string | undefined {
    const range = frame.documentRows
    if (range === undefined || range === null || target.offset > 0) return undefined
    const document = range.documentStart + Math.max(0, target.start - range.frameStart)
    return frame.stickyHeaders?.findLast(header => document >= header.start && document < header.end)?.text
  }

  /** Paint after document flushes so the label never becomes a transcript row. */
  #paintStickyHeader(frame: Frame, target: ScreenTarget): string {
    const header = this.#stickyHeader(frame, target)
    if (header === undefined) return ''
    target.rows[0] = sanitizeDisplayLine(header)
    return this.#writeRun(target.rows, 0, 0)
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
    this.#noteFlushed(next, ranges.flatMap(([from, to]) => Array.from(
      { length: Math.max(0, to - from) }, (_, i) => from + i,
    )))
    let out = this.#clearViewport()
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
    this.#noteFlushed(next, Array.from(
      { length: Math.max(0, committedEnd - start) }, (_, i) => start + i,
    ))
    let out = clearScreen ? this.#clearViewport() : csi(0, 0)
    if (rows.length < this.#height) out += csi(this.#height - rows.length, 0)
    for (let i = 0; i < rows.length; i += 1) {
      if (i > 0) out += '\r\n'
      // EL is required before a shorter final row scrolls into history.
      out += CLEAR_LINE + (rows[i] ?? '')
    }
    return out
  }

  /** ED2 can append the entire screen to tmux history (scroll-on-clear). */
  #clearViewport(): string {
    // The initial clear may preserve pre-existing shell output, and alternate
    // buffers have no scrollback. Later main-screen clears are strictly local.
    if (!this.#hasFrame || this.#altActive) return CLEAR_SCREEN
    return Array.from({ length: this.#height }, (_, row) => csi(row, 0) + CLEAR_LINE).join('') + csi(0, 0)
  }

  #paintScreen(next: readonly string[], old: readonly string[], clear: boolean): string {
    return (clear ? this.#clearViewport() : '') + this.#paintDiff(next, clear ? this.#blankScreen() : old)
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

  #takeResizeBaseline(transition: ResizeTransition | undefined): ResizeBaseline {
    if (transition === undefined) return { rows: this.#screen, clear: false }
    this.#adoptPhysicalAfterTransient = true
    // The baseline is computed **before** the transition is dropped. It needs the
    // heights the window passed through, and reading them off `this.#resize`
    // after clearing it found nothing there — so a 5 -> 2 -> 5 burst looked like
    // a window that had never moved and the browse and transient paths reused a
    // screen the terminal had already replaced. The transition is an input to
    // this call, not something to look up later.
    const baseline = transition.widthChanged
      ? { rows: this.#blankScreen(), clear: true }
      : this.#resizedScreen(transition)
    // This helper computes a baseline and nothing else. The move itself was fixed and applied by
    // the single producer in `render`, before any draw path was chosen, so preparing here would
    // run a second move off a layout the first one has already changed — and queue a second
    // record that never held the instances the real move created.
    return baseline
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
    const pinned = this.#stickyHeader(frame, target) !== undefined
    for (let at = 0; at < target.rows.length; at += 1) {
      const frameRow = target.start + at - target.offset
      const document = range.documentStart + (frameRow - range.frameStart)
      const inside = !(at === 0 && pinned)
        && frameRow >= range.frameStart && document >= range.documentStart && document < range.documentEnd
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
   * A row that is not a document row — padding, an overflow marker — does not by
   * itself end the run, and it does not extend it either. The terminal pushes
   * `pushed` rows from the top whatever they hold, so the credit is exactly the
   * document rows among those `pushed` physical rows. Checked against
   * @xterm/headless 6.0.0, on 5 rows `['','','a','composer','footer']` shrinking
   * to 1, counting **raw** history rows and `baseY` rather than the rows that
   * happen to have text:
   *
   * - cursor on the last row: `baseY` goes 0 -> 4, raw history is
   *   `['','','a','composer']`. Two padding rows went first and did not stop the
   *   push, so the content rows committed are `['a','composer']`.
   * - cursor on row 2: `baseY` goes 0 -> 2, raw history is `['','']` — two rows
   *   really were pushed — and the *content* rows committed are `[]`. The run
   *   ended at the padding before it ever reached `a`.
   * - cursor on the last row of `[marker, line-1..line-4]` shrinking to 3: raw
   *   history is `['marker','line-1']`. The marker went, and so did the row under
   *   it.
   *
   * Reading those as "no rows moved" because none had text is the mistake this
   * count exists to prevent, so the numbers here are the physical ones: pushed
   * rows, `baseY`, and raw history.
   *
   * What the earlier code got wrong was not the `continue` past a non-document
   * row — that part was right and stayed. It was the scan *length*: the height
   * difference made the loop reach past the rows the terminal actually moved, so
   * it read `line-12` off the screen and credited a row that never left.
   *
   * How many rows were pushed is not the height difference. The terminal removes
   * blanks from the bottom first and pushes only the remainder, so the count is
   * `max(0, min(cursorRow + 1, oldHeight) - newHeight)` — one in the overflow
   * case, where the height difference would say two.
   *
   * And a pushed row counts
   * only while the document still reads the same at that position: new text
   * taking a position over means the old row entering history says nothing
   * about the new one, and the run of committed rows ends there.
   */
  /**
   * What a frame can confirm about a parked move, and what it cannot.
   *
   * `confirmed` is the part of the natural commit whose document text this frame
   * actually supplied. `remaining` is the rows the frame could not speak for: a
   * browse window that covers only the first of two committed rows, or a frame
   * that declares no body range at all. Keeping the two apart is the point — a
   * frame that confirmed nothing is not a frame that says the terminal moved
   * nothing, and treating the first as the second is how rows already in history
   * get sent again.
   *
   * `remaining` is `undefined` when the comparison is **complete**, which is a
   * different answer from "confirmed nothing": a terminal that pushed no rows is
   * complete with no range, and so is a frame whose text matched every row the
   * terminal moved.
   */
  /**
   * Advance the frozen boundary over every credited row that sits next to it, and
   * leave the rest on the stack. A row further along has not been settled by this
   * frame — the flush has not reached it — so it keeps its place for the frame that
   * does.
   */
  /**
   * Record that the renderer itself pushed these document rows into native history.
   *
   * They are not credits — the renderer sent them, so there is nothing to deduct —
   * but they do occupy the **tail**, and a later grow pulls from exactly there. A
   * ledger that only knows about deductible rows would pop the wrong position.
   */
  #noteFlushed(next: readonly string[], documents: readonly number[]): void {
    // A real flush appends positions in the order they were sent, so from here the newest
    // entries do describe the tail again; a pull may consume them.
    // A real flush appends its positions in the order they were sent, so the ordered suffix grows
    // by exactly that many; those positions are no longer part of the unknown front.
    if (documents.length > 0) this.#provenTail += documents.length
    for (const document of documents) {
      this.#pushed.push({
        document,
        text: undefined,
        shown: next[document] ?? '',
        credited: false,
      })
    }
  }

  /**
   * Apply a move's physical effect on native history: the rows it pushed join the
   * tail, and the rows it pulled come back off it. Called once, where the move is
   * parked, so every later move in the same stay sees the history it actually left.
   */
  /**
   * Build and apply the move a resize transition describes for the normal buffer, once.
   *
   * The before-state follows the normal physical timeline, not the draw path this frame
   * happens to take: whatever a real paint or an earlier move left last is what this event
   * started from. An unfinished text comparison does not enter into it, and a layout that a
   * move left unknown stays unknown.
   */
  #prepareNormalMove(transition: ResizeTransition): ParkedMove {
    // Three states, kept apart. Never painted: nothing describes the buffer yet, so the live
    // fields are the only thing there is. Left unknown by a move: the live values are filled
    // in but **marked unusable** — `geometryTrusted`/`sourceUsable` are false and the source
    // is null, so no consumer may treat them as a starting point; the record carries no
    // trusted before-state rather than claiming the fields were never read. Known: the
    // snapshot is the event's before-state, including a null source, which is a real
    // statement about the document rather than a missing value to be replaced.
    const known = typeof this.#normalLayout === 'object' ? this.#normalLayout : undefined
    const cursorRow = known?.cursorRow ?? this.#cursorRow
    const record: ParkedMove = this.#normalLayout === 'unknown'
      ? {
        transition,
        newHeight: this.#height,
        cursorRow: this.#cursorRow,
        // Not a proven zero. The geometry guard stops `#applyMove` before it can decide a
        // pull, so a zero here would be a number nothing established — and the risk of a
        // grow having brought unknown content onto the screen would go with it. The risk is
        // raised below from the transition itself instead.
        pulledBack: 0,
        screen: this.#screenRows,
        // Copied rather than cast: the snapshot is readonly and the record's field is not.
        rowSource: [...this.#screenRowSource],
        sourceUsable: false,
        geometryTrusted: false,
        outputTrusted: false,
        source: null,
        sourceKnown: false,
      }
      : {
        transition,
        newHeight: this.#height,
        cursorRow,
        pulledBack: pulledBackFor(transition.oldHeight, this.#height, cursorRow),
        screen: known?.screen ?? this.#screenRows,
        rowSource: known === undefined ? this.#screenRowSource : [...known.rowSource],
        sourceUsable: known !== undefined,
        geometryTrusted: known !== undefined,
        outputTrusted: false,
        source: known === undefined ? this.#screenSource : known.source,
        sourceKnown: known === undefined ? this.#screenSourceKnown : known.sourceKnown,
      }
    // A grow may have pulled unknown content back onto the screen, and that risk must not be
    // dropped along with the arithmetic when no exact push or pull can be applied. It is read
    // from the transition rather than guessed from an old cursor: a taller window, including
    // one that shrank on the way, may have taken rows out of native history.
    const mayHavePulled = this.#height > transition.oldHeight
      || transition.intermediateHeights.some(height => this.#height > height)
    // Applied once, before any draw path is chosen: a later move in the same frame has to
    // see the tail this one leaves, and the draw paths must not apply it again.
    this.#applyMove(record)
    record.outputTrusted = record.after !== undefined
    // The risk is read off the **outcome**, not off the record's initial state: a move that
    // produced no `after` is one this account could not follow, whether it started unknown or
    // was stopped by its own geometry guard. Waiting for the next resize to notice would let
    // this frame clear rows the grow just brought back. The exact instances are still not
    // claimed here — only that the screen may now hold rows this account never painted.
    if (record.after === undefined && mayHavePulled) this.#unknownOnScreen = true
    // The move does not change which document the rows came from, so the event's own source
    // state carries forward; an unaccounted result becomes explicitly unknown rather than
    // inheriting the input's trust.
    this.#normalLayout = record.after === undefined
      ? 'unknown'
      : {
        screen: [...record.after.screen],
        rowSource: [...record.after.rowSource],
        cursorRow: record.after.cursorRow,
        source: record.source,
        sourceKnown: record.sourceKnown,
      }
    return record
  }

  #applyMove(record: ParkedMove): void {
    // Re-applying a record is a retry of the **same** event, so it must leave every other piece of
    // state alone. This check therefore comes before anything below, including the invalidation of
    // an unrelated pending plan.
    if (record.stackApplied) return
    record.stackApplied = true
    const pending = this.#pendingReverse
    const heights = [record.transition.oldHeight, ...record.transition.intermediateHeights, record.newHeight]
    const growth = record.newHeight - record.transition.oldHeight
    // Consecutive same-width grows prepend rows without disturbing their order. The
    // unknown front proves these additional rows exist even though their text is unknown.
    // Return the combined prefix when leaving the overlay, rather than forgetting that
    // its earlier rows were already committed before the terminal pulled them back.
    if (pending !== undefined && pending.height === record.transition.oldHeight
      && !record.transition.widthChanged && !this.#tailStale && this.#provenTail === 0
      && growth > 0 && growth <= this.#unknownFront
      && heights.every((height, index) => index === 0 || height >= heights[index - 1]!)) {
      this.#pendingReverse = { count: pending.count + growth, height: record.newHeight }
      this.#unknownFront -= growth
      record.pulledBack = growth
      record.pushedRows = []
      record.after = undefined
      return
    }
    // A later move disturbs the rows a pending reverse move was waiting to return: what they are
    // cannot be shown to still sit at the top of the screen. The plan is dropped here, before the
    // geometry guard, because a move that cannot be followed at all is exactly the case where that
    // proof is gone. Its rows are **not** counted back into `#unknownFront`: no reverse move ran, so
    // nothing proves native history holds them again, and that count is a usable lower bound on
    // what history still holds — a different quantity from the positions a dropped plan was
    // waiting on.
    this.#pendingReverse = undefined
    // An unaccounted start means the rows this move would push and pull are a guess, so
    // the ledger is left alone too — the check cannot come after the mutation, or a
    // guess has already moved the boundary and the tail by the time it runs.
    if (!record.geometryTrusted || this.#wraps(record.screen, record.transition)) {
      // The terminal moved history and this account did not follow it, so the tail no
      // longer describes the real end of native history. Saying so is what keeps a
      // later pull from taking an older position for the newest one.
      this.#tailStale = true
      // The end of native history is now unproven, so neither quantity below still describes it.
      // The suffix's order is void, and the counted front — which was a **lower bound on what
      // history still holds** — is void for the same reason: a move this account could not follow
      // moved rows nobody tracked, so any number standing for that range is a leftover claim about
      // a range that no longer exists as described.
      this.#provenTail = 0
      this.#unknownFront = 0
      record.after = undefined
      return
    }
    const pushed = Math.max(
      0, Math.min(record.cursorRow + 1, record.transition.oldHeight) - record.newHeight,
    )
    if (pushed > 0) {
      const rows: PushedRow[] = []
      for (let at = 0; at < pushed; at += 1) {
        rows.push({
          document: record.rowSource[at],
          text: undefined,
          shown: record.screen[at] ?? '',
          credited: false,
        })
      }
      this.#pushed.push(...rows)
      // A push sends those rows out in order, so they extend the ordered suffix by that many.
      this.#provenTail += rows.length
      record.pushedRows = rows
    }
    const pulled = record.pulledBack ?? 0
    if (pulled > 0) {
      // A pull that reached past everything this account recorded can have brought
      // unaccounted rows onto the screen; one it could fully account for is ordinary and
      // needs no protection. The count is only a proof while the tail is trusted: once
      // the real end of native history is unknown, a long array says nothing about
      // whether this move was covered, so the risk stands regardless of its length.
      //
      // Two decisions follow, and an untrusted tail separates them. It refuses the pulled
      // instances: those came off the stack this account can no longer prove the order
      // of, so they are not handed over. It says nothing about the rows the window was
      // already showing, which are this account's own painting — a grow does not disturb
      // them, so they survive it and remain evidence for a later protection scroll.
      if (pulled > this.#pushed.length || this.#tailStale) {
        this.#unknownOnScreen = true
        // The evidence is the event's own before-state, not whatever the live fields hold
        // by the time this runs: after a stay in the alternate buffer, or a later move,
        // the live screen is not this move's starting point.
        //
        // Surviving the move and carrying a document identity are two separate things, and
        // a row number is not proof of the second. `#recordSource` returns early for a
        // frame that declares no rows, leaving the previous mapping in place while the
        // painted text has already moved on — so an event can hold the current text beside
        // a stale row number with `sourceKnown` false or `source` null. Trusting the
        // number there would offer a physical instance as a document row on the strength
        // of a mapping that was never re-established, and a later text comparison could
        // only show the text matched, never that this instance had that source.
        //
        // The identity therefore follows the event's own source state; where it is not
        // known, the row is not offered as document evidence at all. This is independent of
        // the tail's trust above: an untrusted tail is about the order of native history,
        // not about which document a shown row came from.
        const sourceNamed = record.sourceKnown && record.sourceUsable && record.source !== null
        if (sourceNamed) {
          for (let at = 0; at < record.newHeight; at += 1) {
            const document = record.rowSource[at]
            const shown = record.screen[at]
            if (document === undefined || shown === undefined) continue
            this.#knownOnScreen.push({ document, text: shown, shown, credited: true })
          }
        }
      }
      if (this.#tailStale) {
        record.after = undefined
        return
      }
      // Only the part beyond the proven suffix is unordered. A pull that fits inside it consumes
      // order; one that reaches past it has left the proven range for an arrangement no
      // collection can supply.
      // A pull takes the newest positions first. However much of the collection is unorderable,
      // the part inside the proven suffix is known: those instances are taken in their real
      // order, the suffix shortens, and their membership follows them onto the screen. Only the
      // remainder reaches past the proof and is unknown. Treating the whole move as unidentifiable
      // because a later part of it is would drop a movement that is entirely provable.
      const knownCount = Math.min(pulled, this.#provenTail)
      const knownTaken = knownCount > 0 && !this.#tailStale
        ? this.#pushed.splice(-knownCount, knownCount)
        : []
      this.#provenTail = Math.max(0, this.#provenTail - knownTaken.length)
      const unknownCount = pulled - knownTaken.length
      if (unknownCount > 0) {
        // The remainder is real only as far as the unknown front proves it: those positions were
        // sent, so the terminal can have handed that many back. Beyond the front there is no such
        // proof and the count would be a request rather than a fact, so only the proven part is
        // remembered for a reverse move, and the front shrinks by it.
        // The count is only as good as the front that proves it: the whole taken part must lie
        // inside positions whose existence was really sent. Where it does, the move is recorded
        // with the instances it also took, so the same event owns both halves.
        if (unknownCount <= this.#unknownFront) {
          // Two moves are two events. Adding to an unfinished one would merge their counts while
          // only the newer move's instances survived, and the older rows it was waiting to return
          // are not proven to be at the top of the screen any more once another pull has run. The
          // new count is therefore only kept where the pending one can still be consumed alone; a
          // move that arrives on top of another's rows leaves both as unknown counts rather than
          // claiming either.
          if (this.#pendingReverse === undefined) {
            this.#pendingReverse = { count: unknownCount, height: record.newHeight }
          }
          this.#unknownFront -= unknownCount
        }
      }
      if (unknownCount > 0) {
        // That much of the move has no instance to name and no order to consume: the layout the
        // pull leaves is unknown, and the risk of clearing what came up stands.
        this.#unknownOnScreen = true
        record.after = undefined
      }
      // The part that was taken keeps going through the ordinary path below: its instances are
      // recorded, handed to the protection plan and applied to the boundary. Only `after` and the
      // risk above reflect that the move also reached into the unknown.
      // `record.pulledBack` keeps the event's original request: it is the allowed limit from
      // `pulledBackFor`, and the set difference is an un-covered remainder, not the number of
      // rows native history actually gave back. Writing it here made the same field mean two
      // things before and after the move, and a later reverse move could take the remainder as
      // fact. The provable count belongs to the pending reverse move, not to this field.
      const taken = knownTaken
      // Keep the instances this pull brought back, even when the layout that follows is
      // unknown. They were in this account's hands a moment ago — with their text and
      // their source — and they are now on the screen. Dropping them here is what left a
      // later protection plan unable to say what it had scrolled out.
      record.pulledRows = taken
      if (this.#unknownOnScreen) this.#knownOnScreen.push(...taken)
      this.#pulledFromHistory(taken)
      // Fewer positions than the move claims means the tail does not reach back that
      // far, so what came onto the screen is not known — say so rather than padding
      // the difference with blanks that look like content.
      if (taken.length < pulled) {
        // The tail does not reach back that far, so the screen this move leaves is not
        // accounted for. The **output** is unknown even though the start was trusted,
        // and that is what the next move inherits.
        record.after = undefined
        return
      }
      // The pulled positions come back onto the screen carrying their own text and
      // mapping: that is what makes the next move in this stay readable instead of a
      // guess. `undefined` entries are chrome and keep their place. The cursor moves
      // **down** with them — it was at the bottom, and rows just arrived above it.
      record.after = {
        screen: [...taken.map(row => row.shown), ...record.screen].slice(0, record.newHeight),
        rowSource: [...taken.map(row => row.document), ...record.rowSource].slice(0, record.newHeight),
        cursorRow: Math.min(record.cursorRow + taken.length, Math.max(0, record.newHeight - 1)),
      }
      return
    }
    // No pull. A push takes rows off the top; a grow stands the extra rows at the
    // bottom, and those really are blank. Either way the result describes the whole
    // window, so the next move is measured against a complete layout — but only if
    // this move started from one that was accounted for.
    record.after = {
      screen: [
        ...record.screen.slice(pushed),
        ...Array.from({ length: Math.max(0, record.newHeight - (record.screen.length - pushed)) }, () => ''),
      ].slice(0, record.newHeight),
      rowSource: [
        ...record.rowSource.slice(pushed),
        ...Array.from({ length: Math.max(0, record.newHeight - (record.rowSource.length - pushed)) }, () => undefined),
      ].slice(0, record.newHeight),
      cursorRow: Math.max(0, Math.min(record.cursorRow - pushed, record.newHeight - 1)),
    }
  }

  /**
   * Rows the terminal pulled back out of history are no longer committed, so the
   * frozen boundary must stop claiming them: they are owed again and the next flush
   * has to send them. Retreating is exact — it moves to the lowest row actually
   * pulled, not by any height difference — and it never advances.
   *
   * Every pulled position counts, not just the ones the terminal was credited for. A
   * row the renderer put into history with its own flush is exactly as gone once a
   * grow takes it back.
   */
  /**
   * Whether a width change could have re-wrapped the rows shown.
   *
   * Calibrated, and **narrow on purpose**: with the short rows of this fixture, 80 -> 100
   * columns leaves history and the screen row for row identical, so the mapping holds
   * and the sources can be kept. A row wider than every column count in force is treated
   * as re-wrapped and the layout as unknown.
   *
   * That test is not a general proof. A row of 80 cells under an 80-column window may
   * already have soft-wrapped into 80 + 40, and both halves are `<= 80` while a 100-column
   * window would re-flow them to 100 + 20. `screen: string[]` carries no `isWrapped`, and
   * scanning the visible screen says nothing about the history tail either — xterm's own
   * `BufferReflow` groups rows by `isWrapped` for exactly this reason. So this rule is
   * sound only for inputs established not to have soft-wrapped; promoting it to a general
   * "width did not matter" claim needs a no-soft-wrap source invariant first.
   */
  #wraps(screen: readonly string[] | undefined, transition = this.#resize): boolean {
    if (transition === undefined || !transition.widthChanged) return false
    if (screen === undefined) return true
    const tooWide = (row: string | undefined): boolean =>
      row !== undefined && visibleWidth(row) > transition.narrowestWidth
    if (screen.some(tooWide)) return true
    // A short visible screen is not enough. Native history is re-flowed on a width change
    // too, so a long row already pushed there can re-wrap while the screen still looks
    // narrow, and this account would go on using the old positions. Every tracked row is
    // checked as well. History the account never watched cannot be examined at all, so
    // that part stays an assumption — the guard is partial, not general.
    return this.#pushed.some(row => tooWide(row.shown))
  }

  /**
   * Plan the protection scroll for this frame and settle the history event it causes.
   *
   * It scrolls the **whole visible window** out: the count of unaccounted rows is not
   * knowable, and scrolling everything preserves the screen's actual content without
   * reading or replaying any of it. The instances this account can identify among what
   * moves go on the ledger — the flush must not send them again — while anything it
   * cannot identify stays unaccounted rather than being pretended into a known tail.
   *
   * Which instances those are comes from the moves that put them on the screen, not from
   * `#screen`: after an overlay stay the renderer's screen memory holds what it last
   * painted, not what the terminal shows.
   */
  /**
   * Settle the copies a protection scroll could not confirm, by identity and before any commit
   * range is chosen. A copy still in the stack whose document reads the same again is
   * confirmed; one whose text has changed is resolved without credit, because the old shown
   * instance stays in history while the new text still owes its own commit; one the frame
   * cannot locate stays held for the next frame that can. Leaving the stack and being retired are
   * two different things — retirement keeps the position and closes confirmation — so a copy is
   * dropped only when it is genuinely no longer tracked, and is skipped while its confirmation
   * is closed or already granted.
   */
  #settleProtection(next: readonly string[], frame: Frame): void {
    if (this.#unconfirmedProtection.length === 0) return
    const kept: PushedRow[] = []
    // While the tail's order is unknown, knowing a row's document does not say the instance is
    // still in native history: the event that made this copy is evidence about what it was, not
    // about where it now sits, and being present in the array only says it is still tracked. A
    // matching string is therefore not a deduction. Confirming from identity alone would conflate
    // "this is the row that was sent" with "this row is still committed", so the copies stay held
    // until a frame can prove the membership again.
    if (this.#tailStale) return
    for (const copy of this.#unconfirmedProtection) {
      // Only an instance still tracked may be edited. Being dropped from the stack is not the
      // same as being retired: a retired copy stays and is filtered by its closed confirmation
      // below, while one that is gone stands for nothing at all.
      // Presence on the stack is not eligibility: retirement keeps the position. A copy whose
      // confirmation has been closed, or one already confirmed, must not be credited again.
      if (!this.#pushed.includes(copy)) continue
      if (copy.confirmationClosed === true || copy.credited) continue
      if (copy.document === undefined) continue
      const at = frameTextIndex(frame, next, copy.document)
      if (at === undefined) {
        kept.push(copy)
        continue
      }
      // A row whose text differs is settled: this comparison is over and grants no credit.
      if ((next[at] ?? '') === copy.shown) {
        copy.text = copy.shown
        copy.credited = true
      }
    }
    this.#unconfirmedProtection = kept
  }

  #planProtection(
    next: readonly string[],
    frame: Frame | undefined,
  ): { lead: string; confirmed: { start: number; end: number }[] } {
    // The trigger is the **outstanding risk**, not the presence of identifiable rows: a
    // screen carrying only unaccounted external content still has to be preserved, and
    // there is nothing of this account's own to point at in that case.
    if (!this.#unknownOnScreen || this.#height <= 0) {
      return { lead: '', confirmed: [] }
    }
    this.#unknownOnScreen = false
    // The scroll really sent `#height` positions into history, so the newest that many become
    // unknown in arrangement: an empty confirmed set is still a tail nobody can order.
    this.#unknownFront = this.#height
    this.#provenTail = 0
    // The scroll pushes `#height` positions into history whether or not any own instance was
    // identifiable, so the whole tail becomes unordered here: an empty confirmed set is still a
    // tail nobody can order. The collection and the physical range are held separately.
    this.#provenTail = 0
    const rows = this.#knownOnScreen
    this.#knownOnScreen = []
    const confirmed: { start: number; end: number }[] = []
    for (const row of rows) {
      if (row.document === undefined) continue
      // The instance is saved either way — it is what the scroll really moved — but it may
      // only be **deducted** from this frame if the document still reads the same there.
      // A row rewritten since the move is new text and still owes its own commit; a row
      // the frame cannot locate is unknown, and unknown is not a deduction either.
      const at = frameTextIndex(frame, next, row.document)
      const matches = at !== undefined && (next[at] ?? '') === row.shown
      const copy: PushedRow = {
        ...row,
        text: matches ? row.shown : undefined,
        credited: matches,
        settledByProtection: true,
        // This scroll is a new physical commit and this copy is a new instance. Whatever
        // happened to the row it was read from — retired, closed, pulled — says nothing about
        // this one, so its own confirmation state starts open and is decided by this result.
        confirmationClosed: false,
      }
      this.#pushed.push(copy)
      if (matches) {
        confirmed.push({ start: row.document, end: row.document + 1 })
      } else if (at === undefined) {
        // The frame could not locate the row at all, so nothing has been decided: keep the same
        // instance for a later frame. A row that **was** located and reads differently is a
        // different case — that comparison is over, and it grants no credit.
        this.#unconfirmedProtection.push(copy)
      }
    }
    // Park on the last row so the scroll really pushes the window out, then walk it out.
    // `csi` is zero-based and adds one, so the last row is `height - 1`, column 0 —
    // sending `height` would rely on the terminal clamping an out-of-range position.
    return { lead: csi(this.#height - 1, 0) + '\n'.repeat(this.#height), confirmed }
  }

  #pulledFromHistory(positions: readonly PushedRow[]): void {
    for (const position of positions) {
      if (position.document === undefined) continue
      this.#physical = Math.min(this.#physical, position.document)
    }
  }

  #settleBoundary(): void {
    // A credited row may only claim the frozen boundary while the tail still describes
    // real history. Advancing the boundary is a claim that the terminal has already
    // committed those rows, and after an unfollowed move that membership is unproven —
    // the rows may be back on the screen, and stepping the boundary over them drops
    // them for good. The same trust range governs this path as governs deduction.
    if (this.#tailStale) return
    for (const row of creditedRows(this.#pushed)) {
      if (row.start > this.#physical) continue
      this.#physical = Math.max(this.#physical, row.end)
      // Retired, not removed. The row is still in native history and still occupies
      // the tail; only its right to be deducted from a flush is gone.
      for (const item of this.#pushed) {
        // The **whole** range this credit stands for, not the row it happens to start at.
        // A merge means the flush settled every physical row between its ends, so leaving the
        // interior positions credited would let a later frame treat an already-settled range as
        // still owed — and the surviving claim then pushes the boundary back over it.
        if (item.document !== undefined
          && item.document >= row.start
          && item.document < row.end) {
          item.credited = false
          // Retiring settles the position for good, so a pending confirmation for it is closed:
          // the instance keeps its place on the stack, but it may not be granted credit again by
          // a later frame that happens to read the same text.
          item.confirmationClosed = true
        }
      }
    }
  }

  #creditAgainst(
    next: readonly string[],
    frame: Frame | undefined,
    record: ParkedMove,
  ): { confirmed: ConfirmedRow[]; remaining: 'unresolved' | undefined; pushed?: (number | undefined)[] } {
    // An accounted grow can prove it pushed nothing without knowing the rows it pulled.
    if (record.pushedRows?.length === 0) return { confirmed: [], remaining: undefined }
    // Everything the comparison needs comes from the record: the cursor as it stood
    // before the terminal's move, and the source as it stood then. Reading the live
    // fields instead is how a parked move became unreadable — an overlay or a browse
    // window has already replaced them, and a live source of `null` is exactly what
    // a browse records.
    //
    // Without an accounted empty push above, check the source before inferring a
    // push count from geometry: an untracked move may have intermediate shrinks.
    // A record whose rows cannot be tied to document rows at all is **unresolved**,
    // not resolved-to-nothing. An empty mapping that reads as "known, nothing to
    // credit" would settle the record and let the flush send rows the terminal has
    // already committed.
    if (!record.sourceKnown || record.source === null || !record.sourceUsable) {
      return { confirmed: [], remaining: 'unresolved' }
    }
    if (record.newHeight >= record.transition.oldHeight) {
      return { confirmed: [], remaining: undefined }
    }
    const pushed = Math.max(
      0, Math.min(record.cursorRow + 1, record.transition.oldHeight) - record.newHeight,
    )
    // Nothing was pushed: a complete answer, not an unknown one. Without this the
    // renderer would sit on an open comparison forever and never clear the park.
    if (pushed <= 0) return { confirmed: [], remaining: undefined }
    // Each pushed row is settled on its own and the answers collected, rather than
    // treated as one run. A row whose text has been replaced is *not* a reason to
    // stop: the rows after it may be unchanged, and the terminal committed those
    // just as much as this one. Reporting a single min/max interval would swallow
    // the mismatched row into the middle of it and claim a commit the terminal
    // never made.
    const confirmed: ConfirmedRow[] = []
    // One entry per pushed **physical** row, in the order they left the screen, with
    // `undefined` for the ones holding no document line. The stack needs that order
    // and those placeholders; a list of document numbers alone cannot say which row
    // a grow takes back.
    const order: (number | undefined)[] = []
    for (let at = 0; at < pushed; at += 1) {
      const shown = record.screen[at]
      if (shown === undefined) break
      const document = record.rowSource[at]
      order.push(document)
      if (document === undefined) continue
      const at2 = frameTextIndex(frame, next, document)
      // A row the frame cannot speak for leaves the rest unverified. It is not
      // evidence that the terminal committed nothing.
      if (at2 === undefined) return { confirmed, remaining: 'unresolved', pushed: order }
      // Unchanged text: the terminal's commit of this row still stands, so it is
      // credited. Replaced text: the old row entering history says nothing about
      // the new one, so this row is simply not credited — and that is a complete
      // answer, not an open question.
      if (shown.replace(/\s+$/u, '') === (next[at2] ?? '').replace(/\s+$/u, '')) {
        // The text it matched is stored with the credit. A confirmation is
        // evidence about *that* document, and the document can still change before
        // the credit is spent: a row confirmed here and rewritten before the flush
        // arrives is new text, and subtracting the old credit for it would drop it
        // from history entirely. Re-checked at use time, the stale credit simply
        // stops applying.
        confirmed.push({ start: document, end: document + 1, text: next[at2] ?? '' })
      }
    }
    return { confirmed, remaining: undefined, pushed: order }
  }

  /**
   * Where a document row's text sits in this frame, or `undefined` when the frame
   * cannot speak for that row. A frame with no declared range says nothing about
   * what it is showing; a frame that declares one speaks only for the rows inside
   * it, since `next` also holds chrome.
   */
  /**
   * The **physical** screen as the terminal now holds it, given only a height
   * change — together with whether that is knowable at all.
   *
   * Every height change here has two possible shapes, and this renderer keeps no
   * model of the terminal's scrollback, so it cannot tell which one happened or
   * what the moved rows contain. A **grow** either appends blanks at the bottom
   * (no history) or pulls history back into the top, shifting every row down. A
   * **shrink** either drops rows from the bottom (cursor high, rows below it
   * blank) or pushes rows off the top into history (cursor at the bottom), which
   * keeps the *last* rows rather than the first. All four checked against
   * @xterm/headless 6.0.0: `a..e` over no history grows to
   * `['a','b','c','d','e','','']`; a 3-row screen `[a,b,c]` over history
   * `[p0,p1]` grows to `['p0','p1','a','b','c']`; a 5-row `[a..e]` with the
   * cursor on row 0 shrinks to `['a','b','c']` with history untouched; the same
   * screen with the cursor at the bottom shrinks to `['c','d','e']` and pushes
   * `[a,b]` into history.
   *
   * Guessing the shape is what broke this repeatedly. Prepending on grow made
   * the baseline *identical* to the bottom-anchored target, so the diff found
   * nothing to do and emitted a bare CUP. Appending on grow read as "the top rows
   * are unchanged" and stranded whatever the terminal had pulled back. And
   * `slice(oldHeight - this.#height)` on shrink drops the **top** rows and keeps
   * `[d,e]` — the opposite end of the screen from the `[a,b,c]` the terminal
   * actually kept when the cursor was high. Each of those left rows unwritten
   * while `#finishPaint` recorded the target as drawn.
   *
   * A plain empty string is not a stand-in for "unknown" either: it matches a
   * target blank exactly, which is how a row that needs repainting gets skipped.
   * So a resize reports its baseline as **not knowable** and repaints the
   * viewport. Only a height change that moves nothing leaves the screen memory
   * usable.
   */
  #resizedScreen(transition: ResizeTransition): { rows: string[]; clear: boolean } {
    // A burst of resizes collapses into one transition that remembers only the
    // first old height and the final one, so equal heights do **not** mean the
    // screen never moved: 5 -> 2 -> 5 with nothing painted in between leaves the
    // terminal on `['b','p1','p2','p3','p4']` with history `['a']`, not on the
    // original `['p1'..'p5']` (verified against @xterm/headless 6.0.0). The
    // transition records that a resize happened, so only a resize that was never
    // more than one height keeps the screen memory usable.
    if (this.#height === transition.oldHeight && transition.intermediateHeights.length === 0) {
      return { rows: this.#screen.slice(0, this.#height), clear: false }
    }
    return { rows: this.#blankScreen(), clear: true }
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
    // Every path that paints the main screen ends here — a following transcript, a
    // browse, a reset — and the alternate branch returns before it. So this is
    // where the live screen memory becomes authoritative again, and where a parked
    // record stops describing what the terminal holds.
    // The snapshot is taken here, not while `#recordSource` runs: only now are the target
    // row, the source and the cursor final. Reading them earlier pairs this frame's screen
    // with the previous frame's cursor, and a later shrink would then count pushes from a
    // row the terminal had already left.
    this.#normalLayout = {
      screen: [...target.rows],
      rowSource: [...this.#screenRowSource],
      cursorRow: this.#cursorRow,
      source: this.#screenSource,
      sourceKnown: this.#screenSourceKnown,
    }
    this.#hasFrame = true
    return body + cursorOut + hide + show
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
