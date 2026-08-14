/**
 * Transcript state-machine contract tests: each test feeds a scripted
 * session-log event sequence and asserts the externally observable
 * transcript state and rendered frame — what a terminal shows.
 */
import { describe, expect, it } from 'vitest'
import { applyEvent, initialTranscript, renderView, TOOL_COLLAPSED_LINES, windowTranscript } from './event-views.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createTheme } from './theme.ts'
import { visibleWidth } from './width.ts'

/** Fixture builder: a session event with a sequence number. */
function ev(type: string, data: unknown, seq: number): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

const view = (state: ReturnType<typeof initialTranscript>, input = '') =>
  renderView(state, { width: 60, height: 24, model: 'deepseek-v4-flash', input, inputCursor: input.length, colors: false })

describe('applyEvent', () => {
  it('renders a user prompt and streamed assistant text', () => {
    let state = initialTranscript()
    state = applyEvent(state, ev('turn/start', { turn: 1 }, 1))
    state = applyEvent(state, ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }, 2))
    state = applyEvent(state, ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Hel' } }, 3))
    state = applyEvent(state, ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'lo' } }, 4))
    expect(state.status).toBe('running')
    expect(state.blocks).toEqual([
      { kind: 'user', text: 'hi' },
      { kind: 'assistant', turn: 1, step: 1, text: 'Hello', reasoning: '', streaming: true },
    ])
    const frame = view(state)
    expect(frame.lines.some((line) => line.includes('hi'))).toBe(true)
    expect(frame.lines.some((line) => line.includes('Hello'))).toBe(true)
    expect(frame.lines.some((line) => line.includes('running'))).toBe(true)
    expect(frame.lines.some((line) => line.includes('╭'))).toBe(true)
  })

  it('settles the streaming block on assistant/message', () => {
    let state = initialTranscript()
    state = applyEvent(state, ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'partial' } }, 1))
    state = applyEvent(state, ev('assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'final' }] } }, 2))
    expect(state.blocks).toEqual([
      { kind: 'assistant', turn: 1, step: 1, text: 'final', reasoning: '', streaming: false },
    ])
  })

  it('settles an unterminated stream on turn/end', () => {
    let state = initialTranscript()
    state = applyEvent(state, ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'x' } }, 1))
    state = applyEvent(state, ev('turn/end', { turn: 1, reason: { kind: 'aborted' } }, 2))
    const block = state.blocks[0]
    expect(block?.kind === 'assistant' && block.streaming).toBe(false)
    expect(state.status).toBe('idle')
  })

  it('tracks tool calls to ok and error results', () => {
    let state = initialTranscript()
    state = applyEvent(state, ev('tool/call', { callId: 'call-1', name: 'bash', arguments: '{"command":"ls"}' }, 1))
    state = applyEvent(state, ev('tool/call', { callId: 'call-2', name: 'read', arguments: '{}' }, 2))
    state = applyEvent(state, ev('tool/result', { message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'a b' }] }] } }, 3))
    state = applyEvent(state, ev('tool/result', { message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call-2', isError: true, content: [{ type: 'text', text: 'nope' }] }] } }, 4))
    const tools = state.blocks.filter((block): block is Extract<typeof block, { kind: 'tool' }> => block.kind === 'tool')
    expect(tools.map((block) => block.status)).toEqual(['ok', 'error'])
    expect(tools[0]?.output).toBe('a b')
    const frame = view(state)
    expect(frame.lines.some((line) => line.includes('bash'))).toBe(true)
    expect(frame.lines.some((line) => line.includes('✔'))).toBe(true)
    expect(frame.lines.some((line) => line.includes('✘'))).toBe(true)
    expect(frame.lines.some((line) => line.includes('╭───'))).toBe(true)
  })

  it('collapses long tool output and expands it with toolsExpanded', () => {
    const lines = Array.from({ length: TOOL_COLLAPSED_LINES + 4 }, (_, i) => 'out-' + i)
    let state = initialTranscript()
    state = applyEvent(state, ev('tool/call', { callId: 'call-1', name: 'bash', arguments: '{}' }, 1))
    state = applyEvent(state, ev('tool/result', {
      message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: lines.join('\n') }] }] },
    }, 2))
    const collapsed = renderView(state, {
      width: 60,
      height: 80,
      model: 'm',
      input: '',
      inputCursor: 0,
      colors: false,
    })
    const collapsedText = collapsed.lines.join('\n')
    expect(collapsedText).toContain('out-0')
    expect(collapsedText).toContain('out-' + (TOOL_COLLAPSED_LINES - 1))
    expect(collapsedText).not.toContain('out-' + TOOL_COLLAPSED_LINES)
    expect(collapsedText).toContain('4 more lines (ctrl+o to expand)')
    const expanded = renderView(state, {
      width: 60,
      height: 80,
      model: 'm',
      input: '',
      inputCursor: 0,
      colors: false,
      toolsExpanded: true,
    })
    const expandedText = expanded.lines.join('\n')
    expect(expandedText).toContain('out-' + (TOOL_COLLAPSED_LINES + 3))
    expect(expandedText).not.toContain('ctrl+o to expand')
  })

  it('does not hint ctrl+o when tool output fits the preview', () => {
    let state = initialTranscript()
    state = applyEvent(state, ev('tool/call', { callId: 'call-1', name: 'bash', arguments: '{}' }, 1))
    state = applyEvent(state, ev('tool/result', {
      message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'ok' }] }] },
    }, 2))
    const frame = view(state)
    expect(frame.lines.join('\n')).not.toContain('ctrl+o')
  })

  it('ignores log-only vocabulary events', () => {
    let state = initialTranscript()
    state = applyEvent(state, ev('todo/write', { todos: [] }, 1))
    state = applyEvent(state, ev('request/header', { header: {}, reason: 'initial' }, 2))
    expect(state.blocks).toEqual([])
    expect(state.status).toBe('idle')
  })

  it('does not create empty user blocks for empty prompts', () => {
    let state = initialTranscript()
    state = applyEvent(state, ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '' }] }, 1))
    expect(state.blocks).toEqual([])
  })

  it('does not render plugin-sourced system context as user prompts', () => {
    let state = initialTranscript()
    state = applyEvent(state, ev('user/message', { source: { kind: 'plugin' }, content: [{ type: 'text', text: 'runtime context noise' }] }, 1))
    expect(state.blocks).toEqual([])
  })
})

