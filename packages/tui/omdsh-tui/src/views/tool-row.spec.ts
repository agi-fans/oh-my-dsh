import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { blockLines } from './event-views.ts'
import { createTheme, paintSurface, THEME_NAMES } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import type { Block } from './transcript-types.ts'

type Tool = Extract<Block, { kind: 'tool' }>
const tool = (over: Partial<Tool> = {}): Tool => ({ kind: 'tool', callId: ToolCallId('call'), name: 'bash', status: 'ok', args: '{}', output: '', ...over })
const render = (block: Tool, width = 80, colors = false, full = false) => blockLines(block, createTheme(colors), width, { toolsExpanded: full })
const text = (block: Tool, full = false) => render(block, 80, false, full).map(stripAnsi).join('\n')

describe('tool content', () => {
  it.each(THEME_NAMES)('%s colors added and removed counts in collapsed edit summaries', name => {
    for (const colors of [false, true]) {
      const theme = createTheme(colors, true, name)
      const block = tool({ name: 'edit', args: '{"path":"src/service.py"}', presentation: { result: {
        card: 'diff', diffs: [{ path: 'src/service.py', oldText: 'old1\nold2\nold3\nold4', newText: 'new1\nnew2\nnew3\nnew4\nnew5\nnew6' }],
      } } })
      for (const width of [24, 80, 160]) {
        const rows = blockLines(block, theme, width, { processDisclosure: true })
        const text = rows.join('\n')
        expect(stripAnsi(text)).toContain('+6/-4')
        if (colors) {
          expect(text).toContain(theme.fg('toolDiffAdded', '+6'))
          expect(text).toContain(theme.fg('toolDiffRemoved', '-4'))
        } else expect(text).not.toContain('\x1b')
        expect(rows.every(row => visibleWidth(row) === width)).toBe(true)
      }
    }
  })

  it.each(THEME_NAMES)('%s restores card ink and fill after terminal output resets', name => {
    const theme = createTheme(true, true, name)
    const rows = blockLines(tool({ output: '\x1b[31mcolored\x1b[0;39;49m ordinary' }), theme, 80)
    expect(rows.join('\n')).toContain('\x1b[0;39;49m' + theme.getFgAnsi('toolOutput') + theme.getBgAnsi('toolSuccessBg') + ' ordinary')
    expect(rows.every(row => row.endsWith('\x1b[39m\x1b[49m'))).toBe(true)
  })

  it.each(THEME_NAMES)('%s supplies prompt ink before and after wrapped path mentions', name => {
    for (const trueColor of [false, true]) {
      const theme = createTheme(true, trueColor, name)
      const rows = blockLines({ kind: 'user', text: '检查 🐳 @"docs/my long file.md", then continue' }, theme, 20)
      for (const row of rows) {
        expect(row.startsWith(theme.getBgAnsi('userMessageBg') + theme.getFgAnsi('userMessageText'))).toBe(true)
        expect(row.endsWith('\x1b[39m\x1b[49m')).toBe(true)
        expect(visibleWidth(row)).toBe(20)
      }
      expect(stripAnsi(rows.join(''))).toContain('检查')
    }
  })

  it.each(['running', 'ok', 'error'] as const)('pads the entire %s surface with the active theme background', status => {
    const block = tool({ status, args: '{"command":"pwd"}', output: 'workspace' })
    const background = status === 'running' ? 'toolPendingBg' : status === 'error' ? 'toolErrorBg' : 'toolSuccessBg'
    for (const name of THEME_NAMES) {
      for (const colors of [false, true]) {
        for (const trueColor of [false, true]) {
          const theme = createTheme(colors, trueColor, name)
          const rows = blockLines(block, theme, 40)
          const blank = paintSurface(theme, background, 'toolOutput', ' '.repeat(40))
          expect(rows[0]).toBe(blank)
          expect(rows.at(-1)).toBe(blank)
          expect(stripAnsi(rows[1]!)).toMatch(/^  \$ pwd +$/u)
          expect(rows.every(row => visibleWidth(row) === 40)).toBe(true)
          if (colors) expect(rows.every(row => row.startsWith(theme.getBgAnsi(background)))).toBe(true)
          else expect(rows.join('')).not.toContain('\x1b[')
        }
      }
    }
  })

  it('shows read paths and omits successful file contents', () => {
    const block = tool({ name: 'read', args: '{"path":"src/main.ts"}', output: 'private contents' })
    expect(text(block)).toContain('read src/main.ts')
    expect(text(block)).not.toContain('private contents')
    expect(text(block, true)).toContain('private contents')
  })
  it('uses a read presentation when arguments are absent', () => {
    expect(text(tool({ name: 'read', presentation: { result: { card: 'read', path: 'file.ts', lines: [], totalLines: 0 } } }))).toContain('read file.ts')
  })
  it.each(['running', 'ok'] as const)('keeps the last five visual shell lines while %s', status => {
    const block = tool({ status, args: '{"command":"pnpm test","description":"Test project"}', output: Array.from({ length: 20 }, (_, i) => `row-${i}`).join('\n') })
    const output = text(block)
    expect(output).toContain('$ pnpm test')
    expect(output).not.toContain('Test project')
    expect(output).not.toContain('row-14')
    expect(output).toContain('row-15')
    expect(output).toContain('row-19')
    expect(output).toContain('15 earlier lines')
    expect(output).not.toMatch(/[╭╰│]/u)
  })
  it.each([['grep', 15], ['find', 20], ['ls', 20], ['custom', 10]] as const)('previews %s results from the start', (name, limit) => {
    const output = text(tool({ name, output: Array.from({ length: 30 }, (_, i) => `row-${i}`).join('\n') }))
    expect(output).toContain('row-0')
    expect(output).toContain(`row-${limit - 1}`)
    expect(output).not.toContain(`row-${limit}\n`)
    expect(output).toContain(`${30 - limit} more lines`)
  })
  it('decodes incomplete command arguments', () => {
    expect(text(tool({ status: 'running', partial: true, args: '{"command":"ls /tm' }))).toContain('$ ls /tm')
  })
  it('uses semantic titles for plugin calls', () => {
    expect(text(tool({ name: 'custom', presentation: { call: { card: 'generic', title: 'Inspect account' } } }))).toContain('Inspect account')
  })
  it('preserves deliverable names and paths from the tool presentation', () => {
    const output = text(tool({ name: 'present', args: JSON.stringify({ files: [{ path: 'report.md', description: 'Results' }] }), output: 'Presented report.md' }))
    expect(output).toContain('Deliverables')
    expect(output).toContain('report.md — Results')
    expect(output).not.toContain('Presented report.md')
  })
  it('keeps errors visible even for read calls', () => {
    const block = tool({ name: 'read', status: 'error', args: '{"path":"missing"}', output: 'No such file' })
    expect(text(block)).toContain('No such file')
    expect(text(block)).toContain('Tool failed')
    expect(render(block, 80, true).join('\n')).toContain(createTheme(true).getFgAnsi('error'))
  })
  it('renders edit diffs without a frame or a duplicate raw result', () => {
    const output = text(tool({ name: 'edit', args: '{"path":"a.ts"}', output: 'raw output', presentation: { result: { card: 'diff', diffs: [{ path: 'a.ts', oldText: 'old', newText: 'new' }] } } }))
    expect(output).toContain('old')
    expect(output).toContain('new')
    expect(output).not.toContain('raw output')
    expect(output).not.toMatch(/[╭╰]/u)
  })
  it('preserves generic errors after a diff call', () => {
    const output = text(tool({ name: 'edit', status: 'error', output: 'permission denied', presentation: { call: { card: 'diff', title: 'Edit a', diffs: [] }, result: { card: 'generic', content: [{ type: 'text', text: 'permission denied' }] } } }))
    expect(output).toContain('permission denied')
  })
  it.each([false, true])('wraps commands and pads output in display cells (colors=%s)', colors => {
    for (const width of [8, 20, 40, 80, 120]) {
      const block = tool({ args: JSON.stringify({ command: '检查🐳é'.repeat(40) + 'COMMAND_END' }), output: '检查🐳é'.repeat(40) + 'OUTPUT_END' })
      const rows = render(block, width, colors)
      expect(rows.every(row => visibleWidth(row) === width)).toBe(true)
      expect(rows.every(row => stripAnsi(row).endsWith('  '))).toBe(true)
      expect(rows.map(stripAnsi).join('').replaceAll(' ', '')).toContain('COMMAND_END')
      expect(rows.map(stripAnsi).join('').replaceAll(' ', '')).toContain('OUTPUT_END')
    }
  })
})

