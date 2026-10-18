import { describe, expect, it } from 'vitest'
import { renderWelcome } from './box.ts'
import { createTheme } from './theme.ts'
import { stripAnsi, visibleWidth } from './width.ts'

describe('adaptive welcome layout', () => {
  it('moves the column divider to preserve a long model name when space is available', () => {
    const width = 120
    const model = 'deepseek-v4-flash-vision-exp'
    const lines = renderWelcome({
      width,
      model,
      reasoningEffort: 'max',
      version: '0.8.0',
      appName: 'omdsh',
    }, createTheme(false))
    const plain = lines.map(stripAnsi)

    expect(plain.join('\n')).toContain(model)
    expect(plain.every(line => visibleWidth(line) === width)).toBe(true)
  })

  it('points an unconnected first run at /login without changing the frame width', () => {
    const width = 100
    const lines = renderWelcome({
      width,
      model: 'deepseek-flash',
      version: '0.8.0',
      appName: 'omdsh',
      modelReady: false,
    }, createTheme(false)).map(stripAnsi)
    expect(lines.join('\n')).toContain('Not connected · /login')
    expect(lines.every(line => visibleWidth(line) === width)).toBe(true)
  })
})