describe('renderView', () => {
  it('fits every line to the terminal width in visible cells', () => {
    let state = initialTranscript()
    state = applyEvent(state, ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'x'.repeat(200) }] }, 1))
    const frame = view(state)
    for (const line of frame.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(60)
  })

  it('places the cursor on the editor input row', () => {
    const state = initialTranscript()
    const frame = renderView(state, { width: 60, height: 24, model: 'm', input: 'abc', inputCursor: 2, colors: false })
    expect(frame.cursor).toEqual({ row: frame.lines.length - 1, column: 4 })
    expect(frame.lines[frame.lines.length - 1]).toMatch(/^╰─/)
    expect(frame.lines[frame.lines.length - 1]).toContain('abc')
  })

  it('keeps the frame inside the terminal height with a scroll indicator', () => {
    let state = initialTranscript()
    for (let i = 0; i < 20; i += 1) {
      state = applyEvent(state, ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'line ' + i }] }, i))
    }
    const frame = view(state)
    expect(frame.lines.length).toBeLessThanOrEqual(24)
    expect(frame.lines[0]).toContain('earlier lines')
    expect(frame.lines[frame.lines.length - 1]).toMatch(/^╰─/)
    expect(frame.transcript?.hiddenBelow).toBe(0)
    expect(frame.transcript?.hiddenAbove).toBeGreaterThan(0)
  })

  it('windows the transcript away from the tail when scrollStart is set', () => {
    let state = initialTranscript()
    for (let i = 0; i < 20; i += 1) {
      state = applyEvent(state, ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'mark-' + i }] }, i))
    }
    const tail = view(state)
    const start = Math.max(0, (tail.transcript?.start ?? 1) - 1)
    const scrolled = renderView(state, {
      width: 60,
      height: 24,
      model: 'deepseek-v4-flash',
      input: '',
      inputCursor: 0,
      colors: false,
      scrollStart: start,
    })
    const text = scrolled.lines.join('\n')
    expect(scrolled.lines.length).toBeLessThanOrEqual(24)
    expect(text).toContain('later line')
    expect(scrolled.transcript?.hiddenBelow).toBeGreaterThan(0)
    expect(scrolled.transcript?.start).toBeLessThan(tail.transcript?.start ?? 0)
  })

  it('does not scroll-indicate when the transcript fits', () => {
    const state = initialTranscript()
    const frame = view(state)
    expect(frame.lines[0]).not.toContain('earlier line')
  })

  it('paints oh-my-pi chrome: welcome card, rounded editor, no readline prompt', () => {
    const frame = view(initialTranscript())
    const text = frame.lines.join('\n')
    expect(text).toContain('Welcome back!')
    expect(text).toContain('omdsh')
    expect(text).toContain('╭')
    expect(text).toContain('╰')
    expect(text).toContain('Tips')
    expect(text).not.toMatch(/(^|\n)> /)
    expect(frame.lines[0]).toMatch(/^╭/)
    expect(frame.lines[frame.lines.length - 1]).toMatch(/^╰─/)
    expect(text).toContain('/  commands')
    expect(text).toContain('^R search')
    expect(text).toContain('Pg↑ scroll')
  })

  it('replaces the editor with the history-search overlay', () => {
    const frame = renderView(initialTranscript(), {
      width: 60,
      height: 24,
      model: 'm',
      input: 'draft',
      inputCursor: 5,
      colors: false,
      historySearch: {
        query: 'com',
        cursor: 3,
        selected: 0,
        results: ['git commit'],
      },
    })
    const text = frame.lines.join('\n')
    expect(text).toContain('Search History')
    expect(text).toContain('git commit')
    expect(text).toContain('enter select')
    expect(text).not.toContain('draft')
    expect(frame.cursor?.row).toBeGreaterThan(0)
  })

  it('paints the slash-command popup under the editor', () => {
    const frame = renderView(initialTranscript(), {
      width: 60,
      height: 24,
      model: 'm',
      input: '/',
      inputCursor: 1,
      colors: false,
      autocomplete: {
        items: [
          { value: 'help', label: 'help', description: 'Show available slash commands' },
          { value: 'quit', label: 'q', description: 'Quit the application' },
        ],
        selected: 1,
      },
    })
    const text = frame.lines.join('\n')
    expect(text).toContain('/help')
    expect(text).toContain('/q')
    expect(text).toContain('❯')
    expect(frame.lines[frame.lines.length - 1]).toContain('/q')
    expect(frame.cursor?.row).toBeLessThan(frame.lines.length - 1)
  })

  it('replaces the editor with the settings overlay', () => {
    const frame = renderView(initialTranscript(), {
      width: 60,
      height: 24,
      model: 'm',
      input: 'draft',
      inputCursor: 5,
      colors: false,
      settings: { selected: 0, prefs: { theme: 'dark', colors: true } },
    })
    const text = frame.lines.join('\n')
    expect(text).toContain('Settings')
    expect(text).toContain('Theme')
    expect(text).toContain('dark')
    expect(text).toContain('enter cycle')
    expect(text).not.toContain('draft')
    expect(frame.cursor?.row).toBeGreaterThan(0)
  })
})

