/**
 * Main-screen renderer regression: committed transcript rows must enter native
 * scrollback once within a stable geometry epoch when the terminal is in
 * main-screen mode (no 1000/1006 mouse capture). The renderer appends new lines
 * and lets the terminal scroll; settled rows above the live seam are frozen.
 */
import { describe, expect, it } from 'vitest'
import { MainScreenRenderer, mapBlockSpan } from './main-screen-renderer.ts'
import { initialTranscript, renderView } from '../views/event-views.ts'
import { processGroups } from '../views/transcript-render.ts'
import { stripAnsi } from './width.ts'
import type { Block, TranscriptState } from '../views/transcript-types.ts'
import type { Frame } from './renderer.ts'

/**
 * Minimal VT-style emulator with a fixed-height screen and a scrollback buffer.
 * Interprets only the escape sequences our renderer emits: cursor movement,
 * line clear, screen clear, and carriage return / newline (which scroll when
 * the cursor is on the bottom row).
 */
class Emulator {
  height: number
  /** Recorded, not modelled — see `setWidth`. */
  width = 80
  screen: string[] = []
  scrollback: string[] = []
  row = 0
  col = 0
  captured = ''
  writeCount = 0
  /**
   * The alternate buffer, modelled on xterm.js: 1049 saves the cursor and
   * switches to alt, which it *clears*; leaving it switches back to normal and
   * restores the cursor. The two buffers never copy content to each other, and
   * only normal has scrollback.
   */
  #altScreen: string[] = []
  #altRow = 0
  #saved: { row: number; col: number } | null = null
  #alt = false

  constructor(height: number, initialScrollback: readonly string[] = []) {
    this.height = height
    this.screen = Array.from({ length: height }, () => '')
    this.scrollback = [...initialScrollback]
    this.#altScreen = Array.from({ length: height }, () => '')
  }

  /** True while the alternate buffer is the visible one. */
  get altActive(): boolean { return this.#alt }

  /** The normal buffer's screen, active or not. */
  normalScreen(): string[] { return this.screen.map(row => row ?? '') }

  /** The alternate buffer's screen. */
  altScreen(): string[] { return this.#altScreen.map(row => row ?? '') }

  /** Cursor row on whichever buffer is visible. */
  cursorRow(): number { return this.#activeRow() }

  /** Cursor row on the normal buffer, whether or not it is the visible one. */
  normalCursorRow(): number { return this.row }

  #activeRow(): number { return this.#alt ? this.#altRow : this.row }

  #setRow(row: number): void {
    // Both buffers clamp to the window, as the real terminal does: xterm's cursor
    // position goes through `_restrictCursor`, so a row past the bottom lands on the
    // last row rather than outside the buffer. Clamping only the alternate buffer left
    // the normal cursor able to sit below the screen, where no newline can push a row
    // into history and every later read is measuring a state the terminal never has.
    const last = Math.max(0, this.height - 1)
    if (this.#alt) this.#altRow = Math.min(last, Math.max(0, row))
    else this.row = Math.min(last, Math.max(0, row))
  }

  #get(): string { return (this.#alt ? this.#altScreen[this.#altRow] : this.screen[this.row]) ?? '' }

  #put(text: string): void {
    if (this.#alt) this.#altScreen[this.#activeRow()] = text
    else this.screen[this.#activeRow()] = text
  }

  /**
   * A terminal resize, following xterm.js's `Buffer.resize` and `BufferSet.resize`:
   * **both** buffers change, whichever is visible, and the rows a shorter window
   * gives up depend on the cursor — not on the height difference.
   *
   * Shrinking, once per removed row: if there is a row *below* the cursor it is
   * a blank line and is removed; only when there is no such row does the top of
   * the buffer scroll into history. So a height-10 terminal whose cursor is on
   * row 7 and which shrinks to 8 pushes nothing, and only a cursor low enough
   * pushes rows. Height difference alone is the wrong formula.
   *
   * Growing: history is pulled back while the top of the buffer has it, and only
   * then are blank rows added — so again the cursor decides.
   *
   * Normal has history, alt does not, so alt simply drops or gains rows.
   */
  /**
   * The terminal has already resized. Width is recorded but not modelled: the
   * rows here are short, so a width change moves no line and only the height
   * decides which rows the terminal takes. Where wrapping matters, that is a
   * separate input with its own fixture.
   */
  setWidth(width: number): void {
    this.width = width
  }

  resize(height: number): void {
    const next = Math.max(1, height)
    if (next === this.height) return
    const delta = next - this.height
    this.height = next

    if (delta < 0) {
      let scrolled = 0
      for (let removed = 0; removed < -delta; removed += 1) {
        // A row below the cursor is blank; removing it costs the buffer nothing.
        if (this.row < this.screen.length - 1) {
          this.screen.pop()
        } else {
          this.scrollback.push(this.screen.shift() ?? '')
          this.screen.push('')
          scrolled += 1
        }
        if (this.#alt) {
          if (this.#altRow < this.#altScreen.length - 1) this.#altScreen.pop()
          else {
            this.#altScreen.shift()
            this.#altScreen.push('')
          }
        }
      }
      // The cursor is clamped into the new height, not shifted by the height
      // difference: xterm.js leaves it where it is when rows were merely
      // removed below it, and moves it up only by what actually scrolled.
      this.row = Math.min(Math.max(0, this.row - scrolled), next - 1)
      this.#altRow = Math.min(Math.max(0, this.#altRow - scrolled), next - 1)
    } else {
      // Calibrated against @xterm/headless 6.0.0 (the published build this
      // project already resolves). A taller window pulls a row of history back
      // **only when the cursor is already at the bottom of the screen**, and the
      // cursor then moves up with the rows it reclaimed. With rows below the
      // cursor it simply appends a blank: history is left alone and the cursor
      // does not move. Measuring the condition after adding a row would see the
      // blank just added and reclaim nothing.
      for (let added = 0; added < delta; added += 1) {
        const atBottom = this.row === this.screen.length - 1
        if (this.scrollback.length > 0 && atBottom) {
          this.screen.unshift(this.scrollback.pop() ?? '')
          this.row += 1
        } else {
          this.screen.push('')
        }
        this.#altScreen.unshift('')
      }
      this.row = Math.min(this.row, next - 1)
      this.#altRow = Math.min(this.#altRow, next - 1)
    }
    while (this.screen.length > next) this.screen.pop()
    while (this.#altScreen.length > next) this.#altScreen.pop()
  }

  write(chunk: string): void {
    this.captured += chunk
    this.writeCount += 1
    const tokens = chunk.match(/\x1b\[[?0-9;]*[ -/]*[@-~]|\r\n|\r|\n|[^\r\n\x1b]+/g) ?? []
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]!
      if (token === '\r\n' || token === '\n') {
        const cr = token === '\r\n'
        if (this.#activeRow() === this.height - 1) {
          if (this.#alt) {
            // Alt has no scrollback: its rows leave the screen and are gone.
            this.#altScreen.shift()
            this.#altScreen.push('')
          } else {
            this.scrollback.push(this.screen[0] ?? '')
            for (let r = 0; r < this.height - 1; r += 1) this.screen[r] = this.screen[r + 1] ?? ''
            this.screen[this.height - 1] = ''
          }
        } else {
          this.#setRow(this.#activeRow() + 1)
        }
        if (cr) this.col = 0
      } else if (token === '\r') {
        this.col = 0
      } else if (token.startsWith('\x1b[')) {
        const final = token[token.length - 1]!
        const inner = token.slice(2, -1)
        if (final === 'h' || final === 'l') {
          if (inner === '?1049') {
            if (final === 'h' && !this.#alt) {
              this.#saved = { row: this.row, col: this.col }
              this.#alt = true
              this.#altScreen = Array.from({ length: this.height }, () => '')
              this.#altRow = 0
            } else if (final === 'l' && this.#alt) {
              this.#alt = false
              if (this.#saved !== null) {
                this.row = Math.min(this.height - 1, this.#saved.row)
                this.col = this.#saved.col
                this.#saved = null
              }
            }
          }
          // every other mode: autowrap, cursor visibility, sync output
          continue
        }
        const params = inner.replace(/^\?/u, '').split(';').map(v => Number(v || '1'))
        const n = params[0] ?? 1
        if (final === 'A') this.#setRow(Math.max(0, this.#activeRow() - n))
        else if (final === 'B') this.#setRow(Math.min(this.height - 1, this.#activeRow() + n))
        else if (final === 'C') this.col += n
        else if (final === 'D') this.col = Math.max(0, this.col - n)
        else if (final === 'G') this.col = Math.max(0, n - 1)
        else if (final === 'H' || final === 'f') {
          this.#setRow(Math.max(0, (params[0] ?? 1) - 1))
          this.col = Math.max(0, (params[1] ?? 1) - 1)
        } else if (final === 'K') {
          const current = this.#get()
          // 0: to the cursor, 1: to the end of the line, 2: the whole line.
          this.#put(n === 0 ? current.slice(0, this.col) : n === 1 ? current.slice(this.col) : '')
        } else if (final === 'J') {
          if (n === 0) {
            for (let r = this.#activeRow() + 1; r < this.height; r += 1) {
              if (this.#alt) this.#altScreen[r] = ''
              else this.screen[r] = ''
            }
            this.#put(this.#get().slice(0, this.col))
          } else if (n === 2 || n === 3) {
            for (let r = 0; r < this.height; r += 1) {
              if (this.#alt) this.#altScreen[r] = ''
              else this.screen[r] = ''
            }
            if (n === 3) this.scrollback = []
          }
        }
      } else {
        const current = this.#get()
        const padded = current + ' '.repeat(Math.max(0, this.col - current.length))
        const before = padded.slice(0, this.col)
        const after = padded.slice(this.col + token.length)
        this.#put(before + token + after)
        this.col += token.length
      }
    }
  }

  visible(): string[] {
    return (this.#alt ? this.#altScreen : this.screen).map(row => row ?? '')
  }

  outputAfter(mark: number): string {
    return this.captured.slice(mark)
  }
}

/**
 * A frame showing these lines as the document's own rows from 0. That is what
 * a follow frame is, and the renderer needs it said: a frame that omits its
 * source is a frame whose source is *unknown*, which is not the same as a frame
 * that deliberately drew no body.
 */
function frame(
  lines: readonly string[],
  liveStart?: number,
  extras: {
    cursor?: { row: number; column: number }
    cursorVisible?: boolean
    livePinned?: boolean
    transientSurface?: 'overlay' | 'scroll'
    /** How many leading lines are the document body; the rest is chrome. */
    bodyRows?: number
  } = {},
): Frame {
  const bodyRows = extras.bodyRows ?? lines.length
  return {
    lines,
    liveStart,
    documentRows: { documentStart: 0, documentEnd: bodyRows, frameStart: 0 },
    ...extras,
  }
}

function joined(lines: readonly string[]): string {
  return lines.join('\n')
}

describe('MainScreenRenderer', () => {
  it('browses history without re-emitting rows into native scrollback', () => {
    const emu = new Emulator(6)
    const renderer = new MainScreenRenderer(emu, { width: 40, height: 6, synchronized: false })
    const transcript = Array.from({ length: 40 }, (_, index) => `row-${index}`)

    // Follow the tail so the transcript settles into native scrollback.
    renderer.render(frame(transcript, 34))
    const settled = emu.scrollback.length
    expect(settled).toBeGreaterThan(0)
    expect(emu.scrollback).toEqual(transcript.slice(0, settled))

    // PgUp twice: the viewport becomes a window over history and liveStart
    // drops to zero, which is also what an overlay frame looks like.
    const mark = emu.captured.length
    renderer.render(frame(transcript.slice(20, 26), 0))
    renderer.render(frame(transcript.slice(14, 20), 0))

    // Browsing must not borrow the overlay path or duplicate rows into history.
    const browsing = emu.outputAfter(mark)
    expect(browsing).not.toContain('\x1b[?1049h')
    expect(browsing).not.toContain('\x1b[3J')
    expect(emu.scrollback.length).toBe(settled)
    expect(emu.scrollback).toEqual(transcript.slice(0, settled))
  })

  it('keeps a scroll frame on the main screen even when overlays use the alternate buffer', () => {
    const emu = new Emulator(6)
    const renderer = new MainScreenRenderer(emu, {
      width: 40,
      height: 6,
      synchronized: false,
      alternateScreenOverlays: true,
    })
    const transcript = Array.from({ length: 30 }, (_, index) => `row-${index}`)
    renderer.render(frame(transcript, 24))
    const settled = emu.scrollback.length
    expect(settled).toBeGreaterThan(0)

    const mark = emu.captured.length
    renderer.render(frame(transcript.slice(10, 16), 0, { transientSurface: 'scroll' }))

    // The alternate buffer would hide the very scrollback being browsed.
    const browsing = emu.outputAfter(mark)
    expect(browsing).not.toContain('\x1b[?1049h')
    expect(browsing).not.toContain('\x1b[3J')
    expect(emu.scrollback).toEqual(transcript.slice(0, settled))
    expect(emu.visible()).toEqual(transcript.slice(10, 16))
  })

  it('clears an alternate-screen overlay once per resize, not on every frame', () => {
    const emu = new Emulator(6)
    const renderer = new MainScreenRenderer(emu, {
      width: 40,
      height: 6,
      synchronized: false,
      alternateScreenOverlays: true,
    })
    const overlay = frame(['overlay row'], 0, { transientSurface: 'overlay' })
    renderer.render(overlay)
    expect(emu.captured).toContain('\x1b[?1049h')

    // A resize forces one clear repaint for the new geometry...
    emu.resize(5)
    renderer.resize(40, 5)
    const afterResize = emu.captured.length
    renderer.render(overlay)
    expect(emu.outputAfter(afterResize)).toContain('\x1b[2J')

    // ...and the frames after it must not clear again.
    const settled = emu.captured.length
    renderer.render(overlay)
    renderer.render(overlay)
    expect(emu.outputAfter(settled)).not.toContain('\x1b[2J')
  })

  it('scrolls committed rows into native scrollback when the live region grows', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })

    // Initial frame: four settled transcript rows + three live rows.
    // With a height of 5, the visible screen should show rows 2..6 (c,d, + live).
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['c', 'd', 'e', 'f', 'g'])

    // Append one live row. The terminal scrolls once; c moves to scrollback.
    // Visible screen should now show rows 3..7 (d,e,f,g,h).
    const beforeAppend = emu.captured.length
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 4))
    expect(emu.scrollback).toEqual(['a', 'b', 'c'])
    expect(emu.visible()).toEqual(['d', 'e', 'f', 'g', 'h'])

    // Small appends use CRLF + row-level diff, not a full-screen clear.
    const appendOutput = emu.captured.slice(beforeAppend)
    expect(appendOutput).not.toContain('\x1b[2J')
    expect(appendOutput).not.toContain('\x1b[3J')
  })

  it('does not rewrite committed rows on subsequent renders', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))

    // If the renderer tried to rewrite 'a' or 'b' (already in scrollback),
    // the scrollback would receive duplicate or corrupted rows.
    const before = emu.scrollback.length
    // Re-render with unchanged committed prefix.
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g-changed'], 4))
    expect(emu.scrollback.length).toBe(before)
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['c', 'd', 'e', 'f', 'g-changed'])
  })

  it('only appends a row once when liveStart advances monotonically', () => {
    const emu = new Emulator(4)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 4, synchronized: false })

    // liveStart=2 means rows 0..1 are committed, 2.. are live.
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f'], 2))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['c', 'd', 'e', 'f'])

