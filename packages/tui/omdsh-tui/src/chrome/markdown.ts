/**
 * GFM markdown → terminal lines. marked lexes the source; this module paints
 * tokens with the TUI theme and wraps to display columns.
 * @module @agi-fans/dsh-tui
 */

import { Lexer, Marked, type Token, type Tokens, type TokenizerAndRendererExtension } from 'marked'
import { BOX, SYMBOL, type Theme } from './theme.ts'
import { highlightCodeLines } from './code-highlight.ts'
import { ink, openBase, paintBase, paintBold, paintFg, paintItalic, paintStrike, type MarkdownStyle } from './md-style.ts'
import { padToWidth, visibleWidth, wrapText } from './width.ts'

export type { MarkdownStyle } from './md-style.ts'

const MATH_SYMBOLS: Readonly<Record<string, string>> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', lambda: 'λ', mu: 'μ',
  pi: 'π', sigma: 'σ', phi: 'φ', omega: 'ω', times: '×', cdot: '·', le: '≤', ge: '≥',
  neq: '≠', approx: '≈', infty: '∞', sum: '∑', int: '∫', sqrt: '√', to: '→',
}
const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻',
}

interface MathToken {
  type: 'math'
  raw: string
  text: string
  display?: boolean
}

function isMathToken(token: Token): token is Token & MathToken {
  return token.type === 'math'
}

function inlineMathSpanEnd(text: string, open: number): number {
  const after = text[open + 1]
  if (after === undefined || after === ' ' || after === '\t' || after === '\n' || after === '$' || after === '(' || after === '{') {
    return -1
  }
  for (let index = open + 1; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\\') {
      index += 1
      continue
    }
    if (char === '\n') return -1
    if (char !== '$') continue
    const prev = text[index - 1]
    if (prev === ' ' || prev === '\t') return -1
    const next = text[index + 1]
    if (next !== undefined && next >= '0' && next <= '9') continue
    return text.slice(open + 1, index).trim().length > 0 ? index : -1
  }
  return -1
}

function mathStartIndex(src: string): number | undefined {
  let best = src.indexOf('$')
  const paren = src.indexOf('\\(')
  if (paren !== -1 && (best === -1 || paren < best)) best = paren
  const bracket = src.indexOf('\\[')
  if (bracket !== -1 && (best === -1 || bracket < best)) best = bracket
  return best === -1 ? undefined : best
}

const mathBlock: TokenizerAndRendererExtension = {
  name: 'mathBlock',
  level: 'block',
  start(src) {
    const index = src.indexOf('$$')
    return index === -1 ? undefined : index
  },
  tokenizer(src) {
    const match = /^\$\$[ \t]*\n?([\s\S]*?)\n?\$\$[ \t]*(?:\n+|$)/u.exec(src)
    if (match === null || (match[1] ?? '').trim() === '') return undefined
    return { type: 'math', raw: match[0], text: (match[1] ?? '').trim(), display: true }
  },
}

const mathInline: TokenizerAndRendererExtension = {
  name: 'math',
  level: 'inline',
  start(src) {
    return mathStartIndex(src)
  },
  tokenizer(src) {
    if (src.startsWith('$$')) {
      const end = src.indexOf('$$', 2)
      if (end !== -1 && src.slice(2, end).trim() !== '') {
        return { type: 'math', raw: src.slice(0, end + 2), text: src.slice(2, end).trim(), display: true }
      }
      return undefined
    }
    if (src.startsWith('\\(')) {
      const end = src.indexOf('\\)', 2)
      if (end !== -1 && src.slice(2, end).trim() !== '') {
        return { type: 'math', raw: src.slice(0, end + 2), text: src.slice(2, end).trim() }
      }
      return undefined
    }
    if (src.startsWith('\\[')) {
      const end = src.indexOf('\\]', 2)
      if (end !== -1 && src.slice(2, end).trim() !== '') {
        return { type: 'math', raw: src.slice(0, end + 2), text: src.slice(2, end).trim(), display: true }
      }
      return undefined
    }
    if (!src.startsWith('$')) return undefined
    if (src[1] === '(' || src[1] === '{') return undefined
    const end = inlineMathSpanEnd(src, 0)
    if (end === -1) return undefined
    return { type: 'math', raw: src.slice(0, end + 1), text: src.slice(1, end) }
  },
}

