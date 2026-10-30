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
  trajectoryOverviewHeight,
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

  it('records declared deliverables as their own tool record', () => {
    const state = createTrajectory([
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'tool/call', { callId: 'call-9', name: 'present', arguments: { files: [{ path: 'dist/omdsh.js' }] } }),
      event(3, 'deliverables/presented', {
        turn: 1,
        callId: 'call-9',
        files: [{ path: 'dist/omdsh.js', description: 'Bundled CLI' }, { path: 'report.md' }],
      }),
    ])
    expect(state.ledger.records.map(record => record.label)).toEqual(['TOOL', 'DELIVERABLE'])
    expect(state.ledger.records[1]).toMatchObject({
      type: 'deliverables/presented',
      kind: 'tool',
      turn: 1,
      summary: 'dist/omdsh.js · report.md',
      result: 'dist/omdsh.js\nreport.md',
    })
  })

  it('records a catalogued subagent as its own row', () => {
    const state = createTrajectory([
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'subagent/catalog', {
        version: 0,
        childId: 'session-child',
        childCreatedAt: 10,
        mode: 'continuable',
        label: 'Explore auth',
      }),
    ])
    expect(state.ledger.records[0]).toMatchObject({
      type: 'subagent/catalog',
      label: 'SUBAGENT',
      turn: 1,
      summary: 'Explore auth',
      result: 'session-child\nExplore auth\ncontinuable',
    })
  })

  it('correlates an interleaved compaction lifecycle by its durable id', () => {
    const state = createTrajectory([
      event(1, 'compaction/start', { compactionId: 'compact-a', turn: 1 }),
      event(2, 'compaction/start', { compactionId: 'compact-b', turn: 1 }),
      event(3, 'compaction/summary', {
        compactionId: 'compact-b',
        summary: [{ type: 'text', text: 'second summary' }],
        shadowedRange: { start: 1, end: 2 },
        shadowedSeqs: [1, 2],
        shadowedTokenCount: 10,
      }),
      event(4, 'compaction/end', { compactionId: 'compact-a', turn: 1, error: 'summarizer failed' }),
      event(5, 'compaction/end', { compactionId: 'compact-b', turn: 1 }),
    ])
    const records = state.ledger.records.filter(record => record.kind === 'compaction')
    expect(records).toHaveLength(2)
    const [first, second] = records
    expect(first).toMatchObject({ id: 'compaction:compact-a', status: 'error' })
    expect(first?.result ?? '').toBe('')
    expect(second).toMatchObject({ id: 'compaction:compact-b', status: 'ok', result: 'second summary' })
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
    expect(secondPage).toContain('11-17 / 30')

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

describe('trajectory search caching', () => {
  const cacheEvents: SessionEvent[] = [
    event(1, 'turn/start', { turn: 1 }),
    event(2, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'cache me' }] }),
    event(3, 'step/start', { turn: 1, step: 1 }),
    event(4, 'assistant/message', {
      turn: 1,
      step: 1,
      message: { content: [{ type: 'text', text: 'cache result' }] },
      stream: [],
    }),
  ]

  it('reuses one derived result until the query moves', () => {
    const base = createTrajectory(cacheEvents)
    const queried = { ...base, query: 'cache' }

    const first = trajectorySearch(queried)
    expect(first.matches.length).toBeGreaterThan(0)
    // Same ledger and query: the derivation is reused instead of rescanned.
    expect(trajectorySearch(queried)).toBe(first)
    expect(trajectorySearch({ ...base, query: 'result' })).not.toBe(first)
    // The empty query keeps one shared empty result rather than allocating.
    expect(trajectorySearch({ ...base, query: '' })).toBe(trajectorySearch({ ...base, query: '  ' }))
  })

  it('invalidates the derivation when the ledger appends', () => {
    const base = createTrajectory(cacheEvents)
    const queried = { ...base, query: 'cache' }
    const first = trajectorySearch(queried)

    // appendTrajectoryEvent mutates the ledger in place, so only the ledger's
    // own version can tell the cache that its result went stale.
    const appended = appendTrajectoryEvent(
      queried,
      event(99, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'cache again' }] }),
    )
    const second = trajectorySearch(appended)
    expect(second).not.toBe(first)
    expect(second.matches.length).toBeGreaterThan(first.matches.length)
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
    // Four frame rows and three pane rows of chrome, so the pane scrolls 17 of 24.
    expect(trajectoryDetailMetrics(state, 24).pageLines).toBe(17)
  })
})

