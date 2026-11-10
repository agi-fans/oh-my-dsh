import { Terminal } from '@xterm/headless'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { LocalTui } from './provider-local.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })

function fixture(colors = false, width = 64, height = 24, paths: ConstructorParameters<typeof LocalTui>[5] = {}) {
  const screen = new Terminal({ cols: width, rows: height, scrollback: 3000, allowProposedApi: true })
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} })
  let pending = Promise.resolve()
  let resize = () => {}
  const tui = new LocalTui({ input, output: { isTTY: true, write: chunk => {
    pending = pending.then(() => new Promise<void>(resolve => { screen.write(chunk, resolve) }))
  } }, width: () => screen.cols, height: () => screen.rows, onResize: listener => { resize = listener; return () => {} } }, 'model', colors, 'dark', async () => {}, { streamRenderMs: 0, imageProtocol: 'none', ...paths })
  tui.applyStoredPrefs({ colors, motion: 'off', mouseInteraction: 'tui', pasteProtection: false, notifications: 'off', copyOnSelect: false })
  tui.setSession({ id: 'root', recent: [] })
  const submission = tui.readInput()
  const flush = async () => { await new Promise<void>(resolve => { setImmediate(resolve) }); await pending }
  const rows = () => Array.from({ length: screen.rows }, (_, row) => screen.buffer.active.getLine(screen.buffer.active.baseY + row)?.translateToString(true) ?? '')
  const history = () => Array.from({ length: screen.buffer.normal.baseY }, (_, row) => screen.buffer.normal.getLine(row)?.translateToString(true) ?? '')
  const mouse = (row: number, column: number, action: 'press' | 'release' | 'drag' = 'press') => input.write(`\x1b[<${action === 'drag' ? 32 : 0};${column + 1};${row + 1}${action === 'release' ? 'm' : 'M'}`)
  const click = (row: number, column: number) => { mouse(row, column); mouse(row, column, 'release') }
  cleanup.push(async () => { await tui.dispose(); await pending; screen.dispose() })
  return { tui, screen, input, flush, rows, history, mouse, click, submission, resize: (cols: number, rows: number) => { screen.resize(cols, rows); resize() } }
}

function transcript(count: number, reasoning = false): SessionEvent[] {
  const events: SessionEvent[] = []
  const add = (type: string, data: unknown) => events.push({ type, data, seq: events.length + 1, time: events.length + 1 } as SessionEvent)
  for (let turn = 1; turn <= count; turn++) {
    add('turn/start', { turn })
    add('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: `PROMPT-${turn}` }] })
    if (reasoning) add('assistant/message', { turn, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: `Reasoning for turn ${turn}` }] } })
    add('assistant/message', { turn, step: reasoning ? 2 : 1, message: { role: 'assistant', content: [{ type: 'text', text: `${turn === 1 ? 'SEARCH_NEEDLE' : 'ANSWER'}\n` + Array.from({ length: 8 }, (_, line) => `answer ${turn} line ${line}`).join('\n') }] } })
    add('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return events
}

it.each([false, true])('clicks a wrapped CJK/emoji draft before and after resize with frozen history (colors=%s)', async colors => {
  const f = fixture(colors, 32)
  f.tui.replaceSession(transcript(12), undefined, 'idle', 'open')
  const draft = '中文🐳 é draft ' + 'tail '.repeat(10) + '\nsecond line'
  f.input.write(draft)
  await f.flush()
  const frozen = f.history()
  const row = f.rows().findLastIndex(line => line.includes('中文🐳'))
  expect(row).toBeGreaterThanOrEqual(0)
  f.click(row, 5) // after two CJK characters, at the emoji's first cell
  f.input.write('X')
  await f.flush()
  expect(f.history().slice(0, frozen.length)).toEqual(frozen)
  f.resize(26, 20)
  await f.flush()
  const resizedHistory = f.history()
  const second = f.rows().findLastIndex(line => line.includes('second line'))
  f.click(second, 1)
  f.input.write('Y')
  const sent = f.submission
  f.input.write('\r')
  expect((await sent)?.text).toBe(draft.replace('中文', '中文X').replace('second line', 'Ysecond line'))
  await f.flush()
  expect(f.history().slice(0, resizedHistory.length)).toEqual(resizedHistory)
})

