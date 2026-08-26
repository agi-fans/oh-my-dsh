import { describe, expect, it } from 'vitest'
import { cursorOnWrapped, expandTabs, indexOnWrapped, padToWidth, restabilizeWrapSegments, stripAnsi, truncateToWidth, visibleWidth, wrapIndexed, wrapText, wrapTextStable } from './width.ts'

describe('visibleWidth', () => {
  it('ignores SGR sequences', () => {
    expect(visibleWidth('\x1b[31mhi\x1b[0m')).toBe(2)
  })

  it('counts CJK as two cells', () => {
    expect(visibleWidth('你好')).toBe(4)
  })

  it('counts terminal-wide emoji symbols as two cells', () => {
    expect(visibleWidth('✅⚡⭐')).toBe(6)
    expect(visibleWidth(padToWidth('ok ✅', 8))).toBe(8)
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

describe('restabilizeWrapSegments', () => {
  it('reopens the active foreground at each continuation', () => {
    const segments = wrapText('\x1b[31m- const alphabetfoo = 1\x1b[39m', 10)
    const stable = restabilizeWrapSegments(segments)
    expect(stable.length).toBeGreaterThan(1)
    for (const line of stable) expect(line).toContain('\x1b[31m')
    expect(stable[0]).toBe(segments[0])
  })

  it('reopens 256-color and truecolor foregrounds', () => {
    const seg256 = wrapText('\x1b[90m  context alphabetfoo = 1\x1b[39m', 12)
    for (const line of restabilizeWrapSegments(seg256)) expect(line).toContain('\x1b[90m')
    const segTc = wrapText('\x1b[38;2;1;2;3m  context alphabetfoo = 1\x1b[39m', 12)
    for (const line of restabilizeWrapSegments(segTc)) expect(line).toContain('\x1b[38;2;1;2;3m')
  })

  it('reopens inverse when it spans the break', () => {
    const painted = '\x1b[31m- const \x1b[39m\x1b[7malphabetfoobig\x1b[27m\x1b[31m = 1\x1b[39m'
    const stable = restabilizeWrapSegments(wrapText(painted, 12))
    // a continuation that is mid-inverse reopens 7m
    expect(stable.some(line => line.startsWith('\x1b[7m'))).toBe(true)
  })

  it('reopens bold and italic at continuations', () => {
    const painted = '\x1b[1mbold longword here\x1b[22m and \x1b[3mitalic longword here\x1b[23m'
    const stable = restabilizeWrapSegments(wrapText(painted, 8))
    expect(stable.some(line => line.startsWith('\x1b[1m'))).toBe(true)
    expect(stable.some(line => line.startsWith('\x1b[3m'))).toBe(true)
  })

  it('is a no-op for unstyled or single-row output', () => {
    expect(restabilizeWrapSegments(['only one'])).toEqual(['only one'])
    expect(restabilizeWrapSegments(['plain', 'plain two'])).toEqual(['plain', 'plain two'])
  })
})

describe('wrapTextStable', () => {
  it('wraps and restabilizes in one call', () => {
    const lines = wrapTextStable('\x1b[32m+ const alphabetfoo = 1\x1b[39m', 10)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(line).toContain('\x1b[32m')
  })
})
