import { describe, expect, it } from 'vitest'
import { hitTestEditor, renderEditor, renderFramedBlock, renderWelcome, renderWorking } from './box.ts'
import { createTheme, THEME_NAMES } from './theme.ts'
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
    const command = 'pnpm --filter @agi-fans/dsh-tui test 2>&1 | grep -v WARN | tail -6 && pnpm --filter @agi-fans/dsh-tui build'
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

  it('renders labeled sections inside one continuous frame', () => {
    const lines = renderFramedBlock({
      header: '✔ bash',
      sections: [
        { lines: ['$ pnpm test'] },
        { label: 'Output', lines: ['42 passed'] },
      ],
      width: 40,
      state: 'ok',
    }, theme)
    const plain = lines.map(stripAnsi)

    expect(plain.some(line => /^├─── Output .*───┤$/u.test(line))).toBe(true)
    expect(plain.join('\n')).toContain('$ pnpm test')
    expect(plain.join('\n')).toContain('42 passed')
    for (const line of lines) expect(visibleWidth(line)).toBe(40)
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

  it('keeps welcome titles, body copy, metadata, and chrome layered in every color palette', () => {
    for (const name of THEME_NAMES) {
      const active = createTheme(true, true, name)
      const lines = renderWelcome({
        width: 80,
        model: 'deepseek-v4-flash',
        version: '0.1.0',
        appName: 'omdsh',
        recentSessions: [{ id: 'session-1', title: 'Fix renderer', createdAt: Date.now() - 120_000 }],
        tips: [{ key: '/', text: 'Commands' }],
      }, active)
      const frame = lines[0] ?? ''
      const tips = lines.find(line => stripAnsi(line).includes('Tips')) ?? ''
      const tip = lines.find(line => stripAnsi(line).includes('Commands')) ?? ''
      const session = lines.find(line => stripAnsi(line).includes('Fix renderer')) ?? ''
      expect(frame, name).toContain(active.getFgAnsi('dim'))
      expect(tips, name).toContain(active.getFgAnsi('accent'))
      expect(tip, name).toContain(active.getFgAnsi('muted'))
      expect(tip, name).toContain(active.getFgAnsi('dim'))
      expect(session, name).toContain(active.getFgAnsi('muted'))
      expect(session, name).toContain(active.getFgAnsi('dim'))
      expect(session, name).not.toContain(active.getFgAnsi('accent'))
    }
  })
})

describe('renderEditor', () => {
  it('embeds its compact label in the top border and input on its own body row', () => {
    const frame = renderEditor({ width: 40, input: 'hi', inputCursor: 2, status: ' 🐳 ', border: 'border' }, theme)
    expect(frame.lines).toHaveLength(3)
    expect(frame.lines[0]).toMatch(/^╭─/)
    expect(frame.lines[0]).toContain('🐳')
    expect(frame.lines[0]).not.toContain('idle')
    expect(frame.lines[1]).toMatch(/^│ /)
    expect(frame.lines[1]).toContain('hi')
    expect(frame.lines[2]).toMatch(/^╰─/)
    expect(frame.cursor).toEqual({ row: 1, column: 4 })
  })

  it('places an optional permission cap on the top-right of the editor', () => {
    const frame = renderEditor({
      width: 40,
      input: 'hi',
      inputCursor: 2,
      status: ' 🐳 ',
      statusRight: ' full access ',
      border: 'border',
    }, theme)
    const top = frame.lines[0] ?? ''
    expect(top.startsWith('╭')).toBe(true)
    expect(top.indexOf('🐳')).toBeLessThan(top.indexOf('full access'))
    expect(top).toMatch(/full access ─+╮$/)
    expect(visibleWidth(top)).toBe(40)
  })

  it('paints a dim inline hint after the caret', () => {
    const frame = renderEditor({
      width: 40,
      input: '/copy ',
      inputCursor: 6,
      status: ' 🐳 ',
      border: 'border',
      inlineHint: 'text|code|cmd',
    }, theme)
    expect(frame.lines[1]).toContain('/copy ')
    expect(frame.lines[1]).toContain('text|code|cmd')
    expect(frame.cursor).toEqual({ row: 1, column: 8 })
    expect(visibleWidth(frame.lines[1] ?? '')).toBe(40)
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
  it('uses the DeepSeek Harness loading label by default', () => {
    const line = renderWorking(theme, 0, undefined, 40)[0] ?? ''
    expect(line).toContain('Deep Driving')
    expect(line).toContain('Ctrl+C: Interrupt')
  })

  it('sweeps a highlight across the Deep Driving label without changing its text or width', () => {
    const colorTheme = createTheme(true, true)
    const first = renderWorking(colorTheme, 0, undefined, 40)[0] ?? ''
    const later = renderWorking(colorTheme, 10, undefined, 40)[0] ?? ''
    expect(first).not.toBe(later)
    expect(stripAnsi(first)).toBe(stripAnsi(later))
    expect(visibleWidth(first)).toBe(visibleWidth(later))
    expect(later).toContain('\x1b[1m')
  })

  it('keeps the loading label stable when terminal colors are disabled', () => {
    const first = renderWorking(theme, 0, undefined, 40)[0] ?? ''
    const later = renderWorking(theme, 10, undefined, 40)[0] ?? ''
    expect(first).toBe(later)
  })

  it('shows the active tool action when available', () => {
    const line = renderWorking(theme, 0, 'bash · pnpm test', 40)[0] ?? ''
    expect(line).toContain('bash · pnpm test')
    expect(line).toContain('Ctrl+C: Interrupt')
    expect(visibleWidth(line)).toBeLessThanOrEqual(40)
  })
})
