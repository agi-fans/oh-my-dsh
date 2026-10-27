import { describe, expect, it } from 'vitest'
import { renderEditor, renderFramedBlock, renderWelcome } from './box.ts'
import { renderPermissionBadge } from './status-line.ts'
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
  const logoRow = '⢀⣤⣶⣿⣿⣿⣿⣿⣿⣿⣧⣄⡀⢻⣿⣷⣶⣶⣶⡿'
  /** The mark's widest row is twenty cells, so the wordmark starts four in. */
  const WORDMARK_COLUMN = 1 + 20 + 3

  it('draws the mark beside its name, version, and slogan', () => {
    const lines = renderWelcome({ width: 92, version: '0.1.0', appName: 'omdsh' }, theme)
    const text = lines.map(stripAnsi).join('\n')
    expect(text).toContain('omdsh v0.1.0')
    expect(text).toContain('Into the Unknown')
    expect(text).toContain(logoRow)
    // A lockup, not a card: no border, no tips table, no session list.
    for (const line of lines) expect(stripAnsi(line)).not.toMatch(/[╭╮╰╯│├┤┬┴]/u)
    expect(text).not.toContain('Recent sessions')
  })

  it('is inset from the terminal edge', () => {
    // The mark's widest row starts at column zero, so without a margin the logo
    // is welded to the edge while the transcript and composer below are not.
    const lines = renderWelcome({ width: 92, version: '0.1.0', appName: 'omdsh' }, theme).map(stripAnsi)
    const logo = lines.find(line => line.includes(logoRow)) ?? ''
    expect(logo.startsWith(' ')).toBe(true)
  })

  it('centres the wordmark against the mark rather than aligning their tops', () => {
    const lines = renderWelcome({ width: 92, version: '0.1.0', appName: 'omdsh' }, theme).map(stripAnsi)
    const nameRow = lines.findIndex(line => line.includes('omdsh v0.1.0'))
    const logoRows = lines.flatMap((line, at) => (line.includes('⣿') || line.includes('⠙') || line.includes('⠉') || line.includes(logoRow.slice(0, 6)) ? [at] : []))
    // The two-row bloc sits inside the six-row mark, not on its first row.
    expect(nameRow).toBeGreaterThan(0)
    expect(nameRow).toBeLessThan(logoRows.at(-1) ?? 0)
  })

  it('puts the hint under the lockup, in one row that names its keys', () => {
    const lines = renderWelcome({ width: 92, version: '0.1.0', appName: 'omdsh' }, theme).map(stripAnsi)
    const hint = lines.find(line => line.includes('commands')) ?? ''
    expect(hint).toContain('Tips:')
    expect(hint).toContain('/')
    expect(hint).toContain('files')
    expect(hint).toContain('shell')
    expect(hint).toContain('/help')
    expect(hint).toContain(' · ')
    expect(lines.at(-1)).toBe(hint)
  })

  it('teaches discovery keys, never the universal ones', () => {
    // `Esc` and `Enter` are learned once; a header that repeats them is a
    // permanent line about nothing the reader still needs.
    const hint = renderWelcome({ width: 92, version: '0.1.0', appName: 'omdsh' }, theme).map(stripAnsi).find(line => line.includes('commands')) ?? ''
    expect(hint).not.toContain('Esc')
    expect(hint).not.toContain('Enter')
    expect(hint).not.toContain('Ctrl+C')
  })

  it('keeps the hint when the wordmark folds under the mark', () => {
    const lines = renderWelcome({ width: 26, version: '0.1.0', appName: 'omdsh' }, theme).map(stripAnsi)
    expect(lines.join('\n')).toContain('commands')
  })

  it('never emits a row wider than the terminal', () => {
    for (const width of [140, 92, 60, 46, 40, 26, 18, 12, 8]) {
      for (const line of renderWelcome({ width, version: '0.1.0', appName: 'omdsh' }, theme)) {
        expect(oracleWidth(line), `width ${width}: ${line}`).toBeLessThanOrEqual(width)
      }
    }
  })

  it('drops the mark below its own width instead of cropping it', () => {
    // A cropped logo is not the logo, so the header becomes the wordmark alone.
    const lines = renderWelcome({ width: 16, version: '0.1.0', appName: 'omdsh' }, theme).map(stripAnsi)
    expect(lines.join('\n')).not.toContain(logoRow)
    expect(lines.join('\n')).toContain('omdsh v0.1.0')
  })

  it('names the product in full on the header, at every width that shows the lockup', () => {
    // The header names what this is; the command a reader types stays `omdsh`.
    // A longer name spends more of the row, so the folded layouts are the ones
    // that can regress: below the lockup width the wordmark moves under the mark
    // and the hint wraps, and every row still has to fit the terminal.
    const name = 'Oh-My-DSH'
    for (const width of [140, 100, 92, 80, 64, 52, 40, 36, 30, 24]) {
      const lines = renderWelcome({ width, version: '0.21.0', appName: name }, theme)
      const text = lines.map(stripAnsi).join('\n')
      expect(text, `width ${width}`).toContain(name)
      // The version stays on the name's own row, never orphaned onto a third.
      expect(text, `width ${width}`).toMatch(new RegExp(`${name} v0\\.21\\.0`, 'u'))
      for (const line of lines) expect(oracleWidth(line), `width ${width}`).toBeLessThanOrEqual(width)
    }
  })

  it('does not repeat the model or its effort, which the footer already shows', () => {
    const lines = renderWelcome({
      width: 92, model: 'deepseek-v4-pro', reasoningEffort: 'max', version: '0.1.0', appName: 'omdsh',
    }, theme).map(stripAnsi)
    expect(lines.join('\n')).not.toContain('deepseek-v4-pro')
  })

  it('keeps the brand and the hint layered in every shipped theme', () => {
    for (const name of THEME_NAMES) {
      const painted = createTheme(true, true, name)
      const text = renderWelcome({ width: 92, version: '0.1.0', appName: 'omdsh' }, painted).join('\n')
      expect(text, name).toContain(painted.getFgAnsi('muted'))
      expect(text, name).toContain(painted.getFgAnsi('dim'))
    }
  })
})

