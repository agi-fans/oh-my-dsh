import { describe, expect, it } from 'vitest'
import { renderWelcome } from './box.ts'
import { createTheme } from './theme.ts'
import { stripAnsi, visibleWidth } from './width.ts'

const theme = createTheme(false)

describe('header density', () => {
  it('stays a handful of rows at any width a person uses', () => {
    // The header used to be a thirteen-row bordered panel. Its rows are written
    // into native scrollback and stay there, so every row spent before the first
    // message is a row the reader loses on every launch.
    for (const width of [140, 100, 80, 64]) {
      // The name and slogan fit alongside the six-row mark.
      const lines = renderWelcome({ width, version: '0.8.0', appName: 'omdsh' }, theme)
      expect(lines.length, `width ${width}`).toBe(6)
    }
    // This width still fits the brand beside the mark.
    expect(renderWelcome({ width: 52, version: '0.8.0', appName: 'omdsh' }, theme).length).toBe(6)
    // Below the lockup width the wordmark folds under the mark, which is taller
    // but still bounded.
    expect(renderWelcome({ width: 32, version: '0.8.0', appName: 'omdsh' }, theme).length).toBe(9)
  })

  it('never emits a row wider than the terminal', () => {
    for (const width of [140, 100, 80, 64, 40, 26, 18, 12, 8]) {
      for (const line of renderWelcome({ width, version: '0.8.0', appName: 'omdsh' }, theme)) {
        expect(visibleWidth(line), `width ${width}: ${line}`).toBeLessThanOrEqual(width)
      }
    }
  })

  it('shows only the brand across languages, themes, and narrow widths', () => {
    for (const language of ['en', 'zh-CN'] as const) {
      for (const colors of [false, true]) {
        for (const palette of ['dark', 'light', 'system'] as const) {
          const painted = createTheme(colors, 'truecolor', palette, undefined, language)
          for (const width of [18, 26, 40, 64, 100]) {
            const rows = renderWelcome({ width, version: '0.22.0', appName: 'Oh-My-DSH' }, painted).map(stripAnsi)
            const text = rows.join('\n')
            expect(text).toContain('Oh-My-DSH v0.22.0')
            expect(text).toContain('Into the Unknown')
            expect(text).not.toMatch(/Tips|提示|commands|命令|\/help/)
            expect(rows.at(-1)?.trim()).not.toBe('')
            for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(width)
            if (width >= 64) {
              expect(rows).toHaveLength(6)
              expect(rows.findIndex(row => row.includes('Oh-My-DSH'))).toBe(2)
            }
          }
        }
      }
    }
  })

  it('keeps transient readiness out of the immutable header', () => {
    // Rows that enter native scrollback must not be rewritten, so readiness is
    // expressed by the composer placeholder instead.
    const lines = renderWelcome({ width: 100, version: '0.8.0', appName: 'omdsh' }, theme).map(stripAnsi)
    expect(lines.join('\n')).not.toContain('Not connected')
    expect(lines.join('\n')).not.toContain('Run /login')
  })

  it('does not grow with a long model name', () => {
    const short = renderWelcome({ width: 120, version: '0.8.0', appName: 'omdsh' }, theme)
    const long = renderWelcome({
      width: 120,
      model: 'deepseek-v4-flash-vision-exp',
      reasoningEffort: 'max',
      version: '0.8.0',
      appName: 'omdsh',
    }, theme)
    expect(long.length).toBe(short.length)
    expect(long.map(stripAnsi).join('\n')).not.toContain('deepseek-v4-flash-vision-exp')
  })
})
