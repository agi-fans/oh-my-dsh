/**
 * Compact markdown → terminal lines. Enough of OMP's Markdown component for
 * the transcript: headings, emphasis, links, strikethrough, inline/fenced
 * code, nested/task lists, quotes, tables, hr.
 * @module @agi-fans/dsh-tui
 */

import { BOX, type Theme } from './theme.ts'
import { padToWidth, visibleWidth, wrapText } from './width.ts'

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const HEADING = /^(#{1,6})\s+(.*)$/
const UL = /^(\s*)([-*+])\s+(.*)$/
const OL = /^(\s*)(\d+)[.)]\s+(.*)$/
const TASK = /^\[([ xX])\]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const HR = /^(?:-{3,}|_{3,}|\*{3,})\s*$/
const TABLE_SEP = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/
const AUTOLINK = /^(https?:\/\/[^\s<]+|www\.[^\s<]+)/
const LINK = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/
const MATH_SYMBOLS: Readonly<Record<string, string>> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', lambda: 'λ', mu: 'μ',
  pi: 'π', sigma: 'σ', phi: 'φ', omega: 'ω', times: '×', cdot: '·', le: '≤', ge: '≥',
  neq: '≠', approx: '≈', infty: '∞', sum: '∑', int: '∫', sqrt: '√', to: '→',
}
const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻',
}

function normalizeHtml(source: string): string {
  return source
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>/giu, '\n')
    .replace(/<li(?:\s[^>]*)?>/giu, '- ')
    .replace(/<\/?(?:a|b|blockquote|code|details|div|em|h[1-6]|i|ol|p|pre|span|strong|summary|table|tbody|td|th|thead|tr|u|ul)(?:\s[^>]*)?>/giu, '')
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&nbsp;', ' ')
}

function renderMath(value: string, theme: Theme): string {
  const normalized = value
    .replace(/\\([A-Za-z]+)/gu, (whole, name: string) => MATH_SYMBOLS[name] ?? whole)
    .replace(/\^\{?([0-9+-]+)\}?/gu, (_whole, body: string) =>
      [...body].map(char => SUPERSCRIPT[char] ?? char).join(''))
    .replace(/_\{([^}]+)\}/gu, '₍$1₎')
  return theme.fg('mdCode', normalized)
}

function highlightCode(row: string, language: string, theme: Theme): string {
  if (!theme.colors || language === '') return theme.fg('mdCode', row)
  const supported = /^(?:js|jsx|ts|tsx|javascript|typescript|json|python|py|bash|sh|shell|rust|go|java|css|html)$/u.test(language)
  if (!supported) return theme.fg('mdCode', row)
  return row.split(/(\s+|\b)/u).map(token => {
    if (/^(?:const|let|var|function|class|interface|type|return|if|else|for|while|async|await|import|export|from|def|fn|struct|package|func|true|false|null|undefined)$/u.test(token)) {
      return theme.fg('accent', token)
    }
    if (/^(?:\d+(?:\.\d+)?|"[^"]*"|'[^']*')$/u.test(token)) return theme.fg('mdCode', token)
    return token
  }).join('')
}

function renderMermaid(rows: readonly string[], theme: Theme, width: number): string[] {
  const output: string[] = []
  for (const raw of rows) {
    const row = raw.trim()
    if (row === '' || /^(?:graph|flowchart|sequenceDiagram)\b/u.test(row)) continue
    const sequence = /^([^:]+?)-+>>?([^:]+):\s*(.+)$/u.exec(row)
    const edge = /^(.+?)-+(?:>|\|[^|]*\|)(.+)$/u.exec(row)
    const text = sequence
      ? `${sequence[1]?.trim()} → ${sequence[2]?.trim()}: ${sequence[3]?.trim()}`
      : edge
        ? `${edge[1]?.replace(/[\[\](){}]/gu, '').trim()} → ${edge[2]?.replace(/[\[\](){}]/gu, '').trim()}`
        : row
    output.push(...wrapStyled('  ' + theme.fg('mdCode', text), width))
  }
  return output.length > 0 ? output : [theme.fg('dim', '  (empty Mermaid diagram)')]
}

function wrapStyled(text: string, width: number): string[] {
  return wrapText(text, Math.max(1, width))
}

function indentLevel(ws: string): number {
  let n = 0
  for (const ch of ws) n += ch === '\t' ? 2 : 1
  return Math.floor(n / 2)
}

function trimAutolink(raw: string): string {
  let url = raw
  while (url.length > 0 && /[.,;:!?)\]]$/.test(url)) url = url.slice(0, -1)
  return url
}

