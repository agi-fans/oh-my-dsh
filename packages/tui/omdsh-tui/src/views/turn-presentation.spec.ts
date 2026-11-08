import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { applyEvent, applyStreamChunk, initialTranscript, renderView } from './event-views.ts'
import { turnGroups } from './transcript-render.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import { createTheme, THEME_NAMES } from '../chrome/theme.ts'
import type { TranscriptState } from './transcript-types.ts'
import { mergeJobSettlement } from '../session/job-notice.ts'

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
const view = (state: TranscriptState, colors = false, width = 100, expanded = false) => renderView(state, {
  width, height: 160, colors, model: 'm', input: '', inputCursor: 0, toolsExpanded: expanded, hideThinking: !expanded,
})
const text = (state: TranscriptState) => view(state).lines.map(stripAnsi).join('\n')

describe('live content followed by a completed turn summary', () => {
  it('shows compact live process rows and folds only the process on completion', () => {
    let state = applyStreamChunk(start(), {
      turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'Inspect the manifests.\n\nThen check the source.' },
    })
    expect(text(state)).toContain('Thinking · Inspect the manifests.')
    expect(text(state)).not.toContain('Then check the source.')
    expect(text(state)).not.toMatch(/^▸/mu)
    state = applyEvent(state, event('assistant/message', { turn: 1, step: 1, message: {
      role: 'assistant', content: [{ type: 'reasoning', text: 'Inspect the manifests.\n\nThen check the source.' }],
    } }, 1500))
    state = result(call(state, 'c1', 'bash', { command: 'pwd', description: 'Locate the project' }), 'c1', 'workspace root')
    state = result(call(state, 'c2', 'bash', { command: 'ls', description: 'List files' }), 'c2', 'source listing')
    state = result(call(state, 'c3', 'read', { path: 'README.md' }), 'c3', 'Read output line one\nRead output line two')
    state = answer(state)
    const live = text(state)
    for (const content of ['Thinking · Then check the source.', 'Locate the project', 'List files', 'Read file · README.md', 'Final answer.']) {
      expect(live).toContain(content)
    }
    expect(live).not.toContain('Worked for')
    expect(live).not.toContain('workspace root')
    expect(live).not.toContain('Read output line two')
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
    expect(text(thought)).toContain('▸ Thinking')
    expect(text(thought)).not.toContain('Only thinking.')
    thought = finish(thought)
    expect(text(thought)).toContain('Worked for 16s')
    expect(text(thought)).not.toContain('Only thinking.')
  })

  it.each([false, true])('wraps complete live output with right padding (colors=%s)', colors => {
    const state = result(call(start(), 'c', 'bash', { command: 'echo text', description: 'Print text' }), 'c', '检查 🐳 é '.repeat(30) + 'OUTPUT_END')
    for (const width of [20, 40, 80, 140]) {
      const rows = view(state, colors, width, true).lines
      expect(rows.every(row => visibleWidth(row) <= width)).toBe(true)
      const output = rows.map(stripAnsi).filter(row => /检查|OUTPUT_END/u.test(row))
      expect(output.length).toBeGreaterThan(0)
      expect(output.every(row => row.endsWith('  '))).toBe(true)
      expect(rows.map(stripAnsi).join('\n')).toContain('OUTPUT_END')
    }
  })

  it('wraps full thinking at a readable width without truncating it', () => {
    const state = applyStreamChunk(start(), { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '检查配置 🐳 é '.repeat(30) + 'THINKING_END' } })
    const rows = view(state, true, 160, true).lines.map(stripAnsi)
    const thought = rows.filter(row => /检查配置|THINKING_END/u.test(row))
    expect(thought.length).toBeGreaterThan(1)
    expect(thought.every(row => visibleWidth(row.trimEnd()) <= 158)).toBe(true)
    expect(rows.join('\n')).toContain('THINKING_END')
  })

  it('keeps adjacent compact calls unboxed and opens only the chosen call', () => {
    let state = result(call(start(), 'c1', 'bash', { command: 'pwd' }), 'c1', 'first output')
    state = result(call(state, 'c2', 'bash', { command: 'ls' }), 'c2', 'second output')
    const options = { width: 100, height: 160, colors: true, model: 'm', input: '', inputCursor: 0 }
    const compact = renderView(state, options).lines
    const first = compact.findIndex(row => stripAnsi(row).includes('Run command · pwd'))
    const second = compact.findIndex(row => stripAnsi(row).includes('Run command · ls'))
    expect(second).toBe(first + 1)
    expect(compact[first]).not.toContain(createTheme(true, true).getBgAnsi('toolSuccessBg'))
    const opened = renderView(state, { ...options, expandedTools: new Set(['c1']) }).lines.map(stripAnsi).join('\n')
    expect(opened).toContain('first output')
    expect(opened).not.toContain('second output')
    expect(opened).toContain('▾ Run command · pwd')
    expect(opened).toContain('▸ Run command · ls')
  })

  it('separates a job settlement line from the command output', () => {
    let state = result(call(start(), 'c1', 'bash', { command: 'sleep 1' }), 'c1', 'started background job bash-1')
    state = mergeJobSettlement(state, {
      id: 'bash-1', label: 'sleep 1', status: 'completed', startedAt: 2500, detail: 'exit code: 0',
    })!
    const rows = view(state, false, 100, true).lines.map(stripAnsi)
    const jobRow = rows.findIndex(row => row.includes('Job bash-1'))
    expect(jobRow).toBeGreaterThan(0)
    expect(rows[jobRow - 1]!.trim()).toBe('')
  })

  it('renders a read_image result card from the tool facts', () => {
    let state = call(start(), 'c1', 'read_image', { file_path: 'shot.png' })
    state = applyEvent(state, event('tool/result', { message: {
      role: 'tool',
      toolCallId: 'c1',
      content: [
        { type: 'text', text: 'Read image shot.png (800×600, image/png, 4096 bytes)' },
        {
          type: 'image',
          attachment: {
            attachmentId: 'abcdefghijkl', mediaType: 'image/png', bytes: 4096, width: 800, height: 600, name: 'shot.png',
          },
        },
      ],
    } }, 3000))
    // `read_image` defines no `presentResult`, so the card falls back to the raw
    // result text; the image bytes stay model-facing and are not drawn here.
    const screen = view(state, false, 100, true).lines.map(stripAnsi).join('\n')
    expect(screen).toContain('shot.png')
    expect(screen).toContain('800×600')
  })

  it('keeps a tool-result image reference on the block', () => {
    let state = call(start(), 'c1', 'read_image', { file_path: 'shot.png' })
    state = applyEvent(state, event('tool/result', { message: {
      role: 'tool',
      toolCallId: 'c1',
      content: [
        { type: 'text', text: 'Read image shot.png (800×600, image/png, 4096 bytes)' },
        { type: 'image', attachment: {
          attachmentId: 'abcdefghijkl', mediaType: 'image/png', bytes: 4096, width: 800, height: 600, name: 'shot.png',
        } },
      ],
    } }, 3000))
    const block = state.blocks.find(entry => entry.kind === 'tool')
    expect(block?.kind === 'tool' ? block.image?.attachmentId : undefined).toBe('abcdefghijkl')
    // The reference is for reopening the picture (Alt+M); the transcript keeps
    // its text and never places a bitmap into rows that become scrollback.
    const frame = renderView(state, {
      width: 80, height: 40, colors: true, colorDepth: 'truecolor', themeName: 'dark' as const, model: 'm', input: '', inputCursor: 0,
      imageProtocol: 'kitty' as const,
    })
    expect(frame.image).toBeUndefined()
    expect(text(state)).toContain('shot.png')
  })

  it('keeps a pasted image reference on the user block without changing the layout', () => {
    const attachment = { attachmentId: 'abcdefghijkl', mediaType: 'image/webp', bytes: 4096, width: 1046, height: 296, name: 'clipboard.png' }
    const state = applyEvent(start(), event('user/message', {
      source: { kind: 'user' },
      content: [{ type: 'text', text: '这个图片说了什么' }, { type: 'image', attachment }],
    }, 1200))
    const block = state.blocks.find(entry => entry.kind === 'user')
    expect(block?.kind === 'user' ? block.image?.attachmentId : undefined).toBe('abcdefghijkl')
    const base = { width: 80, height: 40, colors: true, colorDepth: 'truecolor', themeName: 'dark' as const, model: 'm', input: '', inputCursor: 0 }
    expect(renderView(state, base).lines).toEqual(renderView(state, { ...base, imageProtocol: 'kitty' as const }).lines)
    expect(renderView(state, { ...base, imageProtocol: 'kitty' as const }).image).toBeUndefined()
  })

  it('names an attached picture where it sat among the words', () => {
    const attachment = { attachmentId: 'abcdefghijkl', mediaType: 'image/jpeg', bytes: 4096, width: 800, height: 600, name: 'shot.jpg' }
    const state = applyEvent(start(), event('user/message', {
      source: { kind: 'user' },
      content: [{ type: 'text', text: '看这个' }, { type: 'image', attachment }, { type: 'text', text: '怎么样' }],
    }, 1200))
    const base = { width: 80, height: 40, colors: true, colorDepth: 'truecolor', themeName: 'dark' as const, model: 'm', input: '', inputCursor: 0 }
    const screen = renderView(state, { ...base, imageProtocol: 'kitty' as const }).lines.map(stripAnsi).join('\n')
    expect(screen).toContain('看这个 [Image: image/jpeg]怎么样')
  })
  it('does not fold an earlier part of the same live turn around an ordinary notice', () => {
    let state = result(call(start(), 'c', 'read', { path: 'README.md' }), 'c', 'first tool content')
    state = { ...state, blocks: [...state.blocks, { kind: 'notice', text: 'Session notice', level: 'info' }] }
    state = result(call(state, 'c2', 'read', { path: 'package.json' }), 'c2', 'second tool content')
    expect(text(state)).toContain('Read file · README.md')
    expect(text(state)).toContain('Read file · package.json')
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
        width: 80, height: 100, colors: true, colorDepth: 'truecolor', themeName,
        model: 'm', input: '', inputCursor: 0, expandedTools: new Set(['c']),
        ...(opened ? { openedGroups: new Set(turnGroups(state).map(group => group.key)) } : {}),
      })
      const at = frame.lines.findIndex(row => stripAnsi(row).trim() === 'workspace')
      expect(at).toBeGreaterThan(0)
      expect(frame.lines[at]).toContain(theme.getBgAnsi('toolSuccessBg'))
      expect(frame.lines[at]).toContain(theme.getFgAnsi('toolOutput'))
      expect(frame.lines.map(stripAnsi).join('\n')).toContain('▾ Run command · pwd')
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
    expect(opened).toContain('▸ Thinking · Inspect the project.')
    expect(opened).toContain('▸ Run command · pnpm test')
    expect(opened).not.toContain('line 11')
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
  it.each([false, true])('pins only the painted tool detail span and bounds restored positions (colors=%s)', colors => {
    const state = finish(answer(result(call(start(), 'long', 'read', { path: '中文🐳source.ts' }), 'long', Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n'))))
    const index = state.blocks.findIndex(block => block.kind === 'tool')
    for (const width of [20, 80]) {
      const options = { width, height: 24, colors, model: 'm', input: '', inputCursor: 0, scrollStart: 0 }
      const folded = renderView(state, options)
      expect(folded.transcript!.disclosures!.every(target => target.detailEnd === undefined)).toBe(true)
      const opened = renderView(state, { ...options, expandedTools: new Set(['long']) })
      const target = opened.transcript!.disclosures!.find(target => target.block === index)!
      expect(target.detailEnd).toBeGreaterThan(target.row + 80)
      const header = opened.stickyHeaders!.at(-1)!
      expect(header.start).toBe(target.row + 1)
      expect(header.end).toBe(target.detailEnd)
      expect(visibleWidth(header.text)).toBe(width)
      expect(stripAnsi(header.text)).toContain('Read')
      const restored = renderView(state, { ...options, expandedTools: new Set(['long']), focusBlock: index, focusBlockOffset: 30 })
      expect(restored.transcript!.start).toBe(target.row + 30)
      const clamped = renderView(state, { ...options, expandedTools: new Set(['long']), focusBlock: index, focusBlockOffset: 10_000 })
      expect(clamped.transcript!.start).toBeLessThan(target.detailEnd!)
      expect(renderView(state, { ...options, expandedTools: new Set(['long']), height: 4 }).stickyHeaders).toEqual([])
    }
  })

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
      expect(stripAnsi(headers[0]!.text).trimStart()).toMatch(/^检/)
      if (width >= 20) expect(stripAnsi(headers[1]!.text).trim()).toBe('Second question')
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

describe('full tool details', () => {
  it('preserves a colored call diff alongside its received result', () => {
    const state: TranscriptState = { ...initialTranscript(), blocks: [{
      kind: 'tool', callId: 'edit', name: 'edit', args: '{}', status: 'ok', output: 'Changed one file',
      presentation: { call: { card: 'diff', title: 'Edit a.ts', diffs: [{ path: 'a.ts', oldText: 'old', newText: 'new' }] } },
    }] }
    const frame = renderView(state, { width: 80, height: 60, colors: true, colorDepth: 'ansi16', input: '', inputCursor: 0, model: 'm', expandedTools: new Set(['edit']), rawTools: new Set(['edit']) })
    const text = frame.lines.map(stripAnsi).join('\n')
    expect(text).toContain('- old')
    expect(text).toContain('+ new')
    expect(text).toContain('Changed one file')
    expect(frame.lines.join('\n')).toContain('\x1b[31m')
    expect(frame.lines.join('\n')).toContain('\x1b[32m')
  })

  it('preserves a terminal result card and its distinct raw result', () => {
    const state: TranscriptState = { ...initialTranscript(), blocks: [{
      kind: 'tool', callId: 'terminal', name: 'bash', args: '{"command":"test"}', status: 'ok', output: 'Raw test report',
      presentation: { result: { card: 'terminal', output: '42 passed', exitCode: 0 } },
    }] }
    const text = renderView(state, { width: 80, height: 60, colors: false, input: '', inputCursor: 0, model: 'm', expandedTools: new Set(['terminal']), rawTools: new Set(['terminal']) }).lines.join('\n')
    expect(text).toContain('42 passed')
    expect(text).toContain('Raw result')
    expect(text).toContain('Raw test report')
  })

  it.each(['bash', 'write', 'custom'])('preserves raw details for %s failures and PTC children', name => {
    const output = Array.from({ length: 40 }, (_, index) => `OUTPUT_${index}`).join('\n')
    let state = result(call(start(), 'child', name, { command: 'run', content: 'INPUT_START\nINPUT_END', extra: 123 }), 'child', output)
    state = { ...state, blocks: state.blocks.map(block => block.kind === 'tool' ? { ...block, parentCallId: 'parent', status: 'error' } : block) }
    const options = { width: 90, height: 160, colors: false, input: '', inputCursor: 0, model: 'm' }
    const full = renderView(state, { ...options, expandedTools: new Set(['child']), rawTools: new Set(['child']) }).lines.map(stripAnsi)
    expect(full.join('\n')).toContain('"extra": 123')
    expect(full.join('\n')).toContain('INPUT_END')
    expect(full.join('\n')).toContain('Tool failed')
    for (let index = 0; index < 40; index++) expect(full.join('\n')).toContain(`OUTPUT_${index}`)
    expect(full.find(line => line.trim() === 'OUTPUT_0')).toMatch(/^      OUTPUT_0/)
    expect(full.join('\n')).not.toContain('Alt+O: Expand')
  })

  it.each([false, true])('shows all arguments and output without changing another turn (colors=%s)', colors => {
    const state: TranscriptState = { ...initialTranscript(), blocks: [
      { kind: 'tool', turn: 1, callId: 'old', name: 'read', args: '{"path":"old"}', output: 'OLD_BODY', status: 'ok' },
      { kind: 'user', text: 'Inspect the new file' },
      { kind: 'tool', turn: 2, callId: 'new', name: 'read', args: JSON.stringify({ path: 'new', offset: 42, limit: 80 }), output: 'FIRST\n' + '检查 🐳 é '.repeat(60) + '\nLAST', status: 'ok' },
    ] }
    for (const width of [20, 80]) {
      const options = { width, height: 300, colors, input: '', inputCursor: 0, model: 'm' }
      const full = renderView(state, { ...options, expandedTools: new Set(['new']), rawTools: new Set(['new']) })
      const text = full.lines.map(stripAnsi).join('\n')
      expect(text).toContain('FIRST')
      expect(text).toContain('LAST')
      expect(text).toContain('"offset": 42')
      expect(text).toContain('"limit": 80')
      expect(text).not.toContain('OLD_BODY')
      expect(full.lines.every(line => visibleWidth(line) <= width)).toBe(true)
      expect(renderView(state, options).lines.join('\n')).not.toContain('FIRST')
    }
  })

  it('keeps bulk-details shortcuts out of compact per-item rows', () => {
    const state = result(call(start(), 'c', 'bash', { command: 'ls' }), 'c', 'private output')
    const options = { width: 100, height: 80, colors: false, input: '', inputCursor: 0, model: 'm' }
    for (const toolDetailsKey of ['Alt+O', 'Alt+D']) {
      const text = renderView(state, { ...options, toolDetailsKey }).lines.join('\n')
      expect(text).toContain('▸ Run command · ls')
      expect(text).not.toContain('private output')
      expect(text).not.toContain(toolDetailsKey)
    }
  })
})

describe('readable process details', () => {
  const options = { width: 80, height: 160, colors: false, input: '', inputCursor: 0, model: 'm', expandedTools: new Set(['c']) }
  it('shows the command before output and reserves raw arguments for inspection', () => {
    const state = result(call(start(), 'c', 'bash', { command: 'pnpm test', description: 'Check tests', timeout: 120 }), 'c', '42 passed')
    const readable = renderView(state, options).lines.map(stripAnsi).join('\n')
    expect(readable).toContain('▾ Check tests')
    expect(readable).toContain('$ pnpm test')
    expect(readable).toContain('42 passed')
    expect(readable.indexOf('$ pnpm test')).toBeLessThan(readable.indexOf('42 passed'))
    expect(readable).not.toContain('"timeout"')
    const raw = renderView(state, { ...options, rawTools: new Set(['c']) }).lines.join('\n')
    expect(raw).toContain('"timeout": 120')
    expect(raw).toContain('42 passed')
    // Switching modes on the same block identity must not reuse the other layout.
    expect(renderView(state, options).lines.join('\n')).not.toContain('"timeout"')
  })

  it.each([false, true])('renders file ranges and search locations with display-cell padding (colors=%s)', colors => {
    const states: TranscriptState[] = [
      { ...start(), blocks: [{ kind: 'tool', callId: 'c', name: 'read', args: '{"path":"中文🐳.ts","offset":42}', status: 'ok', output: 'raw read', presentation: { result: { card: 'read', path: '中文🐳.ts', totalLines: 120, lines: [{ number: 42, text: 'const message = "é🐳中文"' }, { number: 43, text: 'message' }] } } }] },
      { ...start(), blocks: [{ kind: 'tool', callId: 'c', name: 'grep', args: '{"pattern":"needle","path":"src"}', status: 'ok', output: 'raw search', presentation: { result: { card: 'search', shape: 'matches', total: 1, truncated: false, files: [{ path: 'src/中文.ts', matches: [{ lineNumber: 42, line: 'needle' }] }] } } }] },
    ]
    for (const [index, state] of states.entries()) for (const width of [20, 80]) {
      const frame = renderView(state, { ...options, colors, width })
      expect(frame.lines.every(line => visibleWidth(line) <= width)).toBe(true)
      const text = frame.lines.map(stripAnsi).join('\n')
      expect(text).toContain(index === 0 ? '43  message' : '42: needle')
      expect(text).not.toContain(index === 0 ? '"offset"' : '"pattern"')
      const content = frame.lines.map(stripAnsi).filter(line => line.includes(index === 0 ? '43  message' : '42: needle'))
      expect(content.every(line => line.startsWith('    ') && line.endsWith('  '))).toBe(true)
    }
  })

  it('keeps a generic tool’s unrecognized arguments and result readable', () => {
    const state = result(call(start(), 'c', 'custom', { unfamiliar: 42 }), 'c', 'custom output')
    const text = renderView(state, options).lines.join('\n')
    expect(text).toContain('"unfamiliar": 42')
    expect(text).toContain('custom output')
  })

  it('updates a thought preview only when the latest paragraph has a complete first line', () => {
    const preview = (reasoning: string, streaming = true) => {
      const state: TranscriptState = { ...start(), blocks: [{ kind: 'assistant', turn: 1, step: 1, text: '', reasoning, streaming }] }
      return renderView(state, options).lines.map(stripAnsi).find(line => line.includes('▸ Thinking'))!.trim()
    }
    expect(preview('First')).toBe('▸ Thinking')
    expect(preview('First\nbody')).toBe('▸ Thinking · First')
    expect(preview('First\nbody\n\nNext frag')).toBe('▸ Thinking · First')
    expect(preview('First\nbody\n\nNext heading\nmore')).toBe('▸ Thinking · Next heading')
    expect(preview('First\nbody\n\nNext heading\nmore tokens')).toBe('▸ Thinking · Next heading')
    expect(preview('First\nbody\n\nFinal line', false)).toBe('▸ Thinking · Final line')
  })

  it('aligns disclosure content and keeps the click area in the left gutter', () => {
    let state = result(call(start(), 'c', 'bash', { command: 'pwd' }), 'c', 'OUTPUT')
    const frame = renderView(state, options)
    const target = frame.transcript!.disclosures!.find(target => target.key === 'call:c')!
    expect(target).toMatchObject({ column: 0, width: 4 })
    const range = frame.documentRows!
    expect(stripAnsi(frame.lines[range.frameStart + target.row - range.documentStart]!)).toContain('▾ Run command')
    expect(frame.lines.map(stripAnsi).find(line => line.includes('OUTPUT'))).toMatch(/^    OUTPUT/)
    state = finish(answer(state))
    const folded = renderView(state, { ...options, expandedTools: new Set() })
    expect(folded.transcript!.disclosures).toHaveLength(1)
    expect(folded.transcript!.disclosures![0]).toMatchObject({ column: 0, width: 4 })
    expect(folded.transcript!.disclosures![0]!.group).toBeDefined()
    expect(folded.lines.map(stripAnsi).find(line => line.includes('Worked for'))).toMatch(/^  ▸ Worked/)
  })
})