const parser = new Marked()
parser.use({ gfm: true, breaks: false, extensions: [mathBlock, mathInline] })

function normalizeHtml(source: string): string {
  return source
    .replace(/<br\s*\/?>/giu, '  \n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>/giu, '\n\n')
    .replace(/<li(?:\s[^>]*)?>/giu, '- ')
    .replace(/<\/?(?:a|b|blockquote|code|details|div|em|h[1-6]|i|ol|p|pre|span|strong|summary|table|tbody|td|th|thead|tr|u|ul)(?:\s[^>]*)?>/giu, '')
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&nbsp;', ' ')
}

function prepare(source: string): string {
  return clampNesting(normalizeHtml(source).replaceAll('\r\n', '\n').replaceAll('\r', '\n'))
}

/**
 * Cap the nesting one markdown source may express before the lexer runs.
 * `marked` recurses once per nested blockquote or list level and once per
 * emphasis run, so `'> '.repeat(5000)`, a deeply indented list, or a long `***`
 * run overflows the call stack **inside the parser** — before any rendering
 * guard can help, and on some inputs as an uncatchable process crash rather
 * than a catchable `RangeError`. Clamping the shape here keeps the model's
 * intent while bounding the parser's recursion. Fenced code keeps its bytes.
 */
const MAX_MARKDOWN_NESTING = 24
const MAX_EMPHASIS_RUN = 3

function clampNesting(source: string): string {
  let fence: string | undefined
  return source.split('\n').map((line) => {
    const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line)
    if (fence !== undefined) {
      if (fenceMatch?.[1] !== undefined
        && fenceMatch[1].startsWith(fence[0] ?? '')
        && fenceMatch[1].length >= fence.length) fence = undefined
      return line
    }
    if (fenceMatch?.[1] !== undefined) {
      fence = fenceMatch[1]
      return line
    }
    let out = line
    const quote = /^(\s*)((?:>\s?)+)(.*)$/u.exec(out)
    if (quote !== null) {
      const count = ((quote[2] ?? '').match(/>/gu) ?? []).length
      if (count > MAX_MARKDOWN_NESTING) {
        out = (quote[1] ?? '') + '> '.repeat(MAX_MARKDOWN_NESTING) + (quote[3] ?? '')
      }
    }
    const indent = /^( +)(\S.*)$/u.exec(out)
    const spaces = indent?.[1]?.length ?? 0
    if (indent !== null && spaces > MAX_MARKDOWN_NESTING * 2) {
      out = ' '.repeat(MAX_MARKDOWN_NESTING * 2) + (indent[2] ?? '')
    }
    return out.replace(/([*_])\1{2,}/gu, (_match, mark: string) => mark.repeat(MAX_EMPHASIS_RUN))
  }).join('\n')
}

function isProseCodespan(text: string): boolean {
  const words = text.trim().split(/\s+/u).filter(Boolean)
  return words.length >= 4 || (words.length >= 2 && /[,;]/.test(text))
}

function renderMath(value: string, theme: Theme, style?: MarkdownStyle): string {
  const normalized = value
    .replace(/\\([A-Za-z]+)/gu, (whole, name: string) => MATH_SYMBOLS[name] ?? whole)
    .replace(/\^\{?([0-9+-]+)\}?/gu, (_whole, body: string) =>
      [...body].map(char => SUPERSCRIPT[char] ?? char).join(''))
    .replace(/_\{([^}]+)\}/gu, '₍$1₎')
  return paintFg(theme, ink(style, 'mdCode'), normalized, style)
}

function mermaidEndpoint(raw: string): string {
  const text = raw.trim()
  const labeled = /^(?:[\w.-]*)\[([^\]]+)\]$/u.exec(text)
    ?? /^(?:[\w.-]*)\(([^)]+)\)$/u.exec(text)
    ?? /^(?:[\w.-]*)\{([^}]+)\}$/u.exec(text)
  if (labeled?.[1] !== undefined) return labeled[1]
  return text.replace(/[\[\](){}]/gu, '').trim()
}