describe('tool card surfaces and payload ink', () => {
  const color = createTheme(true, true, 'dark', { trueColor: true } as never)

  it('paints commands and terminal results without adding syntax colors', () => {
    // Command emphasis and output ink remain distinct without guessing the
    // language of a terminal result.
    const block = tool({
      name: 'bash',
      args: JSON.stringify({ command: 'git status --short\nls -la | head -2' }),
      output: 'M a.ts',
      status: 'ok',
    })
    const rows = blockLines(block, color, 60, { toolsExpanded: false })
    const commandRows = rows.filter(row => /git status|ls -la/u.test(stripAnsi(row)))
    expect(commandRows).toHaveLength(2)
    // One ink for the whole command. `wrapText` opens the bold span on the first
    // row and closes it after the last, so a continuation row carries the card's
    // surface ink alone — never a second syntax colour.
    const syntaxInks = new Set<string>()
    for (const row of commandRows) {
      for (const match of row.matchAll(/\x1b\[38;2;([0-9;]+)m/gu)) {
        const ink = match[0]!
        if (ink !== color.getFgAnsi('toolOutput')) syntaxInks.add(ink)
      }
    }
    expect([...syntaxInks]).toEqual([color.getFgAnsi('toolTitle')])
    // The output row is not constrained to that ink.
    const outputRow = rows.find(row => stripAnsi(row).includes('M a.ts')) ?? ''
    expect(outputRow).not.toContain(color.getFgAnsi('toolTitle'))
  })

  it('gives a successful and a failed card different background surfaces', () => {
    const ok = blockLines(tool({ name: 'bash', args: JSON.stringify({ command: 'true' }), output: 'fine', status: 'ok' }), color, 40)
    const failed = blockLines(tool({ name: 'bash', args: JSON.stringify({ command: 'false' }), output: 'boom', status: 'error' }), color, 40)
    expect(ok.join('\n')).toContain(color.getBgAnsi('toolSuccessBg'))
    expect(failed.join('\n')).toContain(color.getBgAnsi('toolErrorBg'))
    expect(failed.join('\n')).not.toContain(color.getBgAnsi('toolSuccessBg'))
  })

  it('gives a running card the pending surface', () => {
    const rows = blockLines(tool({ name: 'bash', args: JSON.stringify({ command: 'sleep 5' }), output: '', status: 'running' }), color, 40)
    expect(rows.join('\n')).toContain(color.getBgAnsi('toolPendingBg'))
  })
})

describe('wrapped tool command rows', () => {
  it('keeps the command ink on every wrapped row of a long command', () => {
    // The command is one bold ink; a long one must not lose that ink after its
    // first visual row.
    const command = 'cd /Users/dy/Workspace/dsh-tui && git diff --stat HEAD && echo "=== NEW FILES ===" && wc -l packages/tui/omdsh-tui/src/input/actions.ts'
    const color = createTheme(true, true, 'dark')
    const rows = blockLines(tool({ name: 'bash', args: JSON.stringify({ command }), output: '', status: 'ok' }), color, 92)
      .filter(row => /dsh-tui|NEW FILES|actions\.ts/u.test(stripAnsi(row)))
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) {
      // `toolOutput` is the card's paired surface ink and may appear; anything
      // else painting text must be the title ink.
      const inks = new Set([...row.matchAll(/\x1b\[38;2;[0-9;]+m/gu)].map(match => match[0])
        .filter(ink => ink !== color.getFgAnsi('toolOutput')))
      expect([...inks], stripAnsi(row)).toEqual([color.getFgAnsi('toolTitle')])
    }
  })
})

describe('readable tool detail spacing and source columns', () => {
  const theme = createTheme(true, true, 'dark')
  const details = (block: Tool, width = 60, raw = false, colors = true) => blockLines(block, colors ? theme : createTheme(false), width, {
    processDisclosure: true, toolsExpanded: true, rawTool: raw,
  })

  it.each([
    ['running', 'toolPendingBg'], ['ok', 'toolSuccessBg'], ['error', 'toolErrorBg'],
  ] as const)('uses the %s state surface throughout expanded details', (status, background) => {
    for (const name of THEME_NAMES) for (const colors of [false, true]) for (const trueColor of [false, true]) {
      const theme = createTheme(colors, trueColor, name)
      const block = tool({ status, args: '{"command":"pwd"}', output: '中文🐳é '.repeat(8) + (colors ? '\x1b[0;39;49m' : '') + 'END' })
      for (const raw of [false, true]) for (const width of [20, 60]) {
        const rows = blockLines(block, theme, width, { processDisclosure: true, toolsExpanded: true, rawTool: raw })
        const blank = paintSurface(theme, background, 'toolOutput', ' '.repeat(width))
        expect(rows[1]).toBe(blank)
        expect(rows.at(-1)).toBe(blank)
        expect(rows.every(row => visibleWidth(row) === width)).toBe(true)
        if (colors) {
          expect(rows.slice(1).every(row => row.startsWith(theme.getBgAnsi(background)))).toBe(true)
          expect(rows.slice(1).every(row => row.endsWith('\x1b[39m\x1b[49m'))).toBe(true)
          expect(rows.join('\n')).toContain('\x1b[0;39;49m' + theme.getFgAnsi('toolOutput') + theme.getBgAnsi(background) + 'END')
        } else expect(rows.join('\n')).not.toContain('\x1b')
      }
    }
  })

  it.each([false, true])('does not syntax-color terminal output as shell source (raw=%s)', raw => {
    for (const name of ['bash', 'pwsh', 'exec', 'custom']) {
      const block = tool({ name, args: '{"command":"ls"}', output: 'history\ntotal 344\nconst value = 12',
        ...(name === 'custom' ? { presentation: { call: { card: 'terminal' as const, title: 'ls' } } } : {}),
      })
      const rows = details(block, 60, raw).filter(row => /history|total 344|const value/.test(stripAnsi(row)))
      expect(rows).toHaveLength(3)
      for (const row of rows) {
        expect([...new Set([...row.matchAll(/\x1b\[38;2;[0-9;]+m/g)].map(match => match[0]))]).toEqual([theme.getFgAnsi('toolOutput')])
      }
    }
  })

  it.each([false, true])('keeps line numbers in their own column across long and short lines (raw=%s)', raw => {
    const block = tool({ name: 'read', args: '{"path":"README.md"}', output: 'durable result', presentation: { result: {
      card: 'read', path: 'README.md', totalLines: 1000, lines: [
        { number: 9, text: '    START ' + '中文🐳é '.repeat(16) + 'END' },
        { number: 10, text: '' },
        { number: 100, text: '  SHORT' },
        { number: 1000, text: '\tTAB' },
      ],
    } } })
    for (const colors of [false, true]) for (const width of [20, 40, 80]) {
      const rows = details(block, width, raw, colors).map(stripAnsi)
      expect(rows.every(row => visibleWidth(row) <= width)).toBe(true)
      const first = rows.findIndex(row => /^       9  /.test(row))
      expect(first).toBeGreaterThan(0)
      expect(rows[first]).toMatch(/^       9      STAR/)
      if (width > 20) expect(rows[first]).toContain('START')
      const empty = rows.findIndex(row => /^      10 +$/.test(row))
      expect(empty).toBeGreaterThan(first + 1)
      for (const row of rows.slice(first + 1, empty)) expect(row.startsWith(' '.repeat(10))).toBe(true)
      expect(rows.find(row => row.includes('SHORT'))).toMatch(/^     100    SHORT/)
      const source = rows.slice(first, empty).map(row => row.slice(10)).join('').replaceAll(/\s/gu, '')
      expect(source).toBe(('START ' + '中文🐳é '.repeat(16) + 'END').replaceAll(/\s/gu, ''))
    }
  })

  it('highlights recognized file code without coloring the line-number gutter', () => {
    const rows = details(tool({ name: 'read', args: '{"path":"source.ts"}', presentation: { result: {
      card: 'read', path: 'source.ts', totalLines: 1, lines: [{ number: 1, text: 'const value = 12' }],
    } } }))
    const line = rows.find(row => stripAnsi(row).includes('const value'))!
    expect(line).toContain(theme.getFgAnsi('syntaxNumber'))
    expect(stripAnsi(line)).toMatch(/^    1  const value/)
  })

  it('preserves Diff ink on every state surface in formatted and raw details', () => {
    for (const status of ['running', 'ok', 'error'] as const) for (const raw of [false, true]) {
      const rows = details(tool({ name: 'edit', status, args: '{"path":"source.ts"}', presentation: { result: {
        card: 'diff', diffs: [{ path: 'source.ts', oldText: 'const value = 1', newText: 'const value = 2' }],
      } } }), 60, raw)
      const removed = rows.find(row => stripAnsi(row).includes('const value = 1'))!
      const added = rows.find(row => stripAnsi(row).includes('const value = 2'))!
      const background = theme.getBgAnsi(status === 'running' ? 'toolPendingBg' : status === 'error' ? 'toolErrorBg' : 'toolSuccessBg')
      expect(removed.startsWith(background)).toBe(true)
      expect(added.startsWith(background)).toBe(true)
      expect(removed).toContain(theme.getFgAnsi('toolDiffRemoved'))
      expect(added).toContain(theme.getFgAnsi('toolDiffAdded'))
      expect(rows.slice(1).every(row => row.endsWith('\x1b[39m\x1b[49m'))).toBe(true)
    }
  })
})
