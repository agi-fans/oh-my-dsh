import { describe, expect, it } from 'vitest'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import { highlightCells, TextSelection } from './text-selection.ts'

const point = (row: number, column: number) => ({ row, column })

describe('TextSelection', () => {
  it('copies forward and reverse cross-line selections without ANSI or trailing padding', () => {
    for (const reverse of [false, true]) {
      const selection = new TextSelection()
      const rows = ['\x1b[31mhello world\x1b[0m   ', '  second line   ']
      const first = point(0, 6), last = point(1, 7)
      selection.begin(rows, reverse ? last : first)
      selection.move(reverse ? first : last)
      expect(selection.release(reverse ? first : last)).toBe('world\n  second')
      expect(selection.paint(rows).map(stripAnsi)).toEqual(rows.map(stripAnsi))
    }
  })

  it.each(['中', '🐳', '👩🏽‍💻', '🇨🇳', 'e\u0301'])('keeps the %s grapheme whole when selected by display cells', glyph => {
    const selection = new TextSelection()
    const rows = [`a${glyph}`]
    const lastCell = visibleWidth(glyph)
    selection.begin(rows, point(0, lastCell + 1))
    selection.move(point(0, 1))
    expect(selection.release(point(0, 1))).toBe(glyph)
    expect(selection.paint(rows)[0]).toContain(`\x1b[7m${glyph}\x1b[27m`)
  })

  it('selects paths on double click and complete lines on triple click', () => {
    const selection = new TextSelection()
    const rows = ['  src/hello-world.ts more   ']
    const p = point(0, 6)
    selection.begin(rows, p, 1000)
    expect(selection.release(p)).toBeUndefined()
    selection.begin(rows, p, 1100)
    expect(selection.release(p)).toBe('src/hello-world.ts')
    selection.begin(rows, p, 1200)
    expect(selection.release(p)).toBe('  src/hello-world.ts more')
  })

  it('invalidates changed selected rows but accepts new styles and updates outside the selection', () => {
    const selection = new TextSelection()
    selection.begin(['hello', 'footer'], point(0, 0))
    selection.move(point(0, 4))
    expect(selection.valid(['\x1b[32mhello\x1b[0m', 'new footer'])).toBe(true)
    expect(selection.paint(['changed', 'footer'])).toEqual(['changed', 'footer'])
    expect(selection.active).toBe(false)
    expect(selection.text()).toBeUndefined()
  })

  it('extends from the existing anchor on Shift press', () => {
    const selection = new TextSelection()
    selection.begin(['hello world'], point(0, 0))
    selection.release(point(0, 4))
    selection.begin(['hello world'], point(0, 10), 1000, true)
    expect(selection.release(point(0, 10))).toBe('hello world')
  })

  it('does not copy empty padding or a stationary single click', () => {
    const selection = new TextSelection()
    selection.begin(['hello   '], point(0, 1))
    expect(selection.release(point(0, 1))).toBeUndefined()
    selection.begin(['hello   '], point(0, 6))
    expect(selection.release(point(0, 7))).toBeUndefined()
  })
})

describe('highlightCells', () => {
  it('reapplies selection after styled resets and keeps OSC links and cell widths intact', () => {
    const line = '\x1b]8;;https://example.com\x07a\x1b[31m中\x1b[0me\u0301🐳z\x1b]8;;\x07'
    const painted = highlightCells(line, 2, 6)
    expect(stripAnsi(painted)).toBe(stripAnsi(line))
    expect(visibleWidth(painted)).toBe(visibleWidth(line))
    expect(painted).toContain('\x1b[0m\x1b[7m')
    expect(painted).toContain('\x1b[27mz')
  })

  it('keeps a combining grapheme selected across an ANSI reset inside the cluster', () => {
    const line = 'e\x1b[0m\u0301z'
    const painted = highlightCells(line, 0, 1)
    expect(painted).toContain('e\x1b[0m\x1b[7m\u0301\x1b[27mz')
    expect(stripAnsi(painted)).toBe('e\u0301z')
  })

  it('preserves an existing inverse style after a selected span', () => {
    const line = '\x1b[7mabc\x1b[27m def'
    expect(stripAnsi(highlightCells(line, 1, 2))).toBe('abc def')
    expect(highlightCells(line, 1, 2)).not.toContain('\x1b[27mc')
  })
})