function renderMermaid(rows: readonly string[], theme: Theme, width: number, style?: MarkdownStyle): string[] {
  const output: string[] = []
  for (const raw of rows) {
    const row = raw.trim()
    if (row === '' || /^(?:graph|flowchart|sequenceDiagram)\b/u.test(row)) continue
    const sequence = /^([^:]+?)-+>>?([^:]+):\s*(.+)$/u.exec(row)
    const edge = /^(.+?)-+(?:>|\|[^|]*\|)(.+)$/u.exec(row)
    const text = sequence
      ? `${mermaidEndpoint(sequence[1] ?? '')} → ${mermaidEndpoint(sequence[2] ?? '')}: ${sequence[3]?.trim() ?? ''}`
      : edge
        ? `${mermaidEndpoint(edge[1] ?? '')} → ${mermaidEndpoint(edge[2] ?? '')}`
        : row
    output.push(...wrapStyled('  ' + paintFg(theme, ink(style, 'mdCodeBlock'), text, style), width))
  }
  return output.length > 0 ? output : [theme.fg(ink(style, 'dim'), '  (empty Mermaid diagram)')]
}

function wrapStyled(text: string, width: number): string[] {
  return wrapText(text, Math.max(1, width))
}

function safeHref(href: string): string {
  return href.replaceAll('\x1b', '').replaceAll('\x07', '')
}

function hyperlink(label: string, href: string, theme: Theme): string {
  const target = safeHref(href)
  if (!theme.colors || target === '') return label
  return `\x1b]8;;${target}\x07${label}\x1b]8;;\x07`
}

function paintLink(label: string, href: string, theme: Theme, style?: MarkdownStyle): string {
  const target = href.startsWith('www.') ? 'https://' + href : href
  const styled = theme.fg(ink(style, 'mdLink'), theme.underline(label))
  const clickable = hyperlink(styled, target, theme)
  if (label === href || label === target) return clickable
  const url = hyperlink(theme.fg(ink(style, 'mdLinkUrl'), '(' + href + ')'), target, theme)
  return clickable + ' ' + url
}

function flattenText(text: string): string {
  return text.replace(/\n+/gu, ' ')
}

/**
 * Maximum block and inline nesting a single render descends into. Markdown in
 * model output can nest arbitrarily (`> > > …`, `***…`, indented lists), and an
 * unbounded walk blows the JS call stack — which crashes the process rather
 * than raising a catchable error. Past this depth the renderer degrades to the
 * node's plain text instead of recursing further.
 */
const MAX_MARKDOWN_DEPTH = 24

/** Plain text of one token tree, used when nesting exceeds the depth cap. */
function tokenText(token: Token): string {
  if ('text' in token && typeof token.text === 'string') return token.text
  if ('tokens' in token && Array.isArray(token.tokens)) {
    return (token.tokens as readonly Token[]).map(tokenText).join('')
  }
  return ''
}

function renderInlineTokens(
  tokens: readonly Token[] | undefined,
  theme: Theme,
  style?: MarkdownStyle,
  depth = 0,
): string {
  if (tokens === undefined) return ''
  if (depth > MAX_MARKDOWN_DEPTH) {
    return paintBase(theme, flattenText(tokens.map(tokenText).join('')), style)
  }
  let out = ''
  for (const token of tokens) {
    if (isMathToken(token)) {
      out += renderMath(token.text, theme, style)
      continue
    }
    switch (token.type) {
      case 'escape':
        out += paintBase(theme, token.text, style)
        break
      case 'text':
        out += token.tokens === undefined
          ? paintBase(theme, flattenText(token.text), style)
          : renderInlineTokens(token.tokens, theme, style, depth + 1)
        break
      case 'strong':
        out += paintBold(theme, renderInlineTokens(token.tokens, theme, style, depth + 1), style)
        break
      case 'em':
        out += paintItalic(theme, renderInlineTokens(token.tokens, theme, style, depth + 1), style)
        break
      case 'del':
        out += paintStrike(theme, renderInlineTokens(token.tokens, theme, style, depth + 1), style)
        break
      case 'codespan':
        out += paintFg(theme, ink(style, isProseCodespan(token.text) ? 'muted' : 'mdCode'), token.text, style)
        break
      case 'link':
        out += paintLink(renderInlineTokens(token.tokens, theme, style, depth + 1) || token.text, token.href, theme, style) + openBase(theme, style)
        break
      case 'image':
        out += paintLink(renderInlineTokens(token.tokens, theme, style, depth + 1) || token.text || 'image', token.href, theme, style) + openBase(theme, style)
        break
      case 'br':
        out += '\n'
        break
      default:
        if ('tokens' in token && token.tokens !== undefined) out += renderInlineTokens(token.tokens, theme, style, depth + 1)
        else if ('text' in token && typeof token.text === 'string') out += paintBase(theme, flattenText(token.text), style)
    }
  }
  return out
}

