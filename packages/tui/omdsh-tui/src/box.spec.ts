import { describe, expect, it } from 'vitest'
import { editorStatusLabel, hitTestEditor, renderEditor, renderFramedBlock, renderWelcome, renderWorking } from './box.ts'
import { createTheme } from './theme.ts'
import { stripAnsi, visibleWidth } from './width.ts'

const theme = createTheme(false)

function terminalWidth(text: string): number {
  let column = 0
  for (const char of stripAnsi(text)) {
    if (char === '\t') column += 8 - (column % 8)
    else column += visibleWidth(char)
  }
  return column
}

describe('renderFramedBlock', () => {
  it('draws a rounded box with a header and body', () => {
    const lines = renderFramedBlock({ header: '✔ bash', lines: ['output'], width: 40, state: 'ok' }, theme)
    expect(lines[0]).toMatch(/^╭───/)
    expect(lines[0]).toContain('✔ bash')
    expect(lines.some((line) => line.includes('output'))).toBe(true)
    expect(lines[lines.length - 1]).toMatch(/^╰/)
    for (const line of lines) expect(visibleWidth(line)).toBe(40)
  })

  it('keeps tab-indented command output inside the terminal width', () => {
    for (const activeTheme of [theme, createTheme(true, true)]) {
      const lines = renderFramedBlock({
        header: '✔ bash',
        lines: ['\tmodified: packages/tui/omdsh-tui/src/box.ts'],
        width: 40,
        state: 'ok',
      }, activeTheme)
      for (const line of lines) expect(terminalWidth(line)).toBe(40)
      expect(lines.join('\n')).not.toContain('\t')
    }
  })

  it('preserves balanced caps when a long command header is truncated', () => {
    const command = 'pnpm --filter @omdsh/tui test 2>&1 | grep -v WARN | tail -6 && pnpm --filter @omdsh/tui build'
    for (const activeTheme of [theme, createTheme(true, true)]) {
      const top = stripAnsi(renderFramedBlock({
        header: '✔ bash',
        headerMeta: '$ ' + command,
        lines: ['Done'],
        width: 80,
        state: 'ok',
      }, activeTheme)[0] ?? '')

      expect(top).toMatch(/^╭─── /u)
      expect(top).toMatch(/ ───╮$/u)
      expect(visibleWidth(top)).toBe(80)
    }
  })
})

describe('renderWelcome', () => {
  it('paints the two-column welcome card', () => {
    const lines = renderWelcome({
      width: 60, model: 'deepseek-v4-flash', reasoningEffort: 'high', version: '0.1.0', appName: 'omdsh',
      recentSessions: [{ id: 'session-1', title: 'Fix renderer', createdAt: Date.now() - 120_000 }],
      tips: [
        { key: '/', text: 'Commands' },
        { key: 'Ctrl+R', text: 'Search history' },
        { key: 'Ctrl+O', text: 'Expand output' },
      ],
    }, theme)
    const text = lines.map(stripAnsi).join('\n')
    expect(text).toContain('omdsh v0.1.0')
    expect(text).toContain('Into the Unknown')
    expect(text).toContain('⢀⣤⣶⣿⣿⣿⣿⣿⣿⣿⣧⣄⡀⢻⣿⣷⣶⣶⣶⡿')
    expect(text).toContain('Tips')
    expect(text).toContain('/       Commands')
    expect(text).toContain('Ctrl+R  Search history')
    expect(text).toContain('Ctrl+O  Expand output')
    expect(text).toContain('Fix renderer')
    expect(text).toContain('2m ago')
    expect(text).toContain('deepseek-v4-flash')
    expect(lines[0]?.startsWith('╭')).toBe(true)
    expect(stripAnsi(lines[0] ?? '')).toContain('┬')
    expect(lines.map(stripAnsi).some(line => /^│.*├─+┤$/u.test(line))).toBe(true)
    expect(stripAnsi(lines.at(-1) ?? '')).toContain('┴')
  })

  it('fills a wide terminal and closes every border row', () => {
    const width = 140
    const lines = renderWelcome({
      width,
      model: 'deepseek-v4-flash',
      version: '0.1.0',
      appName: 'omdsh',
      tips: [{ key: '/', text: 'Browse available commands' }],
    }, theme)

    expect(lines).not.toHaveLength(0)
    for (const line of lines) expect(visibleWidth(line)).toBe(width)
    expect(stripAnsi(lines[0] ?? '')).toMatch(/^╭.*╮$/u)
    expect(stripAnsi(lines[0] ?? '')).toContain('┬')
    expect(lines.map(stripAnsi).some(line => /^│.*├─+┤$/u.test(line))).toBe(true)
    expect(stripAnsi(lines.at(-1) ?? '')).toMatch(/^╰.*╯$/u)
  })

  it('paints the reasoning effort under the model, not the app name', () => {
    const lines = renderWelcome({
      width: 60, model: 'deepseek-v4-pro', reasoningEffort: 'max', version: '0.1.0', appName: 'omdsh',
    }, theme)
    const plain = lines.map(stripAnsi)
    const modelRow = plain.findIndex((line) => line.includes('deepseek-v4-pro'))
    expect(modelRow).toBeGreaterThanOrEqual(0)
    expect(plain[modelRow + 1]).toContain('max')
    expect(plain[modelRow + 1]).not.toContain('omdsh')
  })

  it('omits the detail line when no reasoning effort is known', () => {
    const lines = renderWelcome({
      width: 60, model: 'deepseek-v4-flash', version: '0.1.0', appName: 'omdsh',
    }, theme)
    const plain = lines.map(stripAnsi)
    const modelRow = plain.findIndex((line) => line.includes('deepseek-v4-flash'))
    expect(modelRow).toBeGreaterThanOrEqual(0)
    const next = plain[modelRow + 1] ?? ''
    expect(next).not.toContain('omdsh')
  })
})

