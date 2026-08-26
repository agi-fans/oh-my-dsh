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

  it('closes inverse and foreground on every wrapped visual row', () => {
    const rows = alignFileDiffs([{
      path: 'wide.ts',
      oldText: 'alpha beta gamma delta epsilon',
      newText: 'alpha BETA gamma delta epsilon',
    }])
    const wrapped = wrapPaintedDiffRows(rows, color, 16)
    const highlighted = wrapped.filter(line => line.includes('\x1b[7m') || line.includes('BETA') || line.includes('beta'))
    expect(highlighted.length).toBeGreaterThan(0)
    expect(highlighted.every(line => line.endsWith('\x1b[27m\x1b[39m'))).toBe(true)
    expect(rowText(rows[0]!)).toBe('wide.ts')
  })
})

describe('context syntax highlighting', () => {
  const color = createTheme(true, true)
  const plain = createTheme(false)
  const keyword = color.getFgAnsi('mdKeyword')
  const ctx = color.getFgAnsi('toolDiffContext')
  const added = color.getFgAnsi('toolDiffAdded')
  const removed = color.getFgAnsi('toolDiffRemoved')

  it('stamps context rows with the language resolved from the path', () => {
    const rows = alignFileDiffs([{
      path: 'src/main.ts',
      oldText: 'const one = 1\nkeep\nconst two = 2',
      newText: 'const one = 1\nkeep\nconst three = 3',
    }])
    const ctxRows = rows.filter(row => row.kind === 'ctx')
    expect(ctxRows.every(row => row.language === 'ts')).toBe(true)
    const delRow = rows.find(row => row.kind === 'del')
    const addRow = rows.find(row => row.kind === 'add')
    expect(delRow?.language).toBeUndefined()
    expect(addRow?.language).toBeUndefined()
  })

  it('highlights keywords across a multi-line context run', () => {
    const rows = alignFileDiffs([{
      path: 'a.ts',
      oldText: 'const a = 1\nconst b = 2\nconst c = 3\nconst d = 4',
      newText: 'const a = 1\nconst b = 2\nconst c = 3\nconst d = 5',
    }])
    const wrapped = wrapPaintedDiffRows(rows, color, 80)
    const ctxLines = wrapped.filter(line => stripAnsi(line).startsWith('  const '))
    expect(ctxLines.length).toBeGreaterThanOrEqual(3)
    for (const line of ctxLines) expect(line).toContain(keyword + 'const')
    const delLine = wrapped.find(line => stripAnsi(line).startsWith('- const d = 4'))
    const addLine = wrapped.find(line => stripAnsi(line).startsWith('+ const d = 5'))
    expect(delLine).toBeDefined()
    expect(addLine).toBeDefined()
  })

  it('keeps the context base ink dim while keywords stand out', () => {
    const rows = alignFileDiffs([{
      path: 'a.ts',
      oldText: 'const a = 1\nkeep',
      newText: 'const a = 1\nkeep',
    }])
    const wrapped = wrapPaintedDiffRows(rows, color, 80)
    const ctxLine = wrapped.find(line => stripAnsi(line).startsWith('  const'))
    expect(ctxLine).toBeDefined()
    expect(ctxLine).toContain(ctx)
    expect(ctxLine).toContain(keyword + 'const')
  })

  it('leaves unknown-file context dim and unhighlighted', () => {
    const rows = alignFileDiffs([{
      path: 'notes.md',
      oldText: 'const a = 1\nkeep',
      newText: 'const a = 1\nkeep',
    }])
    expect(rows.filter(row => row.kind === 'ctx').every(row => row.language === undefined)).toBe(true)
    const wrapped = wrapPaintedDiffRows(rows, color, 80)
    const ctxLine = wrapped.find(line => stripAnsi(line).startsWith('  const'))
    expect(ctxLine).toBeDefined()
    expect(ctxLine).toContain(ctx)
    expect(ctxLine).not.toContain(keyword + 'const')
  })

  it('does not highlight gap markers', () => {
    const rows = alignFileDiffs([
      { path: 'a.ts', oldText: 'one', newText: 'two' },
      { path: 'a.ts', oldText: 'const keep = 1', newText: 'const keep = 1' },
    ])
    const gap = rows.find(row => row.kind === 'gap')
    expect(gap).toBeDefined()
    expect(gap?.language).toBeUndefined()
    const wrapped = wrapPaintedDiffRows(rows, color, 80)
    const gapLine = wrapped.find(line => stripAnsi(line) === '⋯')
    expect(gapLine).toBeDefined()
    expect(gapLine).not.toContain(keyword)
  })

  it('keeps add/delete rows green/red with inverse intra-line highlighting', () => {
    const rows = alignFileDiffs([{
      path: 'a.ts',
      oldText: 'const foo = 1',
      newText: 'const bar = 1',
    }])
    const wrapped = wrapPaintedDiffRows(rows, color, 80)
    const delLine = wrapped.find(line => stripAnsi(line).startsWith('- '))
    const addLine = wrapped.find(line => stripAnsi(line).startsWith('+ '))
    expect(delLine).toContain(removed)
    expect(addLine).toContain(added)
    expect(delLine).toContain('\x1b[7mfoo\x1b[27m')
    expect(addLine).toContain('\x1b[7mbar\x1b[27m')
  })

  it('does not syntax-highlight the >200-line LCS fallback', () => {
    const oldText = Array.from({ length: 201 }, (_, i) => `const old-${i} = ${i}`).join('\n')
    const newText = Array.from({ length: 201 }, (_, i) => `const new-${i} = ${i}`).join('\n')
    const rows = alignFileDiffs([{ path: 'big.ts', oldText, newText }])
    expect(rows.some(row => row.kind === 'ctx')).toBe(false)
    const wrapped = wrapPaintedDiffRows(rows, color, 80)
    const sample = wrapped.find(line => stripAnsi(line).startsWith('- const old-0'))
    expect(sample).toBeDefined()
    expect(sample).toContain(removed)
    // fallback del rows carry no syntax keyword color
    expect(sample).not.toContain(keyword + 'const')
  })

  it('is plain and stable across repeated renders when colors are off', () => {
    const rows = alignFileDiffs([{
      path: 'a.ts',
      oldText: 'const a = 1\nkeep',
      newText: 'const a = 2\nkeep',
    }])
    const first = wrapPaintedDiffRows(rows, plain, 40)
    const second = wrapPaintedDiffRows(rows, plain, 40)
    expect(first).toEqual(['a.ts', '- const a = 1', '+ const a = 2', '  keep'])
    expect(second).toEqual(first)
    for (const line of first) expect(line).not.toContain('\x1b')
  })
})

