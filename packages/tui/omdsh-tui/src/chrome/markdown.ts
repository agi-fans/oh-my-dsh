/**
 * GFM markdown → terminal lines. marked lexes the source; this module paints
 * tokens with the TUI theme and wraps to display columns.
 * @module @agi-fans/dsh-tui
 */

import { Lexer, Marked, type Token, type Tokens, type TokenizerAndRendererExtension } from 'marked'
import { BOX, SYMBOL, type Theme } from './theme.ts'
import { highlightCodeLines } from './code-highlight.ts'
import { mathLayout } from './math.ts'
import { mermaidLines } from './mermaid.ts'
import { ink, openBase, paintBase, paintBold, paintFg, paintItalic, paintStrike, type MarkdownStyle } from './md-style.ts'
import { expandTabs, graphemeWidth, sliceCells, stripAnsi, visibleWidth, wrapCode, wrapText, wrapTextStable } from './width.ts'

export type { MarkdownStyle } from './md-style.ts'

interface MathToken {
  type: 'math'
  raw: string
  text: string
  display?: boolean
  pending?: boolean
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
    const indexes = [src.indexOf('$$'), src.indexOf('\\[')].filter(index => index >= 0)
    return indexes.length === 0 ? undefined : Math.min(...indexes)
  },
  tokenizer(src) {
    const match = /^ {0,3}(?:\$\$[ \t]*\n?([\s\S]*?)\n?\$\$|\\\[[ \t]*\n?([\s\S]*?)\n?\\\])[ \t]*(?:\n+|$)/u.exec(src)
    if (match !== null) return { type: 'math', raw: match[0], text: (match[1] ?? match[2] ?? '').trim(), display: true }
    if (/^ {0,3}(?:\$\$|\\\[)/u.test(src)) return { type: 'math', raw: src, text: src, display: true, pending: true }
    return undefined
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
      return { type: 'math', raw: src, text: src, pending: true }
    }
    if (src.startsWith('\\[')) {
      const end = src.indexOf('\\]', 2)
      if (end !== -1 && src.slice(2, end).trim() !== '') {
        return { type: 'math', raw: src.slice(0, end + 2), text: src.slice(2, end).trim(), display: true }
      }
      return { type: 'math', raw: src, text: src, pending: true }
    }
    if (!src.startsWith('$')) return undefined
    if (src[1] === '(' || src[1] === '{') return undefined
    const end = inlineMathSpanEnd(src, 0)
    if (end === -1) return /[\\^_]/u.test(src.slice(1)) ? { type: 'math', raw: src, text: src, pending: true } : undefined
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
  return clampNesting(source.replaceAll('\r\n', '\n').replaceAll('\r', '\n'))
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
  // Mask fences before code spans: a backtick string inside a fence is not its
  // closing delimiter. Preserve multiline code spans before clamping prose.
  let marker = '\u0000code'
  while (source.includes(marker)) marker += '\u0000'
  const code: string[] = []
  const protect = (text: string): string => `${marker}${code.push(text) - 1}\u0000`
  let fence: string | undefined
  const masked: string[] = [], buffer: string[] = []
  for (const line of source.split('\n')) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line)
    if (fence !== undefined) {
      buffer.push(line)
      if (fenceMatch?.[1] !== undefined
        && fenceMatch[1].startsWith(fence[0] ?? '')
        && fenceMatch[1].length >= fence.length
        && line.slice(fenceMatch[0].length).trim() === '') {
        masked.push(protect(buffer.join('\n'))); buffer.length = 0; fence = undefined
      }
    } else if (fenceMatch?.[1] !== undefined) {
      fence = fenceMatch[1]; buffer.push(line)
    } else masked.push(line)
  }
  if (buffer.length > 0) masked.push(protect(buffer.join('\n')))
  source = masked.join('\n').replace(/(?<!`)(`+)(?!`)([^\u0000]*?)(?<!`)\1(?!`)/gu, protect)
  source = source.replace(/(?<!\\)(?:\$\$[\s\S]*?(?:\$\$|$)|\\\([\s\S]*?(?:\\\)|$)|\\\[[\s\S]*?(?:\\\]|$)|\$(?![\s${(])(?:\\.|[^\n$])*?(?:\$(?!\d)|$))/gu, match => {
    const singleDollar = match.startsWith('$') && !match.startsWith('$$')
    return singleDollar && inlineMathSpanEnd(match, 0) < 0 && !/[\\^_]/u.test(match.slice(1)) ? match : protect(match)
  })
  const bounded = source.split('\n').map((line) => {
    if (line.startsWith(marker)) return line
    if (/^(?: {4}|\t)/u.test(line) && !/^\s*(?:[-+*]|\d+[.)])\s/u.test(line)) return line
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
  const restore = (value: string): string => value.replace(new RegExp(`${marker}(\\d+)\u0000`, 'gu'), (_match, at: string) => code[Number(at)]!)
  // A math span can contain a previously masked code span.
  return restore(restore(bounded))
}

function isProseCodespan(text: string): boolean {
  const words = text.trim().split(/\s+/u).filter(Boolean)
  return words.length >= 4 || (words.length >= 2 && /[,;]/.test(text))
}

function renderMath(token: MathToken, theme: Theme, style?: MarkdownStyle, width?: number): string[] {
  const rows = token.pending === true || style?.mathMode === 'source' ? undefined : mathLayout(token.text, token.display === true && width !== undefined, width)
  return (rows ?? token.raw.trimEnd().split('\n')).map(row => paintFg(theme, ink(style, 'mdCode'), row, style))
}

function decodeEntities(text: string): string {
  return text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&nbsp;', ' ')
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
      out += renderMath(token, theme, style).join('\n')
      continue
    }
    switch (token.type) {
      case 'escape':
        out += paintBase(theme, token.text, style)
        break
      case 'text':
        out += token.tokens === undefined
          ? paintBase(theme, decodeEntities(flattenText(token.text)), style)
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
      case 'html':
        out += paintBase(theme, normalizeHtml(token.text), style)
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

const tableSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function renderTable(token: Tokens.Table, theme: Theme, width: number): string[] {
  const renderCell = (cell: Tokens.TableCell): string => expandTabs(renderInlineTokens(cell.tokens, theme), 8, 0)
  const header = token.header.map(renderCell)
  const rows = token.rows.map(row => row.map(renderCell))
  const cols = header.length
  if (cols === 0) return []
  const borderOverhead = 3 * cols + 1
  const available = width - borderOverhead
  const fallback = (): string[] => {
    if (rows.length === 0 || width < 8) return wrapTextStable(theme.fg('dim', token.raw.trimEnd()), width)
    return rows.flatMap((row, at) => [
      ...(at === 0 ? [] : ['']),
      ...header.flatMap((key, col) => wrapTextStable(theme.bold(key || `Column ${col + 1}`) + ': ' + (row[col] ?? ''), width)),
    ])
  }
  if (available < cols) return fallback()

  const columns = Array.from({ length: cols }, (_, i) => [header[i] ?? '', ...rows.map(row => row[i] ?? '')])
  // A wide grapheme cannot be split into a one-cell column.
  const floors = columns.map(cells => Math.max(1, ...cells.map(text => {
    let widest = 1
    for (const { segment } of tableSegmenter.segment(stripAnsi(text))) widest = Math.max(widest, graphemeWidth(segment))
    return widest
  })))
  const floorTotal = floors.reduce((total, value) => total + value, 0)
  if (available < floorTotal) return fallback()

  const natural = columns.map(cells => Math.max(1, ...cells.flatMap(text => text.split('\n').map(visibleWidth))))
  const longestWord = (text: string): number => Math.min(
    30,
    Math.max(1, ...text.split(/\s+/u).filter(Boolean).map(word => visibleWidth(word))),
  )
  let minimums = columns.map((cells, i) => Math.max(floors[i] ?? 1, ...cells.map(longestWord)))
  let minimumTotal = minimums.reduce((total, value) => total + value, 0)
  if (minimumTotal > available) {
    const remaining = available - floorTotal
    const weight = minimums.reduce((total, value, i) => total + Math.max(0, value - (floors[i] ?? 1)), 0)
    minimums = minimums.map((value, i) => (floors[i] ?? 1) + (weight > 0
      ? Math.floor((Math.max(0, value - (floors[i] ?? 1)) / weight) * remaining)
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

  if (widths.some((value, col) => value < Math.min(4, natural[col] ?? 1)
    || value < 12 && rows.some(row => wrapTextStable(row[col] ?? '', value).length > 8))) return fallback()

  const h = BOX.horizontal
  const v = theme.fg('borderMuted', BOX.vertical)
  const join = (left: string, fill: string[], mid: string, right: string): string =>
    theme.fg('borderMuted', left + h + fill.join(h + mid + h) + h + right)
  const wrapCell = (text: string, col: number): string[] => wrapTextStable(text, widths[col] ?? 1)
  const paintRow = (cells: string[][], emphasize: boolean): string[] => {
    const height = Math.max(1, ...cells.map(parts => parts.length))
    const out: string[] = []
    for (let row = 0; row < height; row += 1) {
      const parts = cells.map((parts, i) => {
        const text = parts[row] ?? ''
        const gap = Math.max(0, (widths[i] ?? 1) - visibleWidth(text))
        const align = token.align[i]
        const left = align === 'right' ? gap : align === 'center' ? Math.floor(gap / 2) : 0
        const ink = emphasize ? theme.bold(text) : text
        // Each wrapped cell ends before padding and borders; the next segment
        // reopens its own style and hyperlink instead of inheriting a neighbor.
        const reset = theme.colors ? '\x1b[22;23;24;27;29;39m\x1b]8;;\x07' : ''
        return ' '.repeat(left) + ink + reset + ' '.repeat(gap - left)
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

/**
 * A fenced code block: its lines behind a rail, with no fences.
 *
 * The fences are markdown's syntax, not the reader's content, and printing them
 * made every code block look like a render that had not finished. A rail in the
 * block-border ink says "this is code" in one column and holds for every
 * wrapped row, so a long line that wraps still reads as part of the block.
 */
function renderCode(token: Tokens.Code, theme: Theme, width: number, style?: MarkdownStyle): string[] {
  const lang = (token.lang ?? '').trim()
  const rows = token.text.split('\n')
  const gutter = width > CODE_GUTTER ? CODE_GUTTER : width > 2 ? 2 : width > 1 ? 1 : 0
  const rail = theme.fg(ink(style, 'mdCodeBlockBorder'), gutter === 4 ? '  │ ' : gutter === 2 ? '│ ' : gutter === 1 ? '│' : '')
  const inner = Math.max(1, width - gutter)
  if (lang.toLowerCase() === 'mermaid' && style?.mermaidMode !== 'source'
    && style?.color !== 'thinkingText' && closedFence(token.raw)) {
    const diagram = mermaidLines(token.text, theme, inner, style)
    if (diagram !== undefined) return diagram.map(row => rail + row)
  }
  const highlighted = highlightCodeLines(rows, lang, theme, style)
  const lines: string[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const body = highlighted[i] ?? ''
    // Tabs resolve against the column the rail already occupies.
    const wrapped = wrapCode(expandTabs(body, 8, gutter), inner)
    for (const line of wrapped) lines.push(rail + (visibleWidth(line) > inner ? sliceCells(line, 0, inner) : line)
      + (theme.colors ? '\x1b[39m' + openBase(theme, style) : ''))
  }
  return lines
}

/** Cells a code block's rail takes before the code: two of margin, the rail, one of gap. */
const CODE_GUTTER = 4

function closedFence(raw: string): boolean {
  const opening = /^ {0,3}(`{3,}|~{3,})[^\n]*\n/u.exec(raw)
  if (opening === null) return false
  const fence = opening[1]!
  const closing = raw.trimEnd().slice(opening[0].length).split('\n').at(-1) ?? ''
  return new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`, 'u').test(closing)
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
    const pad = width > 4 ? '  ' : ''
    return renderMath(token, theme, style, Math.max(1, width - pad.length)).flatMap(row => wrapStyled(pad + row, width))
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
        if (stripped === '') return []
        return stripped === token.text.trim() ? wrapStyled(paintBase(theme, stripped, style), width) : renderMarkdown(stripped, theme, width, style)
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
