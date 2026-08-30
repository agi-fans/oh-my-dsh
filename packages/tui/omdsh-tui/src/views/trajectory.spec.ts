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
} from './trajectory.ts'

function event(seq: number, type: string, data: unknown, time = seq * 100): SessionEvent {
  return { seq, type, data, time } as unknown as SessionEvent
}

describe('trajectory ledger', () => {
  const events = [
    event(1, 'turn/start', { turn: 1 }),
    event(2, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'inspect the repo' }] }),
    event(3, 'step/start', { turn: 1, step: 1 }),
    event(4, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'I will inspect.' } }),
    event(5, 'tool/call', { callId: 'call-1', name: 'read', arguments: { path: 'README.md' } }),
    event(6, 'tool/result', { message: { callId: 'call-1', content: [{ type: 'text', text: 'README contents' }] } }),
    event(7, 'assistant/message', {
      turn: 1,
      step: 1,
      message: { content: [{ type: 'text', text: 'Finished.' }], usage: { inputTokens: 10, outputTokens: 2 } },
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