function safeHref(href: string): string {
  return href.replaceAll('\x1b', '').replaceAll('\x07', '')
}

function hyperlink(label: string, href: string, theme: Theme): string {
  const target = safeHref(href)
  if (!theme.colors || target === '') return label
  return `\x1b]8;;${target}\x07${label}\x1b]8;;\x07`
}

function paintLink(label: string, href: string, theme: Theme): string {
  const target = href.startsWith('www.') ? 'https://' + href : href
  const styled = theme.fg('mdLink', theme.underline(label))
  const clickable = hyperlink(styled, target, theme)
  if (label === href || label === target) return clickable
  const url = hyperlink(theme.fg('mdLinkUrl', '(' + href + ')'), target, theme)
  return clickable + ' ' + url
}

function matchUnderscore(rest: string, delim: string, prev: string): { raw: string; body: string } | undefined {
  if (!rest.startsWith(delim)) return undefined
  if (prev !== '' && /\w/.test(prev)) return undefined
  const close = rest.indexOf(delim, delim.length)
  if (close < delim.length) return undefined
  const body = rest.slice(delim.length, close)
  if (body === '' || /^\s/.test(body) || /\s$/.test(body)) return undefined
  const after = rest[close + delim.length] ?? ''
  if (after !== '' && /\w/.test(after)) return undefined
  return { raw: rest.slice(0, close + delim.length), body }
}

