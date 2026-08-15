/**
 * Renderer contract tests: an ANSI screen emulator interprets the emitted
 * escape sequences and asserts the screen content matches the frame — the
 * externally observable contract, independent of escape-sequence internals.
 */
import { describe, expect, it } from 'vitest'
import { computeLineDiff, LineRenderer, sanitizeDisplayLine, type Frame } from './renderer.ts'

/** Minimal emulator for the escape grammar our renderer emits. */
class Screen {
  rows: string[] = []
  row = 0
  col = 0

  write(chunk: string): void {
    for (const token of chunk.match(/\x1b\[[?0-9;]*[ -/]*[@-~]|\r|\n|[^\r\n\x1b]+/g) ?? []) {
      if (token === '\r') {
        this.col = 0
      } else if (token === '\n') {
        this.row += 1
        this.rows[this.row] ??= ''
      } else if (token.startsWith('\x1b[')) {
        const params = token.slice(2, -1).replace(/^\?/u, '').split(';').map(value => Number(value || '1'))
        const n = params[0] ?? 1
        const op = token.slice(-1)
        if (op === 'A') this.row = Math.max(0, this.row - n)
        else if (op === 'B') this.row += n
        else if (op === 'C') this.col += n
        else if (op === 'D') this.col = Math.max(0, this.col - n)
        else if (op === 'H' || op === 'f') {
          this.row = Math.max(0, (params[0] ?? 1) - 1)
          this.col = Math.max(0, (params[1] ?? 1) - 1)
        }
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
  it('removes content-owned cursor controls while preserving SGR styles', () => {
    expect(sanitizeDisplayLine('safe\x1b[2A\x1b[31mred\x1b[0m\r\nnext')).toBe(
      'safe\x1b[31mred\x1b[0m  next',
    )
  })

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

  it('disables autowrap around exact-width paints to prevent phantom rows', () => {
    let captured = ''
    const renderer = new LineRenderer({ write: chunk => { captured += chunk } }, { synchronized: true })
    renderer.render({ lines: ['0123456789'], cursor: { row: 0, column: 0 } })

    expect(captured).toContain('\x1b[?2026h\x1b[?7l')
    expect(captured).toContain('\x1b[?7h\x1b[?2026l')
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

  it('reanchors after physical cursor drift so viewport indicators do not stack', () => {
    const screen = new Screen()
    const renderer = new LineRenderer(screen)
    renderer.render({
      lines: ['… ↑ 12 earlier lines', 'old body', '… ↓ 4 later lines', '> ', 'status'],
      cursor: { row: 3, column: 2 },
    })

    // A terminal integration, control sequence, or concurrent writer may move
    // the physical cursor without updating the renderer's cached position.
    screen.write('\x1b[1B')
    renderer.render({
      lines: ['… ↑ 9 earlier lines', 'new body', '… ↓ 7 later lines', '> ', 'status'],
      cursor: { row: 3, column: 2 },
    })

    expect(screen.rows.slice(0, 5)).toEqual([
      '… ↑ 9 earlier lines',
      'new body',
      '… ↓ 7 later lines',
      '> ',
      'status',
    ])
    expect(screen.rows.filter(row => row.includes('earlier lines'))).toHaveLength(1)
    expect(screen.rows.filter(row => row.includes('later lines'))).toHaveLength(1)
  })
})