/** Inline markdown: code, links, strike, bold, italic, math. */
export function renderInline(text: string, theme: Theme, style?: MarkdownStyle): string {
  return renderInlineTokens(Lexer.lexInline(prepare(text), parser.defaults), theme, style, 0)
}

function withStyle(theme: Theme, style: MarkdownStyle | undefined, line: string): string {
  if (style === undefined || line === '') return line
  return openBase(theme, style) + line
}

function withStyledLines(theme: Theme, style: MarkdownStyle | undefined, lines: readonly string[]): string[] {
  if (style === undefined) return [...lines]
  return lines.map(line => withStyle(theme, style, line))
}

function flowLines(token: Token, theme: Theme, width: number, style?: MarkdownStyle, depth = 0): string[] {
  if (token.type === 'paragraph' || token.type === 'text' || token.type === 'heading') {
    const inner = token.tokens === undefined
      ? paintBase(theme, flattenText('text' in token ? String(token.text ?? '') : ''), style)
      : renderInlineTokens(token.tokens, theme, style, depth)
    return wrapStyled(inner, width)
  }
  return renderBlock(token, theme, width, 0, style, depth)
}

function renderTable(token: Tokens.Table, theme: Theme, width: number): string[] {
  const header = token.header.map(cell => theme.bold(renderInlineTokens(cell.tokens, theme)))
  const rows = token.rows.map(row => row.map(cell => renderInlineTokens(cell.tokens, theme)))
  const cols = header.length
  if (cols === 0) return []
  const borderOverhead = 3 * cols + 1
  const available = width - borderOverhead
  if (available < cols) {
    const raw = [
      '| ' + token.header.map(cell => cell.text).join(' | ') + ' |',
      ...token.rows.map(row => '| ' + row.map(cell => cell.text).join(' | ') + ' |'),
    ]
    return raw.flatMap(line => wrapStyled(theme.fg('dim', line), width))
  }

  const natural = Array.from({ length: cols }, (_, i) => {
    let max = visibleWidth(header[i] ?? '')
    for (const row of rows) max = Math.max(max, visibleWidth(row[i] ?? ''))
    return Math.max(1, max)
  })
  const longestWord = (text: string): number => Math.min(
    30,
    Math.max(1, ...text.split(/\s+/u).filter(Boolean).map(word => visibleWidth(word))),
  )
  let minimums = Array.from({ length: cols }, (_, i) => {
    let max = longestWord(header[i] ?? '')
    for (const row of rows) max = Math.max(max, longestWord(row[i] ?? ''))
    return max
  })
  let minimumTotal = minimums.reduce((total, value) => total + value, 0)
  if (minimumTotal > available) {
    const remaining = available - cols
    const weight = minimums.reduce((total, value) => total + Math.max(0, value - 1), 0)
    minimums = minimums.map(value => 1 + (weight > 0
      ? Math.floor((Math.max(0, value - 1) / weight) * remaining)
      : 0))
    let leftover = available - minimums.reduce((total, value) => total + value, 0)
    for (let i = 0; leftover > 0 && i < cols; i += 1, leftover -= 1) {
      minimums[i] = (minimums[i] ?? 1) + 1
    }
    minimumTotal = minimums.reduce((total, value) => total + value, 0)
  }

  const totalNatural = natural.reduce((total, value) => total + value, 0)
  let widths = natural.map((value, i) => Math.max(value, minimums[i] ?? 1))
  if (totalNatural > available) {
    const growth = natural.map((value, i) => Math.max(0, value - (minimums[i] ?? 1)))
    const totalGrowth = growth.reduce((total, value) => total + value, 0)
    const extra = Math.max(0, available - minimumTotal)
    widths = minimums.map((value, i) => value + (totalGrowth > 0
      ? Math.floor(((growth[i] ?? 0) / totalGrowth) * extra)
      : 0))
    let leftover = available - widths.reduce((total, value) => total + value, 0)
    while (leftover > 0) {
      let grew = false
      for (let i = 0; i < cols && leftover > 0; i += 1) {
        if ((widths[i] ?? 1) >= (natural[i] ?? 1)) continue
        widths[i] = (widths[i] ?? 1) + 1
        leftover -= 1
        grew = true
      }
      if (!grew) break
    }
  }

  const h = BOX.horizontal
  const v = theme.fg('borderMuted', BOX.vertical)
  const join = (left: string, fill: string[], mid: string, right: string): string =>
    theme.fg('borderMuted', left + h + fill.join(h + mid + h) + h + right)
  const wrapCell = (text: string, col: number): string[] => wrapText(text, widths[col] ?? 1)
  const paintRow = (cells: string[][], emphasize: boolean): string[] => {
    const height = Math.max(1, ...cells.map(parts => parts.length))
    const out: string[] = []
    for (let row = 0; row < height; row += 1) {
      const parts = cells.map((parts, i) => {
        const text = parts[row] ?? ''
        const padded = padToWidth(text, widths[i] ?? 1)
        return emphasize ? theme.bold(padded) : padded
      })
      out.push(v + ' ' + parts.join(' ' + v + ' ') + ' ' + v)
    }
    return out
  }

  const fills = widths.map(w => h.repeat(w))
  const lines = [
    join(BOX.topLeft, fills, BOX.teeDown, BOX.topRight),
    ...paintRow(header.map((cell, i) => wrapCell(cell, i)), true),
    join(BOX.teeRight, fills, BOX.cross, BOX.teeLeft),
  ]
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? []
    lines.push(...paintRow(row.map((cell, i) => wrapCell(cell, i)), false))
    if (rowIndex < rows.length - 1) {
      lines.push(join(BOX.teeRight, fills, BOX.cross, BOX.teeLeft))
    }
  }
  lines.push(join(BOX.bottomLeft, fills, BOX.teeUp, BOX.bottomRight))
  return lines
}

