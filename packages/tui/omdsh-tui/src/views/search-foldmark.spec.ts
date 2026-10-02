/**
 * Search-driven folding contract, through the real render path.
 *
 * A search that matches inside the thought a run took opens that thought, which
 * changes how many rows the run occupies. The host compares `foldShape` between
 * frames and tells the renderer when rows reshaped, so a shape that does not
 * record this leaves the frozen boundary stale — the next growth then either
 * replays rows history already holds or skips rows the reader has never seen.
 *
 * These tests drive `renderView` and the notification comparison the provider
 * performs, with a scrolling terminal for the screen and the history.
 */
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { applyEvent, initialTranscript, renderView } from './event-views.ts'
import { foldPolicy } from '../session/fold-policy.ts'
import { processGroups } from './transcript-render.ts'
import { stripAnsi } from '../chrome/width.ts'
import type { TranscriptState } from './transcript-types.ts'

const FOLD = foldPolicy('standard')

/** A run the reader keeps open, whose answering step has a long thought. */
function transcript(): TranscriptState {
  const blocks = [
    { kind: 'user', text: 'go' },
    { kind: 'tool', callId: 'a', name: 'read', args: '{"path":"a"}', status: 'ok', output: 'x', turn: 1 },
    { kind: 'tool', callId: 'b', name: 'read', args: '{"path":"b"}', status: 'ok', output: 'x', turn: 1 },
    {
      kind: 'assistant', turn: 1, step: 2,
      text: Array.from({ length: 12 }, (_, i) => `answer shared ${i}`).join('\n\n'),
      reasoning: Array.from({ length: 12 }, (_, i) => `lockfile shared ${i}`).join('\n\n'),
    },
  ] as TranscriptState['blocks']
  return { ...initialTranscript(), blocks, turn: 1, status: 'idle' }
}

const runKey = (state: TranscriptState): string => processGroups(state.blocks)[0]!.key

interface Rendered {
  screen: string
  lines: readonly string[]
  bodyRow: number
  /** Navigation offset and drawn start of the answer, both body-relative. */
  offsets: { navigation: number | undefined; drawn: number | undefined }
  foldShape: string | undefined
  /** Frame rows the thought mark and the drawn thought actually sit on. */
  markRows: { thought: number | undefined }
  rows: { thought: number | undefined }
}

function view(
  state: TranscriptState,
  search?: { query: string; matches: number[]; focus: number },
  over: Record<string, unknown> = {},
): Rendered {
  const frame = renderView(state, {
    width: 74, height: 90, model: 'm', input: '', inputCursor: 0, colors: false,
    fold: FOLD, openedGroups: new Set([runKey(state)]), ...over,
    ...(search === undefined ? {} : { transcriptSearch: { ...search, editing: true } }),
  })
  const rows = frame.lines.map(stripAnsi)
  const bodyRow = frame.transcript?.bodyRow ?? 0
  const thoughtMark = frame.transcript?.foldMarks
    ?.find(mark => mark.key.startsWith('thought:'))
  const drawnThought = rows.findIndex(row => row.includes('lockfile shared 0'))
  const answerAt = state.blocks.findIndex(block => block.kind === 'assistant')
  return {
    screen: rows.join('\n'),
    lines: rows,
    bodyRow,
    offsets: {
      navigation: frame.transcript?.blockStarts[answerAt],
      drawn: frame.transcript?.blockDrawStarts?.[answerAt],
    },
    foldShape: frame.transcript?.foldShape,
    // foldMarks rows are transcript-body rows, the same space blockStarts uses;
    // bodyRow is where the frame places that body. Keep the two apart.
    markRows: { thought: thoughtMark?.row },
    rows: { thought: drawnThought < 0 ? undefined : bodyRow + drawnThought },
  }
}

const match = (text: string): number[] => [3]