it('accepts a clicked completion without submitting the prompt and scrolls the popup with the wheel', async () => {
  const f = fixture()
  f.tui.setCommands([{ name: 'model', description: 'Choose model', complete: () => [
    { value: 'demo-alpha', label: 'alpha', description: 'First command' },
    { value: 'demo-beta', label: 'beta', description: 'Second command' },
  ] }])
  f.input.write('/model ')
  await f.flush()
  let row = f.rows().findIndex(line => line.includes('alpha') && line.includes('First command'))
  expect(row).toBeGreaterThanOrEqual(0)
  f.input.write(`\x1b[<65;4;${row + 1}M`)
  await f.flush()
  row = f.rows().findIndex(line => line.includes('beta') && line.includes('Second command'))
  f.click(row, 4)
  await f.flush()
  expect(f.rows().join('\n')).toContain('/model demo-beta')
  expect(f.tui.pendingInputs.list()).toEqual([])
  const sent = f.submission
  f.input.write('\r')
  expect((await sent)?.text).toBe('/model demo-beta')
})

it('keeps native mouse mode and folded-paste boundaries intact', async () => {
  const f = fixture()
  f.tui.applyStoredPrefs({ mouseInteraction: 'native' })
  f.input.write('native draft')
  await f.flush()
  f.click(f.rows().findLastIndex(row => row.includes('native draft')), 1)
  f.input.write('X')
  f.input.write('\r')
  expect((await f.submission)?.text).toBe('native draftX')

  const g = fixture()
  const pasted = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n')
  g.input.write('\x1b[200~' + pasted + '\x1b[201~')
  await g.flush()
  const row = g.rows().findLastIndex(line => line.includes('[Pasted #'))
  expect(row).toBeGreaterThanOrEqual(0)
  g.click(row, 8)
  g.input.write('X\r')
  expect((await g.submission)?.text).toBe(pasted + 'X')
})

it.each(['resume', 'keyboard'] as const)('keeps a %s search position through redraws and closing the search', async origin => {
  const f = fixture()
  f.tui.replaceSession(transcript(16), undefined, 'idle', 'open')
  if (origin === 'resume') f.input.write('unsent draft')
  await f.flush()
  const frozen = f.history()
  expect(frozen.some(row => row.includes('SEARCH_NEEDLE'))).toBe(true)
  if (origin === 'resume') f.tui.searchTranscript('SEARCH_NEEDLE')
  else f.input.write('\x06SEARCH_NEEDLE\rn')
  await f.flush()
  expect(f.rows().join('\n')).toContain('SEARCH_NEEDLE')
  expect(f.history()).toEqual(frozen)
  f.tui.refresh()
  f.tui.replaceSession(transcript(16), undefined, 'idle', 'refresh')
  f.tui.setSession({ id: 'root', title: 'Updated root title', recent: [] })
  await f.flush()
  expect(f.rows().join('\n')).toContain('SEARCH_NEEDLE')
  f.resize(60, 22)
  await f.flush()
  expect(f.rows().join('\n')).toContain('SEARCH_NEEDLE')
  const resizedHistory = f.history()
  f.input.write('\x1b[27u')
  f.input.write(' more')
  await f.flush()
  expect(f.rows().join('\n')).toContain('SEARCH_NEEDLE')
  expect(f.history()).toEqual(resizedHistory)
  const sent = f.submission
  f.input.write('\r')
  expect((await sent)?.text).toBe(origin === 'resume' ? 'unsent draft more' : ' more')
})

