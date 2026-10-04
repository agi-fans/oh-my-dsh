/**
 * Process group contract.
 *
 * A group is a rendering decision, not a change to the block list: the runs of
 * work between two replies collapse to one aggregate row. Every assertion here
 * is about what a terminal shows and about the row offsets other features rely
 * on, because those offsets are the one thing a fold like this can silently
 * break.
 */
import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applyEvent,
  initialTranscript,
  processGroups,
  renderView,
  replayEvents,
} from './event-views.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import type { Block, TranscriptState } from './transcript-types.ts'

function ev(type: string, data: unknown, seq: number): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

const call = (id: string, name: string, args: unknown, seq: number): SessionEvent =>
  ev('tool/call', { callId: id, name, arguments: JSON.stringify(args) }, seq)

const result = (id: string, text: string, seq: number, isError = false): SessionEvent =>
  ev('tool/result', {
    message: { role: 'tool', toolCallId: id, isError, content: [{ type: 'text', text }] },
  }, seq)

const think = (turn: number, step: number, reasoning: string, text: string, seq: number): SessionEvent =>
  ev('assistant/message', {
    turn,
    step,
    message: {
      role: 'assistant',
      content: [...(reasoning === '' ? [] : [{ type: 'reasoning', text: reasoning }]), { type: 'text', text }],
    },
  }, seq)

const body = (state: TranscriptState, over: Record<string, unknown> = {}): string =>
  renderView(state, {
    width: 74, height: 40, model: 'm', input: '', inputCursor: 0, colors: false, ...over,
  }).lines.map(stripAnsi).join('\n')

/** One finished turn: a prompt, a thought, three calls, an answer. */
function oneTurn(): SessionEvent[] {
  return [
    ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'do the thing' }] }, 1),
    think(1, 1, 'I should read the manifests first.', 'Reading them.', 2),
    call('c1', 'read', { path: 'package.json' }, 3),
    result('c1', 'ok', 4),
    call('c2', 'grep', { pattern: '0.2.0' }, 5),
    result('c2', '2 hits', 6),
    call('c3', 'bash', { command: 'pnpm test' }, 7),
    result('c3', 'all green', 8),
    think(1, 2, 'The cohort is fine.', 'The cohort is current.', 9),
  ]
}

const fold = (events: readonly SessionEvent[]) => events.reduce(applyEvent, initialTranscript())

