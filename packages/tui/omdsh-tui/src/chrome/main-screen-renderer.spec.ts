/**
 * Main-screen renderer regression: committed transcript rows must enter native
 * scrollback once within a stable geometry epoch when the terminal is in
 * main-screen mode (no 1000/1006 mouse capture). The renderer appends new lines
 * and lets the terminal scroll; settled rows above the live seam are frozen.
 */
import { describe, expect, it } from 'vitest'
import { MainScreenRenderer } from './main-screen-renderer.ts'
import type { Frame } from './renderer.ts'

/**
 * Minimal VT-style emulator with a fixed-height screen and a scrollback buffer.
 * Interprets only the escape sequences our renderer emits: cursor movement,
 * line clear, screen clear, and carriage return / newline (which scroll when
 * the cursor is on the bottom row).
 */
class Emulator {
  readonly height: number
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

function frame(
  lines: readonly string[],
  liveStart?: number,
  extras: { cursor?: { row: number; column: number }; cursorVisible?: boolean; livePinned?: boolean } = {},
): Frame {
  return { lines, liveStart, ...extras }
}

function joined(lines: readonly string[]): string {
  return lines.join('\n')
}

describe('MainScreenRenderer', () => {
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
    // prefix that extends well above the visible tail. replaceSession/clear are
    // signaled explicitly so stale native history is erased first.
    const replacement = Array.from({ length: 20 }, (_, i) => `new-${i}`)
    renderer.startEpoch()
    // A restored durable log can retain an orphaned pending seam near its
    // beginning. Replacement still replays every historical row.
    renderer.render(frame(replacement, 2))
    // The full off-screen prefix must have been written once and the visible
    // tail (new-15..new-19) must be on screen.
    expect(emu.scrollback).toEqual(replacement.slice(0, 15))
    expect(emu.visible()).toEqual(replacement.slice(15, 20))

    // Append within the new epoch must continue from the new baseline, not
    // replay the new frozen prefix.
    renderer.render(frame([...replacement, 'new-20', 'new-21'], 20))
    expect(emu.scrollback).toEqual(replacement.slice(0, 17))
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

  it('clears stale native history before replaying a replacement epoch', () => {
    const emu = new Emulator(4)
    const renderer = new MainScreenRenderer(emu, { width: 80, height: 4, synchronized: false })

    renderer.render(frame(['HEADER', 'composer'], 0))
    expect(emu.scrollback).toEqual([])

    renderer.startEpoch()
    renderer.render(frame(['HEADER', 'message-1', 'message-2', 'message-3', 'composer'], 5))
    expect(emu.captured).toContain('\x1b[3J')
    expect(emu.scrollback).toEqual(['HEADER'])
    expect(emu.visible()).toEqual(['message-1', 'message-2', 'message-3', 'composer'])
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