it('preserves a browsing position across a tool-catalog refresh and resets it when changing the viewed session', async () => {
  const f = fixture()
  f.tui.replaceSession(transcript(16), undefined, 'idle', 'open')
  await f.flush()
  f.input.write('\x1b[1;6A'.repeat(3))
  await f.flush()
  const frozen = f.history()
  const before = f.rows()
  f.tui.replaceSession(transcript(16), undefined, 'idle', 'refresh')
  await f.flush()
  expect(f.rows()).toEqual(before)
  expect(f.history()).toEqual(frozen)
  f.tui.searchTranscript('SEARCH_NEEDLE')
  f.tui.setInspectedSubagent({ id: 'child', label: 'Child', phase: 'waiting', writable: true })
  f.tui.replaceSession(transcript(4), undefined, 'idle', 'refresh')
  await f.flush()
  expect(f.rows().join('\n')).not.toContain('Search (')
  expect(f.rows().join('\n')).toContain('PROMPT-4')
  expect(f.history()).toEqual(frozen)
})

it('refreshes the active path completion after clicking another token or entering a path token', async () => {
  const f = fixture(false, 64, 24, { listDir: directory => [{ name: directory.endsWith('src') ? 'local.ts' : 'root.ts', directory: false }] })
  f.input.write('compare ./src/ with @./')
  await f.flush()
  expect(f.rows().join('\n')).toContain('root.ts')
  f.click(f.rows().findIndex(row => row.includes('compare')), 8)
  await f.flush()
  expect(f.rows().join('\n')).not.toContain('root.ts')
  f.click(f.rows().findIndex(row => row.includes('compare')), 15)
  await f.flush()
  expect(f.rows().join('\n')).toContain('local.ts')
  f.input.write('\t\r')
  const submitted = await f.submission
  expect(submitted?.text).toContain('compare ./src/local.ts')
  expect(submitted?.text).toContain('with @./')
  expect(submitted?.text).not.toContain('root.ts')
})

it('gives the composer its arrow keys after clicking away from process browsing', async () => {
  const f = fixture()
  f.tui.replaceSession(transcript(16, true), undefined, 'idle', 'open')
  f.input.write('ABCDE\x0f')
  await f.flush()
  expect(f.rows().join('\n')).toContain('Process ·')
  f.click(f.rows().findIndex(row => row.includes('ABCDE')), 2)
  f.input.write('\x1b[CX\r')
  expect((await f.submission)?.text).toBe('ABXCDE')
})

it('gives typing to the composer when it is clicked during transcript search', async () => {
  const f = fixture()
  f.tui.replaceSession(transcript(16), undefined, 'idle', 'open')
  f.input.write('\x06SEARCH_NEEDLE\x0e')
  await f.flush()
  expect(f.rows().join('\n')).toContain('SEARCH_NEEDLE')
  const frozen = f.history()
  f.click(f.rows().findIndex(row => row.includes('🐳')) + 1, 1)
  f.input.write('composer text')
  await f.flush()
  expect(f.rows().join('\n')).not.toContain('Search:')
  expect(f.rows().join('\n')).toContain('SEARCH_NEEDLE')
  expect(f.history()).toEqual(frozen)
  f.input.write('\r')
  expect((await f.submission)?.text).toBe('composer text')
})

it('releases roster selection when the composer is clicked', async () => {
  const f = fixture()
  const opened: string[] = []
  f.tui.onInspectSubagent(id => { opened.push(id) })
  f.tui.setSubagents({ agents: [{ id: 'child', label: 'Explore', parentId: 'root', depth: 1, phase: 'waiting', mode: 'continuable', activity: [] }] })
  f.input.write('\x1b[B')
  await f.flush()
  f.click(f.rows().findIndex(row => row.includes('🐳')) + 1, 1)
  f.input.write('\r')
  expect(opened).toEqual([])
  expect((await f.submission)?.text).toBe('')
  const submission = f.tui.readInput()
  f.input.write('parent draft\r')
  expect((await submission)?.text).toBe('parent draft')
})

