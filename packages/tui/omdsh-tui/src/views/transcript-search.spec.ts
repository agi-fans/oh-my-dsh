import { describe, expect, it } from 'vitest'
import type { KeyEvent } from '../input/keys.ts'
import {
  applyTranscriptSearchEvent,
  blockMatchesQuery,
  createTranscriptSearch,
  searchBlockIndexes,
  transcriptSearchHint,
  type TranscriptSearchState,
} from './transcript-search.ts'

const key = (id: string): KeyEvent => ({ type: 'key', id })
const text = (value: string): KeyEvent => ({ type: 'text', value })

const texts = ['first block', 'second needle block', 'third needle block']

function fold(state: TranscriptSearchState, event: KeyEvent): TranscriptSearchState {
  const command = applyTranscriptSearchEvent(state, event, texts)
  expect(command.kind).toBe('update')
  return command.kind === 'update' ? command.state : state
}

describe('transcript search', () => {
  it('matches case-insensitively and reports block indexes', () => {
    expect(searchBlockIndexes(texts, 'NEEDLE')).toEqual([1, 2])
    expect(searchBlockIndexes(texts, '   ')).toEqual([])
    expect(searchBlockIndexes(texts, 'absent')).toEqual([])
    expect(blockMatchesQuery('Second NEEDLE block', 'needle')).toBe(true)
    expect(blockMatchesQuery('nope', 'needle')).toBe(false)
  })

  it('edits the query and treats slash as a literal character', () => {
    let state = createTranscriptSearch()
    state = fold(state, text('n'))
    state = fold(state, text('e'))
    state = fold(state, text('/'))
    expect(state.query).toBe('ne/')

    const command = applyTranscriptSearchEvent(state, key('backspace'), texts)
    expect(command).toEqual({ kind: 'update', state: { query: 'ne', editing: true, focus: -1 } })
  })

  it('deletes by grapheme so an emoji is not split', () => {
    const state = { ...createTranscriptSearch(), query: 'a🎉' }
    const command = applyTranscriptSearchEvent(state, key('backspace'), texts)
    expect(command).toEqual({ kind: 'update', state: { query: 'a', editing: true, focus: -1 } })
  })

  it('navigates with ctrl+n/ctrl+p while editing and n/N afterwards', () => {
    const base = { ...createTranscriptSearch(), query: 'needle', editing: false, focus: -1 }
    const first = applyTranscriptSearchEvent(base, text('n'), texts)
    expect(first).toMatchObject({ kind: 'focus', block: 1, state: { focus: 0 } })
    const second = applyTranscriptSearchEvent(first.kind === 'focus' ? first.state : base, text('n'), texts)
    expect(second).toMatchObject({ kind: 'focus', block: 2, state: { focus: 1 } })
    const wrapped = applyTranscriptSearchEvent(second.kind === 'focus' ? second.state : base, text('n'), texts)
    expect(wrapped).toMatchObject({ kind: 'focus', block: 1, state: { focus: 0 } })
    const backward = applyTranscriptSearchEvent(second.kind === 'focus' ? second.state : base, text('N'), texts)
    expect(backward).toMatchObject({ kind: 'focus', block: 1 })

    const editing = { ...base, editing: true }
    expect(applyTranscriptSearchEvent(editing, key('ctrl+n'), texts)).toMatchObject({ kind: 'focus', block: 1 })
    expect(applyTranscriptSearchEvent(editing, key('ctrl+p'), texts)).toMatchObject({ kind: 'focus', block: 2 })
  })

  it('re-enters editing from result state and closes on escape', () => {
    const result = { ...createTranscriptSearch(), query: 'needle', editing: false, focus: 1 }
    expect(applyTranscriptSearchEvent(result, text('/'), texts))
      .toMatchObject({ kind: 'update', state: { editing: true } })
    expect(applyTranscriptSearchEvent(result, text('x'), texts))
      .toMatchObject({ kind: 'update', state: { query: 'x', editing: true, focus: -1 } })
    expect(applyTranscriptSearchEvent(result, key('escape'), texts)).toEqual({ kind: 'close' })
    expect(applyTranscriptSearchEvent(result, key('ctrl+c'), texts)).toEqual({ kind: 'close' })
    expect(applyTranscriptSearchEvent({ ...result, editing: true }, key('enter'), texts))
      .toMatchObject({ kind: 'update', state: { editing: false } })
  })

  it('reports the match position and a zero-match state', () => {
    expect(transcriptSearchHint({ query: 'zzz', editing: false, focus: -1 }, 0)).toContain('0/0')
    expect(transcriptSearchHint({ query: 'n', editing: true, focus: 1 }, 3)).toContain('(2/3)')
  })
})
