import { describe, expect, it } from 'vitest'
import { renderInline, renderMarkdown } from './markdown.ts'
import { createTheme } from './theme.ts'
import { stripAnsi, visibleWidth } from './width.ts'
import { oracleWidth } from './width.oracle.ts'

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
    expect(painted).toContain(color.getFgAnsi('mdLink'))
  })
})

describe('renderMarkdown', () => {
  it('preserves HTML, entities and literal emphasis in code', () => {
    expect(plain('```html\n<div>Hello &amp; goodbye</div>\n```')).toContain('<div>Hello &amp; goodbye</div>')
    expect(plain('`<span>label &lt; x</span>`')).toBe('<span>label &lt; x</span>')
    expect(plain('    <div>Hello</div>')).toContain('<div>Hello</div>')
    expect(plain('`******`')).toBe('******')
    expect(plain('`first\n****** &amp; <div>`')).toBe('first ****** &amp; <div>')
    expect(plain('```text\nconst ticks = "```"\n****** &amp; <div>\n```')).toContain('****** &amp; <div>')
    expect(plain('    ' + ' '.repeat(30) + '******')).toContain(' '.repeat(30) + '******')
  })

  it('keeps unsupported and incomplete formulas verbatim instead of converting fragments', () => {
    expect(plain('$x^{2k}$')).toBe('x²ᵏ')
    expect(plain('$\\alpha + \\unknown{x}$')).toBe('$\\alpha + \\unknown{x}$')
    expect(plain('\\(x^2 + \\frac{1}')).toBe('\\(x^2 + \\frac{1}')
    expect(plain('$x^2 + \\frac{1}')).toBe('$x^2 + \\frac{1}')
    expect(plain('$x^{ab}$')).toBe('x^(ab)')
    expect(plain('$\\unknown{********}$')).toBe('$\\unknown{********}$')
    expect(plain('$\\unknown{`******`}$')).toBe('$\\unknown{`******`}$')
  })

  it('lets source mode retain complete math delimiters in colored and plain replies', () => {
    for (const colors of [false, true]) {
      const rows = renderMarkdown('Inline $x^2$.\n\n$$\n\\frac{a}{b}\n$$', createTheme(colors), 60, { mathMode: 'source' })
      expect(rows.map(stripAnsi).join('\n')).toContain('Inline $x^2$.')
      expect(rows.map(stripAnsi).join('\n')).toContain('$$\n  \\frac{a}{b}\n  $$')
      expect(rows.every(row => oracleWidth(row) <= 60)).toBe(true)
    }
  })

  it('lays out display fractions and preserves source when the layout does not fit', () => {
    const source = '$$\n\\frac{a+b}{c}\n$$'
    const lines = renderMarkdown(source, theme, 30).map(stripAnsi)
    expect(lines.map(line => line.trim())).toEqual(['a+b', '───', 'c'])
    expect(plain(source, 2).replaceAll('\n', '')).toContain('\\frac')
  })

  it('resolves Mermaid labels across declarations and retains edge labels', () => {
    const text = plain('```mermaid\nflowchart TD\nA[Start]\nB{Check}\nC[Done]\nA --> B\nB -->|yes| C\nB -->|no| A\n```')
    for (const label of ['Start', 'Check', 'Done', 'yes', 'no']) expect(text).toContain(label)
    expect(text).not.toContain('-->')
    expect(text).not.toContain('BDone')
  })

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
    expect(text).toContain('○ open')
    expect(text).toContain('✔ done')
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

  it.each([false, true])('aligns table columns in display cells (colors=%s)', (colors) => {
    const source = '| Left | Middle | Right |\n| :--- | :---: | ---: |\n| a | x | 9 |\n| 中 | 🐳 | 100 |'
    const lines = renderMarkdown(source, createTheme(colors), 40).map(stripAnsi)
    const row = lines.find(line => line.includes('│ a '))!
    expect(row.split('│').slice(1, -1)).toEqual([' a    ', '   x    ', '     9 '])
    const wide = lines.find(line => line.includes('│ 中 '))!
    expect(wide.split('│').slice(1, -1)).toEqual([' 中   ', '   🐳   ', '   100 '])
  })

  it.each([false, true])('keeps wide graphemes, multiline cells, and links within table columns (colors=%s)', (colors) => {
    const source = '| 中文 | Emoji | Link |\n| --- | :---: | ---: |\n| 长内容<br>短 | 🐳👩‍💻e\u0301 | [documentation](https://example.com) |'
    for (let width = 12; width <= 45; width += 1) {
      const lines = renderMarkdown(source, createTheme(colors), width)
      expect(lines.every(line => oracleWidth(line) <= width), `width=${width}`).toBe(true)
      expect(stripAnsi(lines.join('\n'))).toContain('🐳')
      // A bordered table has equally wide borders and wrapped data rows.
      if (stripAnsi(lines[0] ?? '').startsWith('╭')) {
        const tableWidth = oracleWidth(lines[0]!)
        expect(lines.every(line => oracleWidth(line) === tableWidth), `width=${width}`).toBe(true)
      }
    }
  })

  it('closes styles and hyperlinks before table padding and restores them on continuation rows', () => {
    const lines = renderMarkdown('| Link | Plain |\n| --- | --- |\n| [abcdefghijkabcdefghijkabcdefghijk](https://example.com) | x |', color, 38)
    const linkRows = lines.filter(line => /^[a-k]+$/u.test(stripAnsi(line).split('│')[1]?.trim() ?? ''))
    expect(linkRows.length).toBeGreaterThan(1)
    for (const line of linkRows) {
      expect(line).toContain('\x1b]8;;https://example.com\x07')
      expect(line).toContain('\x1b[4m')
      expect(line).toContain('\x1b[22;23;24;27;29;39m\x1b]8;;\x07')
    }
  })

  it('keeps the original table delimiters in the narrow-screen fallback', () => {
    const text = plain('| A | B | C |\n| :--- | :---: | ---: |\n| a | b | c |', 5)
    expect(text.replaceAll('\n', '')).toContain(':---:')
    expect(text.replaceAll('\n', '')).toContain('---:')
  })

  it.each([false, true])('uses labelled records when table columns cannot stay readable (colors=%s)', colors => {
    const source = '| Name | Count | State |\n| --- | ---: | --- |\n| 文件🐳 | 123 | ready |\n| Other | 456 | done |'
    const lines = renderMarkdown(source, createTheme(colors), 18)
    const text = lines.map(stripAnsi).join('\n')
    expect(text).toContain('Name: 文件🐳')
    expect(text).toContain('Count: 123')
    expect(text).toContain('State: ready')
    expect(text).toContain('Count: 456')
    expect(lines.every(line => oracleWidth(line) <= 18)).toBe(true)
    expect(text).not.toContain('╭')
  })

  it('sets a fenced code block behind a rail, without its fences', () => {
    // The fences are syntax, not content; printed, they made every block look
    // like a render that had not finished.
    const text = plain('```ts\nconst x = 1\n```')
    expect(text).toContain('│ const x = 1')
    expect(text).not.toContain('```')
  })

  it('keeps the rail on every wrapped row of a long code line', () => {
    const lines = renderMarkdown('```\n' + 'x'.repeat(40) + '\n```', theme, 20).map(stripAnsi)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(line.startsWith('  │ ')).toBe(true)
      expect(visibleWidth(line)).toBeLessThanOrEqual(20)
    }
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
    expect(text).toContain('Start')
    expect(text).toContain('Done')
    expect(text).toMatch(/[┌╭╔]/u)
    expect(text).not.toContain('-->')
    expect(text).not.toContain('AStart')
  })

  it.each([false, true])('retains Mermaid source for preferences, incomplete fences and narrow viewports (colors=%s)', colors => {
    const source = 'graph TD\nA[开始 🐳] --> B[结束]'
    const fenced = '```mermaid\n' + source + '\n```'
    const paint = (input: string, width = 80, style = {}) => renderMarkdown(input, createTheme(colors), width, style).map(stripAnsi).join('\n')
    expect(paint(fenced, 80, { mermaidMode: 'source' })).toContain('A[开始 🐳] --> B[结束]')
    expect(paint(fenced, 80, { color: 'thinkingText' })).toContain('-->')
    expect(paint('```mermaid\n' + source)).toContain('-->')
    expect(paint('````mermaid\n' + source + '\n```')).toContain('-->')
    expect(paint(fenced, 10)).toContain('graph')
    for (const width of [1, 4, 10, 80]) {
      const rows = renderMarkdown(fenced, createTheme(colors), width)
      expect(rows.every(row => oracleWidth(row) <= width)).toBe(true)
    }
    expect(paint(fenced)).not.toContain('-->')
    expect(paint('~~~~mermaid\n' + source + '\n~~~~')).not.toContain('-->')
    expect(paint('```mermaid\ngraph TD\nA[Start --> B\n```')).toContain('A[Start --> B')
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

  it('sets a heading in bold and its own level markers, never underlined', () => {
    // Underline sits on the baseline and crowds a line of prose. Every level says
    // what it is with `#` markers instead, so H1 and H2 do not need a second
    // signal that only they can use.
    const painted = renderMarkdown('# one\n\n## two\n\n### three', color, 40)
    for (const [index, line] of painted.entries()) {
      expect(line, `line ${index}`).not.toMatch(/\x1b\[4m/u)
      expect(line).toContain(color.getFgAnsi('mdHeading'))
      expect(line).toMatch(/\x1b\[1m/u)
    }
    // Each level keeps its own marker, so the outline survives without underline.
    const text = stripAnsi(painted.join('\n'))
    expect(text).toContain('# one')
    expect(text).toContain('## two')
    expect(text).toContain('### three')
  })

  it('keeps headings on mdHeading when the surrounding style is body text', () => {
    const light = createTheme(true, true, 'light')
    const painted = renderMarkdown('# Title\n\nbody', light, 40, { color: 'text' }).join('\n')
    expect(painted).toContain(light.getFgAnsi('mdHeading'))
    expect(painted).toContain(light.getFgAnsi('text'))
    expect(painted.slice(0, painted.indexOf('Title'))).toContain(light.getFgAnsi('mdHeading'))
    expect(painted.slice(painted.indexOf('body') - 20)).toContain(light.getFgAnsi('text'))
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

  it('paints every codespan as code, whatever its shape', () => {
    // Inline code answers one question — "is this code" — so it has one ink. The
    // two-word threshold used to send a phrase to `muted`, which made inline code
    // grey in one length and violet in another with no reading benefit.
    const painted = renderMarkdown('use `git commit -F` then `pwd, and drop a summary that` done', color, 80).join('\n')
    const code = color.getFgAnsi('mdCode')
    expect(painted.split(code).length - 1).toBe(2)
    expect(painted).toContain('pwd, and drop a summary that')
    expect(painted).not.toContain(color.getFgAnsi('muted') + 'pwd')
  })
})

describe('pathological nesting', () => {
  it('renders deeply nested markdown instead of overflowing the stack', () => {
    const nested: readonly string[] = [
      '> '.repeat(2000) + 'deep',
      Array.from({ length: 2000 }, (_, i) => '  '.repeat(i) + '- item').join('\n'),
      '*'.repeat(5000) + 'x' + '*'.repeat(5000),
    ]
    for (const source of nested) {
      expect(() => renderMarkdown(source, theme, 80)).not.toThrow()
    }
    expect(plain('> '.repeat(2000) + 'deep', 80)).toContain('deep')
  })

  it('keeps fenced code bytes out of the nesting clamp', () => {
    const run = '*'.repeat(40)
    expect(plain('```\n' + run + '\n```', 80)).toContain(run)
  })
})

describe('tab expansion in block content', () => {
  it('keeps tab-indented fenced code inside the width budget', () => {
    const source = '```\n\tmodified: packages/tui/omdsh-tui/src/chrome/width.ts\n\t\tindented deeper\n```'
    for (const width of [72, 48, 32, 20]) {
      for (const line of renderMarkdown(source, theme, width)) {
        expect(oracleWidth(line), `width ${width}: ${JSON.stringify(stripAnsi(line))}`).toBeLessThanOrEqual(width)
        expect(stripAnsi(line)).not.toContain('\t')
      }
    }
  })

  it('keeps tab-indented table cells inside the width budget', () => {
    // The tab sits between words: a leading tab would be trimmed by the table
    // parser and the case would assert nothing.
    const source = '| File | State |\n| --- | --- |\n| src/\ta.ts | ✅ done |'
    for (const width of [40, 28]) {
      for (const line of renderMarkdown(source, theme, width)) {
        expect(oracleWidth(line), `width ${width}: ${JSON.stringify(stripAnsi(line))}`).toBeLessThanOrEqual(width)
        expect(stripAnsi(line)).not.toContain('\t')
      }
    }
  })
})

/** Read active SGR attributes at visible text, independently of paint helpers. */
function attributesAt(output: string, text: string) {
  const offset = output.indexOf(text)
  expect(offset, text).toBeGreaterThanOrEqual(0)
  let fg = '', bold = false, italic = false, underline = false, strike = false
  for (const match of output.slice(0, offset).matchAll(/\x1b\[([\d;]*)m/gu)) {
    const codes = match[1]!.split(';').map(Number)
    for (let at = 0; at < codes.length; at += 1) {
      const code = codes[at]
      if (code === 0) { fg = ''; bold = italic = underline = strike = false }
      else if (code === 1 || code === 22) bold = code === 1
      else if (code === 3 || code === 23) italic = code === 3
      else if (code === 4 || code === 24) underline = code === 4
      else if (code === 9 || code === 29) strike = code === 9
      else if (code === 39) fg = ''
      else if (code === 38) {
        const length = codes[at + 1] === 2 ? 5 : 3
        fg = '\x1b[' + codes.slice(at, at + length).join(';') + 'm'
        at += length - 1
      }
    }
  }
  return { fg, bold, italic, underline, strike }
}

describe('Markdown reading hierarchy', () => {
  it.each(['dark', 'light'] as const)('%s restores headings and quotes after nested spans', name => {
    const theme = createTheme(true, true, name)
    const heading = renderMarkdown('## before `code` **bold** [link](https://example.com) after', theme, 200).join('\n')
    expect(attributesAt(heading, 'after')).toMatchObject({ fg: theme.getFgAnsi('mdHeading'), bold: true, underline: false })
    expect(attributesAt(heading, 'code')).toMatchObject({ fg: theme.getFgAnsi('mdCode'), bold: true })
    expect(attributesAt(heading, 'link')).toMatchObject({ fg: theme.getFgAnsi('mdLink'), bold: true, underline: true })
    const quote = renderMarkdown('> before `code` **bold** [link](https://example.com) after', theme, 200).join('\n')
    expect(attributesAt(quote, 'after')).toMatchObject({ fg: theme.getFgAnsi('mdQuote'), bold: false, italic: false, underline: false })
  })

  it('restores nested emphasis without leaking it into following prose', () => {
    const output = renderInline('**before *inside* `code` after** outside', color)
    expect(attributesAt(output, 'inside')).toMatchObject({ bold: true, italic: true })
    expect(attributesAt(output, 'code')).toMatchObject({ bold: true, italic: false })
    expect(attributesAt(output, 'after')).toMatchObject({ bold: true, italic: false })
    expect(attributesAt(output, 'outside')).toMatchObject({ bold: false, italic: false, underline: false, strike: false, fg: '' })
    const strike = renderInline('~~before **inside** after~~ outside', color)
    expect(attributesAt(strike, 'after')).toMatchObject({ bold: false, strike: true })
    expect(attributesAt(strike, 'outside')).toMatchObject({ strike: false })
  })

  it('labels fenced code without changing source rows or overflowing narrow widths', () => {
    expect(renderMarkdown('```typescript\nconst whale = "中文 🐳 é"\n```', theme, 50)).toEqual([
      '  │ ts', '  │ const whale = "中文 🐳 é"',
    ])
    for (let width = 1; width <= 50; width += 1) {
      for (const colors of [true, false]) {
        const rows = renderMarkdown('```typescript\nconst whale = "中文 🐳 é"\n```', createTheme(colors, true), width)
        expect(rows.every(row => oracleWidth(row) <= width), String(width)).toBe(true)
      }
    }
  })

  it('uses only the header divider for single-line records and separates wrapped records', () => {
    const source = '| Key | Value |\n| --- | --- |\n| A | one |\n| B | two |'
    expect(plain(source, 40).split('\n').filter(row => row.includes('┼'))).toHaveLength(1)
    const wrapped = source.replace('one', 'a much longer phrase that needs several rows')
    expect(plain(wrapped, 25).split('\n').filter(row => row.includes('┼'))).toHaveLength(2)
  })
})

describe('compact links', () => {
  const href = 'https://example.com/documentation/very/long/path?view=reference&section=authentication'
  const compact = createTheme(true, true, 'dark', undefined, 'en', true)

  it('retains the full hyperlink target while showing the label and destination host', () => {
    const output = renderInline(`[**docs**](${href})`, compact)
    expect(stripAnsi(output)).toBe('docs (example.com/…)')
    expect(output).toContain(`\x1b]8;;${href}\x07`)
    expect(compact.key).not.toBe(color.key)
  })

  it('retains visible addresses for unknown terminals, no-color, bare URLs, and non-web targets', () => {
    for (const theme of [color, createTheme(false, true, 'dark', undefined, 'en', true)]) {
      expect(stripAnsi(renderInline(`[docs](${href})`, theme))).toBe(`docs (${href})`)
    }
    expect(stripAnsi(renderInline(href, compact))).toBe(href)
    for (const target of ['../' + 'path/'.repeat(12), 'mailto:' + 'a'.repeat(60) + '@example.com']) {
      expect(stripAnsi(renderInline(`[docs](${target})`, compact))).toContain(target)
    }
  })

  it('wraps compact links safely with CJK and emoji labels', () => {
    for (const width of [4, 8, 12, 30]) {
      const rows = renderMarkdown(`[中文 🐳 é](${href}) after`, compact, width)
      expect(rows.every(row => oracleWidth(row) <= width)).toBe(true)
      expect(rows.join('\n')).toContain(href)
    }
  })
})