    // liveStart advances to 3: row 'c' becomes committed.
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 3))
    expect(emu.scrollback).toEqual(['a', 'b', 'c'])
    expect(emu.visible()).toEqual(['d', 'e', 'f', 'g'])

    // liveStart stays at 3 and the tail changes; scrollback must not grow.
    const before = [...emu.scrollback]
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g2'], 3))
    expect(emu.scrollback).toEqual(before)
    expect(emu.visible()).toEqual(['d', 'e', 'f', 'g2'])
  })

  it('does not add scrollback when liveStart=0 and the overlay frame grows', () => {
    const emu = new Emulator(6)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 6, synchronized: false })

    // Follow frame to establish some scrollback.
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 4))
    expect(emu.scrollback).toEqual(['a', 'b'])

    // Switch to an overlay with liveStart=0. It should not commit any history.
    renderer.render(frame(['overlay-1', 'overlay-2', 'overlay-3'], 0))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['overlay-1', 'overlay-2', 'overlay-3', '', '', ''])

    // Grow the overlay; still no scrollback.
    const before = emu.scrollback.length
    renderer.render(frame(['overlay-1', 'overlay-2', 'overlay-3', 'overlay-4'], 0))
    expect(emu.scrollback.length).toBe(before)
    expect(emu.visible()).toEqual(['overlay-1', 'overlay-2', 'overlay-3', 'overlay-4', '', ''])
  })

  it('restores the live window after an overlay without adding history', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })

    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback).toEqual(['a', 'b'])

    renderer.render(frame(['overlay'], 0))
    expect(emu.scrollback).toEqual(['a', 'b'])

    // Return to follow. The live window is re-anchored; no extra rows in scrollback.
    const before = emu.scrollback.length
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback.length).toBe(before)
    expect(emu.visible()).toEqual(['c', 'd', 'e', 'f', 'g'])
  })

  it('does not use ED3 when the frame shrinks to fit the screen', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['c', 'd', 'e', 'f', 'g'])

    // Frame shrinks to fit the screen. ED3 must not be emitted; pre-existing
    // scrollback is a frozen visual record. The visible screen is anchored to
    // the live tail (c,d,e), leaving the top committed rows in scrollback.
    const before = emu.captured.length
    renderer.render(frame(['a', 'b', 'c', 'd', 'e'], 4))
    expect(emu.captured.slice(before)).not.toContain('\x1b[3J')
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['', '', 'c', 'd', 'e'])
  })

  it('resize to a larger height re-anchors without duplicating scrollback', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['c', 'd', 'e', 'f', 'g'])

    // A taller window only pulls scrollback rows back when its cursor is at the
    // bottom; with rows below the cursor it just gains blanks. The renderer
    // parks the cursor on the composer's last row, so put it there.
    emu.resize(7)
    const before = [...emu.scrollback]
    renderer.resize(80, 7)
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback).toEqual(before)
    expect(emu.visible()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  })

  it('resize to a smaller height re-anchors with full finalized history', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['c', 'd', 'e', 'f', 'g'])

    // Terminal resize to a smaller height. The renderer re-anchors the live
    // tail without clearing pre-existing scrollback.
    emu.resize(3)
    renderer.resize(80, 3)
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback).toEqual(['a', 'b', 'c', 'd'])
    expect(emu.visible()).toEqual(['e', 'f', 'g'])
  })

  it('reset re-anchors with full finalized history', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback).toEqual(['a', 'b'])

    renderer.reset()
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 4))
    // Reset re-anchors the live tail without clearing pre-existing scrollback.
    expect(emu.scrollback).toEqual(['a', 'b', 'c'])
    expect(emu.visible()).toEqual(['d', 'e', 'f', 'g', 'h'])
  })

  it('does not corrupt scrollback when off-screen committed rows change', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback).toEqual(['a', 'b'])

    // Scrollback now holds 'a' and 'b'. The view must not rewrite them.
    // If it tries to send 'A' or 'B' again, the scrollback would be [a,b,A,B].
    renderer.render(frame(['A', 'B', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['c', 'd', 'e', 'f', 'g'])
  })

  it('uses a single write per frame', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    const first = emu.writeCount

    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g-changed'], 4))
    // Every render should produce exactly one sink.write.
    expect(emu.writeCount - first).toBe(1)
  })

  it('commits every row exactly once when a single frame grows by more than one screen', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })

    // Initial visible window at the bottom of a long block.
    const initial = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    renderer.render(frame(initial, 9))
    expect(emu.scrollback).toEqual(['a', 'b', 'c', 'd'])
    expect(emu.visible()).toEqual(['e', 'f', 'g', 'h', 'i'])

    // A settled block arrives that is larger than the screen. No row may be
    // lost or duplicated, and the visible window must stay anchored at the tail.
    const next = [...initial, 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u']
    renderer.render(frame(next, next.length))
    expect(emu.scrollback).toEqual(next.slice(0, next.length - 5))
    expect(emu.visible()).toEqual(['q', 'r', 's', 't', 'u'])

    // Subsequent growth still appends one row at a time.
    renderer.render(frame([...next, 'v'], next.length + 1))
    expect(emu.scrollback).toEqual([...next.slice(0, next.length - 5), 'q'])
    expect(emu.visible()).toEqual(['r', 's', 't', 'u', 'v'])
  })

  it('preserves cursor position when a non-caret live row changes', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))

    // The caret stays on row 6 (g), but a higher live row changes.
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g-changed'], 4))
    // Cursor should end on the last visible row (row 4 of the screen), column 0.
    const cups = emu.captured.match(/\x1b\[\d+;\d+H/gu) ?? []
    const lastCup = cups[cups.length - 1]
    expect(lastCup).toBe('\x1b[5;1H')
  })

  it('flushes events that arrived during an overlay without duplication', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback).toEqual(['a', 'b'])

    // Overlay appears.
    renderer.render(frame(['overlay'], 0))
    expect(emu.visible()).toEqual(['overlay', '', '', '', ''])

    // While the overlay is shown, the transcript grows by several screens.
    const grown = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't']
    renderer.render(frame(grown, grown.length))
    expect(emu.scrollback).toEqual(grown.slice(0, grown.length - 5))
    expect(emu.visible()).toEqual(['p', 'q', 'r', 's', 't'])
  })

  it('does not duplicate history after shrink then subsequent growth', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback).toEqual(['a', 'b'])

    // Shrink to fit. The top rows (a,b) stay in scrollback and the visible
    // screen is anchored to the live tail.
    renderer.render(frame(['a', 'b', 'c', 'd', 'e'], 4))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['', '', 'c', 'd', 'e'])

    // Grow again: a,b are already in scrollback, so only the live tail grows.
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f'], 4))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['', 'c', 'd', 'e', 'f'])
  })

  it('never writes pending rows to scrollback during long streaming', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })

    // A pending block 'p1..p5' is live. liveStart=2 means 'a' and 'b' are
    // committed; only the visible live tail is written.
    renderer.render(frame(['a', 'b', 'p1', 'p2', 'p3', 'p4', 'p5'], 2))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])

    // The block grows beyond two screens. No new rows are committed yet, so the
    // visible tail is rewritten in place and scrollback stays unchanged.
    const long: string[] = []
    for (let i = 1; i <= 20; i += 1) long.push(`pending-${i}`)
    renderer.render(frame(['a', 'b', ...long], 2))
    expect(emu.visible()).toEqual(long.slice(-5))
    expect(emu.scrollback).toEqual(['a', 'b'])

    // The pending block settles. The final formatted rows enter the tape once.
    const settled = ['a', 'b', ...long]
    renderer.render(frame(settled, settled.length))
    const visibleStart = settled.length - 5
    expect(emu.scrollback).toEqual(settled.slice(0, visibleStart))
    expect(emu.visible()).toEqual(settled.slice(visibleStart))

    // Subsequent append keeps the exactly-once guarantee.
    const more = [...settled, 'next']
    renderer.render(frame(more, more.length))
    expect(emu.scrollback).toEqual(more.slice(0, more.length - 5))
    expect(emu.visible()).toEqual(more.slice(more.length - 5))
  })

  it('scrolls an append-only live assistant head while following its tail', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })

    renderer.render(frame(['header', 'user', 'live-1', 'live-2', 'live-3', 'live-4', 'live-5'], 2, {
      livePinned: false,
    }))
    expect(emu.scrollback).toEqual(['header', 'user'])

    const live = Array.from({ length: 20 }, (_, index) => `live-${index + 1}`)
    renderer.render(frame(['header', 'user', ...live], 2, { livePinned: false }))
    expect(emu.scrollback).toEqual(['header', 'user', ...live.slice(0, 15)])
    expect(emu.visible()).toEqual(live.slice(-5))
  })

  it('rebuilds on width reflow without ED3 and starts a new visual epoch', () => {
    const emu = new Emulator(5, ['pre-existing'])
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })

    // Initial narrow wrapping: the long line is split into two physical rows.
    const narrow = [
      'header',
      'this is a very long line that',
      'wraps into two physical rows',
      'footer',
      'composer-1',
      'composer-2',
      'composer-3',
    ]
    renderer.render(frame(narrow, 4))
    expect(emu.scrollback).toEqual(['pre-existing', 'header', 'this is a very long line that'])
    expect(emu.visible()).toEqual(narrow.slice(2))

    // Width increases: the same logical content reflows into fewer rows.
    // ED3 is never emitted; the old scrollback stays frozen and the new
    // width epoch starts a new visible tail.
    const before = emu.captured.length
    renderer.resize(200, 5)
    const wide = [
      'header',
      'this is a very long line that wraps into two physical rows',
      'footer',
      'composer-1',
      'composer-2',
      'composer-3',
    ]
    renderer.render(frame(wide, 4))
    expect(emu.captured.slice(before)).not.toContain('\x1b[3J')
    // Old narrow scrollback is preserved; the new tail is the wide visible.
    expect(emu.scrollback.slice(0, 3)).toEqual(['pre-existing', 'header', 'this is a very long line that'])
    expect(emu.visible()).toEqual(wide.slice(1))

    // Width decreases again: the content wraps back.
    renderer.resize(80, 5)
    renderer.render(frame(narrow, 4))
    expect(emu.visible()).toEqual(narrow.slice(2))

    // After the reflow, append a new row and keep exactly-once for the new epoch.
    const appended = [...narrow, 'new']
    renderer.render(frame(appended, 4))
    expect(emu.visible()).toEqual(['footer', 'composer-1', 'composer-2', 'composer-3', 'new'])
  })

  it('rebuilds finalized history on reset without losing it', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 6))
    const beforeReset = [...emu.scrollback]

    renderer.reset()
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 6))
    // The joined tape must contain every finalized row exactly once.
    const joined = [...emu.scrollback, ...emu.visible()]
    expect(joined).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    expect(emu.visible()).toEqual(['d', 'e', 'f', 'g', 'h'])

    // Append another finalized row; it must appear exactly once.
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], 7))
    expect([...emu.scrollback, ...emu.visible()]).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])
    expect(emu.visible()).toEqual(['e', 'f', 'g', 'h', 'i'])
  })

  it('preserves pre-existing terminal scrollback on resize and reset', () => {
    const emu = new Emulator(5, ['shell-a', 'shell-b'])
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback.slice(0, 2)).toEqual(['shell-a', 'shell-b'])
    expect(emu.visible()).toEqual(['c', 'd', 'e', 'f', 'g'])

    // Width resize must not emit ED3 and must preserve pre-existing scrollback.
    let before = emu.captured.length
    renderer.resize(200, 5)
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.captured.slice(before)).not.toContain('\x1b[3J')
    expect(emu.scrollback.slice(0, 2)).toEqual(['shell-a', 'shell-b'])

    // Reset must also preserve pre-existing scrollback.
    before = emu.captured.length
    renderer.reset()
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 4))
    expect(emu.captured.slice(before)).not.toContain('\x1b[3J')
    expect(emu.scrollback.slice(0, 2)).toEqual(['shell-a', 'shell-b'])
  })

  it('rewrites a leaving row before it enters scrollback on small settlement', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    // a,b committed; c..g live with c as the first pending row.
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 2))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['c', 'd', 'e', 'f', 'g'])

    // c settles and its final formatted content is different. It is about to
    // leave the visible window, so it must enter scrollback with its final text.
    renderer.render(frame(['a', 'b', 'C-final', 'd', 'e', 'f', 'g', 'h'], 3))
    expect(emu.scrollback).toEqual(['a', 'b', 'C-final'])
    expect(emu.visible()).toEqual(['d', 'e', 'f', 'g', 'h'])

    // No ED3 or 2J was needed for this small settlement append.
    const before = emu.captured.length
    renderer.render(frame(['a', 'b', 'C-final', 'd', 'e', 'f', 'g', 'h'], 3))
    const output = emu.captured.slice(before)
    expect(output).not.toContain('\x1b[2J')
    expect(output).not.toContain('\x1b[3J')
  })

  it('handles medium shrink and subsequent append without duplication', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['c', 'd', 'e', 'f', 'g'])

    // Terminal shrinks to 3 rows. The leaving rows (c,d) are pushed by the
    // terminal resize and the renderer re-anchors the new tail (e,f,g).
    emu.resize(3)
    renderer.resize(80, 3)
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback).toEqual(['a', 'b', 'c', 'd'])
    expect(emu.visible()).toEqual(['e', 'f', 'g'])

    // Append one live row. No committed rows leave, so scrollback is unchanged.
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 4))
    expect(emu.scrollback).toEqual(['a', 'b', 'c', 'd'])
    expect(emu.visible()).toEqual(['f', 'g', 'h'])
  })

  it('emits CUP when only the cursor moves', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4, { cursor: { row: 6, column: 0 } }))

    const before = emu.captured.length
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4, { cursor: { row: 6, column: 3 } }))
    const output = emu.captured.slice(before)
    expect(output).toContain('\x1b[5;4H') // row 7 in 1-based is 6; col 4 is 3
    expect(output).not.toContain('\x1b[2J')
    expect(output).not.toContain('\x1b[3J')
  })

  it('diffs a single live row without 2J or 3J', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))

    const before = emu.captured.length
    renderer.render(frame(['a', 'b', 'c', 'd', 'e-changed', 'f', 'g'], 4))
    const output = emu.captured.slice(before)
    expect(output).not.toContain('\x1b[2J')
    expect(output).not.toContain('\x1b[3J')
    expect(emu.visible()).toEqual(['c', 'd', 'e-changed', 'f', 'g'])
  })

  it('does not flush the pending gap when leaving an overlay', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    const pending = ['a', 'b', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10']
    renderer.render(frame(pending, 2))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['p6', 'p7', 'p8', 'p9', 'p10'])

    // Overlay appears and grows; the follow frame behind it also grows.
    renderer.render(frame(['overlay-1', 'overlay-2'], 0))
    expect(emu.scrollback).toEqual(['a', 'b'])

    const grown = [...pending, 'p11', 'p12', 'p13', 'p14', 'p15']
    renderer.render(frame(['overlay-1', 'overlay-2', 'overlay-3'], 0))
    expect(emu.scrollback).toEqual(['a', 'b'])

    // Leave overlay. Only the visible live tail is rewritten; the off-screen
    // pending gap is never written to scrollback.
    renderer.render(frame(grown, 2))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['p11', 'p12', 'p13', 'p14', 'p15'])
  })

  it('updates the same-length overlay snapshot after A -> B -> A selection', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))

    // Overlay appears with choice A.
    renderer.render(frame(['choice-A'], 0))
    expect(emu.visible()).toEqual(['choice-A', '', '', '', ''])

    // Selection moves to B (same row count).
    renderer.render(frame(['choice-B'], 0))
    expect(emu.visible()).toEqual(['choice-B', '', '', '', ''])

    // Selection moves back to A; the snapshot must update so B is overwritten.
    renderer.render(frame(['choice-A'], 0))
    expect(emu.visible()).toEqual(['choice-A', '', '', '', ''])
  })

  it('replaces a long streaming row with a short final row before it enters scrollback', () => {
    const emu = new Emulator(2)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 2, synchronized: false })

    // c-longgggg is live on screen.
    renderer.render(frame(['a', 'b', 'c-longgggg', 'd'], 2))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['c-longgggg', 'd'])

    // c settles to 'c-final' and the live tail grows by one.
    renderer.render(frame(['a', 'b', 'c-final', 'd', 'e'], 3))
    // The leaving row must enter scrollback as the short final text, not with
    // the long streaming tail still attached.
    expect(emu.scrollback).toEqual(['a', 'b', 'c-final'])
    expect(emu.visible()).toEqual(['d', 'e'])
  })

  it('starts a new frozen epoch when the logical frame shrinks below the old physical boundary', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    // Establish a long committed history with physical at index 10.
    const long = Array.from({ length: 15 }, (_, i) => `old-${i}`)
    renderer.render(frame(long, 10))
    expect(emu.scrollback).toEqual(long.slice(0, 10))
    expect(emu.visible()).toEqual(long.slice(10, 15))

    // A discontinuous replace/clear: new frame is much shorter and its indices
    // have no relation to the previous epoch. The old scrollback is frozen and
    // the new frame is drawn from the top.
    renderer.render(frame(['x', 'y', 'z'], 3))
    expect(emu.scrollback).toEqual(long.slice(0, 10))
    // The short new epoch is anchored at the bottom (the view's fill blanks are
    // above it, just like a normal follow frame).
    expect(emu.visible()).toEqual(['', '', 'x', 'y', 'z'])

    // Subsequent append within the new epoch grows correctly, without reaching
    // back into the frozen old scrollback.
    renderer.render(frame(['x', 'y', 'z', 'w', 'v', 'u'], 6))
    expect(emu.scrollback.slice(10)).toEqual(['x'])
    expect(emu.visible()).toEqual(['y', 'z', 'w', 'v', 'u'])
  })

  it('flushes a settled committed span and skips the off-screen live gap on a big jump', () => {
    const emu = new Emulator(3)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 3, synchronized: false })

    // a,b committed; p1..p6 live; visible p4,p5,p6.
    renderer.render(frame(['a', 'b', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'], 2))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['p4', 'p5', 'p6'])

    // A big chunk settles: rows 2..7 become committed; p8,p9,p10 are the new live tail.
    const settled = ['a', 'b', 's2', 's3', 's4', 's5', 's6', 's7', 'p8', 'p9', 'p10']
    renderer.render(frame(settled, 8))
    // The settled span (s2..s7) must enter scrollback; the off-screen live gap
    // (p1..p7) is skipped and only the visible live tail (p8,p9,p10) is written.
    expect(emu.scrollback).toEqual(['a', 'b', 's2', 's3', 's4', 's5', 's6', 's7'])
    expect(emu.visible()).toEqual(['p8', 'p9', 'p10'])
  })

  it('re-anchors after resize and keeps the new physical baseline for the next append', () => {
    const emu = new Emulator(3)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 3, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    // First render: a,b,c,d in scrollback, e,f,g visible.
    expect(emu.scrollback).toEqual(['a', 'b', 'c', 'd'])
    expect(emu.visible()).toEqual(['e', 'f', 'g'])

    // Terminal resizes to the same height (re-anchor path).
    renderer.resize(80, 3)
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 4))
    expect(emu.scrollback).toEqual(['a', 'b', 'c', 'd'])
    expect(emu.visible()).toEqual(['e', 'f', 'g'])

    // Append a finalized row. It must flush from the new baseline, not duplicate
    // the old committed rows.
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 5))
    expect(emu.scrollback).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(emu.visible()).toEqual(['f', 'g', 'h'])
  })

  it('preserves frozen scrollback rows when the terminal height grows', () => {
    const emu = new Emulator(3)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 3, synchronized: false })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f'], 6))
    expect(emu.scrollback).toEqual(['a', 'b', 'c'])
    expect(emu.visible()).toEqual(['d', 'e', 'f'])
    const beforeTape = [...emu.scrollback, ...emu.visible()]

    const mark = emu.captured.length
    emu.resize(5)
    renderer.resize(80, 5)
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f'], 6))

    // Every row from the original joined tape must still exist in the same
    // order after the grow; the terminal may have pulled rows back onto screen.
    expect([...emu.scrollback, ...emu.visible()]).toEqual(beforeTape)
    // The resize render must not ED3, which would erase native scrollback for
    // good. ED2 is a different matter: it clears the visible screen only, and a
    // grow leaves the physical screen genuinely unknowable here — the terminal
    // may have appended blanks at the bottom or pulled history back into the
    // top, and this renderer keeps no model of the terminal's scrollback to tell
    // the two apart. Repainting the viewport is the honest response; refusing to
    // clear it means trusting a guess and skipping rows that need redrawing. The
    // assertion that actually matters is the tape above: the rows still exist,
    // in order, after the repaint.
    const output = emu.outputAfter(mark)
    expect(output).not.toContain('\x1b[3J')
  })

  it('does not duplicate history when a long pending screen shrinks and then settles', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })

    // a,b committed; p1..p5 live and fill the whole screen.
    renderer.render(frame(['a', 'b', 'p1', 'p2', 'p3', 'p4', 'p5'], 2))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])

    // Terminal shrinks. The top live rows are pushed into scrollback by the
    // terminal itself; we account for that and must not flush them again.
    emu.resize(2)
    renderer.resize(80, 2)
    renderer.render(frame(['a', 'b', 'p1', 'p2', 'p3', 'p4', 'p5'], 2))
    expect(emu.visible()).toEqual(['p4', 'p5'])

    // The pending tail settles. We do not re-emit the rows the terminal already
    // pushed; the off-screen settled rows become part of the frozen external
    // snapshot.
    const before = emu.scrollback.length
    renderer.render(frame(['a', 'b', 's2', 's3', 's4', 'p4', 'p5'], 5))
    expect(emu.scrollback.length).toBe(before)
    expect(emu.visible()).toEqual(['p4', 'p5'])
  })

  it('flushes a long replacement session from the finalized prefix and tail', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })

    // Establish an old epoch with 15 finalized rows; physical ends up at 10.
    const old = Array.from({ length: 15 }, (_, i) => `old-${i}`)
    renderer.render(frame(old, 10))
    expect(emu.scrollback).toEqual(old.slice(0, 10))
    expect(emu.visible()).toEqual(old.slice(10, 15))

    // A long discontinuous replacement session (> 2 * height) with finalized
    // prefix that extends well above the visible tail. The epoch lays the new
    // frame out in a fresh index space and appends it; the old document stays
    // in the terminal's history above, because erasing it would also take the
    // reader's shell output with it.
    const replacement = Array.from({ length: 20 }, (_, i) => `new-${i}`)
    renderer.startEpoch()
    // A restored durable log can retain an orphaned pending seam near its
    // beginning. Replacement still replays every historical row.
    renderer.render(frame(replacement, 2))
    // The full off-screen prefix must have been written once, after — not over
    // — the old document, and the visible tail (new-15..new-19) must be up.
    expect(emu.scrollback).toEqual([...old.slice(0, 10), ...replacement.slice(0, 15)])
    expect(emu.visible()).toEqual(replacement.slice(15, 20))

    // Append within the new epoch must continue from the new baseline, not
    // replay the new frozen prefix.
    renderer.render(frame([...replacement, 'new-20', 'new-21'], 20))
    expect(emu.scrollback).toEqual([...old.slice(0, 10), ...replacement.slice(0, 17)])
    expect(emu.visible()).toEqual(['new-17', 'new-18', 'new-19', 'new-20', 'new-21'])
  })

  it('keeps the mutable suffix pinned when replacing a live session', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })
    const live = Array.from({ length: 20 }, (_, index) => `live-${index}`)

    renderer.startEpoch({ replay: 'pinned' })
    renderer.render(frame(live, 2))
    expect(emu.scrollback).toEqual(live.slice(0, 2))
    expect(emu.visible()).toEqual(live.slice(-5))

    renderer.render(frame(live, live.length))
    expect(emu.scrollback).toEqual(live.slice(0, 15))
    expect(emu.visible()).toEqual(live.slice(15))
  })

  it('does not emit ED3 when the terminal profile cannot clear scrollback', () => {
    const emu = new Emulator(4, ['shell-history'])
    const renderer = new MainScreenRenderer(emu, {
      width: 80,
      height: 4,
      synchronized: false,
      clearScrollback: false,
    })

    renderer.startEpoch()
    renderer.render(frame(['HEADER', 'message-1', 'message-2', 'message-3', 'composer'], 5))
    expect(emu.captured).not.toContain('\x1b[3J')
    expect(emu.scrollback).toEqual(['shell-history', 'HEADER'])
  })

  it('does not emit ED2/ED3 on every frame after a non-discontinuous shrink', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5, synchronized: false })

    // Long committed frame followed by a shorter one (same session, shrinking).
    renderer.render(frame(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 7))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['c', 'd', 'e', 'f', 'g'])

    const mark = emu.captured.length
    renderer.render(frame(['a', 'b', 'c', 'd', 'e'], 5))
    // First shrink may re-anchor; record after it.
    const afterShrinkMark = emu.captured.length

    // Subsequent same-size frames with only a one-row live edit must not
    // repeatedly clear the screen.
    renderer.render(frame(['a', 'b', 'c', 'd', 'E'], 5))
    const output = emu.outputAfter(afterShrinkMark)
    expect(output).not.toContain('\x1b[2J')
    expect(output).not.toContain('\x1b[3J')
    expect(emu.visible()).toEqual(['', '', 'c', 'd', 'E'])
  })

  it('retains native history across a replacement epoch instead of erasing it', () => {
    const emu = new Emulator(4)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 4, synchronized: false })

    // Fill some history the way a live session would, so the replacement has
    // something destructive to do and declines to.
    renderer.render(frame(['SEAM', 'earlier-1', 'earlier-2', 'earlier-3', 'composer'], 4))
    expect(emu.scrollback).toEqual(['SEAM'])

    renderer.startEpoch()
    renderer.render(frame(['SEAM', 'message-1', 'message-2', 'message-3', 'composer'], 5))
    // The old document is still there to scroll into, and the replacement is
    // labelled rather than silently swapped in.
    expect(emu.captured).not.toContain('\x1b[3J')
    expect(emu.scrollback).toEqual(['SEAM', 'SEAM'])
    expect(emu.visible()).toEqual(['message-1', 'message-2', 'message-3', 'composer'])
  })

  it('never erases native scrollback, on any path', () => {
    const writes: string[] = []
    const renderer = new MainScreenRenderer(
      { write: chunk => { writes.push(chunk) } },
      { width: 40, height: 4, synchronized: false },
    )
    // The escape that purges scrollback is destructive to output this process
    // did not produce, so the renderer has no path that reaches it — and the
    // option that used to ask for one is gone rather than left as a default.
    renderer.startEpoch()
    renderer.render(frame(['a', 'b', 'c', 'd', 'e'], 4))
    renderer.reset()
    renderer.render(frame(['f', 'g', 'h', 'i', 'j'], 5))
    expect(writes.join('')).not.toContain('\x1b[3J')
  })

  it('borrows the alternate screen for transient full-screen surfaces', () => {
    const writes: string[] = []
    const renderer = new MainScreenRenderer(
      { write: chunk => { writes.push(chunk) } },
      {
        width: 80,
        height: 5,
        synchronized: false,
        alternateScreenOverlays: true,
      },
    )

    renderer.render(frame(['history', 'composer'], 2))
    const beforeOverlay = writes.length
    renderer.render(frame(['settings-a']))
    renderer.render(frame(['settings-b']))
    renderer.render(frame(['history', 'composer'], 2))

    const overlayWrites = writes.slice(beforeOverlay).join('')
    expect(overlayWrites.match(/\x1b\[\?1049h/gu)).toHaveLength(1)
    expect(overlayWrites.match(/\x1b\[\?1049l/gu)).toHaveLength(1)
    expect(overlayWrites).not.toContain('\x1b[3J')
  })

  it('replays a large resumed transcript without truncating its middle', () => {
    const writes: string[] = []
    const renderer = new MainScreenRenderer(
      { write: chunk => { writes.push(chunk) } },
      { width: 120, height: 8, synchronized: false },
    )
    const lines = Array.from(
      { length: 12_000 },
      (_, index) => `resume-row-${index.toString().padStart(5, '0')}-${'x'.repeat(48)}`,
    )

    renderer.startEpoch()
    renderer.render(frame(lines, lines.length))

    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain(lines[0])
    expect(writes[0]).toContain(lines[6_000])
    expect(writes[0]).toContain(lines.at(-1))
  })
})

describe('MainScreenRenderer reflow', () => {
  // A run that opened pushed its rows into native history; closing it makes the
  // document above the screen shorter while the frozen boundary still counts
  // the opened rows.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  it('shows the whole tail when the document shrank by less than a screen', () => {
    // Without a reflow the screen kept only the rows past the stale boundary:
    // the composer's last edge and the footer over a blank screen.
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const closed = doc(24)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))

    expect(emu.visible()).toEqual(closed.slice(-10))
  })

  it('does not replay the transcript into history when it shrank by more than a screen', () => {
    // Without a reflow a large shrink read as a replaced document and the whole
    // transcript was printed into history a second time.
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const opened = doc(60)
    renderer.render(frame(opened, opened.length - 2))
    const settled = emu.scrollback.length
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))
    const afterShrink = [...emu.scrollback]

    expect(emu.visible()).toEqual(closed.slice(-10))
    expect(emu.scrollback.length).toBe(settled)
  })

  it('keeps following the tail as the document grows again after a reflow', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const frozen = [...emu.scrollback]
    renderer.reflow()
    const closed = doc(24)
    renderer.render(frame(closed, closed.length - 2))
    renderer.render(frame(closed, closed.length - 2))
    expect(emu.visible()).toEqual(closed.slice(-10))
    renderer.reset()
    renderer.render(frame(closed, closed.length - 2))
    expect(emu.visible()).toEqual(closed.slice(-10))
    renderer.render(frame(['inspection'], 0, { transientSurface: 'scroll' }))
    renderer.render(frame(closed, closed.length - 2))
    expect(emu.visible()).toEqual(closed.slice(-10))
    expect(emu.scrollback).toEqual(frozen)
    const grown = doc(40)
    renderer.render(frame(grown, grown.length - 2))

    expect(emu.visible()).toEqual(grown.slice(-10))
    expect(emu.scrollback).toEqual([...frozen, ...grown.slice(frozen.length, grown.length - 10)])
  })

  it('maps a frozen answer suffix when the run shrinks and the footer changes', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5 })
    const answer = Array.from({ length: 10 }, (_, i) => `answer-${i}`)
    const opened = ['head', ...Array.from({ length: 30 }, (_, i) => `run-${i}`), ...answer, 'footer-old']
    renderer.render(frame(opened, opened.length - 1))
    const frozen = [...emu.scrollback]
    const closed = ['head', 'run folded', ...answer, 'footer-new']
    renderer.reflow(1)
    renderer.render(frame(closed, closed.length - 1))
    expect(emu.scrollback).toEqual(frozen)
    renderer.render(frame(closed, closed.length - 1))
    expect(emu.visible()).toEqual(closed.slice(-5))
    const grown = [...closed.slice(0, -1), 'new-0', 'new-1', 'new-2', 'footer-new']
    renderer.render(frame(grown, grown.length - 1))
    expect(emu.scrollback).toEqual([...frozen, 'answer-6', 'answer-7', 'answer-8'])
    expect(emu.visible()).toEqual(grown.slice(-5))
  })

  it('maps members sharing a frozen run header without replaying the answer', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5 })
    const answer = ['answer-0', 'answer-1', 'answer-2']
    const closed = ['head', 'run closed', ...answer, 'composer', 'footer']
    const projection = (blockStarts: number[]) => ({
      start: 0, maxStart: 0, budget: 5, hiddenAbove: 0, hiddenBelow: 0,
      bodyRow: 0, blockStarts,
    })
    renderer.render({ ...frame(closed, closed.length - 2), transcript: projection([0, 1, 1, 1, 2]) })
    expect(emu.scrollback).toEqual(['head', 'run closed'])
    const opened = ['head', 'run open', ...Array.from({ length: 10 }, (_, i) => `member-${i}`), ...answer, 'composer', 'footer']
    renderer.reflow(1)
    renderer.render({ ...frame(opened, opened.length - 2), transcript: projection([0, 2, 5, 11, 12]) })
    expect(emu.scrollback).toEqual(['head', 'run closed'])
    const grown = [...opened.slice(0, -2), 'new-0', 'new-1', 'new-2', 'composer', 'footer']
    renderer.render({ ...frame(grown, grown.length - 2), transcript: projection([0, 2, 5, 11, 12, 15]) })
    expect(emu.scrollback).toEqual(['head', 'run closed', ...answer])
    expect(emu.visible()).toEqual(grown.slice(-5))
  })

  it('applies a reflow that lands while the reader is browsing history', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    renderer.render(frame(opened.slice(5, 15), 0, { transientSurface: 'scroll' }))
    renderer.reflow()
    renderer.render(frame(opened.slice(5, 15), 0, { transientSurface: 'scroll' }))
    const closed = doc(24)
    renderer.render(frame(closed, closed.length - 2))

    expect(emu.visible()).toEqual(closed.slice(-10))
  })
})

describe('MainScreenRenderer reflow growth', () => {
  const closed = [...Array.from({ length: 12 }, (_, i) => `head-${i}`), 'run header', 'answer', 'composer', 'footer']
  const opened = [...closed.slice(0, 13), ...Array.from({ length: 30 }, (_, i) => `run-row-${i}`), ...closed.slice(13)]

  it('does not push rows a second time when a run above the boundary opens', () => {
    // Growth above the boundary shifts rows the terminal already holds; the
    // ordinary flush would append them again, which is how an answer came to
    // appear twice in history.
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const early = ['head-0', 'run header', ...Array.from({ length: 12 }, (_, i) => `answer-${i}`), 'composer', 'footer']
    const earlyOpened = [...early.slice(0, 2), ...Array.from({ length: 30 }, (_, i) => `run-row-${i}`), ...early.slice(2)]
    renderer.render(frame(early, early.length - 2))
    const before = [...emu.scrollback]
    expect(before).toContain('run header')
    renderer.reflow(1)
    renderer.render(frame(earlyOpened, earlyOpened.length - 2))

    expect(emu.visible()).toEqual(earlyOpened.slice(-10))
    expect(emu.scrollback).toEqual(before)
  })

  it('keeps the tail after a run above the boundary opens and the document grows on', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    renderer.render(frame(closed, closed.length - 2))
    renderer.reflow(1)
    renderer.render(frame(opened, opened.length - 2))
    const settled = emu.scrollback.length
    const grown = [...opened.slice(0, -2), 'more-1', 'more-2', 'more-3', 'composer', 'footer']
    renderer.render(frame(grown, grown.length - 2))

    expect(emu.visible()).toEqual(grown.slice(-10))
    // The rows after the reflow commit in order, with nothing replayed.
    expect(emu.scrollback.slice(settled)).toEqual(grown.slice(grown.length - 10 - (emu.scrollback.length - settled), grown.length - 10))
  })

  it('commits a reshape below the boundary as ordinary growth', () => {
    // A live run is never frozen, so opening it reshapes only mutable rows and
    // the new rows enter history in the shape they now have.
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    renderer.render(frame(closed, 12))
    const before = emu.scrollback.length
    renderer.reflow(12)
    // reflowFrom 12 is inside the frozen span, so the mapper runs.
    renderer.render(frame(opened, opened.length - 2))

    expect(emu.visible()).toEqual(opened.slice(-10))
    expect(emu.scrollback.length).toBeGreaterThan(before)
    expect(emu.scrollback).toEqual(opened.slice(0, emu.scrollback.length))
  })
})

describe('MainScreenRenderer reflow across a resize', () => {
  // Shrinking a run maps the frozen boundary into the shorter document's row
  // space, which lands above the viewport start. A resize then adopted the
  // viewport start as the boundary, forgetting rows the terminal already held,
  // and the next growth committed them a second time.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  it('keeps the frozen rows out of history when a resize follows a shrink', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const settled = [...emu.scrollback]

    // Shrink, so the boundary is mapped rather than replaced.
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))
    const afterShrink = [...emu.scrollback]

    // A resize that changes only the width: the terminal moves no rows, so the
    // boundary must not move either.
    renderer.resize(100, 10)
    renderer.render(frame(closed, closed.length - 2))

    // Growth after that. Rows the terminal already holds must not return.
    const grown = [...closed.slice(0, -2), 'new-0', 'new-1', 'new-2', 'composer', 'footer']
    renderer.render(frame(grown, grown.length - 2))

    expect(emu.scrollback.slice(0, afterShrink.length)).toEqual(afterShrink)
    // The old head rows are in there once, not twice.
    expect(emu.scrollback.filter(row => row === 'head-8')).toHaveLength(1)
    expect(emu.scrollback.filter(row => row === 'head-9')).toHaveLength(1)
    expect(emu.scrollback.filter(row => settled.includes(row))).toEqual(settled)
    expect(emu.visible()).toEqual(grown.slice(-10))
  })
})

describe('MainScreenRenderer a height the terminal actually moved rows for', () => {
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  it('does not resubmit old rows after the terminal pulled them back down', () => {
    // Renderer and terminal change height together, as a real resize does.
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))
    const afterShrink = [...emu.scrollback]

    // Taller: the terminal pulls one row back down out of scrollback.
    emu.resize(11)
    renderer.resize(80, 11)
    renderer.render(frame(closed, closed.length - 2))
    const grown = [...closed.slice(0, -2), 'new-0', 'new-1', 'new-2', 'composer', 'footer']
    renderer.render(frame(grown, grown.length - 2))

    // The terminal pulled one row back down, so history legitimately ends one
    // row shorter than it was. What must not happen is the rest of the frozen
    // head following it: no row may appear twice.
    for (const row of ['head-0', 'head-7', 'head-8', 'head-9']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBeLessThanOrEqual(1)
    }
    expect(emu.scrollback.slice(0, afterShrink.length - 1)).toEqual(afterShrink.slice(0, -1))
    expect(emu.visible()).toEqual(grown.slice(-11))
  })

  it('does not resubmit old rows after a net-zero height burst', () => {
    // The terminal shrinks and grows back with no paint in between: it pushed
    // rows up and pulled them down, and the net height is what it started at.
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))
    const afterShrink = [...emu.scrollback]

    emu.resize(8)
    renderer.resize(80, 8)
    emu.resize(10)
    renderer.resize(80, 10)
    renderer.render(frame(closed, closed.length - 2))
    const grown = [...closed.slice(0, -2), 'new-0', 'new-1', 'new-2', 'composer', 'footer']
    renderer.render(frame(grown, grown.length - 2))

    for (const row of ['head-8', 'head-9', 'head-10']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBeLessThanOrEqual(1)
    }
    expect(emu.scrollback.slice(0, afterShrink.length)).toEqual(afterShrink)
    expect(emu.visible()).toEqual(grown.slice(-10))
  })
})

describe('MainScreenRenderer a resize that lands while browsing history', () => {
  // The earlier test left a reflow pending when the reader returned, so the
  // reflow branch handled it and the resize branch never ran. This one settles
  // the shrink first and only then browses, which is the order a reader
  // produces: open, close, scroll back, resize, come back, keep working.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  it('keeps the mapped boundary through a width resize while browsing', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    // Close the run and let the shrink settle while following the tail.
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))
    const afterShrink = [...emu.scrollback]

    // Now browse history, resize the width, and return to the live tail with
    // no reflow pending. The returning frame is the one that used to adopt the
    // viewport start and forget rows the terminal already held.
    renderer.render(frame(closed.slice(5, 15), 0, { transientSurface: 'scroll' }))
    renderer.resize(100, 10)
    renderer.render(frame(closed.slice(5, 15), 0, { transientSurface: 'scroll' }))
    renderer.render(frame(closed, closed.length - 2))
    const afterReturn = [...emu.scrollback]
    expect(afterReturn.slice(0, afterShrink.length)).toEqual(afterShrink)

    const grown = [...closed.slice(0, -2), 'new-0', 'new-1', 'new-2', 'composer', 'footer']
    renderer.render(frame(grown, grown.length - 2))

    // The rows the terminal pushed up long ago are not submitted again.
    for (const row of ['head-8', 'head-9', 'head-10']) {
      expect(emu.scrollback.filter(entry => entry === row)).toHaveLength(1)
    }
    expect(emu.visible()).toEqual(grown.slice(-10))
  })
})

