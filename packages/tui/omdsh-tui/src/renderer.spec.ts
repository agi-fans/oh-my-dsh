/**
 * Renderer contract tests: an ANSI screen emulator interprets the emitted
 * escape sequences and asserts the screen content matches the frame — the
 * externally observable contract, independent of escape-sequence internals.
 */
import { describe, expect, it } from 'vitest'
import { computeLineDiff, LineRenderer, type Frame } from './renderer.ts'

/** Minimal emulator for the escape grammar our renderer emits. */
class Screen {
  rows: string[] = []
  row = 0
  col = 0

  write(chunk: string): void {
    for (const token of chunk.match(/\x1b\[\d*[ABCDK]|\r|\n|[^\r\n\x1b]+/g) ?? []) {
      if (token === '\r') {
        this.col = 0
      } else if (token === '\n') {
        this.row += 1
        this.rows[this.row] ??= ''
      } else if (token.startsWith('\x1b[')) {
        const n = Number(token.slice(2, -1) || '1')
        const op = token.slice(-1)
        if (op === 'A') this.row = Math.max(0, this.row - n)
        else if (op === 'B') this.row += n
        else if (op === 'C') this.col += n
        else if (op === 'D') this.col = Math.max(0, this.col - n)
        else if (op === 'K') this.rows[this.row] = (this.rows[this.row] ?? '').slice(0, this.col)
        this.rows[this.row] ??= ''
      } else {
        const current = this.rows[this.row] ?? ''
        this.rows[this.row] = (current + ' '.repeat(Math.max(0, this.col - current.length))).slice(0, this.col) + token
        this.col = this.rows[this.row]!.length
      }
    }
  }
}

/** Render a sequence of frames and return the emulated screen rows. */
function renderSequence(frames: Frame[]): string[] {
  const screen = new Screen()
  const renderer = new LineRenderer(screen)
  for (const frame of frames) renderer.render(frame)
  return screen.rows.slice(0, frames.at(-1)?.lines.length).map((row) => row ?? '')
}

const f = (lines: string[]): Frame => ({ lines })
const withCursor = (lines: string[], column = 2): Frame => ({ lines, cursor: { row: lines.length - 1, column } })

describe('computeLineDiff', () => {
  it('appends without touching existing rows', () => {
    const diff = computeLineDiff(['a', 'b'], ['a', 'b', 'c'])
    expect(diff.writes).toEqual([{ row: 2, text: 'c' }])
    expect(diff.clears).toEqual([])
  })

  it('rewrites only the changed middle row', () => {
    const diff = computeLineDiff(['a', 'b', 'c'], ['a', 'x', 'c'])
    expect(diff.writes).toEqual([{ row: 1, text: 'x' }])
    expect(diff.clears).toEqual([])
  })

  it('clears rows when the frame shrinks', () => {
    const diff = computeLineDiff(['a', 'b', 'c', 'd'], ['a', 'x'])
    expect(diff.writes).toEqual([{ row: 1, text: 'x' }])
    expect(diff.clears).toEqual([2, 3])
  })

  it('rewrites the tail when the frame grows (shifted rows are not skipped)', () => {
    const diff = computeLineDiff(['user', '> '], ['user', 'assistant', '> '])
    expect(diff.writes).toEqual([
      { row: 1, text: 'assistant' },
      { row: 2, text: '> ' },
    ])
    expect(diff.clears).toEqual([])
  })

  it('is a no-op diff for identical frames', () => {
    const diff = computeLineDiff(['a', 'b'], ['a', 'b'])
    expect(diff).toEqual({ writes: [], clears: [] })
  })
})

describe('LineRenderer', () => {
  it('renders an initial frame', () => {
    expect(renderSequence([f(['one', 'two'])])).toEqual(['one', 'two'])
  })

  it('appends lines across frames', () => {
    expect(renderSequence([f(['a']), f(['a', 'b']), f(['a', 'b', 'c'])])).toEqual(['a', 'b', 'c'])
  })

  it('updates a middle line in place', () => {
    expect(renderSequence([f(['a', 'b', 'c']), f(['a', 'X', 'c'])])).toEqual(['a', 'X', 'c'])
  })

  it('shrinks the frame and clears stale rows', () => {
    expect(renderSequence([f(['a', 'b', 'c', 'd']), f(['a', 'x'])])).toEqual(['a', 'x'])
  })

  it('handles empty frames and re-growth', () => {
    expect(renderSequence([f([]), f(['a']), f([]), f(['a', 'b'])])).toEqual(['a', 'b'])
  })

  it('moves the cursor to the requested input position', () => {
    const screen = new Screen()
    const renderer = new LineRenderer(screen)
    renderer.render({ lines: ['a', 'b', 'c'], cursor: { row: 2, column: 1 } })
    expect(screen.row).toBe(2)
    expect(screen.col).toBe(1)
  })

  it('hides the physical cursor for selection overlays and restores it afterward', () => {
    let captured = ''
    const renderer = new LineRenderer({ write: chunk => { captured += chunk } })
    renderer.render({ lines: ['settings'], cursor: { row: 0, column: 0 }, cursorVisible: false })
    expect(captured).toContain('\x1b[?25l')
    captured = ''
    renderer.render({ lines: ['settings'], cursor: { row: 0, column: 1 }, cursorVisible: false })
    expect(captured).not.toContain('\x1b[?25l')
    renderer.render({ lines: ['editor'], cursor: { row: 0, column: 1 } })
    expect(captured).toContain('\x1b[?25h')
  })

  it('keeps frames aligned when each render ends on the input line', () => {
    // The tty path requests the cursor on the last (input) row after every
    // render; the next diff must be computed from that position, not from
    // the post-frame row.
    expect(renderSequence([
      withCursor(['─ flash · idle', '> ']),
      withCursor(['─ pro · idle', '> ']),
    ])).toEqual(['─ pro · idle', '> '])
  })

  it('rewrites a middle row while the cursor sits on the input line', () => {
    expect(renderSequence([
      withCursor(['user', 'a', 'b', 'c', '> '], 3),
      withCursor(['user', 'a', 'X', 'c', '> '], 3),
    ])).toEqual(['user', 'a', 'X', 'c', '> '])
  })

  it('appends blocks while the cursor sits on the input line', () => {
    expect(renderSequence([
      withCursor(['> ']),
      withCursor(['user', '> ']),
      withCursor(['user', 'assistant', '> ']),
    ])).toEqual(['user', 'assistant', '> '])
  })

  it('follows a moved input cursor on an otherwise identical frame', () => {
    const screen = new Screen()
    const renderer = new LineRenderer(screen)
    renderer.render(withCursor(['a', '> x'], 3))
    renderer.render(withCursor(['a', '> x'], 2))
    expect(screen.rows.slice(0, 2)).toEqual(['a', '> x'])
    expect(screen.row).toBe(1)
    expect(screen.col).toBe(2)
  })

  it('shrinks and clears stale rows after input-line cursor renders', () => {
    expect(renderSequence([
      withCursor(['a', 'b', 'c', 'd', '> '], 2),
      withCursor(['a', 'x', '> '], 2),
    ])).toEqual(['a', 'x', '> '])
  })

  it('never scrolls when the frame exactly fills the terminal height', () => {
    const screen = new Screen()
    const renderer = new LineRenderer(screen)
    const height = 5
    renderer.render(withCursor(['a', 'b', 'c', 'd', '> '], 2))
    renderer.render(withCursor(['a', 'X', 'c', 'd', '> '], 2))
    // A trailing newline past the bottom row would have grown the screen.
    expect(screen.rows.length).toBeLessThanOrEqual(height)
    expect(screen.rows.slice(0, height)).toEqual(['a', 'X', 'c', 'd', '> '])
  })
})