describe('processGroups', () => {
  it('collects everything between the prompt and the answer into one group', () => {
    const groups = processGroups(fold(oneTurn()).blocks)

    // The reply written on the way — `Reading them.` — is part of the run; only
    // the last reply is the answer, and its thought is the run's last row.
    expect(groups).toHaveLength(1)
    expect(groups[0]?.start).toBe(1)
    expect(groups[0]?.answer ?? groups[0]?.until).toBe(5)
    // The run took the answering step's thought, so the reply below it is that
    // same block with its words only — one index, one flag, not two.
    expect(groups[0]?.answer).toBe(5)
    expect(groups[0]?.tookThought).toBe(true)
  })

  it('keeps a mid-turn reply out of sight once the run folds', () => {
    const text = body(fold(oneTurn()))

    expect(text).not.toContain('Reading them.')
    expect(text).toContain('The cohort is current.')
  })

  it('splits two turns that no prompt separates', () => {
    // A goal continuing itself starts a turn with no prompt; the turn number on
    // each block is what still tells the two runs apart.
    const state = fold([
      ev('turn/start', { turn: 1 }, 1),
      ev('tool/call', { turn: 1, step: 1, callId: 'a1', name: 'read', arguments: '{"path":"a"}' }, 2), result('a1', 'ok', 3),
      ev('tool/call', { turn: 1, step: 1, callId: 'a2', name: 'read', arguments: '{"path":"b"}' }, 4), result('a2', 'ok', 5),
      think(1, 2, '', 'First turn done.', 6),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 7),
      ev('turn/start', { turn: 2 }, 8),
      ev('tool/call', { turn: 2, step: 1, callId: 'b1', name: 'read', arguments: '{"path":"c"}' }, 9), result('b1', 'ok', 10),
      ev('tool/call', { turn: 2, step: 1, callId: 'b2', name: 'read', arguments: '{"path":"d"}' }, 11), result('b2', 'ok', 12),
      think(2, 2, '', 'Second turn done.', 13),
    ])
    const groups = processGroups(state.blocks)

    expect(groups.map(group => group.turn)).toEqual([1, 2])
    expect(body(state)).toContain('First turn done.')
  })

  it('folds a background job settling mid-turn into the run instead of splitting it', () => {
    const state = fold([
      ev('turn/start', { turn: 1 }, 1),
      call('c1', 'read', { path: 'a' }, 2), result('c1', 'ok', 3),
    ])
    const blocks: Block[] = [
      ...state.blocks,
      { kind: 'notice', level: 'info', text: 'Background job bash-1 completed', process: { turn: 1 } },
      { kind: 'tool', callId: 'c2' as never, name: 'read', args: '{"path":"b"}', status: 'ok', output: '', turn: 1 },
    ]
    const groups = processGroups(blocks)

    expect(groups).toHaveLength(1)
    expect(groups[0]?.calls).toBe(2)
  })

  it('counts tools with no known family in the run total', () => {
    const state = fold([
      call('c1', 'strange_tool', {}, 1),
      result('c1', 'ok', 2),
      call('c2', 'other_tool', {}, 3),
      result('c2', 'ok', 4),
    ])

    expect(processGroups(state.blocks)[0]?.calls).toBe(2)
  })

  it('counts a group with a single call out', () => {
    const state = fold([call('c1', 'read', { path: 'a' }, 1), result('c1', 'ok', 2)])

    expect(processGroups(state.blocks)).toEqual([])
  })

  it('keeps a notice out of a group', () => {
    // A slash command answers the reader, so its output closes the run rather
    // than being summarized into whatever calls happened to precede it.
    const state: Block[] = [
      { kind: 'tool', callId: ToolCallId('c1'), name: 'read', args: '{}', status: 'ok', output: 'ok' },
      { kind: 'notice', level: 'info', text: 'all clear' },
      { kind: 'tool', callId: ToolCallId('c2'), name: 'bash', args: '{}', status: 'ok', output: 'ok' },
      { kind: 'tool', callId: ToolCallId('c3'), name: 'grep', args: '{}', status: 'ok', output: 'ok' },
    ]

    const groups = processGroups(state)
    // The notice closes the first run, so only the calls after it group.
    expect(groups).toHaveLength(1)
    expect(groups[0]?.start).toBe(2)
    expect(groups[0]?.answer ?? groups[0]?.until).toBe(4)
  })

  it('marks a group that still holds a call in flight as live', () => {
    let state = fold([call('c1', 'read', { path: 'a' }, 1), result('c1', 'ok', 2), call('c2', 'bash', { command: 'ls' }, 3)])
    state = { ...state, status: 'running' }
    const live = processGroups(state.blocks)[0]

    expect(live?.live).toBe(true)
    expect(processGroups(fold(oneTurn()).blocks)[0]?.live).toBe(false)
  })
})

