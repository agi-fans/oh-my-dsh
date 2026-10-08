import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { applyEvent, initialTranscript, renderView } from './event-views.ts'
import { stripAnsi } from '../chrome/width.ts'
import type { TranscriptState } from './transcript-types.ts'

function ev(type: string, data: unknown, seq: number): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

const call = (id: string, name: string, args: unknown, seq: number): SessionEvent =>
  ev('tool/call', { callId: id, name, arguments: JSON.stringify(args) }, seq)

const result = (id: string, text: string, seq: number): SessionEvent =>
  ev('tool/result', { message: { role: 'tool', toolCallId: id, content: [{ type: 'text', text }] } }, seq)

describe('math preferences and immutable transcript caches', () => {
  it.each([false, true])('refreshes the same blocks when math preferences change (color=%s)', colors => {
    const state: TranscriptState = { ...initialTranscript(), turn: 1, status: 'idle', blocks: [
      { kind: 'user', text: 'math' },
      { kind: 'assistant', turn: 1, step: 1, text: 'Intermediate $x^2$.', reasoning: 'Reasoning $y^2$.' },
      { kind: 'tool', turn: 1, callId: 'c', name: 'read', args: '{}', status: 'ok', output: 'x' },
      { kind: 'assistant', turn: 1, step: 2, text: 'Final $z^2$.', reasoning: '' },
    ] }
    for (const toolsExpanded of [false, true]) {
      const screen = (mathMode: 'auto' | 'source'): string => renderView(state, {
        width: 80, height: 50, model: 'm', input: '', inputCursor: 0, colors, toolsExpanded, mathMode,
      }).lines.map(stripAnsi).join('\n')
      const auto = screen('auto')
      expect(auto).toContain('Final z².')
      const source = screen('source')
      expect(source).toContain('Final $z^2$.')
      if (toolsExpanded) {
        expect(source).toContain('Intermediate $x^2$.')
        expect(source).toContain('Reasoning $y^2$.')
      }
      expect(screen('auto')).toBe(auto)
    }
  })
})

describe('Mermaid preferences and immutable transcript caches', () => {
  it.each([false, true])('refreshes folded and expanded replies when Mermaid preferences change (color=%s)', colors => {
    const diagram = '```mermaid\ngraph TD\nA[First] --> B[Second]\n```'
    const state: TranscriptState = { ...initialTranscript(), turn: 1, status: 'idle', blocks: [
      { kind: 'user', text: 'diagram' },
      { kind: 'assistant', turn: 1, step: 1, text: diagram, reasoning: diagram },
      { kind: 'tool', turn: 1, callId: 'c', name: 'read', args: '{}', status: 'ok', output: 'x' },
      { kind: 'assistant', turn: 1, step: 2, text: diagram, reasoning: '' },
    ] }
    for (const toolsExpanded of [false, true]) {
      const screen = (mermaidMode: 'auto' | 'source'): string => renderView(state, {
        width: 80, height: 60, model: 'm', input: '', inputCursor: 0, colors, toolsExpanded, mermaidMode,
      }).lines.map(stripAnsi).join('\n')
      const auto = screen('auto')
      const source = screen('source')
      expect(source).toContain('A[First] --> B[Second]')
      expect(auto).not.toBe(source)
      expect(screen('auto')).toBe(auto)
    }
  })
})

/**
 * A prompt, a thought, three calls, and an answer — one finished turn.
 *
 * The thought carries no text of its own so that it belongs to the same run as
 * the calls; a thought that already answered would close the run before them
 * and there would be no run left to fold.
 */
const TURN: SessionEvent[] = [
  ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'do the thing' }] }, 1),
  ev('assistant/message', {
    turn: 1,
    step: 1,
    message: {
      role: 'assistant',
      content: [{ type: 'reasoning', text: 'I should read the manifests first.\nThen check the lockfile.' }],
    },
  }, 2),
  call('c1', 'read', { path: 'package.json' }, 3),
  result('c1', 'the whole manifest body', 4),
  call('c2', 'grep', { pattern: '0.2.0' }, 5),
  result('c2', '2 hits', 6),
  call('c3', 'bash', { command: 'pnpm test' }, 7),
  result('c3', 'all green', 8),
  ev('assistant/message', {
    turn: 1,
    step: 2,
    message: { role: 'assistant', content: [{ type: 'text', text: 'All done.' }] },
  }, 9),
]

