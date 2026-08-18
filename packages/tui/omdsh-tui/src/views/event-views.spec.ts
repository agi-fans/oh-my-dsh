/**
 * Transcript state-machine contract tests: each test feeds a scripted
 * session-log event sequence and asserts the externally observable
 * transcript state and rendered frame — what a terminal shows.
 */
import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import { applyEvent, blockLines, initialTranscript, renderQueuedSubmissions, renderTodos, renderView, replayEvents, TOOL_COLLAPSED_LINES, windowTranscript } from './event-views.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'

/** Fixture builder: a session event with a sequence number. */
function ev(type: string, data: unknown, seq: number): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

const view = (state: ReturnType<typeof initialTranscript>, input = '') =>
  renderView(state, {
    width: 60,
    height: 24,
    model: 'deepseek-v4-flash',
    input,
    inputCursor: input.length,
    colors: false,
    welcomeTips: [{ key: '/', text: 'Browse available commands' }],
  })

describe('applyEvent', () => {
  it('replays a complete log with the same state as immutable live folding', () => {
    const events = [
      ev('turn/start', { turn: 1 }, 1),
      ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }, 2),
      ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'thinking' } }, 3),
      ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'draft' } }, 4),
      ev('assistant/message', {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'answer' }] },
      }, 5),
      ev('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'tool-call-delta', id: 'call-1', name: 'bash', argumentsDelta: '{"command":' },
      }, 6),
      ev('tool/call', { callId: 'call-1', name: 'bash', arguments: '{"command":"true"}' }, 7),
      ev('tool/result', {
        message: {
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'done' }] }],
        },
      }, 8),
      ev('todo/write', {
        todos: [{ content: 'verify replay', status: 'in_progress' }],
      }, 9),
      ev('agent/inbox/spliced', {
        target: 'next-turn',
        start: 0,
        inserted: [{ id: 'queued', source: { kind: 'user' }, content: [{ type: 'text', text: 'next' }] }],
      }, 10),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 11),
    ]
    const immutable = events.reduce((state, event) => applyEvent(state, event), initialTranscript())

    expect(replayEvents(events)).toEqual(immutable)
  })

  it('renders compact as a visible non-editable activity until the command settles', () => {
    let state = initialTranscript()
    state = applyEvent(state, ev('command/run', {
      commandId: 'cmd-compact-1',
      name: 'compact',
      source: { kind: 'user' },
    }, 1))

    expect(state.status).toBe('compacting')
    const active = view(state)
    expect(active.lines.join('\n')).toContain('Compacting')
    expect(active.cursorVisible).toBe(false)

    state = applyEvent(state, ev('command/done', {
      commandId: 'cmd-compact-1',
      kind: 'success',
    }, 2))
    expect(state.status).toBe('idle')
  })

  it('projects queued agent follow-ups above the composer until they are claimed', () => {
    let state = initialTranscript()
    state = applyEvent(state, ev('turn/start', { turn: 1 }, 1))
    state = applyEvent(state, ev('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [
        { id: 'message-1', source: { kind: 'user' }, content: [{ type: 'text', text: 'first follow-up' }] },
        { id: 'message-2', source: { kind: 'user' }, content: [{ type: 'text', text: 'second follow-up' }] },
      ],
    }, 2))

    const queued = view(state)
    expect(queued.lines.join('\n')).toContain('Queued · 2')
    expect(queued.lines.join('\n')).toContain('│ 1  first follow-up')
    expect(queued.lines.join('\n')).toContain('│ 2  second follow-up')

    state = applyEvent(state, ev('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      removedCount: 1,
      inserted: [],
    }, 3))
    const claimed = view(state)
    expect(claimed.lines.join('\n')).toContain('Queued · second follow-up')
    expect(claimed.lines.join('\n')).not.toContain('first follow-up')
  })

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
    expect(frame.lines.some((line) => line.includes('Deep Driving'))).toBe(true)
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
    const running = renderView({ ...state, status: 'running' }, {
      width: 60, height: 24, model: 'm', input: '', inputCursor: 0, colors: false,
    })
    expect(running.lines.join('\n')).toContain('read')
    expect(running.lines.join('\n')).toContain('Ctrl+C: Interrupt')
    const activity = running.lines.find(line => line.includes('Ctrl+C: Interrupt')) ?? ''
    expect(activity).toContain('Deep Driving')
    expect(activity).not.toContain('read')
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
    expect(collapsedText).toContain('4 more lines · ⟨Ctrl+O: Expand⟩')
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
    expect(expandedText).not.toContain('Ctrl+O: Expand')
  })

  it('does not hint ctrl+o when tool output fits the preview', () => {
    let state = initialTranscript()
    state = applyEvent(state, ev('tool/call', { callId: 'call-1', name: 'bash', arguments: '{}' }, 1))
    state = applyEvent(state, ev('tool/result', {
      message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'ok' }] }] },
    }, 2))
    const frame = view(state)
    expect(frame.lines.join('\n')).not.toContain('Ctrl+O')
  })

  it('keeps terminal input above a labeled output section after settlement', () => {
    const lines = blockLines({
      kind: 'tool',
      callId: CallId('call-terminal'),
      name: 'bash',
      args: '{"command":"ignored fallback"}',
      status: 'ok',
      output: 'fallback',
      presentation: {
        call: { card: 'terminal', title: 'SCOPE=/repo pnpm test', description: 'Run tests', cwd: '/repo' },
        result: { card: 'terminal', output: '42 passed', exitCode: 0 },
      },
    }, createTheme(false), 60)
    const text = lines.map(stripAnsi).join('\n')

    expect(text).toContain('✔ bash')
    expect(text).toContain('SCOPE=/repo pnpm test')
    expect(text).toContain('Output')
    expect(text).toContain('42 passed')
    expect(text.indexOf('SCOPE=/repo pnpm test')).toBeLessThan(text.indexOf('Output'))
  })

  it('shows the latest terminal output rows while collapsed', () => {
    const output = Array.from({ length: TOOL_COLLAPSED_LINES + 3 }, (_, index) => `line-${index}`)
    const lines = blockLines({
      kind: 'tool',
      callId: CallId('call-terminal-tail'),
      name: 'bash',
      args: '{}',
      status: 'ok',
      output: output.join('\n'),
      presentation: {
        call: { card: 'terminal', title: 'pnpm test' },
        result: { card: 'terminal', output: output.join('\n'), exitCode: 0 },
      },
    }, createTheme(false), 60)
    const text = lines.map(stripAnsi).join('\n')

    expect(text).toContain('… 3 earlier lines · ⟨Ctrl+O: Expand⟩')
    expect(text).not.toContain('line-0')
    expect(text).toContain(`line-${TOOL_COLLAPSED_LINES + 2}`)
  })

  it('paints an aligned edit diff with red deletions and green additions', () => {
    const hunk = {
      path: 'a.ts',
      oldText: 'keep\nconst foo = 1\nkeep',
      newText: 'keep\nconst bar = 1\nkeep',
    }
    const lines = blockLines({
      kind: 'tool',
      callId: CallId('call-edit'),
      name: 'edit',
      args: '{}',
      status: 'ok',
      output: '',
      presentation: { result: { card: 'diff', title: 'Edit a.ts', diffs: [hunk] } },
    }, createTheme(true, false), 60)
    const plain = lines.map(stripAnsi).join('\n')
    const raw = lines.join('\n')

    expect(plain).toContain('✔ Edit a.ts +1/-1')
    expect(plain).toContain('  keep')
    expect(plain).toContain('- const foo = 1')
    expect(plain).toContain('+ const bar = 1')
    expect(plain).not.toContain('- keep')
    expect(raw).toContain('\x1b[31m')
    expect(raw).toContain('\x1b[32m')
    expect(raw).toContain('\x1b[7mfoo\x1b[27m')
    expect(raw).toContain('\x1b[7mbar\x1b[27m')
  })

  it('keeps a generic error result visible when the call was a diff', () => {
    const lines = blockLines({
      kind: 'tool',
      callId: CallId('call-edit-error'),
      name: 'edit',
      args: '{}',
      status: 'error',
      output: 'old_string not found',
      presentation: {
        call: { card: 'diff', title: 'Edit a.ts', diffs: [{ path: 'a.ts', oldText: 'a', newText: 'b' }] },
        result: { card: 'generic', content: [{ type: 'text', text: 'old_string not found' }] },
      },
    }, createTheme(false), 60)
    const text = lines.map(stripAnsi).join('\n')

    expect(text).toContain('- a')
    expect(text).toContain('+ b')
    expect(text).toContain('old_string not found')
  })

  it('shows the current todo list immediately above the composer', () => {
    let state = initialTranscript()
    state = applyEvent(state, ev('todo/write', {
      todos: [
        { content: 'Inspect the projection chain', status: 'completed' },
        { content: 'Render todos above the composer', status: 'in_progress' },
      ],
    }, 1))

    const lines = view(state).lines
    expect(state.todos).toEqual([
      { content: 'Inspect the projection chain', status: 'completed' },
      { content: 'Render todos above the composer', status: 'in_progress' },
    ])
    expect(lines.join('\n')).toContain('Todos · 1/2')
    const todo = lines.findIndex(line => line.includes('Render todos above the composer'))
    const composer = lines.findIndex(line => line.includes('🐳'))
    expect(todo).toBeGreaterThanOrEqual(0)
    expect(composer).toBeGreaterThan(todo)
    expect(lines.slice(todo - 2, todo + 1)).toEqual([
      '  Todos · 1/2',
      '  ├─ ☑ Inspect the projection chain',
      '  └─ ☐ Render todos above the composer',
    ])
  })

  it('clears the previous Todo projection when the next turn starts', () => {
    let state = applyEvent(initialTranscript(), ev('todo/write', {
      todos: [{ content: 'previous turn', status: 'pending' }],
    }, 1))
    state = applyEvent(state, ev('turn/start', { turn: 2 }, 2))

    expect(state.todos).toEqual([])
    expect(view(state).lines.join('\n')).not.toContain('previous turn')
  })

  it('ignores log-only vocabulary events', () => {
    let state = initialTranscript()
    state = applyEvent(state, ev('request/header', { header: {}, reason: 'initial' }, 1))
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

describe('blockLines', () => {
  const theme = createTheme(false)

  it('highlights @ paths inside the user-message bubble without breaking its background', () => {
    const color = createTheme(true, true)
    const lines = blockLines({ kind: 'user', text: 'open @src/index.ts, then inspect it' }, color, 40)
    const rendered = lines.join('\n')

    expect(rendered).toContain(
      color.getFgAnsi('accent')
      + '\x1b[1m@src/index.ts\x1b[22m'
      + color.getFgAnsi('userMessageText')
      + ',',
    )
    expect(lines.every(line => visibleWidth(line) === 40)).toBe(true)
  })

  it('renders a one-line informational notice inline without an empty frame', () => {
    const lines = blockLines({
      kind: 'notice',
      level: 'info',
      text: 'Resumed session-example.',
    }, theme, 60)

    expect(lines.join('\n')).toContain('Resumed session-example.')
    expect(lines.join('\n')).not.toMatch(/[╭│╰]/u)
    expect(stripAnsi(lines[0] ?? '')).toBe('  Resumed session-example.')
    expect(stripAnsi(lines[0] ?? '')).not.toContain('•')
  })

  it('renders notices unframed by default and frames only explicit panels', () => {
    const multiline = blockLines({ kind: 'notice', level: 'info', text: 'Results\nfirst row' }, theme, 60)
    const error = blockLines({ kind: 'notice', level: 'error', text: 'Resume failed.' }, theme, 60)
    const colorTheme = createTheme(true, true)
    const coloredInfo = blockLines({ kind: 'notice', level: 'info', text: 'Status\ndetail' }, colorTheme, 60)
    const coloredError = blockLines({ kind: 'notice', level: 'error', text: 'Status' }, colorTheme, 60)
    const panel = blockLines({ kind: 'notice', level: 'info', text: 'Panel\ndetail', framed: true }, theme, 60)

    for (const lines of [multiline, error, coloredInfo, coloredError]) {
      expect(lines.join('\n')).not.toMatch(/[╭│╰]/u)
      expect(stripAnsi(lines[0] ?? '')).toMatch(/^  /u)
    }
    expect(stripAnsi(error[0] ?? '')).toBe('  Resume failed.')
    expect(coloredError[0]).toContain(colorTheme.getFgAnsi('error'))
    expect(panel.join('\n')).toMatch(/[╭╰]/u)
    expect(stripAnsi(panel[0] ?? '')).toMatch(/^╭─── Panel /u)
  })

  it('renders the tool catalog as an unframed heading and a protected Markdown table', () => {
    const lines = blockLines({
      kind: 'toolCatalog',
      tools: [
        { name: 'ask_user_question', description: 'Ask a concise question when confirmation is needed.' },
        { name: 'bash', description: 'Execute a bash command and return stdout and stderr.' },
      ],
    }, theme, 72)
    expect(lines.every(line => visibleWidth(line) <= 72)).toBe(true)
    expect(lines[0]).toContain('Available Tools')
    expect(lines[0]).toContain('2 active')
    expect(stripAnsi(lines[0] ?? '')).not.toMatch(/[╭│╰]/u)
    expect(lines[1]).toBe('')
    expect(lines.join('\n')).toContain('Description')
    expect(lines.join('\n')).toContain('ask_user_question')
    expect(lines.join('\n')).toContain('Descriptions shortened')
    expect(lines.join('\n')).toContain('Ctrl+O: Expand')
    const askRow = lines.findIndex(line => line.includes('ask_user_question'))
    const bashRow = lines.findIndex(line => line.includes('bash'))
    expect(bashRow - askRow).toBeGreaterThan(1)
    expect(lines.slice(askRow + 1, bashRow).some(line => /^\s*├.*┼.*┤$/u.test(stripAnsi(line)))).toBe(true)
    expect(lines.filter(line => stripAnsi(line).trimStart().startsWith('╭'))).toHaveLength(1)
    expect(lines.filter(line => stripAnsi(line).trimStart().startsWith('╰'))).toHaveLength(1)
    expect(lines.some(line => stripAnsi(line).trimStart().startsWith('╰'))).toBe(true)
    const expanded = blockLines({
      kind: 'toolCatalog',
      tools: [{ name: 'bash', description: 'Execute a bash command and return all stdout and stderr without shortening this complete description.' }],
    }, theme, 48, 0, true)
    expect(expanded.join('\n')).toContain('without')
    expect(expanded.join('\n')).toContain('shortening this complete')
    expect(expanded.join('\n')).toContain('Ctrl+O: Collapse descriptions')
  })

  it('matches oh-my-pi assistant padding and wraps inside both margins', () => {
    const lines = blockLines({
      kind: 'assistant',
      turn: 1,
      step: 1,
      text: 'abcdefghijkl',
      reasoning: '',
      streaming: false,
    }, theme, 8)

    expect(lines).toEqual([' abcdef ', ' ghijkl '])
    expect(lines.every((line) => visibleWidth(line) === 8)).toBe(true)
  })

  it('keeps a long bash command in the body and the right frame cap visible', () => {
    const command = 'pnpm --filter @agi-fans/dsh-tui test 2>&1 | grep -v WARN | tail -6 && pnpm --filter @agi-fans/dsh-tui build'
    const lines = blockLines({
      kind: 'tool',
      callId: CallId('call-long'),
      name: 'bash',
      args: JSON.stringify({ command }),
      status: 'ok',
      output: 'Done',
    }, createTheme(true, true), 80)
    const top = stripAnsi(lines[0] ?? '')
    const text = lines.map(stripAnsi).join('\n')

    expect(top).toMatch(/^╭─── /u)
    expect(top).toMatch(/╮$/u)
    expect(text).toContain('pnpm --filter @agi-fans/dsh-tui test')
    expect(text).toContain('@agi-fans/dsh-tui build')
    expect(visibleWidth(top)).toBe(80)
  })

  it('applies the same padding to reasoning and the streaming placeholder', () => {
    const reasoning = blockLines({
      kind: 'assistant',
      turn: 1,
      step: 1,
      text: 'answer',
      reasoning: 'thought',
      streaming: false,
    }, theme, 12)
    const streaming = blockLines({
      kind: 'assistant',
      turn: 1,
      step: 1,
      text: '',
      reasoning: '',
      streaming: true,
    }, theme, 12)

    expect(reasoning).toEqual([' thought    ', '', ' answer     '])
    expect(streaming).toEqual([' …          '])
  })

  it('paints reasoning in thinkingText italic without a rail, and keeps prose off default ink', () => {
    const color = createTheme(true, true)
    const lines = blockLines({
      kind: 'assistant',
      turn: 1,
      step: 1,
      text: 'answer',
      reasoning: 'consider `pwd` next then **bold** more',
      streaming: false,
    }, color, 48)
    const think = color.getFgAnsi('thinkingText')
    const reasoning = lines[0] ?? ''
    expect(stripAnsi(reasoning)).not.toMatch(/│/u)
    expect(reasoning).toContain('\x1b[3m')
    expect(reasoning).not.toContain('\x1b[2m')
    expect(reasoning).toContain(think)
    expect(reasoning).not.toContain(color.getFgAnsi('accent'))
    const body = lines.find(line => stripAnsi(line).includes('answer')) ?? ''
    expect(body).not.toContain(think)

    let fg = 'default'
    let word = ''
    const words: { text: string; fg: string }[] = []
    const re = /\x1b\[([0-9;]*)m|([^\x1b])/gu
    let match: RegExpExecArray | null
    const flush = (): void => {
      if (word !== '') words.push({ text: word, fg })
      word = ''
    }
    while ((match = re.exec(reasoning)) !== null) {
      if (match[1] !== undefined) {
        flush()
        const code = match[1]
        if (code === '39' || code === '0') fg = 'default'
        else if (code.startsWith('38;')) fg = `\x1b[${code}m`
        continue
      }
      const ch = match[2] ?? ''
      if (ch === ' ' || ch === '│') {
        flush()
        continue
      }
      word += ch
    }
    flush()
    expect(words).toContainEqual({ text: 'consider', fg: think })
    expect(words).toContainEqual({ text: 'pwd', fg: think })
    expect(words).toContainEqual({ text: 'next', fg: think })
    expect(words).toContainEqual({ text: 'then', fg: think })
    expect(words).toContainEqual({ text: 'bold', fg: think })
    expect(words).toContainEqual({ text: 'more', fg: think })
  })

  it('keeps midnight body on terminal ink and thinking in the quieter comment ink', () => {
    const midnight = createTheme(true, true, 'midnight')
    const lines = blockLines({
      kind: 'assistant',
      turn: 1,
      step: 1,
      text: 'answer',
      reasoning: 'thought',
      streaming: false,
    }, midnight, 40)
    const think = lines.find(line => stripAnsi(line).includes('thought')) ?? ''
    const body = lines.find(line => stripAnsi(line).includes('answer')) ?? ''
    expect(think).toContain(midnight.getFgAnsi('thinkingText'))
    expect(midnight.getFgAnsi('text')).toBe('\x1b[39m')
    expect(body).not.toContain('\x1b[38;2;')
    expect(body).not.toContain(midnight.getFgAnsi('thinkingText'))
  })

  it('keeps dark and catppuccin assistant body on terminal ink', () => {
    for (const name of ['dark', 'catppuccin'] as const) {
      const theme = createTheme(true, true, name)
      const lines = blockLines({
        kind: 'assistant',
        turn: 1,
        step: 1,
        text: 'answer',
        reasoning: 'thought',
        streaming: false,
      }, theme, 40)
      const body = lines.find(line => stripAnsi(line).includes('answer')) ?? ''
      expect(theme.getFgAnsi('text'), name).toBe('\x1b[39m')
      expect(body, name).not.toContain('\x1b[38;2;')
      expect(body, name).not.toContain(theme.getFgAnsi('thinkingText'))
    }
  })
})

describe('renderView', () => {
  it('reuses transcript layout across activity-only state and spinner changes', () => {
    let textReads = 0
    const block = {
      kind: 'user' as const,
      get text() {
        textReads += 1
        return 'stable transcript content'
      },
    }
    const state = { ...initialTranscript(), blocks: [block] }
    renderView(state, {
      width: 60,
      height: 24,
      model: 'm',
      input: '',
      inputCursor: 0,
      colors: false,
      spinnerFrame: 0,
    })
    const readsAfterInitialLayout = textReads

    renderView({ ...state, status: 'running' }, {
      width: 60,
      height: 24,
      model: 'm',
      input: '',
      inputCursor: 0,
      colors: false,
      spinnerFrame: 1,
    })

    expect(textReads).toBe(readsAfterInitialLayout)
  })

  it('reuses settled block layouts while only a running tool spinner changes', () => {
    let textReads = 0
    const settled = {
      kind: 'user' as const,
      get text() {
        textReads += 1
        return 'settled transcript content'
      },
    }
    const state = {
      ...initialTranscript(),
      status: 'running' as const,
      blocks: [
        settled,
        { kind: 'tool' as const, callId: CallId('call-running'), name: 'bash', args: '{}', status: 'running' as const, output: '' },
      ],
    }
    const options = {
      width: 60,
      height: 24,
      model: 'm',
      input: '',
      inputCursor: 0,
      colors: false,
    }
    const first = renderView(state, { ...options, spinnerFrame: 0 })
    const readsAfterInitialLayout = textReads
    const second = renderView(state, { ...options, spinnerFrame: 1 })

    expect(textReads).toBe(readsAfterInitialLayout)
    expect(second.lines).not.toEqual(first.lines)
  })

  it('separates adjacent outputs from different slash commands', () => {
    const state = {
      ...initialTranscript(),
      blocks: [
        { kind: 'commandOutput', command: 'session', text: 'Session Details\n\nfirst' },
        { kind: 'commandOutput', command: 'export', text: 'Export complete\n\nsecond' },
      ],
    } as ReturnType<typeof initialTranscript>
    const frame = renderView(state, {
      width: 60,
      height: 24,
      model: 'm',
      input: '',
      inputCursor: 0,
      colors: false,
    })

    expect(frame.lines).toContain(' ' + '─'.repeat(58) + ' ')
  })

  it('fits every line to the terminal width in visible cells', () => {
    let state = initialTranscript()
    state = applyEvent(state, ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'x'.repeat(200) }] }, 1))
    const frame = view(state)
    for (const line of frame.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(60)
  })

  it('places the cursor on the editor input row', () => {
    const state = initialTranscript()
    const frame = renderView(state, { width: 60, height: 24, model: 'm', input: 'abc', inputCursor: 2, colors: false })
    const editorStart = frame.editor?.start ?? -1
    expect(frame.cursor).toEqual({ row: editorStart + 1, column: 4 })
    expect(frame.lines[editorStart + 1]).toMatch(/^│ /)
    expect(frame.lines[editorStart + 1]).toContain('abc')
    expect(frame.lines[editorStart + (frame.editor?.rows ?? 0) - 1]).toMatch(/^╰─/)
    expect(frame.lines.at(-2)).toContain('m')
  })

  it('shows queued submissions immediately above the composer', () => {
    const state = initialTranscript()
    const frame = renderView(state, {
      width: 60,
      height: 24,
      model: 'm',
      input: '',
      inputCursor: 0,
      queuedSubmissions: [
        { text: 'first queued', images: [] },
        { text: 'second\nqueued', images: [] },
      ],
      colors: false,
    })
    const editorStart = frame.editor?.start ?? -1
    const queue = frame.lines.slice(editorStart - 3, editorStart)
    expect(queue[0]).toMatch(/^  │ Queued · 2\s+↑ edit latest$/u)
    expect(queue.slice(1)).toEqual([
      '  │ 1  first queued',
      '  │ 2  second ↵ queued',
    ])
  })

  it('collapses one queued submission into a single action row', () => {
    const lines = renderQueuedSubmissions([
      { text: 'one queued message', images: [] },
    ], createTheme(false), 48)
    expect(lines[0]).toMatch(/^  │ Queued · one queued message\s+↑ edit$/u)
  })

  it('caps and truncates queued submission previews', () => {
    const lines = renderQueuedSubmissions([
      { text: 'one', images: [] },
      { text: 'two', images: [] },
      { text: 'three', images: [] },
      { text: 'four '.repeat(20), images: [] },
    ], createTheme(false), 24)
    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain('Queued · 4')
    expect(lines.join('\n')).not.toContain('│ 1  one')
    expect(lines.every(line => visibleWidth(line) <= 24)).toBe(true)
  })

  it('keeps current Todo work visible inside a bounded tree preview', () => {
    const lines = renderTodos([
      { content: 'done one', status: 'completed' },
      { content: 'done two', status: 'completed' },
      { content: 'done three', status: 'completed' },
      { content: 'done four', status: 'completed' },
      { content: 'done five', status: 'completed' },
      { content: 'current work', status: 'in_progress' },
      { content: 'next task with a long description', status: 'pending' },
    ], createTheme(false), 24)

    expect(lines.map(stripAnsi)).toEqual([
      '  Todos · 5/7',
      '  ├─ … 5 earlier',
      '  ├─ ☐ current work',
      '  └─ ☐ next task with a…',
    ])
    expect(lines.every(line => visibleWidth(line) <= 24)).toBe(true)
  })

  it('keeps the frame inside the terminal height with a scroll indicator', () => {
    let state = initialTranscript()
    for (let i = 0; i < 20; i += 1) {
      state = applyEvent(state, ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'line ' + i }] }, i))
    }
    const frame = view(state)
    expect(frame.lines.length).toBeLessThanOrEqual(24)
    expect(frame.lines[0]).toContain('earlier lines')
    expect(frame.lines[0]).toContain('Pg↑')
    expect(frame.lines[(frame.editor?.start ?? 0) + (frame.editor?.rows ?? 0) - 1]).toMatch(/^╰─/)
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

  it('reuses rendered transcript blocks when only the viewport moves', () => {
    let renders = 0
    let state = initialTranscript()
    const call = new Proxy({ card: 'generic', title: 'cache probe' } as const, {
      get: (target, property, receiver) => {
        if (property === 'title') renders += 1
        return Reflect.get(target, property, receiver)
      },
    })
    state = applyEvent(
      state,
      ev('tool/call', { callId: 'call-cache', name: 'cache_probe', arguments: '{}' }, 1),
      { call },
    )
    const base = {
      width: 60,
      height: 12,
      model: 'm',
      input: '',
      inputCursor: 0,
      colors: false,
    } as const

    renderView(state, { ...base, scrollStart: Number.POSITIVE_INFINITY })
    const firstRenderReads = renders
    renderView(state, { ...base, scrollStart: 0 })

    expect(firstRenderReads).toBeGreaterThan(0)
    expect(renders).toBe(firstRenderReads)
  })

  it('does not scroll-indicate when the transcript fits', () => {
    const state = initialTranscript()
    const frame = view(state)
    expect(frame.lines[0]).not.toContain('earlier line')
  })

  it('paints oh-my-pi chrome: welcome card, rounded editor, no readline prompt', () => {
    const frame = view(initialTranscript())
    const text = frame.lines.join('\n')
    expect(text).toContain('Into the Unknown')
    expect(text).toContain('omdsh')
    expect(text).toContain('╭')
    expect(text).toContain('╰')
    expect(text).toContain('Tips')
    expect(text).not.toMatch(/(^|\n)> /)
    expect(frame.lines[0]).toMatch(/^╭/)
    expect(frame.lines[(frame.editor?.start ?? 0) + (frame.editor?.rows ?? 0) - 1]).toMatch(/^╰─/)
    expect(text).toContain('/  Browse available commands')
  })

  it('keeps the whale composer minimal and renders a fixed two-line status footer', () => {
    const frame = renderView(initialTranscript(), {
      width: 180,
      height: 24,
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
      input: '',
      inputCursor: 0,
      colors: false,
      sessionStats: {
        turns: 1,
        steps: 74,
        llmMs: 1_011_000,
        toolMs: 213_000,
        ttftMs: 88_800,
        ttftSteps: 74,
        decodeMs: 922_500,
        decodeTokens: 73_800,
        inputTokens: 5_900_000,
        outputTokens: 73_800,
        cacheReadTokens: 5_841_000,
        cacheWriteTokens: 0,
      },
    })
    const editorStart = frame.editor?.start ?? -1
    expect(frame.lines[editorStart]).toContain('🐳')
    expect(frame.lines[editorStart]).not.toContain('deepseek-v4-pro')
    expect(frame.lines[editorStart]).not.toContain('omdsh')
    expect(frame.lines[editorStart]).not.toContain('tok')
    const plain = frame.lines.map(stripAnsi)
    const modelRow = frame.lines.length - 2
    expect(plain[modelRow]).toContain('deepseek-v4-pro · max')
    expect(plain[modelRow]).not.toContain('omdsh')
    expect(plain.at(-1)).toContain('1 turn · 74 steps')
    expect(plain.at(-1)).toContain('5.9M in · 73.8K out')
    expect(frame.lines[editorStart + (frame.editor?.rows ?? 0) - 1]).toMatch(/^╰─+╯$/)
    expect(frame.lines).toHaveLength(24)
  })

  it('paints the permission mode on the composer top-right, not the status footer', () => {
    const frame = renderView(initialTranscript(), {
      width: 80,
      height: 20,
      model: 'deepseek-v4-flash',
      input: '',
      inputCursor: 0,
      colors: false,
      sessionControls: { permission: 'danger-full-access' },
    })
    const editorStart = frame.editor?.start ?? -1
    expect(frame.lines[editorStart]).toContain('🐳')
    expect(frame.lines[editorStart]).toContain('FULL ACCESS')
    expect(frame.lines[editorStart]?.indexOf('🐳') ?? 0).toBeLessThan(frame.lines[editorStart]?.indexOf('FULL ACCESS') ?? 0)
    expect(frame.lines.at(-2)).not.toContain('FULL ACCESS')
  })

  it('shows context and zero-count telemetry before the first turn', () => {
    const frame = renderView(initialTranscript(), {
      width: 120,
      height: 24,
      model: 'deepseek-v4-flash',
      input: '',
      inputCursor: 0,
      colors: false,
      sessionStats: {
        turns: 0,
        steps: 0,
        llmMs: 0,
        toolMs: 0,
        ttftMs: 0,
        ttftSteps: 0,
        decodeMs: 0,
        decodeTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        contextWindow: 1_000_000,
      },
    })
    expect(frame.lines.at(-2)).toContain('deepseek-v4-flash')
    expect(frame.lines.at(-1)).toContain('Ctx 0% · 0/1M')
    expect(frame.lines.at(-1)).toContain('0 turns · 0 steps')
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
    expect(frame.overlay?.kind).toBe('search')
    expect(frame.overlay?.resultsRow).toBeGreaterThan(0)
    expect(text).toContain('enter select')
    expect(text).not.toContain('draft')
    expect(frame.cursor?.row).toBeGreaterThan(0)
  })

  it('windows long fixed-choice prompt lists around the selection', () => {
    const options = Array.from({ length: 24 }, (_, index) => ({
      label: `skill-${index + 1}`,
      description: `Capability ${index + 1}`,
    }))
    const frame = renderView(initialTranscript(), {
      width: 80,
      height: 24,
      model: 'm',
      input: '',
      inputCursor: 0,
      colors: false,
      promptSelector: {
        request: {
          title: 'Skills · 24 available',
          question: 'Skills are reusable playbooks.',
          options,
          allowCustom: false,
          submitLabel: 'run',
        },
        selected: 12,
        checked: new Set(),
      },
    })
    const text = frame.lines.join('\n')
    expect(text).toContain('skill-13')
    expect(text).toContain('13/24 · scroll for more')
    expect(text).toContain('enter run')
    expect(text).not.toContain('skill-1 —')
    expect(frame.editor).toBeUndefined()
    expect(frame.cursorVisible).toBe(false)
    expect(frame.lines.length).toBeLessThanOrEqual(24)
  })

  it('renders resume as one full-height searchable session list', () => {
    const frame = renderView(initialTranscript(), {
      width: 80,
      height: 24,
      model: 'm',
      appName: 'omdsh',
      input: '',
      inputCursor: 0,
      colors: false,
      promptSelector: {
        request: {
          title: 'Resume Session',
          question: '',
          presentation: 'fullscreen-list',
          filterable: true,
          allowCustom: false,
          options: [
            {
              label: 'Fix renderer scrolling',
              value: 'session-one',
              preview: 'The scrolling path still feels sluggish.',
              description: '2m ago · 42 events',
              badge: { label: 'done', tone: 'success' },
            },
            { label: 'Review tools view', value: 'session-two', description: '1h ago · 18 events' },
          ],
        },
        selected: 0,
        checked: new Set(),
      },
    })
    const text = frame.lines.join('\n')
    expect(frame.lines).toHaveLength(24)
    expect(frame.lines[0]).toContain('omdsh')
    expect(text).toContain('Resume Session')
    expect(text).toContain('Fix renderer scrolling')
    expect(text).toContain('The scrolling path still feels sluggish.')
    expect(text).toContain('2m ago · 42 events · ✔ done')
    expect(text).not.toContain('Choose a session')
    expect(text).not.toContain('answer')
    expect(frame.overlay?.kind).toBe('prompt')
    expect(frame.cursor?.row).toBe(5)
  })

  it('paints slash-argument ghost text in the editor', () => {
    const frame = renderView(initialTranscript(), {
      width: 60,
      height: 24,
      model: 'm',
      input: '/copy ',
      inputCursor: 6,
      colors: false,
    })
    expect(frame.lines.join('\n')).toContain('text|code|cmd')
    expect(frame.cursor?.column).toBe(8)
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
    const popupStart = (frame.editor?.start ?? 0) + (frame.editor?.rows ?? 0)
    expect(frame.lines.slice(popupStart, -2).join('\n')).toContain('/q')
    expect(frame.cursor?.row).toBeLessThan(frame.lines.length - 1)
    expect(frame.editor?.rows).toBeGreaterThan(0)
    expect(frame.overlay?.kind).toBe('autocomplete')
  })

  it('replaces the editor with the copy picker overlay', () => {
    const frame = renderView(initialTranscript(), {
      width: 60,
      height: 24,
      model: 'm',
      input: 'draft',
      inputCursor: 5,
      colors: false,
      copySelector: {
        selected: 0,
        items: [
          { id: 'msg:1', label: 'hello from the model', hint: '1 line', text: 'hello from the model', copyMessage: 'last message' },
        ],
      },
    })
    const text = frame.lines.join('\n')
    expect(text).toContain('Copy')
    expect(text).toContain('hello from the model')
    expect(text).toContain('enter copy')
    expect(text).not.toContain('draft')
    expect(frame.editor).toBeUndefined()
    expect(frame.overlay?.kind).toBe('copy')
    expect(frame.cursorVisible).toBe(false)
  })

  it('omits the editor hit box while settings is open', () => {
    const frame = renderView(initialTranscript(), {
      width: 60,
      height: 24,
      model: 'm',
      input: '',
      inputCursor: 0,
      colors: false,
      settings: { selected: 0, prefs: { theme: 'dark', colors: true, expandTools: false } },
    })
    expect(frame.editor).toBeUndefined()
    expect(frame.overlay?.kind).toBe('settings')
  })

  it('replaces the editor with the settings overlay', () => {
    const frame = renderView(initialTranscript(), {
      width: 60,
      height: 24,
      model: 'm',
      input: 'draft',
      inputCursor: 5,
      colors: false,
      settings: { selected: 0, prefs: { theme: 'dark', colors: true, expandTools: false } },
    })
    const text = frame.lines.join('\n')
    expect(text).toContain('Settings')
    expect(text).toContain('Theme')
    expect(text).toContain('dark')
    expect(text).toContain('←→ change')
    expect(text).not.toContain('draft')
    expect(frame.lines).toHaveLength(24)
    expect(frame.lines[0]).toMatch(/^╭─ .*Settings/)
    expect(frame.cursorVisible).toBe(false)
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
