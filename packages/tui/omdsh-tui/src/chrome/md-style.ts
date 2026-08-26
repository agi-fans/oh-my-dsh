/**
 * Shared Markdown style and SGR paint primitives.
 *
 * Both the Markdown renderer (`markdown.ts`) and the reusable code highlighter
 * (`code-highlight.ts`) paint runs of text against a {@link Theme} while an
 * optional surrounding {@link MarkdownStyle} stays restored after each inline
 * span. Keeping these primitives here gives the code highlighter a deep, theme-
 * aware seam without importing the whole Markdown renderer (and without the
 * import cycle that the renderer's ownership of the highlighter would create).
 * @module @agi-fans/dsh-tui
 */

import type { Theme, ThemeColor } from './theme.ts'

/** Optional surrounding style restored after inline code and emphasis. */
export interface MarkdownStyle {
  color?: ThemeColor
  italic?: boolean
}

/** Reopen the surrounding style after a nested span closes foreground or italic. */
export function openBase(theme: Theme, style: MarkdownStyle | undefined): string {
  if (!theme.colors || style === undefined) return ''
  return (style.italic === true ? '\x1b[3m' : '')
    + (style.color === undefined ? '' : theme.getFgAnsi(style.color))
}

/** Keep thinking traces on one dark ink so headings, code, and links do not light up. */
export function ink(style: MarkdownStyle | undefined, color: ThemeColor): ThemeColor {
  return style?.color === 'thinkingText' ? 'thinkingText' : color
}

/** Paint one unstyled run so a later 39m cannot leak default ink. */
export function paintBase(theme: Theme, text: string, style?: MarkdownStyle): string {
  if (text === '' || style === undefined || !theme.colors) return text
  let out = text
  if (style.color !== undefined) out = theme.fg(style.color, out)
  if (style.italic === true) out = theme.italic(out)
  return out
}

/** Paint a foreground run and restore the surrounding style after its 39m. */
export function paintFg(theme: Theme, color: ThemeColor, text: string, style?: MarkdownStyle): string {
  if (!theme.colors) return text
  return theme.getFgAnsi(color) + text + '\x1b[39m' + openBase(theme, style)
}

/** Paint a bold run and restore the surrounding style after its 22m. */
export function paintBold(theme: Theme, text: string, style?: MarkdownStyle): string {
  if (!theme.colors) return text
  return `\x1b[1m${text}\x1b[22m` + openBase(theme, style)
}

/** Paint an italic run and restore the surrounding style after its 23m. */
export function paintItalic(theme: Theme, text: string, style?: MarkdownStyle): string {
  if (!theme.colors) return text
  return `\x1b[3m${text}\x1b[23m` + openBase(theme, style)
}

/** Paint a strikethrough run and restore the surrounding style after its 29m. */
export function paintStrike(theme: Theme, text: string, style?: MarkdownStyle): string {
  if (!theme.colors) return text
  return `\x1b[9m${text}\x1b[29m` + openBase(theme, style)
}
