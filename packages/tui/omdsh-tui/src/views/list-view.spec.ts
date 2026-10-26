import { describe, expect, it } from 'vitest'
import { createTheme } from '../chrome/theme.ts'
import { visibleWidth } from '../chrome/width.ts'
import {
  LIST_CURSOR_CELLS,
  listPrimaryColumnWidth,
  listVisibleRange,
  renderList,
  renderListCounter,
  renderListRow,
  renderListRowWithValue,
  type ListRow,
} from './list-view.ts'

const theme = createTheme(false)
const color = createTheme(true, true)

const rows: readonly ListRow[] = [
  { label: 'read', description: 'Read a file' },
  { label: 'search_code', description: 'Search the workspace' },
  { label: 'write', description: 'Write a file' },
]

describe('listVisibleRange', () => {
  it('shows a short list whole and centres a long one on the selection', () => {
    expect(listVisibleRange(3, 1, 5)).toEqual({ start: 0, end: 3 })
    // Centred, then clamped so both ends stay reachable.
    expect(listVisibleRange(20, 10, 5)).toEqual({ start: 8, end: 13 })
    expect(listVisibleRange(20, 0, 5)).toEqual({ start: 0, end: 5 })
    expect(listVisibleRange(20, 19, 5)).toEqual({ start: 15, end: 20 })
  })

  it('keeps at least one row for a terminal that is too short to hold two', () => {
    expect(listVisibleRange(10, 4, 0)).toEqual({ start: 4, end: 5 })
  })
})

describe('renderListRow', () => {
  it('reserves the same cursor cells selected and unselected', () => {
    const selected = renderListRow(rows[0]!, theme, 40, { selected: true })
    const plain = renderListRow(rows[0]!, theme, 40, { selected: false })
    expect(plain.startsWith(' '.repeat(LIST_CURSOR_CELLS) + 'read')).toBe(true)
    expect(visibleWidth(selected)).toBeLessThanOrEqual(40)
    // The label starts in the same column either way, so selection never shifts
    // the text sideways.
    expect(selected.indexOf('read')).toBe(plain.indexOf('read'))
  })

  it('paints a heading with the cursor cells but no cursor', () => {
    const heading = renderListRow({ label: 'Commands', heading: true }, color, 40, { selected: true })
    expect(heading).not.toContain('❯')
    // The heading shares the label column, so it reads as a caption for the
    // rows below instead of as a row competing with them.
    expect(heading).toContain('Commands')
  })
})

describe('renderListRowWithValue', () => {
  it('aligns every description to the same column', () => {
    const width = listPrimaryColumnWidth(rows, 60)
    const lines = rows.map(entry => renderListRowWithValue(entry, theme, 60, width, { selected: false }))
    const starts = lines.map((line, at) => {
      const description = rows[at]!.description ?? ''
      return line.indexOf(description)
    })
    // Every description begins at the same column: that alignment is the whole
    // point of the shared row.
    expect(starts.every(start => start > 0)).toBe(true)
    expect(new Set(starts).size).toBe(1)
  })

  it('right-aligns a value and keeps the row inside the frame', () => {
    const line = renderListRowWithValue({ label: 'theme', value: 'dark' }, theme, 30, 8, { selected: false })
    expect(line).toHaveLength(30)
    expect(line.endsWith('dark')).toBe(true)
    expect(line).not.toMatch(/\s+$/u)
  })

  it('drops a description too short to say anything rather than clipping it', () => {
    const line = renderListRowWithValue({ label: 'deepseek-v4-flash', description: 'DeepSeek' }, theme, 22, 18, { selected: false })
    expect(line).not.toContain('DeepS')
    expect(visibleWidth(line)).toBeLessThanOrEqual(22)
  })

  it('stops at the last visible cell when a row has no value', () => {
    const line = renderListRowWithValue({ label: 'read', description: 'Read a file' }, theme, 40, 4, { selected: false })
    expect(line).not.toMatch(/\s+$/u)
  })
})

describe('renderList', () => {
  it('window a long list and counts it once', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ label: `row-${index}` }))
    const lines = renderList({ rows: many, selected: 6, width: 20, maxVisible: 5 }, theme)
    expect(lines).toHaveLength(6)
    expect(lines.at(-1)).toContain('(7/12)')
    expect(lines[0]).toContain('row-4')
  })

  it('marks the edges that hide rows, in the cursor cell', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ label: `row-${index}` }))
    const lines = renderList({ rows: many, selected: 6, width: 20, maxVisible: 5 }, theme)
    expect(lines[0]?.trimStart().startsWith('↑')).toBe(true)
    expect(lines[4]?.trimStart().startsWith('↓')).toBe(true)
  })

  it('leaves a list that fits unmarked and uncounted', () => {
    const lines = renderList({ rows: rows.map(row => ({ label: row.label })), selected: 0, width: 20 }, theme)
    expect(lines).toHaveLength(3)
    expect(lines.join('\n')).not.toContain('↑')
    expect(lines.join('\n')).not.toContain('(1/3)')
  })
})

describe('renderListCounter', () => {
  it('reports a one-based position against the total', () => {
    expect(renderListCounter(theme, 0, 4, 20)).toBe('  (1/4)')
  })
})

/** The primary column of a rendered row, for offset comparisons. */
function labelOf(line: string): string {
  return line.slice(LIST_CURSOR_CELLS).trimStart().split(/\s+/u)[0] ?? ''
}
