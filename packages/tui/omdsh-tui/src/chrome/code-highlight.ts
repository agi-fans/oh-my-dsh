/**
 * Reusable terminal code highlighting shared by the Markdown renderer and the
 * diff card. Resolves a language from a file path or a fenced-code info string,
 * paints keyword and literal tokens with the TUI theme, and exposes a multiline
 * batch seam so consecutive lines (a Markdown block or a run of diff context)
 * highlight through one call. No external syntax library is added: the tokenizer
 * is a small, dependency-free keyword and literal recognizer.
 *
 * The batch API accepts many lines and returns one painted string per input
 * line. The current tokenizer is line-scoped, so multi-line constructs (block
 * comments, template strings) are not yet recognized across breaks; the seam is
 * shaped so a real multi-line tokenizer can replace {@link highlightLine}
 * without changing callers. Output is pre-wrap and never depends on terminal
 * width, which keeps the {@link highlightCache} safe to reuse across wraps.
 * @module @agi-fans/dsh-tui
 */

import { ink, paintBase, paintFg, type MarkdownStyle } from './md-style.ts'
import type { Theme } from './theme.ts'

/** Languages the built-in tokenizer recognizes. Aliases are accepted verbatim. */
const SUPPORTED_LANGS = /^(?:js|jsx|ts|tsx|javascript|typescript|json|python|py|bash|sh|shell|rust|go|java|css|html)$/u

const KEYWORDS = /^(?:const|let|var|function|class|interface|type|return|if|else|for|while|async|await|import|export|from|def|fn|struct|package|func|true|false|null|undefined)$/u
const LITERALS = /^(?:\d+(?:\.\d+)?|"[^"]*"|'[^']*')$/u

/** Canonical id for a supported language, or `undefined` when unrecognized. */
export type LanguageId = string

/** True when a language token (fence info or resolved id) is highlightable. */
export function isSupportedLanguage(lang: string): boolean {
  return SUPPORTED_LANGS.test(lang.trim().toLowerCase())
}

/** Lowercase and trim a fence info string or raw language token. */
export function normalizeLanguage(lang: string): string {
  return lang.trim().toLowerCase()
}

const PATH_EXTENSION = /\.([^.]+)$/u

/** Map common source extensions to a canonical, supported language id. */
const EXTENSION_TO_LANG: Readonly<Record<string, LanguageId>> = {
  ts: 'ts', mts: 'ts', cts: 'ts',
  tsx: 'tsx',
  js: 'js', mjs: 'js', cjs: 'js',
  jsx: 'jsx',
  json: 'json',
  py: 'python', pyi: 'python',
  sh: 'bash', bash: 'bash',
  rs: 'rust',
  go: 'go',
  java: 'java',
  css: 'css',
  html: 'html', htm: 'html',
}

/**
 * Resolve a highlightable language from a file path, or `undefined` when the
 * extension is unknown or not supported. Used by the diff card to pick a
 * tokenizer for context lines without parsing a unified diff.
 */
export function languageFromPath(path: string): LanguageId | undefined {
  const match = PATH_EXTENSION.exec(path)
  const ext = match?.[1]?.toLowerCase()
  if (ext === undefined) return undefined
  const lang = EXTENSION_TO_LANG[ext]
  return lang === undefined ? undefined : lang
}

/** Highlight a single line with the line-scoped tokenizer. */
function highlightLine(row: string, theme: Theme, style?: MarkdownStyle): string {
  return row.split(/(\s+|\b)/u).map(token => {
    if (KEYWORDS.test(token)) return paintFg(theme, ink(style, 'mdKeyword'), token, style)
    if (LITERALS.test(token)) return paintFg(theme, ink(style, 'mdCodeBlock'), token, style)
    return paintBase(theme, token, style)
  }).join('')
}

/** Maximum cached highlight results before the oldest entry is evicted. */
const HIGHLIGHT_CACHE_CAP = 32