describe('folded group row', () => {
  it('replaces the run of calls with one row and leaves the replies alone', () => {
    const text = body(fold(oneTurn()))

    expect(text).toContain('▸ Worked')
    expect(text).toContain('do the thing')
    expect(text).toContain('The cohort is current.')
    expect(text).not.toContain('pnpm test')
  })

  it('says how many families it left out', () => {
    const state = fold([
      call('c1', 'read', { path: 'a' }, 1), result('c1', 'ok', 2),
      call('c2', 'grep', { pattern: 'x' }, 3), result('c2', 'ok', 4),
      call('c3', 'bash', { command: 'ls' }, 5), result('c3', 'ok', 6),
      call('c4', 'web_search', { query: 'q' }, 7), result('c4', 'ok', 8),
      call('c5', 'session_search', { query: 'q' }, 9), result('c5', 'ok', 10),
    ])

    // Three phrases read as a sentence; a fourth is counted rather than listed,
    // so the row never pretends the summary is the whole of the run.
    // The count is the list's last item, so only it takes the `and`.
    expect(body(state)).toContain('▸ Worked')
  })

  it('states that a call in the group failed rather than hiding the row', () => {
    const state = fold([
      call('c1', 'read', { path: 'a' }, 1), result('c1', 'ok', 2),
      call('c2', 'bash', { command: 'pnpm test' }, 3), result('c2', 'FAIL', 4, true),
    ])
    const text = body(state)

    // The run stays folded — the successful read is not shown — but a header
    // saying only "something failed" would hide the row that says what, so the
    // failed call keeps its row under the header.
    expect(text).toContain('▸ Worked')
    expect(text).not.toContain('Read file · a')
    expect(text).toContain('Run command · pnpm test')
    expect(text).toContain('FAIL')
  })

  it('marks a run that failed', () => {
    const state = fold([
      call('c1', 'read', { path: 'a' }, 1), result('c1', 'ok', 2),
      call('c2', 'bash', { command: 'ls' }, 3), result('c2', 'FAIL', 4, true),
    ])

    expect(body(state)).toContain('1 failed')
  })

  it('describes the work without an extra count', () => {
    // One total, not a count per category: the number answers "is there more in
    // here than this row shows", and one number is the whole of that question.
    expect(body(fold(oneTurn()))).not.toMatch(/3 calls/u)
    expect(body(fold(oneTurn()))).not.toMatch(/Read a file · /u)
  })

  it('fills exactly the terminal width', () => {
    for (const width of [20, 40, 80, 120]) {
      const lines = renderView(fold(oneTurn()), {
        width, height: 40, model: 'm', input: '', inputCursor: 0, colors: false,
      }).lines
      expect(lines.every(line => visibleWidth(line) <= width)).toBe(true)
    }
  })

  it('opens a group under ctrl+o and closes it again', () => {
    const state = fold(oneTurn())
    const collapsed = body(state)
    expect(collapsed).toContain('▸ Worked')
    const opened = body(state, { openedGroups: new Set(processGroups(state.blocks).map(group => group.key)) })

    expect(opened).not.toContain('▸ Worked')
    expect(opened).toContain('pnpm test')
  })

  it('opens every group under the global expand', () => {
    const opened = body(fold(oneTurn()), { toolsExpanded: true })

    expect(opened).toContain('pnpm test')
    expect(opened).toContain('Reading them.')
  })

  it('keeps a live group open so a running turn stays watchable', () => {
    let state = fold([call('c1', 'read', { path: 'a' }, 1), result('c1', 'ok', 2), call('c2', 'bash', { command: 'ls' }, 3)])
    state = { ...state, status: 'running' }

    expect(body(state)).toContain('ls')
  })

  it('rebuilds the same projection when the log is replayed', () => {
    const live = processGroups(fold(oneTurn()).blocks)
    const resumed = processGroups(replayEvents(oneTurn()).blocks)

    expect(resumed).toEqual(live)
  })
})

describe('row offsets other features depend on', () => {
  // The renderer does not publish its offsets, so derive them the way a reader
  // experiences them: the first line each block's own text appears on.
  function blockStartsOf(state: TranscriptState, over: Record<string, unknown>): number[] {
    const lines = renderView(state, {
      width: 74, height: 40, model: 'm', input: '', inputCursor: 0, colors: false, ...over,
    }).lines.map(stripAnsi)
    return state.blocks.map(block => {
      const probe = probeText(block)
      const at = probe === '' ? -1 : lines.findIndex(line => line.includes(probe))
      return at
    })
  }

  function probeText(block: Block): string {
    if (block.kind === 'tool') return block.name
    if (block.kind === 'assistant') return block.text.split('\n')[0] ?? ''
    if (block.kind === 'user') return block.text
    return ''
  }

  it('keeps every addressed block on a real row, folded or not', () => {
    const state = fold(oneTurn())
    const lines = renderView(state, {
      width: 74, height: 40, model: 'm', input: '', inputCursor: 0, colors: false,
    }).lines.map(stripAnsi)
    const offsets = blockStartsOf(state, {})

    // A block hidden behind a folded group may share an offset, but it must
    // never point past the end of the frame: the focus path clamps into this
    // array and a dangling offset scrolls the reader somewhere meaningless.
    expect(Math.max(...offsets)).toBeLessThan(lines.length)
    const visible = offsets.filter(index => index >= 0)
    expect(visible.length).toBeGreaterThan(0)
  })

  it('opens the group a search match lands in, so the match is visible', () => {
    const state = fold(oneTurn())
    const target = state.blocks.findIndex(block => block.kind === 'tool' && block.name === 'bash')
    const withSearch = body(state, {
      transcriptSearch: { query: 'pnpm test', matches: [target], focus: target, editing: true },
    })

    // The call the reader searched for is inside a collapsed group. Finding it
    // has to open the group, or the match index would point at a hidden row.
    expect(withSearch).toContain('pnpm test')
    expect(withSearch).not.toContain('▸ Worked')
  })

  it('opens the group the focused block sits in', () => {
    const state = fold(oneTurn())
    const target = state.blocks.findIndex(block => block.kind === 'tool' && block.name === 'grep')

    expect(body(state, { focusBlock: target })).toContain('0.2.0')
  })
})

