/** Whole-block Prism tokenization painted with terminal theme colors before wrapping. */

import Prism from 'prismjs'
import 'prismjs/components/prism-typescript.js'
import 'prismjs/components/prism-jsx.js'
import 'prismjs/components/prism-tsx.js'
import 'prismjs/components/prism-json.js'
import 'prismjs/components/prism-json5.js'
import 'prismjs/components/prism-python.js'
import 'prismjs/components/prism-bash.js'
import 'prismjs/components/prism-rust.js'
import 'prismjs/components/prism-go.js'
import 'prismjs/components/prism-java.js'
import 'prismjs/components/prism-c.js'
import 'prismjs/components/prism-cpp.js'
import 'prismjs/components/prism-csharp.js'
import 'prismjs/components/prism-powershell.js'
import 'prismjs/components/prism-yaml.js'
import 'prismjs/components/prism-toml.js'
import 'prismjs/components/prism-ini.js'
import 'prismjs/components/prism-sql.js'
import 'prismjs/components/prism-docker.js'
import 'prismjs/components/prism-makefile.js'
import 'prismjs/components/prism-diff.js'
import 'prismjs/components/prism-ruby.js'
import 'prismjs/components/prism-kotlin.js'
import 'prismjs/components/prism-swift.js'
import { ink, paintBase, paintFg, type MarkdownStyle } from './md-style.ts'
import type { Theme, ThemeColor } from './theme.ts'

/** Canonical id for a supported language, or `undefined` when unrecognized. */
export type LanguageId = string

/** True when a language token (fence info or resolved id) is highlightable. */
export function isSupportedLanguage(lang: string): boolean {
  return grammarFor(normalizeLanguage(lang)) !== undefined
}

/** Lowercase and trim a fence info string or raw language token. */
export function normalizeLanguage(lang: string): string {
  const token = lang.trim().split(/\s+/u)[0]?.toLowerCase() ?? ''
  return Object.hasOwn(LANGUAGE_ALIASES, token) ? LANGUAGE_ALIASES[token] ?? token : token
}

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  javascript: 'js', typescript: 'ts', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash',
  yml: 'yaml', html: 'html', xml: 'html', svg: 'html', csharp: 'csharp', cs: 'csharp',
  'c#': 'csharp', 'c++': 'cpp', pwsh: 'powershell', ps1: 'powershell', dockerfile: 'docker', patch: 'diff',
}

function grammarFor(lang: string): Prism.Grammar | undefined {
  // Languages also contains utility functions; own object entries are grammars.
  if (!Object.hasOwn(Prism.languages, lang)) return undefined
  const grammar = Prism.languages[lang]
  return typeof grammar === 'object' ? grammar as Prism.Grammar : undefined
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
  xml: 'html', svg: 'html', vue: 'html',
  json5: 'json5', yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'csharp',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell', sql: 'sql',
  rb: 'ruby', kt: 'kotlin', kts: 'kotlin', swift: 'swift', diff: 'diff', patch: 'diff',
}

/**
 * Resolve a highlightable language from a file path, or `undefined` when the
 * extension is unknown or not supported. Used by the diff card to pick a
 * tokenizer for context lines without parsing a unified diff.
 */
export function languageFromPath(path: string): LanguageId | undefined {
  const name = path.split(/[\\/]/u).at(-1)?.toLowerCase() ?? ''
  if (/^(?:dockerfile|containerfile)(?:\.|$)/u.test(name)) return 'docker'
  if (/^(?:makefile|gnumakefile)$/u.test(name) || name.endsWith('.mk')) return 'makefile'
  if (name === '.bashrc' || name === '.bash_profile') return 'bash'
  const match = PATH_EXTENSION.exec(path)
  const ext = match?.[1]?.toLowerCase()
  if (ext === undefined) return undefined
  const lang = Object.hasOwn(EXTENSION_TO_LANG, ext) ? EXTENSION_TO_LANG[ext] : undefined
  return lang === undefined ? undefined : lang
}