/** A single block larger than this is highlighted but never cached. */
const HIGHLIGHT_CACHE_MAX_ENTRY_CHARS = 64 * 1024

/** Total source characters retained across all cached entries before eviction. */
const HIGHLIGHT_CACHE_TOTAL_BUDGET = 512 * 1024

interface CacheEntry {
  readonly result: readonly string[]
  readonly sourceChars: number
}

const highlightCache = new Map<string, CacheEntry>()

let cacheTotalChars = 0

/** Drop every cached highlight result. Intended for tests and hot reloads. */
export function clearHighlightCache(): void {
  highlightCache.clear()
  cacheTotalChars = 0
}

/** Number of cached highlight results. Intended for tests. */
export function highlightCacheSize(): number {
  return highlightCache.size
}

/** Total source characters retained across all cached entries. Intended for tests. */
export function highlightCacheTotalChars(): number {
  return cacheTotalChars
}

function themeFingerprint(theme: Theme): string {
  return `${theme.name}|${theme.colors ? 1 : 0}|${theme.trueColor ? 1 : 0}`
}

function styleKey(style: MarkdownStyle | undefined): string {
  return style === undefined ? '-' : `${style.color ?? ''}|${style.italic ? 'i' : ''}`
}

function cacheKey(theme: Theme, style: MarkdownStyle | undefined, lang: string, source: string): string {
  return `${themeFingerprint(theme)}\0${styleKey(style)}\0${lang}\0${source}`
}

/** Evict oldest entries until the total character budget is satisfied. */
function evictToBudget(): void {
  while (cacheTotalChars > HIGHLIGHT_CACHE_TOTAL_BUDGET && highlightCache.size > 0) {
    const oldest = highlightCache.keys().next()
    if (oldest.done !== true) {
      const entry = highlightCache.get(oldest.value)
      if (entry !== undefined) cacheTotalChars -= entry.sourceChars
      highlightCache.delete(oldest.value)
    } else {
      break
    }
  }
}

/**
 * Paint every line of a code block. Supported languages tokenize keywords and
 * literals; unsupported or empty languages paint the whole run in the block
 * color. Output is plain text when colors are off. Results for supported
 * languages are cached by theme, style, language, and source (never by width).
 * Blocks larger than the per-entry cap are highlighted but bypass the cache,
 * and the total retained source is bounded by an aggregate character budget.
 */
export function highlightCodeLines(
  lines: readonly string[],
  language: string,
  theme: Theme,
  style?: MarkdownStyle,
): string[] {
  const lang = normalizeLanguage(language)
  if (!theme.colors || lang === '' || !SUPPORTED_LANGS.test(lang)) {
    return lines.map(line => paintFg(theme, ink(style, 'mdCodeBlock'), line, style))
  }
  const source = lines.join('\n')
  if (source.length > HIGHLIGHT_CACHE_MAX_ENTRY_CHARS) {
    return lines.map(line => highlightLine(line, theme, style))
  }
  const key = cacheKey(theme, style, lang, source)
  const cached = highlightCache.get(key)
  if (cached !== undefined) {
    // Refresh LRU recency so a hot block survives evictions.
    highlightCache.delete(key)
    highlightCache.set(key, cached)
    return [...cached.result]
  }
  const result = lines.map(line => highlightLine(line, theme, style))
  const entry: CacheEntry = { result, sourceChars: source.length }
  highlightCache.set(key, entry)
  cacheTotalChars += entry.sourceChars
  evictToBudget()
  if (highlightCache.size > HIGHLIGHT_CACHE_CAP) {
    const oldest = highlightCache.keys().next()
    if (oldest.done !== true) {
      const evicted = highlightCache.get(oldest.value)
      if (evicted !== undefined) cacheTotalChars -= evicted.sourceChars
      highlightCache.delete(oldest.value)
    }
  }
  return result
}
