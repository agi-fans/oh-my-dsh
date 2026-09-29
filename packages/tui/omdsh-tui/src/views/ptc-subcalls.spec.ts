/**
 * PTC sub-call contract.
 *
 * In PTC mode the model writes a program instead of emitting tool calls, so the
 * durable log records the calls that program made as `tool/ptc-dispatch*` under
 * its `run_code` call rather than as `tool/call`. A transcript that only reads
 * `tool/call` shows one row for a round that may have run twenty tools, which is
 * the defect this file exists to prevent.
 */
import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import {
  applyEvent,
  blockLines,
  blockSearchText,
  initialTranscript,
  renderView,
  replayEvents,
} from './event-views.ts'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Block } from './transcript-types.ts'

const ROOT = 'run-1'
const theme = createTheme(false)
const plain = (lines: readonly string[]): string[] => lines.map(stripAnsi)

function ev(type: string, data: unknown, seq: number): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

const start = (subCallId: string, name: string, args: unknown, seq: number): SessionEvent =>
  ev('tool/ptc-dispatch-start', { rootCallId: ROOT, parentCallId: ROOT, subCallId, name, arguments: args }, seq)

const settle = (
  subCallId: string,
  name: string,
  args: unknown,
  seq: number,
  outcome: { isError: boolean; text: string; error?: { name: string; code: string } },
): SessionEvent => ev('tool/ptc-dispatch', {
  rootCallId: ROOT,
  parentCallId: ROOT,
  subCallId,
  name,
  arguments: args,
  isError: outcome.isError,
  content: [{ type: 'text', text: outcome.text }],
  ...(outcome.error === undefined ? {} : { error: outcome.error }),
}, seq)

/** A complete PTC round: the program call, two sub-calls, and the program's own result. */
function ptcRound(): SessionEvent[] {
  return [
    ev('tool/call', { callId: ROOT, name: 'run_code', arguments: JSON.stringify({ code: 'await tools.read(p)' }) }, 1),
    start(`${ROOT}:ptc:1`, 'read', { path: 'package.json' }, 2),
    settle(`${ROOT}:ptc:1`, 'read', { path: 'package.json' }, 3, { isError: false, text: 'ok' }),
    start(`${ROOT}:ptc:2`, 'bash', { command: 'pnpm test' }, 4),
    settle(`${ROOT}:ptc:2`, 'bash', { command: 'pnpm test' }, 5, { isError: false, text: '> pnpm test\n\n all good' }),
    ev('tool/result', { message: { role: 'tool', toolCallId: ROOT, content: [{ type: 'text', text: 'done' }] } }, 6),
  ]
}

function tools(state: { blocks: Block[] }): Extract<Block, { kind: 'tool' }>[] {
  return state.blocks.filter((block): block is Extract<Block, { kind: 'tool' }> => block.kind === 'tool')
}