describe('MainScreenRenderer a height burst that ends where it started', () => {
  // A burst that shrinks and grows back has net zero, and an ideal terminal
  // pushed rows up and pulled them down again. Whether the height ended up
  // different says nothing about whether rows moved; only a resize that never
  // changed the height leaves the boundary where a reflow put it.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  it('treats a net-zero height burst as having moved rows', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))
    const afterShrink = [...emu.scrollback]

    // Shrink and grow back before a single paint happens.
    renderer.resize(80, 8)
    renderer.resize(80, 10)
    renderer.render(frame(closed, closed.length - 2))

    const grown = [...closed.slice(0, -2), 'new-0', 'new-1', 'new-2', 'composer', 'footer']
    renderer.render(frame(grown, grown.length - 2))

    // The burst re-derived the boundary from the viewport, which is what a
    // terminal that really moved rows requires; the prefix never changes.
    expect(emu.scrollback.slice(0, afterShrink.length)).toEqual(afterShrink)
    expect(emu.visible()).toEqual(grown.slice(-10))
  })
})

describe('MainScreenRenderer reflow across a collapsed run with a failure', () => {
  // A collapsed run paints its header plus the rows that failed. Members it did
  // not paint resolve to the header, so a successful call can have a *lower*
  // row than the failure beside it and the offsets are not monotonic. The
  // boundary mapper infers a block's span from its neighbours, so this is the
  // shape it has to survive.
  //
  // The offsets come from the real renderer rather than being written by hand:
  // a hand-written table is exactly what hid this case before, since the
  // numbers looked plausible and were monotonic.
  const transcriptFor = (blocks: Block[]): Frame['transcript'] => {
    const state = { ...initialTranscript(), blocks, turn: 1, status: 'idle' } as TranscriptState
    const rendered = renderView(state, {
      width: 74, height: 40, model: 'm', input: '', inputCursor: 0, colors: false,
    })
    return rendered.transcript!
  }
  const framesFor = (
    blocks: Block[],
    opened: readonly string[] = [],
  ): { lines: string[]; transcript: Frame['transcript'] } => {
    const state = { ...initialTranscript(), blocks, turn: 1, status: 'idle' } as TranscriptState
    const rendered = renderView(state, {
      width: 74, height: 40, model: 'm', input: '', inputCursor: 0, colors: false,
      ...(opened.length === 0 ? {} : { openedGroups: new Set(opened) }),
    })
    return { lines: rendered.lines.map(stripAnsi), transcript: rendered.transcript! }
  }
  const tool = (id: string, status: 'ok' | 'error'): Block => ({
    kind: 'tool', callId: id, name: 'bash', args: '{"command":"run"}', status, output: 'ok', turn: 1,
  })
  // ok, error, ok: the middle failure is the only row a collapsed run shows, so
  // the last call's offset sits *below* the successful one before it.
  const collapsed = (): Block[] => [
    { kind: 'user', text: 'go' },
    tool('a', 'ok'), tool('b', 'error'), tool('c', 'ok'),
    { kind: 'assistant', turn: 1, step: 2, text: 'the answer', reasoning: '' },
  ]
  // The same blocks; only the reader's decision differs. Reusing one block list
  // keeps the identities the mapper relies on, and is what makes this a
  // reshape rather than a replacement.
  const runKey = (): string => processGroups(collapsed().map(block => ({ ...block })))[0]!.key

  it('really produces a non-monotonic offset list for a collapsed run', () => {
    // Without this, the two cases below would be testing nothing: a monotonic
    // projection is the easy case the mapper was written for.
    const starts = transcriptFor(collapsed()).blockStarts
    const monotonic = starts.every((row, i) => i === 0 || row >= starts[i - 1]!)
    expect(monotonic).toBe(false)
  })

  // This one covers the scrollback guarantee on a genuinely non-monotonic
  // projection. It does not pin *which* span the mapper picks: the reflow
  // branch takes `Math.max(candidatePhysical, mapped)`, and here the viewport
  // start is already past the mapped value, so a wrong choice lands at or below
  // it and is masked. The selection rule is pinned by the "which span the mapper
  // picks" suite below, which opens the gap a taller window creates.
  it('keeps the frozen rows when that run reopens', () => {
    const closed = framesFor(collapsed())
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 5 })
    renderer.render({ ...frame(closed.lines, closed.lines.length - 2), transcript: closed.transcript })
    const frozen = [...emu.scrollback]

    const open = framesFor(collapsed(), [runKey()])
    // The run really opened: the rows differ, and the answer moved down. A
    // fixture that renders the same shape twice never reaches the mapper at all.
    expect(open.lines).not.toEqual(closed.lines)
    const answerAt = (t: Frame['transcript']): number =>
      (t.bodyRow ?? 0) + t.blockStarts[collapsed().findIndex(b => b.kind === 'assistant')]!
    expect(answerAt(open.transcript)).toBeGreaterThan(answerAt(closed.transcript))
    renderer.reflow(1)
    renderer.render({ ...frame(open.lines, open.lines.length - 2), transcript: open.transcript })
    expect(emu.scrollback.slice(0, frozen.length)).toEqual(frozen)

    const grown = [...open.lines, 'extra-0', 'extra-1', 'extra-2']
    renderer.render(frame(grown, grown.length - 2))
    const resubmitted = emu.scrollback.slice(frozen.length).filter(row => frozen.includes(row))
    expect(resubmitted).toEqual([])
  })
})

describe('MainScreenRenderer an overlay that changes no geometry', () => {
  // An overlay covers the transcript and changes neither the document nor the
  // terminal's rows, so coming back from one must leave the frozen boundary
  // exactly as it was. Only a browse and a resize reach the transient return
  // path, and both of those are covered above.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  it.each([true, false])('keeps the frozen rows through an overlay (alternate=%s)', (alternate) => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { height: 10, alternateScreenOverlays: alternate },
    )
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))
    const afterShrink = [...emu.scrollback]

    // An overlay covers the transcript without changing the document.
    renderer.render(frame(['overlay-title', 'overlay-body', 'overlay-more', 'overlay-end', ''], 0, { transientSurface: 'overlay' }))
    renderer.render(frame(closed, closed.length - 2))
    const afterOverlay = [...emu.scrollback]
    expect(afterOverlay.slice(0, afterShrink.length)).toEqual(afterShrink)

    const grown = [...closed.slice(0, -2), 'new-0', 'new-1', 'new-2', 'composer', 'footer']
    renderer.render(frame(grown, grown.length - 2))
    for (const row of ['head-8', 'head-9', 'head-10']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBeLessThanOrEqual(1)
    }
    // The tail is what a reader sees. With an alternate buffer the emulator
    // still shows the overlay's own screen, which the next frame replaces; the
    // contract under test here is history, not the emulator's alt-screen model.
    if (!alternate) expect(emu.visible()).toEqual(grown.slice(-10))
  })
})

describe('MainScreenRenderer a resize that arrives while an overlay is open', () => {
  // The overlay's own paint cleared the pending resize, so the main screen
  // never saw the terminal's new geometry and the returning frame re-derived
  // the frozen boundary from a viewport the terminal had already moved against.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  /**
   * A resize that happens while an overlay is up also moves the *main* screen: a
   * terminal resizes both buffers, and the hidden one is not exempt. So the rows
   * it pushed are already in history by the time the renderer comes back, and the
   * returning frame must not push them again.
   *
   * The assertion is anchored on the terminal's own state rather than on a fixed
   * number. The reflow before this leaves `head-8` in history and the main screen
   * starting on another `head-8`, so the 10 -> 9 resize makes the terminal hold it
   * twice — a snapshot of the screen as it was pushed, not a resubmit. A flat
   * `<= 1` would have ruled out a row the terminal legitimately committed again
   * and left this red even with the return logic correct; a bare `<= 2` would
   * hide a real resubmit. So the bound is the count read off the terminal before
   * the return paint.
   */
  it('honours the resize on the way back to the transcript', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))
    const beforeAlt = [...emu.scrollback]

    // Open an overlay, then the terminal is resized while it is up.
    renderer.render(frame(['overlay-title', 'overlay-body', 'overlay-more', 'overlay-end', ''], 0, { transientSurface: 'overlay' }))
    emu.resize(9)
    renderer.resize(80, 9)
    renderer.render(frame(['overlay-title', 'overlay-body', 'overlay-more', 'overlay-end', ''], 0, { transientSurface: 'overlay' }))
    // Read the terminal's own state **before** the frame that returns to the
    // transcript can write anything, and record what the natural commit
    // already put in history. The reflow left `head-8` in native history, and the
    // 10 -> 9 resize then pushes the screen's own top row — also `head-8` — so by
    // now the terminal holds it twice. That second copy is a snapshot of what the
    // screen looked like when it was pushed; the renderer did not send it. Only a
    // count taken *after* the return frame can tell the two apart, so both facts
    // are pinned here first.
    // `beforeAlt` is the committed state the overlay was opened over; the counts
    // below are what the terminal's own resize added on top of it.
    const beforeReturn = [...emu.scrollback]
    const naturalCopies = new Map(beforeAlt.map(row => [row, beforeReturn.filter(r => r === row).length]))
    expect(beforeAlt.filter(entry => entry === 'head-8').length).toBe(1)
    expect(beforeReturn.filter(entry => entry === 'head-8').length).toBe(2)
    expect(beforeReturn.filter(entry => entry === 'head-9').length).toBe(1)
    expect(beforeReturn.filter(entry => entry === 'head-10').length).toBe(1)

    renderer.render(frame(closed, closed.length - 2))

    // After the return, nothing may exceed what the terminal's own move produced.
    // Asserting a flat `<= 1` was wrong: it ruled out a row the terminal had
    // legitimately committed a second time, so the test would have stayed red even
    // with the return logic fixed. Equally, a bare `<= 2` would hide a real
    // resubmit, so the bound is read off the recorded natural count.
    for (const row of ['head-8', 'head-9', 'head-10']) {
      expect(emu.scrollback.filter(entry => entry === row).length)
        .toBeLessThanOrEqual(naturalCopies.get(row) ?? 0)
    }
    // Everything the terminal had already committed is still there, in order.
    expect(emu.scrollback.slice(0, beforeReturn.length)).toEqual(beforeReturn)
  })
})

describe('MainScreenRenderer growth that crosses a boundary a taller window lowered', () => {
  // A taller window pulls rows back down off the frozen boundary, so the
  // boundary steps up. The rows it pulled are the terminal's own snapshot of
  // what was on screen, which is not the same as the current document's rows —
  // so if growth then crosses the lowered boundary, the rows between the two
  // must not be submitted a second time.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  it('does not resubmit the rows between the old and the new boundary', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))
    const afterShrink = [...emu.scrollback]

    // Four rows taller: the terminal pulls four rows of the old run back down.
    emu.resize(14)
    renderer.resize(80, 14)
    renderer.render(frame(closed, closed.length - 2))
    const beforeGrowth = [...emu.scrollback]

    // Grow past the boundary the pull-down left behind.
    const grown = [
      ...closed.slice(0, -2),
      ...Array.from({ length: 30 }, (_, i) => `new-${i}`),
      'composer', 'footer',
    ]
    renderer.render(frame(grown, grown.length - 2))

    // Nothing the terminal already holds may be submitted again, whatever its
    // name and wherever the boundary ended up.
    // The rows the terminal pulled back down are still in history, so the
    // comparison starts where history actually is now — not where it was before
    // the resize, which skips exactly the rows the resize did not remove.
    const stillFrozen = new Set(beforeGrowth)
    const resubmitted = emu.scrollback.slice(beforeGrowth.length).filter(row => stillFrozen.has(row))
    expect(resubmitted).toEqual([])
    // The four rows the pull-down brought back must appear once, not twice.
    for (const row of ['head-11', 'run header', 'run-row-0', 'run-row-1']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBeLessThanOrEqual(1)
    }
    expect(emu.scrollback.slice(0, beforeGrowth.length)).toEqual(beforeGrowth)
    expect(emu.visible()).toEqual(grown.slice(-14))
  })
})

describe('MainScreenRenderer a height change while the reader is browsing', () => {
  // The browse-return path re-derived the boundary from the viewport start on a
  // height change, discarding a mapping a reflow had already placed. A taller
  // window pulls rows back down from history; those rows were never frozen, so
  // the boundary stays and the frozen head is not handed to the next flush.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  it('keeps the boundary through a taller window and the return', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))
    const afterShrink = [...emu.scrollback]

    // Browse history, then the terminal grows taller underneath the reader.
    renderer.render(frame(closed.slice(5, 15), 0, { transientSurface: 'scroll' }))
    emu.resize(14)
    renderer.resize(80, 14)
    renderer.render(frame(closed.slice(5, 15), 0, { transientSurface: 'scroll' }))
    renderer.render(frame(closed, closed.length - 2))
    const beforeGrowth = [...emu.scrollback]

    // Grow across whatever boundary that left behind.
    const grown = [
      ...closed.slice(0, -2),
      ...Array.from({ length: 30 }, (_, i) => `new-${i}`),
      'composer', 'footer',
    ]
    renderer.render(frame(grown, grown.length - 2))

    const stillFrozen = new Set(beforeGrowth)
    expect(emu.scrollback.slice(beforeGrowth.length).filter(row => stillFrozen.has(row))).toEqual([])
    for (const row of ['head-11', 'run header', 'run-row-0', 'run-row-1']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBeLessThanOrEqual(1)
    }
  })
})

describe('MainScreenRenderer a resize and a reflow in the same frame', () => {
  // A resize and a reshape can land together: the host recomputes a reflow
  // after it learns the terminal's new width, and the interface does not promise
  // they arrive on separate frames. The resize branch runs first, so it has to
  // perform the mapping itself — the reflow it would have deferred has already
  // had its recorded rows overwritten by the time the next frame arrives.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  it('still commits rows that were never shown', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))

    // Both a reshape and a resize are pending when the shorter document lands.
    renderer.reflow()
    renderer.resize(100, 10)
    const closed = doc(2)
    renderer.render(frame(closed, closed.length - 2))

    // Grow well past whatever boundary that left.
    const grown = [
      ...closed.slice(0, -2),
      ...Array.from({ length: 30 }, (_, i) => `new-${i}`),
      'composer', 'footer',
    ]
    renderer.render(frame(grown, grown.length - 2))

    // A missed *new* tail is not a duplicate, so only counting old rows would
    // miss it: these two rows are in the document, and they have to be in
    // history exactly once.
    for (const row of ['new-0', 'new-1']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    expect(emu.visible()).toEqual(grown.slice(-10))
  })
})

describe('MainScreenRenderer which span the mapper picks', () => {
  // The mapper picks the last block starting before the boundary, and the
  // reflow branch keeps that value only when it exceeds the viewport start.
  // These cases guard the **committed result**: the boundary resumes where history
  // actually stands, neither replaying frozen rows nor skipping the middle of what the
  // reader has seen. They no longer discriminate among block-selection rules — a
  // taller window pulls rows back and now also retreats the frozen boundary, so the
  // mapped boundary and the viewport start land together and the choice is masked. The
  // selection rule itself is pinned by the pure `mapBlockSpan` cases below.
  const longAnswer = (): string =>
    Array.from({ length: 20 }, (_, i) => `answer line ${i}`).join('\n\n')
  // Several calls, so opening the run adds rows and the answer moves down by
  // more than the four-row gap the taller window opened.
  const blocks = (): Block[] => [
    { kind: 'user', text: 'go' },
    { kind: 'tool', callId: 'ok-1', name: 'read', args: '{"path":"a"}', status: 'ok', output: 'x', turn: 1 },
    { kind: 'tool', callId: 'bad', name: 'bash', args: '{"command":"boom"}', status: 'error', output: 'boom', turn: 1 },
    { kind: 'tool', callId: 'ok-2', name: 'grep', args: '{"pattern":"x"}', status: 'ok', output: 'x', turn: 1 },
    { kind: 'tool', callId: 'ok-3', name: 'read', args: '{"path":"c"}', status: 'ok', output: 'x', turn: 1 },
    { kind: 'tool', callId: 'ok-4', name: 'read', args: '{"path":"d"}', status: 'ok', output: 'x', turn: 1 },
    { kind: 'assistant', turn: 1, step: 2, text: longAnswer(), reasoning: '' },
    { kind: 'workspace', turn: 1 },
  ]
  const frameFor = (opened: readonly string[]): { lines: string[]; transcript: Frame['transcript'] } => {
    const state = { ...initialTranscript(), blocks: blocks(), turn: 1, status: 'idle' } as TranscriptState
    const rendered = renderView(state, {
      width: 74, height: 40, model: 'm', input: '', inputCursor: 0, colors: false,
      ...(opened.length === 0 ? {} : { openedGroups: new Set(opened) }),
    })
    return { lines: rendered.lines.map(stripAnsi), transcript: rendered.transcript! }
  }
  const answerIndex = (): number => blocks().findIndex(block => block.kind === 'assistant')
  const answerAt = (t: Frame['transcript']): number =>
    (t.bodyRow ?? 0) + t.blockStarts[answerIndex()]!

  it('keeps committing from after the frozen part of the answer', () => {
    const closed = frameFor([])
    const key = processGroups(blocks().map(block => ({ ...block })))[0]!.key
    const height = closed.lines.length - (answerAt(closed.transcript) + 6)
    const emu = new Emulator(height)
    // Both sides start at the same width, so the later `resize(80, …)` is a height
    // change alone and does not mix in the width path.
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height })

    // Freeze the first six displayed rows of the answer.
    renderer.render({ ...frame(closed.lines, closed.lines.length - 2), transcript: closed.transcript })
    expect(closed.lines[answerAt(closed.transcript)]).toContain('answer line 0')
    const frozen = [...emu.scrollback]

    // Taller: the viewport start moves down and the terminal pulls rows back out of
    // history onto the screen. No claim is made here about which block the mapper
    // selects — see the header.
    //
    // The pull happens in the terminal's own resize, so the snapshot has to be taken
    // **before** it — taking it after already shows the rows back on the screen.
    const beforePull = [...emu.scrollback]
    emu.resize(height + 4)
    renderer.resize(80, height + 4)
    const taller = closed.lines
    const answerOne = frozen.find(row => row.includes('answer line 1'))
    expect(answerOne).toBeDefined()
    // Locked before any paint: the row left history and reached the screen.
    expect(emu.scrollback.some(row => row.trim() === answerOne!.trim())).toBe(false)
    expect(emu.normalScreen().some(row => row.trim() === answerOne!.trim())).toBe(true)
    renderer.render({ ...frame(taller, taller.length - 2), transcript: closed.transcript })
    // Compare against where history actually is now: the taller window pulled
    // four rows back down, so slicing from the pre-resize length would skip
    // exactly the window a wrong mapping would land in.
    const beforeGrowth = [...emu.scrollback]

    // Open the run above the answer; the answer moves down by more than the gap.
    const open = frameFor([key])
    // The run opening moves the answer down by more than the gap the taller window
    // opened. This used to put the mapped boundary strictly above the viewport start,
    // which made the mapper's **choice** load-bearing here; since a pulled row now
    // also retreats the frozen boundary, the two land together again and the choice is
    // masked. Measured rather than assumed: forcing `mapBlockSpan` to select the first
    // block leaves this case green. So this is a **guardrail on the committed result**,
    // not a test of the selection rule — that rule is pinned by the `mapBlockSpan`
    // suite, on offsets chosen so the choice shows.
    const gap = 4
    expect(answerAt(open.transcript) - answerAt(closed.transcript)).toBeGreaterThanOrEqual(gap)
    renderer.reflow(1)
    renderer.render({ ...frame(open.lines, open.lines.length - 2), transcript: open.transcript })

    // Grow across the mapped boundary and check where new rows are committed.
    const grown = [...open.lines, ...Array.from({ length: 8 }, (_, i) => `tail-${i}`)]
    renderer.render(frame(grown, grown.length - 2))

    // A row the taller window pulled back down is **no longer in history** — asserted
    // above, before any paint: `answer line 1` left `beforePull` and reached the
    // screen. So submitting it again later is a restore rather than a replay, and the
    // check is against what history still holds rather than the pre-pull snapshot.
    const added = emu.scrollback.slice(beforeGrowth.length)
    const stillInHistory = new Set(beforeGrowth.map(row => row.trim()).filter(row => row !== ''))
    expect(added.filter(row => stillInHistory.has(row.trim()))).toEqual([])
    // Blank padding rows legitimately recur, so uniqueness is over content.
    const content = emu.scrollback.map(row => row.trim()).filter(row => row !== '')
    expect(new Set(content).size).toBe(content.length)

    // And the positive half: committing resumes where the frozen part ends and
    // does not skip the rest of the answer. A mapping that landed on the
    // answer's tail, or froze too far, would pass every "nothing repeated"
    // assertion above while skipping the middle of what the reader has seen.
    //
    // What this case guards is the **committed result**: the boundary resumes where
    // history stands, neither replaying what is frozen nor skipping the middle of the
    // answer. It no longer discriminates among block-selection rules — see above — so
    // no claim is made here about which mutations it kills.
    const committed = emu.scrollback.map(row => row.trim())
    expect(committed).toContain('answer line 0')
    // Committing resumes where history actually stands and does not skip past the
    // answer's end.
    expect(committed).toContain('answer line 3')
    // The pulled row is restored exactly once and has **reached history** by the end;
    // the window has moved past it, so it is no longer on screen. Asserting only its
    // absence, as this used to, would pass just as well if it had been dropped.
    //
    // Both screen checks compare the **whole row**: a substring test for
    // `answer line 1` also matches `answer line 10` through `19`, which are on screen
    // at the end, so the earlier version passed by matching the wrong rows.
    expect(committed.filter(row => row === answerOne!.trim()).length).toBe(1)
    expect(emu.normalScreen().some(row => row.trim() === answerOne!.trim())).toBe(false)
    // The pre-pull snapshot is the premise, not decoration: without the pull the rule
    // above would be testing the old behaviour.
    expect(frozen.length).toBeGreaterThan(beforeGrowth.length)
  })
})

describe('MainScreenRenderer a width resize and new content in the same frame', () => {
  // No reshape here — the document only grew. The resize branch takes the
  // "adopt the viewport" path, and with a short document the viewport start is
  // already past the old boundary, so the rows between them are neither
  // committed nor on screen. They are this frame's first arrival, not rows the
  // terminal moved, so treating them as already committed loses them.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  it('commits the rows that arrive with the resize', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const closed = doc(2)
    renderer.render(frame(closed, closed.length - 2))
    const before = [...emu.scrollback]

    // Wider, and thirty new rows, in the same frame.
    renderer.resize(100, 10)
    const grown = [
      ...closed.slice(0, -2),
      ...Array.from({ length: 30 }, (_, i) => `new-${i}`),
      'composer', 'footer',
    ]
    renderer.render(frame(grown, grown.length - 2))

    // The old history is untouched, and the rows that first arrived here are in
    // it exactly once each.
    expect(emu.scrollback.slice(0, before.length)).toEqual(before)
    for (const row of ['new-0', 'new-10', 'new-21']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    expect(emu.visible()).toEqual(grown.slice(-10))
  })
})

describe('MainScreenRenderer a width change that is not width-only', () => {
  // `widthChanged` is not "width-only": a resize can change both, and then the
  // terminal has already pushed rows up itself. Flushing them again submits
  // the same rows twice.
  it('does not resubmit rows the terminal already moved', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    const doc = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    renderer.render(frame(doc, 4))
    expect(emu.scrollback).toEqual(['a', 'b'])

    // Shorter *and* wider: the terminal pushes c and d up on its own.
    emu.resize(3)
    renderer.resize(100, 3)
    renderer.render(frame(doc, 4))

    expect(emu.scrollback).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('MainScreenRenderer a height change with new content in the same frame', () => {
  // Disabling the flush for height changes stops the duplicate, but it does
  // not make the case solved: the terminal only committed the rows its own
  // move took, and rows that arrive for the first time in the same frame were
  // never moved by anything. Adopting the viewport start skips them.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  it('commits the rows that first arrive here, without repeating the moved ones', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const closed = doc(2)
    renderer.render(frame(closed, closed.length - 2))
    const before = [...emu.scrollback]

    // Shorter, and thirty new rows in the same frame.
    emu.resize(8)
    renderer.resize(80, 8)
    const grown = [
      ...closed.slice(0, -2),
      ...Array.from({ length: 30 }, (_, i) => `new-${i}`),
      'composer', 'footer',
    ]
    renderer.render(frame(grown, grown.length - 2))

    // Everything the terminal already held is still there, in order, and the
    // rows this frame first brought are committed exactly once each. The point
    // is not how many rows landed but that none is missing and none repeats:
    // the rows the terminal moved itself must not be sent a second time, and
    // the new tail must not be skipped in the other direction.
    expect(emu.scrollback.slice(0, before.length)).toEqual(before)
    const content = emu.scrollback.filter(row => row.trim() !== '')
    expect(new Set(content).size).toBe(content.length)
    for (const row of ['head-8', 'head-9', 'new-0', 'new-23']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    expect(emu.visible()).toEqual(grown.slice(-8))
  })
})

describe('MainScreenRenderer a height change after the boundary moved above the screen top', () => {
  // A reflow deliberately leaves the old screen's top row *below* the frozen
  // boundary, so "the rows the terminal moves" and "the rows the document says
  // are frozen" are not the same interval. Adding the height delta to the
  // document boundary assumes they are, and skips whatever sits between.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  it('commits a row that first arrives in this frame', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))
    const afterShrink = [...emu.scrollback]

    // Shorter, and thirty new rows in the same frame.
    emu.resize(8)
    renderer.resize(80, 8)
    const grown = [
      ...closed.slice(0, -2),
      ...Array.from({ length: 30 }, (_, i) => `new-${i}`),
      'composer', 'footer',
    ]
    renderer.render(frame(grown, grown.length - 2))

    // These two sat between the boundary and the moved rows. Neither had been
    // shown or committed, so the flush has to carry them.
    for (const row of ['answer', 'new-0']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })
})

describe('MainScreenRenderer a net-zero height burst with new content', () => {
  // The terminal shrank and grew back with no paint in between: it pushed rows
  // up and pulled the same rows down, leaving history as it was. "It moved rows
  // once" is therefore not the test — what matters is what is in history now.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  it('commits the new rows without repeating what came back down', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))
    const afterShrink = [...emu.scrollback]
    const before = [...emu.scrollback]

    emu.resize(8)
    renderer.resize(80, 8)
    emu.resize(10)
    renderer.resize(80, 10)
    const grown = [
      ...closed.slice(0, -2),
      ...Array.from({ length: 20 }, (_, i) => `new-${i}`),
      'composer', 'footer',
    ]
    renderer.render(frame(grown, grown.length - 2))

    // Rows are padded to the frame width, so the comparison is over trimmed
    // content; the padded form differs once the terminal is a row wider.
    const trimmed = (rows: readonly string[]): string[] => rows.map(row => row.trim())
    expect(trimmed(emu.scrollback).slice(0, before.length)).toEqual(trimmed(before))
    // The first arrivals are committed; the tail of the growth is still on
    // screen, which is the point of a frozen boundary.
    for (const row of ['new-0', 'new-5']) {
      expect(trimmed(emu.scrollback).filter(entry => entry === row).length).toBe(1)
    }
  })
})

describe('MainScreenRenderer the frozen boundary is a floor, not a starting point', () => {
  // Taking the flush start from the screen top alone reaches below the frozen
  // boundary, and everything between them was already committed by an earlier
  // frame. The natural shrink only pushes `head-8` and `head-9`, so those two
  // markers are untouched by it and show a replay on their own.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  it('does not replay rows the boundary already covers', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))
    const afterShrink = [...emu.scrollback]

    emu.resize(8)
    renderer.resize(80, 8)
    const grown = [
      ...closed.slice(0, -2),
      ...Array.from({ length: 30 }, (_, i) => `new-${i}`),
      'composer', 'footer',
    ]
    renderer.render(frame(grown, grown.length - 2))

    for (const row of ['head-10', 'head-11', 'run header', 'run-row-0', 'run-row-1', 'answer', 'new-0']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })
})

describe('MainScreenRenderer a height change when the screen top is a padding row', () => {
  // `effectiveStart` is a document row, but the physical screen can start with
  // blank padding above it, so "the screen's top" and "the document's first row"
  // are not the same. A natural shrink then pushes a blank row, not content, and
  // treating that as content the terminal committed skips real rows.
  it('does not treat a pushed padding row as committed content', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    const short = ['a', 'composer', 'footer']
    renderer.render(frame(short, 1, { bodyRows: 1 }))

    emu.resize(4)
    renderer.resize(80, 4)
    const grown = ['a', ...Array.from({ length: 10 }, (_, i) => `new-${i}`), 'composer', 'footer']
    renderer.render(frame(grown, grown.length - 2, { bodyRows: grown.length - 2 }))

    expect(emu.scrollback.filter(row => row.trim() === 'a').length).toBe(1)
  })
})

