/**
 * Rounded-box chrome ported from oh-my-pi: framed tool output, the welcome
 * card and the framed editor whose top border carries its compact label.
 * @module @agi-fans/dsh-tui
 */

import { BOX, DEEPSEEK_LOGO, gradientLogo, paintSurface, type Theme, type ThemeColor } from './theme.ts'
import { expandTabs, padToWidth, padding, truncateToWidth, visibleWidth, wrapIndexed, wrapTextStable, cursorOnWrapped } from './width.ts'
import { HINT_LABEL, WELCOME_HINTS, type WelcomeHint } from './welcome-tips.ts'

/** Visual state that drives border + fill color. */
export type BoxState = 'idle' | 'info' | 'running' | 'ok' | 'error' | 'warning'

function borderColorFor(state: BoxState | undefined): ThemeColor {
  if (state === 'info') return 'border'
  if (state === 'error') return 'error'
  if (state === 'warning') return 'warning'
  if (state === 'running') return 'accent'
  return 'borderMuted'
}

function bgColorFor(state: BoxState | undefined): ThemeColor | undefined {
  if (state === 'error') return 'toolErrorBg'
  if (state === 'running') return 'toolPendingBg'
  if (state === 'ok') return 'toolSuccessBg'
  return undefined
}

/** Options for a rounded output block (tool / notice). */
export interface FramedBlockOptions {
  header?: string
  headerMeta?: string
  state?: BoxState
  lines?: readonly string[]
  /** Left inset for the whole frame, used to nest a call inside its parent. */
  indent?: string
  /** Ordered body regions; labeled regions receive a full-width divider. */
  sections?: readonly { label?: string; lines: readonly string[] }[]
  width: number
  applyBg?: boolean
}

/**
 * OMP `renderOutputBlock`: `╭─── header ────╮` / padded body / `╰────╯`.
 */
export function renderFramedBlock(options: FramedBlockOptions, theme: Theme): string[] {
  const inset = options.indent ?? ''
  const width = Math.max(0, options.width)
  const h = BOX.horizontal
  const v = BOX.vertical
  const color = borderColorFor(options.state)
  const border = (text: string): string => theme.fg(color, text)
  const bg = options.applyBg === false ? undefined : bgColorFor(options.state)
  const paint = (line: string): string => {
    const indented = inset === '' ? line : inset + line
    return bg ? paintSurface(theme, bg, 'toolOutput', padToWidth(indented, width)) : padToWidth(indented, width)
  }

  const cap = h.repeat(3)
  const bar = (left: string, right: string, labelParts: readonly (string | undefined)[]): string => {
    const labels = labelParts.filter((part): part is string => Boolean(part))
    const labelChromeWidth = visibleWidth(left + cap + '  ' + cap + right)
    if (labels.length === 0 || width < labelChromeWidth) {
      return border(left + h.repeat(Math.max(0, width - 2)) + right)
    }
    // Spaces and three-glyph caps are frame chrome, not label budget. This
    // keeps both caps visible even when a command or section label is long.
    const maxLabel = Math.max(0, width - labelChromeWidth)
    const label = truncateToWidth(labels.join(' · '), maxLabel)
    const fill = Math.max(0, maxLabel - visibleWidth(label))
    return border(left + cap) + ' ' + label + ' ' + border(h.repeat(fill) + cap + right)
  }
  const top = bar(BOX.topLeft, BOX.topRight, [options.header, options.headerMeta])

  const contentWidth = Math.max(1, width - 4)
  const body: string[] = []
  const sections = options.sections ?? [{ lines: options.lines ?? [] }]
  for (const [index, section] of sections.entries()) {
    if (section.label !== undefined && (index > 0 || section.label !== '')) {
      body.push(bar(BOX.teeRight, BOX.teeLeft, [section.label]))
    }
    for (const raw of section.lines) {
      for (const wrapped of wrapTextStable(expandTabs(raw, 8, 2), contentWidth)) {
        body.push(border(v) + ' ' + padToWidth(wrapped, contentWidth) + ' ' + border(v))
      }
    }
  }

  const bottomFill = Math.max(0, width - 2)
  const bottom = border(BOX.bottomLeft + h.repeat(bottomFill) + BOX.bottomRight)
  return [paint(top), ...body.map(paint), paint(bottom)]
}

/** Header inputs. */
export interface WelcomeOptions {
  width: number
  /** Kept for callers that already resolve it; the compact header does not print it. */
  model?: string
  /** Kept for callers that already resolve it; the compact header does not print it. */
  reasoningEffort?: string
  version: string
  appName: string
  /** Kept for callers that already resolve it; the compact header has no session list. */
  recentSessions?: readonly { id: string; title: string; createdAt: number; updatedAt?: number }[]
  /** Startup hints; defaults to every entry in the shipped catalog. */
  hints?: readonly WelcomeHint[]
}

