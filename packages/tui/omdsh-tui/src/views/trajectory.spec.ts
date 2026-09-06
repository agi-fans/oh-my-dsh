import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import {
  applyTrajectoryEvent,
  appendTrajectoryEvent,
  createTrajectory,
  renderTrajectory,
  trajectoryVisibleRecords,
  captureSearchTarget,
  trajectoryListMetrics,
  trajectoryDetailMetrics,
  trajectorySearch,
} from './trajectory.ts'

function event(seq: number, type: string, data: unknown, time = seq * 100): SessionEvent {
  return { seq, type, data, time } as unknown as SessionEvent
}

describe('trajectory ledger', () => {
  const events = [
    event(1, 'turn/start', { turn: 1 }),
    event(2, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'inspect the repo' }] }),
    event(3, 'step/start', { turn: 1, step: 1 }),
    event(4, 'assistant/message', {
      turn: 1,
      step: 1,
      message: { content: [{ type: 'reasoning', text: 'I will inspect.' }] },
      stream: [{ type: 'text-chunks', time0: 400, index: 0, dt: [], texts: ['I will inspect.'] }],
    }),
    event(5, 'tool/call', { callId: 'call-1', name: 'read', arguments: { path: 'README.md' } }),
    event(6, 'tool/result', { message: { callId: 'call-1', content: [{ type: 'text', text: 'README contents' }] } }),
    event(7, 'assistant/message', {
      turn: 1,
      step: 1,
      message: { content: [{ type: 'text', text: 'Finished.' }] },
      stream: [],
      usage: { inputTokens: 10, outputTokens: 2 },
    }),
  ]

  it('projects turn, assistant timing, tool result, and token details', () => {
    const state = createTrajectory(events)
    expect(state.ledger.records.map(record => record.kind)).toEqual(['user', 'assistant', 'tool'])
    expect(state.ledger.records[1]).toMatchObject({ turn: 1, step: 1, summary: 'Finished.', inputTokens: 10, outputTokens: 2, ttftMs: 100 })
    expect(state.ledger.records[2]).toMatchObject({ label: 'TOOL', status: 'ok', result: 'README contents', durationMs: 100 })
  })

  it('records every non-success turn ending with its durable reason', () => {
    const state = createTrajectory([
      event(1, 'turn/end', { turn: 1, reason: { kind: 'max-tokens' } }),
      event(2, 'turn/end', { turn: 2, reason: { kind: 'blocked' } }),
      event(3, 'turn/end', { turn: 3, reason: { kind: 'interrupted' } }),
      event(4, 'turn/end', {
        turn: 4,
        reason: { kind: 'aborted', reason: { kind: 'user' } },
      }),
    ])

    expect(state.ledger.records).toMatchObject([
      { type: 'turn/end', kind: 'warning', status: 'warning', summary: 'Output token limit reached' },
      { type: 'turn/end', kind: 'warning', status: 'warning', summary: 'Turn blocked' },
      { type: 'turn/end', kind: 'warning', status: 'warning', summary: 'Session interrupted' },
      { type: 'turn/end', kind: 'error', status: 'error', summary: 'Turn aborted' },
    ])
  })

  it('searches, opens details, and follows appended records', () => {
    let state = createTrajectory(events)
    state = (applyTrajectoryEvent(state, { type: 'text', value: '/' }) as { state: typeof state }).state
    state = (applyTrajectoryEvent(state, { type: 'text', value: 'readme' }) as { state: typeof state }).state
    expect(trajectoryVisibleRecords(state)).toHaveLength(1)
    state = (applyTrajectoryEvent(state, { type: 'key', id: 'escape' }) as { state: typeof state }).state
    state = { ...state, query: '' }
    state = (applyTrajectoryEvent(state, { type: 'key', id: 'enter' }) as { state: typeof state }).state
    expect(state.details).toBe(true)
    state = (applyTrajectoryEvent(state, { type: 'key', id: 'end' }) as { state: typeof state }).state
    state = appendTrajectoryEvent(state, event(8, 'llm/retry', { turn: 1, step: 2, attempt: 2 }))
    expect(state.selectedId).toBe(state.ledger.records.at(-1)?.id)
  })

  it('scrolls long detail content and resets the offset on section changes', () => {
    let state = createTrajectory(events)
    const selected = state.ledger.records.find(record => record.id === state.selectedId)
    if (selected === undefined) throw new Error('expected a selected trajectory record')
    selected.payload = Array.from({ length: 30 }, (_, index) => `payload-line-${index}`).join('\n')
    state = { ...state, details: true, detailTab: 'payload' }

    const firstPage = renderTrajectory(state, createTheme(false), 120, 14).lines.join('\n')
    expect(firstPage).toContain('payload-line-0')
    expect(firstPage).not.toContain('payload-line-15')

    state = (applyTrajectoryEvent(state, { type: 'key', id: 'pageDown' }) as { state: typeof state }).state
    const secondPage = renderTrajectory(state, createTheme(false), 120, 14).lines.join('\n')
    expect(secondPage).not.toContain('payload-line-0')
    expect(secondPage).toContain('payload-line-10')
    expect(secondPage).toContain('11-18 / 30 lines')

    state = (applyTrajectoryEvent(state, { type: 'key', id: 'tab' }) as { state: typeof state }).state
    expect(state.detailScroll).toBe(0)
  })

  it('renders an exact-height, display-cell-safe full-screen frame', () => {
    const frame = renderTrajectory(createTrajectory(events), createTheme(false), 72, 16)
    expect(frame.lines).toHaveLength(16)
    expect(frame.lines.every(line => visibleWidth(line) <= 72)).toBe(true)
    expect(frame.lines.join('\n')).toContain('Trajectory')
    expect(frame.lines.join('\n')).toContain('Finished.')
  })

  it('keeps the split-pane divider aligned beside wide emoji', () => {
    const withEmoji = [...events, event(8, 'turn/start', { turn: 2 }), event(9, 'user/message', {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'Passed ✅' }],
    })]
    const state = { ...createTrajectory(withEmoji), details: true }
    const frame = renderTrajectory(state, createTheme(false), 120, 18)
    const dividerColumns = frame.lines
      .map(line => stripAnsi(line))
      .filter(line => line.includes('│'))
      .map(line => visibleWidth(line.slice(0, line.indexOf('│'))))

    expect(new Set(dividerColumns)).toEqual(new Set([69]))
  })
})