describe('MainScreenRenderer a height change while the reader is browsing, then returning', () => {
  // The browse frame changed what the screen showed without going through
  // paintFollow, so the recorded screen top is stale by the time the returning
  // frame arrives. The terminal pushed rows the renderer no longer attributes to
  // the right place, and the rows between the boundary and the stale top are
  // skipped.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  it('still commits rows the terminal did not take', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const closed = doc(2)
    renderer.render(frame(closed, closed.length - 2))

    // Browse to the top of the document, where the screen shows head-0..head-9.
    renderer.render(frame(closed.slice(0, 10), 0, { transientSurface: 'scroll' }))

    // The terminal shrinks and pushes head-0 and head-1 up, and the returning
    // frame brings thirty new rows with it.
    emu.resize(8)
    renderer.resize(80, 8)
    const grown = [
      ...closed.slice(0, -2),
      ...Array.from({ length: 30 }, (_, i) => `new-${i}`),
      'composer', 'footer',
    ]
    renderer.render(frame(grown, grown.length - 2))

    for (const row of ['head-8', 'head-9', 'new-0']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })
})

describe('MainScreenRenderer a height change after a browse that is not at the top', () => {
  // A transient frame paints a projection the host already windowed, so index 0
  // in what the renderer receives is a row inside the window, not a document
  // row. Recording that as the screen top is only right when the window happens
  // to start at the document's first row.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]

  it('takes the browse window into account', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const closed = doc(2)
    renderer.render(frame(closed, closed.length - 2))

    // A real browse projection over the middle of the document, not a slice of
    // it: the host windows the transcript and reports where that window starts,
    // and the renderer paints what the window contains.
    const browsed = {
      lines: closed.slice(8, 18),
      transcript: {
        start: 8, maxStart: 8, budget: 10, hiddenAbove: 8, hiddenBelow: 0,
        bodyRow: 0, blockStarts: [],
      },
    }
    renderer.render({
      lines: browsed.lines, liveStart: 0, cursorVisible: false,
      transientSurface: 'scroll', transcript: browsed.transcript,
      documentRows: { documentStart: 8, documentEnd: 8 + browsed.lines.length, frameStart: 0 },
    })

    emu.resize(8)
    renderer.resize(80, 8)
    const grown = [
      ...closed.slice(0, -2),
      ...Array.from({ length: 30 }, (_, i) => `new-${i}`),
      'composer', 'footer',
    ]
    renderer.render(frame(grown, grown.length - 2))

    // The terminal pushed the window's own top rows, so they are already in
    // history; nothing before them may be sent again, and nothing after may be
    // skipped.
    for (const row of ['head-8', 'head-9']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })
})

describe('MainScreenRenderer the document range a frame was drawn from', () => {
  // A frame says which document rows its screen was drawn from, so a resize can
  // tell which rows the terminal committed on its own. Both cases below were
  // reproducible violations of the scrollback contract while the renderer
  // inferred that from a top row plus a padding count.
  const doc = (runRows: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: runRows }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]
  const grownFor = (base: readonly string[]): string[] => [
    ...base.slice(0, -2),
    ...Array.from({ length: 30 }, (_, i) => `new-${i}`),
    'composer', 'footer',
  ]

  it('does not credit a main-screen overlay\'s moved rows to the document', () => {
    // The overlay covers the main screen, so the rows a shrink pushes up are
    // the overlay's and say nothing about the document. Crediting them skips
    // `head-8` and `head-9`, which then reach neither history nor the viewport.
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { height: 10, alternateScreenOverlays: false },
    )
    const closed = doc(2)
    renderer.render(frame(closed, closed.length - 2))
    renderer.render({
      lines: ['overlay-title', 'overlay-body', 'overlay-more', 'overlay-end', 'overlay-extra'],
      liveStart: 0, cursorVisible: false, transientSurface: 'overlay',
      // The overlay drew no transcript body at all: `null`, not an omitted
      // field. The two are different facts — one says "there is none", the other
      // says "I did not say" — and reading a missing field as "none" would let a
      // caller that forgot to report look correct.
      documentRows: null,
    })
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(grownFor(closed), 30))

    for (const row of ['head-8', 'head-9', 'new-0']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })

  it('does not credit a pushed row whose position the new text took over', () => {
    // The old composer sits at the position `new-0` now occupies. That the old
    // row entered history says nothing about the new one, and crediting the
    // row skips `new-0`.
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    const short = ['a', 'composer', 'footer']
    // Only `a` is the body; the composer and footer are chrome and are reported
    // as such, so a resize cannot credit the terminal with committing them.
    renderer.render(frame(short, 1, { bodyRows: 1 }))
    emu.resize(1)
    renderer.resize(80, 1)
    const grown = ['a', ...Array.from({ length: 10 }, (_, i) => `new-${i}`), 'composer', 'footer']
    renderer.render(frame(grown, grown.length - 2, { bodyRows: grown.length - 2 }))

    expect(emu.scrollback.filter(row => row.trim() === 'new-0').length).toBe(1)
  })
})

describe('MainScreenRenderer a frame that did not say where it came from', () => {
  // `null` and an omitted field are different facts. `null` is a frame that drew
  // no body; an omitted field is a caller that did not report. Reading the
  // second as the first lets a frame that forgot to say look correct, and
  // credits rows it cannot account for.
  it('does not credit an overlay\'s rows when the frame says it has no body', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { height: 10, alternateScreenOverlays: false },
    )
    const doc = [
      ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
      'run header', 'run-row-0', 'run-row-1', 'answer', 'composer', 'footer',
    ]
    renderer.render(frame(doc, doc.length - 2))
    renderer.render({
      lines: ['overlay-title', 'overlay-body', 'overlay-more', 'overlay-end', 'overlay-extra'],
      liveStart: 0, cursorVisible: false, transientSurface: 'overlay',
      documentRows: null,
    })
    emu.resize(8)
    renderer.resize(80, 8)
    const grown = [...doc.slice(0, -2), ...Array.from({ length: 30 }, (_, i) => `new-${i}`), 'composer', 'footer']
    renderer.render(frame(grown, grown.length - 2))

    for (const row of ['head-8', 'head-9', 'new-0']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })
})

describe('MainScreenRenderer a frame whose source is unknown', () => {
  // The third state. `null` says "no body"; omitting the field says "I did not
  // report", which is a gap rather than an answer. A renderer that kept
  // crediting the previous frame's range to such a frame would commit rows on
  // the strength of information it does not have.
  it('credits the unknown frame nothing rather than the last known range', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { height: 10, alternateScreenOverlays: false },
    )
    const doc = [
      ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
      'run header', 'run-row-0', 'run-row-1', 'answer', 'composer', 'footer',
    ]
    renderer.render(frame(doc, doc.length - 2))
    // A frame that forgot to say. It replaces the screen, so the rows the
    // terminal pushes afterwards are the unknown frame's, and nothing can be
    // credited against them.
    renderer.render({
      lines: ['who-knows-0', 'who-knows-1', 'who-knows-2', 'who-knows-3', 'who-knows-4'],
      liveStart: 0, cursorVisible: false, transientSurface: 'overlay',
      // `documentRows` deliberately absent: the caller did not report.
    })
    emu.resize(8)
    renderer.resize(80, 8)
    const grown = [...doc.slice(0, -2), ...Array.from({ length: 30 }, (_, i) => `new-${i}`), 'composer', 'footer']
    renderer.render(frame(grown, grown.length - 2))

    // Every document row the terminal had not committed still reaches history,
    // none of them twice, and none of the unknown frame's rows is claimed.
    for (const row of ['head-8', 'head-9', 'new-0']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })
})

describe('MainScreenRenderer a window the terminal only partly committed', () => {
  // The credit from a terminal's own move is a *range*, and it need not touch
  // the frozen boundary. A browse window that starts past it leaves a gap
  // between the two, and a single upper bound would drop that gap — rows the
  // reader has scrolled past and nobody has committed.
  const doc = (count: number): string[] =>
    Array.from({ length: count }, (_, i) => `line-${i}`)

  it('commits the gap below a window the terminal partly committed', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const all = doc(40)
    // Follow the tail so the top of the document is already frozen. The window
    // below starts *past* the frozen boundary, so the rows between them are
    // committed by neither and a single upper bound would drop them.
    renderer.render(frame(all, 8))
    const frozen = [...emu.scrollback]
    expect(frozen).toEqual(all.slice(0, 8))

    renderer.render({
      lines: all.slice(20, 30),
      liveStart: 0, cursorVisible: false, transientSurface: 'scroll',
      documentRows: { documentStart: 20, documentEnd: 30, frameStart: 0 },
    })
    // The terminal shrinks: it commits the window's own top rows, [20, 22).
    emu.resize(8)
    renderer.resize(80, 8)
    // Wider, and thirty new rows, in the same frame.
    const grown = [...all, ...Array.from({ length: 30 }, (_, i) => `new-${i}`)]
    renderer.render(frame(grown, grown.length - 8))

    // [20, 22) is the terminal's; everything between the frozen boundary and it
    // was never committed and still has to be.
    const content = emu.scrollback.map(row => row.trim()).filter(row => row !== '')
    // The window's own top rows went in by the terminal's move — [20, 22).
    // The gap between the frozen boundary and them, [8, 20), was committed by
    // neither, and a single upper bound would drop all of it.
    for (const row of ['line-8', 'line-12', 'line-19', 'line-20', 'line-21']) {
      expect(content.filter(entry => entry === row).length).toBe(1)
    }
    // The *order* is not the document's, and it cannot be: the terminal pushed
    // [20, 22) into history before anything else, and history only appends. So
    // the committed sequence is 0..7, then 20, 21, then the gap, then the rest.
    // Native history is a record of what was on screen when it scrolled away,
    // not an ordered prefix of the document — which is the contract the whole
    // frozen-boundary work rests on.
    const positions = ['line-7', 'line-20', 'line-8', 'line-22']
      .map(row => content.indexOf(row))
    expect(positions.every(at => at >= 0)).toBe(true)
    expect(positions[0]!).toBeLessThan(positions[1]!)
    expect(positions[1]!).toBeLessThan(positions[2]!)
    expect(positions[2]!).toBeLessThan(positions[3]!)
  })

  it('does not credit a row that only lost its indentation', () => {
    // `'    a'` and `'a'` are different text. Comparing them trimmed made an
    // indented row look like the row that replaced it, so the replacement got
    // credited as committed and the rows below it never were — and indenting
    // code is exactly when a row changes that way.
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    renderer.render({
      lines: ['    a', 'composer', 'footer'],
      liveStart: 1,
      documentRows: { documentStart: 0, documentEnd: 1, frameStart: 0 },
    })
    emu.resize(1)
    renderer.resize(80, 1)
    const grown = ['a', ...Array.from({ length: 10 }, (_, i) => `new-${i}`)]
    renderer.render(frame([...grown, 'composer', 'footer'], grown.length + 1, { bodyRows: grown.length }))

    const content = emu.scrollback.map(row => row.replace(/\s+$/u, ''))
    // The indented row is the one the terminal committed; the plain one is new
    // and has to arrive on its own.
    expect(content.filter(entry => entry === '    a').length).toBe(1)
    expect(content.filter(entry => entry === 'a').length).toBe(1)
    expect(content.filter(entry => entry === 'new-9').length).toBe(1)
  })

  /**
   * A main-screen browse defect rather than an alt one, and now fixed. A shrink
   * that lands while the main screen is scrolled past an overflow marker used to
   * credit the renderer with a document row the terminal never committed. The
   * push count came from the height difference, which overran the rows the
   * terminal actually moved.
   *
   * What the terminal actually does here is settled in the comment below: the
   * browse frame is nine physical rows, so the hidden cursor is clamped to row 8
   * and row 9 is padding. The 10 -> 8 shrink therefore removes **one** padding
   * row from the bottom and pushes **one** row — the marker — off the top. Two
   * rows left the screen, but the padding is chrome and the marker names no
   * document row, so the number of *document* rows the terminal committed is
   **zero**. Checked against @xterm/headless 6.0.0: the screen goes from
   * [marker, line-12..line-19, ''] to [line-12..line-19] with history [marker].
   * `line-12` is therefore still owed:
   * the renderer has to commit it, and crediting the shrink for it is what drops
   * it.
   *
   * The fake terminal is correct about which rows a shrink gives up (see the
   * cursor-rule suite), so the defect was the renderer's, not the model's.
   */
  it('commits the document row a shrink did not push below an overflow marker', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const all = doc(40)
    // Freeze only the top, so the window below is still unfrozen: the rows the
    // terminal pushes have to be ones no earlier frame committed.
    renderer.render(frame(all, 8))
    // A window with an overflow marker at the top: the marker is not a document
    // row. This browse frame is nine physical rows, so the renderer clamps the
    // hidden cursor to row 8 and row 9 is padding. The 10 -> 8 shrink removes one
    // padding row from the bottom and pushes one row off the top — the marker.
    // The first document row below it stays put: the terminal moved the marker to
    // history, not the marker and the row under it.
    renderer.render({
      lines: ['… ↑ 4 earlier lines ⟨Pg↑⟩', ...all.slice(12, 20)],
      liveStart: 0, cursorVisible: false, transientSurface: 'scroll',
      documentRows: { documentStart: 12, documentEnd: 20, frameStart: 1 },
    })
    // Shrink by two rows: one padding row goes from the bottom, one row — the
    // marker — is pushed off the top. `line-12` is untouched and still owes a
    // commit from the renderer.
    emu.resize(8)
    renderer.resize(80, 8)

    // Read the terminal's own state **before** the frame that returns to the
    // transcript can write anything. This is the fact the renderer has to decide
    // against, and it is the only place the fact is still intact: once the frame
    // paints, the renderer may have committed `line-12` or skipped it, and
    // whichever happened would be indistinguishable from the terminal having done
    // it. Asserting afterwards cannot tell the two apart, which is why the
    // arrival counts below are read only after this is pinned.
    const afterResize = emu.scrollback.map(row => row.replace(/\s+$/u, ''))
    expect(afterResize.some(row => row.includes('↑ 4 earlier lines'))).toBe(true)
    expect(afterResize).not.toContain('line-12')

    renderer.render(frame(all, all.length - 8))

    const content = emu.scrollback.map(row => row.replace(/\s+$/u, '')).filter(row => row !== '')
    // The marker names no document row, and the terminal committed no document
    // row here at all. So `line-12` owes exactly one commit, made by the
    // renderer: crediting the shrink for it skips the row, and treating it as
    // still owed after the renderer already sent it would send it twice.
    expect(content.filter(entry => entry === 'line-12').length).toBe(1)
    // The gap between the frozen boundary and the window is still committed.
    expect(content.filter(entry => entry === 'line-8').length).toBe(1)
  })

  it('commits content a shrink pushed past padding, and the row after it', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    const short = ['a', 'composer', 'footer']
    // Only `a` is the body; the composer and footer are chrome and are reported
    // as such, so a resize cannot credit the terminal with committing them.
    renderer.render(frame(short, 1, { bodyRows: 1 }))
    // Two rows of padding sit above `a`, then `a`, `composer` and `footer`.
    // Shrinking to a single row pushes two blanks, then `a`, then the old
    // `composer` — so `a` enters history by the terminal's own move, and the
    // `composer` that leaves is a row the new document no longer has.
    emu.resize(1)
    renderer.resize(80, 1)
    const grown = ['a', ...Array.from({ length: 10 }, (_, i) => `new-${i}`), 'composer', 'footer']
    renderer.render(frame(grown, grown.length - 2, { bodyRows: grown.length - 2 }))

    const content = emu.scrollback.map(row => row.trim()).filter(row => row !== '')
    expect(content.filter(entry => entry === 'a').length).toBe(1)
    expect(content.filter(entry => entry === 'new-0').length).toBe(1)
  })
})

describe('mapBlockSpan picks the span the boundary is inside', () => {
  // A direct test of the rule, with offsets chosen so the choice is visible
  // rather than tuned until it is. Four blocks: the boundary at 16 sits inside
  // the second block's span, [10, 30), which becomes [20, 40) — the same length,
  // so the boundary moves with it to 26. Selecting the *last* block instead,
  // whose span is [50, 60) and becomes [45, 55), would return 11.
  const span = (oldStarts: number[], newStarts: number[], physical: number) => mapBlockSpan({
    oldStarts, newStarts, oldBody: 0, newBody: 0, physical, oldTail: 60, newTail: 55,
  })

  it('moves the boundary with a block whose span kept its length', () => {
    expect(span([0, 10, 30, 50], [0, 20, 40, 45], 16)).toBe(26)
  })

  it('does not answer with the last block when the boundary is inside an earlier one', () => {
    // Read as if the last block had been selected: its span is [50, 60) and
    // becomes [45, 55), so the boundary would land at 11 — inside the reader's
    // frozen prefix, before content they had already scrolled past.
    expect(span([0, 10, 30, 50], [0, 20, 40, 45], 16)).not.toBe(11)
  })

  it('stops at the new end when the block holding the boundary changed length', () => {
    // The same block's span grows from 20 to 40 rows. There is no correspondence
    // for where inside it the boundary was, so it becomes the block's new end
    // rather than a guess.
    expect(span([0, 10, 30, 50], [0, 20, 60, 65], 16)).toBe(60)
  })

  it('returns nothing when there is no block to anchor a span to', () => {
    expect(span([], [], 16)).toBeUndefined()
    expect(span([0, 10, 30, 50], [0, 20], 16)).toBeUndefined()
  })

  it('measures blocks in the body their offsets belong to', () => {
    // A header sits above the body, so a block's row is its offset *plus* that
    // offset. Shifting both bodies moves every row equally, so the mapped
    // boundary moves with them rather than staying put.
    const plain = span([0, 10, 30, 50], [0, 20, 40, 45], 16)
    const bothShifted = mapBlockSpan({
      oldStarts: [0, 10, 30, 50], newStarts: [0, 20, 40, 45],
      oldBody: 7, newBody: 7, physical: 23, oldTail: 67, newTail: 62,
    })
    expect(bothShifted).toBe(plain! + 7)
  })
})

