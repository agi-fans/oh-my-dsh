import { describe, expect, it } from 'vitest'
import {
  applyHistorySearchEvent,
  createHistorySearch,
  highlightTokens,
  queryTokens,
  renderHistorySearch,
  searchHistory,
} from './history-search.ts'
import type { KeyEvent } from '../input/keys.ts'
import { createTheme } from '../chrome/theme.ts'

const theme = createTheme(false)
const key = (id: string): KeyEvent => ({ type: 'key', id })
const text = (value: string): KeyEvent => ({ type: 'text', value })
const history = ['first prompt', 'git commit -m wip', 'list files']

describe('queryTokens / searchHistory', () => {
  it('splits on non-alphanumeric runs', () => {
    expect(queryTokens('Git-commit  WIP')).toEqual(['git', 'commit', 'wip'])
    expect(queryTokens('   ')).toEqual([])
  })

  it('lists newest first and ANDs substring tokens', () => {
    expect(searchHistory(history, '')).toEqual(['list files', 'git commit -m wip', 'first prompt'])
    expect(searchHistory(history, 'commit')).toEqual(['git commit -m wip'])
    expect(searchHistory(history, 'mit')).toEqual(['git commit -m wip'])
    expect(searchHistory(history, 'git wip')).toEqual(['git commit -m wip'])
    expect(searchHistory(history, 'zzz')).toEqual([])
  })
})

describe('applyHistorySearchEvent', () => {
  it('filters as the query is typed and selects the highlighted row', () => {
    let state = createHistorySearch(history)
    expect(state.results[0]).toBe('list files')
    const typed = applyHistorySearchEvent(state, text('com'), history)
    expect(typed.kind).toBe('update')
    if (typed.kind !== 'update') return
    state = typed.state
    expect(state.query).toBe('com')
    expect(state.results).toEqual(['git commit -m wip'])
    expect(applyHistorySearchEvent(state, key('enter'), history)).toEqual({
      kind: 'select',
      text: 'git commit -m wip',
    })
  })

  it('navigates the list and cancels on escape', () => {
    let state = createHistorySearch(history)
    const down = applyHistorySearchEvent(state, key('down'), history)
    expect(down.kind).toBe('update')
    if (down.kind !== 'update') return
    state = down.state
    expect(state.selected).toBe(1)
    expect(applyHistorySearchEvent(state, key('enter'), history)).toEqual({
      kind: 'select',
      text: 'git commit -m wip',
    })
    expect(applyHistorySearchEvent(state, key('escape'), history)).toEqual({ kind: 'cancel' })
  })

  it('edits the query without wrapping list movement', () => {
    let state = createHistorySearch(history)
    const typed = applyHistorySearchEvent(state, text('list x'), history)
    if (typed.kind !== 'update') throw new Error('expected update')
    state = typed.state
    const back = applyHistorySearchEvent(state, key('backspace'), history)
    if (back.kind !== 'update') throw new Error('expected update')
    state = back.state
    expect(state.query).toBe('list ')
    expect(state.results).toEqual(['list files'])
    const up = applyHistorySearchEvent(state, key('up'), history)
    if (up.kind !== 'update') throw new Error('expected update')
    expect(up.state.selected).toBe(0)
    const empty = applyHistorySearchEvent(createHistorySearch(history), key('backspace'), history)
    if (empty.kind !== 'update') throw new Error('expected update')
    expect(empty.state.query).toBe('')
    expect(empty.state.results).toHaveLength(3)
  })
})

describe('renderHistorySearch / highlightTokens', () => {
  it('paints the overlay chrome and empty/match states', () => {
    const empty = renderHistorySearch(createHistorySearch([]), theme, 50)
    expect(empty.lines.join('\n')).toContain('Search History')
    expect(empty.lines.join('\n')).toContain('No history yet')
    expect(empty.cursor.row).toBeGreaterThan(0)

    const filled = renderHistorySearch(createHistorySearch(history), theme, 50)
    expect(filled.lines.join('\n')).toContain('list files')
    expect(filled.lines.join('\n')).toContain('❯')
    expect(filled.lines.join('\n')).toContain('enter select')

    const miss = createHistorySearch(history)
    const typed = applyHistorySearchEvent(miss, text('zzz'), history)
    if (typed.kind !== 'update') throw new Error('expected update')
    expect(renderHistorySearch(typed.state, theme, 50).lines.join('\n')).toContain('No matching history')
  })

  it('wraps token hits', () => {
    const painted = highlightTokens('git commit', ['com'], createTheme(true, false))
    expect(painted).toContain('com')
    expect(painted).not.toBe('git commit')
  })

})