/** Inline markdown: code, links, strike, bold, italic. */
export function renderInline(text: string, theme: Theme): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    const prev = i > 0 ? (text[i - 1] ?? '') : ''

    const code = rest.match(/^`([^`]+)`/)
    if (code) {
      out += theme.fg('mdCode', code[1] ?? '')
      i += code[0].length
      continue
    }

    const math = rest.match(/^\$([^$\n]+)\$/u)
    if (math) {
      out += renderMath(math[1] ?? '', theme)
      i += math[0].length
      continue
    }

    const link = LINK.exec(rest)
    if (link) {
      out += paintLink(renderInline(link[1] ?? '', theme), link[2] ?? '', theme)
      i += link[0].length
      continue
    }

    const auto = AUTOLINK.exec(rest)
    if (auto) {
      const url = trimAutolink(auto[1] ?? '')
      if (url.length > 3) {
        out += paintLink(url, url, theme)
        i += url.length
        continue
      }
    }

    const strike = rest.match(/^~~([^~]+)~~/)
    if (strike) {
      out += theme.strikethrough(renderInline(strike[1] ?? '', theme))
      i += strike[0].length
      continue
    }

    const starBold = rest.match(/^\*\*([^*]+)\*\*/)
    if (starBold) {
      out += theme.bold(renderInline(starBold[1] ?? '', theme))
      i += starBold[0].length
      continue
    }

    const underBold = matchUnderscore(rest, '__', prev)
    if (underBold) {
      out += theme.bold(renderInline(underBold.body, theme))
      i += underBold.raw.length
      continue
    }

    const starItalic = rest.match(/^\*([^*]+)\*/)
    if (starItalic) {
      out += theme.italic(renderInline(starItalic[1] ?? '', theme))
      i += starItalic[0].length
      continue
    }

    const underItalic = matchUnderscore(rest, '_', prev)
    if (underItalic) {
      out += theme.italic(renderInline(underItalic.body, theme))
      i += underItalic.raw.length
      continue
    }

    out += rest[0]
    i += 1
  }
  return out
}

function splitTableRow(line: string): string[] {
  let body = line.trim()
  if (body.startsWith('|')) body = body.slice(1)
  if (body.endsWith('|')) body = body.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  let escaped = false
  for (const char of body) {
    if (escaped) {
      cell += char === '|' ? '|' : '\\' + char
      escaped = false
    } else if (char === '\\') {
      escaped = true
    } else if (char === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  if (escaped) cell += '\\'
  cells.push(cell.trim())
  return cells
}

function isTableRow(line: string): boolean {
  if (line.trim() === '' || FENCE.test(line) || HEADING.test(line)) return false
  return line.includes('|')
}

function renderTable(header: string[], rows: string[][], theme: Theme, width: number): string[] {
  const cols = header.length
  if (cols === 0) return []
  const norm = (row: string[]): string[] => Array.from({ length: cols }, (_, i) => row[i] ?? '')
  const paintedHeader = header.map((cell) => theme.bold(renderInline(cell, theme)))
  const paintedRows = rows.map((row) => norm(row).map((cell) => renderInline(cell, theme)))
  const borderOverhead = 3 * cols + 1
  const available = width - borderOverhead
  if (available < cols) {
    const raw = ['| ' + header.join(' | ') + ' |', ...rows.map((row) => '| ' + norm(row).join(' | ') + ' |')]
    return raw.flatMap((line) => wrapStyled(theme.fg('dim', line), width))
  }

  const natural = Array.from({ length: cols }, (_, i) => {
    let max = visibleWidth(paintedHeader[i] ?? '')
    for (const row of paintedRows) max = Math.max(max, visibleWidth(row[i] ?? ''))
    return Math.max(1, max)
  })
  const longestWord = (text: string): number => Math.min(
    30,
    Math.max(1, ...text.split(/\s+/u).filter(Boolean).map(word => visibleWidth(word))),
  )
  let minimums = Array.from({ length: cols }, (_, i) => {
    let max = longestWord(paintedHeader[i] ?? '')
    for (const row of paintedRows) max = Math.max(max, longestWord(row[i] ?? ''))
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
  const v = theme.fg('dim', BOX.vertical)
  const join = (left: string, fill: string[], mid: string, right: string): string =>
    theme.fg('dim', left + h + fill.join(h + mid + h) + h + right)
  const wrapCell = (text: string, col: number): string[] => wrapText(text, widths[col] ?? 1)
  const paintRow = (cells: string[][], emphasize: boolean): string[] => {
    const height = Math.max(1, ...cells.map((parts) => parts.length))
    const out: string[] = []
    for (let r = 0; r < height; r += 1) {
      const parts = cells.map((parts, i) => {
        const text = parts[r] ?? ''
        const padded = padToWidth(text, widths[i] ?? 1)
        return emphasize ? theme.bold(padded) : padded
      })
      out.push(v + ' ' + parts.join(' ' + v + ' ') + ' ' + v)
    }
    return out
  }

  const fills = widths.map((w) => h.repeat(w))
  const headerCells = paintedHeader.map((cell, i) => wrapCell(cell, i))
  const lines = [
    join(BOX.topLeft, fills, BOX.teeDown, BOX.topRight),
    ...paintRow(headerCells, true),
    join(BOX.teeRight, fills, BOX.cross, BOX.teeLeft),
  ]
  for (let rowIndex = 0; rowIndex < paintedRows.length; rowIndex += 1) {
    const row = paintedRows[rowIndex] ?? []
    lines.push(...paintRow(row.map((cell, i) => wrapCell(cell, i)), false))
    if (rowIndex < paintedRows.length - 1) {
      lines.push(join(BOX.teeRight, fills, BOX.cross, BOX.teeLeft))
    }
  }
  lines.push(join(BOX.bottomLeft, fills, BOX.teeUp, BOX.bottomRight))
  return lines
}

function pushListItem(
  lines: string[],
  marker: string,
  body: string,
  theme: Theme,
  width: number,
  level: number,
): void {
  const pad = '  '.repeat(level)
  const inner = renderInline(body, theme)
  const markerWidth = visibleWidth(pad + marker)
  const wrapped = wrapStyled(inner, Math.max(1, width - markerWidth))
  lines.push(pad + marker + (wrapped[0] ?? ''))
  const hang = ' '.repeat(markerWidth)
  for (const part of wrapped.slice(1)) lines.push(hang + part)
}

/**
 * Render markdown to display lines already wrapped to `width`.
 */
export function renderMarkdown(source: string, theme: Theme, width: number): string[] {
  const lines: string[] = []
  const raw = normalizeHtml(source).replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  let fence: string | undefined
  let fenceLang = ''
  let fenceBuf: string[] = []

  const flushFence = (): void => {
    if (fenceLang === 'mermaid') {
      lines.push(...renderMermaid(fenceBuf, theme, width))
    } else {
    for (const row of fenceBuf) {
      const body = row === '' ? '' : highlightCode(row, fenceLang, theme)
      lines.push(...wrapStyled(body === '' ? '  ' : '  ' + body, width))
    }
    }
    lines.push(...wrapStyled(theme.fg('mdCodeBlockBorder', '  ```'), width))
    fenceBuf = []
    fence = undefined
    fenceLang = ''
  }

  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i] ?? ''
    const fenceMatch = FENCE.exec(row)
    if (fence !== undefined) {
      if (fenceMatch && (fenceMatch[2] ?? '').trim() === '' && (fenceMatch[1] ?? '').startsWith(fence[0] ?? '`')) {
        flushFence()
      } else {
        fenceBuf.push(row)
      }
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      const lang = (fenceMatch[2] ?? '').trim()
      fenceLang = lang.toLowerCase()
      lines.push(...wrapStyled(theme.fg('mdCodeBlockBorder', '  ```' + lang), width))
      continue
    }
    if (row.trim() === '$$') {
      const mathRows: string[] = []
      i += 1
      while (i < raw.length && (raw[i] ?? '').trim() !== '$$') {
        mathRows.push(raw[i] ?? '')
        i += 1
      }
      lines.push(...wrapStyled('  ' + renderMath(mathRows.join(' '), theme), width))
      continue
    }
    if (row === '') {
      lines.push('')
      continue
    }
    if (isTableRow(row) && raw[i + 1] !== undefined && TABLE_SEP.test(raw[i + 1] ?? '')) {
      const header = splitTableRow(row)
      const tableRows: string[][] = []
      i += 2
      while (i < raw.length && isTableRow(raw[i] ?? '') && !TABLE_SEP.test(raw[i] ?? '')) {
        tableRows.push(splitTableRow(raw[i] ?? ''))
        i += 1
      }
      i -= 1
      lines.push(...renderTable(header, tableRows, theme, width))
      continue
    }
    if (HR.test(row)) {
      lines.push(theme.fg('dim', '─'.repeat(Math.max(1, width))))
      continue
    }
    const heading = HEADING.exec(row)
    if (heading) {
      const title = heading[2] ?? ''
      lines.push(...wrapStyled(theme.bold(theme.fg('mdHeading', renderInline(title, theme))), width))
      continue
    }
    const quote = QUOTE.exec(row)
    if (quote) {
      const inner = renderInline(quote[1] ?? '', theme)
      const wrapped = wrapStyled(inner, Math.max(1, width - 2))
      for (const part of wrapped) lines.push(theme.fg('dim', '│ ') + part)
      continue
    }
    const ul = UL.exec(row)
    if (ul) {
      const level = indentLevel(ul[1] ?? '')
      const body = ul[3] ?? ''
      const task = TASK.exec(body)
      if (task) {
        const checked = (task[1] ?? ' ') !== ' '
        const mark = theme.fg('mdListBullet', checked ? '☑ ' : '☐ ')
        pushListItem(lines, mark, task[2] ?? '', theme, width, level)
      } else {
        pushListItem(lines, theme.fg('mdListBullet', '• '), body, theme, width, level)
      }
      continue
    }
    const ol = OL.exec(row)
    if (ol) {
      const level = indentLevel(ol[1] ?? '')
      const num = (ol[2] ?? '1') + '. '
      pushListItem(lines, theme.fg('mdListBullet', num), ol[3] ?? '', theme, width, level)
      continue
    }
    lines.push(...wrapStyled(renderInline(row, theme), width))
  }
  if (fence !== undefined) flushFence()
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  while (lines[0] === '') lines.shift()
  return lines
}