it('jumps across prompts with a nonempty draft without forking or changing native history', async () => {
  const f = fixture()
  f.tui.replaceSession(transcript(16), undefined, 'idle', 'open')
  f.input.write('retained draft')
  await f.flush()
  const frozen = f.history()
  const topPrompt = () => Number(f.rows().find(line => line.includes('PROMPT-'))?.match(/PROMPT-(\d+)/)?.[1])
  const tailPrompt = topPrompt()
  for (let step = 1; step <= 3; step++) {
    const previous = f.rows().slice(1)
    f.input.write('\x1b[1;6A')
    await f.flush()
    expect(topPrompt()).toBe(tailPrompt - step + 1)
    expect(f.rows().slice(1)).not.toEqual(previous)
  }
  for (let step = 2; step >= 1; step--) {
    f.input.write('\x1b[1;6B')
    await f.flush()
    expect(topPrompt()).toBe(tailPrompt - step + 1)
  }
  expect(f.history()).toEqual(frozen)
  const sent = f.submission
  f.input.write('\r')
  expect((await sent)?.text).toBe('retained draft')
})

it('keeps turn navigation out of the history search modal', async () => {
  const f = fixture()
  f.tui.replaceSession(transcript(16), undefined, 'idle', 'open')
  f.input.write('retained draft')
  await f.flush()
  const before = f.rows()
  const frozen = f.history()
  f.input.write('\x12')
  await f.flush()
  const modal = f.rows()
  f.input.write('\x1b[1;6A'.repeat(5) + '\x1b[1;6B')
  await f.flush()
  expect(f.rows()).toEqual(modal)
  f.input.write('\x1b[27u')
  await f.flush()
  expect(f.rows()).toEqual(before)
  expect(f.history()).toEqual(frozen)
  f.input.write('\r')
  expect((await f.submission)?.text).toBe('retained draft')
})

it('starts turn navigation at the search position instead of its earlier prompt anchor', async () => {
  const f = fixture()
  f.tui.replaceSession(transcript(16), undefined, 'idle', 'open')
  await f.flush()
  f.input.write('\x1b[1;6A'.repeat(3))
  f.input.write('\x06SEARCH_NEEDLE\rn')
  await f.flush()
  expect(f.rows().join('\n')).toContain('SEARCH_NEEDLE')
  f.input.write('\x1b[27u\x1b[1;6B')
  await f.flush()
  expect(f.rows().find(line => line.includes('PROMPT-'))).toContain('PROMPT-2')
})

it('returns from a process heading to its prompt instead of skipping to the earlier turn anchor', async () => {
  const f = fixture()
  f.tui.replaceSession(transcript(16, true), undefined, 'idle', 'open')
  await f.flush()
  f.input.write('\x1b[1;6A'.repeat(3))
  await f.flush()
  const prompt = f.rows().find(line => line.includes('PROMPT-'))!.trim()
  const frozen = f.history()
  const row = f.rows().findIndex(line => line.includes('Worked for'))
  expect(row).toBeGreaterThanOrEqual(0)
  f.click(row, 3)
  f.input.write('\x1b[H')
  await f.flush()
  expect(f.rows().join('\n')).toContain('Thinking')
  f.input.write('\x1b[1;6A')
  await f.flush()
  expect(f.rows().find(line => line.includes('PROMPT-'))!.trim()).toBe(prompt)
  expect(f.history()).toEqual(frozen)
})

