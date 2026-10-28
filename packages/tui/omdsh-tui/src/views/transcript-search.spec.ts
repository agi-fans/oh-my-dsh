import { describe, expect, it } from 'vitest'
import type { KeyEvent } from '../input/keys.ts'
import { stripAnsi } from '../chrome/width.ts'
import {
  applyTranscriptSearchEvent,
  blockMatchesQuery,
  createTranscriptSearch,
  matchedRows,
  searchMatches,
  transcriptSearchHint,
  type SearchableBlock,
  type TranscriptSearchState,
} from './transcript-search.ts'

const key = (id: string): KeyEvent => ({ type: 'key', id })
const text = (value: string): KeyEvent => ({ type: 'text', value })

const texts: readonly SearchableBlock[] = [
  { block: 0, lines: ['first block'] },
  { block: 1, lines: ['second needle block'] },
  { block: 2, lines: ['third needle block'] },
]
const matches = searchMatches(texts, 'needle')

function fold(state: TranscriptSearchState, event: KeyEvent): TranscriptSearchState {
  const command = applyTranscriptSearchEvent(state, event, matches)
  expect(command.kind).toBe('update')
  return command.kind === 'update' ? command.state : state
}

describe('transcript search', () => {
  it('matches case-insensitively and reports each occurrence', () => {
    expect(searchMatches(texts, 'NEEDLE').map(match => match.block)).toEqual([1, 2])
    expect(searchMatches(texts, '   ')).toEqual([])
    expect(searchMatches(texts, 'absent')).toEqual([])
    expect(blockMatchesQuery('Second NEEDLE block', 'needle')).toBe(true)
    expect(blockMatchesQuery('nope', 'needle')).toBe(false)
  })

  it('reports every occurrence on one row, not one per row', () => {
    // The whole point of the upgrade: a word said twice in one reply is two
    // stops for `n`, not one.
    const repeated = searchMatches([{ block: 0, lines: ['needle and needle again'] }], 'needle')
    expect(repeated).toHaveLength(2)
    expect(repeated.map(match => match.start)).toEqual([0, 11])
  })

  it('measures columns in display cells so CJK lands correctly', () => {
    // 中文 is four cells; a string index would put the hit at 2 cells.
    const cjk = searchMatches([{ block: 0, lines: ['中文 needle'] }], 'needle')
    expect(cjk).toEqual([{ block: 0, row: 0, start: 5, width: 6 }])
  })

  it('groups the spans of one block by row for painting', () => {
    const rows = matchedRows([
      { block: 1, row: 0, start: 2, width: 3 },
      { block: 1, row: 2, start: 0, width: 3 },
      { block: 2, row: 0, start: 9, width: 3 },
    ], 1)
    expect([...rows.keys()]).toEqual([0, 2])
    expect(rows.get(0)).toEqual([{ start: 2, width: 3 }])
  })

  it('edits the query and treats slash as a literal character', () => {
    let state = createTranscriptSearch()
    state = fold(state, text('n'))
    state = fold(state, text('e'))
    state = fold(state, text('/'))
    expect(state.query).toBe('ne/')

    const command = applyTranscriptSearchEvent(state, key('backspace'), matches)
    expect(command).toEqual({ kind: 'update', state: { query: 'ne', editing: true, focus: -1 } })
  })

  it('deletes by grapheme so an emoji is not split', () => {
    const state = { ...createTranscriptSearch(), query: 'a🎉' }
    const command = applyTranscriptSearchEvent(state, key('backspace'), matches)
    expect(command).toEqual({ kind: 'update', state: { query: 'a', editing: true, focus: -1 } })
  })

  it('navigates with ctrl+n/ctrl+p while editing and n/N afterwards', () => {
    const base = { ...createTranscriptSearch(), query: 'needle', editing: false, focus: -1 }
    const first = applyTranscriptSearchEvent(base, text('n'), matches)
    expect(first).toMatchObject({ kind: 'focus', match: { block: 1 }, state: { focus: 0 } })
    const second = applyTranscriptSearchEvent(first.kind === 'focus' ? first.state : base, text('n'), matches)
    expect(second).toMatchObject({ kind: 'focus', match: { block: 2 }, state: { focus: 1 } })
    const wrapped = applyTranscriptSearchEvent(second.kind === 'focus' ? second.state : base, text('n'), matches)
    expect(wrapped).toMatchObject({ kind: 'focus', match: { block: 1 }, state: { focus: 0 } })
    const backward = applyTranscriptSearchEvent(second.kind === 'focus' ? second.state : base, text('N'), matches)
    expect(backward).toMatchObject({ kind: 'focus', match: { block: 1 } })

    const editing = { ...base, editing: true }
    expect(applyTranscriptSearchEvent(editing, key('ctrl+n'), matches)).toMatchObject({ kind: 'focus', match: { block: 1 } })
    expect(applyTranscriptSearchEvent(editing, key('ctrl+p'), matches)).toMatchObject({ kind: 'focus', match: { block: 2 } })
  })

  it('re-enters editing from result state and closes on escape', () => {
    const result = { ...createTranscriptSearch(), query: 'needle', editing: false, focus: 1 }
    expect(applyTranscriptSearchEvent(result, text('/'), matches))
      .toMatchObject({ kind: 'update', state: { editing: true } })
    expect(applyTranscriptSearchEvent(result, text('x'), matches))
      .toMatchObject({ kind: 'update', state: { query: 'x', editing: true, focus: -1 } })
    expect(applyTranscriptSearchEvent(result, key('escape'), matches)).toEqual({ kind: 'close' })
    expect(applyTranscriptSearchEvent(result, key('ctrl+c'), matches)).toEqual({ kind: 'close' })
    expect(applyTranscriptSearchEvent({ ...result, editing: true }, key('enter'), matches))
      .toMatchObject({ kind: 'update', state: { editing: false } })
  })

  it('reports the match position and a zero-match state', () => {
    expect(transcriptSearchHint({ query: 'zzz', editing: false, focus: -1 }, 0)).toContain('0/0')
    expect(transcriptSearchHint({ query: 'n', editing: true, focus: 1 }, 3)).toContain('(2/3)')
  })
})

describe('inline highlight', () => {
  /**
   * The reported hit and the painted span come from the same scan, so this is the
   * contract that keeps them together: a row shows inverted cells exactly where
   * the query is, and nowhere else.
   */
  const paint = async (text: string, query: string): Promise<string> => {
    const { initialTranscript } = await import('./event-views.ts')
    const { renderView } = await import('./transcript-render.ts')
    const state = initialTranscript()
    state.blocks = [{ kind: 'assistant', turn: 1, step: 1, text, reasoning: '', streaming: false } as never]
    const frame = renderView(state, {
      width: 60, height: 20, colors: true, input: '', inputCursor: 0, model: 'm', pwd: '/tmp',
      transcriptSearch: { query, focus: 0, editing: false },
    } as never)
    return frame.lines.find(line => stripAnsi(line).includes(query)) ?? ''
  }

  it('inverts the occurrence rather than the whole row', async () => {
    const row = await paint('alpha beta needle gamma', 'needle')
    const inverted = /\u001b\[7m([^\u001b]*)\u001b\[27m/u.exec(row)
    expect(inverted?.[1]).toBe('needle')
  })

  it('inverts nothing when the query is absent', async () => {
    const row = await paint('alpha beta gamma', 'absent')
    expect(row).toBe('')
  })
})