function renderCode(token: Tokens.Code, theme: Theme, width: number, style?: MarkdownStyle): string[] {
  const lang = (token.lang ?? '').trim()
  const rows = token.text.split('\n')
  const fence = ink(style, 'mdCodeBlockBorder')
  const lines = [...wrapStyled(theme.fg(fence, '  ```' + lang), width)]
  if (lang.toLowerCase() === 'mermaid') {
    lines.push(...renderMermaid(rows, theme, width, style))
  } else {
    const highlighted = highlightCodeLines(rows, lang, theme, style)
    for (let i = 0; i < rows.length; i += 1) {
      const body = highlighted[i] ?? ''
      lines.push(...wrapStyled(body === '' ? '  ' : '  ' + body, width))
    }
  }
  lines.push(...wrapStyled(theme.fg(fence, '  ```'), width))
  return lines
}

function renderList(token: Tokens.List, theme: Theme, width: number, level: number, style?: MarkdownStyle, depth = 0): string[] {
  const lines: string[] = []
  let number = typeof token.start === 'number' && token.start > 0 ? token.start : 1
  for (const item of token.items) {
    const bullet = style?.color === 'thinkingText' ? 'thinkingText' : 'mdListBullet'
    const marker = item.task === true
      ? theme.fg(bullet, item.checked === true ? `${SYMBOL.success} ` : `${SYMBOL.pending} `)
      : token.ordered
        ? theme.fg(bullet, `${number}. `)
        : theme.fg(bullet, '• ')
    number += 1
    lines.push(...renderListItem(item, marker, theme, width, level, style, depth))
  }
  return lines
}