describe('trajectory search navigation', () => {
  const searchEvents: SessionEvent[] = [
    event(1, 'turn/start', { turn: 1 }),
    event(2, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'read the readme' }] }),
    event(3, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'draft' }] }, stream: [] }),
    event(4, 'tool/call', { turn: 1, step: 2, callId: 'c1', name: 'bash', arguments: '{"command":"cat readme.md"}' }),
  ]

  function searching(state: ReturnType<typeof createTrajectory>, query: string): ReturnType<typeof createTrajectory> {
    let next = (applyTrajectoryEvent(state, { type: 'text', value: '/' }) as { state: typeof state }).state
    for (const char of query) next = (applyTrajectoryEvent(next, { type: 'text', value: char }) as { state: typeof state }).state
    return next
  }

  it('matching scans the full ledger while collapse only affects display', () => {
    let state = searching(createTrajectory(searchEvents), 'readme')
    // User (summary+payload) and tool (summary+payload) records both match.
    expect(trajectorySearch(state).matches).toHaveLength(4)
    expect(trajectorySearch(state).counts.size).toBe(2)
    // Collapse turn 1: both hidden records still count as matches.
    state = { ...state, collapsedTurns: new Set([1]) }
    expect(trajectoryVisibleRecords(state)).toHaveLength(1)
    expect(trajectorySearch(state).counts.size).toBe(2)
  })

  it('locates a hidden match and expands its turn on enter', () => {
    let state = searching(createTrajectory(searchEvents), 'readme')
    state = { ...state, collapsedTurns: new Set([1]) }
    state = (applyTrajectoryEvent(state, { type: 'key', id: 'ctrl+n' }) as { state: typeof state }).state
    expect(state.searchFocus).toBe(0)
    state = (applyTrajectoryEvent(state, { type: 'key', id: 'enter' }) as { state: typeof state }).state
    expect(state.searching).toBe(false)
    expect(state.collapsedTurns.has(1)).toBe(false)
    // The first sweep lands on the user record (records[0]).
    expect(state.selectedId).toBe(state.ledger.records[0]!.id)
  })

  it('navigates matches with n/N in the result state and ctrl+n/p while editing', () => {
    let state = searching(createTrajectory(searchEvents), 'readme')
    expect(state.searching).toBe(true)
    state = (applyTrajectoryEvent(state, { type: 'key', id: 'enter' }) as { state: typeof state }).state
    state = (applyTrajectoryEvent(state, { type: 'text', value: 'n' }) as { state: typeof state }).state
    expect(state.searchFocus).toBe(1)
    state = (applyTrajectoryEvent(state, { type: 'text', value: 'N' }) as { state: typeof state }).state
    expect(state.searchFocus).toBe(0)
    // Result state: '/' re-enters editing WITHOUT inserting; n is literal there.
    state = (applyTrajectoryEvent(state, { type: 'text', value: '/' }) as { state: typeof state }).state
    expect(state.searching).toBe(true)
    expect(state.query).toBe('readme')
    state = (applyTrajectoryEvent(state, { type: 'text', value: 'n' }) as { state: typeof state }).state
    expect(state.query).toBe('readmen')
    expect(trajectorySearch(state).matches).toHaveLength(0)
    // No matches: navigation is a no-op and focus stays null.
    state = (applyTrajectoryEvent(state, { type: 'key', id: 'ctrl+n' }) as { state: typeof state }).state
    expect(state.searchFocus).toBeNull()
  })

  it('deletes the query by grapheme boundary', () => {
    let state = createTrajectory(searchEvents)
    state = (applyTrajectoryEvent(state, { type: 'text', value: '/' }) as { state: typeof state }).state
    state = (applyTrajectoryEvent(state, { type: 'text', value: 'a🐳' }) as { state: typeof state }).state
    state = (applyTrajectoryEvent(state, { type: 'key', id: 'backspace' }) as { state: typeof state }).state
    expect(state.query).toBe('a')
  })

  it('keeps the located match when an earlier record gains a match', () => {
    let state = searching(createTrajectory(searchEvents), 'readme')
    state = (applyTrajectoryEvent(state, { type: 'key', id: 'ctrl+n' }) as { state: typeof state }).state
    const target = captureSearchTarget(state)
    expect(target).not.toBeNull()
    // A tool/result update adds a match to the tool record (before the focused
    // user record in the derived list when re-scanned from the top): the
    // focused record identity must survive.
    const next = appendTrajectoryEvent(state, event(5, 'tool/result', {
      turn: 1, step: 2, callId: 'c1', message: { content: [{ type: 'text', text: 'readme content' }] },
    }))
    expect(next.searchFocus).not.toBeNull()
    expect(next.selectedId).toBe(target?.record.id)
    expect(trajectorySearch(next).matches.length).toBeGreaterThan(2)
  })

  it('clamps within the field when a focused occurrence shrinks', () => {
    const withResults: SessionEvent[] = [
      ...searchEvents,
      event(5, 'tool/result', {
        turn: 1, step: 2, callId: 'c1', message: { content: [{ type: 'text', text: 'x x x' }] },
      }),
    ]
    let state = createTrajectory(withResults)
    state = (applyTrajectoryEvent(state, { type: 'text', value: '/' }) as { state: typeof state }).state
    state = (applyTrajectoryEvent(state, { type: 'text', value: 'x' }) as { state: typeof state }).state
    // Focus the tool record's result field (payload spans precede it) and its
    // last occurrence. Field order per record: ... payload(3) result(3).
    const matches = trajectorySearch(state).matches
    const resultIndex = matches.findLastIndex(match => match.record.kind === 'tool' && match.field === 'result')
    expect(resultIndex).toBeGreaterThanOrEqual(0)
    for (let index = 0; index <= resultIndex; index += 1) {
      state = (applyTrajectoryEvent(state, { type: 'key', id: 'ctrl+n' }) as { state: typeof state }).state
    }
    const target = captureSearchTarget(state)
    expect(target?.field).toBe('result')
    // Shrink the result text to one 'x': occurrence clamps within the field.
    const next = appendTrajectoryEvent(state, event(6, 'tool/result', {
      turn: 1, step: 2, callId: 'c1', message: { content: [{ type: 'text', text: 'x' }] },
    }))
    expect(next.selectedId).toBe(target?.record.id)
    expect(captureSearchTarget(next)?.field).toBe('result')
  })

  it('reports the follow notice and clears it on end or moving to the bottom', () => {
    let state = createTrajectory(searchEvents)
    state = (applyTrajectoryEvent(state, { type: 'text', value: '/' }) as { state: typeof state }).state
    state = (applyTrajectoryEvent(state, { type: 'text', value: 'readme' }) as { state: typeof state }).state
    state = { ...state, query: 'readme', searching: false, followNotice: 0, following: false }
    state = appendTrajectoryEvent(state, event(6, 'llm/retry', { turn: 1, step: 3, attempt: 1 }))
    state = appendTrajectoryEvent(state, event(7, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    // The retry record is not visible under the 'readme' query: no notice.
    expect(state.followNotice).toBe(0)
    // While already following the counter stays at zero even for matches.
    state = { ...state, followNotice: 0, following: true }
    state = appendTrajectoryEvent(state, event(8, 'user/message', {
      source: { kind: 'user' }, content: [{ type: 'text', text: 'readme follow-up' }],
    }))
    expect(state.followNotice).toBe(0)
    // A visible matching append while detached is counted.
    state = { ...state, followNotice: 0, following: false }
    state = appendTrajectoryEvent(state, event(9, 'user/message', {
      source: { kind: 'user' }, content: [{ type: 'text', text: 'readme detached' }],
    }))
    expect(state.followNotice).toBe(1)
    state = (applyTrajectoryEvent(state, { type: 'key', id: 'end' }) as { state: typeof state }).state
    expect(state.followNotice).toBe(0)
    expect(state.following).toBe(true)
  })

  it('the snippet follows the focused occurrence within one field', () => {
    const spaced: SessionEvent[] = [
      ...searchEvents,
      event(5, 'tool/result', {
        turn: 1, step: 2, callId: 'c1',
        message: { content: [{ type: 'text', text: 'HIT first padding padding padding HIT second' }] },
      }),
    ]
    let state = createTrajectory(spaced)
    state = (applyTrajectoryEvent(state, { type: 'text', value: '/' }) as { state: typeof state }).state
    for (const char of 'HIT') {
      state = (applyTrajectoryEvent(state, { type: 'text', value: char }) as { state: typeof state }).state
    }
    // Focus the second HIT occurrence (tool result field) and render the row.
    const matches = trajectorySearch(state).matches
    const hits = matches.map((match, index) => ({ match, index })).filter(pair => pair.match.record.kind === 'tool' && pair.match.field === 'result')
    expect(hits).toHaveLength(2)
    for (let index = 0; index <= hits[1]!.index; index += 1) {
      state = (applyTrajectoryEvent(state, { type: 'key', id: 'ctrl+n' }) as { state: typeof state }).state
    }
    const rendered = renderTrajectory(state, createTheme(false), 120, 14).lines.join('\n')
    expect(rendered).toContain('HIT second')
    expect(rendered).not.toContain('HIT first')
  })

  it('the layout metrics clamp to the actual body capacity', () => {
    const state = createTrajectory(searchEvents)
    expect(trajectoryListMetrics(state, 24).pageSize).toBeGreaterThan(0)
    expect(trajectoryListMetrics(state, 3).pageSize).toBe(0)
    expect(trajectoryDetailMetrics(state, 7).pageLines).toBe(1)
    expect(trajectoryDetailMetrics(state, 24).pageLines).toBe(18)
  })
})
