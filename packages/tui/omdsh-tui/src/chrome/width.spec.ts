import { describe, expect, it } from 'vitest'
import { cursorOnWrapped, expandTabs, hyperlinkAt, indexOnWrapped, padToWidth, restabilizeWrapSegments, sliceCells, stripAnsi, truncateToWidth, visibleWidth, wrapCode, wrapIndexed, wrapText, wrapTextStable } from './width.ts'
import { oracleWidth } from './width.oracle.ts'

describe('horizontal cell cropping', () => {
  it('keeps partial CJK and emoji clusters blank without shifting following cells', () => {
    expect(sliceCells('a中文🐳e\u0301z', 2, 6)).toBe(' 文🐳e\u0301')
    expect(sliceCells('🐳中文', 0, 1)).toBe(' ')
    expect(sliceCells('a👨‍👩‍👧‍👦b', 2, 2)).toBe(' b')
    expect(sliceCells('abc', 10, 4)).toBe('')
    for (const start of [0, 1, 2, 3, 4]) for (const width of [1, 2, 3, 4]) {
      expect(oracleWidth(sliceCells('a中文🐳e\u0301z', start, width))).toBeLessThanOrEqual(width)
    }
  })
  it('retains styles and hyperlinks while closing them before the next frame cell', () => {
    const row = '\x1b[31m\x1b]8;;https://example.com\x07abcdef\x1b]8;;\x07\x1b[0m'
    const cropped = sliceCells(row, 2, 2)
    expect(stripAnsi(cropped)).toBe('cd')
    expect(cropped).toContain('\x1b[31m')
    expect(cropped).toContain('\x1b]8;;https://example.com\x07')
    expect(cropped.endsWith('\x1b]8;;\x07\x1b[0m')).toBe(true)
    expect(sliceCells('\x1b[2Jabc', 1, 1)).toBe('b')
  })
})

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
  it('keeps plain truncated labels free of SGR sequences', () => {
    expect(truncateToWidth('Long task label', 6)).toBe('Long …')
    expect(truncateToWidth('后台任务正在运行', 7)).toBe('后台任…')
  })
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
  it('reopens the active foreground at each continuation and closes it at each break', () => {
    const segments = wrapText('\x1b[31m- const alphabetfoo = 1\x1b[39m', 10)
    const stable = restabilizeWrapSegments(segments)
    expect(stable.length).toBeGreaterThan(1)
    for (const line of stable) expect(line).toContain('\x1b[31m')
    expect(stable[0]).toBe(`${segments[0]}\x1b[39m`)
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

  it('restores underline, strike, and hyperlinks without carrying them past their closing escapes', () => {
    const link = '\x1b]8;;https://example.com\x07'
    const lines = restabilizeWrapSegments([
      link + '\x1b[4;9mfirst',
      'second\x1b[24;29m\x1b]8;;\x07',
      'plain',
    ])
    expect(lines[0]).toBe(link + '\x1b[4;9mfirst\x1b[24;29m\x1b]8;;\x07')
    expect(lines[1]).toBe(link + '\x1b[4m\x1b[9msecond\x1b[24;29m\x1b]8;;\x07')
    expect(lines[2]).toBe('plain')
  })

  it('closes underline and foreground before a line break without emitting a background reset', () => {
    const rows = wrapTextStable('\x1b[38;2;137;180;250m\x1b[4msidebar_document.rs\x1b[24m\x1b[39m', 18)
    expect(rows).toEqual([
      '\x1b[38;2;137;180;250m\x1b[4msidebar_document.r\x1b[24;39m',
      '\x1b[38;2;137;180;250m\x1b[4ms\x1b[24m\x1b[39m',
    ])
    expect(rows[0]).not.toContain('49')
  })

  it('processes every attribute in a combined reset', () => {
    const lines = restabilizeWrapSegments(['\x1b[4;9;31mstyled\x1b[39;24;29m', 'plain'])
    expect(lines[1]).toBe('plain')
  })
})

describe('wrapCode', () => {
  it('preserves indentation, repeated and trailing spaces across cell wraps', () => {
    const source = '    const  label = "中文🐳e\u0301";  '
    for (const width of [8, 16, 24]) {
      const lines = wrapCode(source, width)
      expect(lines.join('')).toBe(source)
      expect(lines.every(line => visibleWidth(line) <= width)).toBe(true)
    }
  })

  it('reopens token colors on every continuation and preserves empty rows', () => {
    const source = 'x'.repeat(35)
    const lines = wrapCode('\x1b[32m' + source + '\x1b[39m', 10)
    expect(lines.every(line => line.startsWith('\x1b[32m'))).toBe(true)
    expect(lines.map(stripAnsi).join('')).toBe(source)
    expect(wrapCode('one\n\nthree\n', 20)).toEqual(['one', '', 'three', ''])
  })
})

describe('wrapTextStable', () => {
  it('wraps and restabilizes in one call', () => {
    const lines = wrapTextStable('\x1b[32m+ const alphabetfoo = 1\x1b[39m', 10)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(line).toContain('\x1b[32m')
  })
})

