import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { applyEvent, initialTranscript, processGroups, renderView } from './event-views.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import type { TranscriptState } from './transcript-types.ts'

const ev = (type: string, data: unknown, time: number) => ({ type, data, time, seq: time }) as SessionEvent
function transcript(steps = 1, failed = false): TranscriptState {
  let state = applyEvent(initialTranscript(), ev('turn/start', { turn: 1 }, 1000))
  for (let i = 0; i < steps; i++) {
    state = applyEvent(state, ev('assistant/message', { turn: 1, step: i, message: { role: 'assistant', content: [{ type: 'reasoning', text: `Thought ${i}` }, { type: 'text', text: `Progress ${i}` }] } }, 2000 + i))
    state = applyEvent(state, ev('tool/call', { turn: 1, callId: `c${i}`, name: 'bash', arguments: '{"command":"pwd"}' }, 3000 + i))
    state = applyEvent(state, ev('tool/result', { message: { role: 'tool', toolCallId: `c${i}`, isError: failed, content: [{ type: 'text', text: failed ? 'Permission denied' : 'workspace' }] } }, 4000 + i))
  }
  state = applyEvent(state, ev('assistant/message', { turn: 1, step: 99, message: { role: 'assistant', content: [{ type: 'reasoning', text: 'Final reasoning' }, { type: 'text', text: 'Answer one.\n\nAnswer two.' }] } }, 16000))
  return applyEvent(state, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 17000))
}
const view = (state: TranscriptState, open = false, width = 80, colors = false) => renderView(state, {
  width, height: 200, colors, model: 'm', input: '', inputCursor: 0,
  ...(open ? { openedGroups: new Set(processGroups(state.blocks).map(group => group.key)) } : {}),
}).lines

describe('completed turn summary', () => {
  it('shows the duration, expansion hint, and complete final answer', () => {
    const screen = view(transcript(50)).join('\n')
    expect(screen.match(/▸ Worked/gu)).toHaveLength(1)
    expect(screen).toContain('Worked for 16s')
    expect(screen).toContain('Ctrl+O to expand')
    expect(screen).toContain('Answer one.')
    expect(screen).toContain('Answer two.')
    expect(screen).not.toContain('Progress')
    expect(screen).not.toContain('Thought')
    expect(screen).not.toContain('Final reasoning')
  })
  it('opens all process content in order, with the final answer exactly once', () => {
    const screen = view(transcript(2), true).map(stripAnsi).join('\n')
    const parts = ['Thought 0', 'Progress 0', '$ pwd', 'Thought 1', 'Progress 1', 'Final reasoning', 'Answer one.', 'Answer two.']
    let at = -1
    for (const part of parts) {
      const next = screen.indexOf(part, at + 1)
      expect(next).toBeGreaterThan(at)
      at = next
    }
    expect(screen.match(/Answer one\./gu)).toHaveLength(1)
    expect(screen).not.toContain('Worked')
    expect(screen).not.toContain('to expand')
    expect(screen).not.toMatch(/[╭╰]─.*bash/u)
  })
  it('keeps failure facts outside the fold', () => {
    const screen = view(transcript(1, true)).map(stripAnsi).join('\n')
    expect(screen).toContain('1 failed')
    expect(screen).toContain('Permission denied')
    expect(screen).toContain('Answer two.')
  })
  it.each([false, true])('fits summary rows at narrow widths (colors=%s)', colors => {
    for (const width of [12, 20, 40, 80]) {
      expect(view(transcript(1, true), false, width, colors).every(row => visibleWidth(row) <= width)).toBe(true)
    }
  })
  it.each([false, true])('prioritizes duration and failures over the hint at narrow widths (colors=%s)', colors => {
    const narrow = view(transcript(1, true), false, 32, colors).map(stripAnsi).join('\n')
    expect(narrow).toContain('Worked for 16s · 1 failed')
    expect(narrow).not.toContain('to expand')
    expect(view(transcript(), false, 40, colors).map(stripAnsi).join('\n')).toContain('Worked for 16s · Ctrl+O to expand')
  })
  it('refreshes the cached hint when the shortcut is rebound or disabled', () => {
    const state = transcript()
    const options = { width: 80, height: 60, colors: false, model: 'm', input: '', inputCursor: 0 }
    expect(renderView(state, options).lines.join('\n')).toContain('Ctrl+O to expand')
    const rebound = renderView(state, { ...options, turnDetailsKey: 'Alt+D' }).lines.join('\n')
    expect(rebound).toContain('Alt+D to expand')
    expect(rebound).not.toContain('Ctrl+O to expand')
    expect(renderView(state, { ...options, turnDetailsKey: 'Disabled' }).lines.join('\n')).not.toContain('to expand')
  })
  it('does not invent a duration for an older log without timing events', () => {
    const state = transcript()
    const screen = view({ ...state, turnSpans: undefined }).map(stripAnsi).join('\n')
    expect(screen).toContain('▸ Worked')
    expect(screen).not.toContain('Worked for')
  })
})
