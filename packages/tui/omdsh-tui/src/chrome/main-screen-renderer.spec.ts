/**
 * Main-screen renderer regression: committed transcript rows must enter native
 * scrollback once within a stable geometry epoch when the terminal is in
 * main-screen mode (no 1000/1006 mouse capture). The renderer appends new lines
 * and lets the terminal scroll; settled rows above the live seam are frozen.
 */
import { describe, expect, it } from 'vitest'
import { MainScreenRenderer } from './main-screen-renderer.ts'
import { initialTranscript, renderView } from '../views/event-views.ts'
import { foldPolicy } from '../session/fold-policy.ts'
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
  screen: string[] = []
  scrollback: string[] = []
  row = 0
  col = 0
  captured = ''
  writeCount = 0

  constructor(height: number, initialScrollback: readonly string[] = []) {
    this.height = height
    this.screen = Array.from({ length: height }, () => '')
    this.scrollback = [...initialScrollback]
  }

  write(chunk: string): void {
    this.captured += chunk
    this.writeCount += 1
    const tokens = chunk.match(/\x1b\[[?0-9;]*[ -/]*[@-~]|\r\n|\r|\n|[^\r\n\x1b]+/g) ?? []
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]!
      if (token === '\r\n' || token === '\n') {
        const cr = token === '\r\n'
        if (this.row === this.height - 1) {
          this.scrollback.push(this.screen[0] ?? '')
          for (let r = 0; r < this.height - 1; r += 1) this.screen[r] = this.screen[r + 1] ?? ''
          this.screen[this.height - 1] = ''
        } else {
          this.row += 1
        }
        if (cr) this.col = 0
      } else if (token === '\r') {
        this.col = 0
      } else if (token.startsWith('\x1b[')) {
        const final = token[token.length - 1]!
        const inner = token.slice(2, -1)
        if (final === 'h' || final === 'l') {
          // mode set/reset: ignore autowrap, cursor visibility, sync output
          continue
        }
        const params = inner.replace(/^\?/u, '').split(';').map(v => Number(v || '1'))
        const n = params[0] ?? 1
        if (final === 'A') this.row = Math.max(0, this.row - n)
        else if (final === 'B') this.row = Math.min(this.height - 1, this.row + n)
        else if (final === 'C') this.col += n
        else if (final === 'D') this.col = Math.max(0, this.col - n)
        else if (final === 'G') this.col = Math.max(0, n - 1)
        else if (final === 'H' || final === 'f') {
          this.row = Math.max(0, (params[0] ?? 1) - 1)
          this.col = Math.max(0, (params[1] ?? 1) - 1)
        } else if (final === 'K') {
          if (n === 0) this.screen[this.row] = (this.screen[this.row] ?? '').slice(0, this.col)
          else if (n === 1) this.screen[this.row] = (this.screen[this.row] ?? '').slice(this.col)
          else if (n === 2) this.screen[this.row] = ''
        } else if (final === 'J') {
          if (n === 0) {
            for (let r = this.row + 1; r < this.height; r += 1) this.screen[r] = ''
            this.screen[this.row] = (this.screen[this.row] ?? '').slice(0, this.col)
          } else if (n === 2 || n === 3) {
            for (let r = 0; r < this.height; r += 1) this.screen[r] = ''
            if (n === 3) this.scrollback = []
          }
        }
      } else {
        const current = this.screen[this.row] ?? ''
        const padded = current + ' '.repeat(Math.max(0, this.col - current.length))
        const before = padded.slice(0, this.col)
        const after = padded.slice(this.col + token.length)
        this.screen[this.row] = before + token + after
        this.col += token.length
      }
    }
  }

  visible(): string[] {
    return this.screen.map(row => row ?? '')
  }

  /** Simulate a terminal resize. */
  resize(height: number): void {
    const old = this.screen
    const oldHeight = old.length
    if (height === oldHeight) return
    this.height = height
    if (height < oldHeight) {
      const removed = old.slice(0, oldHeight - height)
      this.scrollback = [...this.scrollback, ...removed]
      this.screen = [...old.slice(oldHeight - height)]
      this.row = Math.min(this.row, height - 1)
    } else {
      const take = Math.min(height - oldHeight, this.scrollback.length)
      const top = this.scrollback.slice(this.scrollback.length - take)
      this.scrollback = this.scrollback.slice(0, this.scrollback.length - take)
      this.screen = [...top, ...old]
      this.row += take
    }
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

    // Simulate a real terminal resize that pulls existing scrollback rows down.
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
    // The resize render must not ED2/ED3, which would erase rows the terminal
    // pulled from native scrollback.
    const output = emu.outputAfter(mark)
    expect(output).not.toContain('\x1b[2J')
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
    const opened = doc(60)
    renderer.render(frame(opened, opened.length - 2))
    const settled = emu.scrollback.length
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))

    expect(emu.visible()).toEqual(closed.slice(-10))
    expect(emu.scrollback.length).toBe(settled)
  })

  it('keeps following the tail as the document grows again after a reflow', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
    const renderer = new MainScreenRenderer(emu, { height: 5 })
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
    const renderer = new MainScreenRenderer(emu, { height: 5 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
      fold: foldPolicy('standard'),
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
      fold: foldPolicy('standard'),
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
    const renderer = new MainScreenRenderer(emu, { height: 5 })
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

  it('honours the resize on the way back to the transcript', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer(
      { write: chunk => emu.write(chunk) },
      { height: 10, alternateScreenOverlays: true },
    )
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))
    const afterShrink = [...emu.scrollback]

    // Open an overlay, then the terminal is resized while it is up.
    renderer.render(frame(['overlay-title', 'overlay-body', 'overlay-more', 'overlay-end', ''], 0, { transientSurface: 'overlay' }))
    emu.resize(9)
    renderer.resize(80, 9)
    renderer.render(frame(['overlay-title', 'overlay-body', 'overlay-more', 'overlay-end', ''], 0, { transientSurface: 'overlay' }))
    renderer.render(frame(closed, closed.length - 2))

    // The row the terminal reclaimed is genuinely gone from history, and the
    // rest of the frozen head is not resubmitted.
    for (const row of ['head-8', 'head-9', 'head-10']) {
      expect(emu.scrollback.filter(entry => entry === row).length).toBeLessThanOrEqual(1)
    }
    expect(emu.scrollback.slice(0, afterShrink.length - 1)).toEqual(afterShrink.slice(0, -1))
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))

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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
  // Expanding a run by Δ moves both the mapped boundary and the viewport start
  // by Δ, so neither grows a gap and the choice is unobservable. A geometry
  // change does: a taller window pulls rows back down, moving the viewport
  // start without moving the document. So the sequence is freeze part of a long
  // answer, make the window taller, then open the run above it.
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
      fold: foldPolicy('standard'),
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height })

    // Freeze the first six displayed rows of the answer.
    renderer.render({ ...frame(closed.lines, closed.lines.length - 2), transcript: closed.transcript })
    expect(closed.lines[answerAt(closed.transcript)]).toContain('answer line 0')
    const frozen = [...emu.scrollback]

    // Taller: the viewport start moves down, the document does not. The mapped
    // boundary is now strictly above it, so whatever the mapper returns is used.
    emu.resize(height + 4)
    renderer.resize(80, height + 4)
    const taller = closed.lines
    renderer.render({ ...frame(taller, taller.length - 2), transcript: closed.transcript })
    // Compare against where history actually is now: the taller window pulled
    // four rows back down, so slicing from the pre-resize length would skip
    // exactly the window a wrong mapping would land in.
    const beforeGrowth = [...emu.scrollback]

    // Open the run above the answer; the answer moves down by more than the gap.
    const open = frameFor([key])
    // The run opening moved the answer down by more than the gap the taller
    // window opened, so the mapped boundary is strictly above the viewport
    // start and the mapper's choice is load-bearing rather than masked.
    const gap = 4
    expect(answerAt(open.transcript) - answerAt(closed.transcript)).toBeGreaterThanOrEqual(gap)
    renderer.reflow(1)
    renderer.render({ ...frame(open.lines, open.lines.length - 2), transcript: open.transcript })

    // Grow across the mapped boundary and check where new rows are committed.
    const grown = [...open.lines, ...Array.from({ length: 8 }, (_, i) => `tail-${i}`)]
    renderer.render(frame(grown, grown.length - 2))

    // The answer's frozen rows are not replayed, and no row is submitted twice.
    const stillFrozen = new Set(frozen)
    // Blank padding rows recur by design, so the check is over content.
    const stillContent = new Set(frozen.filter(row => row.trim() !== ''))
    const added = emu.scrollback.slice(beforeGrowth.length)
    expect(added.filter(row => stillContent.has(row.trim()))).toEqual([])
    // Blank padding rows legitimately recur, so uniqueness is over content.
    const content = emu.scrollback.map(row => row.trim()).filter(row => row !== '')
    expect(new Set(content).size).toBe(content.length)

    // And the positive half: committing resumes where the frozen part ends and
    // does not skip the rest of the answer. A mapping that landed on the
    // answer's tail, or froze too far, would pass every "nothing repeated"
    // assertion above while skipping the middle of what the reader has seen.
    //
    // Two mutations are killed here — selecting the first block outright, and
    // shifting the threshold past this block. A third, always selecting the
    // last block, still passes: on this input the last block starts after the
    // boundary, so both selections describe the same span. Distinguishing that
    // needs a case where the last block starts *before* the boundary, which is
    // a separate fixture rather than a longer version of this one.
    const committed = emu.scrollback.map(row => row.trim())
    expect(committed).toContain('answer line 0')
    // Committing resumes at the seventh displayed line rather than replaying
    // the six already frozen, and does not skip past the answer's end either.
    expect(committed).toContain('answer line 3')
    expect(committed).not.toContain('answer line 1')
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 5 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))

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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
    const opened = doc(30)
    renderer.render(frame(opened, opened.length - 2))
    const closed = doc(2)
    renderer.reflow()
    renderer.render(frame(closed, closed.length - 2))

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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 5 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 5 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
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
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 5 })
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

  it('commits the document row a shrink pushed below an overflow marker', () => {
    const emu = new Emulator(10)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 10 })
    const all = doc(40)
    // Freeze only the top, so the window below is still unfrozen: the rows the
    // terminal pushes have to be ones no earlier frame committed.
    renderer.render(frame(all, 8))
    // A window with an overflow marker at the top: the marker is not a document
    // row, and the shrink pushes it *and* the first document row below it.
    renderer.render({
      lines: ['… ↑ 4 earlier lines ⟨Pg↑⟩', ...all.slice(12, 20)],
      liveStart: 0, cursorVisible: false, transientSurface: 'scroll',
      documentRows: { documentStart: 12, documentEnd: 20, frameStart: 1 },
    })
    // Shrink by two: the marker is one physical row and the document row under
    // it is the other. With one row only the marker goes and nothing is proved
    // about the row below it.
    emu.resize(8)
    renderer.resize(80, 8)
    renderer.render(frame(all, all.length - 8))

    const content = emu.scrollback.map(row => row.replace(/\s+$/u, '')).filter(row => row !== '')
    // The marker names no document row; the one under it does, and the
    // terminal committed it. Crediting stops at the marker instead of skipping
    // it would leave that row to be sent a second time.
    const at12 = content.map((r, i) => r === 'line-12' ? i : -1).filter(i => i >= 0)
    // The terminal pushed the marker and the row under it; that row arrived
    // once, by the terminal's own move. Stopping at the marker instead of
    // skipping it would have left it for a flush and sent it twice.
    expect(content.filter(entry => entry === 'line-12').length).toBe(1)
    // The gap between the frozen boundary and the window is still committed.
    expect(content.filter(entry => entry === 'line-8').length).toBe(1)
  })

  it('commits content a shrink pushed past padding, and the row after it', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer({ write: chunk => emu.write(chunk) }, { height: 5 })
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

describe('MainScreenRenderer a boundary with two different deformations around it', () => {
  // Two deformations that differ — the run above grows, the run below shrinks —
  // so the last block and the answer do not move together. That is necessary for
  // the selection to be observable at all, but not sufficient: the boundary has
  // to land *inside* a member's span, and where it lands depends on how much of
  // the answer the terminal had already scrolled away. This fixture freezes
  // the answer's opening rows so the boundary falls inside it.
  //
  // What it still does not kill: "always select the last block". Measured on
  // this input the mapper picks the last block starting before the boundary,
  // and selecting the very last one returns the same row — the spans on either
  // side happen to end where the boundary is. Pinning that needs a frame whose
  // frozen boundary sits strictly inside a span *and* whose last block's span
  // ends elsewhere, which is recorded as a remaining gap rather than guessed at
  // by tuning lengths.
  const projection = (blockStarts: number[]) => ({
    start: 0, maxStart: 0, budget: 5, hiddenAbove: 0, hiddenBelow: 0, bodyRow: 0, blockStarts,
  })

  it('keeps the boundary at the same place in the answer when both sides move', () => {
    const emu = new Emulator(5)
    const renderer = new MainScreenRenderer(emu, { height: 5 })
    // Blocks: head(0..5), run A header(5) + member(6), answer(7..11), run B(12) + member(13).
    // The collapsed run owns its members, so several blocks share its header row.
    const closed = ['head-0', 'head-1', 'head-2', 'head-3', 'head-4', 'head-5',
      'runA', 'failA', 'a0', 'a1', 'a2', 'a3', 'a4', 'runB', 'failB', 'composer', 'footer']
    renderer.render({ ...frame(closed, closed.length - 2), transcript: projection([0, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7, 12, 13, 13, 15, 16]) })
    const frozen = [...emu.scrollback]
    expect(frozen.length).toBeGreaterThan(0)

    // Run A opens and grows; run B opens and loses rows. The answer between them
    // shifts by a different amount from either neighbour.
    const opened = ['head-0', 'head-1', 'head-2', 'head-3', 'head-4', 'head-5',
      'runA open', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'failA',
      'b0', 'b1', 'b2', 'b3', 'b4', 'failB', 'composer', 'footer']
    renderer.reflow(6)
    renderer.render({ ...frame(opened, opened.length - 2), transcript: projection([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]) })
    expect(emu.scrollback.slice(0, frozen.length)).toEqual(frozen)

    // Growth crosses the mapped boundary; the rows already frozen must not be
    // replayed, and the ones past them must arrive.
    const grown = [...opened, 'tail-0', 'tail-1', 'tail-2', 'composer', 'footer']
    renderer.render({ ...frame(grown, grown.length - 2), transcript: projection([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]) })

    // Every row carries its own name, so a repeated row means a replay rather
    // than two runs legitimately showing the same text.
    const content = emu.scrollback.map(row => row.trim()).filter(row => row !== '' && !row.startsWith('│') && !row.startsWith('╭') && !row.startsWith('╰'))
    expect(new Set(content).size).toBe(content.length)
    for (const row of ['head-0', 'head-1']) {
      expect(content.filter(entry => entry === row).length).toBe(1)
    }
  })
})