describe('wrapTextStable', () => {
  const bold = (text: string): string => `\x1b[1m${text}\x1b[22m`
  const fg = (text: string): string => `\x1b[38;2;224;224;224m${text}\x1b[39m`

  it('reopens a style on every row, not just the first', () => {
    // The reported regression: a long tool command painted in one bold ink
    // showed the colour on its first wrapped row and dropped it on the rest,
    // because `wrapText` attaches escapes to the following glyph and never
    // synthesizes a reopening sequence at a break.
    const rows = wrapTextStable(bold(fg('aaaa bbbb cccc dddd eeee ffff gggg')), 14)
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) {
      expect(row, row).toContain('\x1b[38;2;224;224;224m')
      expect(row, row).toContain('\x1b[1m')
    }
  })

  it('keeps each row inside the width once the reopen sequences are added', () => {
    for (const width of [8, 12, 14, 20]) {
      for (const row of wrapTextStable(bold(fg('aaaa bbbb cccc dddd eeee ffff gggg')), width)) {
        expect(visibleWidth(row), `width ${width}: ${row}`).toBeLessThanOrEqual(width)
      }
    }
  })

  it('restores italic, underline, and inverse across a break', () => {
    const cases = ['\x1b[3mx\x1b[23m', '\x1b[4mx\x1b[24m', '\x1b[7mx\x1b[27m']
    for (const open of cases) {
      const attribute = open.slice(0, open.indexOf('m') + 1)
      const rows = wrapTextStable(`${attribute}aaaa bbbb cccc dddd eeee\x1b[m`, 10)
      expect(rows.length).toBeGreaterThan(1)
      for (const row of rows) expect(row, `${attribute} ${row}`).toContain(attribute)
    }
  })

  it('leaves plain text and single-row content untouched', () => {
    expect(wrapTextStable('short plain text', 40)).toEqual(['short plain text'])
    const single = bold(fg('fits'))
    expect(wrapTextStable(single, 40)).toEqual([single])
  })
})

it('closes a clipped OSC 8 link and pads around wide graphemes', () => {
  const open = '\x1b]8;;https://example.test/a b\x07'
  const close = '\x1b]8;;\x07'
  expect(truncateToWidth(open + 'long label' + close, 5)).toBe(open + 'long…' + close)
  expect(wrapTextStable(open + 'long label' + close, 5).map(stripAnsi)).toEqual(['long', 'label'])
  expect(padToWidth('中文', 2)).toBe('… ')
})

it('maps visual tab stops back to the original buffer indices', () => {
  const input = 'a\t🐳z'
  const rows = wrapIndexed(input, 12, 8)
  expect(cursorOnWrapped(rows, 2, input)).toEqual({ row: 0, column: 8 })
  expect(indexOnWrapped(rows[0]!, 5, input)).toBe(1)
  expect(indexOnWrapped(rows[0]!, 9, input)).toBe(2)
})

it('measures supplementary CJK, non-Latin combining marks, ZWSP, and text-presentation emoji accurately', () => {
  expect(visibleWidth('𠀀')).toBe(2)
  expect(visibleWidth('א\u05b8')).toBe(1)
  expect(visibleWidth('a\u200bb')).toBe(2)
  expect(visibleWidth('☀\uFE0E')).toBe(1)
  expect(visibleWidth('漢\uFE0E')).toBe(2)
  expect(visibleWidth('\u0301\uFE0E')).toBe(0)
  expect(visibleWidth('か\u3099')).toBe(2)
})

it('preserves trailing attributes in compound SGR without leaking reset inverse across wraps', () => {
  const rows = wrapTextStable('\x1b[7minv\x1b[0;38;2;255;0;0;4m aaaa bbbb cccc dddd\x1b[0m', 10)
  expect(rows.length).toBeGreaterThan(1)
  expect(rows[1]).toContain('\x1b[38;2;255;0;0m')
  expect(rows[1]).toContain('\x1b[4m')
  expect(rows[1]).not.toContain('\x1b[7m')
  expect(rows[1]).not.toContain('\x1b[0;38;2;')

  const bgRows = wrapTextStable('\x1b[38;2;12;13;14;48;5;35malpha beta gamma\x1b[0m', 8)
  expect(bgRows[1]).toContain('\x1b[38;2;12;13;14m')
  expect(bgRows[1]).toContain('\x1b[48;5;35m')

  const dimRows = wrapTextStable('\x1b[38;5;196;2malpha beta gamma\x1b[0m', 8)
  expect(dimRows[1]).toContain('\x1b[38;5;196m')
  expect(dimRows[1]).toContain('\x1b[2m')
})

it('does not emit a duplicate OSC 8 close when slicing past a closed hyperlink', () => {
  const line = '\x1b]8;;https://example.test\x07link\x1b]8;;\x07 tail'
  const sliced = sliceCells(line, 0, 9)
  expect(stripAnsi(sliced)).toBe('link tail')
  expect(sliced.match(/\x1b\]8;;\x07/g)).toHaveLength(1)
})

it('resolves OSC 8 hyperlinks by display column across CJK and wrapped rows', () => {
  const line = '中文 \x1b]8;;src/app.ts#L12\x07\x1b[4m文档.md\x1b[24m\x1b]8;;\x07 end'
  // "中"=0..1, "文"=2..3, " "=4, "文"=5..6, "档"=7..8, "."=9, "m"=10, "d"=11, " "=12
  expect(hyperlinkAt(line, 4)).toBeUndefined()
  expect(hyperlinkAt(line, 5)).toBe('src/app.ts#L12')
  expect(hyperlinkAt(line, 8)).toBe('src/app.ts#L12')
  expect(hyperlinkAt(line, 11)).toBe('src/app.ts#L12')
  expect(hyperlinkAt(line, 12)).toBeUndefined()
  expect(hyperlinkAt(line, -1)).toBeUndefined()
})

it('wraps large drafts in wrapIndexed without quadratic slowdown', () => {
  const text = 'word '.repeat(8_000)
  const rows = wrapIndexed(text, 80)
  expect(rows.length).toBeGreaterThan(400)
  expect(rows.at(-1)?.end).toBe(text.length)
})

it('wraps a massive unbroken word without overflowing the call stack', () => {
  const rows = wrapText('a'.repeat(1_200_000), 8)
  expect(rows).toHaveLength(150_000)
})
