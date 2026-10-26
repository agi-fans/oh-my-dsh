import { describe, expect, it } from 'vitest'
import { renderEditor, renderFramedBlock, renderWelcome } from './box.ts'
import { createTheme, THEME_NAMES } from './theme.ts'
import { stripAnsi } from './width.ts'
import { oracleWidth } from './width.oracle.ts'

const theme = createTheme(false)

describe('renderFramedBlock', () => {
  it('draws a rounded box with a header and body', () => {
    const lines = renderFramedBlock({ header: '✔ bash', lines: ['output'], width: 40, state: 'ok' }, theme)
    expect(lines[0]).toMatch(/^╭───/)
    expect(lines[0]).toContain('✔ bash')
    expect(lines.some((line) => line.includes('output'))).toBe(true)
    expect(lines[lines.length - 1]).toMatch(/^╰/)
    for (const line of lines) expect(oracleWidth(line)).toBe(40)
  })

  it('keeps tab-indented command output inside the terminal width', () => {
    for (const activeTheme of [theme, createTheme(true, true)]) {
      const lines = renderFramedBlock({
        header: '✔ bash',
        lines: ['\tmodified: packages/tui/omdsh-tui/src/box.ts'],
        width: 40,
        state: 'ok',
      }, activeTheme)
      for (const line of lines) expect(oracleWidth(line)).toBe(40)
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
      expect(oracleWidth(top)).toBe(80)
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
    for (const line of lines) expect(oracleWidth(line)).toBe(40)
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
    for (const line of lines) expect(oracleWidth(line)).toBe(width)
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
    expect(oracleWidth(top)).toBe(40)
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
    expect(oracleWidth(frame.lines[1] ?? '')).toBe(40)
  })

  it('draws an activity inside the top border and keeps the frame exact', () => {
    const base = { input: 'hi', inputCursor: 2, status: ' 🐳 ', border: 'border' as const }
    const frame = renderEditor({
      ...base,
      width: 60,
      activity: { frame: '⠸', label: 'Deep Driving' },
    }, theme)
    const top = frame.lines[0] ?? ''
    // The composer label yields to the activity rather than sharing the border.
    expect(top).not.toContain('🐳')
    expect(top).toContain('⠸ Deep Driving')
    // The activity stays inside the rounded frame with border glyphs on both sides.
    expect(top).toMatch(/^╭─+ ⠸ Deep Driving ─+/u)
    expect(top).toMatch(/─╮$/u)
    expect(oracleWidth(top)).toBe(60)
  })

  it('leaves the top-right corner free for the access level', () => {
    // A cancel hint used to occupy this corner and pushed the access level out
    // of the frame. `Esc` needs no reminder, so the corner is the badge's.
    const frame = renderEditor({
      width: 60,
      input: '',
      inputCursor: 0,
      status: ' 🐳 ',
      statusRight: ' workspace write ',
      border: 'border',
      activity: { frame: '⠸', label: 'Deep Driving' },
    }, theme)
    const top = frame.lines[0] ?? ''
    expect(top).toContain('⠸ Deep Driving')
    expect(top).toContain('workspace write')
    expect(top).toMatch(/workspace write ─╮$/u)
    expect(oracleWidth(top)).toBe(60)
  })

  it('paints the activity without a frame when the composer has no label', () => {
    const frame = renderEditor({
      width: 40,
      input: '',
      inputCursor: 0,
      status: '',
      border: 'border',
      activity: { frame: '⠸', label: 'Compacting' },
    }, theme)
    const top = frame.lines[0] ?? ''
    expect(top).toContain('⠸ Compacting')
    expect(oracleWidth(top)).toBe(40)
  })

  it('keeps the activity label as long as the frame can hold it', () => {
    const activity = { frame: '⠸', label: 'Deep Driving' }
    const narrow = renderEditor({ width: 34, input: '', inputCursor: 0, status: ' 🐳 ', border: 'border', activity }, theme)
    const narrowTop = narrow.lines[0] ?? ''
    expect(narrowTop).toContain('Deep Driving')
    expect(oracleWidth(narrowTop)).toBe(34)
    // The spinner alone is the last thing to survive.
    const tiny = renderEditor({ width: 18, input: '', inputCursor: 0, status: ' 🐳 ', border: 'border', activity }, theme)
    expect(tiny.lines[0]).toContain('⠸')
    expect(tiny.lines[0]).not.toContain('Deep Driving')
    expect(oracleWidth(tiny.lines[0] ?? '')).toBe(18)
  })

  it('prints a note on the bottom border and leaves the input row alone', () => {
    const frame = renderEditor({
      width: 40,
      input: 'hi',
      inputCursor: 2,
      status: ' 🐳 ',
      border: 'border',
      note: 'Thinking: hidden',
    }, theme)
    expect(frame.lines[2]).toContain('Thinking: hidden')
    expect(frame.lines[1]).not.toContain('Thinking: hidden')
    expect(oracleWidth(frame.lines[2] ?? '')).toBe(40)
    // The input row and the cursor keep their positions, so a note never moves
    // the caret the reader is typing at.
    expect(frame.cursor).toEqual({ row: 1, column: 4 })
  })

  it('omits a note that cannot fit rather than truncating the frame', () => {
    const frame = renderEditor({
      width: 20,
      input: '',
      inputCursor: 0,
      status: '',
      border: 'border',
      note: 'A confirmation far too long to fit here',
    }, theme)
    expect(frame.lines[2]).not.toContain('A confirmation')
    expect(oracleWidth(frame.lines[2] ?? '')).toBe(20)
  })
})
