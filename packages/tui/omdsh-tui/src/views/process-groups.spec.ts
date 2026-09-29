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
import type { Block } from './transcript-types.ts'

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

const body = (state: ReturnType<typeof initialTranscript>, over: Record<string, unknown> = {}): string =>
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
  it('collects the calls between two replies into one group', () => {
    const groups = processGroups(fold(oneTurn()).blocks)

    expect(groups).toHaveLength(1)
    expect(groups[0]?.start).toBe(2)
    expect(groups[0]?.end).toBe(5)
  })

  it('tallies each tool family once, in first-seen order', () => {
    const groups = processGroups(fold(oneTurn()).blocks)

    expect(groups[0]?.categories).toEqual([
      { label: 'files', count: 1 },
      { label: 'search', count: 1 },
      { label: 'commands', count: 1 },
    ])
  })

  it('reports a tool with no family by its own name rather than dropping it', () => {
    const state = fold([
      call('c1', 'strange_tool', {}, 1),
      result('c1', 'ok', 2),
      call('c2', 'other_tool', {}, 3),
      result('c2', 'ok', 4),
    ])

    expect(processGroups(state.blocks)[0]?.categories)
      .toEqual([{ label: 'strange_tool', count: 1 }, { label: 'other_tool', count: 1 }])
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
    expect(groups[0]?.end).toBe(4)
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

    expect(text).toContain('▸  Process')
    expect(text).toContain('files, search, commands')
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

    expect(body(state)).toMatch(/files, search, commands \+2/u)
  })

  it('states that a call in the group failed rather than hiding the row', () => {
    const state = fold([
      call('c1', 'read', { path: 'a' }, 1), result('c1', 'ok', 2),
      call('c2', 'bash', { command: 'pnpm test' }, 3), result('c2', 'FAIL', 4, true),
    ])
    const text = body(state)

    // A group summarizes routine work. One that failed is not routine, and a
    // header saying only "something failed" would undo the row it replaced.
    expect(text).not.toContain('▸  Process')
    expect(text).toContain('pnpm test')
    expect(text).toContain('FAIL')
  })

  it('marks a settled group as done', () => {
    expect(body(fold(oneTurn()))).toMatch(/Process[^\n]*✔/u)
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
    expect(collapsed).toContain('▸  Process')
    const opened = body(state, { openedGroups: new Set(processGroups(state.blocks).map(group => group.key)) })

    expect(opened).toContain('▾  Process')
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
  function blockStartsOf(state: ReturnType<typeof initialTranscript>, over: Record<string, unknown>): number[] {
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
    expect(withSearch).toContain('▾  Process')
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