describe('PTC sub-calls in the transcript', () => {
  it('shows every call the program made, not just the program itself', () => {
    const state = replayEvents(ptcRound())

    expect(tools(state).map(block => block.name)).toEqual(['run_code', 'read', 'bash'])
  })

  it('marks a sub-call with the call it was dispatched from', () => {
    const state = replayEvents(ptcRound())
    const [, read, bash] = tools(state)

    expect(read?.parentCallId).toBe(ROOT)
    expect(bash?.parentCallId).toBe(ROOT)
    expect(tools(state)[0]?.parentCallId).toBeUndefined()
  })

  it('settles a sub-call on its own outcome, independently of the program', () => {
    const state = replayEvents(ptcRound())

    expect(tools(state).map(block => block.status)).toEqual(['ok', 'ok', 'ok'])
    expect(tools(state)[1]?.output).toBe('ok')
  })

  it('reports a failed sub-call as a failure, with the program still succeeding', () => {
    const events = [
      ev('tool/call', { callId: ROOT, name: 'run_code', arguments: '{}' }, 1),
      start(`${ROOT}:ptc:1`, 'bash', { command: 'pnpm test' }, 2),
      settle(`${ROOT}:ptc:1`, 'bash', { command: 'pnpm test' }, 3, {
        isError: true,
        text: '> pnpm test\n\n FAIL src/x.spec.ts',
        error: { name: 'ToolFailure', code: 'EXIT_1' },
      }),
      ev('tool/result', { message: { role: 'tool', toolCallId: ROOT, content: [{ type: 'text', text: 'done' }] } }, 4),
    ]
    const state = replayEvents(events)

    expect(tools(state).map(block => block.status)).toEqual(['ok', 'error'])
  })

  it('indents a sub-call row so it does not read as something the model asked for', () => {
    const state = replayEvents(ptcRound())
    const read = tools(state)[1]!
    const root = tools(state)[0]!
    const subRow = plain(blockLines(read, theme, 60))[0] ?? ''
    const rootRow = plain(blockLines(root, theme, 60))[0] ?? ''

    expect(subRow.startsWith('  ✔')).toBe(true)
    expect(rootRow.startsWith('✔')).toBe(true)
  })

  it('keeps a sub-call row exactly one terminal line wide', () => {
    const state = replayEvents(ptcRound())

    for (const block of tools(state)) {
      const lines = blockLines(block, theme, 60)
      expect(lines).toHaveLength(1)
      expect(visibleWidth(lines[0]!)).toBe(60)
    }
  })

  it('opens a sub-call with the same whole-output frame a native call gets', () => {
    const state = replayEvents(ptcRound())
    const bash = tools(state)[2]!
    const opened = plain(blockLines(bash, theme, 60, 0, true))

    expect(opened[0]?.startsWith('  ╭───')).toBe(true)
    expect(opened.join('\n')).toContain('all good')
  })

  it('shows a running sub-call as running before it settles', () => {
    let state = initialTranscript()
    state = applyEvent(state, ev('tool/call', { callId: ROOT, name: 'run_code', arguments: '{}' }, 1))
    state = applyEvent(state, start(`${ROOT}:ptc:1`, 'read', { path: 'a.ts' }, 2))

    expect(tools(state).map(block => block.status)).toEqual(['running', 'running'])
    const lines = renderView(state, {
      width: 60, height: 24, model: 'm', input: '', inputCursor: 0, colors: false,
    }).lines
    expect(lines.some(line => line.includes('a.ts'))).toBe(true)
  })

  it('rebuilds the same transcript when the log is replayed after a resume', () => {
    const live = ptcRound().reduce(applyEvent, initialTranscript())
    const resumed = replayEvents(ptcRound())

    expect(tools(resumed).map(block => `${block.name}:${block.status}:${block.output}`))
      .toEqual(tools(live).map(block => `${block.name}:${block.status}:${block.output}`))
    expect(tools(resumed).map(block => block.parentCallId))
      .toEqual(tools(live).map(block => block.parentCallId))
  })

  it('still shows a sub-call whose start fell outside the replayed window', () => {
    // A window can open between a start and its settle. The dispatch event
    // carries the name and arguments, so the call is recoverable; dropping it
    // would leave a hole in a record the session actually kept.
    const events = ptcRound().filter(event => event.seq !== 2)
    const state = replayEvents(events)
    const read = tools(state).find(block => block.name === 'read')

    expect(read).toBeDefined()
    expect(read?.output).toBe('ok')
    expect(read?.parentCallId).toBe(ROOT)
  })

  it('makes sub-call arguments and output searchable like any other call', () => {
    const state = replayEvents(ptcRound())
    const bash = tools(state)[2]!
    const text = blockSearchText(bash)

    expect(text).toContain('pnpm test')
    expect(text).toContain('all good')
  })

  it('leaves a native round untouched', () => {
    const events = [
      ev('tool/call', { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' }, 1),
      ev('tool/result', { message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'a' }] } }, 2),
    ]
    const state = replayEvents(events)

    expect(tools(state)).toHaveLength(1)
    expect(tools(state)[0]?.parentCallId).toBeUndefined()
  })

  it('does not confuse a sub-call id with a native call id', () => {
    const events = [
      ev('tool/call', { callId: ROOT, name: 'run_code', arguments: '{}' }, 1),
      ev('tool/call', { callId: 'c9', name: 'bash', arguments: '{"command":"ls"}' }, 2),
      start(`${ROOT}:ptc:1`, 'read', { path: 'a.ts' }, 3),
      settle(`${ROOT}:ptc:1`, 'read', { path: 'a.ts' }, 4, { isError: false, text: 'ok' }),
    ]
    const state = replayEvents(events)

    expect(tools(state).map(block => `${block.name}:${block.status}`))
      .toEqual(['run_code:running', 'bash:running', 'read:ok'])
    expect(tools(state).map(block => block.callId)).toEqual([ROOT, 'c9', `${ROOT}:ptc:1`])
  })
})

describe('ToolCallId branding', () => {
  it('accepts the ids the harness actually uses', () => {
    expect(ToolCallId(ROOT)).toBe(ROOT)
    expect(ToolCallId(`${ROOT}:ptc:1`)).toBe(`${ROOT}:ptc:1`)
  })
})