describe('trajectory detail reading', () => {
  const toolEvents = [
    event(1, 'turn/start', { turn: 1 }, 0),
    event(2, 'step/start', { turn: 1, step: 1 }, 10),
    event(3, 'tool/call', { turn: 1, step: 1, callId: 'a', name: 'bash', arguments: JSON.stringify({ command: 'ls' }) }, 20),
    event(4, 'tool/result', { turn: 1, step: 1, callId: 'a', message: { callId: 'a', content: [{ type: 'text', text: 'x' }] } }, 30),
  ] as unknown as readonly SessionEvent[]

  const openDetail = () => ({ ...createTrajectory(toolEvents), details: true })

  it('numbers source lines only once the content wraps', () => {
    // Short enough to fit: the block reads as the JSON it is, with no gutter.
    const short = renderTrajectory({ ...openDetail(), detailTab: 'payload' }, createTheme(false), 100, 20)
    expect(short.lines.map(stripAnsi).some(row => /^\s*\d+ [{[]/u.test(row))).toBe(false)

    // Too long for the pane: numbers appear, and they now count source lines —
    // the gutter used to number every wrapped row, so one JSON line spread over
    // four rows read as four lines and nothing lined up.
    const state = openDetail()
    const selected = state.ledger.records.find(record => record.id === state.selectedId)
    if (selected === undefined) throw new Error('expected a selected record')
    selected.payload = `{"command": "${'x'.repeat(120)}"}`
    const wrapped = renderTrajectory({ ...state, detailTab: 'payload' }, createTheme(false), 60, 20).lines.map(stripAnsi)
    const numbered = wrapped.filter(row => /^\s*\d+ /u.test(row))
    expect(numbered).toHaveLength(1)
    expect(numbered[0]?.trimStart()).toMatch(/^1 /u)
    // The continuation leaves the number column blank rather than inventing a line.
    const continuation = wrapped.find(row => row.includes('x') && /^\s{3,}x/u.test(row))
    expect(continuation).toBeDefined()
  })

  it('scrolls the detail with the arrows instead of moving the selection', () => {
    // The arrows used to move the record selection while the pane was open, so
    // the text jumped out from under the reader.
    const before = openDetail()
    const selected = before.selectedId
    const moved = applyTrajectoryEvent(before, { type: 'key', id: 'down' } as never).state
    expect(moved.detailScroll).toBe(1)
    expect(moved.selectedId).toBe(selected)
    const back = applyTrajectoryEvent(moved, { type: 'key', id: 'up' } as never).state
    expect(back.detailScroll).toBe(0)
  })

  it('never scrolls past the top', () => {
    const state = applyTrajectoryEvent(openDetail(), { type: 'key', id: 'up' } as never).state
    expect(state.detailScroll).toBe(0)
  })

  it('scrolls the detail with the wheel', () => {
    // Wheel events reached the view before this and were dropped, so a mouse
    // reader had no way to scroll at all.
    const wheeled = applyTrajectoryEvent(openDetail(), { type: 'wheel', direction: 'down' } as never).state
    expect(wheeled.detailScroll).toBeGreaterThan(0)
    const back = applyTrajectoryEvent(wheeled, { type: 'wheel', direction: 'up' } as never).state
    expect(back.detailScroll).toBeLessThan(wheeled.detailScroll)
  })

  it('keeps the arrows on record navigation when no detail is open', () => {
    // Two records, so there is somewhere to move to.
    const ledger = { ...createTrajectory([
      ...toolEvents,
      event(5, 'tool/call', { turn: 1, step: 1, callId: 'b', name: 'bash', arguments: '{}' }, 40),
    ] as unknown as readonly SessionEvent[]), details: false }
    // The ledger follows the newest record, so `up` is the direction with room.
    const moved = applyTrajectoryEvent(ledger, { type: 'key', id: 'up' } as never).state
    expect(moved.detailScroll).toBe(0)
    expect(moved.selectedId).not.toBe(ledger.selectedId)
  })

  it('still switches tabs and closes the pane while it is open', () => {
    const open = { ...openDetail(), detailTab: 'summary' as const }
    const tabbed = applyTrajectoryEvent(open, { type: 'key', id: 'tab' } as never).state
    expect(tabbed.detailTab).not.toBe('summary')
    const closed = applyTrajectoryEvent(open, { type: 'key', id: 'escape' } as never).state
    expect(closed.details).toBe(false)
  })
})

describe('trajectory ledger shape', () => {
  /** One turn, two steps: a request with two calls, then a request with none. */
  const shaped = [
    event(1, 'turn/start', { turn: 1 }, 0),
    event(2, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'inspect the repo' }] }, 10),
    event(3, 'step/start', { turn: 1, step: 1 }, 100),
    event(4, 'assistant/message', {
      turn: 1, step: 1,
      message: { content: [{ type: 'text', text: 'Looking at the README.' }] },
      stream: [],
      usage: { inputTokens: 12_400, outputTokens: 812 },
    }, 4_400),
    event(5, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: { path: 'README.md' } }, 4_500),
    event(6, 'tool/result', { turn: 1, step: 1, callId: 'c1', message: { content: [{ type: 'text', text: 'README contents' }] } }, 4_900),
    event(7, 'tool/call', { turn: 1, step: 1, callId: 'c2', name: 'grep', arguments: { pattern: 'ALTER TABLE' } }, 5_000),
    event(8, 'tool/result', { turn: 1, step: 1, callId: 'c2', message: { content: [{ type: 'text', text: 'no match' }] } }, 6_100),
    event(9, 'step/start', { turn: 1, step: 2 }, 6_200),
    event(10, 'assistant/message', {
      turn: 1, step: 2,
      message: { content: [{ type: 'text', text: 'Nothing to change.' }] },
      stream: [],
      usage: { inputTokens: 13_000, outputTokens: 90 },
    }, 9_000),
    event(11, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 9_100),
  ] as unknown as readonly SessionEvent[]

  const text = (state: ReturnType<typeof createTrajectory>, width = 110, height = 20): string =>
    renderTrajectory(state, createTheme(false), width, height).lines.map(stripAnsi).join('\n')

  it('groups records under a turn rule and a step per request', () => {
    const rendered = text(createTrajectory(shaped))
    // The three levels, in the order a reader descends them.
    expect(rendered).toMatch(/── Turn 1 .* 9s/u)
    expect(rendered).toContain('Step 1')
    expect(rendered).toContain('Step 2')
    expect(rendered.indexOf('Step 1')).toBeLessThan(rendered.indexOf('ASSISTANT'))
    expect(rendered.indexOf('Step 2')).toBeGreaterThan(rendered.indexOf('grep'))
    // The location column and the internal nouns are gone: the headers say where
    // a record is, and `12 records · 6 requests · 9 calls` counted what the reader
    // never named.
    expect(rendered).toContain('1 turn · 2 steps · 9s')
    expect(rendered).not.toContain('records ·')
    expect(rendered).not.toContain('T1·1')
  })

  it('states a request what it cost, without an em dash for a record that cost nothing', () => {
    const rows = text(createTrajectory(shaped)).split('\n')
    const assistant = rows.find(row => row.includes('ASSISTANT'))
    expect(assistant).toContain('12.4K→812')
    expect(assistant).toMatch(/4\.3s/u)
    // A user message never had a duration; a column of em dashes would read as
    // missing data rather than as "this row was never timed".
    const user = rows.find(row => row.includes('USER'))
    expect(user).not.toContain('—')
  })

  it('reports what the calls fold hid on the step it hid it from', () => {
    const folded = applyTrajectoryEvent(createTrajectory(shaped), { type: 'text', value: 'c' } as never).state
    const rendered = text(folded)
    expect(rendered).not.toContain('README.md')
    expect(rendered).toContain('Step 1 · read grep')
  })

  it('expands the calls again to reach a record a search found', () => {
    let state = createTrajectory(shaped)
    state = applyTrajectoryEvent(state, { type: 'text', value: 'c' } as never).state
    expect(state.callsCollapsed).toBe(true)
    state = applyTrajectoryEvent(state, { type: 'text', value: '/' } as never).state
    for (const char of 'grep') {
      state = applyTrajectoryEvent(state, { type: 'text', value: char } as never).state
    }
    state = applyTrajectoryEvent(state, { type: 'key', id: 'enter' } as never).state
    expect(state.callsCollapsed).toBe(false)
    expect(text(state)).toContain('grep')
  })

  it('folds a turn into its rule without losing how much it folded', () => {
    const folded = applyTrajectoryEvent(createTrajectory(shaped), { type: 'text', value: 't' } as never).state
    const rendered = text(folded)
    expect(rendered).toContain('── Turn 1 · 2 steps · collapsed')
    // The span survives the fold: it is the reason the turn was worth folding.
    expect(rendered).toMatch(/9s/u)
  })

  it('offers only the detail sections a record can fill', () => {
    const state = { ...createTrajectory(shaped), details: true }
    const rendered = renderTrajectory(state, createTheme(false), 110, 20).lines.map(stripAnsi).join('\n')
    // An assistant record has a request payload and a result, and no tool schema,
    // so the section row is exactly what it can fill.
    expect(rendered).toMatch(/summary +payload +result/u)
    expect(rendered).not.toMatch(/summary +payload +result +schema/u)
    // `Tab` steps through the sections it does have, so it never lands on one
    // that would print "No tool schema recorded."
    let cycled = state
    const seen = new Set<string>()
    for (let index = 0; index < 8; index += 1) {
      cycled = applyTrajectoryEvent(cycled, { type: 'key', id: 'tab' } as never).state
      seen.add(cycled.detailTab)
    }
    expect(seen.has('schema')).toBe(false)
    expect(seen.size).toBeGreaterThan(1)
  })

  it('opens the timing overview only where there is a shape to compare', () => {
    // Two steps: the bars say something the rows cannot say as quickly.
    expect(text(createTrajectory(shaped))).toContain('LLM')
    // One step: the same fact in two extra rows, above the one row that states it.
    const single = shaped.filter(item => !('step' in (item.data as object) && (item.data as { step?: number }).step === 2))
      .filter(item => item.seq < 9)
    expect(text(createTrajectory(single as unknown as readonly SessionEvent[]), 110, 40)).not.toContain('LLM')
    // Searching is about text, not time.
    let searching = createTrajectory(shaped)
    searching = applyTrajectoryEvent(searching, { type: 'text', value: '/' } as never).state
    searching = applyTrajectoryEvent(searching, { type: 'text', value: 'r' } as never).state
    expect(text(searching)).not.toContain('LLM')
  })

  it('keeps the overview out of the page size it reserves', () => {
    const state = createTrajectory(shaped)
    expect(trajectoryOverviewHeight(state, 110)).toBe(2)
    // Too narrow to draw a bar, so the rows go back to the ledger.
    expect(trajectoryOverviewHeight(state, 10)).toBe(0)
    // The bars sit between the toolbar and the ledger, so a page that ignored
    // them would scroll past what the frame can show.
    expect(trajectoryListMetrics(state, 10, 110).pageSize)
      .toBeLessThan(trajectoryListMetrics(state, 10, 10).pageSize)
  })
})
