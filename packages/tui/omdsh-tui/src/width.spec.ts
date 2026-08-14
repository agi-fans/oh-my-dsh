import { describe, expect, it } from 'vitest'
import { cursorOnWrapped, expandTabs, indexOnWrapped, padToWidth, stripAnsi, truncateToWidth, visibleWidth, wrapIndexed, wrapText } from './width.ts'

describe('visibleWidth', () => {
  it('ignores SGR sequences', () => {
    expect(visibleWidth('\x1b[31mhi\x1b[0m')).toBe(2)
  })

  it('counts CJK as two cells', () => {
    expect(visibleWidth('你好')).toBe(4)
  })
})

describe('truncateToWidth', () => {
  it('preserves ANSI and appends an ellipsis', () => {
    const out = truncateToWidth('\x1b[31mhello world\x1b[0m', 8)
    expect(visibleWidth(out)).toBeLessThanOrEqual(8)
    expect(stripAnsi(out)).toContain('…')
  })
})

describe('expandTabs', () => {
  it('uses terminal tab stops without disturbing ANSI styling', () => {
    expect(expandTabs('\x1b[31m\tmodified\x1b[0m', 8, 2))
      .toBe('\x1b[31m      modified\x1b[0m')
  })
})

describe('wrapText', () => {
  it('wraps on word boundaries', () => {
    expect(wrapText('hello world friends', 8)).toEqual(['hello', 'world', 'friends'])
  })

  it('hard-wraps a word longer than the width', () => {
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })
})

describe('wrapIndexed + cursorOnWrapped', () => {
  it('maps a mid-line cursor onto the wrapped row', () => {
    const lines = wrapIndexed('abcdef', 3)
    expect(lines.map((line) => line.text)).toEqual(['abc', 'def'])
    expect(cursorOnWrapped(lines, 4, 'abcdef')).toEqual({ row: 1, column: 1 })
    expect(indexOnWrapped(lines[1]!, 1, 'abcdef')).toBe(4)
    expect(indexOnWrapped(lines[0]!, 0, 'abcdef')).toBe(0)
  })
})

describe('padToWidth', () => {
  it('pads a short line and truncates a long one', () => {
    expect(padToWidth('ab', 4)).toBe('ab  ')
    expect(visibleWidth(padToWidth('abcdef', 4))).toBe(4)
  })
})
