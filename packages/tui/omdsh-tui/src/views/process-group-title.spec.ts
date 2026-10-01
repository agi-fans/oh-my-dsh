/**
 * Process-group presentation contract.
 *
 * A run is everything between two replies — the thoughts and the calls — and
 * it folds to one row: how long the turn took, a sentence about what happened,
 * and how many calls it made. Open, it is one list of `label · subject` rows in
 * the order they happened, thinking included. A thought used to close the run
 * before it, which split a fifty-step turn into fifty runs and folded nothing;
 * this pins the shape that replaced it.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { applyEvent, applyStreamChunk, initialTranscript, processGroups, renderView } from './event-views.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import { createTheme } from '../chrome/theme.ts'
import { foldPolicy } from '../session/fold-policy.ts'
import type { ProcessGroup } from './transcript-render.ts'

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

const answer = (text: string, seq: number, reasoning?: string): SessionEvent =>
  ev('assistant/message', {
    turn: 1, step: seq, message: {
      role: 'assistant',
      content: [...(reasoning === undefined ? [] : [{ type: 'reasoning', text: reasoning }]), { type: 'text', text }],
    },
  }, seq)

const failed = (id: string, text: string, seq: number): SessionEvent =>
  ev('tool/result', {
    message: {
      role: 'tool', toolCallId: id, isError: true,
      content: [{ type: 'text', text }], error: { name: 'ExitCode', code: '1', message: text },
    },
  }, seq)

function frame(events: readonly SessionEvent[], width = 72, density: 'compact' | 'standard' = 'standard', colors = false) {
  const state = events.reduce(applyEvent, initialTranscript())
  return renderView(state, {
    width, height: 60, model: 'm', input: '', inputCursor: 0, colors, ...(colors ? { trueColor: true } : {}),
    fold: foldPolicy(density),
  }).lines
}

const text = (events: readonly SessionEvent[], width = 72, density: 'compact' | 'standard' = 'standard'): string =>
  frame(events, width, density).map(stripAnsi).join('\n')

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

function blocks(): ProcessGroup[] {
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

  it('takes the thinking into the run, so the turn folds as one', () => {
    const groups = blocks()
    expect(groups).toHaveLength(1)
    // The thought opens the run rather than closing the one before it; only
    // the answer ends it.
    expect(groups[0]?.start).toBe(1)
    expect(groups[0]?.answer ?? groups[0]?.until).toBe(5)
    expect(view()).not.toContain('First I read the specs')
    expect(view()).toContain('done')
  })

  it('folds a fifty-step turn to one row, not one per step', () => {
    const events: SessionEvent[] = [
      ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] }, 1),
    ]
    for (let step = 0; step < 50; step += 1) {
      const seq = 10 + step * 3
      events.push(thought(`Step ${step} looks at the next file.`, seq), call(`c${step}`, 'read', { path: `f${step}` }, seq + 1), ok(`c${step}`, 'x', seq + 2))
    }
    events.push(answer('done', 999))
    const rows = text(events).split('\n').filter(line => /^[▸▾∴]/u.test(line))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('50 calls')
  })

  it('counts one call alone out, since one row is not repetition', () => {
    let state = initialTranscript()
    for (const event of [call('c1', 'read', { path: 'a' }, 1), ok('c1', 'a', 2), answer('done', 3)]) {
      state = applyEvent(state, event)
    }
    expect(processGroups(state.blocks)).toHaveLength(0)
  })

  it('takes the thought of the step that answered, and leaves the answer out', () => {
    // The final step carries its reasoning and its reply in one message. The
    // reasoning is the run's last row; the reply is not part of the run.
    const events = [
      ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] }, 1),
      call('c1', 'read', { path: 'a' }, 2),
      ok('c1', 'a', 3),
      answer('The answer is here.', 4, 'Now I can answer the question.'),
    ]
    const state = events.reduce(applyEvent, initialTranscript())
    const groups = processGroups(state.blocks)

    expect(groups).toHaveLength(1)
    expect(groups[0]?.answer).toBe(2)
    expect(groups[0]?.tookThought).toBe(true)
    const folded = text(events)
    expect(folded).not.toContain('Now I can answer')
    expect(folded).toContain('The answer is here.')
    const opened = stripAnsi(renderView(state, {
      width: 72, height: 40, model: 'm', input: '', inputCursor: 0, colors: false,
      fold: foldPolicy('standard'), openedGroups: new Set(groups.map(group => group.key)),
    }).lines.join('\n'))
    // Open, the thought is the run's last row and still is not painted twice.
    expect(opened).toMatch(/^ {2}∴ Thought · Now I can answer the question\./mu)
    expect(opened.match(/Now I can answer/gu)).toHaveLength(1)
    // The answer is below the run and only there. The run took the step's
    // thought, not its words; painting both put the last reply of a turn on
    // screen twice, once in the run and once under it.
    expect(opened.match(/The answer is here\./gu)).toHaveLength(1)
    const lines = opened.split('\n')
    expect(lines.findIndex(line => line.includes('The answer is here.')))
      .toBeGreaterThan(lines.findIndex(line => line.includes('Now I can answer')))
  })

  it('leaves a thought that answered alone on its own row', () => {
    const events = [
      ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }, 1),
      answer('Hello.', 2, 'A greeting.'),
    ]
    const shown = text(events)

    expect(shown).toMatch(/^∴ Thought · A greeting\./mu)
    expect(shown).toContain('Hello.')
  })
})

describe('a finished turn says how long it took', () => {
  const timed = (end: number): SessionEvent[] => [
    ev('turn/start', { turn: 1 }, 0),
    ...TURN,
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, end),
  ]

  it('leads the folded row with the turn\'s length', () => {
    const header = text(timed(816_000)).split('\n').find(line => line.startsWith('▸')) ?? ''

    expect(header).toContain('Worked for 13m 36s · Read files and searched the code · 3 calls')
  })

  it('keeps the length and the count at the quietest rung', () => {
    const header = text(timed(42_000), 72, 'compact').split('\n').find(line => line.startsWith('▸')) ?? ''

    expect(header.trimEnd()).toBe('▸ Worked for 42s · 3 calls')
  })

  it('says nothing about time while the turn is still open', () => {
    const header = text([ev('turn/start', { turn: 1 }, 0), ...TURN]).split('\n')
      .find(line => line.startsWith('▸')) ?? ''

    expect(header).not.toContain('Worked for')
  })
})

describe('a live turn is its rows, not a group', () => {
  // The reference client groups a turn only once it ends. While it runs, the
  // thoughts, calls, and replies stream in order with nothing folded, so a
  // reply the model writes on the way is read where it lands.
  const live = (steps: number): SessionEvent[] => {
    const events: SessionEvent[] = [
      ev('turn/start', { turn: 1 }, 0),
      ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] }, 1),
    ]
    for (let step = 0; step < steps; step += 1) {
      const seq = 10 + step * 2
      events.push(call(`c${step}`, 'read', { path: `file-${step}.ts` }, seq), ok(`c${step}`, 'x', seq + 1))
    }
    return events
  }

  it('has no header while the turn runs', () => {
    const shown = text(live(3))

    expect(shown).not.toMatch(/^[▸▾]/mu)
    expect(shown).not.toContain('Working')
    expect(shown).toMatch(/^• Read file · file-0\.ts/mu)
  })

  it('shows every row, with nothing counted away', () => {
    const shown = text(live(12))

    expect(shown).not.toContain('earlier')
    expect(shown.split('\n').filter(line => line.includes('Read file ·'))).toHaveLength(12)
  })

  it('shows a mid-turn reply as prose on the content column', () => {
    const shown = text([
      ...live(2),
      answer('I will look at the manifests next.', 20),
      call('m1', 'read', { path: 'package.json' }, 21), ok('m1', 'x', 22),
    ])

    expect(shown).toMatch(/^ {2}I will look at the manifests next\./mu)
    expect(shown).toContain('Read file · package.json')
  })

  it('shows a reply that is still streaming once', () => {
    let state = live(2).reduce(applyEvent, initialTranscript())
    state = applyStreamChunk(state, { turn: 1, step: 9, chunk: { type: 'reasoning-delta', index: 0, text: 'Also mention the keys.\n\nThen stop.' } })
    state = applyStreamChunk(state, { turn: 1, step: 9, chunk: { type: 'text-delta', index: 0, text: 'Three directions are done.' } })
    const shown = stripAnsi(renderView(state, {
      width: 72, height: 60, model: 'm', input: '', inputCursor: 0, colors: false, fold: foldPolicy('standard'),
    }).lines.join('\n'))

    expect(shown.match(/Three directions are done\./gu)).toHaveLength(1)
    expect(shown).toMatch(/^ {2}Three directions are done\./mu)
    expect(shown).toContain('∴ Thought · Also mention the keys.')
  })

  it('shows the turn\'s last reply once before the turn ends', () => {
    const shown = text([...live(2), answer('Here is the final word.', 30, 'Time to wrap up.')])

    expect(shown).toContain('∴ Thought · Time to wrap up.')
    expect(shown.match(/Here is the final word\./gu)).toHaveLength(1)
  })

  it('becomes one folded row once the turn ends, with its last reply outside', () => {
    const shown = text([
      ...live(2),
      answer('I will look at the manifests next.', 20),
      call('m1', 'read', { path: 'package.json' }, 21), ok('m1', 'x', 22),
      answer('Here is the final word.', 30),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 40),
    ])

    expect(shown).toMatch(/^▸ Worked for 0s · Read files · 3 calls/mu)
    expect(shown).not.toContain('Read file ·')
    expect(shown).not.toContain('I will look at the manifests next.')
    expect(shown.match(/Here is the final word\./gu)).toHaveLength(1)
  })
})

const open = view({ openedGroups: new Set(blocks().map(group => group.key)) }, 'standard')

describe('an open run is one list', () => {

  it('lists every row in the order it happened, thinking included', () => {
    const rows = open.split('\n').filter(line => /^ {2}[∴•✘]/u.test(line))
    expect(rows.map(row => row.trimEnd())).toEqual([
      '  ∴ Thought · First I read the specs, then the lockfile.',
      '  • Read file · a.spec.ts',
      '  • Read file · b.spec.ts',
      '  • Search code · toolArgSubject in packages',
    ])
  })

  it('leaves no blank row inside the run', () => {
    const lines = open.split('\n')
    const header = lines.findIndex(line => line.startsWith('▾'))
    expect(lines[header + 1]?.trim()).not.toBe('')
  })

  it('names a search by what it looked for and where', () => {
    // The scope is the same for every search in a run, so a row that led with
    // it said nothing a reader could not already guess.
    expect(open).toContain('toolArgSubject in packages')
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
      ok('c1', 'a', 5),
      ok('c2', 'b', 6),
    ]) state = applyEvent(state, event)
    for (const width of [24, 30, 40]) {
      const text = renderView(state, {
        width, height: 40, model: 'm', input: '', inputCursor: 0, colors: false,
        fold: foldPolicy('standard'),
      }).lines.map(stripAnsi).join('\n')
      const header = text.split('\n').find(line => /^[▸▾]/u.test(line)) ?? ''
      expect(header, `no header at width ${width}`).toContain('3 calls')
      expect(header, `no failure mark at width ${width}`).toContain('✘')
    }
  })

  it('fills the terminal width on every row it owns', () => {
    for (const line of open.split('\n')) {
      if (line.startsWith('  ') || line.startsWith('▸') || line.startsWith('▾')) {
        expect(visibleWidth(line)).toBe(72)
      }
    }
  })
})

describe('the gutter carries states, not confirmations', () => {
  it('gives a settled successful call a quiet bullet, not a checkmark', () => {
    // Five checkmarks in a column said "the row exists", which it always did.
    // A bullet only holds the column, so a call's label does not read as the
    // tail of the thought above it.
    const row = open.split('\n').find(line => line.includes('a.spec.ts'))
    expect(row).toBeDefined()
    expect(row).toContain('•')
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
    const header = text.split('\n').find(line => line.startsWith('▸')) ?? ''

    expect(header).toContain('✘')
  })

  it('keeps a run with a failure folded and shows only the row that failed', () => {
    // Forcing the whole run open for one failed grep undid the fold for the
    // most common failure there is.
    const shown = text([
      call('c1', 'read', { path: 'a' }, 1),
      ok('c1', 'a', 2),
      call('c2', 'bash', { command: 'pnpm test' }, 3),
      failed('c2', 'FAIL src/x.spec.ts', 4),
      call('c3', 'read', { path: 'b' }, 5),
      ok('c3', 'b', 6),
    ])
    const lines = shown.split('\n')
    const header = lines.findIndex(line => line.startsWith('▸'))

    expect(header).toBeGreaterThanOrEqual(0)
    // The failure reads as the end of the row's sentence, not a column pinned to the right edge.
    expect(lines[header + 1]).toMatch(/^ {2}✘ Run command · pnpm test · FAIL src\/x\.spec\.ts/u)
    expect(shown).not.toContain('Read file · a')
  })

  it('marks the model thinking with a mark that is not a status sign', () => {
    // A settled call carries no mark, so the thinking mark no longer has to
    // share a column with a column of confirmations. It is a deduction sign,
    // which collides with nothing else this TUI paints.
    const row = open.split('\n').find(line => line.includes('First I read')) ?? ''

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
    const header = frame.lines.find(line => stripAnsi(line).startsWith('▸')) ?? ''

    // The dim run has to close before the error colour opens. Leaving dim open
    // and painting the mark over it looks the same on a true-color terminal and
    // fails silently everywhere a palette maps error onto the dim swatch, which
    // is exactly where a reader most needs the mark to stand out.
    const fgReset = '\u001b[39m'
    expect(header).toContain(`${fgReset}${color.getFgAnsi('error')}✘`)
  })
})
