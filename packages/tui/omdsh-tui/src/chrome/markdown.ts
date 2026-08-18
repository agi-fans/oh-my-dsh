/**
 * GFM markdown → terminal lines. marked lexes the source; this module paints
 * tokens with the TUI theme and wraps to display columns.
 * @module @agi-fans/dsh-tui
 */

import { Lexer, Marked, type Token, type Tokens, type TokenizerAndRendererExtension } from 'marked'
import { BOX, type Theme, type ThemeColor } from './theme.ts'
import { padToWidth, visibleWidth, wrapText } from './width.ts'

/** Optional surrounding style restored after inline code and emphasis. */
export interface MarkdownStyle {
  color?: ThemeColor
  italic?: boolean
}

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
  return normalizeHtml(source).replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

function openBase(theme: Theme, style: MarkdownStyle | undefined): string {
  if (!theme.colors || style === undefined) return ''
  return (style.italic === true ? '\x1b[3m' : '')
    + (style.color === undefined ? '' : theme.getFgAnsi(style.color))
}

/** Keep thinking traces on one dark ink so headings, code, and links do not light up. */
function ink(style: MarkdownStyle | undefined, color: ThemeColor): ThemeColor {
  return style?.color === 'thinkingText' ? 'thinkingText' : color
}

/** Paint one unstyled run so a later 39m cannot leak default ink. */
function paintBase(theme: Theme, text: string, style?: MarkdownStyle): string {
  if (text === '' || style === undefined || !theme.colors) return text
  let out = text
  if (style.color !== undefined) out = theme.fg(style.color, out)
  if (style.italic === true) out = theme.italic(out)
  return out
}

function paintFg(theme: Theme, color: ThemeColor, text: string, style?: MarkdownStyle): string {
  if (!theme.colors) return text
  return theme.getFgAnsi(color) + text + '\x1b[39m' + openBase(theme, style)
}

function paintBold(theme: Theme, text: string, style?: MarkdownStyle): string {
  if (!theme.colors) return text
  return `\x1b[1m${text}\x1b[22m` + openBase(theme, style)
}

function paintItalic(theme: Theme, text: string, style?: MarkdownStyle): string {
  if (!theme.colors) return text
  return `\x1b[3m${text}\x1b[23m` + openBase(theme, style)
}

function paintStrike(theme: Theme, text: string, style?: MarkdownStyle): string {
  if (!theme.colors) return text
  return `\x1b[9m${text}\x1b[29m` + openBase(theme, style)
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

function highlightCode(row: string, language: string, theme: Theme, style?: MarkdownStyle): string {
  if (!theme.colors || language === '') return paintFg(theme, ink(style, 'mdCodeBlock'), row, style)
  const supported = /^(?:js|jsx|ts|tsx|javascript|typescript|json|python|py|bash|sh|shell|rust|go|java|css|html)$/u.test(language)
  if (!supported) return paintFg(theme, ink(style, 'mdCodeBlock'), row, style)
  return row.split(/(\s+|\b)/u).map(token => {
    if (/^(?:const|let|var|function|class|interface|type|return|if|else|for|while|async|await|import|export|from|def|fn|struct|package|func|true|false|null|undefined)$/u.test(token)) {
      return paintFg(theme, ink(style, 'mdKeyword'), token, style)
    }
    if (/^(?:\d+(?:\.\d+)?|"[^"]*"|'[^']*')$/u.test(token)) {
      return paintFg(theme, ink(style, 'mdCodeBlock'), token, style)
    }
    return paintBase(theme, token, style)
  }).join('')
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

function renderInlineTokens(tokens: readonly Token[] | undefined, theme: Theme, style?: MarkdownStyle): string {
  if (tokens === undefined) return ''
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
          : renderInlineTokens(token.tokens, theme, style)
        break
      case 'strong':
        out += paintBold(theme, renderInlineTokens(token.tokens, theme, style), style)
        break
      case 'em':
        out += paintItalic(theme, renderInlineTokens(token.tokens, theme, style), style)
        break
      case 'del':
        out += paintStrike(theme, renderInlineTokens(token.tokens, theme, style), style)
        break
      case 'codespan':
        out += paintFg(theme, ink(style, isProseCodespan(token.text) ? 'muted' : 'mdCode'), token.text, style)
        break
      case 'link':
        out += paintLink(renderInlineTokens(token.tokens, theme, style) || token.text, token.href, theme, style) + openBase(theme, style)
        break
      case 'image':
        out += paintLink(renderInlineTokens(token.tokens, theme, style) || token.text || 'image', token.href, theme, style) + openBase(theme, style)
        break
      case 'br':
        out += '\n'
        break
      default:
        if ('tokens' in token && token.tokens !== undefined) out += renderInlineTokens(token.tokens, theme, style)
        else if ('text' in token && typeof token.text === 'string') out += paintBase(theme, flattenText(token.text), style)
    }
  }
  return out
}

