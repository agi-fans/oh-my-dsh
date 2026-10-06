import { describe, expect, it } from 'vitest'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import { documentDestination, documentLayout, documentLineRow, documentMatches, documentModel, documentPosition, documentStart } from './document-reader.ts'
import { renderPlanReviewPage } from './prompt-selector.ts'

describe('source document navigation', () => {
  it('numbers both diff sides without treating headers or no-newline markers as content', () => {
    const source = { diff: true, text: 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -3,2 +3,3 @@\n same\n-old\n+new\n+extra\n\\ No newline at end of file\n@@ -20 +21 @@\n-last\n+final\n' }
    const model = documentModel(source)
    expect(model.hunks).toEqual([3, 9])
    expect(model.numbers.slice(3, 9)).toEqual([{}, { old: 3, next: 3 }, { old: 4 }, { next: 4 }, { next: 5 }, {}])
    expect(documentLineRow(source, 4)).toBe(6)
    expect(documentLineRow(source, 21)).toBe(11)
    expect(documentLineRow(source, 10)).toBeUndefined()
    expect(documentDestination(model.hunks, 9, 1)).toBe(3)
    expect(documentDestination(model.hunks, 3, -1)).toBe(9)
  })

  it('searches literal Unicode text by source line, including matches across a visual wrap', () => {
    const source = { text: 'const 中文 = "🐳 e\u0301"\n[A.*] Literal\nlast literal\n' }
    expect(documentMatches(source, '[a.*]')).toEqual([1])
    expect(documentMatches(source, '中文')).toEqual([0])
    expect(documentMatches(source, '🐳 e\u0301')).toEqual([0])
    expect(documentMatches(source, 'literal')).toEqual([1, 2])
    expect(documentMatches(source, 'absent')).toEqual([])
    expect(documentMatches(source, '')).toEqual([])
    expect(documentMatches(source, 'literal')).toBe(documentMatches(source, 'LITERAL'))
    expect(documentDestination([1, 2], 2, 1)).toBe(1)
    expect(documentDestination([1, 2], 1, -1)).toBe(2)
    expect(documentDestination([], 1, 1)).toBeUndefined()
  })

  it.each([false, true])('preserves whitespace, multiline syntax, cell widths and source anchors (color=%s)', colors => {
    const source = { language: 'ts', text: '/* start\nconst hidden = 1\n*/\n\tconst 中文 = "🐳 e\u0301' + 'x'.repeat(80) + '";\nend\n' }
    const theme = createTheme(colors, true)
    for (const width of [12, 30, 80]) {
      const layout = documentLayout(source, theme, width)
      expect(layout.rows.every(row => visibleWidth(row) <= width)).toBe(true)
      expect(documentLayout(source, theme, width)).toBe(layout)
      const at = layout.starts[3]! + 1
      const anchor = documentPosition(layout, at, '中文')
      expect(anchor).toEqual({ row: 3, wrap: 1, query: '中文' })
      expect(documentStart(layout, anchor)).toBe(at)
      const wider = documentLayout(source, theme, 100)
      expect(wider.sourceRows[documentStart(wider, anchor)]).toBe(3)
      expect(layout.rows.slice(layout.starts[3], layout.starts[4]).map(stripAnsi).map(row => row.slice(3)).join('')).toMatch(/^ {8}const/u)
      if (colors) expect(layout.rows[1]).not.toContain(theme.getFgAnsi('mdKeyword'))
    }
  })

  it('handles more source lines than JavaScript spread calls allow', () => {
    const source = { text: 'x\n'.repeat(150_000) }
    expect(documentLayout(source, createTheme(false), 80).starts).toHaveLength(150_000)
    expect(documentLineRow(source, 150_000)).toBe(149_999)
  })

  it.each([false, true])('keeps the reader, search field and action selection within narrow frames (color=%s)', colors => {
    const source = { text: Array.from({ length: 60 }, (_, at) => `const 第${at}行 = "🐳 e\u0301";`).join('\n'), language: 'ts' }
    for (const width of [16, 24, 30, 40, 80]) for (const height of [8, 10, 16, 24]) {
      const state = { request: { title: 'Files', question: '中文.ts', presentation: 'document' as const, documentSource: source,
        options: ['Files', 'Previous', 'Next', 'Open', 'Editor', 'Load more'].map(label => ({ label })) }, selected: 4, checked: new Set<number>(),
        documentAnchor: { row: 40, wrap: 0, query: '第40行' }, documentQuery: '第40行' }
      for (const documentInput of [undefined, 'search', 'line'] as const) {
        const frame = renderPlanReviewPage({ ...state, documentInput }, createTheme(colors), width, height, '第40行', 3, 'omdsh')
        expect(frame.lines).toHaveLength(height)
        expect(frame.lines.every(row => visibleWidth(row) === width)).toBe(true)
        expect(stripAnsi(frame.lines.join('\n'))).toContain(width === 16 ? 'Editor' : '› [ Editor ]')
        expect(frame.document?.position?.row).toBe(40)
        expect(frame.cursorVisible).toBe(documentInput !== undefined)
        if (documentInput === undefined) expect(stripAnsi(frame.lines.join('\n'))).toMatch(/›\s*41/u)
      }
    }
  })
})