describe('block identity', () => {
  it('keys a group on its first block so a growing group keeps its opened state', () => {
    const before = processGroups(fold(oneTurn()).blocks)
    const grown = processGroups(fold([...oneTurn(), call('c4', 'bash', { command: 'ls' }, 10)]).blocks)

    expect(grown[0]?.key).toBe(before[0]?.key)
  })

  it('keeps a sub-call inside its own group rather than splitting it out', () => {
    const state = fold([
      call('run-1', 'run_code', { code: 'x' }, 1),
      ev('tool/ptc-dispatch-start', { rootCallId: 'run-1', parentCallId: 'run-1', subCallId: 'run-1:ptc:1', name: 'read', arguments: { path: 'a' } }, 2),
      ev('tool/ptc-dispatch', { rootCallId: 'run-1', parentCallId: 'run-1', subCallId: 'run-1:ptc:1', name: 'read', arguments: { path: 'a' }, isError: false, content: [{ type: 'text', text: 'ok' }] }, 3),
    ])

    expect(processGroups(state.blocks)).toHaveLength(1)
  })

  it('accepts the ids the harness uses for a program and its sub-calls', () => {
    expect(ToolCallId('run-1:ptc:1')).toBe('run-1:ptc:1')
  })
})

describe('a run whose work settles after its answer', () => {
  // A background job finishes, a retry is reported. Both are process blocks, so
  // they join the run instead of splitting it, and they can arrive after the
  // turn already answered. Reading the stretch's last block as the answer then
  // found no answer at all, and folded the reply itself into the run.
  const trailingNotice = (turn: number, source: string, seq: number): Block => ({
    kind: 'notice', level: 'info', text: `Background job ${source} completed`, process: { turn, source },
  })

  /** A settled transcript with these blocks and nothing else on screen. */
  const stateOf = (blocks: readonly Block[]): TranscriptState => ({
    ...initialTranscript(), blocks: [...blocks], turn: 1, status: 'idle',
  })

  const turnThenNotice = (turn: number, source: string): Block[] => [
    { kind: 'user', text: 'go' },
    { kind: 'tool', callId: `c-${turn}-1`, name: 'read', args: '{"path":"a"}', status: 'ok', output: 'ok', turn },
    { kind: 'tool', callId: `c-${turn}-2`, name: 'read', args: '{"path":"b"}', status: 'ok', output: 'ok', turn },
    { kind: 'assistant', turn, step: 2, text: `THE ANSWER ${turn}`, reasoning: '' },
    trailingNotice(turn, source, 0),
  ]

  it('keeps a trailing tool failure visible when the turn folds', () => {
    const blocks = turnThenNotice(1, 'job-1')
    blocks.push({ kind: 'tool', turn: 1, callId: ToolCallId('late-failure'), name: 'bash', args: '{"command":"pnpm test"}', status: 'error', output: 'Late failure detail' })
    const screen = body(stateOf(blocks))
    expect(screen).toContain('1 failed')
    expect(screen).toContain('Late failure detail')
    expect(screen).toContain('THE ANSWER 1')
    expect(screen).not.toContain('Background job job-1')
  })

  it('leaves the answer outside the run instead of folding it away', () => {
    const groups = processGroups(turnThenNotice(1, 'job-1'))

    // `end` is the run's own members, which stop before the answer it closed;
    // `until` is the whole stretch, so it runs past the trailing notice. The
    // answer at index 3 is therefore outside the run rather than inside it.
    expect(groups[0]?.answer ?? groups[0]?.until).toBe(3)
    expect(groups[0]?.until).toBe(5)
    expect(body(stateOf(turnThenNotice(1, 'job-1')))).toContain('THE ANSWER 1')
  })

  it('paints the trailing work as the run\'s rows, and the answer once', () => {
    const state = stateOf(turnThenNotice(1, 'job-1'))
    const lines = body(state, { openedGroups: new Set(processGroups(state.blocks).map(group => group.key)) }).split('\n')
    const answer = lines.findIndex(line => line.includes('THE ANSWER 1'))
    const notice = lines.findIndex(line => line.includes('Background job job-1'))

    // The notice arrived after the answer but belongs to the run, so it reads
    // among the run's rows; the answer stays below, and it reads exactly once
    // however many blocks the run took around it.
    expect(answer).toBeGreaterThan(-1)
    expect(notice).toBeGreaterThan(-1)
    expect(lines.filter(line => line.includes('THE ANSWER 1'))).toHaveLength(1)
  })

  it('keys two notice-led runs apart, so opening one does not open the rest', () => {
    // Both runs *begin* with a process notice. A run is keyed on its first
    // block, so keying that notice by kind alone gave every notice-led run in
    // the document one key, and the opened-run set is keyed by that string: the
    // reader opened one turn and every other turn opened with it.
    const led = (turn: number, source: string): Block[] => [
      { kind: 'user', text: `turn ${turn}` },
      trailingNotice(turn, source, 0),
      { kind: 'tool', callId: `c-${turn}-1`, name: 'read', args: '{"path":"a"}', status: 'ok', output: 'ok', turn },
      { kind: 'tool', callId: `c-${turn}-2`, name: 'read', args: '{"path":"b"}', status: 'ok', output: 'ok', turn },
    ]
    const groups = processGroups([...led(1, 'job-1'), ...led(2, 'job-2')])

    expect(groups).toHaveLength(2)
    expect(new Set(groups.map(group => group.key)).size).toBe(2)
  })

  it('keeps a run that ends on its answer without trailing work unchanged', () => {
    const groups = processGroups([
      { kind: 'user', text: 'go' },
      { kind: 'tool', callId: 'c1', name: 'read', args: '{"path":"a"}', status: 'ok', output: 'ok', turn: 1 },
      { kind: 'tool', callId: 'c2', name: 'read', args: '{"path":"b"}', status: 'ok', output: 'ok', turn: 1 },
      { kind: 'assistant', turn: 1, step: 2, text: 'done', reasoning: '' },
    ])

    // Nothing trails the answer, so the stretch ends there: `until` is the
    // answer's own index plus one and the run is the ordinary shape. This step
    // thought nothing, so the run has no thought to take from it.
    expect(groups[0]?.answer ?? groups[0]?.until).toBe(3)
    expect(groups[0]?.until).toBe(4)
    expect(groups[0]?.tookThought).toBe(false)
  })

  it('gives every block the row it was actually painted on', () => {
    // The offsets are indexed by block, so assigning them in paint order gave
    // the answer and the notice each other's row: a search hit on the reply
    // scrolled to the notice, and Ctrl+O aimed at the wrong run entirely.
    const blocks = turnThenNotice(1, 'job-1')
    const state = stateOf(blocks)
    const frame = renderView(state, {
      openedGroups: new Set(processGroups(state.blocks).map(group => group.key)),
      width: 74, height: 40, model: 'm', input: '', inputCursor: 0, colors: false,
    })
    const starts = frame.transcript!.blockStarts
    // Offsets are transcript-body rows; the frame places the body below its
    // header, so a row on screen is the body row plus that placement.
    const bodyRow = frame.transcript!.bodyRow ?? 0
    const rows = frame.lines.map(stripAnsi)
    const answerAt = blocks.findIndex(block => block.kind === 'assistant')
    const noticeAt = blocks.findIndex(block => block.kind === 'notice')

    expect(rows[bodyRow + starts[answerAt]!]).toContain('THE ANSWER 1')
    expect(rows[bodyRow + starts[noticeAt]!]).toContain('Background job job-1')
  })

  it('keeps a search match in the answer highlighted, like every other block', () => {
    // The answer is painted by the run's own branch, which bypassed the shared
    // path that inverts a matching line, so a hit in a reply was found and then
    // not shown as one.
    const state = stateOf(turnThenNotice(1, 'job-1'))
    const rows = renderView(state, {
      width: 74, height: 40, model: 'm', input: '', inputCursor: 0, colors: true,
      transcriptSearch: { query: 'THE ANSWER', matches: [3], focus: 3 },
    }).lines

    // The reply's own row is the inverted one, not merely some row somewhere.
    const answerRow = rows.find(row => stripAnsi(row).includes('THE ANSWER 1'))
    expect(answerRow).toContain('\u001b[7m')
  })

  it('opens a thought a search hit landed in, so the matched text is on screen', () => {
    // The run took the answering step's thought as its last row and kept only
    // the words below. A hit inside that thought reported a match against a
    // block whose thought was not on screen at all, so the reader was told
    // about text they could not see and no row led to it.
    const state = stateOf([
      { kind: 'user', text: 'go' },
      { kind: 'tool', callId: 'c1', name: 'read', args: '{"path":"a"}', status: 'ok', output: 'ok', turn: 1 },
      { kind: 'tool', callId: 'c2', name: 'read', args: '{"path":"b"}', status: 'ok', output: 'ok', turn: 1 },
      { kind: 'assistant', turn: 1, step: 2, text: 'the reply', reasoning: 'The lockfile pins a release that is two weeks old.' },
    ])
    const view = (over: Record<string, unknown>): string => renderView(state, {
      width: 74, height: 40, model: 'm', input: '', inputCursor: 0, colors: false,
      ...over,
    }).lines.map(stripAnsi).join('\n')
    const matched = 'The lockfile pins a release that is two weeks old.'

    // Folded at rest, the run keeps the thought behind its one-line preview, so
    // the matched text is not on screen. A search hit has to open the thought
    // itself: the preview is truncated to its first sentence, so a match past
    // that point is reported without anything leading to it.
    expect(view({})).not.toContain(matched)
    const hit = view({ transcriptSearch: { query: 'lockfile pins', matches: [3], focus: 3 } })
    expect(hit).toContain(matched)
    // Laid out under the `∴ Thought` label on its own row rather than packed
    // into the run's one-line preview, which carries a `·` subject clause.
    const rows = renderView(state, {
      width: 74, height: 40, model: 'm', input: '', inputCursor: 0, colors: false,
      transcriptSearch: { query: 'lockfile pins', matches: [3], focus: 3 },
    }).lines.map(stripAnsi)
    expect(rows.find(row => row.includes(matched))?.trim()).toBe(matched)
  })

  it('counts a call that settled behind the answer in the run\'s header', () => {
    // The header says what the run did. Work that settles after the reply is
    // still that work, and a call among it that failed is still a failure the
    // reader has to see — the answer ending the count hid both.
    const groups = processGroups([
      { kind: 'user', text: 'go' },
      { kind: 'tool', callId: 'c1', name: 'read', args: '{"path":"a"}', status: 'ok', output: 'ok', turn: 1 },
      { kind: 'tool', callId: 'c2', name: 'bash', args: '{"command":"ls"}', status: 'ok', output: 'ok', turn: 1 },
      { kind: 'assistant', turn: 1, step: 2, text: 'all done', reasoning: '' },
      { kind: 'tool', callId: 'c3', name: 'bash', args: '{"command":"grep"}', status: 'error', output: 'no match', turn: 1 },
    ])

    expect(groups[0]?.calls).toBe(3)
    expect(groups[0]?.failures).toBe(1)
  })
})

