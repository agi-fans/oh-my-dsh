import { describe, expect, it } from 'vitest'
import {
  alignFileDiffs,
  contentLines,
  countDiffStats,
  formatDiffRows,
  formatDiffStats,
  paintDiffRow,
  paintDiffStats,
  rowText,
  wrapPaintedDiffRows,
} from './diff-render.ts'
import { createTheme } from './theme.ts'
import { stripAnsi } from './width.ts'

describe('contentLines', () => {
  it('treats a trailing newline as a terminator', () => {
    expect(contentLines('')).toEqual([])
    expect(contentLines('a\n')).toEqual(['a'])
    expect(contentLines('a\n\nb\n')).toEqual(['a', '', 'b'])
  })
})

describe('alignFileDiffs', () => {
  it('keeps shared context and marks only the changed line', () => {
    const rows = alignFileDiffs([{
      path: 'a.ts',
      oldText: 'keep\nold\nkeep',
      newText: 'keep\nnew\nkeep',
    }])

    expect(formatDiffRows(rows)).toEqual([
      'a.ts',
      '  keep',
      '- old',
      '+ new',
      '  keep',
    ])
    expect(countDiffStats(rows)).toEqual({ added: 1, removed: 1 })
  })

  it('emits only additions when there is no before-image', () => {
    const rows = alignFileDiffs([{ path: 'new.ts', oldText: null, newText: 'hello\nworld' }])
    expect(formatDiffRows(rows)).toEqual(['new.ts', '+ hello', '+ world'])
    expect(countDiffStats(rows)).toEqual({ added: 2, removed: 0 })
  })

  it('emits only deletions when the new side is empty', () => {
    const rows = alignFileDiffs([{ path: 'gone.ts', oldText: 'bye', newText: '' }])
    expect(formatDiffRows(rows)).toEqual(['gone.ts', '- bye'])
    expect(countDiffStats(rows)).toEqual({ added: 0, removed: 1 })
  })

  it('separates later hunks in the same file with a gap', () => {
    const rows = alignFileDiffs([
      { path: 'a.ts', oldText: 'one', newText: 'two' },
      { path: 'a.ts', oldText: 'three', newText: 'four' },
    ])
    expect(formatDiffRows(rows)).toEqual([
      'a.ts',
      '- one',
      '+ two',
      '⋯',
      '- three',
      '+ four',
    ])
  })

  it('dumps both sides when a hunk is too large to align', () => {
    const oldText = Array.from({ length: 201 }, (_, index) => `old-${index}`).join('\n')
    const newText = Array.from({ length: 201 }, (_, index) => `new-${index}`).join('\n')
    const rows = alignFileDiffs([{ path: 'big.ts', oldText, newText }])
    expect(rows.some(row => row.kind === 'ctx')).toBe(false)
    expect(countDiffStats(rows)).toEqual({ added: 201, removed: 201 })
  })

  it('marks changed tokens on a one-line replacement', () => {
    const rows = alignFileDiffs([{
      path: 'a.ts',
      oldText: 'const foo = 1',
      newText: 'const bar = 1',
    }])
    const deleted = rows.find(row => row.kind === 'del')
    const added = rows.find(row => row.kind === 'add')
    expect(deleted?.tokens).toEqual([
      { text: 'const' },
      { text: ' ' },
      { text: 'foo', changed: true },
      { text: ' ' },
      { text: '=' },
      { text: ' ' },
      { text: '1' },
    ])
    expect(added?.tokens).toEqual([
      { text: 'const' },
      { text: ' ' },
      { text: 'bar', changed: true },
      { text: ' ' },
      { text: '=' },
      { text: ' ' },
      { text: '1' },
    ])
  })
})

describe('formatDiffStats', () => {
  it('omits a zero/zero label and keeps a single-sided count', () => {
    expect(formatDiffStats(0, 0)).toBeUndefined()
    expect(formatDiffStats(3, 0)).toBe('+3')
    expect(formatDiffStats(0, 2)).toBe('-2')
    expect(formatDiffStats(3, 2)).toBe('+3/-2')
  })
})

describe('paintDiffRow', () => {
  const color = createTheme(true, false)
  const plain = createTheme(false)

  it('uses red and green 16-color SGR and inverse on the changed token', () => {
    const rows = alignFileDiffs([{ path: 'a.ts', oldText: 'const foo = 1', newText: 'const bar = 1' }])
    const deleted = rows.find(row => row.kind === 'del')
    const added = rows.find(row => row.kind === 'add')
    expect(deleted).toBeDefined()
    expect(added).toBeDefined()
    const removed = paintDiffRow(deleted!, color)
    const inserted = paintDiffRow(added!, color)
    expect(removed).toContain('\x1b[31m')
    expect(inserted).toContain('\x1b[32m')
    expect(removed).toContain('\x1b[7mfoo\x1b[27m')
    expect(inserted).toContain('\x1b[7mbar\x1b[27m')
    expect(stripAnsi(removed)).toBe('- const foo = 1')
    expect(stripAnsi(inserted)).toBe('+ const bar = 1')
  })

  it('is a no-op paint when colors are off', () => {
    const row = alignFileDiffs([{ path: 'a.ts', oldText: 'a', newText: 'b' }]).find(entry => entry.kind === 'del')
    expect(paintDiffRow(row!, plain)).toBe('- a')
    expect(paintDiffStats(1, 1, plain)).toBe('+1/-1')
  })

  it('closes inverse on every wrapped visual row', () => {
    const rows = alignFileDiffs([{
      path: 'wide.ts',
      oldText: 'alpha beta gamma delta epsilon',
      newText: 'alpha BETA gamma delta epsilon',
    }])
    const wrapped = wrapPaintedDiffRows(rows, color, 16)
    const highlighted = wrapped.filter(line => line.includes('\x1b[7m') || line.includes('BETA') || line.includes('beta'))
    expect(highlighted.length).toBeGreaterThan(0)
    expect(highlighted.every(line => line.endsWith('\x1b[27m'))).toBe(true)
    expect(rowText(rows[0]!)).toBe('wide.ts')
  })
})
