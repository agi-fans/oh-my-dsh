import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { blockLines } from './event-views.ts'
import { createTheme, THEME_NAMES } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import type { Block } from './transcript-types.ts'

type Tool = Extract<Block, { kind: 'tool' }>
const tool = (over: Partial<Tool> = {}): Tool => ({ kind: 'tool', callId: ToolCallId('call'), name: 'bash', status: 'ok', args: '{}', output: '', ...over })
const render = (block: Tool, width = 80, colors = false, full = false) => blockLines(block, createTheme(colors), width, 0, full)
const text = (block: Tool, full = false) => render(block, 80, false, full).map(stripAnsi).join('\n')

describe('tool content', () => {
  it.each(['running', 'ok', 'error'] as const)('pads the entire %s surface with the active theme background', status => {
    const block = tool({ status, args: '{"command":"pwd"}', output: 'workspace' })
    const background = status === 'running' ? 'toolPendingBg' : status === 'error' ? 'toolErrorBg' : 'toolSuccessBg'
    for (const name of THEME_NAMES) {
      for (const colors of [false, true]) {
        for (const trueColor of [false, true]) {
          const theme = createTheme(colors, trueColor, name)
          const rows = blockLines(block, theme, 40)
          const blank = theme.bg(background, ' '.repeat(40))
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
