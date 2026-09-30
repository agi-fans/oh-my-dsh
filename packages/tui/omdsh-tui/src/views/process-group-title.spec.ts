/**
 * Process-group presentation contract.
 *
 * A collapsed run used to be one row reading `Process  files, search, commands`
 * and, once open, a flat list repeating the same verb on every line. This pins
 * the three things that replaced it: the title is a sentence about what
 * happened, a thought is not part of the run at all, and an open run is a tree
 * whose rail says which calls belong to it.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { applyEvent, initialTranscript, processGroups, renderView } from './event-views.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import { createTheme } from '../chrome/theme.ts'
import { foldPolicy } from '../session/fold-policy.ts'

function ev(type: string, data: unknown, seq: number): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

const call = (id: string, name: string, args: unknown, seq: number): SessionEvent =>
  ev('tool/call', { callId: id, name, arguments: JSON.stringify(args) }, seq)

const ok = (id: string, text: string, seq: number): SessionEvent =>
  ev('tool/result', { message: { role: 'tool', toolCallId: id, content: [{ type: 'text', text }] } }, seq)

const thought = (text: string, seq: number, streaming = false): SessionEvent =>
  ev('assistant/message', {
    turn: 1, step: seq, ...(streaming ? { partial: true } : {}),
    message: { role: 'assistant', content: [{ type: 'reasoning', text }] },
  }, seq)

const answer = (text: string, seq: number): SessionEvent =>
  ev('assistant/message', {
    turn: 1, step: seq, message: { role: 'assistant', content: [{ type: 'text', text }] },
  }, seq)

const TURN: SessionEvent[] = [
  ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] }, 1),
  thought('First I read the specs, then the lockfile.', 2),
  call('c1', 'read', { path: 'a.spec.ts' }, 3),
  ok('c1', 'a', 4),
  call('c2', 'read', { path: 'b.spec.ts' }, 5),
  ok('c2', 'b', 6),
  call('c3', 'grep', { pattern: 'toolArgSubject', path: 'packages' }, 7),
  ok('c3', '2 hits', 8),
  answer('done', 9),
]

function view(over: Record<string, unknown> = {}, density: 'compact' | 'standard' | 'detailed' = 'standard'): string {
  let state = initialTranscript()
  for (const event of TURN) state = applyEvent(state, event)
  return renderView(state, {
    width: 72, height: 40, model: 'm', input: '', inputCursor: 0, colors: false,
    fold: foldPolicy(density), ...over,
  }).lines.map(stripAnsi).join('\n')
}

function blocks(): ReturnType<typeof processGroups> {
  let state = initialTranscript()
  for (const event of TURN) state = applyEvent(state, event)
  return processGroups(state.blocks)
}

describe('a run is a sentence, not a list of family names', () => {
  it('names the work in the order it happened', () => {
    expect(view()).toContain('Read files and searched the code')
  })

  it('lowercases every phrase after the first', () => {
    // Capitalizing both makes the title read as two claims instead of one.
    expect(view()).toMatch(/Read files and searched the code/u)
    expect(view()).not.toMatch(/and Searched/u)
  })

  it('carries one total and not a count per category', () => {
    expect(view()).toMatch(/· 3 calls/u)
    expect(view()).not.toMatch(/Read files · /u)
  })

  it('keeps the run size and the failure mark at the quietest rung too', () => {
    // The quiet rung drops the sentence and keeps the two facts a collapsed
    // run has to say: how much there was, and whether any of it broke. Dropping
    // either leaves a row that says nothing happened.
    const quiet = view({}, 'compact')
    const header = quiet.split('\n').find(line => line.startsWith('▸')) ?? ''
    expect(header).toContain('3 calls')
    expect(header).not.toContain('Read files')
  })

  it('keeps the run intact and the thought out of it', () => {
    const groups = blocks()
    expect(groups).toHaveLength(1)
    // The thought is its own row. It closes the run before it and renders
    // itself, so a whole turn's reasoning is never summarized away.
    expect(groups[0]?.start).toBe(2)
    expect(groups[0]?.end).toBe(5)
    expect(view()).toContain('First I read the specs')
  })

  it('counts a run of one call out, and a run of no calls with it', () => {
    let state = initialTranscript()
    for (const event of [call('c1', 'read', { path: 'a' }, 1), ok('c1', 'a', 2), thought('thinking', 3)]) {
      state = applyEvent(state, event)
    }
    // One call is not repetition, and a thought is not a category of work, so
    // neither of them earns a summary row.
    expect(processGroups(state.blocks)).toHaveLength(0)
  })
})

const open = view({ openedGroups: new Set(blocks().map(group => group.key)) }, 'standard')

describe('an open run is a tree', () => {

  it('hangs its calls off a rail that names the run', () => {
    expect(open).toMatch(/│ Read files · 2/u)
    expect(open).toMatch(/│ [├└] +read +a\.spec\.ts/u)
    expect(open).toMatch(/│ [├└] +read +b\.spec\.ts/u)
  })

  it('names a search by what it looked for and where', () => {
    // The scope is the same for every search in a run, so a row that led with
    // it said nothing a reader could not already guess.
    expect(open).toContain('toolArgSubject in packages')
  })

  it('says the category once rather than repeating it per call', () => {
    expect(open.match(/Read files · 2/gu)).toHaveLength(1)
  })

  it('keeps the count and the failure mark when the width is gone', () => {
    // A row that is exactly the terminal width proves nothing about what is on
    // it: the padding pass will trim an overflowing row back to width and lose
    // the tail silently. These are the two facts a narrow reader still needs.
    let state = initialTranscript()
    for (const event of [
      call('c1', 'read', { path: 'a' }, 1),
      call('c2', 'read', { path: 'b' }, 2),
      call('c3', 'bash', { command: 'pnpm test' }, 3),
      ev('tool/result', {
        message: {
          role: 'tool', toolCallId: 'c3', isError: true,
          content: [{ type: 'text', text: 'FAIL' }], error: { name: 'ExitCode', code: '1', message: 'FAIL' },
        },
      }, 4),
    ]) state = applyEvent(state, event)
    for (const width of [24, 30, 40]) {
      const text = renderView(state, {
        width, height: 40, model: 'm', input: '', inputCursor: 0, colors: false,
        fold: foldPolicy('standard'),
      }).lines.map(stripAnsi).join('\n')
      const header = text.split('\n').find(line => line.startsWith('▾')) ?? ''
      expect(header, `no header at width ${width}`).toContain('3 calls')
      expect(header, `no failure mark at width ${width}`).toContain('✘')
    }
  })

  it('fills the terminal width on every row it owns', () => {
    for (const line of open.split('\n')) {
      if (line.startsWith('│') || line.startsWith('▸') || line.startsWith('▾')) {
        expect(visibleWidth(line)).toBe(72)
      }
    }
  })
})

describe('the gutter carries states, not confirmations', () => {
  it('leaves a settled successful call unmarked', () => {
    // Five checkmarks in a column said "the row exists", which it always did.
    const row = open.split('\n').find(line => line.includes('a.spec.ts'))
    expect(row).toBeDefined()
    expect(row).not.toContain('✔')
  })

  it('states the failure on the header, not only on the row it replaces', () => {
    // The row carries its own mark, so a test that looks for any `✘` on screen
    // passes even with the header tail removed. The header is the only place
    // the failure is visible without opening the run.
    let state = initialTranscript()
    for (const event of [
      call('c1', 'read', { path: 'a' }, 1),
      call('c2', 'bash', { command: 'pnpm test' }, 2),
      ev('tool/result', {
        message: {
          role: 'tool', toolCallId: 'c2', isError: true,
          content: [{ type: 'text', text: 'FAIL' }], error: { name: 'ExitCode', code: '1', message: 'FAIL' },
        },
      }, 3),
      ok('c1', 'a', 4),
    ]) state = applyEvent(state, event)
    const text = renderView(state, {
      width: 72, height: 40, model: 'm', input: '', inputCursor: 0, colors: false,
      fold: foldPolicy('standard'),
    }).lines.map(stripAnsi).join('\n')
    const header = text.split('\n').find(line => line.startsWith('▾')) ?? ''

    expect(header).toContain('✘')
  })

  it('marks the model thinking with a mark that is not a status sign', () => {
    // A settled call carries no mark, so the thinking mark no longer has to
    // share a column with a column of confirmations. It is a deduction sign,
    // which collides with nothing else this TUI paints.
    const row = view().split('\n').find(line => line.includes('First I read')) ?? ''

    expect(row).toContain('∴')
    expect(row).not.toContain('⋆')
  })

  it('still marks a failure, because that is the row worth stopping on', () => {
    let state = initialTranscript()
    for (const event of [
      call('c1', 'read', { path: 'a' }, 1),
      call('c2', 'bash', { command: 'pnpm test' }, 2),
      ev('tool/result', {
        message: {
          role: 'tool', toolCallId: 'c2', isError: true,
          content: [{ type: 'text', text: 'FAIL' }], error: { name: 'ExitCode', code: '1', message: 'FAIL' },
        },
      }, 3),
      ok('c1', 'a', 4),
    ]) state = applyEvent(state, event)
    const text = renderView(state, {
      width: 72, height: 40, model: 'm', input: '', inputCursor: 0, colors: false,
      fold: foldPolicy('standard'),
    }).lines.map(stripAnsi).join('\n')

    expect(text).toContain('✘')
  })
})

describe('a folded run is background', () => {
  it('dims the whole header so the answer under it wins on weight', () => {
    // Only the disclosure mark used to be dim, so the sentence describing the
    // run carried the same weight as the model's answer one row below it. The
    // reader had to read both rows to learn which one was the reply.
    const color = createTheme(true, true)
    const frame = renderView(
      TURN.reduce(applyEvent, initialTranscript()),
      {
        width: 72, height: 40, model: 'm', input: '', inputCursor: 0,
        colors: true, trueColor: true, fold: foldPolicy('standard'),
      },
    )
    const header = frame.lines.find(line => stripAnsi(line).startsWith('▸')) ?? ''

    expect(header).toContain(color.getFgAnsi('dim'))
    expect(stripAnsi(header)).toContain('Read files and searched the code')
  })

  it('keeps a failure out of the dim span, because that still has to shout', () => {
    const color = createTheme(true, true)
    let state = initialTranscript()
    for (const event of [
      call('c1', 'read', { path: 'a' }, 1),
      call('c2', 'bash', { command: 'pnpm test' }, 2),
      ev('tool/result', {
        message: {
          role: 'tool', toolCallId: 'c2', isError: true,
          content: [{ type: 'text', text: 'FAIL' }], error: { name: 'ExitCode', code: '1', message: 'FAIL' },
        },
      }, 3),
      ok('c1', 'a', 4),
    ]) state = applyEvent(state, event)
    const frame = renderView(state, {
      width: 72, height: 40, model: 'm', input: '', inputCursor: 0,
      colors: true, trueColor: true, fold: foldPolicy('standard'),
    })
    // A run with a failure is never folded, so the header here is the open one.
    const header = frame.lines.find(line => stripAnsi(line).startsWith('▾')) ?? ''

    // The dim run has to close before the error colour opens. Leaving dim open
    // and painting the mark over it looks the same on a true-color terminal and
    // fails silently everywhere a palette maps error onto the dim swatch, which
    // is exactly where a reader most needs the mark to stand out.
    const fgReset = '\u001b[39m'
    expect(header).toContain(`${fgReset}${color.getFgAnsi('error')}✘`)
  })
})