/** Gap between the mark and the wordmark beside it. */
const LOCKUP_GAP = 3

/**
 * Startup header: the DeepSeek mark beside the name, its version, and the
 * slogan, then one sampled hint.
 *
 * It is a lockup rather than a card. The previous header was a thirteen-row
 * bordered panel with a tips table, a recent-session list, and a second copy of
 * the model and effort the status footer already shows — most of a screen spent
 * before the reader has typed anything, and its rows were committed to native
 * scrollback where they stay. Nothing here repeats what the composer and footer
 * already say.
 *
 * The mark is the brand, so it stays at its source aspect ratio; below the width
 * that holds the lockup, the wordmark folds underneath rather than the mark
 * shrinking or the slogan being dropped.
 */
export function renderWelcome(options: WelcomeOptions, theme: Theme): string[] {
  const width = Math.max(0, options.width)
  if (width < 8) return []
  // One cell of breathing room: the mark's second row starts at column zero, so
  // without it the logo is welded to the terminal edge while every other surface
  // — the transcript, the composer, the footer — is inset or spaced.
  const margin = width > 24 ? 1 : 0
  const room = width - margin
  const logo = gradientLogo(theme, DEEPSEEK_LOGO)
  const logoWidth = Math.max(0, ...DEEPSEEK_LOGO.map((line) => visibleWidth(line)))
  const name = theme.bold(theme.fg('text', options.appName))
  const version = theme.fg('dim', `v${options.version}`)
  // Name and slogan as one bloc. The version rides with the name rather than on
  // its own row, so the bloc is two rows and centres cleanly against the mark.
  const wordmark = [`${name} ${version}`, theme.fg('muted', 'Into the Unknown')]
  const markWidth = Math.max(0, ...wordmark.map((line) => visibleWidth(line)))
  const lockupWidth = logoWidth + LOCKUP_GAP + markWidth
  const left = ' '.repeat(margin)

  const hints = hintLine(options.hints ?? WELCOME_HINTS, theme)
  if (lockupWidth <= room) {
    // The wordmark sits on the mark's vertical centre. Centring by height is what
    // makes the two read as one lockup; aligning their first rows left the name
    // riding high above the mark's visual mass.
    const offset = Math.max(0, Math.round((logo.length - wordmark.length) / 2))
    const lockup = logo.map((logoRow, row) => {
      const text = wordmark[row - offset]
      return (left + (text === undefined ? logoRow : logoRow + ' '.repeat(LOCKUP_GAP) + text)).replace(/\s+$/u, '')
    })
    // One blank row, then the hint. It costs a single row and replaces a whole
    // tips table, so the header still ends well inside a screen.
    if (hints !== '') lockup.push('', ...wrapTextStable(left + hints, width).map((line) => line.replace(/\s+$/u, '')))
    return lockup
  }

  const hintRows = hints === ''
    ? []
    : ['', ...wrapTextStable(left + hints, width).map((line) => line.replace(/\s+$/u, ''))]
  if (logoWidth <= room) {
    // Too narrow for both: the wordmark goes under the mark, still centred, and
    // the mark keeps its proportions.
    return [
      ...logo.map((line) => (left + line).replace(/\s+$/u, '')),
      '',
      ...wordmark.flatMap((line) => wrapTextStable(line, room))
        .map((line) => (left + line).replace(/\s+$/u, '')),
      ...hintRows,
    ]
  }

  // Narrower than the mark itself. A cropped logo is not the logo, so the header
  // falls back to the wordmark alone — the hint still survives, because it is the
  // only thing here that teaches a reader where to start.
  return [
    ...wordmark.flatMap((line) => wrapTextStable(line, room)).map((line) => line.replace(/\s+$/u, '')),
    ...hintRows,
  ]
}

/**
 * The hint line: a labelled lead, then each key with its words, `·` between.
 *
 * The label earns its two words. Without it the line reads as another row of
 * chrome — a few dim fragments under a logo — and a reader skips it. `Tips:`
 * in the accent ink says "this is advice about what you can do", which is the
 * only thing on the header that a reader has to decide to read.
 */
function hintLine(hints: readonly WelcomeHint[], theme: Theme): string {
  if (hints.length === 0) return ''
  // One space after the label, then `key text` entries joined by a separator
  // that carries its own spaces — so no entry opens with a second one.
  const entries = hints.map((hint) => theme.fg('dim', hint.key) + theme.fg('muted', ' ' + hint.text))
  return theme.bold(theme.fg('accent', HINT_LABEL))
    + ' ' + entries.join(theme.fg('borderMuted', ' · '))
}

