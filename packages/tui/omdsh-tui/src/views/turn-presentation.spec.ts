import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { applyEvent, applyStreamChunk, initialTranscript, renderView } from './event-views.ts'
import { turnGroups } from './transcript-render.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import { createTheme, THEME_NAMES } from '../chrome/theme.ts'
import type { TranscriptState } from './transcript-types.ts'

const event = (type: string, data: unknown, time: number): SessionEvent => ({ type, data, time, seq: time }) as SessionEvent
const start = () => applyEvent(initialTranscript(), event('turn/start', { turn: 1 }, 1000))
const call = (state: TranscriptState, id: string, name: string, args: unknown) => applyEvent(state,
  event('tool/call', { turn: 1, step: 1, callId: id, name, arguments: JSON.stringify(args) }, 2000))
const result = (state: TranscriptState, id: string, text: string) => applyEvent(state,
  event('tool/result', { message: { role: 'tool', toolCallId: id, content: [{ type: 'text', text }] } }, 3000))
const answer = (state: TranscriptState) => applyEvent(state, event('assistant/message', {
  turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'Final answer.' }] },
}, 16000))
const finish = (state: TranscriptState) => applyEvent(state, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 17000))
const view = (state: TranscriptState, colors = false, width = 100) => renderView(state, {
  width, height: 160, colors, model: 'm', input: '', inputCursor: 0,
})
const text = (state: TranscriptState) => view(state).lines.map(stripAnsi).join('\n')

describe('live content followed by a completed turn summary', () => {
  it('shows the first thinking delta and keeps every completed step visible until the turn ends', () => {
    let state = applyStreamChunk(start(), {
      turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'Inspect the manifests.\n\nThen check the source.' },
    })
    expect(text(state)).toContain('Then check the source.')
    expect(text(state)).not.toMatch(/^▸/mu)
    state = applyEvent(state, event('assistant/message', { turn: 1, step: 1, message: {
      role: 'assistant', content: [{ type: 'reasoning', text: 'Inspect the manifests.\n\nThen check the source.' }],
    } }, 1500))
    state = result(call(state, 'c1', 'bash', { command: 'pwd', description: 'Locate the project' }), 'c1', 'workspace root')
    state = result(call(state, 'c2', 'bash', { command: 'ls', description: 'List files' }), 'c2', 'source listing')
    state = result(call(state, 'c3', 'read', { path: 'README.md' }), 'c3', 'Read output line one\nRead output line two')
    state = answer(state)
    const live = text(state)
    for (const content of ['Then check the source.', 'workspace root', 'source listing', 'read README.md', 'Final answer.']) {
      expect(live).toContain(content)
    }
    expect(live).not.toContain('Worked for')
    const closed = text(finish(state))
    expect(closed).toContain('▸ Worked for 16s')
    expect(closed).toContain('Final answer.')
    expect(closed).not.toContain('3 calls')
    expect(closed).not.toContain('Read output line two')
    expect(closed).not.toContain('Then check the source.')
  })

  it('folds a single tool call and a thinking-only turn after completion', () => {
    const tool = finish(answer(result(call(start(), 'c', 'read', { path: 'README.md' }), 'c', 'file contents')))
    expect(text(tool)).toContain('Worked for 16s')
    let thought = applyStreamChunk(start(), { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'Only thinking.' } })
    expect(text(thought)).toContain('Only thinking.')
    thought = finish(thought)
    expect(text(thought)).toContain('Worked for 16s')
    expect(text(thought)).not.toContain('Only thinking.')
  })

  it.each([false, true])('wraps complete live output with right padding (colors=%s)', colors => {
    const state = result(call(start(), 'c', 'bash', { command: 'echo text', description: 'Print text' }), 'c', '检查 🐳 é '.repeat(30) + 'OUTPUT_END')
    for (const width of [20, 40, 80, 140]) {
      const rows = view(state, colors, width).lines
      expect(rows.every(row => visibleWidth(row) <= width)).toBe(true)
      const output = rows.map(stripAnsi).filter(row => /检查|OUTPUT_END/u.test(row))
      expect(output.length).toBeGreaterThan(0)
      expect(output.every(row => row.endsWith('  '))).toBe(true)
      expect(rows.map(stripAnsi).join('\n')).toContain('OUTPUT_END')
    }
  })

  it('wraps full thinking at a readable width without truncating it', () => {
    const state = applyStreamChunk(start(), { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '检查配置 🐳 é '.repeat(30) + 'THINKING_END' } })
    const rows = view(state, true, 160).lines.map(stripAnsi)
    const thought = rows.filter(row => /检查配置|THINKING_END/u.test(row))
    expect(thought.length).toBeGreaterThan(1)
    expect(thought.every(row => visibleWidth(row.trimEnd()) <= 158)).toBe(true)
    expect(rows.join('\n')).toContain('THINKING_END')
  })

  it('does not fold an earlier part of the same live turn around an ordinary notice', () => {
    let state = result(call(start(), 'c', 'read', { path: 'README.md' }), 'c', 'first tool content')
    state = { ...state, blocks: [...state.blocks, { kind: 'notice', text: 'Session notice', level: 'info' }] }
    state = result(call(state, 'c2', 'read', { path: 'package.json' }), 'c2', 'second tool content')
    expect(text(state)).toContain('read README.md')
    expect(text(state)).toContain('read package.json')
    expect(text(state)).not.toMatch(/^▸/mu)
  })

  it('keeps a completed turn folded when a new turn starts before producing content', () => {
    const completed = finish(answer(result(call(start(), 'c', 'read', { path: 'README.md' }), 'c', 'previous tool content')))
    const next = applyEvent(completed, event('turn/start', { turn: 2 }, 18000))
    expect(text(next)).toContain('Worked for 16s')
    expect(text(next)).not.toContain('previous tool content')
    expect(text({ ...completed, status: 'running' })).not.toContain('previous tool content')
  })
})

