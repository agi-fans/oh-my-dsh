/**
 * Density contract at the rendering layer.
 *
 * The renderer reads booleans and nothing else: a reader's density is resolved
 * upstream, and these tests drive the four rungs through the same transcript to
 * prove each one reaches the screen. The row-offset assertions are here for the
 * same reason they are in the group contract — a fold that repaints correctly
 * but leaves a stale offset behind breaks search and focus instead of looking
 * obviously wrong.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { applyEvent, initialTranscript, processGroups, renderView } from './event-views.ts'
import { stripAnsi } from '../chrome/width.ts'
import type { TranscriptState } from './transcript-types.ts'
import { foldPolicy, type FoldDensity } from '../session/fold-policy.ts'

function ev(type: string, data: unknown, seq: number): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

const call = (id: string, name: string, args: unknown, seq: number): SessionEvent =>
  ev('tool/call', { callId: id, name, arguments: JSON.stringify(args) }, seq)

const result = (id: string, text: string, seq: number): SessionEvent =>
  ev('tool/result', { message: { role: 'tool', toolCallId: id, content: [{ type: 'text', text }] } }, seq)

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

/** Identity of the one run in the fixture, so a test never hard-codes it. */
const RUN_KEY = processGroups(transcript().blocks)[0]!.key

function view(density: FoldDensity | undefined, over: Record<string, unknown> = {}): string {
  return renderView(transcript(), {
    width: 74,
    height: 60,
    model: 'm',
    input: '',
    inputCursor: 0,
    colors: false,
    ...(density === undefined ? {} : { fold: foldPolicy(density) }),
    ...over,
  }).lines.map(stripAnsi).join('\n')
}

describe('transcript density', () => {
  it('folds the calls and the thinking into one row at the default rung', () => {
    const screen = view('standard')
    expect(screen).toContain('All done.')
    // The calls are behind the header, so none of their facts reach the screen.
    expect(screen).not.toContain('the whole manifest body')
    expect(screen).not.toContain('package.json')
    // The thought is a row of the run. Closing the run on every thought split
    // a turn into one run per step and left nothing folded.
    expect(screen).not.toContain('I should read the manifests first')
    // The header says what was done, not what kind of tool did it.
    expect(screen).toContain('Read a file')
    expect(screen).not.toContain('Process')
  })

  it('keeps the same shape when no policy is supplied at all', () => {
    // The plain printer and older callers pass no density, so the default has
    // to be the shipped one rather than "everything open".
    expect(view(undefined)).toBe(view('standard'))
  })

  it('drops the header specifics at the quietest rung, where the run still shows', () => {
    // This is the difference a reader meets most: a run is one row either way,
    // and the quiet rung keeps only what the row is for — how much there was,
    // and whether it broke.
    const quiet = view('compact')
    const loud = view('standard')
    expect(quiet).toMatch(/3 calls/u)
    expect(quiet).not.toContain('Read a file')
    expect(loud).toContain('Read a file')
  })

  it('shows each call and its argument only once the run opens', () => {
    expect(view('standard')).not.toContain('pnpm test')
    for (const density of ['detailed', 'verbose'] as const) {
      expect(view(density)).toContain('pnpm test')
    }
  })

  it('drops the argument clause at the quietest rung but keeps the tool name', () => {
    // The run is collapsed at both rungs, so the clause is best read off a run
    // that a failure forces open — which is the same place a reader meets it.
    const screen = view('compact', { openedGroups: new Set([RUN_KEY]) })
    expect(screen).toContain('Read file')
    expect(screen).not.toContain('package.json')
    const loud = view('standard', { openedGroups: new Set([RUN_KEY]) })
    expect(loud).toContain('package.json')
  })

  it('paints full call output only at the top rung', () => {
    // `detailed` opens the run but still folds each call; `verbose` is the rung
    // that trades a screenful of output for the transcript being complete.
    expect(view('detailed')).not.toContain('the whole manifest body')
    expect(view('verbose')).toContain('the whole manifest body')
  })

  it('reads the thinking in full only at the detailed rung', () => {
    // The second paragraph is the marker: the first line is also what a folded
    // preview shows, so it cannot tell the two states apart.
    expect(view('detailed')).toContain('Then check the lockfile')
    expect(view('standard')).not.toContain('Then check the lockfile')
    expect(view('verbose')).not.toContain('Then check the lockfile')
  })

  it('keeps an opened run folded call by call, except at the top rung', () => {
    for (const density of ['compact', 'standard', 'detailed'] as const) {
      expect(view(density, { openedGroups: new Set([RUN_KEY]) })).not.toContain('the whole manifest body')
    }
    expect(view('verbose', { openedGroups: new Set([RUN_KEY]) })).toContain('the whole manifest body')
  })

  it('repaints when only the density changes, against the same transcript', () => {
    // Formatted rows are cached by block-array identity, so this has to ask for
    // both rungs from one state: a second state would miss the cache for
    // unrelated reasons and pass even with the density missing from its key.
    const state = transcript()
    const at = (density: FoldDensity): string => renderView(state, {
      width: 74, height: 60, model: 'm', input: '', inputCursor: 0, colors: false,
      fold: foldPolicy(density),
    }).lines.map(stripAnsi).join('\n')
    const standard = at('standard')
    expect(at('standard')).toBe(standard)
    expect(at('detailed')).not.toBe(standard)
    expect(at('compact')).not.toBe(standard)
    expect(at('verbose')).not.toBe(standard)
  })

  it('keeps Ctrl+O above the density', () => {
    // The key opens everything regardless of the rung, which is the one way to
    // see the thinking at `verbose` without changing any preference.
    expect(view('verbose', { toolsExpanded: true })).toContain('I should read the manifests first')
    expect(view('compact', { toolsExpanded: true })).toContain('the whole manifest body')
  })

  it('leaves a call the reader opened open at every folding rung', () => {
    for (const density of ['compact', 'standard', 'detailed'] as const) {
      const screen = view(density, { openedGroups: new Set([RUN_KEY]), expandedTools: new Set(['c1']) })
      expect(screen).toContain('the whole manifest body')
    }
  })
})

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
    width: 74, height: 60, model: 'm', input: '', inputCursor: 0, colors: false, fold: foldPolicy('standard'),
  }).lines.map(stripAnsi).join('\n')

  it('paints a finished run folded and the same run flat while it is still running', () => {
    // Both renderings are driven from one block array; only the status differs.
    expect(finished.blocks).toBe(running.blocks)
    expect(at(finished)).toContain('Read a file')
    expect(at(running)).not.toContain('Read a file')
  })

  it('does not reuse the other status\'s rows when the status flips', () => {
    // The first status primes the cache for this exact block array.
    const settledFirst = at(finished)
    const runningAfter = at(running)
    expect(runningAfter).not.toContain('Read a file')

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
    fold: foldPolicy('standard'),
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
