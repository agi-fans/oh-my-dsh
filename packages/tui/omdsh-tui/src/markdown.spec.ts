import { describe, expect, it } from 'vitest'
import { renderInline, renderMarkdown } from './markdown.ts'
import { createTheme } from './theme.ts'
import { stripAnsi, visibleWidth } from './width.ts'

const theme = createTheme(false)
const color = createTheme(true, true)
const plain = (source: string, width = 40): string =>
  renderMarkdown(source, theme, width).map(stripAnsi).join('\n')

describe('renderInline', () => {
  it('paints underscore emphasis, strikethrough, and markdown links', () => {
    expect(stripAnsi(renderInline('__bold__ and _italic_ and ~~old~~', theme))).toBe('bold and italic and old')
    expect(stripAnsi(renderInline('[docs](https://example.com)', theme))).toBe('docs (https://example.com)')
    expect(stripAnsi(renderInline('see https://example.com/x.', theme))).toBe('see https://example.com/x.')
  })

  it('does not italicize snake_case', () => {
    expect(renderInline('use foo_bar_baz here', theme)).toBe('use foo_bar_baz here')
  })

  it('wraps colored links in OSC 8', () => {
    const painted = renderInline('[docs](https://example.com)', color)
    expect(painted).toContain('\x1b]8;;https://example.com\x07')
    expect(painted).toContain('\x1b[4m')
    expect(painted).toContain('\x1b[38;2;0;136;250m')
  })
})

describe('renderMarkdown', () => {
  it('renders headings, lists, quotes, and emphasis', () => {
    const text = plain('# Title\n\n- one\n- two\n\n> quote\n\n**bold** and `code`')
    expect(text).toContain('Title')
    expect(text).toContain('• one')
    expect(text).toContain('│ quote')
    expect(text).toContain('bold')
    expect(text).toContain('code')
  })

  it('wraps a long paragraph to the requested width', () => {
    const lines = renderMarkdown('word '.repeat(20).trim(), theme, 16)
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(16)
    expect(lines.length).toBeGreaterThan(1)
  })

  it('nests lists, paints task boxes, and keeps + bullets', () => {
    const text = plain('- parent\n  - child\n+ plus\n- [ ] open\n- [x] done')
    expect(text).toContain('• parent')
    expect(text).toMatch(/ {2}• child/)
    expect(text).toContain('• plus')
    expect(text).toContain('☐ open')
    expect(text).toContain('☑ done')
  })

  it('renders a GFM table with rounded chrome', () => {
    const text = plain('| Name | N |\n| --- | ---: |\n| a | 1 |\n| b | 2 |')
    expect(text).toContain('╭')
    expect(text).toContain('Name')
    expect(text).toContain('a')
    expect(text).toContain('1')
    expect(text).toContain('┼')
    expect(text).toContain('╰')
  })

  it('labels a fenced code block with its language', () => {
    const text = plain('```ts\nconst x = 1\n```')
    expect(text).toContain('```ts')
    expect(text).toContain('const x = 1')
    expect(text.trim().endsWith('```')).toBe(true)
  })

  it('keeps every table and list line inside the width', () => {
    const lines = renderMarkdown(
      '| left | right |\n| --- | --- |\n| a longish cell | more |\n\n- [x] wrap this task item onto many columns',
      theme,
      24,
    )
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(24)
  })
})