describe('wrap continuation foreground', () => {
  const color = createTheme(true, false)
  const removed = color.getFgAnsi('toolDiffRemoved')
  const added = color.getFgAnsi('toolDiffAdded')
  const ctx = color.getFgAnsi('toolDiffContext')
  const keyword = color.getFgAnsi('mdKeyword')

  it('reopens the delete foreground on every wrapped continuation of a delete row', () => {
    const rows = alignFileDiffs([{
      path: 'wide.ts',
      oldText: 'const alphabetfoobig xyz = 1',
      newText: 'const alphabetfoobig xyz = 2',
    }])
    const wrapped = wrapPaintedDiffRows(rows, color, 12)
    // delete rows are the visual rows between the path and the add row
    const addIdx = wrapped.findIndex(line => stripAnsi(line).startsWith('+'))
    const delSegs = wrapped.slice(1, addIdx)
    expect(delSegs.length).toBeGreaterThan(1)
    for (const line of delSegs) {
      expect(line).toContain(removed)
      expect(line.endsWith('\x1b[27m\x1b[39m')).toBe(true)
    }
  })

  it('reopens the add foreground on every wrapped continuation of an add row', () => {
    const rows = alignFileDiffs([{
      path: 'wide.ts',
      oldText: 'const alphabetfoobig xyz = 1',
      newText: 'const alphabetfoobig xyz = 999',
    }])
    const wrapped = wrapPaintedDiffRows(rows, color, 12)
    const addIdx = wrapped.findIndex(line => stripAnsi(line).startsWith('+'))
    const addSegs = wrapped.slice(addIdx)
    expect(addSegs.length).toBeGreaterThan(1)
    for (const line of addSegs) {
      expect(line).toContain(added)
      expect(line.endsWith('\x1b[27m\x1b[39m')).toBe(true)
    }
  })

  it('reopens the context foreground and keyword color on wrapped context continuations', () => {
    const rows = alignFileDiffs([{
      path: 'a.ts',
      oldText: 'const alphabetfoobigkeep = 1\nconst keepervalue = 2',
      newText: 'const alphabetfoobigkeep = 1\nconst keepervalue = 2',
    }])
    const wrapped = wrapPaintedDiffRows(rows, color, 12)
    // all rows after the path are context (no add/del in this fixture)
    const ctxSegs = wrapped.slice(1)
    expect(ctxSegs.length).toBeGreaterThan(3)
    // the first visual row of each context line carries the keyword color for `const`
    const constStarts = ctxSegs.filter(line => stripAnsi(line).trimStart().startsWith('const'))
    expect(constStarts.length).toBeGreaterThanOrEqual(2)
    for (const line of constStarts) expect(line).toContain(keyword + 'const')
    // every context continuation carries the context base ink
    for (const line of ctxSegs) expect(line).toContain(ctx)
  })

  it('keeps inverse resumed on a continuation when the changed token spans the break', () => {
    const rows = alignFileDiffs([{
      path: 'wide.ts',
      oldText: 'const alphabetfoobigvalue = 1',
      newText: 'const alphabetfoobigvalue = 2',
    }])
    const wrapped = wrapPaintedDiffRows(rows, color, 14)
    // the changed token `1`/`2` is small; force a wider changed token by using a long replacement
    const rows2 = alignFileDiffs([{
      path: 'wide.ts',
      oldText: 'const alphabetfoobigvalue = 1',
      newText: 'const alphabetfoobigvalue = 999',
    }])
    const wrapped2 = wrapPaintedDiffRows(rows2, color, 14)
    // find a continuation row (not the first `- ` row) that still shows inverse
    const delIdx = wrapped.findIndex(line => stripAnsi(line).startsWith('-'))
    const addIdx = wrapped2.findIndex(line => stripAnsi(line).startsWith('+'))
    const delCont = wrapped.slice(delIdx + 1, wrapped.findIndex(line => stripAnsi(line).startsWith('+')))
    const addCont = wrapped2.slice(addIdx + 1)
    // at least one continuation across either side reopens inverse (7m)
    const reopened = [...delCont, ...addCont].filter(line => line.includes('\x1b[7m'))
    expect(reopened.length).toBeGreaterThan(0)
  })

  it('does not leak foreground into frame borders (every wrapped row ends in resets)', () => {
    const rows = alignFileDiffs([{
      path: 'a.ts',
      oldText: 'const alphabetfoobigkeep = 1',
      newText: 'const alphabetfoobigkeep = 2',
    }])
    const wrapped = wrapPaintedDiffRows(rows, color, 12)
    for (const line of wrapped) {
      if (line.includes('\x1b')) expect(line.endsWith('\x1b[27m\x1b[39m')).toBe(true)
    }
  })

  it('preserves plain text on wrapped no-color continuations', () => {
    const rows = alignFileDiffs([{
      path: 'a.ts',
      oldText: 'const alphabetfoobigkeep = 1',
      newText: 'const alphabetfoobigkeep = 2',
    }])
    const wrapped = wrapPaintedDiffRows(rows, createTheme(false), 12)
    for (const line of wrapped) expect(line).not.toContain('\x1b')
    // the wrapped plain text still contains the token in pieces, joined back
    const joined = wrapped.map(stripAnsi).join('')
    expect(joined).toContain('alphabet')
    expect(joined).toContain('foobig')
  })
})