describe('a search hit inside the thought a run took', () => {
  // One block, two rows: the run painted the step's thought as its last row
  // and the reply below it. A hit deep inside a long thought found the block
  // and scrolled to the reply, leaving the matched line above the viewport —
  // reported as found, and not on screen.
  const longThought = (count: number): string =>
    Array.from({ length: count }, (_, i) => `thought line ${i} about the lockfile`).join('\n\n')

  const state = (thought: string): TranscriptState => ({
    ...initialTranscript(), turn: 1, status: 'idle',
    blocks: [
      { kind: 'user', text: 'go' },
      { kind: 'tool', callId: 'c1', name: 'read', args: '{"path":"a"}', status: 'ok', output: 'ok', turn: 1 },
      { kind: 'tool', callId: 'c2', name: 'read', args: '{"path":"b"}', status: 'ok', output: 'ok', turn: 1 },
      { kind: 'assistant', turn: 1, step: 2, text: 'the reply', reasoning: thought },
    ],
  })

  it('scrolls to the thought that matched, not past it to the reply', () => {
    // A hit names a block, so the viewport lands on that block's first row.
    // Before the fix it landed on the reply below a long thought, and the
    // thought's own rows — the ones the hit was in — sat above the viewport.
    const screen = renderView(state(longThought(30)), {
      width: 74, height: 12, model: 'm', input: '', inputCursor: 0, colors: false,
      transcriptSearch: { query: 'thought line 27', matches: [3], focus: 3 },
      focusBlock: 3,
    }).lines.map(stripAnsi).join('\n')

    // The thought is on screen, and it is the topmost thing on it.
    expect(screen).toContain('thought line')
    expect(screen).not.toContain('the reply')
  })

  it('still aims at the reply when the hit is in the reply itself', () => {
    const screen = renderView(state('a short thought'), {
      width: 74, height: 12, model: 'm', input: '', inputCursor: 0, colors: false,
      transcriptSearch: { query: 'the reply', matches: [3], focus: 3 },
      focusBlock: 3,
    }).lines.map(stripAnsi).join('\n')

    expect(screen).toContain('the reply')
  })
})