describe('the fake terminal models both buffers', () => {
  // The behavioural tests are only worth reading if the terminal they run on
  // behaves like a real one. These assertions are about the model, not the
  // renderer: a failure here means the harness is wrong.
  const paint = (emu: Emulator, rows: string[]): void => {
    emu.write(`\x1b[H${rows.join('\r\n')}`)
  }

  it('clears the alternate buffer on the way in and restores normal on the way out', () => {
    const emu = new Emulator(6)
    paint(emu, ['n0', 'n1', 'n2', 'n3', 'n4', 'n5'])
    emu.write('\x1b[?1049h')
    expect(emu.altActive).toBe(true)
    expect(emu.altScreen()).toEqual(['', '', '', '', '', ''])

    paint(emu, ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'])
    emu.write('\x1b[?1049l')
    expect(emu.altActive).toBe(false)
    // Normal kept its own content; alt's rows did not overwrite it.
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5'])
  })

  it('drops alt\'s own rows when it scrolls, and keeps normal\'s', () => {
    // The distinction is *whose* rows, not *how many*: normal has a history to
    // keep them in, alt does not. Geometry is unchanged between the two halves.
    const emu = new Emulator(6)
    paint(emu, ['n0', 'n1', 'n2', 'n3', 'n4', 'n5'])
    emu.scrollback = []
    emu.write('\x1b[?1049h')
    paint(emu, ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'])
    emu.resize(4)
    // Alt's top two left its screen and went nowhere.
    expect(emu.altScreen().filter(row => row !== '')).toEqual(['a2', 'a3', 'a4', 'a5'])
    // Normal is hidden, not exempt: it is 6 rows tall, so the shorter window
    // made *it* scroll too, and its rows went into its own history.
    expect(emu.scrollback).toEqual(['n0', 'n1'])
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(['n2', 'n3', 'n4', 'n5'])
  })

  it('reclaims normal\'s rows in the order it pushed them', () => {
    const emu = new Emulator(6)
    paint(emu, ['n0', 'n1', 'n2', 'n3', 'n4', 'n5'])
    emu.resize(4)
    expect(emu.scrollback).toEqual(['n0', 'n1'])
    // Taller again: the rows come back the way they went, not reversed.
    emu.resize(6)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5'])
    expect(emu.scrollback).toEqual([])
  })

  it('resizes the hidden buffer too, as xterm.js BufferSet does', () => {
    const emu = new Emulator(6)
    paint(emu, ['n0', 'n1', 'n2', 'n3', 'n4', 'n5'])
    emu.write('\x1b[?1049h')
    emu.resize(4)
    // Normal is hidden but not unchanged: its screen is resized as well, which
    // is what a renderer that assumes the main screen is frozen gets wrong.
    expect(emu.normalScreen()).toHaveLength(4)
    expect(emu.altScreen()).toHaveLength(4)
  })

  it('keeps an overlay out of the main screen', () => {
    // The regression this model exists to catch: writing a full screen while
    // alt is active must not push the main screen's rows into its history.
    const emu = new Emulator(6)
    paint(emu, ['n0', 'n1', 'n2', 'n3', 'n4', 'n5'])
    emu.write('\x1b[?1049h')
    paint(emu, ['overlay-0', 'overlay-1', 'overlay-2', 'overlay-3', 'overlay-4', 'overlay-5'])
    expect(emu.scrollback).toEqual([])
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5'])
  })
})

describe('MainScreenRenderer the full 1049 sequence', () => {
  // The whole path in one test, because each step alone leaves a false green:
  // following, an overlay, a resize that the terminal applied to *both* buffers,
  // a second overlay paint — the step that actually consumes the pending
  // resize — then back to the transcript and some growth.
  const doc = (count: number): string[] =>
    Array.from({ length: count }, (_, i) => `line-${i}`)

  /**
   * Same cause as the 1049 case above, and now fixed. The premise is asserted
   * before the return (normal history is line-0..21, its screen is line-22..29),
   * so a duplicate afterwards could only be the renderer sending rows the
   * terminal already committed. The returning frame advances the frozen boundary
   * by exactly what the terminal committed while the screen was hidden, so those
   * rows are never sent again and the rows still owed do arrive.
   */
  it('commits the rows the hidden buffer moved without replaying the frozen head', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    // Follow the tail over 30 unique rows, so the top twenty are frozen.
    const all = doc(30)
    renderer.render(frame(all, 20))
    const frozen = [...emu.scrollback]
    expect(frozen).toHaveLength(20)

    // An overlay covers it. Its own rows are the alternate buffer's.
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    // Shorter, while the overlay is up: the terminal resizes both buffers, so
    // normal pushes two of its own rows into its own history.
    emu.resize(8)
    renderer.resize(80, 8)
    // Paint the overlay again. Without this the pending resize is never
    // consumed, and the risk this whole item is about goes untested.
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5', 'ov-6'], 0, { transientSurface: 'overlay' }))
    // Still in alt: the overlay has not been dismissed.
    expect(emu.altActive).toBe(true)
    // Alt's rows never reached normal's history.
    expect(emu.scrollback.every(row => !row.startsWith('ov-'))).toBe(true)
    // The premise the rest of this test rests on, checked *before* the renderer
    // comes back: the terminal moved the hidden main screen's top two rows into
    // its own history, so those rows are committed whether or not the renderer
    // knows it. Without this, a duplicate below could be read as "the renderer
    // sent them" when it was only the first time they arrived.
    expect(emu.scrollback).toEqual(all.slice(0, 22))
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(all.slice(22))
    const mark = emu.scrollback.length

    renderer.render(frame(all, all.length - 8))
    const grown = [...all, ...Array.from({ length: 10 }, (_, i) => `new-${i}`)]
    renderer.render(frame(grown, grown.length - 8))

    expect(emu.scrollback.filter(entry => entry === 'line-20').length).toBe(1)
    // And nothing already frozen is replayed.
    const content = emu.scrollback.map(row => row.trim()).filter(row => row !== '')
    expect(new Set(content).size).toBe(content.length)
    // The new tail arrives, each row once. Only the rows the terminal actually
    // scrolled off are in history — the ones still on screen are not, and asking
    // for them would be asking for something no terminal could have done.
    for (const row of ['new-0', 'new-1']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })

  it('keeps the position when a browse returns to the transcript under an overlay', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    const all = doc(30)
    renderer.render(frame(all, 20))
    renderer.render(frame(all.slice(5, 15), 0, { transientSurface: 'scroll' }))
    const browsing = [...emu.scrollback]

    // A browsing frame moves the main screen, so its snapshot is no longer
    // what the boundary is measured against.
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    renderer.render(frame(all, all.length - 10))
    const grown = [...all, ...Array.from({ length: 10 }, (_, i) => `new-${i}`)]
    renderer.render(frame(grown, grown.length - 10))

    expect(emu.scrollback.slice(0, browsing.length)).toEqual(browsing)
    const content = emu.scrollback.map(row => row.trim()).filter(row => row !== '')
    expect(new Set(content).size).toBe(content.length)
  })
})

describe('the fake terminal shrinks by the cursor rule, not by height', () => {
  // xterm.js `Buffer.resize` removes a row *below* the cursor for each row the
  // window loses, and only scrolls the top into history when there is no such
  // blank row left. A height-10 window whose cursor is on row 7 therefore pushes
  // nothing when it shrinks to 8, while the same window with its cursor on row 9
  // pushes two rows. Testing the second case alone would let a height-difference
  // implementation pass, which is the bug this pins.
  const paint = (emu: Emulator, rows: string[]): void => {
    emu.write(`\x1b[H${rows.join('\r\n')}`)
  }

  it('pushes nothing while there is a blank row below the cursor', () => {
    const emu = new Emulator(10)
    paint(emu, ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', '', ''])
    // Cursor sits on row 7 (n7): rows 8 and 9 are blank and are removed instead.
    emu.write('\x1b[8;1H')
    emu.scrollback = []
    emu.resize(8)
    expect(emu.scrollback).toEqual([])
    expect(emu.normalScreen()).toHaveLength(8)
  })

  it('pushes the top rows once the blanks below the cursor are gone', () => {
    const emu = new Emulator(10)
    paint(emu, ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9'])
    // Cursor on the last row: nothing below it, so both removed rows come off
    // the top and land in history.
    emu.write('\x1b[10;1H')
    emu.scrollback = []
    emu.resize(8)
    expect(emu.scrollback).toEqual(['n0', 'n1'])
    // The remaining screen is the untouched tail, still eight rows tall.
    expect(emu.normalScreen()).toEqual(['n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9'])
  })
})

describe('the fake terminal clamps a cursor position like the terminal', () => {
  // xterm routes cursor positioning through `_restrictCursor`, so a row past the bottom
  // lands on the last row rather than outside the buffer. Only the alternate buffer used
  // to be clamped; the normal one was not, which let tests build states no terminal has.
  it('lands on the last row when asked for a row past the bottom', () => {
    const emu = new Emulator(4)
    emu.write(`\x1b[H${['a', 'b', 'c', 'd'].join('\r\n')}`)
    emu.write('\x1b[99;1H')
    expect(emu.cursorRow()).toBe(3)
    emu.write('\x1b[1;1H')
    expect(emu.cursorRow()).toBe(0)
  })
})

describe('the fake terminal keeps the cursor where xterm.js would', () => {
  // The two model tests above pin *how many* rows leave, which is not the whole
  // rule. xterm.js clamps the cursor into the new height rather than shifting it
  // by the height difference, so a window that loses rows without scrolling
  // leaves the cursor where it was.
  const paint = (emu: Emulator, rows: string[]): void => {
    emu.write(`\x1b[H${rows.join('\r\n')}`)
  }

  it('leaves the cursor alone when no row was pushed', () => {
    const emu = new Emulator(10)
    paint(emu, ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', '', ''])
    emu.write('\x1b[8;1H')
    const before = emu.cursorRow()
    emu.resize(8)
    // Row 7 is still row 7; it is not shifted up by the two lost rows.
    expect(emu.cursorRow()).toBe(before)
  })

  it('scrolling down keeps the cursor at the bottom', () => {
    const emu = new Emulator(10)
    paint(emu, ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9'])
    emu.write('\x1b[10;1H')
    emu.scrollback = []
    emu.resize(8)
    // Two rows scrolled, so the cursor moved up two.
    expect(emu.cursorRow()).toBe(7)
  })

})

describe('the fake terminal grows by the cursor rule, as @xterm/headless does', () => {
  // Calibrated against the published @xterm/headless 6.0.0 this project already
  // resolves: with the cursor at the bottom a taller window pulls history back
  // and the cursor rises with the rows it reclaimed; with rows below the cursor it
  // appends a blank, leaves history alone, and the cursor does not move. Both
  // halves are needed — testing only the reclaim case would let a
  // reclaim-always implementation pass, which is what this file did until it was
  // checked against a real terminal.
  const paint = (emu: Emulator, rows: string[]): void => {
    emu.write(`\x1b[H${rows.join('\r\n')}`)
  }

  it('pulls history back and moves the cursor when the cursor is at the bottom', () => {
    const emu = new Emulator(3)
    paint(emu, ['l0', 'l1', 'l2'])
    emu.write('\x1b[3;1H')
    // Shrink once so history exists, then grow back with the cursor low. The window is
    // two rows tall at that point, so its bottom is row 2 — asking for row 3 is
    // out of range, and the terminal clamps it rather than moving the cursor past the
    // screen.
    emu.resize(2)
    emu.write('\x1b[2;1H')
    expect(emu.cursorRow()).toBe(1)
    const history = [...emu.scrollback]
    emu.resize(4)
    expect(emu.scrollback.length).toBeLessThan(history.length)
    // Only the rows history actually holds come back, and the cursor rises by exactly
    // those. The shrink left one row behind, so the cursor moves up one.
    expect(history.length).toBe(1)
    expect(emu.cursorRow()).toBe(2)
  })

  it('adds a blank and keeps the cursor when rows sit below it', () => {
    const emu = new Emulator(3)
    paint(emu, ['l0', 'l1', 'l2'])
    emu.write('\x1b[3;1H')
    emu.resize(2)
    // Park the cursor at the top: rows now sit below it.
    emu.write('\x1b[1;1H')
    const history = [...emu.scrollback]
    emu.resize(4)
    expect(emu.scrollback).toEqual(history)
    expect(emu.cursorRow()).toBe(0)
  })
})

describe('a taller window repaints into the layout the target asks for', () => {
  // A pure-height input: no width change and no wrapped rows are needed to reach
  // this. The baseline the diff compares against has to describe the screen the
  // **terminal** now holds, not the screen this renderer believes it painted.
  // Prepending the new rows made the baseline identical to the bottom-anchored
  // target, so the diff found nothing to do and emitted a bare CUP: the document
  // stayed on rows the target had moved it off, and `#finishPaint` then recorded
  // a layout that was never drawn. Feeding the renderer's real two frames to
  // @xterm/headless 6.0.0 settles the end state: with the rows appended at the
  // bottom the terminal holds ['a','b','c','d','e','',''], and once the frame
  // repaints it holds ['','','a','b','c','d','e'] with the cursor on row 6.
  it('ends where the target layout says, not where the untouched screen was', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    renderer.render(frame(['a', 'b', 'c', 'd', 'e'], 4))
    expect(emu.visible()).toEqual(['a', 'b', 'c', 'd', 'e'])

    // Both sides are at 80 columns, so only the height changes here.
    emu.resize(7)
    renderer.resize(80, 7)
    renderer.render(frame(['a', 'b', 'c', 'd', 'e'], 4))

    // The five-row document is anchored to the bottom of the seven-row window,
    // so it has to move down. Leaving it where it was is the defect.
    expect(emu.visible()).toEqual(['', '', 'a', 'b', 'c', 'd', 'e'])
    expect(emu.cursorRow()).toBe(6)
  })
})

describe('a taller window that reclaims history', () => {
  // Codex's counterexample to scoping the baseline fix to the no-history case: a
  // grow that pulls history back must describe that physical screen, not the
  // screen this renderer last painted. The append must happen in the *first*
  // frame after the grow — splitting it across two frames would hide the bug,
  // because the second frame would then be diffed against a screen that already
  // held the new rows.
  it('repaints rows the terminal pulled back out of history', () => {
    const emu = new Emulator(3)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 3 })
    // p0,p1 scroll off into history; a,b,c fill the 3-row screen.
    renderer.render(frame(['p0', 'p1', 'a', 'b', 'c'], 5))
    expect(emu.scrollback).toEqual(['p0', 'p1'])
    expect(emu.visible()).toEqual(['a', 'b', 'c'])

    // The terminal grows to 5 rows and pulls the two history rows back, so the
    // physical screen becomes [p0,p1,a,b,c].
    emu.resize(5)
    renderer.resize(80, 5)
    // The same frame appends d,e — the grow and the append coincide.
    renderer.render(frame(['p0', 'p1', 'a', 'b', 'c', 'd', 'e'], 7))

    // The five-row document is anchored to the bottom of the five-row window, so
    // the target is the document itself. Leaving p0,p1 on screen would mean the
    // diff never repainted the rows the terminal had just put back.
    //
    // Mutant coverage, checked by hand: an appending baseline fails here, and so
    // does one that pretends the screen is known. A *prepending* baseline passes
    // this case, because pushing blanks to the top also changes rows 0-1 and so
    // forces the repaint by accident — it is right here for the wrong reason, and
    // the sibling no-history test is what rules it out. Neither test is a
    // substitute for the other.
    expect(emu.visible()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('a same-width shrink with the cursor away from the bottom', () => {
  // Codex's counterexample, and a different failure from the grow one: this is
  // not about the baseline being unknowable but about the renderer describing the
  // wrong rows. Five rows hold a five-row document [a..e] with [p0,p1] in history
  // and the cursor parked on the top row. Shrinking to three rows with the cursor
  // there moves nothing into history — the terminal drops rows from the bottom and
  // history is untouched. Verified against @xterm/headless 6.0.0 by shrinking a
  // 5-row screen holding [a..e] with the cursor on physical row 0: the screen
  // becomes ['a','b','c'], history stays ['p0','p1'], and the cursor is clamped
  // into the new height — the same row it was on, not a row further down. A
  // cursor row of 2 quoted earlier in this comment came from the initial CUP in
  // the probe rather than from the resize, and cannot be read as a shrink result.
  //
  // The old baseline was `this.#screen.slice(oldHeight - this.#height)`, which
  // drops the *top* two rows and keeps [d,e] — the opposite end of the screen
  // from the rows the terminal actually kept. Against a target of [c,d,e] that
  // read as "these rows are unchanged", so the frame emitted nothing but a CUP.
  it('describes the rows the terminal kept', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    const onTop = { cursor: { row: 0, column: 0 }, livePinned: true }
    renderer.render(frame(['p0', 'p1', 'a', 'b', 'c', 'd', 'e'], 2, onTop))
    expect(emu.scrollback).toEqual(['p0', 'p1'])
    expect(emu.visible()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(emu.cursorRow()).toBe(0)

    // Same width, so only the height changes. The cursor sits on the top row, so
    // the terminal drops rows from the bottom and history stays as it is.
    emu.resize(3)
    renderer.resize(80, 3)
    renderer.render(frame(['p0', 'p1', 'a', 'b', 'c', 'd', 'e'], 2, onTop))

    // The shrink alone leaves the terminal on [a,b,c] — checked directly against
    // @xterm/headless. The frame that follows then paints the three-row window the
    // live range actually asks for, and the real terminal ends on [c,d,e] once
    // that output is parsed. So the end state is [c,d,e], not the [a,b,c] the
    // shrink alone produced: the point of the test is that the renderer repaints
    // at all. Under the old `slice(oldHeight - this.#height)` baseline the frame
    // emitted a bare CUP, leaving [a,b,c] on screen and describing rows the
    // document had already scrolled past.
    expect(emu.visible()).toEqual(['c', 'd', 'e'])
    expect(emu.scrollback).toEqual(['p0', 'p1'])
  })
})

describe('a same-width shrink that pushes only part of the top', () => {
  // Neither of the two easy shapes. The cursor sits on physical row 3 of 5,
  // which holds p4, so the
  // terminal removes blanks from the bottom, runs out, and then still has rows to
  // push off the top. Checked against @xterm/headless 6.0.0: 5 rows holding
  // [p1..p5] over history [a,b] with the cursor on physical row 3 — which holds
  // p4 — shrink to 2 rows and end on ['p3','p4'] with history ['a','b','p1','p2'].
  //
  // So "the cursor is on the last row" is not the test for whether anything was
  // pushed — it decides only the all-or-nothing case. The count is
  // max(0, oldCursorRow + 1 - newHeight): two here, zero when the cursor is high,
  // and the full height difference when it is at the bottom. Both endpoint
  // answers are wrong for this input, which is what this test pins.
  it('pushes exactly the rows the terminal pushed', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    const doc = ['a', 'b', 'p1', 'p2', 'p3', 'p4', 'p5']
    // The document fills the window, so document row 5 is physical row 3.
    renderer.render(frame(doc, 2, { cursor: { row: 5, column: 0 }, livePinned: true }))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.visible()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
    expect(emu.cursorRow()).toBe(3)

    // Same width, so only the height changes. p5 goes as a blank, then p1 and p2
    // are pushed off the top: two rows, not zero and not all three.
    emu.resize(2)
    renderer.resize(80, 2)
    renderer.render(frame(doc, 2, { cursor: { row: 5, column: 0 }, livePinned: true }))

    // What this input pins is the **push count**, which the oracle confirms as
    // two: p1 and p2 join native history. On their own the resize and the
    // Emulator's own bookkeeping already produce that, so the count is not what
    // the `#physical` arithmetic decides — the settling frame below is.
    expect(emu.scrollback).toEqual(['a', 'b', 'p1', 'p2'])

    // Now let the tail settle. The ordinary flush from the credited boundary to
    // the settled one owes exactly p3, so the full history must be
    // [a,b,p1,p2,p3]: p1 and p2 committed by the terminal's resize must not be
    // committed a second time, and p3 must actually arrive. A count of zero
    // re-commits p1 and p2; a count of the full height difference skips p3. This
    // is what makes the test bear on the fix rather than merely restate it.
    renderer.render(frame(doc, 5, { cursor: { row: 5, column: 0 }, livePinned: true }))
    expect(emu.scrollback).toEqual(['a', 'b', 'p1', 'p2', 'p3'])
    expect(emu.visible()).toEqual(['p4', 'p5'])
  })
})

describe('a width change commits rows just as a shrink does', () => {
  // A width change is not "no rows moved". Verified against @xterm/headless 6.0.0:
  // 5 rows holding [p1..p5] over history [a,b] with the cursor on the last row,
  // resized to 100 columns and 2 rows, ends on [p4,p5] with [a,b,p1,p2,p3] in
  // history. The rows are short, so nothing wraps and the same three rows are
  // committed as in a same-width shrink. Crediting a known zero here would leave
  // all three for the next flush to commit a second time.
  it('does not re-commit the rows the terminal already moved', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    const doc = ['a', 'b', 'p1', 'p2', 'p3', 'p4', 'p5']
    // The document starts at row 2 and has seven rows, so its last index is 6
    // and that is the window's last row. The cursor has to be there for the
    // terminal to push anything; otherwise it removes rows from the bottom and
    // commits fewer. Asserted in physical rows too, since document row 7 would
    // only reach physical row 4 by being clamped.
    const bottom = { cursor: { row: 6, column: 0 }, livePinned: true }
    renderer.render(frame(doc, 2, bottom))
    expect(emu.scrollback).toEqual(['a', 'b'])
    expect(emu.cursorRow()).toBe(4)
    expect(emu.visible()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])

    emu.setWidth(100)
    emu.resize(2)
    renderer.resize(100, 2)
    renderer.render(frame(doc, 2, bottom))
    expect(emu.scrollback).toEqual(['a', 'b', 'p1', 'p2', 'p3'])

    // The tail settles: nothing may be committed twice, and nothing owed may be
    // skipped.
    renderer.render(frame(doc, 5, bottom))
    expect(emu.scrollback).toEqual(['a', 'b', 'p1', 'p2', 'p3'])
  })
})

describe('a burst that returns to the height it started at', () => {
  // 5 -> 2 -> 5 with nothing painted in between is not a no-op. Verified against
  // @xterm/headless 6.0.0: the terminal ends on ['b','p1','p2','p3','p4'] with
  // history ['a'] — one row was committed and the window came back taller. The
  // transition remembers only the first old height and the final one, so equal
  // heights on their own cannot tell this from a resize that never moved, and
  // reusing the old screen memory here would skip the whole repaint.
  it('repaints instead of trusting the screen memory', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    const doc = ['a', 'b', 'p1', 'p2', 'p3', 'p4', 'p5']
    renderer.render(frame(doc, 2, { cursor: { row: 5, column: 0 }, livePinned: true }))
    expect(emu.visible()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])

    // No frame between the two resizes, so both land in one pending transition.
    emu.resize(2)
    emu.resize(5)
    renderer.resize(80, 2)
    renderer.resize(80, 5)
    renderer.render(frame(doc, 2, { cursor: { row: 5, column: 0 }, livePinned: true }))

    // The terminal really did leave the original screen behind, so the frame has
    // to repaint rather than diff against memory of a screen that no longer
    // exists. The document fills the window again, so the live range is the same
    // five rows; what matters is that the stale rows are gone.
    expect(emu.visible()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })
})

describe('a net-zero burst seen from a main-screen browse', () => {
  // The same burst as the follow-path case, but reached through
  // `#takeResizeBaseline` instead of the follow branch. That call used to clear
  // the pending transition and *then* ask for the baseline, so by the time the
  // baseline looked for the heights the window had passed through they were
  // gone: 5 -> 2 -> 5 read as a window that never moved, and the browse reused a
  // screen the terminal had already replaced. Only the follow path was covered.
  //
  // The terminal really does end elsewhere. Verified against @xterm/headless 6.0.0
  // for this input: 5 rows holding [p1..p5] over history [a,b] with the cursor on
  // physical row 3, resized 5 -> 2 -> 5 with nothing painted in between, ends on
  // ['b','p1','p2','p3','p4'] with history ['a'].
  it('repaints the browse window instead of trusting the old screen', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    const doc = ['a', 'b', 'p1', 'p2', 'p3', 'p4', 'p5']
    renderer.render(frame(doc, 2, { cursor: { row: 5, column: 0 }, livePinned: true }))
    expect(emu.visible()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])

    // No frame between the two resizes, so both land in one pending transition.
    emu.resize(2)
    emu.resize(5)
    renderer.resize(80, 2)
    renderer.resize(80, 5)

    // Now browse the document. The browse target happens to equal the rows the
    // renderer last painted, which is exactly the case that hides the defect: a
    // diff against a remembered screen finds nothing to do and leaves whatever
    // the terminal really has.
    renderer.render({
      lines: doc.slice(2),
      liveStart: 0,
      cursorVisible: false,
      transientSurface: 'scroll',
      documentRows: { documentStart: 2, documentEnd: 7, frameStart: 0 },
    })

    expect(emu.visible()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })
})

describe('a main-screen move while an overlay was up', () => {
  const rows = (run: number): string[] => [
    ...Array.from({ length: 12 }, (_, i) => `head-${i}`),
    'run header',
    ...Array.from({ length: run }, (_, i) => `run-row-${i}`),
    'answer', 'composer', 'footer',
  ]
  const all = rows(30)

  /**
   * The gap case, and the reason a natural commit cannot simply be folded into
   * the frozen boundary. Verified against @xterm/headless 6.0.0: the terminal
   * commits only the rows it pushed, which is not the same as the rows the
   * renderer still owes.
   *
   * Ten rows, `liveStart` 8: the screen shows rows 8..29 and only 0..7 have been
   * committed, so the frozen boundary is 8. An overlay covers it, the terminal
   * shrinks to 8, and the terminal commits rows 20 and 21 of its own. Coming back
   * with the whole document at `liveStart` 22, the renderer's own flush owes
   * [8,22) — and [20,22) of that is already in history, so what it must actually
   * send is [8,20). Advancing the boundary to the end of the natural commit
   * instead marks all of [8,22) done, and rows 8..19 are then never sent by any
   * frame: the gap is permanent, and no later growth recovers it.
   */
  /**
   * A second overlay repaint carries no new transition, and it is not a frame
   * that comes back to the main screen. Parked on the first, a restore must not
   * run on the second: it would check the main screen's snapshot against the
   * *overlay's* lines, credit nothing, and drop the pending move — so the rows the
   * terminal had committed would be sent a second time on the way out. This is
   * also why the park may not overwrite an existing one with `undefined`.
   */
  it('keeps the pending move through further overlay repaints', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(all, all.length - 10))
    const beforeOverlay = [...emu.scrollback]

    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5', 'ov-6'], 0, { transientSurface: 'overlay' }))
    // A further repaint of the same overlay, with nothing new from the terminal.
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5', 'ov-6', 'ov-7'], 0, { transientSurface: 'overlay' }))
    expect(emu.altActive).toBe(true)

    // What the terminal committed, read before the renderer returns.
    const natural = [...emu.scrollback]
    const committed = natural.slice(beforeOverlay.length)
    expect(committed.length).toBeGreaterThan(0)

    renderer.render(frame(all, all.length - 6))

    // Still exactly one copy of each: the pending move survived the repaint, so
    // the returning frame knew not to send those rows again.
    for (const row of committed) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    expect(emu.scrollback.slice(0, natural.length)).toEqual(natural)
  })

  /**
   * A browse window cannot check a parked commit. The credit is verified by
   * comparing the snapshot's own text against the document, and a window that
   * does not contain those rows leaves the answer **unknown** — which is not the
   * same as "the terminal committed nothing". Crediting on a guess either way is
   * the defect: guessing "committed" skips rows that are still owed, guessing
   * "not committed" resends rows already in history.
   *
   * So the browse frame is asserted not to fabricate a credit: whatever it does,
   * the rows the terminal had committed must not gain a second copy on its
   * account, and the snapshot must survive so a later frame carrying the document
   * can still resolve it.
   */
  it('does not treat a window that cannot see the rows as "nothing committed"', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(all, 8))

    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5', 'ov-6'], 0, { transientSurface: 'overlay' }))
    expect(emu.altActive).toBe(true)
    const natural = [...emu.scrollback]
    const committed = natural.slice(8)
    expect(committed.length).toBeGreaterThan(0)

    // Come back as a browse over a window that does not contain those rows.
    renderer.render({
      lines: all.slice(0, 8),
      liveStart: 0,
      cursorVisible: false,
      transientSurface: 'scroll',
      documentRows: { documentStart: 0, documentEnd: 8, frameStart: 0 },
    })

    // The frame the user asked for must actually be painted. Settling the parked
    // comparison may not swallow the frame: the overlay has to come down and the
    // requested window has to be on screen, whether or not the credit resolved.
    expect(emu.altActive).toBe(false)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(all.slice(0, 8))

    // The browse could not resolve the credit, so it owes nothing on that account
    // and sends nothing.
    expect(emu.scrollback.filter(row => committed.includes(row)).length).toBe(committed.length)

    // Now return the whole document, and then let it grow. The credit is still
    // unresolved, and the frame that finally carries the text must be able to
    // settle it from the snapshot the browse preserved: the rows the terminal
    // committed must not gain a second copy, and the rows between the frozen
    // boundary and that commit must actually arrive.
    renderer.render(frame(all, 8))
    const grown = [...all, ...Array.from({ length: 6 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))

    for (const row of committed) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    // The gap between the boundary and the commit is still owed, and arrives.
    for (const index of [8, 15, 22]) {
      expect(emu.scrollback.filter(entry => entry === all[index]).length).toBe(1)
    }
  })

  /**
   * A commit that reaches **past** the candidate has not been settled by this
   * frame. Returning with the same document and the same `liveStart` 8 puts the
   * candidate at 8, the flush owes nothing, and a credit of [20,22) is entirely
   * out of reach — so dropping it there loses the fact that rows 20 and 21 are
   * already in history. A later frame that does reach them would then send them a
   * second time. Only the part of a commit this frame actually settles may be
   * retired.
   */
  it('keeps a commit the frame has not reached yet', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(all, 8))
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5', 'ov-6'], 0, { transientSurface: 'overlay' }))
    expect(emu.altActive).toBe(true)
    const natural = [...emu.scrollback]
    const committed = natural.slice(8)
    expect(committed.length).toBeGreaterThan(0)

    // Return with the same document and the same live range: the candidate is at
    // 8 and the commit at 20..22 is not reached by this frame.
    renderer.render(frame(all, 8))
    for (const row of committed) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }

    // Now grow past the commit. Those rows must still not be sent again.
    const grown = [...all, ...Array.from({ length: 6 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))
    for (const row of committed) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    // And the gap really was sent, rather than skipped along with the commit.
    for (const index of [8, 15, 22]) {
      expect(emu.scrollback.filter(entry => entry === all[index]).length).toBe(1)
    }
  })

  /**
   * A frame that declares **no** body range says nothing about what it is
   * showing — that is the existing contract, and it is not the same as a frame
   * that declares itself to be the whole document. Crediting a commit from such a
   * frame would confirm rows against text nobody vouched for, which is how a
   * composer or a footer ends up standing in for a body row.
   */
  it('does not credit a commit from a frame that declares no body range', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(all, 8))
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5', 'ov-6'], 0, { transientSurface: 'overlay' }))
    expect(emu.altActive).toBe(true)
    const natural = [...emu.scrollback]
    const committed = natural.slice(8)
    expect(committed.length).toBeGreaterThan(0)

    // Return with a frame that declares no body range at all. Its text must not
    // be used to confirm a body row, so the commit stays unresolved rather than
    // being credited on unverified text. The frame is still painted: the user
    // asked for it.
    renderer.render({ lines: all.slice(0, 8), liveStart: 0, cursorVisible: false, transientSurface: 'scroll' })
    expect(emu.altActive).toBe(false)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(all.slice(0, 8))
    for (const row of committed) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }

    // The very next frame is the one that grows the document and carries a source
    // range, so the comparison has to resolve **here** — from the record, not from
    // whatever the live fields happen to say after the browse. An extra frame in
    // between would quietly repair the live source first and hide that.
    const grown = [...all, ...Array.from({ length: 6 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))
    for (const row of committed) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    for (const index of [8, 15, 22]) {
      expect(emu.scrollback.filter(entry => entry === all[index]).length).toBe(1)
    }
  })

  /**
   * "The terminal moved nothing" is an **answer**, and it is different from "we
   * could not tell". A ten-row screen with the cursor on its top row, shrunk to
   * eight while an overlay is up, pushes nothing: the terminal removes two blank
   * rows from the bottom and history is untouched. If that reads as unresolved,
   * the comparison stays open forever and every later main-screen frame keeps
   * re-opening it — the interface sits on the overlay with no way back.
   */
  it('settles when the terminal moved nothing at all', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    // The cursor on the top row, so the shrink has blanks below it to remove.
    renderer.render(frame(all, all.length - 10, { cursor: { row: 0, column: 0 } }))
    const beforeOverlay = [...emu.scrollback]

    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5', 'ov-6'], 0, { transientSurface: 'overlay' }))
    expect(emu.altActive).toBe(true)

    // Nothing new entered history: the terminal committed no document row.
    expect(emu.scrollback).toEqual(beforeOverlay)

    // Come back with a frame that declares no body range. It is painted — the user
    // asked for it — and the parked comparison stays open, because the source check
    // runs **before** the push count: a record with no usable source is unresolved
    // whatever the count turns out to be.
    renderer.render({ lines: all.slice(0, 8), liveStart: 0, cursorVisible: false, transientSurface: 'scroll' })
    expect(emu.altActive).toBe(false)

    // A later frame that does declare a range can resolve it. The push count for
    // that record is zero, and zero is a **complete** answer — not another open
    // question — so the comparison closes here and later frames do not re-open it.
    renderer.render({ lines: all.slice(0, 8), liveStart: 0, cursorVisible: false, transientSurface: 'scroll' })
    expect(emu.altActive).toBe(false)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(all.slice(0, 8))

    renderer.render(frame(all, all.length - 8))
    expect(emu.altActive).toBe(false)

    // And the renderer is not left holding the comparison open: a later frame
    // still paints and the document grows normally.
    const grown = [...all, ...Array.from({ length: 6 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))
    expect(emu.altActive).toBe(false)
    // Only the rows that scrolled off the top are in history; the rest are on
    // screen, and asking for them would be asking for something no terminal does.
    // The window shows the last eight rows, so history grows by exactly those
    // that scrolled off above it, and nothing is duplicated by the fact that the
    // comparison was settled rather than left open.
    expect(emu.scrollback).toEqual([...beforeOverlay, ...grown.slice(grown.length - 16, grown.length - 8)])
    expect(new Set(emu.scrollback).size).toBe(emu.scrollback.length)
  })

  /**
   * Two overlay round-trips, each with its own natural commit, while the first
   * credit has not been retired. The second must **add** to the pending set rather
   * than replace it: with the first commit at [20,22) still pending and the second
   * at [22,24), replacing loses rows 20 and 21, and they get sent a second time
   * when the document finally grows past 24.
   */
  it('keeps an unretired commit when a later overlay adds another', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(all, 8))

    // First round trip: the terminal commits the top two rows of its own screen.
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5', 'ov-6'], 0, { transientSurface: 'overlay' }))
    renderer.render(frame(all, 8))
    const firstCommit = emu.scrollback.slice(8)
    expect(firstCommit.length).toBe(2)

    // Second round trip, before the first commit has been reached: the terminal
    // commits two more.
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3'], 0, { transientSurface: 'overlay' }))
    emu.resize(6)
    renderer.resize(80, 6)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5'], 0, { transientSurface: 'overlay' }))
    renderer.render(frame(all, 8))
    const bothCommits = emu.scrollback.slice(8)
    expect(bothCommits.length).toBe(4)

    // Now grow past both. Neither set may be sent again, and the gap still owed
    // between the boundary and the first commit must arrive.
    const grown = [...all, ...Array.from({ length: 8 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))
    for (const row of bothCommits) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    for (const index of [8, 15, 22]) {
      expect(emu.scrollback.filter(entry => entry === all[index]).length).toBe(1)
    }
  })

  /**
   * A known text change stops the run but must not discard the rows after it. The
   * terminal committed two rows; if only the first is replaced in the document, the
   * second is still the same row and still needs its commit subtracted. Stopping at
   * the mismatch and calling the comparison complete sends the untouched row a
   * second time; stopping and calling it *unresolved* leaves the comparison open
   * forever over a row that was never in doubt.
   */
  it('credits the unchanged rows after one whose text changed', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(all, 8))
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5', 'ov-6'], 0, { transientSurface: 'overlay' }))
    expect(emu.altActive).toBe(true)
    const natural = [...emu.scrollback]
    const committed = natural.slice(8)
    expect(committed.length).toBe(2)

    // The first committed row is rewritten; the second is untouched.
    const first = all.indexOf(committed[0])
    const second = all.indexOf(committed[1])
    const edited = [...all]
    edited[first] = 'rewritten-row'

    renderer.render(frame(edited, 8))
    const grown = [...edited, ...Array.from({ length: 6 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))

    // The rewritten row is new text and is owed a commit of its own; the untouched
    // one was committed by the terminal and must not be sent again.
    expect(emu.scrollback.filter(entry => entry === 'rewritten-row').length).toBe(1)
    expect(emu.scrollback.filter(entry => entry === all[second]).length).toBe(1)
  })

  /**
   * What makes "the comparison closed" observable is that the record is **gone**:
   * only one parked move is held at a time, so a move that never closes blocks the
   * next one from being recorded at all. The final history alone cannot show this —
   * a comparison left open forever and one that closed both end with the right
   * rows — so the later round trip is what pins it. Its natural commit must still
   * be credited; if the earlier zero-push record was never released, this one is
   * refused, its rows are not credited, and they are sent a second time.
   */
  it('releases the record so a later round trip can still be recorded', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(all, all.length - 10, { cursor: { row: 0, column: 0 } }))

    // First round trip: the cursor is on the top row, so the shrink commits nothing.
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5', 'ov-6'], 0, { transientSurface: 'overlay' }))
    renderer.render(frame(all, all.length - 10, { cursor: { row: 0, column: 0 } }))
    expect(emu.altActive).toBe(false)
    // Let the cursor settle on the last row, so the next shrink has rows below it
    // to give up.
    renderer.render(frame(all, all.length - 10))
    // Deeper than the first shrink, so this round trip commits rows whatever row
    // the cursor settled on.
    const beforeSecond = [...emu.scrollback]
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2'], 0, { transientSurface: 'overlay' }))
    emu.resize(5)
    renderer.resize(80, 5)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    renderer.render(frame(all, all.length - 10))
    const committed = emu.scrollback.slice(beforeSecond.length)
    expect(committed.length).toBeGreaterThan(0)

    // Grow past them: whatever the terminal committed must not be sent again.
    const grown = [...all, ...Array.from({ length: 6 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))
    for (const row of committed) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })

  /**
   * A visible resize, no overlay anywhere. The terminal pushes three rows and the
   * document replaces the middle one, so the confirmed set is two ranges with a gap
   * between them — and keeping only the first leaves the unchanged third row to be
   * committed a second time.
   *
   * Which rows were pushed is read from the terminal rather than assumed: the
   * window follows the tail, so the screen before the resize is the last `height`
   * rows of the document, not the rows at `liveStart`.
   */
  it('keeps both confirmed ranges when the middle pushed row changes', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    renderer.render(frame(all, 8))
    // The screen is the tail of the document; the frozen boundary is 8 but the
    // visible window is not rows 8..17.
    expect(emu.visible()).toEqual(all.slice(all.length - 10))
    expect(emu.scrollback).toEqual(all.slice(0, 8))

    emu.resize(7)
    renderer.resize(80, 7)
    const beforePaint = [...emu.scrollback]
    // Three rows left the screen for history. Read them, and take the middle one.
    const pushed = beforePaint.slice(8)
    expect(pushed).toEqual(all.slice(all.length - 10, all.length - 7))
    expect(pushed.length).toBe(3)

    const middle = all.indexOf(pushed[1])
    const edited = [...all]
    edited[middle] = 'rewritten-middle'
    // Move the live range past all three, so the flush has to decide about each.
    renderer.render(frame(edited, edited.length - 7))

    // The two unchanged rows were committed by the terminal and must not be sent
    // again; the rewritten middle row is new text and must actually arrive.
    expect(emu.scrollback.filter(entry => entry === pushed[0]).length).toBe(1)
    expect(emu.scrollback.filter(entry => entry === pushed[2]).length).toBe(1)
    expect(emu.scrollback.filter(entry => entry === 'rewritten-middle').length).toBe(1)
    // And the boundary really did move: the rows between it and the window arrive.
    for (const row of all.slice(8, all.length - 10)) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })

  /**
   * A resize that arrives while an earlier comparison is still open must be
   * settled **on its own geometry**. The record pins the height the window came to
   * rest at when the move happened; re-reading it with a later height claims rows
   * the terminal never pushed, and those rows are then dropped from the document.
   */
  /**
   * Two resizes inside **one** overlay stay. The hidden main screen moves twice,
   * committing rows both times, and each move needs its own record: keeping only
   * the first leaves the second move's rows unaccounted for, and they are sent
   * again when the overlay finally comes down.
   *
   * This is a different path from returning to the main screen between the two
   * moves — here nothing is painted on the main screen in between at all.
   */
  it('accounts for two resizes within a single overlay stay', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(all, 8))

    // Enter the overlay, then shrink twice without leaving it.
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5'], 0, { transientSurface: 'overlay' }))
    const afterFirst = [...emu.scrollback]
    const firstPushed = afterFirst.slice(8)

    emu.resize(6)
    renderer.resize(80, 6)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5'], 0, { transientSurface: 'overlay' }))
    const secondPushed = emu.scrollback.slice(afterFirst.length)
    expect(emu.altActive).toBe(true)
    expect(firstPushed.length).toBeGreaterThan(0)
    expect(secondPushed.length).toBeGreaterThan(0)

    // Leave the overlay and move the window past both commits.
    renderer.render(frame(all, 24))
    const grown = [...all, ...Array.from({ length: 6 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))

    // Neither move's rows may be sent a second time.
    for (const row of [...firstPushed, ...secondPushed]) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    // And the boundary moved past them, so the rows between arrive.
    for (const index of [8, 15, 22]) {
      expect(emu.scrollback.filter(entry => entry === all[index]).length).toBe(1)
    }
  })

  /**
   * A browse window that contains the committed rows **at its own offset**. The
   * rows live at document 36 and 37, but the window starts there, so in `next` they
   * are at 0 and 1. Checking a credit by indexing `next` with the absolute document
   * number looks past the end of the window, finds nothing, and drops the credit —
   * and a stale credit is a row the terminal committed that gets sent again.
   *
   * A window that does *not* contain a row is a third case: unknown, which keeps
   * the credit rather than dropping it. Discarding on "cannot see it" is the same
   * defect from the other side.
   */
  it('checks a credit through the window it is shown in', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(all, 8))

    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5'], 0, { transientSurface: 'overlay' }))
    expect(emu.altActive).toBe(true)
    const committed = [...emu.scrollback].slice(8)
    expect(committed.length).toBe(2)
    const start = all.indexOf(committed[0])
    expect(all.indexOf(committed[1])).toBe(start + 1)

    // Return as a browse whose window *is* the two committed rows, so they sit at
    // `next[0]` and `next[1]` while their document numbers are 36 and 37.
    renderer.render({
      lines: all.slice(start, start + 2),
      liveStart: 0,
      cursorVisible: false,
      transientSurface: 'scroll',
      documentRows: { documentStart: start, documentEnd: start + 2, frameStart: 0 },
    })

    // The credit is now confirmed and pending, and this window cannot see those
    // rows at all — a window over the *top* of the document. "Cannot see it" is
    // unknown, not absent, so the credit has to survive.
    renderer.render({
      lines: all.slice(0, 6),
      liveStart: 0,
      cursorVisible: false,
      transientSurface: 'scroll',
      documentRows: { documentStart: 0, documentEnd: 6, frameStart: 0 },
    })

    // Grow past them: the credit must still be there, so neither is sent again.
    const grown = [...all, ...Array.from({ length: 6 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))
    for (const row of committed) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })

  /**
   * A visible shrink where the candidate does **not** move. No overlay anywhere:
   * ten rows showing documents 20..29 with the frozen boundary at 8, the cursor on
   * the last row, shrunk to eight, then repainted with the same document and the
   * same `liveStart`. The terminal commits 20 and 21 — the rows it pushed off the
   * top — while the boundary stays at 8.
   *
   * Crediting the boundary by the *count* of pushed rows would claim 8 and 9, which
   * were never committed and are never sent by a later frame, and would lose the
   * fact that 20 and 21 are already in history. The rows the terminal moved are
   * not the rows adjacent to the boundary.
   */
  it('credits the rows the terminal moved, not the rows next to the boundary', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    renderer.render(frame(all, 8))
    expect(emu.scrollback).toEqual(all.slice(0, 8))
    expect(emu.cursorRow()).toBe(9)

    emu.resize(8)
    renderer.resize(80, 8)
    const afterResize = [...emu.scrollback]
    const committed = afterResize.slice(8)
    expect(committed.length).toBe(2)
    expect(committed).toEqual(all.slice(all.length - 10, all.length - 8))

    // The same document and the same live range, so the candidate stays at 8.
    renderer.render(frame(all, 8))

    // Grow past everything. The rows the boundary skipped must arrive, and the two
    // the terminal committed must not be sent again.
    const grown = [...all, ...Array.from({ length: 6 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))

    for (const row of all.slice(8, all.length - 10)) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    for (const row of committed) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })

  /**
   * A second overlay stay **after** the main screen was really painted. The first
   * stay's record is still unsettled — its comparison was left open by a browse —
   * but the browse itself repainted the main screen, so that record's snapshot no
   * longer describes what the terminal holds. Advancing the next record from it
   * would report rows as committed that never were, and the flush would then skip
   * them.
   *
   * This is the other side of the "two resizes in one stay" case: there, nothing
   * painted the main screen in between.
   */
  it('does not advance from a record the main screen has outgrown', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(all, 8))

    // First stay: shrink while the overlay is up, then return as a browse that
    // cannot resolve the comparison. The browse paints the main screen for real.
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5'], 0, { transientSurface: 'overlay' }))
    renderer.render({
      lines: all.slice(0, 8), liveStart: 0, cursorVisible: false,
      transientSurface: 'scroll',
      documentRows: { documentStart: 0, documentEnd: 8, frameStart: 0 },
    })
    expect(emu.altActive).toBe(false)
    const afterFirst = [...emu.scrollback]

    // Second stay, after that real paint.
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2'], 0, { transientSurface: 'overlay' }))
    emu.resize(6)
    renderer.resize(80, 6)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5'], 0, { transientSurface: 'overlay' }))
    const secondPushed = emu.scrollback.slice(afterFirst.length)
    expect(secondPushed.length).toBeGreaterThan(0)

    renderer.render(frame(all, 24))
    const grown = [...all, ...Array.from({ length: 6 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))

    // The browse put documents 0..7 back on the screen, and those are already in
    // history — the terminal re-pushing them is its own doing and not this defect,
    // so the check is on the rows the boundary is responsible for. Under a snapshot
    // advanced from the stale record, the rows just past the first stay's commit
    // would be reported as committed and never sent; they must arrive.
    for (const row of all.slice(8, 24)) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBeGreaterThan(0)
    }
    // Every row the boundary owed between 8 and 24 is present, in order, without
    // the flush having skipped a stretch of them.
    const seen = emu.scrollback.filter(row => all.slice(8, 24).includes(row))
    expect(seen).toEqual(all.slice(8, 24))
  })

  /**
   * A visible shrink whose candidate advances a **little** — far short of the rows
   * the terminal moved. Ten rows showing 20..29 with the boundary at 8, shrunk to
   * eight so the terminal commits 20 and 21, then repainted with `liveStart` 10.
   * That frame settles only rows 8 and 9; rows 20 and 21 are beyond its candidate
   * and nothing about them is decided here.
   *
   * Keeping them in the ledger is what stops a later frame from committing them
   * again. Dropping them because "this frame did not reach them" loses the fact
   * that they are already in history.
   */
  it('keeps a commit that lies past the candidate it advanced to', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    renderer.render(frame(all, 8))
    expect(emu.scrollback).toEqual(all.slice(0, 8))

    emu.resize(8)
    renderer.resize(80, 8)
    const committed = [...emu.scrollback].slice(8)
    expect(committed.length).toBe(2)
    expect(committed).toEqual(all.slice(all.length - 10, all.length - 8))

    // A small advance: the frame settles 8 and 9 and nothing else.
    renderer.render(frame(all, 10))

    // Grow past the commit: the rows the terminal moved must not be sent again,
    // and the rows between the boundary and them must arrive.
    const grown = [...all, ...Array.from({ length: 6 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))

    for (const row of committed) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    for (const index of [8, 9, 15, 19]) {
      expect(emu.scrollback.filter(entry => entry === all[index]).length).toBe(1)
    }
  })

  /**
   * A grow inside the same overlay stay **undoes** the shrink's commit. Verified
   * against @xterm/headless 6.0.0: with ten rows showing the tail of the document,
   * shrinking to eight puts the top two rows into history, and growing back to ten
   * pulls them straight back onto the screen and takes them out of history again
   * (`baseY` returns to where it was and the rows reappear at screen rows 0 and 1).
   *
   * So a commit the terminal made is **not** a fact that survives a later grow.
   * Carrying those rows as deductible credits would make the flush skip them, and
   * once the window scrolls on they are in neither history nor the screen — a hole
   * where two rows used to be.
   */
  it('does not keep a credit the terminal took back when it grew', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(all, 8))
    expect(emu.visible()).toEqual(all.slice(all.length - 10))

    renderer.render(frame(['ov-0', 'ov-1', 'ov-2'], 0, { transientSurface: 'overlay' }))
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3'], 0, { transientSurface: 'overlay' }))
    const afterShrink = [...emu.scrollback]
    const brieflyCommitted = afterShrink.slice(8)
    expect(brieflyCommitted.length).toBe(2)

    // Grow back inside the same stay: the terminal takes them out of history again.
    emu.resize(10)
    renderer.resize(80, 10)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    expect(emu.scrollback).toEqual(afterShrink.slice(0, 8))

    // Leave and let the document move well past them.
    const grown = [...all, ...Array.from({ length: 12 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))

    // Those rows must reach history like any other: the terminal no longer holds
    // them, so nothing may be deducted for them.
    for (const row of brieflyCommitted) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })

  /**
   * A grow takes back only what it actually pulls down. Verified against
   * @xterm/headless 6.0.0: ten rows showing `line-20..29` over history `line-0..7`,
   * shrunk to six, commits `line-20..23`; growing back to **seven** with the cursor
   * at the bottom pulls only `line-23` down again, leaving `line-20..22` in history
   * and the screen on `line-23..29` at cursor 6.
   *
   * So the withdrawal is exactly the most recently pushed rows. Clearing the whole
   * ledger instead re-sends rows that are still in history, and history cannot be
   * rewritten once it has scrolled.
   */
  it('takes back only the rows the grow actually pulled down', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(lines, 8))
    expect(emu.visible()).toEqual(lines.slice(20, 30))
    expect(emu.cursorRow()).toBe(9)

    renderer.render(frame(['ov-0', 'ov-1', 'ov-2'], 0, { transientSurface: 'overlay' }))
    emu.resize(6)
    renderer.resize(80, 6)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3'], 0, { transientSurface: 'overlay' }))
    expect(emu.scrollback.slice(8)).toEqual(lines.slice(20, 24))

    // Grow by one: only `line-23` comes back.
    emu.resize(7)
    renderer.resize(80, 7)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    expect(emu.scrollback.slice(8)).toEqual(lines.slice(20, 23))
    expect(emu.normalScreen().filter(row => row !== '')[0]).toBe('line-23')

    // Leave and move the document past them. `line-20..22` are still in history and
    // must not be sent again; `line-23` is not, and must arrive.
    const grown = [...lines, ...Array.from({ length: 8 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 7))
    for (const row of lines.slice(20, 23)) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    expect(emu.scrollback.filter(entry => entry === 'line-23').length).toBe(1)
  })

  /**
   * A move inside a stay starts from the layout the previous move left, not from the
   * live fields — those still describe the screen from before the stay. Four moves in
   * one stay: 10 → 6 pushes 20..23, 6 → 7 pulls 23 back, and 7 → 5 must therefore
   * start from `23..29` and push `23` and `24`.
   *
   * The cursor is part of that layout. A grow that pulls rows down moves the cursor
   * **with** them, so the next move's push count comes from the cursor of the screen
   * that actually exists — measured against the terminal at each step rather than
   * against a screen the renderer stopped tracking.
   *
   * NOTE: the width change in this fixture is a short-row one, which is now recognised
   * as preserving the layout rather than making it unknown. The mechanism this case
   * described — an unknown layout being settled as if it had credited nothing — is still
   * real, but this input no longer produces it.
   *
   * An unknown layout must not read as "nothing to credit". Ten rows showing
   * `line-20..29` over history `line-0..7`, then four moves inside one overlay
   * stay: 10 -> 6 (commits 20..23), 6 -> 7 (pulls 23 back), 7 -> 5 (commits 23 and
   * 24). The last move's layout cannot be derived from a plain push, so its rows
   * are unknown — but unknown is not zero.
   *
   * Settling it as an empty result drops the fact that the terminal committed 23
   * and 24, and the flush sends them a second time.
   */
  it('does not settle a move whose layout is unknown as if it credited nothing', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(lines, 8))

    const overlay = (n: number): void => {
      renderer.render(frame(Array.from({ length: n }, (_, i) => `ov-${i}`), 0, { transientSurface: 'overlay' }))
    }
    overlay(3)
    // Each step is locked against the terminal's own cursor right after the resize
    // and **before** any paint, so the layout the renderer carries forward is tied to
    // what the hidden screen actually holds rather than to the cursor of a screen it
    // stopped tracking.
    emu.resize(6)
    expect(emu.normalCursorRow()).toBe(5)
    renderer.resize(80, 6)
    overlay(4)
    emu.resize(7)
    expect(emu.normalCursorRow()).toBe(6)
    renderer.resize(80, 7)
    overlay(5)
    emu.resize(5)
    expect(emu.normalCursorRow()).toBe(4)
    renderer.resize(80, 5)
    overlay(4)

    // What the terminal holds before the renderer comes back.
    const beforeReturn = [...emu.scrollback]
    for (const row of lines.slice(20, 25)) expect(beforeReturn).toContain(row)

    const grown = [...lines, ...Array.from({ length: 8 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 5))

    // Every row the terminal committed is in history exactly once.
    for (const row of lines.slice(20, 25)) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })

  /**
   * A withdrawal binds to a pushed position, not to a document row. Only `[0,22)` of
   * the document is body and the rest is chrome, so among the rows a shrink pushes
   * only `line-20` and `line-21` are document rows. Growing back by one pulls the
   * **chrome** row down, so both body credits survive — the stack holds an
   * `undefined` for that position, and popping it takes nothing from the ledger.
   *
   * Trimming the ledger by count from the document-number end instead would take
   * `line-21`, which the terminal still holds.
   */
  it('withdraws the position the grow pulled, not the highest document number', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    // The document is the whole run of `line-N`; rows from 22 on are chrome.
    renderer.render(frame(lines, 8, { bodyRows: 22 }))

    renderer.render(frame(['ov-0', 'ov-1'], 0, { transientSurface: 'overlay' }))
    emu.resize(6)
    renderer.resize(80, 6)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2'], 0, { transientSurface: 'overlay' }))
    const afterShrink = [...emu.scrollback]
    const bodyCommitted = afterShrink.filter(row => lines.slice(0, 22).includes(row))
    expect(bodyCommitted.length).toBeGreaterThan(0)

    emu.resize(7)
    renderer.resize(80, 7)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3'], 0, { transientSurface: 'overlay' }))

    // Leave with a following transcript. The grow took a chrome row, so both body
    // rows are still in history and neither may be sent again.
    const grown = [...lines, ...Array.from({ length: 8 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 7))

    for (const row of bodyCommitted) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(
        afterShrink.filter(entry => entry === row).length,
      )
    }
    // And the boundary really moved: the rows between it and the window arrive.
    for (const row of lines.slice(8, 20)) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })

  /**
   * A visible shrink followed by a visible grow, no overlay anywhere. The shrink
   * commits rows 20..23; the grow pulls the newest of them back onto the screen, so
   * its credit has to be withdrawn — the terminal no longer holds it, and a flush
   * that skipped it would leave it in neither history nor the screen.
   *
   * The move's physical effect is applied once, before the branches choose, so a
   * frame that takes any branch still records the push and the pull.
   */
  it('withdraws a credit when a visible grow pulls the row back', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    renderer.render(frame(lines, 8))
    expect(emu.visible()).toEqual(lines.slice(20, 30))

    emu.resize(6)
    renderer.resize(80, 6)
    renderer.render(frame(lines, 8))
    const afterShrink = [...emu.scrollback]
    expect(afterShrink.slice(8)).toEqual(lines.slice(20, 24))

    // Grow back by one: `line-23` returns to the screen and leaves history.
    emu.resize(7)
    renderer.resize(80, 7)
    const afterGrow = [...emu.scrollback]
    expect(afterGrow.slice(8)).toEqual(lines.slice(20, 23))
    expect(emu.visible()[0]).toBe('line-23')

    renderer.render(frame(lines, 8))

    // Move well past them. The three still in history are not sent again, and the
    // one the grow took back really arrives.
    const grown = [...lines, ...Array.from({ length: 8 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 7))
    for (const row of lines.slice(20, 23)) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    expect(emu.scrollback.filter(entry => entry === 'line-23').length).toBe(1)
  })

  /**
   * A visible resize's credits and a hidden one's share one ledger, so a later
   * settlement's stack filter must not delete the visible ones. The visible path now
   * pushes its rows onto the same stack, because a row in history is a row in
   * history whoever put it there; before that, a parked settlement removed every
   * credit whose document row was not on the stack — including the visible ones —
   * and the flush re-sent rows the terminal had already committed.
   */
  it('keeps visible credits when a hidden move settles later', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(all, 8))

    // A visible shrink: the terminal commits its own top rows.
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(all, 8))
    const visibleCommitted = [...emu.scrollback].slice(8)
    expect(visibleCommitted.length).toBe(2)

    // Now an overlay stay that commits one more, and return.
    renderer.render(frame(['ov-0', 'ov-1'], 0, { transientSurface: 'overlay' }))
    emu.resize(7)
    renderer.resize(80, 7)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2'], 0, { transientSurface: 'overlay' }))
    const hiddenCommitted = [...emu.scrollback].slice(8 + visibleCommitted.length)

    const grown = [...all, ...Array.from({ length: 8 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 7))

    // Neither set may be sent again, and the gap between them and the window still
    // has to arrive.
    for (const row of [...visibleCommitted, ...hiddenCommitted]) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    for (const index of [8, 12, 16]) {
      expect(emu.scrollback.filter(entry => entry === all[index]).length).toBe(1)
    }
  })

  /**
   * A confirmation belongs to the push it was made about. The same document line
   * can be pushed twice, in two different stays, and the second push needs its own
   * confirmation: editing whichever stack entry happens to hold that line would
   * attach the new confirmation to a row that is no longer there.
   *
   * Here the first push of `line-20` is left unconfirmed — its row was rewritten in
   * the document, so the check ends with no match for it — and a later stay pushes
   * the replacement text. Matching by document number alone fills the *old* entry,
   * leaving the new one unconfirmed, so the flush re-sends a row the terminal
   * already committed.
   */
  it('confirms the row the move pushed, not an older row with the same number', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(lines, 8))

    // First stay: shrink to nine so the terminal commits the old `line-20`.
    renderer.render(frame(['ov-0', 'ov-1'], 0, { transientSurface: 'overlay' }))
    emu.resize(9)
    renderer.resize(80, 9)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2'], 0, { transientSurface: 'overlay' }))
    expect(emu.scrollback).toContain('line-20')

    // Come back as a browse whose document has rewritten that row.
    const edited = [...lines]
    edited[20] = 'replacement-20'
    renderer.render({
      lines: edited.slice(20, 29),
      liveStart: 0,
      cursorVisible: false,
      transientSurface: 'scroll',
      documentRows: { documentStart: 20, documentEnd: 29, frameStart: 0 },
    })

    // Second stay: shrink to eight, committing the replacement row.
    renderer.render(frame(['ov-0', 'ov-1'], 0, { transientSurface: 'overlay' }))
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2'], 0, { transientSurface: 'overlay' }))
    expect(emu.altActive).toBe(true)

    // Return over the edited document without appending, so no credit is retired.
    renderer.render(frame(edited, 8))

    // A third stay grows 8 -> 9, pulling the newest pushed row back onto the screen:
    // the replacement row. Its credit must go with it, and with the wrong association
    // it would survive on the older entry — leaving the flush to skip a row the
    // terminal no longer holds.
    renderer.render(frame(['ov-0', 'ov-1'], 0, { transientSurface: 'overlay' }))
    emu.resize(9)
    renderer.resize(80, 9)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2'], 0, { transientSurface: 'overlay' }))
    renderer.render(frame(edited, 8))

    // Move past it: the replacement text is new and must arrive; the old row was
    // committed by the terminal and must not be sent again.
    const grown = [...edited, ...Array.from({ length: 8 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))
    expect(emu.scrollback.filter(entry => entry === 'line-20').length).toBe(1)
    expect(emu.scrollback.filter(entry => entry === 'replacement-20').length).toBe(1)
  })

  /**
   * Two visible shrinks and a visible grow, with no ordinary flush and no overlay in
   * between. The first shrink confirms 20/21; the second pushes 22 alone; the grow
   * pulls 22 straight back. History ends with 20/21, so 22 must reach it later.
   *
   * A branch that pushed the move's rows a second time would leave a duplicate 22 on
   * the stack, and the grow's pop would remove only the newest of the two — leaving
   * the confirmed one behind for the flush to skip.
   *
   * NOTE: this fixture is **not** demonstrated to catch that duplicate. I have twice
   * reported a reason for it staying green and both were wrong: first "the branch is
   * not reached", which the static path contradicts, and then a stack reading that
   * came from a mutation placed where `liveCheck` was not even in scope. What can be
   * said is only that re-adding the push at the confirmation site has not, in the
   * attempts made so far, been shown to turn this green test red. The input that
   * separates the two implementations is still to be established — recorded rather
   * than claimed, and neither "uncredited row" nor "branch not reached" is asserted
   * here as the cause.
   */
  it('records a visible move once, however many branches the frame takes', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    renderer.render(frame(lines, 8))

    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(lines, 8))
    const first = [...emu.scrollback].slice(8)
    expect(first).toEqual(lines.slice(20, 22))

    emu.resize(7)
    renderer.resize(80, 7)
    renderer.render(frame(lines, 8))
    const second = [...emu.scrollback].slice(8 + first.length)
    expect(second).toEqual(lines.slice(22, 23))

    // Grow back: `line-22` returns to the screen and leaves history.
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(lines, 8))
    expect([...emu.scrollback].slice(8)).toEqual(lines.slice(20, 22))
    expect(emu.visible()[0]).toBe('line-22')

    const grown = [...lines, ...Array.from({ length: 8 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))

    // The two rows the terminal still holds are not sent again; the one it took back
    // really arrives.
    for (const row of lines.slice(20, 22)) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    expect(emu.scrollback.filter(entry => entry === 'line-22').length).toBe(1)
  })

  /**
   * The visible confirmation point, reached through the fallback branch: a visible
   * resize follows a browse whose document had rewritten the row an earlier move
   * pushed. The old stack entry is still unconfirmed, so a confirmation that looks
   * the row up by document number fills *that* entry instead of the one this move
   * created — and the new row then never gets credited.
   */
  it('confirms a visible move against its own rows, not an older same-numbered one', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(lines, 8))

    // First stay: shrink to nine, committing the old `line-20`.
    renderer.render(frame(['ov-0', 'ov-1'], 0, { transientSurface: 'overlay' }))
    emu.resize(9)
    renderer.resize(80, 9)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2'], 0, { transientSurface: 'overlay' }))
    expect(emu.scrollback).toContain('line-20')

    // Back as a browse over the rewritten document.
    const edited = [...lines]
    edited[20] = 'replacement-20'
    renderer.render({
      lines: edited.slice(20, 29),
      liveStart: 0,
      cursorVisible: false,
      transientSurface: 'scroll',
      documentRows: { documentStart: 20, documentEnd: 29, frameStart: 0 },
    })
    expect(emu.cursorRow()).toBe(8)

    // A **visible** shrink, straight after that browse: the terminal commits the
    // replacement row, while the old entry for `line-20` is still unconfirmed.
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(edited, 8))
    expect(emu.cursorRow()).toBe(7)

    // A later grow pulls the replacement row back onto the screen.
    renderer.render(frame(['ov-0', 'ov-1'], 0, { transientSurface: 'overlay' }))
    emu.resize(9)
    renderer.resize(80, 9)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2'], 0, { transientSurface: 'overlay' }))
    renderer.render(frame(edited, 8))

    const grown = [...edited, ...Array.from({ length: 8 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))
    expect(emu.scrollback.filter(entry => entry === 'line-20').length).toBe(1)
    expect(emu.scrollback.filter(entry => entry === 'replacement-20').length).toBe(1)
  })

  /**
   * Independent of the unknown-layout case: it needs a real main-screen paint and then
   * a single grow, with no grow-then-shrink inside a stay.
   *
   * A visible shrink commits 20/21. A later frame advances the live range to 14 and
   * contributes 8..13 — and those rows reach native history **after** 20/21, so the
   * real history reads 0..7, 20/21, 8..13. The stack only ever learns about the rows
   * it credits, so it holds 20/21 alone: it is a ledger of what may still be
   * deducted, not the tail of history.
   *
   * Growing then pulls back the newest history row, which is 13 — but the stack's
   * newest entry is 21, so the pop removes the wrong one. **21 loses a credit it was
   * still entitled to**, and a later flush sends that row again even though the
   * terminal holds it. The direction matters: this is a credit dropped too early,
   * not one kept too long.
   *
   * The assertions below cover both halves and are reported separately: a row being
   * sent twice, and the pulled row failing to arrive. A duplicate of 20 and a
   * duplicate of 21 are both the *same* half — re-sending — differing only in which
   * row it is; the other half is `line-13` not arriving.
   *
   * Both halves are now checked. The tail tracks the rows the renderer's own flush
   * sends, so the pop takes the position the terminal actually pulled — the two rows
   * the shrink committed are not re-sent — and a pulled row stops being claimed as
   * committed, so it is owed again and `line-13` does arrive.
   */
  it('pops the row the terminal pulled, not the newest row in the ledger', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(lines, 8))

    // A visible shrink commits the two rows at the top of the screen.
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(lines, 8))
    expect([...emu.scrollback].slice(8)).toEqual(lines.slice(20, 22))

    // The live range advances without reaching them, so 8..13 enter history after.
    renderer.render(frame(lines, 14))
    const beforeGrow = [...emu.scrollback]
    expect(beforeGrow.slice(-6)).toEqual(lines.slice(8, 14))

    // Grow inside a stay: the terminal pulls back the newest history row, 13.
    renderer.render(frame(['ov-0', 'ov-1'], 0, { transientSurface: 'overlay' }))
    emu.resize(9)
    renderer.resize(80, 9)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2'], 0, { transientSurface: 'overlay' }))

    // Read the terminal's own state before anything is painted on the main screen:
    // 13 is back on that screen and both of the shrink's rows are still in history.
    expect(emu.normalScreen().filter(row => row !== '')[0]).toBe('line-13')
    for (const row of lines.slice(20, 22)) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }

    const grown = [...lines, ...Array.from({ length: 8 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))

    // The rows the shrink committed are still in history and must not be sent again.
    for (const row of lines.slice(20, 22)) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    // And the row the grow took back must arrive.
    expect(emu.scrollback.filter(entry => entry === 'line-13').length).toBe(1)
  })

  /**
   * This is the state chain the review named — a width change inside a stay, then two
   * same-width shrinks. It was red while an unaccounted layout was reached by falling back
   * to the live fields; it passes now that the move's own `before`/`after` carries the
   * layout and a short-row width change is recognised as preserving it.
   *
   * The trust rules are in place — `geometryTrusted` and `outputTrusted` are inherited,
   * never inferred from a value being present, and `#applyMove` checks trust **before**
   * touching the ledger. They stopped the wrong rows being credited, but that was not a
   * right answer either: with no `after` the two shrinks kept `sourceUsable: false`, so
   * `#creditAgainst` never resolved, no credit was ever confirmed, and the returning
   * follow fell back to an ordinary flush from the boundary to the candidate — sending
   * rows the terminal had already committed. The move's own `before`/`after` now carries
   * the layout, so this input resolves.
   *
   * So the cause is **"blocking the wrong recovery leaves no recovery at all"**, not an
   * unrelated second bug. An earlier note here claimed the trust rules left this input
   * unchanged and therefore were unrelated; that inference was wrong — a mutation that
   * does not make a failing case pass says nothing about whether it is involved.
   *
   * An unaccounted screen must not become accounted for by being moved. A width change
   * that **actually re-wraps** leaves the rows on screen unrelated to the mapping, and
   * the following layout is unknown. If a later same-width shrink then treats that
   * guessed layout as fact, its confirmations are about the wrong rows and the flush
   * either skips rows the terminal holds or re-sends rows it does not.
   *
   * The chain here is a width change followed by two same-width shrinks, over **short
   * rows that do not wrap** — so this input no longer produces that unknown layout. The
   * mechanism is real; this case exercises the resolution of it.
   * terminal's own history is read at each step so the expected rows come from the
   * terminal rather than from the renderer's account of it.
   */
  /**
   * A pull the tail cannot reach back far enough for. The precondition is history the
   * renderer never watched: the terminal already holds shell output from before this
   * process started, and this account only knows about positions it pushed itself.
   *
   * Counting the earlier attempt shows why it missed: the renderer recorded its own
   * eight flushed positions, two shrinks added six and one, and the two grows took
   * back only two and three — so the tail never ran short and the path was never
   * entered. A short *document* is not the same thing as a short *tail*.
   *
   * This is a **new** case added alongside that one; the earlier input is still there
   * below and its own comment has been corrected, since its tail was never short.
   *
   * Here the terminal starts with ten tracked-in-no-way shell rows, and a same-width
   * grow of ten pulls them back. The renderer's tail holds fewer positions than that,
   * so it must not pretend the pulled rows are the ones it knows.
   *
   * This specific alternate-buffer input passes now: the precondition holds (six shell
   * rows really do come back onto the screen) and all six are still held at the end.
   *
   * It says nothing about the visible path or about the resize lifecycle generally — see
   * the unfinished list in the plan document.
   *
   * This is a **different kind of gap from the credit problems**, and neither the
   * tail-trust rules nor the short-tail rule is what it demonstrates: no unknown move
   * happens here, so `#tailStale` is false throughout, and no shell credit is ever
   * refused. The six rows were never in `#pushed` and never in `Frame.lines` — only the
   * fake terminal knows their text. What lost them, before the protection scroll existed,
   * was the **redraw**: the returning frame wrote the new document over the screen and the
   * snapshot the terminal had just pulled back was gone. They are now walked into native
   * history first, which is why this input holds all six at the end.
   *
   * So it is "a pull of untracked pre-startup history is painted over", and the ledger
   * cannot be extended to hold it — no arithmetic over document rows can produce text
   * the renderer never read. The protection scroll described above is what now keeps
   * them, and it must reach every path that covers the main screen — the alternate
   * return and the visible grow alike — which is still unfinished.
   */
  it('does not take its own tail for the end of history it never watched', () => {
    const shell = Array.from({ length: 10 }, (_, i) => `shell-${i}`)
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(5)
    // Shell history the renderer never sees, pushed before it exists.
    for (const row of shell) {
      emu.write(`${row}\r\n`)
    }
    expect(emu.scrollback.length).toBeGreaterThan(0)
    const beforeRenderer = [...emu.scrollback]

    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 5, alternateScreenOverlays: true },
    )
    // Few rows of its own: the account tracks only what this frame flushes.
    renderer.render(frame(lines, 3))

    const overlay = (n: number): void => {
      renderer.render(frame(Array.from({ length: n }, (_, i) => `ov-${i}`), 0, { transientSurface: 'overlay' }))
    }
    overlay(2)
    // A same-width grow: the terminal pulls rows back out of history, and the count is
    // measured rather than assumed.
    const historyBeforeGrow = emu.scrollback.length
    emu.resize(15)
    renderer.resize(80, 15)
    const pulledNow = historyBeforeGrow - emu.scrollback.length
    // More than the three positions this account ever recorded, so the tail cannot
    // account for what came back.
    expect(pulledNow).toBeGreaterThan(3)

    // Read the terminal directly, before any paint at all — the overlay repaint below is
    // a paint too, and reading after it would be reading the renderer's own output
    // rather than what the terminal did.
    const onScreen = emu.normalScreen().filter(row => row !== '')
    const asserted = onScreen.filter(row => beforeRenderer.includes(row.trim()))
    expect(asserted.length).toBeGreaterThanOrEqual(2)
    overlay(3)

    // Whatever the account can or cannot say about that, nothing may be lost or sent
    // twice afterwards.
    const grown = [...lines, ...Array.from({ length: 10 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 15))
    // Arrival, not just uniqueness: the rows the terminal brought back must still be
    // somewhere in history or on screen.
    for (const row of asserted) {
      const inHistory = emu.scrollback.some(entry => entry.trim() === row.trim())
      const visible = emu.normalScreen().some(entry => entry.trim() === row.trim())
      expect(inHistory || visible).toBe(true)
    }
    expect(new Set(emu.scrollback).size).toBe(emu.scrollback.length)
  })
  it('does not hand on a trustworthy layout when the move ended somewhere unknown', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    // NOTE: this input does **not** make the tail run short — see the case above for the
    // count. It is kept as a general move sequence, not as a short-tail fixture.
    renderer.render(frame(lines, 8))

    const overlay = (n: number): void => {
      renderer.render(frame(Array.from({ length: n }, (_, i) => `ov-${i}`), 0, { transientSurface: 'overlay' }))
    }
    overlay(3)
    emu.resize(4)
    renderer.resize(80, 4)
    overlay(4)
    // Shrink again, then grow twice.
    emu.resize(3)
    renderer.resize(80, 3)
    overlay(4)
    for (const height of [5, 8]) {
      emu.resize(height)
      renderer.resize(80, height)
      overlay(5)
    }
    const beforeReturn = [...emu.scrollback]

    const grown = [...lines, ...Array.from({ length: 10 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))
    // Nothing may be sent twice, and nothing the terminal committed may be dropped.
    expect(new Set(emu.scrollback).size).toBe(emu.scrollback.length)
    for (const row of beforeReturn) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })

  /**
   * The **prefix-claim** path, which is separate from deduction: a credited row may
   * also advance the frozen boundary, asserting the terminal has committed it.
   * Deduction was guarded first; without the same guard here a stale credit steps the
   * boundary over rows that are back on the screen, and they are gone for good rather
   * than merely sent twice.
   *
   * The sequence pins `candidate` with an explicit `liveStart` rather than padding the
   * document until the boundary happens to land on the credit, and the terminal's own
   * state is asserted at every step so the credits really are outstanding when the
   * unfollowed move happens.
   *
   * NOTE: the move in step ③ is no longer unfollowed. It is a short-row width change
   * combined with a grow, and once such a change is recognised as preserving the layout
   * the event becomes followable — so `#tailStale` is never set and removing the
   * boundary guard leaves this green. The premise it was written for is gone, not
   * merely weakened; the guard needs an input that genuinely cannot be followed.
   * Recorded rather than claimed.
   */
  it('does not let a stale credit claim the boundary after an unfollowed move', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    // ① The window shows 20..29 and the cursor is on its last row.
    renderer.render(frame(lines, 8))
    expect(emu.visible()).toEqual(lines.slice(20, 30))
    expect(emu.cursorRow()).toBe(9)

    // ② A visible shrink commits the top two rows; the boundary stays at 8, so both
    //    credits are outstanding.
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(lines, 8))
    expect(emu.scrollback.slice(8)).toEqual(lines.slice(20, 22))
    expect(emu.cursorRow()).toBe(7)

    // ③ A width change **and** a grow in one frame, inside the overlay stay: the
    //    terminal pulls those rows back out of history. (This used to be a move the
    //    account could not follow; a short-row width change is now recognised as
    //    preserving the layout, so it can — see the note above.)
    renderer.render(frame(['ov-0', 'ov-1'], 0, { transientSurface: 'overlay' }))
    emu.setWidth(100)
    emu.resize(10)
    renderer.resize(100, 10)
    // Locked before any paint: **both** rows really did leave history and reach the
    // screen. Asserting only the first would leave the second's premise unchecked.
    for (const row of lines.slice(20, 22)) {
      expect(emu.scrollback.some(entry => entry.trim() === row.trim())).toBe(false)
      expect(emu.normalScreen().some(entry => entry.trim() === row.trim())).toBe(true)
    }
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2'], 0, { transientSurface: 'overlay' }))

    // ④ Back over the same document, with `liveStart` fixing the candidate at 20. This
    //    frame flushes 8..19 and must not step over the rows above it.
    renderer.render(frame(lines, 20))

    // ⑤ A further frame with no resize of its own. The retry that used to happen here —
    //    and with it the prefix claim — no longer does, since step ③ resolves.
    const grown = [...lines, 'tail-0', 'tail-1']
    renderer.render(frame(grown, 22))

    // Every row from the boundary up to 21 arrives, each exactly once.
    for (const row of lines.slice(8, 22)) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })

  it('does not turn an unaccounted layout into an accounted one by moving it', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(lines, 8))

    const overlay = (n: number): void => {
      renderer.render(frame(Array.from({ length: n }, (_, i) => `ov-${i}`), 0, { transientSurface: 'overlay' }))
    }
    overlay(3)
    // A width change inside the stay. NOTE: for these short rows it is now recognised as
    // preserving the mapping, so the layout *is* accounted for; the steps below no longer
    // exercise an unknown one.
    emu.setWidth(100)
    renderer.resize(100, 10)
    overlay(3)

    // Two same-width shrinks follow. NOTE: this fixture no longer stands for an
    // unknown layout — the width change is a short-row one and is now recognised as
    // preserving the mapping, so the sources carry. It is kept as a move sequence; the
    // unknown-layout premise it was written for is gone with it.
    emu.resize(8)
    renderer.resize(100, 8)
    overlay(4)
    emu.resize(6)
    renderer.resize(100, 6)
    overlay(5)

    // What the terminal holds before the renderer comes back.
    const beforeReturn = [...emu.scrollback]
    expect(beforeReturn.length).toBeGreaterThan(0)

    // Leave and move well past: every row the terminal committed is present exactly
    // once, and nothing the renderer guessed at was treated as a commit.
    const grown = [...lines, ...Array.from({ length: 10 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 6))
    for (const row of beforeReturn) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    expect(new Set(emu.scrollback).size).toBe(emu.scrollback.length)
  })

  it('settles an older move on the geometry it happened at', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(all, 8))

    // Round trip one: shrink to 8 while an overlay is up, then come back to a
    // *browse* that cannot resolve the comparison, so the record stays open.
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5', 'ov-6'], 0, { transientSurface: 'overlay' }))
    renderer.render({
      lines: all.slice(0, 8), liveStart: 0, cursorVisible: false,
      transientSurface: 'scroll',
      documentRows: { documentStart: 0, documentEnd: 8, frameStart: 0 },
    })
    const committed = [...emu.scrollback]
    expect(committed.length).toBe(10)

    // A second, visible shrink lands before that comparison is finished.
    emu.resize(6)
    renderer.resize(80, 6)

    // Now a full document frame. The older move must be read at height 8, not at
    // the current 6: interpreting it with 6 would claim four rows were pushed when
    // only two were, and rows that never entered history would be skipped.
    const grown = [...all, ...Array.from({ length: 6 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))

    // Every document row the flush owed must be in history exactly once. Reading
    // the older move at the current height would credit rows the terminal never
    // pushed, and those rows would then be skipped — so a blanket check over the
    // owed range is what catches it, rather than a handful of indices.
    for (const index of [8, 15, 22]) {
      expect(emu.scrollback.filter(entry => entry === all[index]).length).toBe(1)
    }
    // The rows the older move actually committed are still exactly once each.
    for (const row of committed.slice(8)) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
    // And nothing between the boundary and the new tail was skipped.
    const owed = grown.slice(8, grown.length - 8)
    for (const row of owed) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBe(1)
    }
  })

  /**
   * A credit confirmed and then spent **after** the document changed. The
   * confirmation was evidence about the document at that moment; a row rewritten
   * before the flush arrives is new text and still owes its own commit. Carrying
   * only the row numbers would subtract the old credit and drop the row entirely.
   */
  it('drops a credit for a row rewritten after it was confirmed', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(all, 8))
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5', 'ov-6'], 0, { transientSurface: 'overlay' }))
    // Come back over the *original* document: the credit is confirmed here against
    // text that still matches, and is not yet spent.
    renderer.render(frame(all, 8))
    const committed = [...emu.scrollback].slice(8)
    expect(committed.length).toBe(2)

    // Only now rewrite the first of them and grow, so the flush reaches the
    // credit after the document has moved on.
    const first = all.indexOf(committed[0])
    const edited = [...all]
    edited[first] = 'rewritten-after-confirm'
    const grown = [...edited, ...Array.from({ length: 6 }, (_, i) => `more-${i}`)]
    renderer.render(frame(grown, grown.length - 8))

    // The rewritten row is new text and must actually arrive; the untouched second
    // row was committed by the terminal and must not be sent again.
    expect(emu.scrollback.filter(entry => entry === 'rewritten-after-confirm').length).toBe(1)
    expect(emu.scrollback.filter(entry => entry === all[all.indexOf(committed[1])]).length).toBe(1)
  })

  it('sends the rows between the boundary and the natural commit', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 10, alternateScreenOverlays: true },
    )
    renderer.render(frame(all, 8))
    expect(emu.scrollback).toEqual(all.slice(0, 8))

    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4'], 0, { transientSurface: 'overlay' }))
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(['ov-0', 'ov-1', 'ov-2', 'ov-3', 'ov-4', 'ov-5', 'ov-6'], 0, { transientSurface: 'overlay' }))
    expect(emu.altActive).toBe(true)

    // What the terminal committed on its own, read before the renderer returns.
    const natural = [...emu.scrollback]
    // The ten-row window follows the tail, so the screen holds the last ten rows
    // and the shrink commits the two the terminal itself pushed.
    const committed = all.slice(-10, -8)
    expect(natural).toEqual(all.slice(0, 8).concat(committed))

    renderer.render(frame(all, all.length - 6))

    // The rows the terminal committed are not sent again, and every other row up
    // to the new boundary must actually arrive — the gap is what this pins.
    expect(emu.scrollback.filter(row => committed.includes(row)).length).toBe(2)
    for (const index of [8, 15, 22]) {
      expect(emu.scrollback.filter(row => all[index] === row).length).toBe(1)
    }
    expect(emu.scrollback.slice(0, natural.length)).toEqual(natural)
  })
})