describe('renderEditor', () => {
  it('embeds status in the top border and input on its own body row', () => {
    const status = editorStatusLabel(theme, { appName: '🐳', model: 'm', reasoningEffort: 'max', status: 'idle', pwd: '~/p' })
    const frame = renderEditor({ width: 40, input: 'hi', inputCursor: 2, status, border: 'border' }, theme)
    expect(frame.lines).toHaveLength(3)
    expect(frame.lines[0]).toMatch(/^╭─/)
    expect(frame.lines[0]).toContain('🐳')
    expect(frame.lines[0]).toContain('m · max · idle')
    expect(frame.lines[1]).toMatch(/^│ /)
    expect(frame.lines[1]).toContain('hi')
    expect(frame.lines[2]).toMatch(/^╰─/)
    expect(frame.cursor).toEqual({ row: 1, column: 4 })
  })

  it('paints a dim inline hint after the caret', () => {
    const status = editorStatusLabel(theme, { appName: 'omdsh', model: 'm', status: 'idle', pwd: '~/p' })
    const frame = renderEditor({
      width: 40,
      input: '/copy ',
      inputCursor: 6,
      status,
      border: 'border',
      inlineHint: 'text|code|cmd',
    }, theme)
    expect(frame.lines[1]).toContain('/copy ')
    expect(frame.lines[1]).toContain('text|code|cmd')
    expect(frame.cursor).toEqual({ row: 1, column: 8 })
    expect(visibleWidth(frame.lines[1] ?? '')).toBe(40)
  })

  it('embeds telemetry in the bottom border', () => {
    const frame = renderEditor({
      width: 50,
      input: '',
      inputCursor: 0,
      status: ' whale ',
      footer: ' 1 turn · 4 steps ',
      border: 'border',
    }, theme)
    expect(frame.lines.at(-1)).toMatch(/^╰─ 1 turn · 4 steps ─+─╯$/)
    expect(visibleWidth(frame.lines.at(-1) ?? '')).toBe(50)
  })

  it('maps a click on the input row to a buffer index', () => {
    expect(hitTestEditor('hello', 40, 0, 4)).toBeUndefined()
    expect(hitTestEditor('hello', 40, 1, 2)).toBe(0)
    expect(hitTestEditor('hello', 40, 1, 4)).toBe(2)
    expect(hitTestEditor('hello', 40, 1, 20)).toBe(5)
    expect(hitTestEditor('hello', 40, 2, 4)).toBeUndefined()
  })
})

describe('renderWorking', () => {
  it('shows the OMP working row', () => {
    const line = renderWorking(theme, 0, 'bash · pnpm test', 40)[0] ?? ''
    expect(line).toContain('bash · pnpm test')
    expect(line).toContain('Ctrl+C: Interrupt')
    expect(visibleWidth(line)).toBeLessThanOrEqual(40)
  })
})