/** Inline markdown: code, links, strike, bold, italic, math. */
export function renderInline(text: string, theme: Theme, style?: MarkdownStyle): string {
  return renderInlineTokens(Lexer.lexInline(prepare(text), parser.defaults), theme, style)
}

function withStyle(theme: Theme, style: MarkdownStyle | undefined, line: string): string {
  if (style === undefined || line === '') return line
  return openBase(theme, style) + line
}

function withStyledLines(theme: Theme, style: MarkdownStyle | undefined, lines: readonly string[]): string[] {
  if (style === undefined) return [...lines]
  return lines.map(line => withStyle(theme, style, line))
}

function flowLines(token: Token, theme: Theme, width: number, style?: MarkdownStyle): string[] {
  if (token.type === 'paragraph' || token.type === 'text' || token.type === 'heading') {
    const inner = token.tokens === undefined
      ? paintBase(theme, flattenText('text' in token ? String(token.text ?? '') : ''), style)
      : renderInlineTokens(token.tokens, theme, style)
    return wrapStyled(inner, width)
  }
  return renderBlock(token, theme, width, 0, style)
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
    for (const row of rows) {
      const body = row === '' ? '' : highlightCode(row, lang.toLowerCase(), theme, style)
      lines.push(...wrapStyled(body === '' ? '  ' : '  ' + body, width))
    }
  }
  lines.push(...wrapStyled(theme.fg(fence, '  ```'), width))
  return lines
}

function renderList(token: Tokens.List, theme: Theme, width: number, level: number, style?: MarkdownStyle): string[] {
  const lines: string[] = []
  let number = typeof token.start === 'number' && token.start > 0 ? token.start : 1
  for (const item of token.items) {
    const bullet = style?.color === 'thinkingText' ? 'thinkingText' : 'mdListBullet'
    const marker = item.task === true
      ? theme.fg(bullet, item.checked === true ? '☑ ' : '☐ ')
      : token.ordered
        ? theme.fg(bullet, `${number}. `)
        : theme.fg(bullet, '• ')
    number += 1
    lines.push(...renderListItem(item, marker, theme, width, level, style))
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
      lines.push(...renderList(child as Tokens.List, theme, width, level + 1, style))
      first = false
      continue
    }
    const content = withStyledLines(theme, style, flowLines(child, theme, innerWidth, style))
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

function renderBlockquote(token: Tokens.Blockquote, theme: Theme, width: number, style?: MarkdownStyle): string[] {
  const inner = renderTokens(token.tokens, theme, Math.max(1, width - 2), 0, style)
  return inner.map(line => theme.fg('borderMuted', '│ ') + line)
}

function renderBlock(token: Token, theme: Theme, width: number, listLevel: number, style?: MarkdownStyle): string[] {
  if (isMathToken(token)) {
    return wrapStyled('  ' + renderMath(token.text, theme, style), width)
  }
  switch (token.type) {
    case 'space':
      return ['']
    case 'hr':
      return [theme.fg('borderMuted', '─'.repeat(Math.max(1, width)))]
    case 'heading':
      return wrapStyled(theme.bold(theme.fg(style?.color === 'thinkingText' ? 'thinkingText' : 'mdHeading', renderInlineTokens(token.tokens, theme, style))), width)
    case 'paragraph':
    case 'text':
      return flowLines(token, theme, width, style)
    case 'blockquote':
      return renderBlockquote(token as Tokens.Blockquote, theme, width, style)
    case 'list':
      return renderList(token as Tokens.List, theme, width, listLevel, style)
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
      if ('tokens' in token && token.tokens !== undefined) return renderTokens(token.tokens, theme, width, listLevel, style)
      if ('text' in token && typeof token.text === 'string') {
        return wrapStyled(paintBase(theme, flattenText(token.text), style), width)
      }
      return []
  }
}

function renderTokens(tokens: readonly Token[], theme: Theme, width: number, listLevel: number, style?: MarkdownStyle): string[] {
  const lines: string[] = []
  for (const token of tokens) {
    const chunk = renderBlock(token, theme, width, listLevel, style)
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