const TOKEN_COLORS: Readonly<Record<string, ThemeColor>> = {
  keyword: 'mdKeyword', boolean: 'mdKeyword', builtin: 'syntaxType', 'class-name': 'syntaxType',
  comment: 'mdQuote', prolog: 'mdQuote', doctype: 'mdQuote',
  string: 'syntaxString', char: 'syntaxString', regex: 'syntaxString', 'attr-value': 'syntaxString',
  number: 'syntaxNumber', function: 'syntaxFunction', 'function-variable': 'syntaxFunction',
  tag: 'mdKeyword', 'attr-name': 'syntaxType', property: 'mdCodeBlock', symbol: 'syntaxType',
  deleted: 'toolDiffRemoved', inserted: 'toolDiffAdded', coord: 'mdLink', unchanged: 'toolDiffContext',
}

/** Split token leaves at line boundaries before painting, so SGR never bleeds between rows. */
function tokenizeLines(lines: readonly string[], grammar: Prism.Grammar, theme: Theme, style?: MarkdownStyle): string[] {
  const result = ['']
  const append = (text: string, color: ThemeColor | undefined): void => {
    const pieces = text.split('\n')
    for (let i = 0; i < pieces.length; i += 1) {
      if (i > 0) result.push('')
      const at = result.length - 1
      const value = pieces[i] ?? ''
      result[at] += color === undefined ? paintBase(theme, value, style) : paintFg(theme, ink(style, color), value, style)
    }
  }
  const visit = (value: string | Prism.Token | (string | Prism.Token)[], color?: ThemeColor): void => {
    if (typeof value === 'string') { append(value, color); return }
    if (Array.isArray(value)) { for (const token of value) visit(token, color); return }
    const aliases = typeof value.alias === 'string' ? [value.alias] : value.alias ?? []
    const tokenColor = TOKEN_COLORS[value.type] ?? aliases.map(alias => TOKEN_COLORS[alias]).find(color => color !== undefined) ?? color
    visit(value.content, tokenColor)
  }
  visit(Prism.tokenize(lines.join('\n'), grammar))
  // Preserve the batch contract even if an input row contains embedded newlines.
  let cursor = 0
  return lines.map(line => {
    const count = line.split('\n').length
    const painted = result.slice(cursor, cursor + count).join('\n')
    cursor += count
    return painted
  })
}

/** Maximum cached highlight results before the oldest entry is evicted. */
const HIGHLIGHT_CACHE_CAP = 32

/** A single block larger than this is highlighted but never cached. */
const HIGHLIGHT_CACHE_MAX_ENTRY_CHARS = 64 * 1024

/** Bound synchronous grammar work; larger source previews retain plain text. */
const HIGHLIGHT_MAX_SOURCE_CHARS = 256 * 1024

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
 * Paint every line of a code block. Unknown languages paint the whole run in the block
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
  const grammar = grammarFor(lang)
  if (!theme.colors || grammar === undefined) {
    return lines.map(line => paintFg(theme, ink(style, 'mdCodeBlock'), line, style))
  }
  const source = lines.join('\n')
  if (source.length > HIGHLIGHT_MAX_SOURCE_CHARS) return lines.map(line => paintFg(theme, ink(style, 'mdCodeBlock'), line, style))
  const key = cacheKey(theme, style, lang, source)
  const cached = highlightCache.get(key)
  if (cached !== undefined) {
    // Refresh LRU recency so a hot block survives evictions.
    highlightCache.delete(key)
    highlightCache.set(key, cached)
    return [...cached.result]
  }
  let result: string[]
  try { result = tokenizeLines(lines, grammar, theme, style) }
  catch { return lines.map(line => paintFg(theme, ink(style, 'mdCodeBlock'), line, style)) }
  if (source.length > HIGHLIGHT_CACHE_MAX_ENTRY_CHARS) return result
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
