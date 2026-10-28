/** Shared presentation for successful slash-command output. */

import { renderMarkdown } from './markdown.ts'
import { BOX, paintSurface, type Theme } from './theme.ts'
import { padToWidth, truncateToWidth, visibleWidth, wrapText, wrapTextStable } from './width.ts'

/** Render a command result without the generic notice frame. */
export function renderCommandOutput(command: string, text: string, theme: Theme, width: number, surface?: 'aside'): string[] {
  const plain = renderCommandOutputRows(command, text, theme, width)
  if (surface === undefined || !theme.colors) return plain
  // A tinted block, not a border: the answer is prose from somewhere else, and a
  // frame around it would claim it is a component the reader operates.
  return plain.map(row => paintSurface(theme, 'toolAltBg', 'toolOutput', padToWidth(row, width)))
}

function renderCommandOutputRows(command: string, text: string, theme: Theme, width: number): string[] {
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

/**
 * Drop the prompt the shell paints after a command.
 *
 * A prompt line is the last line and looks like a bare `name>` / `name$`; a line
 * that carries anything after the marker is output, not chrome, so it stays.
 */
function dropTrailingPrompt(lines: readonly string[]): string[] {
  let end = lines.length
  while (end > 0) {
    const last = (lines[end - 1] ?? '').trimEnd()
    if (last === '') { end -= 1; continue }
    if (/^[\w.-]*[>$#%]\s*$/u.test(last)) { end -= 1; continue }
    break
  }
  return lines.slice(0, end)
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
  const inset = width > 4 ? 2 : 0
  const room = Math.max(1, width - inset * 2)
  const rows = block.output.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(/\s+$/u, '')
  const heading = `$ ${block.command}`
  // The command is the reader's own intent, so it is one ink and never syntax
  // coloured — the same rule a tool card's command line follows. A Shell card
  // carries a fill because it is a block of machine output, not prose: without
  // one it reads as loose lines floating between messages.
  const body: string[] = [theme.bold(theme.fg(block.status === 'error' ? 'error' : 'shellMode', truncateToWidth(heading, room)))]
  if (rows !== '') {
    // A shell repaints its prompt after every line, so the raw output ends with
    // one. The card already says which command ran — printing the shell's own
    // prompt underneath adds a second, differently spelled copy of the same
    // fact, and it is the shell's chrome rather than this command's output.
    const lines = dropTrailingPrompt(rows.split('\n'))
    // A running command shows its newest rows, a settled one its first rows: mid-run
    // the reader is watching progress, afterwards they are reading from the start.
    const omitted = Math.max(0, lines.length - SHELL_PREVIEW_ROWS)
    const visible = omitted === 0 ? lines : block.status === 'running' ? lines.slice(-SHELL_PREVIEW_ROWS) : lines.slice(0, SHELL_PREVIEW_ROWS)
    const ink = block.status === 'error' ? 'error' : 'toolOutput'
    body.push('')
    for (const line of visible) {
      for (const row of wrapTextStable(theme.fg(ink, line), room)) body.push(truncateToWidth(row, room))
    }
    if (omitted > 0) {
      body.push(theme.fg('dim', `… ${omitted} ${block.status === 'running' ? 'earlier' : 'more'} ${omitted === 1 ? 'line' : 'lines'}`))
    }
  }
  if (block.status === 'error' && block.code !== undefined) body.push(theme.fg('error', `exit ${block.code}`))
  if (block.shared === true) body.push(theme.fg('dim', 'shared to conversation'))
  // The fill is the state: pending while it writes, success when it settles, and
  // the failure surface when it exits non-zero — the same three surfaces a tool
  // card uses, so a reader reads one vocabulary for both.
  const fill = block.status === 'running' ? 'toolPendingBg' : block.status === 'error' ? 'toolErrorBg' : 'toolSuccessBg'
  const pad = ' '.repeat(inset)
  return body.map(line => paintSurface(theme, fill, 'toolOutput', padToWidth(pad + line, width)))
}
