/**
 * Rounded-box chrome ported from oh-my-pi: framed tool output, the welcome
 * card, and the framed editor whose top border carries the status line.
 * @module @omdsh/tui
 */

import { BOX, DEEPSEEK_LOGO, gradientLogo, type Theme, type ThemeColor } from './theme.ts'
import { expandTabs, padToWidth, padding, truncateToWidth, visibleWidth, wrapIndexed, wrapText, cursorOnWrapped, indexOnWrapped } from './width.ts'

/** Visual state that drives border + fill color. */
export type BoxState = 'idle' | 'running' | 'ok' | 'error' | 'warning'

function borderColorFor(state: BoxState | undefined): ThemeColor {
  if (state === 'error') return 'error'
  if (state === 'warning') return 'warning'
  if (state === 'running') return 'accent'
  return 'dim'
}

function bgColorFor(state: BoxState | undefined): ThemeColor | undefined {
  if (state === 'error') return 'toolErrorBg'
  if (state === 'running') return 'toolPendingBg'
  if (state === 'ok') return 'toolSuccessBg'
  return undefined
}

function applyBg(line: string, theme: Theme, color: ThemeColor, width: number): string {
  const ansi = theme.getBgAnsi(color)
  if (ansi === '') return padToWidth(line, width)
  const padded = padToWidth(line, width)
  const restabilized = padded
    .replace(/\x1b\[(?:0)?m/g, (match) => match + ansi)
    .replace(/\x1b\[49m/g, (match) => match + ansi)
  return ansi + restabilized + '\x1b[49m'
}

function centerText(text: string, width: number): string {
  const vis = visibleWidth(text)
  if (vis >= width) return truncateToWidth(text, width)
  const left = Math.floor((width - vis) / 2)
  return padding(left) + text + padding(width - vis - left)
}

function fitToWidth(text: string, width: number): string {
  const vis = visibleWidth(text)
  if (vis > width) return truncateToWidth(text, width)
  return text + padding(width - vis)
}

/** Options for a rounded output block (tool / notice). */
export interface FramedBlockOptions {
  header?: string
  headerMeta?: string
  state?: BoxState
  lines?: readonly string[]
  width: number
  applyBg?: boolean
}

/**
 * OMP `renderOutputBlock`: `╭─── header ────╮` / padded body / `╰────╯`.
 */
export function renderFramedBlock(options: FramedBlockOptions, theme: Theme): string[] {
  const width = Math.max(0, options.width)
  const h = BOX.horizontal
  const v = BOX.vertical
  const color = borderColorFor(options.state)
  const border = (text: string): string => theme.fg(color, text)
  const bg = options.applyBg === false ? undefined : bgColorFor(options.state)
  const paint = (line: string): string => (bg ? applyBg(line, theme, bg, width) : padToWidth(line, width))

  const cap = h.repeat(3)
  const labelParts = [options.header, options.headerMeta].filter((part): part is string => Boolean(part))
  const labelChromeWidth = visibleWidth(BOX.topLeft + cap + '  ' + cap + BOX.topRight)
  const top = labelParts.length === 0 || width < labelChromeWidth
    ? border(BOX.topLeft + h.repeat(Math.max(0, width - 2)) + BOX.topRight)
    : (() => {
        // The spaces and three-glyph caps belong to the frame, not the label's
        // truncation budget. A long command can consume only the middle span.
        const maxLabel = Math.max(0, width - labelChromeWidth)
        const label = truncateToWidth(labelParts.join(' · '), maxLabel)
        const fill = Math.max(0, maxLabel - visibleWidth(label))
        return border(BOX.topLeft + cap) + ' ' + label + ' ' + border(h.repeat(fill) + cap + BOX.topRight)
      })()

  const contentWidth = Math.max(1, width - 4)
  const body: string[] = []
  for (const raw of options.lines ?? []) {
    for (const wrapped of wrapText(expandTabs(raw, 8, 2), contentWidth)) {
      body.push(border(v) + ' ' + padToWidth(wrapped, contentWidth) + ' ' + border(v))
    }
  }

  const bottomFill = Math.max(0, width - 2)
  const bottom = border(BOX.bottomLeft + h.repeat(bottomFill) + BOX.bottomRight)
  return [paint(top), ...body.map(paint), paint(bottom)]
}

/** Welcome card inputs. */
export interface WelcomeOptions {
  width: number
  model: string
  provider: string
  version: string
  appName: string
  recentSessions?: readonly { id: string; title: string }[]
}

/**
 * Two-column welcome card: gradient DeepSeek logo + tips, titled `app vversion`.
 */
export function renderWelcome(options: WelcomeOptions, theme: Theme): string[] {
  const boxWidth = Math.min(100, Math.max(0, options.width))
  if (boxWidth < 8) return []
  const dualContentWidth = boxWidth - 3
  const minLeft = visibleWidth(DEEPSEEK_LOGO[0]) + 2
  const minRight = 20
  const desiredLeft = Math.min(26, Math.max(minLeft, Math.floor(dualContentWidth * 0.35)))
  const showRight = dualContentWidth >= minRight + minLeft
  const leftCol = showRight ? Math.min(desiredLeft, dualContentWidth - minRight) : boxWidth - 2
  const rightCol = showRight ? Math.max(1, dualContentWidth - leftCol) : 0

  const logo = gradientLogo(theme, DEEPSEEK_LOGO)
  const leftLines = [
    centerText(theme.bold('Into the Unknown'), leftCol),
    '',
    ...logo.map((line) => centerText(line, leftCol)),
    '',
    centerText(theme.fg('muted', options.model), leftCol),
    centerText(theme.fg('dim', options.provider), leftCol),
  ]

  const sep = rightCol > 2 ? ` ${theme.fg('dim', BOX.horizontal.repeat(Math.max(0, rightCol - 2)))}` : ''
  const rightLines = showRight
    ? [
      ` ${theme.bold(theme.fg('accent', 'Tips'))}`,
      ` ${theme.fg('dim', '↵')}${theme.fg('muted', '  submit')}`,
      ` ${theme.fg('dim', '⌥↵')}${theme.fg('muted', ' newline')}`,
      ` ${theme.fg('dim', '^C×2')}${theme.fg('muted', ' exit')}`,
      ` ${theme.fg('dim', '^D')}${theme.fg('muted', ' quit')}`,
      ` ${theme.fg('dim', '↑↓')}${theme.fg('muted', ' history')}`,
      ` ${theme.fg('dim', 'Pg↑')}${theme.fg('muted', ' scroll')}`,
      ` ${theme.fg('dim', '^R')}${theme.fg('muted', ' search')}`,
      ` ${theme.fg('dim', '/')}${theme.fg('muted', '  commands')}`,
      ` ${theme.fg('dim', '⇥')}${theme.fg('muted', ' complete')}`,
      sep,
      ` ${theme.bold(theme.fg('accent', 'Recent sessions'))}`,
      ...(options.recentSessions === undefined || options.recentSessions.length === 0
        ? [` ${theme.fg('dim', 'No recent sessions')}`]
        : options.recentSessions.slice(0, 3).map((session) =>
          ` ${theme.fg('muted', truncateToWidth(session.title || session.id, Math.max(1, rightCol - 2)))}`)),
    ]
    : []

  const h = theme.fg('dim', BOX.horizontal)
  const v = theme.fg('dim', BOX.vertical)
  const tl = theme.fg('dim', BOX.topLeft)
  const tr = theme.fg('dim', BOX.topRight)
  const bl = theme.fg('dim', BOX.bottomLeft)
  const br = theme.fg('dim', BOX.bottomRight)
  const tee = theme.fg('dim', BOX.teeUp)

  const title = ` ${options.appName} v${options.version} `
  const titlePrefix = BOX.horizontal.repeat(3)
  const titleStyled = theme.fg('dim', titlePrefix) + theme.fg('muted', title)
  const titleSpace = boxWidth - 2
  const afterTitle = Math.max(0, titleSpace - visibleWidth(titlePrefix) - visibleWidth(title))
  const lines: string[] = [
    tl + (visibleWidth(titleStyled) >= titleSpace
      ? truncateToWidth(titleStyled, titleSpace)
      : titleStyled + theme.fg('dim', BOX.horizontal.repeat(afterTitle))) + tr,
  ]

  const rows = showRight ? Math.max(leftLines.length, rightLines.length) : leftLines.length
  for (let i = 0; i < rows; i += 1) {
    const left = fitToWidth(leftLines[i] ?? '', leftCol)
    if (showRight) {
      lines.push(v + left + v + fitToWidth(rightLines[i] ?? '', rightCol) + v)
    } else {
      lines.push(v + left + v)
    }
  }
  if (showRight) {
    lines.push(bl + h.repeat(leftCol) + tee + h.repeat(rightCol) + br)
  } else {
    lines.push(bl + h.repeat(leftCol) + br)
  }

  const tipLabel = theme.italic(theme.fg('customMessageLabel', 'Tip: '))
  const tipBody = theme.italic(theme.fg('muted', 'Type / for commands, or a message to start.'))
  lines.push(' ' + tipLabel + tipBody)
  return lines
}

/** Editor chrome inputs. */
export interface EditorOptions {
  width: number
  input: string
  inputCursor: number
  status: string
  /** Session telemetry embedded in the bottom border. */
  footer?: string
  border: ThemeColor
  /** Dim ghost text painted after the caret (slash-arg hint). */
  inlineHint?: string
}

/** Editor frame plus a cursor offset relative to the editor's first row. */
export interface EditorFrame {
  lines: string[]
  cursor: { row: number; column: number }
}

/**
 * Rounded editor: status lives in the top border, input occupies one or more
 * body rows, and a dedicated bottom border keeps the cursor off the chrome.
 */
export function renderEditor(options: EditorOptions, theme: Theme): EditorFrame {
  const width = Math.max(4, options.width)
  const padX = 1
  const contentWidth = Math.max(1, width - 2 - padX * 2)
  const h = BOX.horizontal
  const border = (text: string): string => theme.fg(options.border, text)

  const topLeft = border(BOX.topLeft + h.repeat(padX))
  const topRight = border(h.repeat(padX) + BOX.topRight)
  const fillWidth = Math.max(0, width - visibleWidth(BOX.topLeft + h.repeat(padX)) - visibleWidth(h.repeat(padX) + BOX.topRight))
  const status = truncateToWidth(options.status, fillWidth)
  const statusFill = Math.max(0, fillWidth - visibleWidth(status))
  const top = topLeft + status + border(h.repeat(statusFill)) + topRight

  const layout = wrapIndexed(options.input, contentWidth)
  const caret = cursorOnWrapped(layout, options.inputCursor, options.input)
  const rows = layout.length > 0 ? layout : [{ text: '', start: 0, end: 0 }]

  const lines = [top]
  for (let i = 0; i < rows.length; i += 1) {
    const text = rows[i]?.text ?? ''
    const hint = options.inlineHint
    const atCaretEnd = i === caret.row && caret.column >= visibleWidth(text)
    let body = text
    if (atCaretEnd && hint !== undefined && hint !== '') {
      const budget = Math.max(0, contentWidth - visibleWidth(text))
      if (budget > 0) body = text + theme.fg('dim', truncateToWidth(hint, budget))
    }
    const linePad = padding(Math.max(0, contentWidth - visibleWidth(body)))
    const left = border(BOX.vertical) + padding(padX)
    const right = padding(padX) + border(BOX.vertical)
    lines.push(left + body + linePad + right)
  }
  const bottomLeft = border(BOX.bottomLeft + h.repeat(padX))
  const bottomRight = border(h.repeat(padX) + BOX.bottomRight)
  const footer = truncateToWidth(options.footer ?? '', fillWidth)
  const footerFill = Math.max(0, fillWidth - visibleWidth(footer))
  lines.push(bottomLeft + footer + border(h.repeat(footerFill)) + bottomRight)

  return {
    lines,
    cursor: { row: 1 + caret.row, column: 2 + caret.column },
  }
}

/** Columns of left chrome before input text (`│ `). */
export const EDITOR_CONTENT_COL = 2

/**
 * Map a click in editor-local coordinates to a buffer index.
 * Row 0 is the status cap (no hit). Undefined when the click is outside.
 */
export function hitTestEditor(input: string, width: number, localRow: number, col: number): number | undefined {
  if (localRow < 1) return undefined
  const contentWidth = Math.max(1, Math.max(4, width) - 2 - 2)
  const layout = wrapIndexed(input, contentWidth)
  const rows = layout.length > 0 ? layout : [{ text: '', start: 0, end: 0 }]
  if (localRow > rows.length) return undefined
  const row = localRow - 1
  const line = rows[row]
  if (line === undefined) return 0
  return indexOnWrapped(line, col - EDITOR_CONTENT_COL, input)
}

/**
 * OMP "Working..." row that sits above the editor while a turn is in flight.
 */
export function renderWorking(theme: Theme, spinnerFrame: number): string[] {
  const frame = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][spinnerFrame % 10] ?? '⠋'
  return [' ' + theme.fg('accent', frame) + ' ' + theme.fg('muted', 'Working... (ctrl-c to interrupt)')]
}

/** Build the ` icon · model · status · pwd · branch ` label in the editor cap. */
export function editorStatusLabel(
  theme: Theme,
  parts: { appName: string; model: string; status: string; pwd: string; branch?: string },
): string {
  const items = [parts.appName, parts.model, parts.status]
  if (parts.pwd !== '') items.push(parts.pwd)
  if (parts.branch !== undefined && parts.branch !== '') items.push(parts.branch)
  const sep = theme.fg('dim', ' · ')
  const painted = items.map((item, index) => {
    if (index === 2 && parts.status.startsWith('running')) return theme.fg('warning', item)
    if (index === 0) return theme.fg('accent', item)
    return theme.fg('muted', item)
  })
  return ' ' + painted.join(sep) + ' '
}