describe('opened turns use the live presentation', () => {
  it.each([false, true])('repaints cached tool surfaces when the theme changes (opened=%s)', opened => {
    const live = answer(result(call(start(), 'c', 'bash', { command: 'pwd' }), 'c', 'workspace'))
    const state = opened ? finish(live) : live
    for (const themeName of THEME_NAMES) {
      const theme = createTheme(true, true, themeName)
      const frame = renderView(state, {
        width: 80, height: 100, colors: true, trueColor: true, themeName,
        model: 'm', input: '', inputCursor: 0,
        ...(opened ? { openedGroups: new Set(turnGroups(state).map(group => group.key)) } : {}),
      })
      const at = frame.lines.findIndex(row => stripAnsi(row).includes('$ pwd'))
      expect(at).toBeGreaterThan(0)
      expect(frame.lines[at - 1]).toBe(theme.bg('toolSuccessBg', ' '.repeat(80)))
      expect(frame.lines[at]).toContain(theme.getBgAnsi('toolSuccessBg'))
      expect(frame.lines[at]).toContain(theme.fg('toolTitle', '$ pwd'))
      expect(frame.lines[at + 2]).toContain(theme.fg('toolOutput', 'workspace'))
      expect(frame.lines[at + 3]).toBe(theme.bg('toolSuccessBg', ' '.repeat(80)))
    }
  })

  it.each([false, true])('restores identical content with no group title or nested cards (colors=%s)', colors => {
    let live = applyStreamChunk(start(), { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'Inspect the project.' } })
    live = applyEvent(live, event('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: 'Inspect the project.' }] } }, 1500))
    live = result(call(live, 'c', 'bash', { command: 'pnpm test' }), 'c', Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n'))
    live = answer(live)
    const done = finish(live)
    const options = { width: 90, height: 100, colors, model: 'm', input: '', inputCursor: 0 }
    const body = (state: TranscriptState, opened = false) => {
      const frame = renderView(state, { ...options, ...(opened ? { openedGroups: new Set(turnGroups(state).map(group => group.key)) } : {}) })
      const range = frame.documentRows!
      return frame.lines.slice(frame.transcript!.bodyRow, range.frameStart + range.documentEnd - range.documentStart)
    }
    expect(body(done, true)).toEqual(body(live))
    const opened = body(done, true).map(stripAnsi).join('\n')
    expect(opened).not.toContain('Worked')
    expect(opened).not.toMatch(/[╭╰│]/u)
    expect(opened).not.toContain('Thinking')
    expect(opened).toContain('line 11')
    expect(opened).not.toContain('line 6')
    expect(opened).toContain('7 earlier lines')
    expect(body(done).map(stripAnsi).join('\n')).toContain('Worked for 16s')
  })

  it('reveals a search match outside a tool preview', () => {
    const done = finish(answer(result(call(start(), 'c', 'read', { path: 'README.md' }), 'c', 'hidden needle')))
    const at = done.blocks.findIndex(block => block.kind === 'tool')
    const frame = renderView(done, { width: 90, height: 80, colors: false, model: 'm', input: '', inputCursor: 0,
      transcriptSearch: { query: 'needle', matches: [at], focus: 0, editing: false },
    })
    expect(frame.lines.join('\n')).toContain('hidden needle')
  })
})


describe('transcript navigation chrome', () => {
  const state: TranscriptState = { ...initialTranscript(), blocks: [
    { kind: 'user', text: '检查 🐳 é '.repeat(40) },
    { kind: 'assistant', text: 'First answer.\n\n'.repeat(30), reasoning: '', streaming: false },
    { kind: 'user', text: 'Second question' },
    { kind: 'assistant', text: 'Second answer.\n\n'.repeat(30), reasoning: '', streaming: false },
  ] }
  it.each([false, true])('keeps labels outside the transcript and within display cells (colors=%s)', colors => {
    for (const width of [4, 20, 80]) {
      const options = { width, height: 24, colors, model: 'm', input: '', inputCursor: 0 }
      const following = renderView(state, options)
      expect(following.jumpToLatest).toBeUndefined()
      const headers = following.stickyHeaders!
      expect(headers).toHaveLength(2)
      expect(headers.every(header => visibleWidth(header.text) === width)).toBe(true)
      expect(headers[0]!.end).toBeLessThan(headers[1]!.start)
      const browsing = renderView(state, { ...options, scrollStart: headers[0]!.start + 2 })
      expect(browsing.jumpToLatest).toBeDefined()
      const jump = browsing.jumpToLatest!
      expect(jump.row).toBeLessThan(browsing.cursor!.row)
      expect(visibleWidth(browsing.lines[jump.row]!)).toBeLessThanOrEqual(width)
      const range = browsing.documentRows!
      expect(jump.row).toBeGreaterThanOrEqual(range.frameStart + range.documentEnd - range.documentStart)
    }
  })
})