describe('windowTranscript', () => {
  const theme = createTheme(false)
  const body = Array.from({ length: 10 }, (_, i) => 'row-' + i)

  it('returns the full body when it fits', () => {
    const win = windowTranscript(body, 20, 0, theme)
    expect(win.lines).toEqual(body)
    expect(win.maxStart).toBe(0)
    expect(win.hiddenAbove).toBe(0)
    expect(win.hiddenBelow).toBe(0)
  })

  it('pins a non-finite start to the tail', () => {
    const win = windowTranscript(body, 5, Number.POSITIVE_INFINITY, theme)
    expect(win.hiddenBelow).toBe(0)
    expect(win.hiddenAbove).toBe(6)
    expect(win.lines[0]).toContain('earlier')
    expect(win.lines.join('\n')).toContain('row-9')
    expect(win.lines.join('\n')).not.toContain('row-0')
    expect(win.start).toBe(win.maxStart)
  })

  it('shows a later-lines marker when scrolled off the tail', () => {
    const tail = windowTranscript(body, 5, Number.POSITIVE_INFINITY, theme)
    const win = windowTranscript(body, 5, tail.maxStart - 1, theme)
    expect(win.hiddenBelow).toBeGreaterThan(0)
    expect(win.lines.some((line) => line.includes('later'))).toBe(true)
    expect(win.start).toBeLessThan(tail.start)
    expect(win.lines.join('\n')).toContain('row-5')
  })

  it('pins start 0 to the top with a later-lines marker', () => {
    const win = windowTranscript(body, 5, 0, theme)
    expect(win.start).toBe(0)
    expect(win.hiddenAbove).toBe(0)
    expect(win.hiddenBelow).toBe(6)
    expect(win.lines[0]).toBe('row-0')
    expect(win.lines[win.lines.length - 1]).toContain('later')
    expect(win.lines.join('\n')).not.toContain('row-9')
  })

  it('clamps start to the tail maximum', () => {
    const win = windowTranscript(body, 5, 99, theme)
    expect(win.start).toBe(win.maxStart)
    expect(win.hiddenBelow).toBe(0)
  })
})