describe('a protection scroll with nothing left to commit', () => {
  /**
   * The protection scroll covers the whole main screen, so the frame has to paint the
   * target viewport again even when it owes no rows: the scroll blanks the window, and
   * leaving the newlines as the whole body left an empty screen that `#finishPaint` then
   * recorded as the target — wrong on screen, and wrong in memory for the next diff.
   */
  it('still paints the target viewport after scrolling the screen out', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    const at = (ls: readonly string[], live?: number): never => ({
      lines: ls, liveStart: live, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: ls.length, frameStart: 0 },
    }) as never

    renderer.render(at(lines, 3))
    expect(emu.visible()).toEqual(lines.slice(25, 30))

    // A same-width grow pulls rows back, then the same request is drawn again.
    emu.resize(15)
    renderer.resize(80, 15)
    renderer.render(at(lines, 3))

    // The window shows the requested viewport, not the blank the scroll left behind.
    expect(emu.visible().filter(row => row !== '')).toEqual(lines.slice(15, 30))
  })
})

describe('a grow whose first frame is a browse', () => {
  /**
   * The move still happened even though the next frame chooses a browse, so the risk has
   * to be established by the move itself and not by whichever paint branch happens to run
   * afterwards.
   *
   * Native history is seeded rather than written: CRLFs onto an empty 5-row screen stay
   * *on* the screen, so they would never be rows the grow could pull back.
   *
   * The shared fixture, its preconditions, the painted window and the survival of the
   * pulled instances are all ordinary passing assertions: the move is accounted for where
   * the transition is consumed, so every branch inherits the risk instead of only the
   * visible one.
   */
  const external = Array.from({ length: 10 }, (_, i) => `shell-${i}`)

  const driveGrowToBrowse = (): {
    emu: Emulator
    seeded: readonly string[]
    renderer: MainScreenRenderer
    lines: readonly string[]
  } => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(5, external.slice(0, 6))
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    const at = (ls: readonly string[], live?: number): never => ({
      lines: ls, liveStart: live, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: ls.length, frameStart: 0 },
    }) as never

    // Before the first frame, the terminal's own history is exactly the external set.
    expect(emu.scrollback).toEqual(external.slice(0, 6))

    renderer.render(at(lines, 3))
    // Still an ordered prefix after the first frame.
    expect(emu.scrollback.slice(0, 6)).toEqual(external.slice(0, 6))

    emu.resize(15)
    renderer.resize(80, 15)
    // Whatever the grow pulled back is held before any paint of the next frame.
    const pulled = external.filter(row => emu.normalScreen().some(entry => entry.trim() === row))
    expect(pulled.length).toBeGreaterThan(0)

    renderer.render({
      lines: lines.slice(15),
      liveStart: 0,
      cursorVisible: false,
      transientSurface: 'scroll',
      documentRows: { documentStart: 15, documentEnd: 30, frameStart: 0 },
    } as never)

    // The requested window is what the frame shows.
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(15, 30))
    return { emu, seeded: external.slice(0, 6), renderer, lines }
  }

  it('paints the browse window after a grow with no intermediate frame', () => {
    driveGrowToBrowse()
  })

  /**
   * Historically this failed: `#planProtection` pushed the instances a browse could not see with
   * no text and no credit, and the record owning them retired when the grow's comparison ended,
   * so a later full document frame sent them again. The gap is closed — copies now carry their
   * own confirmation state and are settled by `#settleProtection` on a normal frame — and this
   * test is what holds that closed.
   */
  it('carries the browse frame into follow and across a document growth', () => {
    const { emu, renderer, lines } = driveGrowToBrowse()
    const holds = (row: string): number =>
      emu.scrollback.filter(entry => entry === row).length
      + emu.normalScreen().filter(entry => entry.trim() === row).length

    // Back to following the same document with the window bottom at 15: the candidate is
    // exactly 15, so the rows still owed below it are the ones that must arrive.
    renderer.render({
      lines, liveStart: 15, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 30, frameStart: 0 },
    } as never)
    for (const row of external.slice(0, 6)) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }
    for (const row of lines.slice(0, 15)) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }

    // The document grows past what fits: with the window bottom at 31 the candidate is 31,
    // which crosses 25..29 and the newly appended rows rather than being clipped at 25.
    const grown = [...lines, ...Array.from({ length: 16 }, (_, i) => `more-${i}`)]
    renderer.render({
      lines: grown, liveStart: 31, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 46, frameStart: 0 },
    } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(grown.slice(31, 46))
    for (const row of [...lines, 'more-0']) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }
    for (const row of external.slice(0, 6)) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }
  })

  it('keeps the instances the grow pulled back', () => {
    const { emu, seeded } = driveGrowToBrowse()
    for (const row of seeded) {
      const survivor = emu.scrollback.includes(row)
        || emu.normalScreen().some(entry => entry.trim() === row)
      expect({ row, survivor }).toEqual({ row, survivor: true })
    }
  })
})

