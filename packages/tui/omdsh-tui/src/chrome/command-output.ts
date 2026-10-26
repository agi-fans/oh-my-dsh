/** Shared presentation for successful slash-command output. */

import { renderMarkdown } from './markdown.ts'
import { BOX, type Theme } from './theme.ts'
import { truncateToWidth, visibleWidth, wrapText, wrapTextStable } from './width.ts'

/** Render a command result without the generic notice frame. */
export function renderCommandOutput(command: string, text: string, theme: Theme, width: number): string[] {
  const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trimEnd()
  const rows = normalized.split('\n')
  if (rows.length <= 1) {
    const prefix = width > 2 ? '  ' : ''
    const continuation = ' '.repeat(visibleWidth(prefix))
    return wrapText(normalized, Math.max(1, width - visibleWidth(prefix))).map((line, index) =>
      truncateToWidth((index === 0 ? prefix : continuation) + theme.fg('dim', line), width))
  }

  const inset = width > 2 ? 1 : 0
  const contentWidth = Math.max(1, width - inset * 2)
  const prefix = ' '.repeat(inset)
  const first = rows.shift()?.trim() ?? ''
  const title = first === '' ? `/${command}` : first
  const body = rows.join('\n').trim()
  const heading = prefix + theme.bold(theme.fg('accent', truncateToWidth(title, contentWidth)))
  if (body === '') return [heading]
  return [heading, '', ...renderMarkdown(body, theme, contentWidth).map(line => prefix + line)]
}

/** Subtle separator used only between adjacent, different command surfaces. */
export function renderCommandSeparator(theme: Theme, width: number): string {
  if (width <= 0) return ''
  if (width <= 2) return theme.fg('border', BOX.horizontal.repeat(width))
  return ' ' + theme.fg('border', BOX.horizontal.repeat(width - 2)) + ' '
}

/** Rows of shell output a settled card keeps before it collapses to a hint. */
const SHELL_PREVIEW_ROWS = 12

/**
 * A Shell line the reader ran with `!`.
 *
 * The command is one bold ink, the same as a tool card's command line, so a
 * reader scanning the transcript never confuses what they asked for with what
 * came back. Output streams in as it arrives and the card settles in place: no
 * exit gesture, no reader to leave. A failing command keeps its output and adds
 * the exit code, because that code is the reason the reader needs to look.
 */
export function renderShell(block: { command: string; output: string; status: 'running' | 'ok' | 'error'; code?: number; shared?: boolean }, theme: Theme, width: number): string[] {
  const prefix = width > 2 ? '  ' : ''
  const rows = block.output.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(/\s+$/u, '')
  const head = prefix + theme.bold(theme.fg(block.status === 'error' ? 'error' : 'toolTitle', `$ ${block.command}`))
  const lines = [truncateToWidth(head, width)]
  if (rows !== '') {
    const body = rows.split('\n')
    // A running command shows its newest rows, a settled one its first rows: mid-run
    // the reader is watching progress, afterwards they are reading from the start.
    const omitted = Math.max(0, body.length - SHELL_PREVIEW_ROWS)
    const visible = omitted === 0 ? body : block.status === 'running' ? body.slice(-SHELL_PREVIEW_ROWS) : body.slice(0, SHELL_PREVIEW_ROWS)
    const ink = block.status === 'error' ? 'error' : 'toolOutput'
    lines.push('')
    lines.push(...visible.flatMap(line => wrapTextStable(prefix + theme.fg(ink, line), width).map((row) => truncateToWidth(row, width))))
    if (omitted > 0) {
      lines.push(truncateToWidth(
        prefix + theme.fg('dim', `… ${omitted} ${block.status === 'running' ? 'earlier' : 'more'} ${omitted === 1 ? 'line' : 'lines'}`),
        width,
      ))
    }
  }
  if (block.status === 'error' && block.code !== undefined) {
    lines.push(truncateToWidth(prefix + theme.fg('error', `exit ${block.code}`), width))
  }
  if (block.shared === true) {
    lines.push(truncateToWidth(prefix + theme.fg('dim', 'shared to conversation'), width))
  }
  return lines
}
