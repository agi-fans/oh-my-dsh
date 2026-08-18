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

  it('normalizes HTML and renders inline/block math', () => {
    const text = plain('<p>Hello<br>world &amp; friends</p>\n$x^2 \\le 4$\n$$\n\\sum x^2\n$$')
    expect(text).toContain('Hello\nworld & friends')
    expect(text).toContain('x² ≤ 4')
    expect(text).toContain('∑ x²')
    expect(plain('Array<T>')).toContain('Array<T>')
  })

  it('renders Mermaid as a stable terminal text diagram', () => {
    const text = plain('```mermaid\ngraph TD\nA[Start] --> B[Done]\n```')
    expect(text).toContain('Start → Done')
    expect(text).not.toContain('AStart')
  })

  it('joins wrapped source lines into one paragraph', () => {
    const text = plain('The function now\nreturns a promise.')
    expect(text).toContain('The function now returns a promise.')
    expect(text).not.toContain('now\nreturns')
  })

  it('keeps markdown escapes and nested emphasis', () => {
    expect(plain('\\*not italic\\*')).toBe('*not italic*')
    expect(plain('**bold *italic* still**')).toBe('bold italic still')
  })

  it('continues a list item and keeps nested children', () => {
    const text = plain('- item\n  continued\n  - child')
    expect(text).toContain('• item continued')
    expect(text).toMatch(/ {2}• child/)
  })

  it('renders setext headings and reference links', () => {
    const text = plain('Title\n=====\n\nSee [docs][ref].\n\n[ref]: https://example.com')
    expect(text).toContain('Title')
    expect(text).toContain('docs (https://example.com)')
    expect(text).not.toContain('[ref]')
  })

  it('renders images as labeled links and leaves currency alone', () => {
    expect(plain('![diagram](https://img.example/x.png)')).toContain('diagram (https://img.example/x.png)')
    expect(plain('Cost is $5 and $10 today.')).toBe('Cost is $5 and $10 today.')
  })

  it('does not treat shell $(...) as math, and keeps $x^2$ as math', () => {
    expect(plain('run $(cat <<EOF) and $x^2$')).toContain('$(cat <<EOF)')
    expect(plain('run $(cat <<EOF) and $x^2$')).toContain('x²')
  })

  it('keeps headings on mdHeading when the surrounding style is body text', () => {
    const midnight = createTheme(true, true, 'midnight')
    const painted = renderMarkdown('# Title\n\nbody', midnight, 40, { color: 'text' }).join('\n')
    expect(painted).toContain(midnight.getFgAnsi('mdHeading'))
    expect(painted).toContain(midnight.getFgAnsi('text'))
    expect(painted.slice(0, painted.indexOf('Title'))).toContain(midnight.getFgAnsi('mdHeading'))
    expect(painted.slice(painted.indexOf('body') - 20)).toContain(midnight.getFgAnsi('text'))
  })

  it('keeps a surrounding thinking style after inline tokens', () => {
    const painted = renderMarkdown('note `pwd` and more', color, 40, { color: 'thinkingText', italic: true }).join('\n')
    const think = color.getFgAnsi('thinkingText')
    expect(painted).toContain('\x1b[3m')
    expect(painted).not.toContain('\x1b[2m')
    expect(painted).toContain(think)
    const afterCode = painted.slice(painted.indexOf('pwd'))
    expect(afterCode).toContain(think)
    expect(afterCode).toContain('more')
    expect(painted.slice(0, painted.indexOf('note'))).toContain(think)
    expect(painted.slice(painted.indexOf('pwd') - 20, painted.indexOf('pwd'))).toContain(think)
    expect(painted).not.toContain(color.getFgAnsi('mdLink'))
  })

  it('keeps thinking links and headings on thinkingText instead of body chrome', () => {
    const painted = renderMarkdown('see [docs](https://example.com)\n\n## Plan', color, 40, { color: 'thinkingText', italic: true }).join('\n')
    const think = color.getFgAnsi('thinkingText')
    expect(painted).toContain(think)
    expect(painted).not.toContain(color.getFgAnsi('mdLink'))
    expect(painted).not.toContain(color.getFgAnsi('mdHeading'))
    expect(painted).toContain('docs')
    expect(painted).toContain('Plan')
  })

  it('paints fence keywords with the syntax token instead of accent', () => {
    const painted = renderMarkdown('```ts\nconst x = 1\n```', color, 40).join('\n')
    expect(painted).toContain(color.getFgAnsi('mdKeyword'))
    expect(painted).not.toContain(color.getFgAnsi('accent') + 'const')
  })

  it('paints command codespans but not long backtick prose', () => {
    const painted = renderMarkdown('use `git commit -F` then `pwd, and drop a summary that` done', color, 80).join('\n')
    const code = color.getFgAnsi('mdCode')
    expect(painted).toContain(code)
    expect(painted).toContain('pwd, and drop a summary that')
    const after = painted.slice(painted.indexOf('pwd, and drop a summary that') - 20)
    expect(after).not.toContain(code + 'pwd')
  })
})