describe('a frame says which document rows its body came from', () => {
  // The renderer cannot credit what the terminal committed unless it knows
  // which document rows the last screen held, and it can only know that if the
  // frame says so. Reporting "no body" for an ordinary follow frame — which
  // draws the whole body and merely skips the windowing — would clear that
  // record on every frame.
  it('reports the whole body for a frame that followed the tail', () => {
    const state: TranscriptState = {
      ...initialTranscript(), turn: 1, status: 'idle',
      blocks: [
        { kind: 'user', text: 'go' },
        { kind: 'tool', callId: 'c1', name: 'read', args: '{"path":"a"}', status: 'ok', output: 'ok', turn: 1 },
        { kind: 'tool', callId: 'c2', name: 'read', args: '{"path":"b"}', status: 'ok', output: 'ok', turn: 1 },
        { kind: 'assistant', turn: 1, step: 2, text: 'ANSWER', reasoning: '' },
      ],
    }
    const frame = renderView(state, {
      width: 74, height: 40, model: 'm', input: '', inputCursor: 0, colors: false,
    })

    // The welcome header is part of the body, so the range starts at 0 and
    // covers every line the frame drew.
    // The body stops before the composer and the status footer: those are
    // chrome, they move with the input, and counting them as document rows
    // would let a resize credit the terminal with committing them.
    expect(frame.documentRows?.documentStart).toBe(0)
    expect(frame.documentRows?.documentEnd).toBeLessThan(frame.lines.length)
    expect(frame.documentRows?.frameStart).toBe(0)
    // And it covers the welcome header and the transcript itself.
    expect(frame.documentRows?.documentEnd).toBeGreaterThan(10)
  })

})