describe('a commit the frame could not read', () => {
  /**
   * The move happened and the terminal committed rows the frame could not match against the
   * document, because the frame declared no rows at all. The record has to survive that frame
   * so a later full-document frame can confirm it — otherwise those committed rows are sent a
   * second time. The later frame must actually reach them: with the boundary at 8 and the
   * window bottom at 22, the candidate range is [8,22), which crosses the committed 20 and 21.
   */
  it('does not re-send a commit that only a later frame can read', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })

    renderer.render({
      lines, liveStart: 8, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 30, frameStart: 0 },
    } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(20, 30))
    expect(emu.cursorRow()).toBe(9)

    // Shrink: the terminal keeps the last rows and commits the rest.
    emu.resize(8)
    renderer.resize(80, 8)
    const raw = emu.scrollback.slice()
    expect(raw).toEqual([...lines.slice(0, 8), 'line-20', 'line-21'])
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(22, 30))
    expect(emu.cursorRow()).toBe(7)

    // The frame that follows carries the document but cannot say which rows it shows.
    renderer.render({ lines, liveStart: 8, livePinned: true } as never)

    // A full-document frame whose window bottom reaches past the committed rows.
    renderer.render({
      lines, liveStart: 22, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 30, frameStart: 0 },
    } as never)

    // The committed rows were not sent again...
    const sent = emu.scrollback.filter(row => lines.includes(row))
    for (const row of ['line-20', 'line-21']) {
      expect({ row, count: sent.filter(entry => entry === row).length })
        .toEqual({ row, count: 1 })
    }
    // ...and everything still owed between the boundary and them did arrive.
    for (const row of lines.slice(8, 20)) {
      expect({ row, arrived: sent.filter(entry => entry === row).length })
        .toEqual({ row, arrived: 1 })
    }
  })
})

describe('a browse reached directly from a shrink', () => {
  /**
   * The height stays at 8 throughout: growing the window back would let the terminal pull the
   * committed rows off history, which changes who the members are and hides whether the gap was
   * ever claimed. What moves here is the **document**, so the commit range crosses 20/21 while
   * the rows stay where the shrink left them.
   */
  it('paints the window, then lets the document grow past the committed rows', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const doc30 = { documentStart: 0, documentEnd: 30, frameStart: 0 }
    const inHistory = (row: string): number => emu.scrollback.filter(entry => entry === row).length

    renderer.render({ lines, liveStart: 8, livePinned: true, documentRows: doc30 } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(20, 30))
    expect(emu.cursorRow()).toBe(9)

    emu.resize(8)
    renderer.resize(80, 8)
    expect(emu.scrollback).toEqual([...lines.slice(0, 8), 'line-20', 'line-21'])
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(22, 30))
    expect(emu.cursorRow()).toBe(7)

    // A browse straight off the shrink, naming the document rows it shows.
    renderer.render({
      lines: lines.slice(22, 30),
      liveStart: 0,
      cursorVisible: false,
      transientSurface: 'scroll',
      documentRows: { documentStart: 22, documentEnd: 30, frameStart: 0 },
    } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(22, 30))

    // Back to following the same document, window bottom at 22: the candidate range is
    // [8,22) and therefore crosses the committed 20 and 21.
    renderer.render({ lines, liveStart: 22, livePinned: true, documentRows: doc30 } as never)
    for (const row of ['line-20', 'line-21']) {
      expect({ row, count: inHistory(row) }).toEqual({ row, count: 1 })
    }
    for (const row of lines.slice(8, 20)) {
      expect({ row, count: inHistory(row) }).toEqual({ row, count: 1 })
    }

    // The document grows. The new tail reaches the viewport and the old rows are untouched.
    const grown = [...lines, 'more-0', 'more-1']
    renderer.render({
      lines: grown, liveStart: 24, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 32, frameStart: 0 },
    } as never)
    const shown = emu.normalScreen().filter(row => row !== '')
    expect(shown).toContain('more-0')
    expect(shown).toContain('more-1')
    expect(shown).toEqual(grown.slice(24, 32))
    for (const row of ['line-20', 'line-21']) {
      expect({ row, count: inHistory(row) }).toEqual({ row, count: 1 })
    }
    for (const row of lines.slice(8, 20)) {
      expect({ row, count: inHistory(row) }).toEqual({ row, count: 1 })
    }
  })
})

describe('a pulled position that a later protection copies again', () => {
  /**
   * The position 20/21 once occupied was closed when it was retired, then pulled back off
   * history by a grow. The protection scroll that follows creates **new** instances: they are a
   * new physical commit, so the old closure must not travel with them, or the copies lose their
   * late confirmation and the rows are sent a second time.
   */
  it('confirms the new copies even though the old position was closed', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const doc30 = { documentStart: 0, documentEnd: 30, frameStart: 0 }
    const holds = (row: string): number =>
      emu.scrollback.filter(entry => entry === row).length
      + emu.normalScreen().filter(entry => entry.trim() === row).length

    renderer.render({ lines, liveStart: 8, livePinned: true, documentRows: doc30 } as never)
    emu.resize(8)
    renderer.resize(80, 8)
    expect(emu.scrollback).toEqual([...lines.slice(0, 8), 'line-20', 'line-21'])
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(22, 30))
    expect(emu.cursorRow()).toBe(7)

    // A full document frame commits what is owed; 20/21 are retired here, position kept.
    renderer.render({ lines, liveStart: 22, livePinned: true, documentRows: doc30 } as never)
    // Whole-array equality, so an extra tail cannot hide behind a pair of slices.
    expect(emu.scrollback).toEqual([
      ...lines.slice(0, 8), 'line-20', 'line-21', ...lines.slice(8, 20),
    ])

    // The window grows far past the tracked tail, pulling 20/21 back onto the screen.
    emu.resize(40)
    renderer.resize(80, 40)
    // Read before any frame is painted. An empty history says only that these rows are not in
    // history; the screen has to show them for the pull to have happened at all.
    expect(emu.scrollback).toEqual([])
    expect(emu.normalScreen().filter(row => row !== '')).toEqual([
      ...lines.slice(0, 8), 'line-20', 'line-21', ...lines.slice(8, 20), ...lines.slice(22, 30),
    ])
    expect(emu.cursorRow()).toBe(29)

    // A browse over the original window repaints it; the scroll preserves the whole screen.
    renderer.render({
      lines: lines.slice(22, 30),
      liveStart: 0,
      cursorVisible: false,
      transientSurface: 'scroll',
      documentRows: { documentStart: 22, documentEnd: 30, frameStart: 0 },
    } as never)
    // The whole non-empty screen, not a prefix: a stale tail left above the window would slip
    // past a slice comparison.
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(22, 30))

    // The document grows; the copies the browse could not confirm must still be confirmable.
    const grown = [...lines, ...Array.from({ length: 41 }, (_, i) => `more-${i}`)]
    renderer.render({
      lines: grown, liveStart: 31, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 71, frameStart: 0 },
    } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(grown.slice(31, 71))
    for (const row of [...lines, 'more-0']) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }
  })
})

