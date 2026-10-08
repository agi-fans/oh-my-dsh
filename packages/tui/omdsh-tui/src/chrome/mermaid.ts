import { render, type MermaidArt, type Role } from 'lovely-mermaid'
import { ink, paintFg, type MarkdownStyle } from './md-style.ts'
import type { Theme, ThemeColor } from './theme.ts'
import { visibleWidth } from './width.ts'

export const MERMAID_MODES = ['auto', 'source'] as const
export type MermaidMode = typeof MERMAID_MODES[number]

type Art = MermaidArt
const cache = new Map<string, { art: Art | undefined; bytes: number }>()
const CACHE_BYTES = 1_048_576
let cacheBytes = 0

/** Cache geometry independently of terminal width and theme, including failed parses. */
function diagram(source: string): Art | undefined {
  if (source.length > 16_384 || source.split('\n').length > 200
    || /[\x00-\x08\x0b-\x1f\x7f]/u.test(source)) return undefined
  const hit = cache.get(source)
  if (hit !== undefined) {
    cache.delete(source)
    cache.set(source, hit)
    return hit.art
  }
  let art: Art | undefined
  try {
    const rendered = render(source)
    // Best-effort parsing and size caps can drop meaningful statements.
    if (rendered !== null && rendered.warnings.length === 0
      && rendered.plain.length > 0 && rendered.plain.length <= 256
      && rendered.width <= 512) art = rendered
  } catch {
    // Model output is untrusted; a parser failure must leave readable source.
  }
  const bytes = source.length * 2 + (art === undefined ? 0 : JSON.stringify(art).length * 2)
  if (bytes <= CACHE_BYTES) {
    while (cache.size >= 64 || cacheBytes + bytes > CACHE_BYTES) {
      const oldest = cache.keys().next().value!
      cacheBytes -= cache.get(oldest)!.bytes
      cache.delete(oldest)
    }
    cache.set(source, { art, bytes })
    cacheBytes += bytes
  }
  return art
}

const ROLE_COLORS: Record<Role, ThemeColor> = {
  border: 'mdCodeBlockBorder', text: 'text', edge: 'accent',
  edgeLabel: 'muted', title: 'accent', none: 'text',
}

/** Whole diagrams only: never wrap or clip connections to fit a viewport. */
export function mermaidLines(source: string, theme: Theme, width: number, style?: MarkdownStyle): string[] | undefined {
  const art = diagram(source)
  if (art === undefined || art.width > width || art.plain.some(row => visibleWidth(row) > width)) return undefined
  // Own theme tokens control contrast; source class colors and links are not terminal escapes.
  return art.styled.map(row => row.map(span => span.role === 'none' ? span.text
    : paintFg(theme, ink(style, ROLE_COLORS[span.role]), span.text, style)).join(''))
}