/** Editor chrome inputs. */
export interface EditorOptions {
  width: number
  input: string
  inputCursor: number
  status: string
  /** Optional right-aligned cap on the top border (permission mode). */
  statusRight?: string
  border: ThemeColor
  /**
   * Activity drawn in the top border instead of as a row above the editor.
   *
   * The composer is where the reader is looking while they wait, so a spinner
   * that sits on its own row above the box costs a line and reads as a separate
   * component. `label` is empty only when the caller wants the spinner alone,
   * which is what a narrow terminal degrades to.
   */
  activity?: EditorActivity
  /** Animation frame, forwarded to the activity's shimmer when it has one. */
  spinnerFrame?: number
  /**
   * One line of confirmation drawn in the bottom border.
   *
   * Replaced rather than appended: what a key just did is a reading of the last
   * action, not a record of the conversation, so it belongs to the frame that
   * is already on screen.
   */
  note?: string
  /** Dim ghost text painted after the caret (slash-arg hint). */
  inlineHint?: string
  /** Paint one wrapped input slice without changing its visible width. */
  paintInput?: (text: string, sourceStart: number) => string
}

/** One in-flight activity shown in the composer's top border. */
export interface EditorActivity {
  /** Spinner frame, already resolved by the caller; `-1` stops the animation. */
  readonly frame: string
  readonly label: string
  /** Whether the label is painted with the driving shimmer. */
  readonly shimmer?: boolean
}

/** Editor frame plus a cursor offset relative to the editor's first row. */
export interface EditorFrame {
  lines: string[]
  cursor: { row: number; column: number }
}

/** The pieces {@link topBorderWithActivity} composes, already painted. */
interface TopBorderParts {
  readonly topLeft: string
  readonly topRight: string
  readonly status: string
  readonly trailing: string
  readonly fillWidth: number
  readonly border: (text: string) => string
  readonly theme: Theme
  readonly h: string
}

/**
 * Compose `╭─ ⠸ Deep Driving ─────────────────────────╮`.
 *
 * The border glyphs stay visible on both sides of the activity, so it reads as
 * part of the frame rather than as a label floating on it. Width is spent in a
 * fixed order — the activity label, then the spinner alone — so a narrow
 * terminal still shows that work is happening.
 *
 * The frame carries the activity and nothing else. A cancel hint used to sit on
 * the right of it, but `Esc` is the universal "stop this" key everywhere in the
 * TUI; printing it on every running turn was a permanent reminder of something
 * a reader already knows, and it pushed the access level off the right corner.
 */
function topBorderWithActivity(options: EditorOptions, parts: TopBorderParts): string {
  const { topLeft, topRight, status, trailing, fillWidth, border, theme, h } = parts
  const activity = options.activity!
  const width = fillWidth + 4
  /**
   * `head` and `tail` are measured, never estimated: the fill is whatever is
   * left after them. Anything else either overflows the frame — which the
   * renderer then truncates, eating the closing corner — or leaves a gap.
   */
  const assemble = (label: string): string => {
    const tail = trailing + topRight
    const head = topLeft + status + border(h + ' ') + label
    const rest = Math.max(0, width - visibleWidth(head) - visibleWidth(tail) - 1)
    return head + border(' ' + h.repeat(rest)) + tail
  }
  const paintLabel = (room: number): string => {
    if (room <= 0) return ''
    const head = activity.frame + ' '
    const labelRoom = room - visibleWidth(head)
    if (labelRoom <= 0) return truncateToWidth(activity.frame, room)
    const painted = activity.shimmer === true
      ? renderDrivingShimmer(theme, activity.label, options.spinnerFrame ?? 0)
      : theme.fg('muted', activity.label)
    return truncateToWidth(head + painted, room)
  }
  // Room for the activity is what the corners, the composer label and its
  // separator leave behind.
  const fixed = visibleWidth(topLeft) + visibleWidth(status) + 2 + 1 + visibleWidth(trailing) + visibleWidth(topRight)
  const budget = Math.max(0, width - fixed)
  // `⠸` plus a ten-cell label is the smallest activity worth printing; below
  // that the spinner alone still says the turn is alive.
  const labelMinimum = visibleWidth(activity.frame) + 1 + 10
  if (budget >= labelMinimum) return assemble(paintLabel(budget))
  return assemble(truncateToWidth(activity.frame, Math.max(0, budget)))
}