function transcript(): TranscriptState {
  let state = initialTranscript()
  for (const event of TURN) state = applyEvent(state, event)
  return state
}

describe('the render cache and a turn that is still running', () => {
  // A running turn's trailing run is painted flat, ungrouped, and becomes a
  // group when the turn ends. That projection reads `state.status`, which
  // lives outside the block array: `setStatus` changes only the status and
  // leaves the blocks' identity alone. The cache is keyed on the block array,
  // so without the status in the key the second of two status changes reused
  // the first one's rows — a live turn came back folded, or a finished one
  // came back flat with no header and no elapsed time.
  const finished = transcript()
  const running: TranscriptState = { ...finished, status: 'running' }

  const at = (state: TranscriptState): string => renderView(state, {
    width: 74, height: 60, model: 'm', input: '', inputCursor: 0, colors: false,
  }).lines.map(stripAnsi).join('\n')

  it('paints a finished run folded and the same run flat while it is still running', () => {
    // Both renderings are driven from one block array; only the status differs.
    expect(finished.blocks).toBe(running.blocks)
    expect(at(finished)).toContain('▸ Worked')
    expect(at(running)).not.toContain('▸ Worked')
  })

  it('does not reuse the other status\'s rows when the status flips', () => {
    // The first status primes the cache for this exact block array.
    const settledFirst = at(finished)
    const runningAfter = at(running)
    expect(runningAfter).not.toContain('▸ Worked')

    const runningFirst = at(running)
    const settledAfter = at(finished)
    expect(settledAfter).toBe(settledFirst)
    expect(runningFirst).not.toBe(settledFirst)
  })
})

describe('the render cache and a turn that finished while the blocks stayed', () => {
  // A run's header says how long its turn took, and that number lives in
  // `turnSpans` — outside the block array the cache is keyed on. Settling a
  // turn replaces that object without touching a single block, so a cache that
  // did not compare it would keep rendering the old duration over the same
  // blocks forever.
  const settled = (turnSpans: TranscriptState['turnSpans']): TranscriptState => ({
    ...initialTranscript(), turn: 1, status: 'idle',
    blocks: [
      { kind: 'user', text: 'go' },
      { kind: 'tool', callId: 'c1', name: 'read', args: '{"path":"a"}', status: 'ok', output: 'x', turn: 1 },
      { kind: 'tool', callId: 'c2', name: 'read', args: '{"path":"b"}', status: 'ok', output: 'x', turn: 1 },
      { kind: 'assistant', turn: 1, step: 2, text: 'All done.', reasoning: '' },
    ],
    turnSpans,
  })
  const screen = (state: TranscriptState): string => renderView(state, {
    width: 74, height: 40, model: 'm', input: '', inputCursor: 0, colors: false,
  }).lines.map(stripAnsi).join('\n')

  it('redraws the elapsed time when only the turn span changes', () => {
    const running = settled({ 1: { start: 0 } })
    expect(screen(running)).not.toContain('Worked for')

    // The turn ended: the same block array, a new span object.
    const done = { ...running, turnSpans: { 1: { start: 0, end: 125_000 } } }
    expect(done.blocks).toBe(running.blocks)
    expect(screen(done)).toContain('Worked for 2m 5s')
  })

  it('redraws when the duration itself changes', () => {
    // A span rewritten with a different end — a resumed or re-replayed turn.
    const first = settled({ 1: { start: 0, end: 60_000 } })
    expect(screen(first)).toContain('Worked for 1m 0s')

    const second = { ...first, turnSpans: { 1: { start: 0, end: 600_000 } } }
    expect(screen(second)).toContain('Worked for 10m 0s')
  })
})