describe('a repainted window that committed nothing', () => {
  /**
   * The window bottom sits above the boundary, so no flush can have committed anything there. A
   * frame that only repaints the viewport therefore carries no commit fact, and the boundary may
   * not be moved onto it — doing so claims rows the terminal was never sent.
   */
  it('does not advance the boundary onto a window it merely repainted', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const external = Array.from({ length: 10 }, (_, i) => `shell-${i}`)
    const emu = new Emulator(5, external.slice(0, 6))
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    const holds = (row: string): number =>
      emu.scrollback.filter(entry => entry === row).length
      + emu.normalScreen().filter(entry => entry.trim() === row).length

    renderer.render({
      lines, liveStart: 3, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 30, frameStart: 0 },
    } as never)
    emu.resize(15)
    renderer.resize(80, 15)
    // A browse straight off the grow, naming the rows it shows.
    renderer.render({
      lines: lines.slice(15, 30),
      liveStart: 0,
      cursorVisible: false,
      transientSurface: 'scroll',
      documentRows: { documentStart: 15, documentEnd: 30, frameStart: 0 },
    } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(15, 30))

    // Same document length; only the head and the tail read differently now.
    const edited = [...lines]
    for (let i = 0; i < 3; i += 1) edited[i] = `replacement-${i}`
    for (let i = 25; i < 30; i += 1) edited[i] = `replacement-${i}`
    renderer.render({
      lines: edited, liveStart: 8, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 30, frameStart: 0 },
    } as never)

    // The repainted window is what shows; the rows below the candidate were committed for real,
    // so the boundary followed them rather than the window.
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(edited.slice(15, 30))
    for (const row of lines.slice(3, 8)) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }
    for (const row of ['replacement-0', 'replacement-1', 'replacement-2']) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }
    for (const row of lines.slice(0, 3)) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }
    for (const row of external.slice(0, 6)) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }

    // The document grows; the new window shows and the earlier rows are not sent again.
    const grown = [...edited, ...Array.from({ length: 16 }, (_, i) => `more-${i}`)]
    renderer.render({
      lines: grown, liveStart: 31, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 46, frameStart: 0 },
    } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(grown.slice(31, 46))
    // Every row of the edited document, plus the first appended one, is held exactly once...
    for (const row of [...edited, 'more-0']) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }
    // ...the preserved snapshots of the head and tail are still each held once, which is what
    // separates them from the replacement text that now occupies those positions...
    for (const row of [...lines.slice(0, 3), ...lines.slice(25, 30)]) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }
    // ...and the terminal's own history is untouched by any of it.
    for (const row of external.slice(0, 6)) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }
  })
})

describe('a candidate that falls back behind a proven boundary', () => {
  /**
   * The boundary was proven by an actual commit. A later frame whose candidate is smaller has
   * nothing owed below it, so it is not evidence that those rows left the terminal — treating it
   * as such steps the boundary back and the next frame sends committed rows again.
   */
  it('keeps the proven boundary when the candidate is smaller', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const doc30 = { documentStart: 0, documentEnd: 30, frameStart: 0 }

    renderer.render({ lines, liveStart: 8, livePinned: true, documentRows: doc30 } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(20, 30))
    expect(emu.cursorRow()).toBe(9)

    emu.resize(8)
    renderer.resize(80, 8)
    expect(emu.scrollback).toEqual([...lines.slice(0, 8), 'line-20', 'line-21'])
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(22, 30))
    expect(emu.cursorRow()).toBe(7)

    // Only [8,13) is actually sent; 20/21 stay past the candidate with their credit intact.
    renderer.render({ lines, liveStart: 14, livePinned: true, documentRows: doc30 } as never)
    expect(emu.scrollback).toEqual([
      ...lines.slice(0, 8), 'line-20', 'line-21', ...lines.slice(8, 14),
    ])

    // No resize, no edit: this frame owes nothing and must leave the boundary alone.
    const before = emu.scrollback.slice()
    renderer.render({ lines, liveStart: 10, livePinned: true, documentRows: doc30 } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(22, 30))
    expect(emu.scrollback).toEqual(before)

    // Reaching past the committed rows must not send the ones already committed.
    renderer.render({ lines, liveStart: 22, livePinned: true, documentRows: doc30 } as never)
    const holds = (row: string): number =>
      emu.scrollback.filter(entry => entry === row).length
      + emu.normalScreen().filter(entry => entry.trim() === row).length
    for (const row of [...lines.slice(8, 20), 'line-20', 'line-21']) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }
  })
})

describe('a real pull that a later candidate must not undo', () => {
  /**
   * The grow pulls exactly one instance back, and the shared entry records that by moving the
   * boundary to 13. A later frame whose candidate is 10 proves nothing about those rows, so the
   * boundary stays where the pull left it; a frame that reaches 22 commits from 13 and must not
   * send 10..12 again.
   */
  it('keeps the boundary the pull established', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 10 })
    const doc30 = { documentStart: 0, documentEnd: 30, frameStart: 0 }
    const holds = (row: string): number =>
      emu.scrollback.filter(entry => entry === row).length
      + emu.normalScreen().filter(entry => entry.trim() === row).length

    renderer.render({ lines, liveStart: 8, livePinned: true, documentRows: doc30 } as never)
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render({ lines, liveStart: 14, livePinned: true, documentRows: doc30 } as never)
    expect(emu.scrollback).toEqual([
      ...lines.slice(0, 8), 'line-20', 'line-21', ...lines.slice(8, 14),
    ])
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(22, 30))
    expect(emu.cursorRow()).toBe(7)

    // One row comes back: only 13, with 10..12 still in history.
    emu.resize(9)
    renderer.resize(80, 9)
    expect(emu.scrollback).toEqual([
      ...lines.slice(0, 8), 'line-20', 'line-21', ...lines.slice(8, 13),
    ])
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(['line-13', ...lines.slice(22, 30)])
    expect(emu.cursorRow()).toBe(8)

    // A smaller candidate owes nothing and must leave the boundary at 13.
    const afterPull = emu.scrollback.slice()
    renderer.render({ lines, liveStart: 10, livePinned: true, documentRows: doc30 } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(21, 30))
    expect(emu.scrollback).toEqual(afterPull)

    // Reaching 22 commits from 13: 10..12 are not sent again, and 13 returns once.
    const grown = [...lines, 'more-0']
    renderer.render({
      lines: grown, liveStart: 22, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 31, frameStart: 0 },
    } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(grown.slice(22, 31))
    for (const row of [...lines.slice(8, 20), 'line-20', 'line-21', 'line-13']) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }
  })
})

describe('a physical tail whose order the stack does not hold', () => {
  /**
   * The confirmed set and the exactly-consumable physical suffix are different things. A
   * protection scroll pushes its copies in **set** order while the screen it saved ran in
   * physical order, so treating that array as the tail lets a pull take positions the terminal
   * never moved — and leave it claiming ones it already took.
   */
  it('does not consume the tail in the order the confirmed set happens to hold', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const external = Array.from({ length: 10 }, (_, i) => `shell-${i}`)
    const emu = new Emulator(5, external.slice(0, 6))
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    const holds = (row: string): number =>
      emu.scrollback.filter(entry => entry === row).length
      + emu.normalScreen().filter(entry => entry.trim() === row).length

    renderer.render({
      lines, liveStart: 3, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 30, frameStart: 0 },
    } as never)
    emu.resize(15)
    renderer.resize(80, 15)
    renderer.render({
      lines: lines.slice(15, 30),
      liveStart: 0,
      cursorVisible: false,
      transientSurface: 'scroll',
      documentRows: { documentStart: 15, documentEnd: 30, frameStart: 0 },
    } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(15, 30))
    expect(emu.scrollback).toEqual([
      ...external.slice(0, 6), ...lines.slice(0, 3), ...lines.slice(25, 30), '',
    ])
    expect(emu.cursorRow()).toBe(14)

    // Two more rows of window: the terminal takes the blank and line-29 back off the top.
    emu.resize(17)
    renderer.resize(80, 17)
    expect(emu.scrollback).toEqual([
      ...external.slice(0, 6), ...lines.slice(0, 3), ...lines.slice(25, 29),
    ])
    // The whole screen, so the blank's position is read rather than assumed: a filtered view
    // cannot say where it is. Each pull unshifts the popped row, so the later pull ends up
    // first.
    expect(emu.normalScreen()).toEqual(['line-29', '', ...lines.slice(15, 30)])
    expect(emu.cursorRow()).toBe(16)

    // The document grows; the rows still held must not be sent again.
    const grown = [...lines, ...Array.from({ length: 20 }, (_, i) => `more-${i}`)]
    renderer.render({
      lines: grown, liveStart: 33, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 50, frameStart: 0 },
    } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(grown.slice(33, 50))
    for (const row of [...external.slice(0, 6), ...lines, 'more-0', 'more-1', 'more-2']) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }
  })
})

describe('a reverse move planned while an overlay is up', () => {
  /**
   * The reverse move belongs to the normal buffer, so a frame that is leaving the alternate buffer
   * has to exit first and only then scroll the normal screen. Landing the prefix in front of the
   * packaged paint would run it on the alternate buffer instead and lose the row.
   */
  it('runs the reverse move on the normal buffer after leaving the alternate one', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const external = Array.from({ length: 10 }, (_, i) => `shell-${i}`)
    const emu = new Emulator(5, external.slice(0, 6))
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 5, alternateScreenOverlays: true },
    )
    const holds = (row: string): number =>
      emu.scrollback.filter(entry => entry === row).length
      + emu.normalScreen().filter(entry => entry.trim() === row).length

    renderer.render({
      lines, liveStart: 3, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 30, frameStart: 0 },
    } as never)
    emu.resize(15)
    renderer.resize(80, 15)
    renderer.render({
      lines: lines.slice(15, 30),
      liveStart: 0, cursorVisible: false, transientSurface: 'scroll',
      documentRows: { documentStart: 15, documentEnd: 30, frameStart: 0 },
    } as never)
    expect(emu.scrollback).toEqual([
      ...external.slice(0, 6), ...lines.slice(0, 3), ...lines.slice(25, 30), '',
    ])
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(15, 30))
    expect(emu.cursorRow()).toBe(14)

    // An overlay goes up, and the window grows while it is still up.
    renderer.render({ lines: ['overlay'], liveStart: 0, livePinned: true } as never)
    emu.resize(17)
    renderer.resize(80, 17)
    expect(emu.scrollback).toEqual([
      ...external.slice(0, 6), ...lines.slice(0, 3), ...lines.slice(25, 29),
    ])
    expect(emu.normalScreen()).toEqual(['line-29', '', ...lines.slice(15, 30)])
    expect(emu.normalCursorRow()).toBe(16)

    // The overlay paints again: it consumes the move but must not run the reverse move on itself,
    // and it must not disturb the normal screen it is covering.
    renderer.render({ lines: ['overlay', 'again'], liveStart: 0, livePinned: true } as never)
    expect(emu.altActive).toBe(true)
    expect(emu.scrollback).toEqual([
      ...external.slice(0, 6), ...lines.slice(0, 3), ...lines.slice(25, 29),
    ])
    expect(emu.normalScreen()).toEqual(['line-29', '', ...lines.slice(15, 30)])
    expect(emu.normalCursorRow()).toBe(16)

    // Back on the document: the reverse move runs on the normal buffer, so line-29 returns.
    const grown = [...lines, ...Array.from({ length: 20 }, (_, i) => `more-${i}`)]
    renderer.render({
      lines: grown, liveStart: 33, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 50, frameStart: 0 },
    } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(grown.slice(33, 50))
    for (const row of [...external.slice(0, 6), ...lines, 'more-0', 'more-1', 'more-2']) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }
  })
})

describe('a pull that stays inside the proven suffix', () => {
  /**
   * A real flush appends positions in send order, so those are ordered. A pull that fits inside
   * them consumes order and is ordinary: no part of the move reaches the unknown front, and the
   * rows it takes are named instances, not a count.
   */
  it('consumes the suffix by order and keeps the unknown front untouched', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const external = Array.from({ length: 10 }, (_, i) => `shell-${i}`)
    const emu = new Emulator(5, external.slice(0, 6))
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    const doc30 = { documentStart: 0, documentEnd: 30, frameStart: 0 }
    const holds = (row: string): number =>
      emu.scrollback.filter(entry => entry === row).length
      + emu.normalScreen().filter(entry => entry.trim() === row).length

    renderer.render({ lines, liveStart: 3, livePinned: true, documentRows: doc30 } as never)
    emu.resize(15)
    renderer.resize(80, 15)
    renderer.render({
      lines: lines.slice(15, 30), liveStart: 0, cursorVisible: false,
      transientSurface: 'scroll',
      documentRows: { documentStart: 15, documentEnd: 30, frameStart: 0 },
    } as never)

    // Back to the document with the window bottom at 15: twelve rows are really flushed, and those
    // twelve become the ordered suffix.
    renderer.render({ lines, liveStart: 15, livePinned: true, documentRows: doc30 } as never)
    expect(emu.scrollback).toEqual([
      ...external.slice(0, 6), ...lines.slice(0, 3), ...lines.slice(25, 30), '',
      ...lines.slice(3, 15),
    ])
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(15, 30))
    expect(emu.normalCursorRow()).toBe(14)

    // Two more rows of window: the pull lands entirely inside the suffix.
    emu.resize(17)
    renderer.resize(80, 17)
    expect(emu.scrollback).toEqual([
      ...external.slice(0, 6), ...lines.slice(0, 3), ...lines.slice(25, 30), '',
      ...lines.slice(3, 13),
    ])
    expect(emu.normalScreen()).toEqual(['line-13', 'line-14', ...lines.slice(15, 30)])
    expect(emu.normalCursorRow()).toBe(16)

    // Returning to the grown document still holds every row exactly once.
    const grown = [...lines, ...Array.from({ length: 20 }, (_, i) => `more-${i}`)]
    renderer.render({
      lines: grown, liveStart: 33, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 50, frameStart: 0 },
    } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(grown.slice(33, 50))
    for (const row of [...external.slice(0, 6), ...lines, 'more-0', 'more-1', 'more-2']) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }
  })
})

describe('a pull that reaches past the proven suffix', () => {
  /**
   * With twelve ordered positions behind it, a request of fourteen runs out of order: the first
   * twelve are named instances, and the remaining two come out of the counted front, whose
   * arrangement no collection can supply. Only the part inside the suffix may be consumed by
   * order; the rest is a count, not an instance list.
   */
  it('takes the suffix by order and counts only what lies beyond it', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const external = Array.from({ length: 10 }, (_, i) => `shell-${i}`)
    const emu = new Emulator(5, external.slice(0, 6))
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    const doc30 = { documentStart: 0, documentEnd: 30, frameStart: 0 }
    const holds = (row: string): number =>
      emu.scrollback.filter(entry => entry === row).length
      + emu.normalScreen().filter(entry => entry.trim() === row).length

    renderer.render({ lines, liveStart: 3, livePinned: true, documentRows: doc30 } as never)
    emu.resize(15)
    renderer.resize(80, 15)
    renderer.render({
      lines: lines.slice(15, 30), liveStart: 0, cursorVisible: false,
      transientSurface: 'scroll',
      documentRows: { documentStart: 15, documentEnd: 30, frameStart: 0 },
    } as never)
    renderer.render({ lines, liveStart: 15, livePinned: true, documentRows: doc30 } as never)
    expect(emu.scrollback).toEqual([
      ...external.slice(0, 6), ...lines.slice(0, 3), ...lines.slice(25, 30), '',
      ...lines.slice(3, 15),
    ])

    // A request of fourteen against a twelve-position suffix.
    emu.resize(29)
    renderer.resize(80, 29)
    expect(emu.scrollback).toEqual([
      ...external.slice(0, 6), ...lines.slice(0, 3), ...lines.slice(25, 29),
    ])
    expect(emu.normalScreen()).toEqual([
      'line-29', '', ...lines.slice(3, 15), ...lines.slice(15, 30),
    ])
    expect(emu.normalCursorRow()).toBe(28)

    // The grown document holds each row once.
    const grown = [...lines, ...Array.from({ length: 40 }, (_, i) => `more-${i}`)]
    renderer.render({
      lines: grown, liveStart: 41, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 70, frameStart: 0 },
    } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(grown.slice(41, 70))
    for (const row of [...external.slice(0, 6), ...lines, ...Array.from({ length: 11 }, (_, i) => `more-${i}`)]) {
      expect({ row, count: holds(row) }).toEqual({ row, count: 1 })
    }
  })
})

describe('consecutive grows while a reverse move is pending', () => {
  it.each([
    { extraHeights: [], paintBetween: false },
    { extraHeights: [20, 22], paintBetween: false },
    { extraHeights: [21, 24], paintBetween: true },
  ])('preserves every row across $extraHeights (paintBetween=$paintBetween)', ({ extraHeights, paintBetween }) => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const external = Array.from({ length: 10 }, (_, i) => `shell-${i}`)
    const emu = new Emulator(5, external.slice(0, 6))
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 5, alternateScreenOverlays: true },
    )
    const holds = (row: string): number =>
      emu.scrollback.filter(entry => entry === row).length
      + emu.normalScreen().filter(entry => entry.trim() === row).length

    renderer.render({
      lines, liveStart: 3, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 30, frameStart: 0 },
    } as never)
    emu.resize(15)
    renderer.resize(80, 15)
    renderer.render({
      lines: lines.slice(15, 30), liveStart: 0, cursorVisible: false, transientSurface: 'scroll',
      documentRows: { documentStart: 15, documentEnd: 30, frameStart: 0 },
    } as never)

    // The overlay goes up, the window grows once, and the overlay paints: a plan is left pending.
    renderer.render({ lines: ['overlay'], liveStart: 0, livePinned: true } as never)
    emu.resize(17)
    renderer.resize(80, 17)
    // Before any paint: what the terminal holds and what it shows after the grow.
    const afterFirst = [
      ...external.slice(0, 6), ...lines.slice(0, 3), ...lines.slice(25, 29),
    ]
    expect(emu.scrollback).toEqual(afterFirst)
    expect(emu.normalScreen()).toEqual(['line-29', '', ...lines.slice(15, 30)])
    expect(emu.normalCursorRow()).toBe(16)

    // The overlay repaint leaves the normal buffer exactly as it was.
    renderer.render({ lines: ['overlay', 'a'], liveStart: 0, livePinned: true } as never)
    expect(emu.altActive).toBe(true)
    expect(emu.scrollback).toEqual(afterFirst)
    expect(emu.normalScreen()).toEqual(['line-29', '', ...lines.slice(15, 30)])
    expect(emu.normalCursorRow()).toBe(16)

    // A second move arrives while that plan is still pending, then the overlay paints again.
    emu.resize(19)
    renderer.resize(80, 19)
    const afterSecond = [
      ...external.slice(0, 6), ...lines.slice(0, 3), ...lines.slice(25, 27),
    ]
    expect(emu.scrollback).toEqual(afterSecond)
    expect(emu.normalScreen()).toEqual([
      'line-27', 'line-28', 'line-29', '', ...lines.slice(15, 30),
    ])
    expect(emu.normalCursorRow()).toBe(18)

    // The overlay repaint after that second move leaves it unchanged too.
    renderer.render({ lines: ['overlay', 'b'], liveStart: 0, livePinned: true } as never)
    expect(emu.altActive).toBe(true)
    expect(emu.scrollback).toEqual(afterSecond)
    expect(emu.normalScreen()).toEqual([
      'line-27', 'line-28', 'line-29', '', ...lines.slice(15, 30),
    ])
    expect(emu.normalCursorRow()).toBe(18)

    for (const height of extraHeights) {
      emu.resize(height)
      renderer.resize(80, height)
      if (paintBetween) renderer.render({ lines: ['overlay', 'resized'], liveStart: 0 } as never)
    }
    const finalHeight = extraHeights.at(-1) ?? 19

    // Back to the document: committed rows stay in history exactly once. A taller
    // live viewport may also show those immutable snapshots' current counterparts.
    const grown = [...lines, ...Array.from({ length: 20 }, (_, i) => `more-${i}`)]
    renderer.render({
      lines: grown, liveStart: 33, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: 50, frameStart: 0 },
    } as never)
    expect(emu.normalScreen().filter(row => row !== '')).toEqual(grown.slice(50 - finalHeight))
    for (const row of [...external.slice(0, 6), ...lines, 'more-0', 'more-1', 'more-2']) {
      const documentRow = grown.indexOf(row)
      const inHistory = documentRow < 0 || documentRow < 50 - finalHeight
        || (documentRow >= 25 && documentRow < 30)
      const onScreen = documentRow >= 50 - finalHeight
      expect(emu.scrollback.filter(entry => entry === row)).toHaveLength(inHistory ? 1 : 0)
      expect({ row, count: holds(row) }).toEqual({ row, count: Number(inHistory) + Number(onScreen) })
    }
  })
})

describe('a browse frame after a protection scroll', () => {
  /**
   * The scroll blanks the window, so a later frame may not diff against the layout from
   * before it. A browse whose target happens to match the previous frame's cache would
   * otherwise find every row unchanged and paint nothing, while `#finishPaint` records the
   * target as drawn — a blank screen the renderer believes is correct.
   */
  it('paints the requested window rather than trusting the pre-scroll cache', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(5)
    for (const row of ['shell-0', 'shell-1', 'shell-2']) emu.write(`${row}\r\n`)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { width: 80, height: 5 })
    const at = (ls: readonly string[], live?: number): never => ({
      lines: ls, liveStart: live, livePinned: true,
      documentRows: { documentStart: 0, documentEnd: ls.length, frameStart: 0 },
    }) as never

    renderer.render(at(lines, 3))
    emu.resize(15)
    renderer.resize(80, 15)
    renderer.reflow(0)
    renderer.render(at(lines, 3))

    // A browse over the tail, whose rows are what the last frame already showed.
    renderer.render({
      lines: lines.slice(15),
      liveStart: 0,
      cursorVisible: false,
      transientSurface: 'scroll',
      documentRows: { documentStart: 15, documentEnd: 30, frameStart: 0 },
    } as never)

    expect(emu.normalScreen().filter(row => row !== '')).toEqual(lines.slice(15, 30))
  })
})

describe('a protection scroll and a rewritten document row', () => {
  /**
   * Two different rows, each owed its own commit: the old snapshot the protection scroll
   * moved back into history, and the new text the document now reads there. Both arrive
   * once each.
   *
   * It was red when written, and the cause was a **cursor-position divergence in the fake
   * terminal**, not a lost instance: the protection asked for a row past the bottom and
   * the model did not clamp the normal cursor, so the scroll pushed nothing into history.
   * Fixed on both sides. The real-terminal calibration of this sequence is still owed —
   * see the plan document — so this passing case is not yet independent-terminal evidence.
   *
   * The text-match gate decides **deduction**: the new row is not deducted, so it arrives
   * on its own. The instance itself is restored by the protection scroll regardless of
   * what the document reads now, because history is append-only and a later edit does not
   * erase the row it holds. An earlier version of this case asserted `line-0` as absent
   * and called that success; that read the contract backwards.
   *
   * What remains owed for this sequence is **independent-terminal calibration**, not a
   * missing half of the implementation.
   */
  it('does not deduct a row the document has since rewritten', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    const emu = new Emulator(5)
    for (const row of ['shell-0', 'shell-1', 'shell-2']) emu.write(`${row}\r\n`)

    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { width: 80, height: 5, alternateScreenOverlays: true },
    )
    const at = (ls: readonly string[], live?: number): never => ({
      lines: ls, liveStart: live, documentRows: { documentStart: 0, documentEnd: ls.length, frameStart: 0 },
    }) as never
    renderer.render(at(lines, 3))
    // The old row is committed before anything moves.
    expect(emu.scrollback.filter(entry => entry === 'line-0').length).toBe(1)

    renderer.render({ lines: ['ov-0', 'ov-1'], liveStart: 0, transientSurface: 'overlay' } as never)
    emu.resize(15)
    renderer.resize(80, 15)
    // Locked before any repaint: the grow pulled it back onto the screen.
    expect(emu.scrollback.filter(entry => entry === 'line-0').length).toBe(0)
    expect(emu.normalScreen().some(row => row.trim() === 'line-0')).toBe(true)

    renderer.render({ lines: ['ov-0', 'ov-1', 'ov-2'], liveStart: 0, transientSurface: 'overlay' } as never)

    // Return the document with its first row rewritten.
    const edited = ['replacement-0', ...lines.slice(1)]
    const grown = [...edited, ...Array.from({ length: 10 }, (_, i) => `more-${i}`)]
    renderer.render(at(grown, grown.length - 15))

    // Two different rows, each owed its own commit: the old snapshot the scroll moved
    // back into history, and the new text the document now reads there. Dropping the
    // old one to let the new one arrive is not the contract — history is append-only
    // and the row it holds is not erased by a later edit.
    expect(emu.scrollback.filter(entry => entry === 'replacement-0').length).toBe(1)
    expect(emu.scrollback.filter(entry => entry === 'line-0').length).toBe(1)
  })
})


describe('viewport prompt labels', () => {
  it('retains covered document rows when a pinned viewport shrinks', () => {
    const emu = new Emulator(8)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 8, synchronized: false })
    const rows = Array.from({ length: 30 }, (_, index) => `document-${index}`)
    const stickyHeaders = [{ start: 1, end: 40, text: 'Pinned prompt' }]
    renderer.render({ ...frame(rows.slice(0, 20), 20), stickyHeaders })
    emu.resize(6)
    renderer.resize(80, 6)
    renderer.render({ ...frame(rows.slice(0, 20), 20), stickyHeaders })
    renderer.render({ ...frame(rows, 30), stickyHeaders })
    const held = [...emu.scrollback, ...emu.normalScreen()]
    for (const row of rows.slice(0, 24)) expect(held.filter(value => value === row), row).toHaveLength(1)
  })

  it('paints labels over the viewport without committing them as document rows', () => {
    const emu = new Emulator(8)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 8, synchronized: false })
    const rows = Array.from({ length: 30 }, (_, index) => `document-${index}`)
    const stickyHeaders = [{ start: 1, end: 40, text: 'Pinned prompt' }]
    const first = { ...frame(rows.slice(0, 20), 20), stickyHeaders }
    renderer.render(first)
    expect(emu.normalScreen()[0]).toBe('Pinned prompt')
    const history = [...emu.scrollback]
    renderer.render(first)
    expect(emu.scrollback).toEqual(history)
    renderer.render({ ...frame(rows, 30), stickyHeaders })
    expect(emu.normalScreen()[0]).toBe('Pinned prompt')
    expect(emu.scrollback).not.toContain('Pinned prompt')
    for (const row of rows.slice(0, 22)) expect(emu.scrollback.filter(value => value === row)).toHaveLength(1)
    renderer.render(frame(rows, 30))
    expect(emu.normalScreen()[0]).toBe('document-22')
  })
})