/**
 * Rounded editor: its label lives in the top border, input occupies one or more
 * body rows, and a dedicated bottom border keeps the cursor off the chrome.
 */
export function renderEditor(options: EditorOptions, theme: Theme): EditorFrame {
  const width = Math.max(4, options.width)
  const padX = 1
  const contentWidth = Math.max(1, width - 2 - padX * 2)
  const h = BOX.horizontal
  const border = (text: string): string => theme.fg(options.border, text)

  // The composer label yields to the activity: while a turn runs the border
  // already says where the reader is, and a second label beside a spinner only
  // pushes the words that matter out of the frame.
  const label = options.activity === undefined ? options.status : ''
  const topLeft = border(BOX.topLeft + h.repeat(padX))
  const topRight = border(h.repeat(padX) + BOX.topRight)
  const fillWidth = Math.max(0, width - visibleWidth(BOX.topLeft + h.repeat(padX)) - visibleWidth(h.repeat(padX) + BOX.topRight))
  const statusRight = options.statusRight ?? ''
  let status = label
  let trailing = statusRight
  if (visibleWidth(status) + visibleWidth(trailing) + (trailing === '' ? 0 : 1) > fillWidth) {
    const rightBudget = Math.max(0, fillWidth - visibleWidth(status) - (status === '' || fillWidth === 0 ? 0 : 1))
    trailing = truncateToWidth(statusRight, rightBudget)
    if (visibleWidth(status) + visibleWidth(trailing) + (trailing === '' ? 0 : 1) > fillWidth) {
      status = truncateToWidth(status, Math.max(0, fillWidth - visibleWidth(trailing) - (trailing === '' ? 0 : 1)))
    }
  }
  const statusFill = Math.max(0, fillWidth - visibleWidth(status) - visibleWidth(trailing))
  const top = options.activity === undefined
    ? topLeft + status + border(h.repeat(statusFill)) + trailing + topRight
    : topBorderWithActivity(options, {
      topLeft, topRight, status, trailing, fillWidth, border, theme, h,
    })

  const layout = wrapIndexed(options.input, contentWidth)
  const caret = cursorOnWrapped(layout, options.inputCursor, options.input)
  const rows = layout.length > 0 ? layout : [{ text: '', start: 0, end: 0 }]

  const lines = [top]
  for (let i = 0; i < rows.length; i += 1) {
    const text = rows[i]?.text ?? ''
    const hint = options.inlineHint
    const atCaretEnd = i === caret.row && caret.column >= visibleWidth(text)
    let body = options.paintInput?.(text, rows[i]?.start ?? 0) ?? text
    if (atCaretEnd && hint !== undefined && hint !== '') {
      const budget = Math.max(0, contentWidth - visibleWidth(text))
      if (budget > 0) body += theme.fg('dim', truncateToWidth(hint, budget))
    }
    const linePad = padding(Math.max(0, contentWidth - visibleWidth(body)))
    const left = border(BOX.vertical) + padding(padX)
    const right = padding(padX) + border(BOX.vertical)
    lines.push(left + body + linePad + right)
  }
  const bottomLeft = border(BOX.bottomLeft + h.repeat(padX))
  const bottomRight = border(h.repeat(padX) + BOX.bottomRight)
  const note = options.note === undefined || options.note === '' ? '' : theme.fg('dim', options.note)
  if (note === '' || visibleWidth(note) + 4 > fillWidth) {
    lines.push(bottomLeft + border(h.repeat(fillWidth)) + bottomRight)
  } else {
    const head = bottomLeft + border(h + ' ') + note
    const rest = Math.max(0, width - visibleWidth(head) - 1 - visibleWidth(bottomRight))
    lines.push(head + border(' ' + h.repeat(rest)) + bottomRight)
  }

  return {
    lines,
    cursor: { row: 1 + caret.row, column: 2 + caret.column },
  }
}

/** DeepSeek Harness-aligned label shown while the model is driving a turn. */
export const DEEP_DRIVING_LABEL = 'Deep Driving'

/** Paint a restrained highlight that travels across the active driving label. */
function renderDrivingShimmer(theme: Theme, text: string, spinnerFrame: number): string {
  if (!theme.colors) return text
  const characters = [...text]
  const runway = 3
  const highlight = (spinnerFrame % (characters.length + runway * 2)) - runway
  return characters.map((character, index) => {
    if (character === ' ') return character
    const distance = Math.abs(index - highlight)
    if (distance === 0) return theme.bold(theme.fg('accent', character))
    if (distance === 1) return theme.fg('accent', character)
    if (distance === 2) return theme.fg('text', character)
    return theme.fg('muted', character)
  }).join('')
}