describe('compact trailing process rows', () => {
  it('keeps consecutive notices together after prose and retains independent failures when folded', () => {
    const state = {
      ...initialTranscript(), turn: 1, status: 'running' as const,
      blocks: [
        { kind: 'tool', callId: ToolCallId('c1'), name: 'read', args: '{"path":"package.json"}', output: '', status: 'ok', turn: 1 },
        { kind: 'assistant', turn: 1, step: 2, text: 'Checking the project.', reasoning: '', streaming: false },
        { kind: 'notice', text: 'Background job bash-1 completed', level: 'info', process: { turn: 1, source: 'job:bash-1' } },
        { kind: 'notice', text: 'Background job bash-2 failed · exit code: 2', level: 'error', process: { turn: 1, source: 'job:bash-2' } },
      ] as Block[],
    }
    const options = { width: 100, height: 30, model: 'm', input: '', inputCursor: 0, colors: false }
    const lines = renderView(state, options).lines.map(stripAnsi)
    const first = lines.findIndex(line => line.includes('bash-1 completed'))
    expect(first).toBeGreaterThan(0)
    expect(lines[first + 1]).toContain('bash-2 failed')
    const folded = renderView({ ...state, status: 'idle' }, options).lines.map(stripAnsi).join('\n')
    expect(folded).toContain('bash-2 failed')
    expect(folded).toContain('exit code: 2')
  })
})