function renderListItem(
  item: Tokens.ListItem,
  marker: string,
  theme: Theme,
  width: number,
  level: number,
  style?: MarkdownStyle,
  depth = 0,
): string[] {
  const pad = '  '.repeat(level)
  const markerWidth = visibleWidth(pad + marker)
  const hang = ' '.repeat(markerWidth)
  const innerWidth = Math.max(1, width - markerWidth)
  const lines: string[] = []
  let first = true
  for (const child of item.tokens) {
    if (child.type === 'space') {
      if (lines.length > 0) lines.push('')
      continue
    }
    if (child.type === 'list') {
      lines.push(...renderList(child as Tokens.List, theme, width, level + 1, style, depth + 1))
      first = false
      continue
    }
    const content = withStyledLines(theme, style, flowLines(child, theme, innerWidth, style, depth + 1))
    if (first) {
      lines.push(pad + marker + (content[0] ?? ''))
      for (const line of content.slice(1)) lines.push(hang + line)
      first = false
    } else {
      for (const line of content) lines.push(hang + line)
    }
  }
  if (first) lines.push(pad + marker.trimEnd())
  return lines
}

function renderBlockquote(token: Tokens.Blockquote, theme: Theme, width: number, style?: MarkdownStyle, depth = 0): string[] {
  const inner = renderTokens(token.tokens, theme, Math.max(1, width - 2), 0, style, depth)
  return inner.map(line => theme.fg('borderMuted', '│ ') + line)
}

function renderBlock(token: Token, theme: Theme, width: number, listLevel: number, style?: MarkdownStyle, depth = 0): string[] {
  if (isMathToken(token)) {
    return wrapStyled('  ' + renderMath(token.text, theme, style), width)
  }
  switch (token.type) {
    case 'space':
      return ['']
    case 'hr':
      return [theme.fg('borderMuted', '─'.repeat(Math.max(1, width)))]
    case 'heading':
      return wrapStyled(theme.bold(theme.fg(style?.color === 'thinkingText' ? 'thinkingText' : 'mdHeading', renderInlineTokens(token.tokens, theme, style, depth + 1))), width)
    case 'paragraph':
    case 'text':
      return flowLines(token, theme, width, style, depth + 1)
    case 'blockquote':
      return renderBlockquote(token as Tokens.Blockquote, theme, width, style, depth + 1)
    case 'list':
      return renderList(token as Tokens.List, theme, width, listLevel, style, depth + 1)
    case 'code':
      return renderCode(token as Tokens.Code, theme, width, style)
    case 'table':
      return renderTable(token as Tokens.Table, theme, width)
    case 'html':
      {
        const stripped = normalizeHtml(token.text).trim()
        return stripped === '' ? [] : wrapStyled(renderInline(stripped, theme, style), width)
      }
    case 'def':
      return []
    default:
      if ('tokens' in token && token.tokens !== undefined) return renderTokens(token.tokens, theme, width, listLevel, style, depth + 1)
      if ('text' in token && typeof token.text === 'string') {
        return wrapStyled(paintBase(theme, flattenText(token.text), style), width)
      }
      return []
  }
}

function renderTokens(
  tokens: readonly Token[],
  theme: Theme,
  width: number,
  listLevel: number,
  style?: MarkdownStyle,
  depth = 0,
): string[] {
  const lines: string[] = []
  for (const token of tokens) {
    if (depth > MAX_MARKDOWN_DEPTH) {
      const text = flattenText(tokenText(token))
      if (text !== '') lines.push(...wrapStyled(paintBase(theme, text, style), width))
      continue
    }
    const chunk = renderBlock(token, theme, width, listLevel, style, depth)
    if (chunk.length === 0) continue
    lines.push(...withStyledLines(theme, style, chunk))
  }
  return lines
}

/**
 * Render markdown to display lines already wrapped to `width`.
 */
export function renderMarkdown(source: string, theme: Theme, width: number, style?: MarkdownStyle): string[] {
  const tokens = parser.lexer(prepare(source))
  const lines = renderTokens(tokens, theme, width, 0, style)
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  while (lines[0] === '') lines.shift()
  return lines
}