describe('a search that opens a thought the run took', () => {
  it('changes the shape so the host is told rows moved', () => {
    const state = transcript()

    // No search: the run is open but the thought is folded to one line.
    const before = view(state)
    // A query in the answer: the run is open, the thought is still folded.
    const answerQuery = view(state, { query: 'answer shared 3', matches: match('x'), focus: 3 })
    // A query only inside the thought: the thought has to lay out in full.
    const thoughtQuery = view(state, { query: 'lockfile shared 9', matches: match('x'), focus: 3 })

    // The body query and no query agree, because neither opens the thought.
    expect(answerQuery.foldShape).toBe(before.foldShape)
    // The thought query differs: its rows are now on screen.
    expect(thoughtQuery.foldShape).not.toBe(before.foldShape)
  })

  it('puts the thought on screen for a hit that the preview would have cut', () => {
    const state = transcript()
    // The preview carries the first sentence; this hit is past it.
    const preview = view(state, { query: 'lockfile shared 9', matches: match('x'), focus: 3 })

    expect(preview.screen).toContain('lockfile shared 9')
  })

  it('reports the thought\'s own row, not the reply below it', () => {
    const state = transcript()
    const withSearch = view(state, { query: 'lockfile shared 9', matches: match('x'), focus: 3 })
    const rows = withSearch.screen.split('\n')
    const thought = rows.findIndex(row => row.includes('lockfile shared 0'))
    const answer = rows.findIndex(row => row.includes('answer shared 0'))

    // The thought is the run's last row; the answer is the reply below it.
    expect(thought).toBeGreaterThan(-1)
    expect(answer).toBeGreaterThan(thought)
  })

  it('opens the thought when one word matches both it and the answer', () => {
    // One word in both the thought and the reply. `thoughtHit` deliberately
    // excludes such a query, so it cannot stand in for the effective opened
    // set when generating marks — and the mark's row must still be the
    // thought's, not the reply's.
    const state = transcript()
    const both = view(state, { query: 'shared 3', matches: match('x'), focus: 3 })

    expect(both.screen).toContain('lockfile shared 0')
    expect(both.screen).toContain('answer shared 0')
    // The mark reports the row the thought is drawn on, in the same coordinate
    // space the other transcript offsets use — the body, plus where the frame
    // placed the body. It is not the reply's row, which is what the navigation
    // offset points at for a query that matches both.
    // Compared against the line the thought was actually drawn on, in the same
    // coordinate space: the drawn body row plus where the frame placed it.
    // The mark reports the thought's own row — the `∴ Thought` label the run
    // paints above the opened text — not the reply below it, which is where a
    // query matching both would navigate to.
    const label = both.lines.findIndex(line => line.includes('lockfile shared 0'))
    expect(label).toBeGreaterThan(-1)
    expect(both.markRows.thought).toBe(label - both.bodyRow)
  })

  it('keeps the answer\'s drawn start apart from where a search aims it', () => {
    // A thought-only hit aims the reader at the thought, one row above the
    // words. That navigation offset must not become the answer's drawn start:
    // the boundary mapper infers a block's span from its neighbours, so a start
    // that jumped backwards would make the span read as longer and freeze from
    // the wrong place.
    const state = transcript()
    const hit = view(state, { query: 'lockfile shared 9', matches: [3], focus: 3 })

    expect(hit.offsets.drawn).toBeDefined()
    expect(hit.offsets.navigation).toBeDefined()
    // The navigation offset moved up onto the thought; the drawn start did not.
    expect(hit.offsets.navigation).toBeLessThan(hit.offsets.drawn!)
    // And without a search the two agree, which is what makes the difference
    // attributable to the search rather than to the layout.
    const plain = view(state)
    expect(plain.offsets.navigation).toBe(plain.offsets.drawn)
  })

  it('reports the thought\'s own row when the host opened it, with no search', () => {
    // No query at all: the run is open and the host opened the thought itself.
    // The mark must still point at the row the thought was drawn on — the draw
    // anchor is independent of why the thought is open.
    const state = transcript()
    const rendered = view(state, undefined, { expandedReasoning: new Set(['1:2']) })
    const label = rendered.lines.findIndex(line => line.includes('lockfile shared 0'))

    expect(label).toBeGreaterThan(-1)
    expect(rendered.markRows.thought).toBe(label - rendered.bodyRow)
    // With no search there is nothing to aim away from the words, so the
    // navigation offset and the drawn start are the same row — and that row is
    // the answer's own first line. The separation is a search's doing, not a
    // property of a host-opened thought.
    expect(rendered.offsets.navigation).toBeDefined()
    expect(rendered.offsets.drawn).toBeDefined()
    expect(rendered.offsets.navigation).toBe(rendered.offsets.drawn)
    const words = rendered.lines.findIndex(line => line.includes('answer shared 0'))
    expect(words).toBeGreaterThan(-1)
    expect(rendered.offsets.drawn).toBe(words - rendered.bodyRow)
  })

  it('leaves the host\'s own opened set alone', () => {
    const state = transcript()
    // The host holds a run key and a thought of its own — a *different* thought
    // from the one the search reaches for. Re-adding a key the host already
    // holds would leave the set unchanged whether or not it was written to, so
    // the assertion would hold either way.
    const opened = new Set([runKey(state)])
    const expanded = new Set(['9:9'])
    renderView(state, {
      width: 74, height: 20, model: 'm', input: '', inputCursor: 0, colors: false,
      fold: FOLD, openedGroups: opened, expandedReasoning: expanded,
      transcriptSearch: { query: 'lockfile shared 9', matches: [3], focus: 3, editing: true },
    })

    expect([...expanded]).toEqual(['9:9'])
    expect(opened.has(runKey(state))).toBe(true)

    // The search opened the thought for this frame only; the host still holds
    // exactly the run key it passed in.
    expect([...opened]).toEqual([runKey(state)])
  })
})
