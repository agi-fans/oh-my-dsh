import { describe, expect, it } from 'vitest'
import type { TuiPrompt } from '../definition.ts'
import { promptTreeRows } from './prompt-tree.ts'
import { filteredPromptOptions, movePromptTree, renderPromptTreePage, searchPromptSelection, selectedPromptAnswer } from './prompt-selector.ts'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'

const request: TuiPrompt = { title: 'Session Tree', question: '', presentation: 'fullscreen-tree', filterable: true,
  actions: [{ key: 'C', label: 'continue branch', valuePrefix: 'continue:' }], options: [
    { value: 'root', label: 'Conversation' },
    { value: 'first', parentValue: 'root', label: 'Shared turn', preview: 'Full user message 中文 🐳\n\nFull reply 👩‍💻' },
    { value: 'second', parentValue: 'first', label: 'Original', submitLabel: 'edit from here' },
    { value: 'third', parentValue: 'second', label: 'Next turn' },
    { value: 'fork', parentValue: 'first', label: 'Alternative', badge: { label: 'Current', tone: 'success' } },
    { value: 'retry', parentValue: 'fork', label: 'Try another way' },
  ] }
const state = () => ({ request, selected: 1, checked: new Set<number>() })

describe('hierarchical prompt selector', () => {
  it('retains ancestor context during search and preserves chronological tree order', () => {
    expect(filteredPromptOptions(request, 'Try another').map(option => option.value)).toEqual(['root', 'first', 'fork', 'retry'])
    expect(searchPromptSelection(state(), 'Try another').selected).toBe(3)
    expect(promptTreeRows(request).map(row => row.prefix)).toEqual(['', '', '├─ ', '│  ', '└─ ', '   '])
  })
  it('folds a subtree, unfolds it, and resolves the selected value in the visible tree', () => {
    const folded = movePromptTree(state(), 'left', '')
    expect(filteredPromptOptions(request, '', folded.collapsed).map(option => option.value)).toEqual(['root', 'first'])
    expect(selectedPromptAnswer(folded)).toBe('first')
    const opened = movePromptTree(folded, 'right', '')
    expect(filteredPromptOptions(request, '', opened.collapsed)).toHaveLength(6)
    expect(movePromptTree(opened, 'right', '').selected).toBe(2)
    expect(movePromptTree({ ...opened, selected: 3 }, 'left', '').selected).toBe(2)
  })
  it.each([false, true])('fits previews and borders in wide and stacked layouts (colors=%s)', colors => {
    for (const width of [20, 40, 80, 90, 120]) for (const height of [10, 24, 58]) {
      const frame = renderPromptTreePage(state(), createTheme(colors), width, height, '中文', 2, 'omdsh')
      expect(frame.lines).toHaveLength(height)
      expect(frame.lines.every(line => visibleWidth(line) <= width)).toBe(true)
      expect(frame.cursor.row).toBeLessThan(height)
      expect(frame.cursor.column).toBeLessThan(width)
    }
    const frame = renderPromptTreePage(state(), createTheme(colors), 120, 24, '', 0, 'omdsh')
    expect(frame.lines.map(stripAnsi).join('\n')).toContain('Full user message 中文 🐳')
    expect(frame.lines.map(stripAnsi).join('\n')).toContain('Full reply 👩‍💻')
  })
  it.each([false, true])('keeps label and filter actions visible on a narrow terminal (colors=%s)', colors => {
    const frame = renderPromptTreePage({ ...state(), request: { ...request, actions: [
      { key: 'Alt+Enter', label: 'continue branch', valuePrefix: 'continue:' },
      { key: 'Alt+L', label: 'label', valuePrefix: 'label:' },
      { key: 'Alt+U', label: 'clear label', valuePrefix: 'unlabel:' },
      { key: 'Alt+B', label: 'marked nodes', valuePrefix: 'marked:', scope: 'list' },
    ] } }, createTheme(colors), 60, 24, '', 0, 'omdsh')
    const text = stripAnsi(frame.lines.join(' '))
    for (const key of ['Alt+Enter', 'Alt+L', 'Alt+U', 'Alt+B']) expect(text).toContain(key)
    expect(frame.lines).toHaveLength(24)
    expect(frame.lines.every(line => visibleWidth(line) === 60)).toBe(true)
  })

  it('bounds preview scrolling and does not consume indentation for long linear histories', () => {
    const chain: TuiPrompt = { ...request, options: Array.from({ length: 5000 }, (_, index) => ({
      value: String(index), ...(index === 0 ? {} : { parentValue: String(index - 1) }), label: `Turn ${index}`,
    })) }
    const rows = promptTreeRows(chain)
    expect(rows).toHaveLength(5000)
    expect(rows.at(-1)?.prefix).toBe('')
    const frame = renderPromptTreePage({ ...state(), previewScroll: 10000 }, createTheme(false), 100, 24, '', 0, 'omdsh')
    expect(frame.document?.start).toBe(frame.document?.maxStart)
  })
  it('breaks cycles and treats missing parents as roots', () => {
    const malformed: TuiPrompt = { ...request, options: [
      { value: 'a', parentValue: 'b', label: 'A' }, { value: 'b', parentValue: 'a', label: 'B' },
      { value: 'c', parentValue: 'missing', label: 'C' },
    ] }
    expect(promptTreeRows(malformed)).toHaveLength(3)
  })
})