it.each(['\x1by', 'q'])('quotes a file reader selection into the original draft using %j', async key => {
  const f = fixture()
  const image = { data: new Uint8Array([1]), mediaType: 'image/png', name: 'draft.png' }
  f.tui.restoreInput({ text: 'Explain this', images: [image] })
  const reading = f.tui.reviewFiles({ title: 'Files', files: [{ path: 'sample.ts', label: 'sample.ts' }],
    initial: 0, canEdit: true, canQuote: true, signal: new AbortController().signal,
    read: async () => ({ source: { text: 'SELECTED_SOURCE\nother line', language: 'ts' } }), action: async () => {} })
  await f.flush()
  const row = f.rows().findIndex(line => line.includes('SELECTED_SOURCE'))
  expect(row).toBeGreaterThanOrEqual(0)
  const column = f.rows()[row]!.indexOf('SELECTED_SOURCE')
  f.mouse(row, column)
  f.mouse(row, column + 'SELECTED_SOURCE'.length, 'drag')
  f.mouse(row, column + 'SELECTED_SOURCE'.length, 'release')
  f.input.write(key)
  await f.flush()
  await reading
  expect(f.rows().join('\n')).toContain('Explain this')
  expect(f.tui.pendingInputs.list()).toEqual([])
  const sent = f.submission
  f.input.write('\r')
  const submitted = await sent
  expect(submitted?.text).toContain('Explain this\n\n> SELECTED_SOURCE')
  expect(submitted?.images).toEqual([image])
})

it.each(['/', '\t/', '?', 'a'])('keeps selected Q inside a file reader submode opened by %j', async mode => {
  const f = fixture(false, 120)
  let closed = false
  const reading = f.tui.reviewFiles({ title: 'Files', files: [{ path: 'q-sample.ts', label: 'q-sample.ts' }], initial: 0,
    canEdit: true, canQuote: true, signal: new AbortController().signal,
    read: async () => ({ source: { text: 'SELECTED_SOURCE\nother line', language: 'ts' } }), action: async () => {} }).then(() => { closed = true })
  await f.flush()
  f.input.write(mode)
  await f.flush()
  const row = f.rows().findIndex(line => line.includes('SELECTED_SOURCE') || mode === '?' && line.includes('Open /') || mode === 'a' && line.includes('Quote in composer'))
  expect(row).toBeGreaterThanOrEqual(0)
  const column = mode === '?' || mode === 'a' ? 45 : f.rows()[row]!.indexOf('SELECTED_SOURCE')
  f.mouse(row, column)
  f.mouse(row, column + 8, 'drag')
  f.mouse(row, column + 8, 'release')
  f.input.write('q')
  await f.flush()
  expect(closed).toBe(false)
  expect(f.tui.pendingInputs.list()).toEqual([])
  if (mode.includes('/')) expect(f.rows().join('\n')).toContain('q')
  await f.tui.dispose()
  await reading
})

it('disables file quotes while inspecting a read-only child', async () => {
  const f = fixture()
  f.tui.setInspectedSubagent({ id: 'child', label: 'Child', phase: 'completed', writable: false })
  let actions = 0
  const reading = f.tui.reviewFiles({ title: 'Files', files: [{ path: 'sample.ts', label: 'sample.ts' }], initial: 0,
    canEdit: true, canQuote: true, signal: new AbortController().signal,
    read: async () => ({ source: { text: 'SELECTED_SOURCE', language: 'ts' } }), action: async () => { actions++; f.tui.insertText('hidden quote') } })
  await f.flush()
  const row = f.rows().findIndex(line => line.includes('SELECTED_SOURCE'))
  const column = f.rows()[row]!.indexOf('SELECTED_SOURCE')
  f.mouse(row, column); f.mouse(row, column + 8, 'drag'); f.mouse(row, column + 8, 'release')
  f.input.write('q\x1byq')
  await f.flush()
  expect(actions).toBe(0)
  f.tui.insertText('hidden quote')
  f.tui.setInspectedSubagent({ id: 'child', label: 'Child', phase: 'waiting', writable: true })
  await f.flush()
  expect(f.rows().join('\n')).not.toContain('hidden quote')
  await f.tui.dispose()
  await reading
})
