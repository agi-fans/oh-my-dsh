/** Shared presentation for successful slash-command output. */

import { renderMarkdown } from './markdown.ts'
import { BOX, type Theme } from './theme.ts'
import { truncateToWidth, visibleWidth, wrapText } from './width.ts'

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