describe('renderEditor', () => {
  it('embeds its compact label in the top border and input on its own body row', () => {
    const frame = renderEditor({ width: 40, input: 'hi', inputCursor: 2, status: ' 🐳 ', border: 'border' }, theme)
    expect(frame.lines).toHaveLength(3)
    // Ruled above and below, with no side borders: the composer sits inside a
    // screen that already has a status footer under it.
    expect(frame.lines[0]).toMatch(/^──/)
    expect(frame.lines[0]).toContain('🐳')
    expect(frame.lines[0]).not.toContain('idle')
    // One column of padding, no side border.
    expect(frame.lines[1]).toMatch(/^ hi/)
    expect(frame.lines[2]).toMatch(/^─+$/u)
    expect(frame.cursor).toEqual({ row: 1, column: 3 })
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
    expect(top.indexOf('🐳')).toBeLessThan(top.indexOf('full access'))
    expect(top).toMatch(/full access ─$/u)
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
    expect(frame.cursor).toEqual({ row: 1, column: 7 })
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
    // The activity stays inside the rule with border glyphs on both sides.
    expect(top).toMatch(/^─+ ⠸ Deep Driving ─+/u)
    expect(top).toMatch(/─$/u)
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
    expect(top).toMatch(/workspace write ─$/u)
    expect(oracleWidth(top)).toBe(60)
  })

  it('keeps the access level whole on every width while the activity runs', () => {
    // The activity row was assembled from `fillWidth + 4`, a constant left over
    // from the four-cell corner pair this composer no longer draws. Every
    // running frame was therefore one cell too wide and the renderer truncated
    // its right-hand rule — which is exactly where the access level stands, so
    // a running turn showed `workspace write…` instead of the badge.
    const badge = renderPermissionBadge('workspace-write', theme)
    for (const width of [220, 120, 100, 80, 60, 48, 40]) {
      const frame = renderEditor({
        width,
        input: '',
        inputCursor: 0,
        status: ' 🐳 ',
        statusRight: ' ' + badge + ' ',
        border: 'accent',
        activity: { frame: '⠸', label: 'Deep Driving', shimmer: true },
      }, theme)
      const top = frame.lines[0] ?? ''
      expect(oracleWidth(top), `width ${width}`).toBe(width)
      // Not merely present: whole, with its closing rule still attached.
      expect(stripAnsi(top), `width ${width}`).toMatch(/workspace write ─$/u)
    }
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
    expect(frame.cursor).toEqual({ row: 1, column: 3 })
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
