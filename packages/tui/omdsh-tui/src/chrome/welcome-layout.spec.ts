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
      // Six rows of mark, a blank, and one hint row — the same at every width
      // that holds the lockup and its hint on one line.
      const lines = renderWelcome({ width, version: '0.8.0', appName: 'omdsh' }, theme)
      expect(lines.length, `width ${width}`).toBe(8)
    }
    // Narrower terminals wrap the hint onto a second row; still bounded.
    expect(renderWelcome({ width: 52, version: '0.8.0', appName: 'omdsh' }, theme).length).toBe(9)
    // Below the lockup width the wordmark folds under the mark, which is taller
    // but still bounded.
    expect(renderWelcome({ width: 40, version: '0.8.0', appName: 'omdsh' }, theme).length).toBeLessThanOrEqual(12)
  })

  it('never emits a row wider than the terminal', () => {
    for (const width of [140, 100, 80, 64, 40, 26, 18, 12, 8]) {
      for (const line of renderWelcome({ width, version: '0.8.0', appName: 'omdsh' }, theme)) {
        expect(visibleWidth(line), `width ${width}: ${line}`).toBeLessThanOrEqual(width)
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
