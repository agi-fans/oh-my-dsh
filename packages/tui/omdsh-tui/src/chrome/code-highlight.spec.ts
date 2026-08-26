import { afterEach, describe, expect, it } from 'vitest'
import {
  clearHighlightCache,
  highlightCacheSize,
  highlightCacheTotalChars,
  highlightCodeLines,
  isSupportedLanguage,
  languageFromPath,
  normalizeLanguage,
} from './code-highlight.ts'
import { createTheme } from './theme.ts'
import { stripAnsi } from './width.ts'

const color = createTheme(true, true)
const plain = createTheme(false)
const keyword = color.getFgAnsi('mdKeyword')
const codeBlock = color.getFgAnsi('mdCodeBlock')
const ctx = color.getFgAnsi('toolDiffContext')

afterEach(() => clearHighlightCache())

describe('languageFromPath', () => {
  it('maps common source extensions to a supported language id', () => {
    expect(languageFromPath('src/tui/omdsh-tui.ts')).toBe('ts')
    expect(languageFromPath('a.tsx')).toBe('tsx')
    expect(languageFromPath('a.mjs')).toBe('js')
    expect(languageFromPath('a.py')).toBe('python')
    expect(languageFromPath('a.sh')).toBe('bash')
    expect(languageFromPath('a.rs')).toBe('rust')
    expect(languageFromPath('a.go')).toBe('go')
    expect(languageFromPath('a.java')).toBe('java')
    expect(languageFromPath('a.css')).toBe('css')
    expect(languageFromPath('a.html')).toBe('html')
    expect(languageFromPath('a.json')).toBe('json')
  })

  it('returns undefined for unknown or unsupported extensions', () => {
    expect(languageFromPath('README.md')).toBeUndefined()
    expect(languageFromPath('style.yaml')).toBeUndefined()
    expect(languageFromPath('Makefile')).toBeUndefined()
    expect(languageFromPath('no_extension')).toBeUndefined()
  })

  it('ignores case and nested paths', () => {
    expect(languageFromPath('PKG/Module.TS')).toBe('ts')
    expect(languageFromPath('x/ y /z.PY')).toBe('python')
  })
})

describe('isSupportedLanguage / normalizeLanguage', () => {
  it('accepts canonical ids and aliases, trimmed and lowercased', () => {
    expect(isSupportedLanguage('ts')).toBe(true)
    expect(isSupportedLanguage('TypeScript')).toBe(true)
    expect(isSupportedLanguage('  python ')).toBe(true)
    expect(isSupportedLanguage('ruby')).toBe(false)
    expect(isSupportedLanguage('')).toBe(false)
    expect(normalizeLanguage('  TS ')).toBe('ts')
  })
})

describe('highlightCodeLines', () => {
  it('paints keywords and literals on supported languages', () => {
    const lines = highlightCodeLines(['const x = 1', 'return "hi"'], 'ts', color)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain(keyword + 'const')
    expect(lines[0]).toContain(codeBlock + '1')
    expect(lines[1]).toContain(keyword + 'return')
    expect(lines[1]).toContain('"hi"')
    expect(stripAnsi(lines.join('\n'))).toBe('const x = 1\nreturn "hi"')
  })

  it('highlights a multi-line run as one block with one result per line', () => {
    const lines = highlightCodeLines(['const a = 1', 'const b = 2', 'const c = 3'], 'ts', color)
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(line).toContain(keyword + 'const')
      expect(line).toContain(codeBlock)
    }
  })

  it('paints unsupported languages as a single block color', () => {
    const lines = highlightCodeLines(['def f(): pass'], 'ruby', color)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(codeBlock)
    expect(lines[0]).not.toContain(keyword + 'def')
  })

  it('is a plain passthrough when colors are off', () => {
    const lines = highlightCodeLines(['const x = 1'], 'ts', plain)
    expect(lines).toEqual(['const x = 1'])
  })

  it('keeps a context style as the base ink while keywords stand out', () => {
    const lines = highlightCodeLines(['const x = 1'], 'ts', color, { color: 'toolDiffContext' })
    // keyword still uses mdKeyword, base text falls back to the context color
    expect(lines[0]).toContain(keyword + 'const')
    expect(lines[0]).toContain(ctx)
    expect(stripAnsi(lines[0])).toBe('const x = 1')
  })

  it('never depends on terminal width', () => {
    const a = highlightCodeLines(['const x = 1'.repeat(20)], 'ts', color)
    clearHighlightCache()
    const b = highlightCodeLines(['const x = 1'.repeat(20)], 'ts', color)
    expect(a).toEqual(b)
  })
})

describe('highlight cache', () => {
  it('reuses results for identical theme, style, language, and source', () => {
    const src = ['const x = 1', 'return x']
    const first = highlightCodeLines(src, 'ts', color)
    const second = highlightCodeLines(src, 'ts', color)
    expect(second).toEqual(first)
    expect(highlightCacheSize()).toBe(1)
  })

  it('misses when theme, style, language, or source differ', () => {
    const src = ['const x = 1']
    highlightCodeLines(src, 'ts', color)
    expect(highlightCacheSize()).toBe(1)
    const midnight = createTheme(true, true, 'midnight')
    highlightCodeLines(src, 'ts', midnight)
    highlightCodeLines(src, 'ts', color, { color: 'toolDiffContext' })
    highlightCodeLines(src, 'js', color)
    highlightCodeLines(['const y = 2'], 'ts', color)
    expect(highlightCacheSize()).toBe(5)
  })

  it('does not cache no-color or unsupported-language output', () => {
    highlightCodeLines(['const x = 1'], 'ts', plain)
    highlightCodeLines(['def f'], 'ruby', color)
    expect(highlightCacheSize()).toBe(0)
  })

  it('evicts the oldest entry past the cap', () => {
    for (let i = 0; i < 40; i += 1) {
      highlightCodeLines([`const v${i} = ${i}`], 'ts', color)
    }
    expect(highlightCacheSize()).toBeLessThanOrEqual(32)
    // a fresh miss still produces correct output after eviction
    const out = highlightCodeLines(['const fresh = 1'], 'ts', color)
    expect(out[0]).toContain(keyword + 'const')
  })

  it('bypasses the cache for a single oversized block but still highlights', () => {
    const big = ['const x = 1 '.repeat(8000)]
    expect(big[0]!.length).toBeGreaterThan(64000)
    const out = highlightCodeLines(big, 'ts', color)
    expect(out).toHaveLength(1)
    expect(out[0]).toContain(keyword + 'const')
    expect(highlightCacheSize()).toBe(0)
    expect(highlightCacheTotalChars()).toBe(0)
  })

  it('evicts oldest entries to keep the aggregate character budget bounded', () => {
    // 16 blocks of ~40KB each totals ~640KB, over the 512KB budget.
    const block = 'const x = 1 '.repeat(3200) // ~38.4KB
    for (let i = 0; i < 16; i += 1) {
      highlightCodeLines([`// n${i}\n${block}`], 'ts', color)
    }
    expect(highlightCacheTotalChars()).toBeLessThanOrEqual(512 * 1024)
    expect(highlightCacheSize()).toBeLessThanOrEqual(32)
    expect(highlightCacheTotalChars()).toBeGreaterThan(0)
    // the most recent entry is still cached and correct
    const recent = highlightCodeLines([`// n15\n${block}`], 'ts', color)
    expect(recent[0]).toContain(keyword + 'const')
  })
})
