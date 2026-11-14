import sharp from 'sharp'
import { createPromptBrowser } from './prompt-browser.ts'
/**
 * LocalTui contract tests over a fake terminal: key routing (edit, history,
 * slash/tab autocomplete, Ctrl-R history search, PgUp/PgDn transcript
 * scroll, Ctrl-O tool expand, submit), double-Escape rewind, double Ctrl-C exit, Ctrl-D quit and the
 * cross-turn quit latch, plain-mode line input, and event rendering.
 */
import * as editorDiscovery from '../input/editor-discovery.ts'
import * as externalEditor from '../input/external-editor.ts'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import { copyToClipboard } from '../input/clipboard.ts'
import { completionDescribes, Config, LocalTui, type TerminalLike } from './provider-local.ts'
import { editSettingsEntry, pluginSettingsEntries } from './plugin-settings.ts'
import { HerdrAgentReporter, type HerdrRequest } from './herdr-agent.ts'
import { initialTranscript, renderView } from '../views/event-views.ts'
import { createHistorySearch } from '../views/history-search.ts'
import { tuiSettingItems } from '../views/settings-list.ts'
import type { DirEntry, PathSearcher, ProjectPathEntry } from '../views/path-complete.ts'
import { stripAnsi } from '../chrome/width.ts'

const PNG_1X1 = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zk5sAAAAASUVORK5CYII=',
  'base64',
))

const flushAsyncPaste = async (): Promise<void> => {
  await new Promise<void>(resolve => { setImmediate(resolve) })
}

class FakeTerminal implements TerminalLike {
  captured = ''
  writes = 0
  raw = false
  destroyed = false
  columns = 60
  rows = 24
  resizeListener: (() => void) | undefined
  output = {
    isTTY: true,
    write: (chunk: string): void => { this.writes += 1; this.captured += chunk },
  }
  input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (on: boolean): void => { this.raw = on },
    destroy: (): void => { this.destroyed = true },
  })
  width(): number { return this.columns }
  height(): number { return this.rows }
  onResize(listener: () => void): () => void {
    this.resizeListener = listener
    return () => { this.resizeListener = undefined }
  }
  resize(columns: number, rows: number): void {
    this.columns = columns
    this.rows = rows
    this.resizeListener?.()
  }
}

function ev(type: string, data: unknown, seq: number): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

const press = (term: { input: PassThrough }, bytes: string): void => {
  term.input.write(bytes)
}

it('renders a partial TUI configuration without an initial model label', async () => {
  const config = Config({ terminalTitle: 'workspace', terminalState: 'on' })
  const term = new FakeTerminal()
  const tui = new LocalTui(term, config.model, false, 'dark', copyToClipboard, { deferInitialRender: true })
  press(term, '\x1b[?62;22c')
  try {
    tui.applyStoredPrefs({ theme: 'dark', colors: false, terminalTitle: config.terminalTitle.get(), terminalState: config.terminalState.get() })
    expect(() => tui.replaceSession([])).not.toThrow()
    expect(term.captured).toContain('Into the Unknown')
    expect(term.captured).not.toContain('undefined')
  } finally { await tui.dispose() }
})

it.each([['\x1b', false], ['\x03', true]] as const)('keeps progress pending on Enter and cancels on %s (color=%s)', async (cancel, color) => {
  const term = new FakeTerminal()
  const tui = new LocalTui(term, 'm', color, 'dark', async () => {})
  const settled = vi.fn()
  try {
    const pending = tui.prompt({ title: 'Installing plugin', question: 'demo', presentation: 'progress', allowCustom: false })
    void pending.then(settled)
    press(term, '\r')
    await flushAsyncPaste()
    expect(settled).not.toHaveBeenCalled()
    expect(stripAnsi(term.captured)).toContain('Esc cancel')
    press(term, cancel)
    await expect(pending).resolves.toBeNull()
  } finally { tui.dispose() }
})

it.each([false, true])('updates directory completion and footer without clearing scrollback (color=%s)', color => {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-directory-completion-'))
  const cwd = join(root, 'nested')
  mkdirSync(cwd)
  execFileSync('git', ['init', '-q', root])
  const term = new FakeTerminal()
  term.columns = 200
  const listed: string[] = []
  const tui = new LocalTui(term, 'm', color, 'dark', async () => {}, { cwd: root, listDir: dir => { listed.push(dir); return [] } })
  try {
    tui.setWorkingDirectory(cwd)
    press(term, '@./')
    expect(listed.at(-1)).toBe(cwd)
    expect(stripAnsi(term.captured)).toContain(cwd)
    expect(term.captured).not.toContain('\x1b[3J')
  } finally { tui.dispose(); rmSync(root, { recursive: true, force: true }) }
})

/** Herdr reporter over a recording transport, so no test touches the real socket. */
function createHerdrRecorder(): { requests: HerdrRequest[]; reporter: HerdrAgentReporter } {
  const requests: HerdrRequest[] = []
  const reporter = new HerdrAgentReporter({
    env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p2', HERDR_SOCKET_PATH: '/tmp/omdsh-herdr-test.sock' },
    transport: () => ({ send: request => { requests.push(request) } }),
    now: () => 1_000,
  })
  return { requests, reporter }
}

function emulatedScreenRows(output: string): string[] {
  const rows: string[] = ['']
  let row = 0
  let column = 0
  const tokens = output.match(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[?0-9;]*[ -/]*[@-~]|\r|\n|[^\x1b\r\n]+/gu) ?? []
  for (const token of tokens) {
    if (token === '\r') {
      column = 0
      continue
    }
    if (token === '\n') {
      row += 1
      rows[row] ??= ''
      continue
    }
    if (token.startsWith('\x1b]')) continue
    if (token.startsWith('\x1b[')) {
      const operation = token.at(-1)
      const rawParams = token.slice(2, -1).replace(/^\?/u, '')
      const params = rawParams.split(';').map(value => Number(value || '1'))
      const amount = params[0] ?? 1
      if (operation === 'A') row = Math.max(0, row - amount)
      else if (operation === 'B') row += amount
      else if (operation === 'C') column += amount
      else if (operation === 'D') column = Math.max(0, column - amount)
      else if (operation === 'H' || operation === 'f') {
        row = Math.max(0, (params[0] ?? 1) - 1)
        column = Math.max(0, (params[1] ?? 1) - 1)
      } else if (operation === 'J' && rawParams === '2') {
        rows.splice(0, rows.length, '')
      } else if (operation === 'K') {
        rows[row] = (rows[row] ?? '').slice(0, column)
      }
      rows[row] ??= ''
      continue
    }
    const current = rows[row] ?? ''
    rows[row] = current.slice(0, column) + token + current.slice(column + token.length)
    column += token.length
  }
  return Array.from(rows, value => value ?? '')
}

/**
 * A terminal that scrolls: rows pushed off the top land in `history`, the way a
 * real terminal's native scrollback does. The plain emulator above keeps every
 * row it was ever told about, so it cannot show a fold blanking the screen or
 * a transcript replayed into history.
 */
class ScrollingTerminal implements TerminalLike {
  captured = ''
  screen: string[]
  history: string[] = []
  #row = 0
  #col = 0
  output = { isTTY: true, write: (chunk: string): void => this.#write(chunk) }
  input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (): void => {}, destroy: (): void => {} })
  constructor(public columns: number, readonly rows: number) {
    this.screen = Array.from({ length: rows }, () => '')
  }
  width(): number { return this.columns }
  height(): number { return this.rows }
  resizeListener: (() => void) | undefined
  onResize(listener: () => void): () => void {
    this.resizeListener = listener
    return () => { this.resizeListener = undefined }
  }
  resize(columns: number): void {
    this.columns = columns
    this.resizeListener?.()
  }
  visible(): string[] { return this.screen.map(row => stripAnsi(row)) }
  scrollback(): string[] { return this.history.map(row => stripAnsi(row)) }
  #write(chunk: string): void {
    this.captured += chunk
    for (const token of chunk.match(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[?0-9;]*[ -/]*[@-~]|\r\n|\r|\n|[^\r\n\x1b]+/gu) ?? []) {
      if (token.startsWith('\x1b]')) continue
      if (token === '\r\n' || token === '\n') {
        if (this.#row === this.rows - 1) {
          this.history.push(this.screen.shift() ?? '')
          this.screen.push('')
        } else this.#row += 1
        if (token === '\r\n') this.#col = 0
      } else if (token === '\r') this.#col = 0
      else if (token.startsWith('\x1b[')) {
        const final = token.at(-1)
        const params = token.slice(2, -1).replace(/^\?/u, '').split(';').map(value => Number(value || '1'))
        if (final === 'H') {
          this.#row = Math.min(this.rows - 1, (params[0] ?? 1) - 1)
          this.#col = (params[1] ?? 1) - 1
        } else if (final === 'K') this.screen[this.#row] = (params[0] ?? 0) === 2 ? '' : (this.screen[this.#row] ?? '').slice(0, this.#col)
        else if (final === 'J' && (params[0] === 2 || params[0] === 3)) this.screen = this.screen.map(() => '')
      } else {
        const current = (this.screen[this.#row] ?? '').padEnd(this.#col)
        this.screen[this.#row] = current.slice(0, this.#col) + token + current.slice(this.#col + token.length)
        this.#col += token.length
      }
    }
  }
}

it.each([false, true].flatMap(color => (['keyboard', 'mouse'] as const).map(input => ({ color, input }))))('previews an original tool file via $input (color=$color) and restores the draft', async ({ color, input }) => {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-file-action-'))
  const original = join(root, 'original'), later = join(root, 'later')
  mkdirSync(original); mkdirSync(later)
  writeFileSync(join(original, '中文 🐳.ts'), 'original contents\n')
  writeFileSync(join(later, '中文 🐳.ts'), 'wrong directory\n')
  const term = new ScrollingTerminal(80, 60), tui = new LocalTui(term, 'm', color, 'dark', async () => {}, { cwd: later })
  const prompt = vi.spyOn(tui, 'prompt')
  const editor = vi.spyOn(tui, 'openFileInEditor').mockImplementation(() => {})
  const pending = tui.readline()
  try {
    tui.event(ev('user/message', { content: [{ type: 'text', text: 'Read a file' }], source: { kind: 'user' } }, 1))
    tui.event(ev('turn/start', { turn: 1 }, 2))
    tui.event(ev('tool/call', { callId: 'c', turn: 1, step: 1, name: 'owned', arguments: '{}' }, 3),
      { cwd: original, call: { card: 'generic', title: 'Read 中文 🐳.ts', locations: [{ path: '中文 🐳.ts' }] } })
    press(term, 'keep draft')
    await flushAsyncPaste()
    if (input === 'keyboard') press(term, '\x1bv')
    else {
      const row = term.visible().findIndex(line => line.includes('Read 中文 🐳.ts'))
      expect(row).toBeGreaterThanOrEqual(0)
      press(term, `\x1b[<2;4;${row + 1}M`)
    }
    await vi.waitFor(() => expect(prompt.mock.calls[0]?.[0].documentSource?.text).toBe('original contents\n'))
    expect(term.visible().join('\n')).not.toContain('wrong directory')
    press(term, 'e')
    await vi.waitFor(() => expect(editor).toHaveBeenCalledWith(join(original, '中文 🐳.ts')))
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2))
    press(term, '\x1b[27u')
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(3))
    press(term, '\x1b[27u')
    await vi.waitFor(() => expect(term.visible().join('\n')).toContain('keep draft'))
    expect(term.history.some(row => row.includes('original contents'))).toBe(false)
    press(term, '\r')
    await expect(pending).resolves.toBe('keep draft')
  } finally { await tui.dispose(); await pending; rmSync(root, { recursive: true, force: true }) }
})

it('previews the clicked Changed files row, preserves right-click copying, and respects native mouse mode', async () => {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-workspace-file-action-'))
  writeFileSync(join(root, 'a.ts'), 'first file')
  writeFileSync(join(root, 'b.ts'), 'second file')
  const copy = vi.fn(async () => {})
  const term = new ScrollingTerminal(80, 60), tui = new LocalTui(term, 'm', false, 'dark', copy)
  const prompt = vi.spyOn(tui, 'prompt')
  const input = tui.readline()
  try {
    tui.event(ev('workspace/changes', { turn: 1 }, 1), undefined, { turn: 1, cwd: root, total: 2, added: 2, deleted: 0,
      files: [{ path: 'a.ts', display: 'a.ts', added: 1, deleted: 0 }, { path: 'b.ts', display: 'b.ts', added: 1, deleted: 0 }] } as WorkspaceChangesSummary)
    const row = term.visible().findIndex(line => line.includes('b.ts'))
    expect(row).toBeGreaterThanOrEqual(0)
    tui.applyStoredPrefs({ theme: 'dark', colors: false, mouseInteraction: 'native' })
    press(term, `\x1b[<2;4;${row + 1}M`)
    await flushAsyncPaste()
    expect(prompt).not.toHaveBeenCalled()
    tui.applyStoredPrefs({ theme: 'dark', colors: false, mouseInteraction: 'tui', copyOnSelect: false })
    press(term, `\x1b[<0;3;${row + 1}M\x1b[<32;6;${row + 1}M\x1b[<0;6;${row + 1}m\x1b[<2;4;${row + 1}M`)
    await vi.waitFor(() => expect(copy).toHaveBeenCalled())
    expect(prompt).not.toHaveBeenCalled()
    press(term, '\x1b[27u')
    press(term, `\x1b[<2;4;${row + 1}M`)
    await vi.waitFor(() => expect(prompt.mock.calls[0]?.[0].documentSource?.text).toBe('second file'))
    expect(prompt.mock.calls[0]?.[0].question).toBe('b.ts')
    // A session switch cancels both the reader and its asynchronous continuation.
    tui.setSession({ id: 'other-session', recent: [] })
    await flushAsyncPaste()
    expect(prompt).toHaveBeenCalledTimes(1)
  } finally { await tui.dispose(); await input; rmSync(root, { recursive: true, force: true }) }
})

it.each([false, true])('opens turn Diff from Changed clicks and restores the draft and reading position (colors=%s)', async colors => {
  const term = new ScrollingTerminal(120, 24), tui = new LocalTui(term, 'm', colors, 'dark', async () => {})
  const input = tui.readInput()
  const review = vi.spyOn(tui, 'reviewFiles')
  const handler = vi.fn(async (request: { sessionId: string; turn: number; file?: number; signal: AbortSignal }) => {
    const signal = AbortSignal.any([request.signal, new AbortController().signal])
    await tui.reviewFiles({ title: `Turn ${request.turn} changes`, files: [{ path: 'a.ts', label: 'a.ts' }, { path: 'b.ts', label: 'b.ts' }],
      ...(request.file === undefined ? {} : { initial: request.file }), signal, canEdit: false, canQuote: false,
      read: async index => ({ source: { text: `@@ -1 +1 @@\n-before ${index}\n+after ${index}`, diff: true } }), action: () => {} })
  })
  const off = tui.setWorkspaceReviewHandler(handler)
  try {
    tui.setSession({ id: 'clicked-session', recent: [] })
    for (let i = 0; i < 15; i++) tui.notice(`Earlier line ${i}`)
    tui.event(ev('workspace/changes', { turn: 4 }, 1), undefined, { turn: 4, cwd: '/repo', total: 2, added: 2, deleted: 0,
      files: [{ path: 'a.ts', display: 'a.ts', added: 1, deleted: 0 }, { path: 'b.ts', display: 'b.ts', added: 1, deleted: 0 }] } as WorkspaceChangesSummary)
    for (let i = 0; i < 5; i++) tui.notice(`Later line ${i}`)
    press(term, 'keep draft')
    // Scroll away from the tail while keeping the summary visible.
    press(term, '\x1b[<64;4;6M')
    const before = term.visible(), history = term.scrollback()
    const click = (label: string): void => {
      const row = term.visible().findIndex(line => line.includes(label))
      expect(row).toBeGreaterThanOrEqual(0)
      press(term, `\x1b[<0;9;${row + 1}M\x1b[<0;9;${row + 1}m`)
    }
    click('Changed 2 files')
    await vi.waitFor(() => expect(review).toHaveBeenCalledTimes(1))
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ sessionId: 'clicked-session', turn: 4 })
    expect(handler.mock.calls[0]?.[0].file).toBeUndefined()
    press(term, '\x1b[27u'); await flushAsyncPaste()
    expect(term.visible()).toEqual(before)
    expect(term.scrollback()).toEqual(history)
    click('b.ts')
    await vi.waitFor(() => expect(review).toHaveBeenCalledTimes(2))
    expect(handler.mock.calls[1]?.[0]).toMatchObject({ turn: 4, file: 1 })
    expect(review.mock.calls[1]?.[0].initial).toBe(1)
    expect(term.visible().join('\n')).toContain('after 1')
    const image = tui.prompt({ title: 'Current file image', question: 'Preview', options: [{ label: 'Back', value: 'back' }],
      allowCustom: false, notify: false, signal: review.mock.calls[1]![0].signal })
    expect(handler.mock.calls[1]![0].signal.aborted).toBe(false)
    press(term, '\r'); expect(await image).toBe('back')
    expect(term.visible().join('\n')).toContain('Turn 4 changes')
    press(term, '\x1b[27u'); await flushAsyncPaste()
    expect(term.visible()).toEqual(before)
    press(term, '\r')
    expect(await input).toEqual({ text: 'keep draft', images: [] })
  } finally { off(); await tui.dispose(); await input }
})

it('keeps Changed drag selection, native mouse mode, hidden summaries and stale clicks from opening Diff', async () => {
  const term = new ScrollingTerminal(100, 40), copy = vi.fn(async () => {})
  const tui = new LocalTui(term, 'm', false, 'dark', copy), handler = vi.fn(async () => {})
  const input = tui.readline()
  const off = tui.setWorkspaceReviewHandler(handler)
  try {
    tui.setSession({ id: 's', recent: [] })
    tui.event(ev('workspace/changes', { turn: 2 }, 1), undefined, { turn: 2, cwd: '/repo', total: 1, added: 1, deleted: 0,
      files: [{ path: 'a.ts', display: 'a.ts', added: 1, deleted: 0 }] } as WorkspaceChangesSummary)
    const row = term.visible().findIndex(line => line.includes('Changed 1 file'))
    press(term, `\x1b[<0;3;${row + 1}M\x1b[<32;13;${row + 1}M\x1b[<0;13;${row + 1}m`)
    await vi.waitFor(() => expect(copy).toHaveBeenCalled())
    expect(handler).not.toHaveBeenCalled()
    press(term, '\x1b[27u')
    tui.applyStoredPrefs({ ...tui.prefs(), mouseInteraction: 'native' })
    press(term, `\x1b[<0;9;${row + 1}M\x1b[<0;9;${row + 1}m`)
    expect(handler).not.toHaveBeenCalled()
    tui.applyStoredPrefs({ ...tui.prefs(), mouseInteraction: 'tui' })
    press(term, `\x1b[<0;9;${row + 1}M`)
    tui.applyStoredPrefs({ ...tui.prefs(), showFileChanges: false })
    expect(term.visible().join('\n')).not.toContain('Changed 1 file')
    press(term, `\x1b[<0;9;${row + 1}m`)
    expect(handler).not.toHaveBeenCalled()
    tui.applyStoredPrefs({ ...tui.prefs(), showFileChanges: true })
    expect(term.visible().join('\n')).toContain('Changed 1 file')
    press(term, `\x1b[<0;9;${row + 1}M`)
    tui.setSession({ id: 'other-session', recent: [] })
    press(term, `\x1b[<0;9;${row + 1}m`)
    expect(handler).not.toHaveBeenCalled()
    off()
    press(term, `\x1b[<0;9;${row + 1}M\x1b[<0;9;${row + 1}m`)
    expect(handler).not.toHaveBeenCalled()
  } finally { off(); await tui.dispose(); await input }
})

it('lets an approval supersede a file preview without reopening a picker over the approval', async () => {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-file-priority-'))
  writeFileSync(join(root, 'a.ts'), 'file contents')
  const term = new ScrollingTerminal(80, 60), tui = new LocalTui(term, 'm', false, 'dark', async () => {}, { cwd: root })
  const prompt = vi.spyOn(tui, 'prompt')
  const input = tui.readline()
  try {
    tui.event(ev('tool/call', { callId: 'c', name: 'owned', arguments: '{}' }, 1), { cwd: root, call: { card: 'generic', title: 'Read a.ts', locations: [{ path: 'a.ts' }] } })
    press(term, '\x1bv')
    await vi.waitFor(() => expect(prompt.mock.calls[0]?.[0].documentSource?.text).toBe('file contents'))
    const approval = tui.prompt({ title: 'Approval required', question: 'Allow?', options: [{ label: 'Allow once' }] })
    await flushAsyncPaste()
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(term.visible().join('\n')).toContain('Approval required')
    press(term, '\r')
    await expect(approval).resolves.toBe('Allow once')
    expect(prompt).toHaveBeenCalledTimes(2)
  } finally { await tui.dispose(); await input; rmSync(root, { recursive: true, force: true }) }
})

it('previews a tool in a short expanded turn even when startup chrome stays above the call', async () => {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-short-file-action-'))
  writeFileSync(join(root, 'a.ts'), 'short tool file')
  const term = new ScrollingTerminal(80, 60), tui = new LocalTui(term, 'm', false, 'dark', async () => {}, { cwd: root })
  const prompt = vi.spyOn(tui, 'prompt')
  const input = tui.readline()
  try {
    tui.notice('Started a new session.')
    tui.event(ev('user/message', { content: [{ type: 'text', text: 'Read a file' }], source: { kind: 'user' } }, 1))
    tui.event(ev('turn/start', { turn: 1 }, 2))
    const presentation = { cwd: root, call: { card: 'generic' as const, title: 'Read a.ts', locations: [{ path: 'a.ts' }] } }
    tui.event(ev('tool/call', { callId: 'c', name: 'owned', turn: 1, step: 1, arguments: '{}' }, 3), presentation)
    tui.event(ev('tool/result', { message: { toolCallId: 'c', source: { callId: 'c' }, content: [] } }, 4), presentation)
    tui.event(ev('assistant/message', { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }] } }, 5))
    tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 6))
    tui.setStatus('idle')
    press(term, '\x0f')
    expect(term.visible().join('\n')).toContain('Read a.ts')
    press(term, '\x1bv')
    await vi.waitFor(() => expect(prompt.mock.calls[0]?.[0].documentSource?.text).toBe('short tool file'))
  } finally { await tui.dispose(); await input; rmSync(root, { recursive: true, force: true }) }
})

/** One turn with many steps, each a thought and two reads, then an answer. */
function longTurn(tui: LocalTui, steps: number, answerLines: number, end = true, turn = 1): void {
  const tag = turn === 1 ? 'c' : `t${turn}c`
  let seq = turn * 1000
  tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: `map the project ${turn}` }] }, seq++))
  tui.event(ev('turn/start', { turn }, seq++))
  for (let step = 1; step <= steps; step += 1) {
    tui.event(ev('assistant/message', {
      turn, step, message: { role: 'assistant', content: [{ type: 'reasoning', text: `Step ${step} reads two more files.` }] },
    }, seq++))
    for (const part of ['a', 'b']) {
      const id = `${tag}${step}${part}`
      tui.event(ev('tool/call', { turn, step, callId: id, name: 'read', arguments: `{"path":"src/${id}.ts"}` }, seq++))
      tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: id, content: [{ type: 'text', text: 'x' }] } }, seq++))
    }
    // Settlements coalesce into one paint while a turn runs; a status change
    // paints at once, which is what puts a frame between steps as a real
    // terminal would have.
    tui.setStatus('running')
  }
  const answer = Array.from({ length: answerLines }, (_, i) => `answer ${turn} line ${i}`).join('\n\n')
  if (answer !== '') {
    tui.event(ev('assistant/message', {
      turn, step: steps + 1, message: { role: 'assistant', content: [{ type: 'text', text: answer }] },
    }, seq++))
    tui.setStatus('running')
  }
  if (end) {
    tui.event(ev('turn/end', { turn, reason: { kind: 'completed' } }, seq++))
    tui.setStatus('idle')
  }
}

describe('a run the reader stopped', () => {
  /** One turn whose work overflows a short screen, ended by `reason`. */
  const interruptedTurn = (term: ScrollingTerminal, tui: LocalTui, reason: 'aborted' | 'interrupted') => {
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'map the project' }] }, 1))
    tui.event(ev('turn/start', { turn: 1 }, 2))
    for (let step = 0; step < 8; step += 1) {
      tui.event(ev('tool/call', { turn: 1, step: 1, callId: `c${step}`, name: 'read', arguments: `{"path":"src/${step}.ts"}` }, 10 + step * 2))
      tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: `c${step}`, content: [{ type: 'text', text: `out ${step}` }] } }, 11 + step * 2))
    }
    void term
    tui.event(ev('turn/end', { turn: 1, reason: { kind: reason } }, 40))
  }

  it.each(['aborted', 'interrupted'] as const)('stays open after %s instead of folding under the reader', reason => {
    // Folding here would take the rows the reader was watching out from under
    // them, and — because a fold shortens the document — leave the viewport
    // starting inside rows already committed to native history, which cannot be
    // repainted. That is the half-header and the blank band it produced.
    const term = new ScrollingTerminal(80, 24)
    const tui = new LocalTui(term, 'm', false)
    try {
      interruptedTurn(term, tui, reason)
      const screen = term.visible()
      // No summary row: the run is still shown as work, not as a conclusion.
      expect(screen.some(row => row.includes('Worked for'))).toBe(false)
      // The viewport starts on content, not on a band of empty rows.
      expect(screen[0]?.trim()).not.toBe('')
      // The rows the run produced are still there.
      expect(screen.join('\n')).toContain('src/7.ts')
    } finally { tui.dispose() }
  })

  it('folds once the reader submits again, because they have moved on', () => {
    const term = new ScrollingTerminal(80, 24)
    const tui = new LocalTui(term, 'm', false)
    try {
      interruptedTurn(term, tui, 'aborted')
      tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'next question' }] }, 50))
      const screen = term.visible().join('\n')
      expect(screen).toContain('Worked for')
      expect(screen).toContain('next question')
    } finally { tui.dispose() }
  })

  it('keeps folding a turn that ended on its own conclusion', () => {
    // A completed or failed turn is a conclusion with a summary that describes
    // it; only a turn the reader stopped has nothing to summarize.
    const term = new ScrollingTerminal(80, 24)
    const tui = new LocalTui(term, 'm', false)
    try {
      longTurn(tui, 6, 8)
      expect(term.visible().join('\n')).toContain('Worked for')
    } finally { tui.dispose() }
  })
})

describe('LocalTui folds against a scrolling terminal', () => {
  it('serializes rapid selection copies so an older helper cannot overwrite a newer copy', async () => {
    const term = new ScrollingTerminal(80, 20)
    const pending: Array<() => void> = []
    const copied: string[] = []
    const copy = vi.fn(async (text: string) => {
      await new Promise<void>(resolve => { pending.push(resolve) })
      copied.push(text)
    })
    const tui = new LocalTui(term, 'm', false, 'dark', copy)
    try {
      longTurn(tui, 2, 30)
      const row = term.visible().findIndex(line => line.includes('answer 1 line 29'))
      const col = term.visible()[row]!.indexOf('answer')
      const select = (first: number, last: number) => press(term as never,
        `\x1b[<0;${col + first + 1};${row + 1}M\x1b[<32;${col + last + 1};${row + 1}M\x1b[<0;${col + last + 1};${row + 1}m`)
      select(0, 5)
      await flushAsyncPaste()
      select(9, 12)
      await flushAsyncPaste()
      expect(copy).toHaveBeenCalledTimes(1)
      pending[0]!()
      await flushAsyncPaste()
      expect(copy).toHaveBeenLastCalledWith('line')
      pending[1]!()
      await flushAsyncPaste()
      expect(copied).toEqual(['answer', 'line'])
    } finally { pending.forEach(resolve => resolve()); tui.dispose() }
  })

  it('clears a mouse drag immediately when the terminal resizes', async () => {
    const term = new FakeTerminal()
    const copy = vi.fn(async (_text: string) => {})
    const tui = new LocalTui(term, 'm', false, 'dark', copy)
    try {
      longTurn(tui, 2, 30)
      press(term, '\x1b[<0;3;1M\x1b[<32;6;1M')
      expect(term.captured).toContain('\x1b[7m')
      term.resize(80, 30)
      press(term, '\x1b[<0;6;1m')
      await flushAsyncPaste()
      expect(copy).not.toHaveBeenCalled()
    } finally { tui.dispose() }
  })

  it.each(['alt+c', 'enter', 'right-click'] as const)('copies the selected text with %s when automatic copying is off', async key => {
    const term = new ScrollingTerminal(80, 20)
    const copy = vi.fn(async (_text: string) => {})
    const tui = new LocalTui(term, 'm', false, 'dark', copy)
    try {
      tui.applyStoredPrefs({ theme: 'dark', colors: false, copyOnSelect: false })
      longTurn(tui, 2, 30)
      const row = term.visible().findIndex(line => line.includes('answer 1 line 29'))
      const col = term.visible()[row]!.indexOf('answer')
      press(term as never, `\x1b[<0;${col + 1};${row + 1}M\x1b[<32;${col + 6};${row + 1}M\x1b[<0;${col + 6};${row + 1}m`)
      expect(copy).not.toHaveBeenCalled()
      press(term as never, key === 'right-click' ? `\x1b[<2;${col + 1};${row + 1}M` : key === 'enter' ? '\r' : '\x1bc')
      await flushAsyncPaste()
      expect(copy).toHaveBeenCalledWith('answer')
      expect(tui.prefs()).toMatchObject({ copyOnSelect: false, mouseInteraction: 'auto' })
    } finally { tui.dispose() }
  })

  it.each(['escape', 'wheel', 'changed-content', 'overlay', 'clear'] as const)('discards a stale mouse gesture on %s', async action => {
    const term = new ScrollingTerminal(80, 20)
    const copy = vi.fn(async (_text: string) => {})
    const tui = new LocalTui(term, 'm', false, 'dark', copy)
    try {
      longTurn(tui, 2, 30)
      const row = term.visible().findIndex(line => line.includes('answer 1 line 29'))
      const col = term.visible()[row]!.indexOf('answer')
      press(term as never, `\x1b[<0;${col + 1};${row + 1}M\x1b[<32;${col + 6};${row + 1}M`)
      if (action === 'escape') { press(term as never, '\x1b'); await new Promise(resolve => setTimeout(resolve, 40)) }
      else if (action === 'wheel') press(term as never, '\x1b[<64;10;5M')
      else if (action === 'changed-content') tui.notice('another visible row')
      else { void tui.readline(); press(term as never, action === 'overlay' ? '/settings\r' : '/clear\r') }
      press(term as never, `\x1b[<0;${col + 6};${row + 1}m`)
      await flushAsyncPaste()
      expect(copy).not.toHaveBeenCalled()
    } finally { tui.dispose() }
  })

  it('preserves Ctrl-C interruption and exit behavior while text is selected', async () => {
    const term = new ScrollingTerminal(80, 20)
    const copy = vi.fn(async (_text: string) => {})
    const tui = new LocalTui(term, 'm', false, 'dark', copy)
    const interrupted = vi.fn()
    tui.onInterrupt(interrupted)
    try {
      longTurn(tui, 2, 30, false)
      const row = term.visible().findIndex(line => line.includes('answer 1 line 29'))
      const col = term.visible()[row]!.indexOf('answer')
      press(term as never, `\x1b[<0;${col + 1};${row + 1}M\x1b[<32;${col + 6};${row + 1}M`)
      const pending = tui.readline()
      press(term as never, '\x03')
      expect(interrupted).toHaveBeenCalledOnce()
      expect(copy).not.toHaveBeenCalled()
      press(term as never, '\x03')
      expect(await pending).toBeNull()
    } finally { tui.dispose() }
  })

  it('respects tmux mouse off in Auto and allows explicit TUI or native ownership', () => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false)
    try {
      tui.setTmuxMouseEnabled(false)
      const mark = term.captured.length
      longTurn(tui, 2, 30)
      expect(term.captured.slice(mark)).not.toContain('\x1b[?1000h')
      const tail = term.visible()
      press(term as never, '\x1b[<64;10;5M')
      expect(term.visible()).toEqual(tail)
      tui.applyStoredPrefs({ theme: 'dark', colors: false, mouseInteraction: 'tui' })
      expect(term.captured.slice(mark)).toContain('\x1b[?1002h')
      press(term as never, '\x1b[<64;10;5M')
      expect(term.visible()).not.toEqual(tail)
      tui.applyStoredPrefs({ theme: 'dark', colors: false, mouseInteraction: 'native' })
      expect(term.captured).toContain('\x1b[?1006l\x1b[?1002l\x1b[?1000l')
      press(term as never, '\x1b[F')
      expect(term.visible().join('\n')).toContain('answer 1 line 29')
    } finally { tui.dispose() }
  })

  it('keeps expanded tool selection and folding out of native history', async () => {
    const term = new ScrollingTerminal(80, 20)
    const copy = vi.fn(async (_text: string) => {})
    const tui = new LocalTui(term, 'm', true, 'dark', copy)
    try {
      longTurn(tui, 4, 30)
      const history = term.scrollback()
      press(term as never, '\x0f')
      expect(term.visible()).toEqual(expect.arrayContaining([expect.stringContaining('src/c4a.ts')]))
      const row = term.visible().findIndex(line => line.includes('src/c4a.ts'))
      const col = term.visible()[row]!.indexOf('src/c4a.ts')
      press(term as never, `\x1b[<0;${col + 1};${row + 1}M\x1b[<32;${col + 10};${row + 1}M\x1b[<0;${col + 10};${row + 1}m`)
      await flushAsyncPaste()
      expect(copy).toHaveBeenCalledWith('src/c4a.ts')
      press(term as never, '\x0f')
      expect(term.scrollback()).toEqual(history)
      expect(term.visible().join('\n')).toContain('answer 1 line 29')
      expect(term.visible().join('\n')).not.toContain('Latest · End')
    } finally { tui.dispose() }
  })

  it('activates Jump only on a stationary release, preserving wheel navigation', () => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false)
    try {
      longTurn(tui, 4, 30)
      press(term as never, '\x1b[5~')
      const row = term.visible().findIndex(line => line.includes('Latest · End'))
      const col = term.visible()[row]!.indexOf('Latest')
      press(term as never, `\x1b[<0;${col + 1};${row + 1}M`)
      expect(term.visible().join('\n')).toContain('Latest · End')
      press(term as never, `\x1b[<32;${col + 3};${row + 1}M\x1b[<0;${col + 1};${row + 1}m`)
      expect(term.visible().join('\n')).toContain('Latest · End')
      press(term as never, `\x1b[<0;${col + 1};${row + 1}M\x1b[<0;${col + 1};${row + 1}m`)
      expect(term.visible().join('\n')).not.toContain('Latest · End')
    } finally { tui.dispose() }
  })

  it('copies a mouse selection in the folded view without changing native history or the draft', async () => {
    const term = new ScrollingTerminal(80, 20)
    const copy = vi.fn(async (_text: string) => {})
    const tui = new LocalTui(term, 'm', false, 'dark', copy)
    try {
      longTurn(tui, 2, 30)
      tui.restoreInput({ text: 'keep this draft', images: [] })
      const row = term.visible().findIndex(line => line.includes('answer 1 line 29'))
      const column = term.visible()[row]!.indexOf('answer')
      const history = term.scrollback()
      press(term as never, `\x1b[<0;${column + 1};${row + 1}M`)
      press(term as never, `\x1b[<32;${column + 6};${row + 1}M`)
      expect(term.captured).toContain('\x1b[7m')
      press(term as never, `\x1b[<0;${column + 6};${row + 1}m`)
      await flushAsyncPaste()
      expect(copy).toHaveBeenCalledWith('answer')
      expect(term.scrollback()).toEqual(history)
      expect(term.visible().join('\n')).toContain('keep this draft')
      expect(term.captured).not.toContain('\x1b[?1049h')
    } finally { tui.dispose() }
  })

  it('searches and scrolls tree previews, folds branches, and restores the draft on cancel', async () => {
    const term = new ScrollingTerminal(100, 24)
    const tui = new LocalTui(term, 'm', false)
    tui.restoreInput({ text: 'keep this draft', images: [] })
    const request = { title: 'Session Tree', question: '', presentation: 'tree' as const,
      filterable: true, allowCustom: false, initialValue: 'first',
      actions: [{ key: 'Alt+Enter', label: 'continue branch', valuePrefix: 'continue:' }], options: [
        { value: 'root', label: 'Conversation' },
        { value: 'first', parentValue: 'root', label: 'First request', preview: Array.from({ length: 50 }, (_, i) => `preview row ${i}`).join('\n\n') },
        { value: 'last', parentValue: 'first', label: 'Alternative request' },
      ] }
    try {
      const pending = tui.prompt(request)
      const history = term.scrollback()
      // Ctrl+Down scrolls the preview, not the list: after a few steps the first
      // preview line has left the pane while the branch above it has not moved.
      for (let step = 0; step < 6; step += 1) press(term as never, '\x1b[1;5B')
      expect(term.visible().join('\n')).not.toContain('preview row 0')
      expect(term.visible().join('\n')).toContain('Conversation')
      press(term as never, '\x1b[D')
      expect(term.visible().join('\n')).not.toContain('Alternative request')
      press(term as never, '\x1b[C')
      expect(term.visible().join('\n')).toContain('Alternative request')
      press(term as never, 'Alternative')
      expect(term.visible().join('\n')).toContain('Enter select')
      press(term as never, '\x1b')
      await new Promise(resolve => setTimeout(resolve, 40))
      expect(term.visible().join('\n')).toContain('Session Tree')
      press(term as never, '\x03')
      expect(await pending).toBeNull()
      expect(term.visible().join('\n')).toContain('keep this draft')
      expect(term.scrollback()).toEqual(history)
      const continued = tui.prompt(request)
      press(term as never, 'Alternative\x1b\r')
      expect(await continued).toBe('continue:last')
    } finally { tui.dispose() }
  })

  it('shows the configured turn expansion key and opens the turn with it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'omdsh-turn-hint-'))
    const path = join(directory, 'keys.json')
    writeFileSync(path, JSON.stringify({ 'ctrl+o': 'retry', 'alt+d': 'toggle-tools' }))
    const term = new ScrollingTerminal(80, 30)
    const tui = new LocalTui(term, 'm', false, 'dark', async () => {}, { keybindingsPath: path })
    try {
      longTurn(tui, 1, 1)
      expect(term.visible().join('\n')).toContain('Alt+D to expand')
      expect(term.visible().join('\n')).not.toContain('Ctrl+O to expand')
      press(term as never, '\x1bd')
      expect(term.visible().join('\n')).not.toContain('Worked for')
      press(term as never, '\x1bd')
      expect(term.visible().join('\n')).toContain('Alt+D to expand')
    } finally {
      tui.dispose()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each([false, true])('keeps a short folded turn compact after expanding tool details (colors=%s)', colors => {
    const term = new ScrollingTerminal(127, 58)
    const tui = new LocalTui(term, 'm', colors)
    try {
      longTurn(tui, 6, 8)
      // Spare rows sit above the conversation, so a short turn hugs the composer
      // instead of the top of the screen.
      const firstContentAtStart = term.visible().findIndex(row => row.trim() !== '')
      expect(firstContentAtStart).toBeGreaterThanOrEqual(0)
      expect(term.visible().findIndex(row => row.includes('🐳'))).toBe(53)
      const history = term.scrollback()
      press(term as never, '\x0f')
      press(term as never, '\x1bo')
      press(term as never, '\x0f')
      const screen = term.visible()
      const summary = screen.findIndex(row => row.includes('Worked for'))
      const prompt = screen.findIndex(row => row.includes('map the project 1'))
      const firstContent = screen.findIndex(row => row.trim() !== '')
      expect(summary).toBeGreaterThanOrEqual(0)
      expect(prompt).toBeGreaterThanOrEqual(0)
      expect(summary - prompt).toBeLessThanOrEqual(4)
      // The conversation ends at the composer, not at the top of the screen.
      const composerAt = screen.findIndex(row => row.includes('🐳'))
      expect(composerAt).toBeGreaterThan(0)
      expect(screen.slice(firstContent, composerAt).join('\n')).toContain('map the project 1')
      expect(screen.join('\n')).toContain('answer 1 line 7')
      expect(term.scrollback()).toEqual(history)
    } finally { tui.dispose() }
  })

  it('enters browsing from the live tail with the wheel and keeps the prompt at the top', () => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false)
    try {
      longTurn(tui, 2, 40)
      const history = term.scrollback()
      const before = term.visible()
      press(term as never, '\x1b[<64;10;5M')
      const after = term.visible()
      expect(after).not.toEqual(before)
      expect(after.join('\n')).toContain('Latest · End')
      expect(after[0]).toContain('map the project 1')
      expect(after.slice(1).join('\n')).not.toContain('map the project 1')
      expect(after.join('\n')).toContain('answer 1 line 3')
      for (let step = 0; step < 8; step += 1) {
        press(term as never, '\x1b[<64;10;5M')
        expect(term.visible()[0]).toContain('map the project 1')
        expect(term.visible().slice(1).join('\n')).not.toContain('map the project 1')
      }
      press(term as never, '\x1b[<65;10;5M'.repeat(12))
      expect(term.visible()).toEqual(before)
      expect(term.scrollback()).toEqual(history)
    } finally { tui.dispose() }
  })

  it.each([false, true])('keeps a fitting live transcript stationary when scrolling up (colors=%s)', colors => {
    const term = new ScrollingTerminal(180, 60)
    const tui = new LocalTui(term, 'm', colors)
    try {
      longTurn(tui, 2, 0, false)
      const before = term.visible()
      const history = term.scrollback()
      expect(before.findIndex(row => row.includes('map the project 1'))).toBeGreaterThan(15)
      for (const key of ['\x1b[<64;10;5M', '\x1b[5~', '\x1b[1;2A']) {
        press(term, key)
        expect(term.visible(), `scroll ${JSON.stringify(key)}`).toEqual(before)
        tui.setStatus('running')
        expect(term.visible(), 'next live repaint').toEqual(before)
      }
      expect(term.scrollback()).toEqual(history)
    } finally { tui.dispose() }
  })

  it.each(['end', 'click'] as const)('returns to the latest message with %s without replaying history', action => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false)
    try {
      longTurn(tui, 30, 30)
      const history = term.scrollback()
      press(term as never, '\x0f')
      expect(term.visible()[0]).toContain('map the project 1')
      const row = term.visible().findIndex(line => line.includes('Latest · End'))
      expect(row).toBeGreaterThan(0)
      if (action === 'end') press(term as never, '\x1b[F')
      else {
        const column = term.visible()[row]!.indexOf('Latest')
        press(term as never, `\x1b[<0;${column + 1};${row + 1}M\x1b[<0;${column + 1};${row + 1}m`)
      }
      expect(term.visible().join('\n')).not.toContain('Latest · End')
      expect(term.visible().join('\n')).toContain('answer 1 line 29')
      expect(term.scrollback()).toEqual(history)
      expect(term.captured).toContain('\x1b[?1000h\x1b[?1002h\x1b[?1006h')
    } finally { tui.dispose() }
  })

  it('pins the current prompt during long output and switches it for a later turn', () => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false)
    try {
      longTurn(tui, 2, 30)
      expect(term.visible()[0]).toContain('map the project 1')
      longTurn(tui, 2, 30, false, 2)
      expect(term.visible()[0]).toContain('map the project 2')
      expect(term.scrollback().filter(row => row.includes('map the project 1'))).toHaveLength(1)
      press(term as never, '\x1b[5~')
      expect(term.visible().join('\n')).toContain('Latest · End')
      press(term as never, '\x1b[F')
      expect(term.visible()[0]).toContain('map the project 2')
    } finally { tui.dispose() }
  })

  it.each([false, true].flatMap(color => [false, true].map(browsing => ({ color, browsing }))))('does not recommit frozen prompts after a density shrink and later growth (color=$color, browsing=$browsing)', ({ color, browsing }) => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', color)
    try {
      tui.applyStoredPrefs({ theme: 'dark', colors: color, foldDensity: 'verbose' })
      longTurn(tui, 30, 5)
      expect(term.scrollback().filter(row => row.includes('map the project 1'))).toHaveLength(1)
      const frozen = term.scrollback()
      if (browsing) {
        press(term as never, '\x1b[5~')
        expect(term.visible().join('\n')).toContain('Latest · End')
      }
      tui.applyStoredPrefs({ theme: 'dark', colors: color, foldDensity: 'standard' })
      longTurn(tui, 1, 30, true, 2)
      if (browsing) {
        expect(term.scrollback()).toEqual(frozen)
        for (let page = 0; page < 24; page += 1) press(term as never, '\x1b[6~')
      }
      expect(term.scrollback().filter(row => row.includes('map the project 1'))).toHaveLength(1)
      expect(term.visible().join('\n')).toContain('answer 2 line 29')
      longTurn(tui, 1, 30, true, 3)
      expect(term.scrollback().slice(0, frozen.length)).toEqual(frozen)
      expect(term.scrollback().filter(row => row.includes('map the project 1'))).toHaveLength(1)
      expect(term.scrollback().filter(row => row.includes('answer 2 line 29'))).toHaveLength(1)
      expect(term.scrollback().filter(row => row.includes('answer 3 line 7'))).toHaveLength(1)
      expect(term.visible().join('\n')).toContain('answer 3 line 29')
    } finally { tui.dispose() }
  })

  it.each([false, true].flatMap(color => (['trajectory', 'settings', 'card', 'plan-review', 'document'] as const).map(surface => ({ color, surface }))))(
    'restores the inspected run after closing $surface (color=$color)', async ({ surface, color }) => {
      const term = new ScrollingTerminal(80, 20)
      const tui = new LocalTui(term, 'm', color)
      try {
        const input = tui.readInput()
        if (surface === 'trajectory') tui.setCommands([{ name: 'trajectory', description: 'Inspect session trajectory' }])
        longTurn(tui, 30, 30)
        press(term, '\x0f')
        press(term, '\x1b[5~')
        if (surface === 'trajectory' || surface === 'settings') press(term, 'x\x7f')
        const screen = term.visible()
        const history = term.scrollback()
        const mark = term.captured.length
        let answer: Promise<unknown> | undefined
        if (surface === 'trajectory') {
          press(term, '/trajectory\r')
          expect(await input).toEqual({ text: '/trajectory', images: [] })
          tui.openTrajectory([])
        }
        else if (surface === 'settings') press(term, '/settings\r')
        else answer = tui.prompt({
          title: 'Choose', question: 'Continue?', presentation: surface,
          detail: '# Plan\n\n- Read the project',
          options: [{ label: 'Approve' }, { label: 'Cancel' }], allowCustom: false,
          ...(surface === 'plan-review' ? { approveValue: 'Approve' } : {}),
        })
        expect(term.visible()).not.toEqual(screen)
        const releasesMouse = surface === 'settings'
        if (releasesMouse) expect(term.captured.slice(mark)).toContain('\x1b[?1000l')
        else expect(term.captured.slice(mark)).not.toContain('\x1b[?1000l')
        const restore = term.captured.length
        press(term, '\x1b[27u')
        if (answer !== undefined) expect(await answer).toBeNull()
        expect(term.visible()).toEqual(screen)
        expect(term.scrollback()).toEqual(history)
        if (releasesMouse) expect(term.captured.slice(restore)).toContain('\x1b[?1000h')
        // Scroll down so the check also works when paging reached the top.
        press(term, '\x1b[<65;5;5M')
        expect(term.visible()).not.toEqual(screen)
        press(term, '\x0f')
        tui.dispose()
        expect(term.captured).toContain('\x1b[?1000l')
      } finally { tui.dispose() }
    },
  )

  it.each([false, true])('keeps background output in inspection and reveals requested command output (color=%s)', (color) => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', color)
    try {
      longTurn(tui, 30, 40)
      press(term, '\x0f')
      const content = () => term.visible().filter(line => line.includes('Read file') || line.includes('Step '))
      const before = content()
      expect(before.length).toBeGreaterThan(0)
      const history = term.scrollback()
      const mark = term.captured.length
      tui.commandOutput("What's New", 'background release notes')
      tui.notice('background notice')
      expect(content()).toEqual(before)
      expect(term.visible().join('\n')).not.toContain('background release notes')
      expect(term.captured.slice(mark)).not.toContain('\x1b[?1000l')
      expect(term.scrollback()).toEqual(history)
      tui.commandOutput('session', 'requested command result', { focus: true })
      expect(term.visible().join('\n')).toContain('requested command result')
      expect(term.captured.slice(mark)).not.toContain('\x1b[?1000l')
      expect(term.scrollback().slice(0, history.length)).toEqual(history)
    } finally { tui.dispose() }
  })

  it('opens a long finished run at its first process row and lets the reader page down', () => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 30, 30)
    const history = term.scrollback()
    press(term as never, '\x0f')

    const opened = term.visible().join('\n')
    expect(opened).toContain('src/c1a.ts')
    expect(opened).not.toContain('src/c30b.ts')
    press(term as never, '\x1b[6~')
    expect(term.visible().join('\n')).not.toContain('src/c1a.ts')
    expect(term.scrollback()).toEqual(history)
    tui.dispose()
  })

  it('scrolls an opened run with the mouse wheel without changing native history', () => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 30, 1)
    press(term as never, '\x0f')
    const before = term.visible()
    const history = term.scrollback()
    press(term as never, '\x1b[<64;10;5M')
    expect(term.visible()).not.toEqual(before)
    press(term as never, '\x1b[<65;10;5M')
    expect(term.visible()).toEqual(before)
    expect(term.scrollback()).toEqual(history)
    tui.dispose()
  })

  it('opens a completed call on demand and preserves history while paging its output', () => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false)
    try {
      tui.event(ev('turn/start', { turn: 1 }, 0))
      tui.event(ev('tool/call', { callId: 'long-result', name: 'bash', arguments: '{}' }, 1))
      tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: 'long-result', content: [{
        type: 'text', text: Array.from({ length: 60 }, (_, i) => `result line ${i}`).join('\n'),
      }] } }, 2))
      tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3))
      const screen = term.visible(), history = term.scrollback()
      press(term, '\x0f')
      expect(term.visible().join('\n')).not.toContain('result line')
      press(term, '\r')
      expect(term.visible().join('\n')).toContain('result line 0')
      for (let page = 0; page < 10 && !term.visible().some(line => line.includes('result line 59')); page++) {
        press(term, '\x1b[6~')
      }
      expect(term.visible().join('\n')).toContain('result line 59')
      press(term, '\x1b[F')
      expect(term.visible()).toEqual(screen)
      expect(term.scrollback()).toEqual(history)
    } finally { tui.dispose() }
  })

  it.each(['\x0f', '\x1b[F'])('resets Alt+O details on return via %j without touching history', close => {
    const term = new ScrollingTerminal(90, 34)
    const tui = new LocalTui(term, 'm', false)
    try {
      tui.event(ev('turn/start', { turn: 1 }, 0))
      tui.event(ev('tool/call', { turn: 1, step: 1, callId: 'details', name: 'read', arguments: '{"path":"a.ts","offset":42}' }, 1))
      tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: 'details', content: [{ type: 'text', text: 'HIDDEN_FIRST\nHIDDEN_LAST' }] } }, 2))
      tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3))
      const screen = term.visible()
      const history = term.scrollback()
      press(term, '\x0f')
      expect(term.visible().join('\n')).not.toContain('HIDDEN_FIRST')
      press(term, '\x1bo')
      expect(term.visible().join('\n')).toContain('HIDDEN_FIRST')
      expect(term.visible().join('\n')).toContain('"offset": 42')
      press(term, '\x1bo')
      expect(term.visible().join('\n')).not.toContain('HIDDEN_FIRST')
      expect(term.visible().join('\n')).toContain('Read file · a.ts')
      press(term, '\x1bo')
      press(term, close)
      expect(term.visible()).toEqual(screen)
      expect(term.scrollback()).toEqual(history)
      press(term, '\x0f')
      expect(term.visible().join('\n')).not.toContain('HIDDEN_FIRST')
    } finally { tui.dispose() }
  })

  it('keeps new calls detailed while a live turn grows and settles', () => {
    const term = new ScrollingTerminal(90, 50)
    const tui = new LocalTui(term, 'm', false)
    const read = (id: string, step: number): void => {
      tui.event(ev('tool/call', { turn: 1, step, callId: id, name: 'read', arguments: `{"path":"${id}"}` }, step * 2))
      tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: id, content: [{ type: 'text', text: `BODY_${id}` }] } }, step * 2 + 1))
    }
    try {
      tui.event(ev('turn/start', { turn: 1 }, 0))
      read('first', 1)
      press(term, '\x1bo')
      expect(term.visible().join('\n')).toContain('BODY_first')
      read('second', 2)
      tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 6))
      expect(term.visible().join('\n')).toContain('BODY_second')
      press(term, '\x1bo')
      expect(term.visible().join('\n')).not.toContain('BODY_')
      press(term, '\x1b[F')
      expect(term.visible().join('\n')).toContain('Worked for')
    } finally { tui.dispose() }
  })

  it('targets the turn being read rather than expanding every turn', () => {
    const term = new ScrollingTerminal(90, 30)
    const tui = new LocalTui(term, 'm', false)
    try {
      for (const turn of [1, 2]) {
        tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: `question ${turn}` }] }, turn * 10))
        tui.event(ev('turn/start', { turn }, turn * 10 + 1))
        tui.event(ev('tool/call', { turn, step: 1, callId: `read-${turn}`, name: 'read', arguments: '{"path":"file"}' }, turn * 10 + 2))
        tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: `read-${turn}`, content: [{ type: 'text', text: `BODY_TURN_${turn}` }] } }, turn * 10 + 3))
        tui.event(ev('assistant/message', { turn, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'Answer paragraph.\n\n'.repeat(15) }] } }, turn * 10 + 4))
        tui.event(ev('turn/end', { turn, reason: { kind: 'completed' } }, turn * 10 + 5))
      }
      const history = term.scrollback()
      press(term, '\x1bo')
      expect(term.visible().join('\n')).toContain('BODY_TURN_2')
      expect(term.visible().join('\n')).not.toContain('BODY_TURN_1')
      press(term, '\x1b[F')
      press(term, '\x1b[5~'.repeat(10))
      press(term, '\x1bo')
      expect(term.visible().join('\n')).toContain('BODY_TURN_1')
      expect(term.visible().join('\n')).not.toContain('BODY_TURN_2')
      press(term, '\x1bo')
      expect(term.visible().join('\n')).not.toContain('BODY_TURN_1')
      expect(term.scrollback()).toEqual(history)
    } finally { tui.dispose() }
  })

  it('opens a long thought from its beginning', () => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false)
    tui.event(ev('assistant/message', {
      turn: 1, step: 1, message: { role: 'assistant', content: [
        { type: 'reasoning', text: Array.from({ length: 40 }, (_, i) => `Reasoning paragraph ${i}.`).join('\n\n') },
        { type: 'text', text: 'A short answer.' },
      ] },
    }, 1))
    press(term as never, '\x0f\r')
    expect(term.visible().join('\n')).toContain('Reasoning paragraph 0.')
    expect(term.visible().join('\n')).not.toContain('Reasoning paragraph 39.')
    tui.dispose()
  })

  it('enters process browsing during a live turn and returns without changing history', () => {
    // A live turn has no header to open, so the key reads the row under the
    // viewport. Closing it used to leave only the composer's last edge and the
    // footer over a blank screen.
    const term = new ScrollingTerminal(80, 30)
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 20, 0, false)
    tui.event(ev('assistant/message', {
      turn: 1, step: 21, message: { role: 'assistant', content: [{ type: 'reasoning', text: 'Still going.' }] },
    }, 900))
    tui.setStatus('running')
    const screen = term.visible()
    const history = term.scrollback()
    expect(screen.join('\n')).not.toMatch(/^[▸▾]/mu)
    expect(screen.join('\n')).toContain('Still going.')
    press(term as never, '\x0f')
    expect(term.visible().join('\n')).toContain('Process ·')
    expect(term.visible().join('\n')).toContain('❯')
    press(term as never, '\x0f')

    expect(term.visible()).toEqual(screen)
    expect(term.scrollback()).toEqual(history)
    tui.dispose()
  })

  it('never freezes a run that is still at work into history', () => {
    // A live run's newest rows scroll and it folds when the turn ends; a row of
    // it frozen mid-turn would sit in history in a shape that never settled.
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 30, 30, false)

    expect(term.scrollback().some(row => row.includes('Working'))).toBe(false)
    expect(term.scrollback().some(row => row.includes('Read file ·'))).toBe(false)
    tui.dispose()
  })

  it('commits a finished turn to history once, folded, with its answer once', () => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 30, 30)
    const all = [...term.scrollback(), ...term.visible()]

    expect(all.filter(row => /^  ▸ Worked for/u.test(row))).toHaveLength(1)
    expect(all.filter(row => row.includes('answer 1 line 7'))).toHaveLength(1)
    expect(all.some(row => row.includes('Read file ·'))).toBe(false)
    tui.dispose()
  })

  it('opens the finished run on ctrl+o, not every call in the session', () => {
    // Following the tail aims past the answer, at the changed-file record; the
    // key fell through to opening every call's full output.
    const term = new ScrollingTerminal(80, 120)
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 1, 1)
    longTurn(tui, 3, 2, true, 2)
    tui.event(ev('workspace/changes', { turn: 2 }, 2950))
    press(term as never, '\x0f')
    const screen = term.visible().join('\n')

    expect(screen).not.toMatch(/^▾ Worked for/mu)
    expect(screen).toContain('src/t2c3b.ts')
    // The previous turn remains folded; only this turn's calls read in full.
    expect(screen).not.toMatch(/╭─── [✔✘⟳•]/u)
    expect(screen).not.toContain('src/c1a.ts')
    tui.dispose()
  })

  it('reads the last run in a browsing frame even when it opens at the very end', () => {
    // Opening the newest run from the tail focuses a row that is already at the
    // end, which read as "back at the tail" and put the opened run in the flow;
    // closing it then shrank rows history already held.
    const term = new ScrollingTerminal(80, 24)
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 12, 12)
    longTurn(tui, 2, 1, true, 2)
    const screen = term.visible()
    const history = term.scrollback()
    press(term as never, '\x0f')
    // Any later paint — a spinner tick, a status change — must still be a
    // browsing frame, not the flow with the run opened in it.
    tui.setStatus('idle')
    expect(term.visible().join('\n')).toContain('src/t2c2b.ts')
    expect(term.scrollback()).toEqual(history)
    press(term as never, '\x0f')

    expect(term.visible()).toEqual(screen)
    expect(term.scrollback()).toEqual(history)
    tui.dispose()
  })

  it('keeps an opened run open when the whole transcript fits on the screen', () => {
    // With nothing to scroll, the browsing frame sits at the end and read as
    // "back at the tail", which dropped the opening before it was ever seen.
    const term = new ScrollingTerminal(80, 60)
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 2, 1)
    press(term as never, '\x0f')

    expect(term.visible().join('\n')).toContain('src/c1a.ts')
    tui.setStatus('idle')
    expect(term.visible().join('\n')).toContain('src/c1a.ts')
    tui.dispose()
  })

  it('leaves the screen and history exactly as they were after an inspection', () => {
    // Opening a run is reading it: it happens in a browsing frame, so closing
    // it has nothing in the flow to undo — no blank screen, nothing repeated.
    const term = new ScrollingTerminal(80, 24)
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 12, 12)
    const screen = term.visible()
    const history = term.scrollback()
    press(term as never, '\x0f')
    expect(term.visible().join('\n')).toContain('src/c1a.ts')
    press(term as never, '\x0f')

    expect(term.visible()).toEqual(screen)
    expect(term.scrollback()).toEqual(history)
    tui.dispose()
  })

  it('writes nothing to history a second time when a finished run opens and closes', () => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 30, 30)
    const settled = term.scrollback()
    press(term as never, '\x0f')
    press(term as never, '\x0f')

    expect(term.scrollback()).toEqual(settled)
    expect(term.visible().join('\n')).toContain('answer 1 line 29')
    expect(term.visible().join('\n')).toContain('🐳')
    tui.dispose()
  })
})

describe('LocalTui (tty)', () => {
  it.each(['en', 'zh-CN'] as const)('shows the effective Plan target before typing and clears it on session changes (%s)', language => {
    const term = new ScrollingTerminal(90, 24), tui = new LocalTui(term, 'm', language === 'zh-CN')
    tui.applyStoredPrefs({ uiLanguage: language })
    try {
      for (const [active, pending, planning] of [[false, false, false], [false, true, true], [true, false, true], [true, true, false]] as const) {
        tui.setSession({ id: 'plan', recent: [], controls: { plan: { active, pending } } })
        const screen = term.visible().join('\n')
        expect(screen.includes(language === 'en' ? 'Describe your task to generate a plan' : '描述任务以生成计划')).toBe(planning)
        if (active || pending) expect(screen).toContain(active && pending ? 'plan off…' : 'plan')
      }
      tui.setSession({ id: 'other', recent: [], controls: {} })
      expect(term.visible().join('\n')).toContain(language === 'en' ? 'Ask anything' : '输入你的问题')
    } finally { tui.dispose() }
  })

  it.each(['en', 'zh-CN'] as const)('reviews a real Harness question with bounded scrolling and unambiguous revision feedback (%s)', async language => {
    const { default: AgentRegistry } = await import('@deepseek-ai/dsh-agent')
    const { default: Projections } = await import('@deepseek-ai/dsh-session-projection')
    const { default: UserQuestions } = await import('@deepseek-ai/dsh-user-questions')
    const { Session } = await import('@deepseek-ai/dsh-session')
    const { bindHumanInteraction } = await import('../session/interaction-adapter.ts')
    const ctx = new Context(), term = new ScrollingTerminal(72, 24), tui = new LocalTui(term, 'm', language === 'zh-CN')
    tui.applyStoredPrefs({ uiLanguage: language })
    await ctx.plugin(AgentRegistry); await ctx.plugin(Projections); await ctx.plugin(UserQuestions)
    const session = Session.create(SessionId('plan-review-keys'))
    const agent = { id: session.id, session } as never
    ctx.agents.enter(agent, undefined)
    const off = bindHumanInteraction(ctx, tui, () => agent), abort = new AbortController()
    const request = ctx.userQuestions.ask({ agent, signal: abort.signal, questions: [{ id: 'plan', question: 'Approve this plan and leave plan mode?',
      detail: '# Original plan\n\n' + Array.from({ length: 60 }, (_, index) => `- Task ${index + 1}`).join('\n'),
      options: [{ label: 'Approve' }, { label: 'Keep planning' }], intent: { kind: 'plan-review', approve: 'Approve' } }] })
    try {
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain(language === 'en' ? 'Approve this plan' : '批准此计划')
      expect(term.visible().join('\n')).toContain('Original plan')
      press(term, '\x1b[F')
      expect(term.visible().join('\n')).toContain('Task 60')
      press(term, '\t\r'); await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain(language === 'en' ? 'What should the revised plan change?' : '计划需要修改哪些内容？')
      press(term, 'Approve\r')
      await expect(request).resolves.toEqual({ answers: [{ id: 'plan', selected: ['Keep planning'], custom: 'Approve' }] })
      expect(term.visible().filter(row => row.includes('🐳'))).toHaveLength(1)
    } finally { abort.abort(); await request.catch(() => {}); await off(); tui.dispose(); await ctx.fiber.dispose() }
  })

  it('repaints the footer when the live Agent control changes', () => {
    const term = new FakeTerminal()
    term.columns = 100
    const tui = new LocalTui(term, 'm', false)
    tui.setSession({
      id: 'session-controls',
      recent: [],
      controls: {
        agentPreset: 'standard',
        plan: { active: false, pending: false },
      },
    })
    expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).toContain('m · standard')

    tui.setSession({
      id: 'session-controls',
      recent: [],
      controls: {
        agentPreset: 'code',
        plan: { active: false, pending: false },
      },
    })
    const screen = emulatedScreenRows(term.captured).map(stripAnsi).join('\n')
    expect(screen).toContain('m · ptc')
    expect(screen).not.toContain('m · standard')
    tui.dispose()
  })

  it('renders the product name and package version in the welcome title', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as { version: string }
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)

    // The header names the product; the command a reader types stays `omdsh`.
    expect(stripAnsi(term.captured)).toContain(`Oh-My-DSH v${manifest.version}`)
    tui.dispose()
  })

  it('keeps the welcome card when a durable transcript replaces the startup frame', () => {
    const term = new FakeTerminal()
    term.rows = 12
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { terminalProfile: 'direct' })

    const restored = Array.from({ length: 30 }, (_, index) => `restored-${index}`).join('\n')
    tui.replaceSession([
      ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'resumed prompt' }] }, 1),
      ev('assistant/message', {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'text', text: restored }] },
        stream: [],
      }, 2),
    ])

    // The replacement appends below a seam and leaves the welcome card's own
    // output in the terminal's history. It used to erase it.
    expect(term.captured).not.toContain('\x1b[3J')
    const screen = emulatedScreenRows(term.captured).map(stripAnsi).join('\n')
    expect(screen).toContain('session opened · earlier output retained')
    expect(screen).toContain('resumed prompt')
    expect(screen).toContain('restored-0')
    expect(screen).toContain('restored-15')
    expect(screen).toContain('restored-29')
    expect(screen).toContain('Into the Unknown')
    tui.dispose()
  })

  it('defers the production first frame until the initial session is available', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      deferInitialRender: true,
      terminalProfile: 'direct',
    })

    expect(term.captured).not.toContain('Into the Unknown')
    press(term, '\x1b[?62;22c')
    expect(term.captured).not.toContain('\x1b[3J')
    tui.setStatus('running')
    expect(term.captured).not.toContain('Into the Unknown')

    tui.replaceSession([
      ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'initial session' }] }, 1),
    ], undefined, 'idle', 'initial')
    expect(term.captured).toContain('Into the Unknown')
    expect(term.captured).toContain('initial session')
    expect(term.captured).not.toContain('session opened · earlier output retained')
    expect(term.captured).not.toContain('\x1b[3J')
    tui.dispose()
  })

  it.each([false, true])('refreshes the same transcript without a seam and preserves native history (color=%s)', (color) => {
    const term = new ScrollingTerminal(80, 20)
    term.history.push('shell output before omdsh')
    const tui = new LocalTui(term, 'm', color, 'dark', copyToClipboard, { deferInitialRender: true })
    press(term, '\x1b[?62;22c')
    const events = [ev('user/message', {
      source: { kind: 'user' }, content: [{ type: 'text', text: Array.from({ length: 40 }, (_, i) => `old prompt ${i}`).join('\n') }],
    }, 1)]
    tui.replaceSession(events, undefined, 'idle', 'initial')
    const history = term.scrollback()
    tui.replaceSession(events, undefined, 'idle', 'refresh')

    expect(term.scrollback()).toEqual(history)
    tui.replaceSession(events, undefined, 'idle', 'refresh')
    expect(term.scrollback()).toEqual(history)
    expect([...term.scrollback(), ...term.visible()].join('\n')).not.toContain('session opened')
    expect(term.visible().join('\n')).toContain('old prompt 39')
    tui.dispose()
  })

  it('refreshes different projections without replaying or retaining a stale row index', () => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { deferInitialRender: true })
    press(term, '\x1b[?62;22c')
    const events = [ev('user/message', { source: { kind: 'user' }, content: [{
      type: 'text', text: Array.from({ length: 40 }, (_, index) => `parent prompt ${index}`).join('\n'),
    }] }, 1)]
    tui.replaceSession(events, undefined, 'idle', 'initial')
    const history = term.scrollback()
    tui.replaceSession([ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'child prompt' }] }, 1)], undefined, 'idle', 'refresh')
    expect(term.visible().join('\n')).toContain('child prompt')
    expect(term.visible().join('\n')).not.toContain('parent prompt')
    expect(term.scrollback()).toEqual(history)
    tui.replaceSession(events, undefined, 'idle', 'refresh')
    expect(term.visible().join('\n')).toContain('parent prompt 39')
    expect(term.scrollback()).toEqual(history)
    tui.dispose()
  })

  it('retains frozen transcript rows above the boundary when /new opens an empty session', () => {
    const term = new ScrollingTerminal(80, 20)
    term.history.push('shell output before omdsh')
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { deferInitialRender: true })
    press(term, '\x1b[?62;22c')
    tui.replaceSession([ev('user/message', {
      source: { kind: 'user' }, content: [{ type: 'text', text: Array.from({ length: 40 }, (_, i) => `earlier prompt ${i}`).join('\n') }],
    }, 1)], undefined, 'idle', 'initial')
    const history = term.scrollback()
    tui.replaceSession([], undefined, 'idle', 'new')

    expect(term.scrollback().slice(0, history.length)).toEqual(history)
    expect(history.join('\n')).toContain('earlier prompt 0')
    expect(term.visible().join('\n')).toContain('session opened · earlier output retained')
    expect(term.scrollback()[0]).toBe('shell output before omdsh')
    tui.dispose()
  })

  it('does not request ED3 inside a terminal multiplexer', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { terminalProfile: 'multiplexer' })
    tui.replaceSession([
      ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'multiplexed' }] }, 1),
    ])

    expect(term.captured).not.toContain('\x1b[3J')
    expect(term.captured).toContain('multiplexed')
    tui.dispose()
  })

  it('does not request ED3 through ConPTY', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { terminalProfile: 'conpty' })
    tui.replaceSession([
      ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'conpty replay' }] }, 1),
    ])

    expect(term.captured).not.toContain('\x1b[3J')
    expect(term.captured).toContain('conpty replay')
    tui.dispose()
  })

  it('coalesces multiplexer resize bursts before repainting', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      terminalProfile: 'multiplexer',
      resizeDebounceMs: 5,
    })
    const beforeResize = term.writes

    term.resize(70, 20)
    term.resize(72, 21)
    expect(term.writes).toBe(beforeResize)

    await new Promise<void>(resolve => { setTimeout(resolve, 15) })
    expect(term.writes).toBe(beforeResize + 1)
    tui.dispose()
  })

  it('renders typed input inside the ruled editor', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', true)
    press(term, 'ab')
    expect(term.captured).toContain('ab')
    expect(term.captured).toMatch(/^─+ ⠋|🐳/mu)
    expect(term.raw).toBe(true)
    tui.dispose()
  })

  it('clears the screen before the first frame in tty mode', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    expect(term.captured).toContain('\x1b[2J\x1b[H')
    tui.dispose()
  })

  it('owns composer mouse input at startup and releases it on disposal', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.dispose()
    expect(term.captured).toContain('\x1b[?1000h')
    expect(term.captured).toContain('\x1b[?1006h')
    expect(term.captured).toContain('\x1b[?1000l')
    expect(term.captured).toContain('\x1b[?1006l')
    expect(term.captured).toContain('\x1b[?2004l')
    expect(term.raw).toBe(false)
    expect(term.destroyed).toBe(true)
  })

  it('handles the wheel both while browsing with PgUp and after returning with End', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 12, 30)
    press(term, '\x1b[5~')
    expect(term.captured).toContain('\x1b[?1000h')
    const mark = term.captured.length
    press(term, '\x1b[<64;10;5M\x1b[<65;10;5M')
    expect(term.captured.length).toBeGreaterThan(mark)
    press(term, '\x1b[F')
    expect(term.captured.slice(mark)).not.toContain('\x1b[?1006l\x1b[?1002l\x1b[?1000l')
    tui.dispose()
  })

  it.each(['close', 'tail', 'clear', 'dispose'])('keeps mouse ownership correct when leaving inspection via %s', (exit) => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    // Keep the transcript scrollable after folding; the composer also owns
    // mouse input after clearing or returning to the live tail.
    longTurn(tui, 30, 1, false)
    expect(term.captured).toContain('\x1b[?1000h')
    press(term, '\x0f')
    expect(term.captured).toContain('\x1b[?1000h\x1b[?1002h\x1b[?1006h')
    const mark = term.captured.length
    if (exit === 'close') press(term, '\x0f')
    else if (exit === 'tail') press(term, '\x1b[6~'.repeat(6))
    else if (exit === 'clear') press(term, '/clear\r')
    else tui.dispose()
    if (exit === 'dispose') expect(term.captured.slice(mark)).toContain('\x1b[?1006l\x1b[?1002l\x1b[?1000l')
    else expect(term.captured.slice(mark)).not.toContain('\x1b[?1006l\x1b[?1002l\x1b[?1000l')
    tui.dispose()
  })

  it('releases inspection mouse tracking before handing the tty to an external editor', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 12, 1)
    press(term, '\x0f')
    let modesAtHandoff = ''
    term.input.setRawMode = (on: boolean): void => {
      term.raw = on
      if (!on) modesAtHandoff = term.captured
    }
    vi.stubEnv('VISUAL', '/omdsh-missing-editor-command')
    try {
      press(term, '\x18')
      expect(modesAtHandoff).toContain('\x1b[?1006l\x1b[?1002l\x1b[?1000l')
      expect(term.raw).toBe(true)
      expect(term.captured.slice(modesAtHandoff.length)).toContain('\x1b[?1000h\x1b[?1002h\x1b[?1006h')
    } finally {
      vi.unstubAllEnvs()
      tui.dispose()
    }
  })

  it.runIf(process.platform !== 'win32')('releases inspection mouse tracking before suspending to the shell', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 12, 1)
    press(term, '\x0f')
    let modesAtSuspend = ''
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { modesAtSuspend = term.captured; return true })
    try {
      press(term, '\x1a')
      expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTSTP')
      expect(modesAtSuspend).toContain('\x1b[?1006l\x1b[?1002l\x1b[?1000l')
    } finally {
      kill.mockRestore()
      tui.dispose()
    }
  })

  it('clears and fully repaints after the terminal is resized', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const before = term.captured.length

    term.resize(42, 18)

    const repaint = term.captured.slice(before)
    for (let row = 1; row <= term.rows; row++) expect(repaint).toContain(`\x1b[${row};1H\x1b[2K`)
    expect(repaint).not.toContain('\x1b[2J')
    expect(stripAnsi(repaint)).toContain('🐳')
    tui.dispose()
  })

  it('leaves the cursor on a fresh line when disposed', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const before = term.captured.length
    tui.dispose()
    expect(term.captured.slice(before)).toContain('\r\n')
  })

  it('submits a line on Enter and clears the buffer', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, 'hi\r')
    expect(await pending).toBe('hi')
    expect(term.captured).toMatch(/^─+ ⠋|🐳/mu)
    tui.dispose()
  })

  it('keeps End as an editor key at the live tail', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, 'ab\x1b[D\x1b[FX\r')
    expect(await pending).toBe('abX')
    tui.dispose()
  })

  it.each(['text', 'take-time', 'paste'] as const)('holds a timed prompt while editing (%s)', async (gesture) => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, { motion: 'off' })
    const line = tui.readline()
    const hold = vi.fn()
    const answer = tui.prompt({
      title: 'Question', question: 'Choose', options: [{ label: 'Project' }],
      wait: { deadline: Date.now() + 2_000, hold }, skippable: true, dismissLabel: 'Later',
    })
    expect(stripAnsi(term.captured)).toContain('Continues in 2s')
    expect(stripAnsi(term.captured)).toContain('esc later')
    if (gesture === 'text') press(term, 'custom')
    else if (gesture === 'take-time') press(term, '\x14')
    else { press(term, '\x1b[200~中文答案\x1b[201~'); await flushAsyncPaste() }
    expect(hold).toHaveBeenCalledOnce()
    expect(stripAnsi(term.captured)).toContain('Take your time')
    press(term, '\r')
    expect(await answer).toBe(gesture === 'text' ? 'custom' : gesture === 'paste' ? '中文答案' : 'Project')
    press(term, 'next\r')
    expect(await line).toBe('next')
    tui.dispose()
  })

  it('interrupts a question with Ctrl+C and keeps the second-press exit contract', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const line = tui.readline()
    tui.setStatus('running')
    const interrupted = vi.fn()
    const domainInterrupt = vi.fn()
    tui.onInterrupt(interrupted)
    const answer = tui.prompt({ title: 'Question', question: 'Choose', interrupt: domainInterrupt })
    press(term, '\x03')
    expect(await answer).toBeNull()
    expect(domainInterrupt).toHaveBeenCalledOnce()
    expect(interrupted).toHaveBeenCalledOnce()
    press(term, '\x03')
    expect(await line).toBeNull()
    tui.dispose()
  })

  it('keeps Skip distinct from Later and restores the displaced composer draft', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const line = tui.readline()
    press(term, 'unfinished draft')
    const first = tui.prompt({ title: 'Question', question: 'Choose', skippable: true, dismissLabel: 'Later' })
    press(term, '\x13')
    expect(await first).toBe('')
    const second = tui.prompt({ title: 'Question', question: 'Choose', skippable: true, dismissLabel: 'Later' })
    press(term, '\x1b')
    await new Promise<void>(resolve => { setTimeout(resolve, 40) })
    expect(await second).toBeNull()
    press(term, '\r')
    expect(await line).toBe('unfinished draft')
    tui.dispose()
  })

  it.each([false, true])('keeps the main Turn running when a side operation handles Ctrl+C (color=%s)', async color => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', color)
    const interrupted = vi.fn(), sideInterrupted = vi.fn(() => true)
    tui.onInterrupt(interrupted)
    tui.setStatus('running')
    try {
      const answer = tui.prompt({ title: 'Side question', question: 'Separate request', interrupt: sideInterrupted })
      press(term, '\x03')
      expect(await answer).toBeNull()
      expect(sideInterrupted).toHaveBeenCalledOnce()
      expect(interrupted).not.toHaveBeenCalled()
    } finally { await tui.dispose() }
  })

  it('repaints a countdown even with motion disabled and restores input on timeout', async () => {
    vi.useFakeTimers()
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, { motion: 'off' })
    const line = tui.readline()
    press(term, 'preserved draft')
    const expiry = new AbortController()
    const answer = tui.prompt({ title: 'Question', question: 'Choose', signal: expiry.signal,
      wait: { deadline: Date.now() + 2_000, hold: () => {} },
    })
    const before = term.captured.length
    await vi.advanceTimersByTimeAsync(1_000)
    expect(stripAnsi(term.captured.slice(before))).toContain('Continues in 1s')
    expiry.abort()
    expect(await answer).toBeNull()
    press(term, '\r')
    expect(await line).toBe('preserved draft')
    tui.dispose()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it('interactively selects a prompt option with arrow keys and Enter', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const runnerLine = tui.readline()
    const answer = tui.prompt({
      title: 'Resume session',
      question: 'Choose a session',
      options: [
        { label: 'session-one', description: 'First session' },
        { label: 'session-two', description: 'Second session' },
      ],
    })

    press(term, '\x1b[B\r')

    expect(stripAnsi(term.captured)).toContain('❯ session-two')
    expect(await answer).toBe('session-two')
    press(term, 'next prompt\r')
    expect(await runnerLine).toBe('next prompt')
    tui.dispose()
  })

  it.each([false, true])('clears nested plugin selectors before restoring the blank composer (color=%s)', async color => {
    const term = new ScrollingTerminal(160, 30)
    const tui = new LocalTui(term, 'deepseek-flash', color)
    try {
      tui.setCommands([{ name: 'plugins', description: 'Manage profile plugins and bundles' }])
      const line = tui.readInput()
      press(term, '/plugins\r')
      expect(await line).toEqual({ text: '/plugins', images: [] })
      const menu = tui.prompt({ title: 'Plugins', question: 'Manage this profile', presentation: 'card', filterable: true,
        options: [{ label: 'Plugin entries', value: 'entries' }, { label: 'Bundles', value: 'bundles' }], allowCustom: false })
      expect(term.visible().join('\n')).toContain('Plugins')
      press(term, '\r')
      expect(await menu).toBe('entries')
      const entries = tui.prompt({ title: 'Plugin entries', question: 'Choose an entry to inspect or toggle', presentation: 'card', filterable: true,
        options: Array.from({ length: 80 }, (_, index) => ({ label: `plugin-${index}`, value: String(index), description: 'Enabled · active' })), allowCustom: false })
      expect(term.visible().join('\n')).toContain('plugin-0')
      press(term, '\x1b[27u')
      expect(await entries).toBeNull()
      const parent = tui.prompt({ title: 'Plugins', question: 'Manage this profile', presentation: 'card', filterable: true,
        options: [{ label: 'Plugin entries', value: 'entries' }], allowCustom: false })
      press(term, '\x1b[27u')
      expect(await parent).toBeNull()
      const restored = term.visible()
      expect(restored.filter(row => row.includes('🐳'))).toHaveLength(1)
      expect(restored.join('\n')).not.toContain('plugin-0')
      expect(restored.join('\n')).not.toContain('Advanced')
    } finally { tui.dispose() }
  })

  it('filters a card list and returns the hidden option value', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const answer = tui.prompt({
      title: 'Resume Session',
      question: '',
      presentation: 'card',
      filterable: true,
      allowCustom: false,
      options: [
        { label: 'Alpha session', value: 'session-alpha', description: '2m ago' },
        { label: 'Beta session', value: 'session-beta', description: '1h ago' },
      ],
    })

    press(term, 'session\x1b[B\r')

    expect(stripAnsi(term.captured)).toContain('Beta session')
    expect(await answer).toBe('session-beta')
    tui.dispose()
  })

  it.each([false, true])('selects the ranked fuzzy option through Tab and Enter (colors=%s)', async (colors) => {
    const term = new ScrollingTerminal(80, 24)
    const tui = new LocalTui(term, 'm', colors)
    try {
      const answer = tui.prompt({
        title: 'Model', question: '', presentation: 'card',
        filterable: true, allowCustom: false,
        options: [
          { label: 'Other', value: 'other', description: 'Official flash route' },
          { label: 'Flash', value: 'flash', description: 'Official provider' },
          { label: 'Pro', value: 'pro', description: 'Official provider' },
        ],
      })
      press(term, 'flsh official')
      expect(term.visible().join('\n')).not.toContain('› Pro')
      // Flash ranks ahead of the description-only hit; Tab selects that hit.
      press(term, '\t\r')
      expect(await answer).toBe('other')
      expect(term.visible().filter(row => row.includes('🐳'))).toHaveLength(1)
    } finally { tui.dispose() }
  })

  it('renders a fixed-choice prompt without a custom-answer editor', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const beforePrompt = term.captured.length
    const answer = tui.prompt({
      title: 'Skills · 2 available',
      question: 'Skills are reusable playbooks.',
      detail: 'Choose one to add its instructions to this turn.',
      options: [
        { label: 'code-review', description: 'Review a change for correctness.' },
        { label: 'research', description: 'Research a question using primary sources.' },
      ],
      allowCustom: false,
      submitLabel: 'run',
    })

    expect(stripAnsi(term.captured)).toContain('Skills · 2 available')
    expect(stripAnsi(term.captured)).toContain('reusable playbooks')
    expect(stripAnsi(term.captured)).toContain('[ Enter run ]')
    expect(stripAnsi(term.captured)).not.toContain('custom answer')
    expect(term.captured.slice(beforePrompt)).toContain('\x1b[?25l')
    const beforeClose = term.captured.length
    press(term, '\x1b[B\r')
    expect(await answer).toBe('research')
    expect(term.captured.slice(beforeClose)).toContain('\x1b[?25h')
    tui.dispose()
  })

  it('returns secret prompt input without rendering its value', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const secret = 'sk-never-render-this'
    const answer = tui.prompt({
      title: 'Login to DeepSeek',
      question: 'Paste your DeepSeek API key',
      allowCustom: true,
      secret: true,
    })

    press(term, secret)
    expect(stripAnsi(term.captured)).not.toContain(secret)
    expect(stripAnsi(term.captured)).toContain('•'.repeat(secret.length))
    press(term, '\r')
    expect(await answer).toBe(secret)
    expect(stripAnsi(term.captured)).not.toContain(secret)
    tui.dispose()
  })

  it('opens a fixed-choice prompt on its current value', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const answer = tui.prompt({
      title: 'Permission',
      question: 'Choose how omdsh may access your workspace',
      options: [
        { label: 'Read only', value: 'read-only' },
        { label: 'Workspace write', value: 'workspace-write' },
      ],
      initialValue: 'workspace-write',
      allowCustom: false,
    })

    press(term, '\r')
    expect(await answer).toBe('workspace-write')
    tui.dispose()
  })

  it('reviews long plans in a bounded page and returns approval directly', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const answer = tui.prompt({
      title: 'Plan review',
      question: 'Approve this plan and leave plan mode?',
      detail: ['# Plan', ...Array.from({ length: 60 }, (_, index) => `- Step ${index + 1}`)].join('\n'),
      options: [{ label: 'Approve' }, { label: 'Keep planning' }],
      presentation: 'plan-review',
      approveValue: 'Approve',
      allowCustom: true,
    })

    expect(stripAnsi(term.captured)).toContain('later plan lines')
    press(term, '\r')
    expect(await answer).toBe('Approve')
    tui.dispose()
  })

  it('collects feedback only after Keep planning is selected', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const answer = tui.prompt({
      title: 'Plan review',
      question: 'Approve this plan and leave plan mode?',
      detail: '# Plan\n\n- Implement the change',
      options: [{ label: 'Approve' }, { label: 'Keep planning' }],
      presentation: 'plan-review',
      approveValue: 'Approve',
      allowCustom: true,
    })

    press(term, '\t\r')
    expect(stripAnsi(term.captured)).toContain('Revision feedback · optional')
    press(term, 'Cover the failure path\r')
    expect(await answer).toBe('Cover the failure path')
    tui.dispose()
  })

  it('queues a line submitted while a turn is running', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    // No readline in flight — the runner is busy driving a turn.
    press(term, 'typed during turn\r')
    expect(stripAnsi(term.captured)).toContain('│ Sending · not yet accepted · typed')
    expect(stripAnsi(term.captured)).toContain('Alt+Q manage')
    const next = tui.readline()
    expect(await next).toBe('typed during turn')
    tui.dispose()
  })

  it('restores the newest queued line into an empty composer with up arrow', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    for (const message of ['first queued', 'second queued']) press(term, message + '\r')
    expect(stripAnsi(term.captured)).toContain('Sending · 2')
    press(term, '\x1b[A')
    const restored = stripAnsi(term.captured)
    expect(restored).toContain('│ Sending · not yet accepted · first queued')
    expect(restored).toContain('second queued')
    const next = tui.readline()
    expect(await next).toBe('first queued')
    tui.dispose()
  })

  it('walks backward through queued lines with repeated up arrows without reordering them', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    for (const message of ['first queued', 'second queued', 'third queued']) press(term, message + '\r')

    press(term, '\x1b[A\x1b[A!\r')

    expect(await tui.readline()).toBe('first queued')
    expect(await tui.readline()).toBe('second queued!')
    expect(await tui.readline()).toBe('third queued')
    tui.dispose()
  })

  it('recalls history with the up arrow', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const first = tui.readline()
    press(term, 'one\r')
    await first
    void tui.readline()
    press(term, '\x1b[A')
    expect(term.captured).toContain('one')
    expect(term.captured).toMatch(/^─+ ⠋|🐳/mu)
    tui.dispose()
  })

  it('clears the line on idle Ctrl-C without interrupting', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    let fired = 0
    tui.onInterrupt(() => { fired += 1 })
    press(term, 'abc\x03')
    expect(fired).toBe(0)
    expect(term.captured).toMatch(/^─+ ⠋|🐳/mu)
    tui.dispose()
  })

  it('fires interrupt listeners on Ctrl-C while running', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    let fired = 0
    const off = tui.onInterrupt(() => { fired += 1 })
    tui.setStatus('running')
    press(term, '\x03')
    expect(fired).toBe(1)
    off()
    press(term, '\x03')
    expect(fired).toBe(1)
    tui.dispose()
  })

  it('queues composer input during compaction and keeps interruption available', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    let interrupted = 0
    tui.onInterrupt(() => { interrupted += 1 })
    tui.event(ev('command/run', {
      commandId: 'cmd-compact-1',
      name: 'compact',
      source: { kind: 'user' },
    }, 1))

    press(term, 'queued during compact\r')
    expect(stripAnsi(term.captured)).toContain('Compacting')
    press(term, '\x03')
    expect(interrupted).toBe(1)

    tui.event(ev('command/done', {
      commandId: 'cmd-compact-1',
      kind: 'success',
    }, 2))
    expect(await tui.readline()).toBe('queued during compact')
    const pending = tui.readline()
    press(term, 'after compact\r')
    expect(await pending).toBe('after compact')
    tui.dispose()
  })

  it('keeps exactly one activity row while queued follow-ups change', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.event(ev('turn/start', { turn: 1 }, 1))
    tui.event(ev('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [
        { id: 'message-1', source: { kind: 'user' }, content: [{ type: 'text', text: 'next one' }] },
        { id: 'message-2', source: { kind: 'user' }, content: [{ type: 'text', text: 'next two' }] },
      ],
    }, 2))
    tui.event(ev('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      removedCount: 1,
      inserted: [],
    }, 3))

    const rows = emulatedScreenRows(term.captured)
    expect(rows.filter(line => stripAnsi(line).includes('Deep Driving'))).toHaveLength(1)
    tui.dispose()
  })

  it('requests editing the latest durable follow-up when Up is pressed in an empty composer', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    let edits = 0
    const off = tui.onQueueEdit(() => { edits += 1 })
    tui.event(ev('turn/start', { turn: 1 }, 1))
    tui.event(ev('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [
        { id: 'message-1', source: { kind: 'user' }, content: [{ type: 'text', text: 'edit this' }] },
      ],
    }, 2))

    press(term, '\x1b[A')

    expect(edits).toBe(1)
    off()
    tui.dispose()
    expect(await pending).toBe(null)
  })

  it('continues backward through durable follow-ups and preserves newer drafts', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const messages = ['first durable', 'second durable', 'third durable']
    let seq = 1
    tui.event(ev('turn/start', { turn: 1 }, seq++))
    tui.event(ev('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: messages.map((text, index) => ({
        id: `message-${index}`,
        source: { kind: 'user' },
        content: [{ type: 'text', text }],
      })),
    }, seq++))
    let edits = 0
    tui.onQueueEdit(() => {
      const text = messages.pop()
      if (text === undefined) {
        tui.resolveQueueEdit(null)
        return
      }
      edits += 1
      tui.event(ev('agent/inbox/spliced', {
        target: 'next-turn',
        start: messages.length,
        removedCount: 1,
        inserted: [],
      }, seq++))
      tui.resolveQueueEdit({ text, images: [] })
    })

    press(term, '\x1b[A\x1b[A!\r')

    expect(edits).toBe(2)
    expect(await tui.readline()).toBe('second durable!')
    expect(await tui.readline()).toBe('third durable')
    tui.dispose()
  })

  it('fires rewind listeners on double Escape while the idle composer is empty', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    let fired = 0
    const off = tui.onRewind(() => { fired += 1 })

    press(term, '\x1b\x1b')
    await new Promise<void>(resolve => { setTimeout(resolve, 100) })

    expect(fired).toBe(1)
    off()
    tui.dispose()
    expect(await pending).toBe(null)
  })

  it('does not rewind when the composer contains a draft', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    let fired = 0
    tui.onRewind(() => { fired += 1 })

    press(term, 'draft\x1b\x1b')
    await new Promise<void>(resolve => { setTimeout(resolve, 100) })

    expect(fired).toBe(0)
    tui.dispose()
    expect(await pending).toBe(null)
  })

  it('quits on a rapid second Ctrl-C and prints a resume command after restoring the tty', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.setSession({ id: 'session-double-c', recent: [] })
    const pending = tui.readline()
    let settled = false
    void pending.then(() => { settled = true })

    press(term, 'draft\x03')
    await Promise.resolve()
    expect(settled).toBe(false)

    press(term, '\x03')
    expect(await pending).toBe(null)
    tui.dispose()

    expect(term.raw).toBe(false)
    expect(term.captured).toContain('Resume this session with omdsh --resume session-double-c')
  })

  it('names the product in the header while the resume hint stays the runnable command', () => {
    const term = new FakeTerminal()
    term.columns = 80
    const tui = new LocalTui(term, 'm', false)
    tui.setSession({ id: 'session-name-layers', recent: [] })
    const pending = tui.readline()
    press(term, '\x03')
    press(term, '\x03')
    void pending
    tui.dispose()

    // Naming the product and naming the command are two different jobs. The
    // header says what this is; `--resume` has to name something a shell finds.
    expect(stripAnsi(term.captured)).toContain('Oh-My-DSH v')
    expect(term.captured).toContain('Resume this session with omdsh --resume session-name-layers')
    expect(term.captured).not.toContain('Oh-My-DSH --resume')
  })

  it('prints the resume command below both fixed status lines', async () => {
    const term = new FakeTerminal()
    term.columns = 80
    const tui = new LocalTui(term, 'deepseek-v4-flash', false)
    tui.setSession({ id: 'session-exit-layout', recent: [] })
    const pending = tui.readline()

    press(term, '\x03\x03')
    expect(await pending).toBe(null)
    tui.dispose()

    const rows = emulatedScreenRows(term.captured)
    const statusRow = rows.findIndex(line => line.includes('deepseek-v4-flash'))
    const resumeRow = rows.findIndex(line => line.includes('Resume this session with omdsh --resume'))
    expect(statusRow, rows.join('\n')).toBeGreaterThanOrEqual(0)
    expect(resumeRow).toBeGreaterThan(statusRow)
  })

  it('quits on Ctrl-D with an empty buffer', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, '\x04')
    expect(await pending).toBe(null)
    tui.dispose()
  })

  it('latches a Ctrl-D pressed between turns onto the next readline', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    press(term, '\x04')
    expect(await tui.readline()).toBe(null)
    tui.dispose()
  })

  it('renders events and the selected model', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm0', false)
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }, 1))
    expect(term.captured).toContain('hi')
    tui.setModel('deepseek-v4-pro', 'max')
    expect(term.captured).toContain('deepseek-v4-pro')
    expect(term.captured).toContain('max')
    tui.dispose()
  })

  it('reveals streamed assistant chunks smoothly but flushes settlement immediately', async () => {
    vi.useFakeTimers()
    try {
      const term = new FakeTerminal()
      const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { streamRenderMs: 8 })
      const stats = {
        turns: 0,
        steps: 0,
        llmMs: 0,
        toolMs: 0,
        ttftMs: 0,
        ttftSteps: 0,
        decodeMs: 0,
        decodeTokens: 0,
        inputTokens: 10,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }
      tui.setSession({ id: 'streaming', recent: [], stats })
      tui.setStatus('running')
      const initialWrites = term.writes

      tui.streamDelta({ turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } })
      tui.setSession({ id: 'streaming', recent: [], stats: { ...stats, outputTokens: 1 } })
      tui.streamDelta({ turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'b' } })
      tui.setSession({ id: 'streaming', recent: [], stats: { ...stats, outputTokens: 2 } })
      tui.streamDelta({ turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'c' } })
      tui.setSession({ id: 'streaming', recent: [], stats: { ...stats, outputTokens: 3 } })
      expect(term.writes).toBe(initialWrites)

      await vi.advanceTimersByTimeAsync(34)
      expect(term.writes).toBe(initialWrites + 1)
      expect(term.captured).toContain('abc')

      tui.streamDelta({ turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'd' } })
      tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
      expect(term.writes).toBe(initialWrites + 2)
      expect(term.captured).toContain('abcd')

      await vi.advanceTimersByTimeAsync(34)
      expect(term.writes).toBe(initialWrites + 2)
      tui.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders provider chunks directly with static activity when Motion is off', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { streamRenderMs: 0 })
    tui.applyStoredPrefs({
      theme: 'dark',
      colors: false,
      motion: 'off',
      expandTools: false,
    })
    tui.setStatus('running')
    tui.streamDelta({
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'direct chunk' },
    })
    const screen = emulatedScreenRows(term.captured).map(stripAnsi).join('\n')
    expect(screen).toContain('direct chunk')
    expect(screen).toContain('⟳ Deep Driving')
    tui.dispose()
  })

  it('clears terminal progress when the root finishes', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.applyStoredPrefs({ theme: 'dark', colors: false, motion: 'off', expandTools: false })
    tui.event(ev('turn/start', { turn: 1 }, 1))
    tui.setStatus('running')
    tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 2))
    tui.setStatus('idle', { root: true, outcome: 'completed' })
    expect(term.captured).toContain('\x1b]9;4;3\x07')
    expect(term.captured).toContain('\x1b]9;4;0\x07')
    tui.dispose()
  })

  it('uses the durable turn ending reason in terminal notifications', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.applyStoredPrefs({
      theme: 'dark',
      colors: false,
      motion: 'off',
      expandTools: false,
      notifications: 'always',
    })
    tui.event(ev('turn/start', { turn: 1 }, 1))
    tui.event(ev('turn/end', { turn: 1, reason: { kind: 'max-tokens' } }, 2))

    await new Promise(resolve => setTimeout(resolve, 40))
    expect(term.captured).toContain('omdsh needs attention: Output token limit reached after 0s')
    tui.dispose()
  })

  it('reports Herdr pane lifecycle through the injected reporter', async () => {
    const term = new FakeTerminal()
    const recorder = createHerdrRecorder()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { herdrReporter: recorder.reporter })

    expect(recorder.requests[0]?.params.state).toBe('idle')

    tui.setStatus('running')
    expect(recorder.requests.at(-1)?.params.state).toBe('working')

    const answer = tui.prompt({ title: 'Approval required', question: 'Allow bash once?' })
    expect(recorder.requests.at(-1)?.params).toMatchObject({ state: 'blocked', message: 'Approval required' })

    press(term, 'yes\r')
    expect(await answer).toBe('yes')
    expect(recorder.requests.at(-1)?.params.state).toBe('working')

    tui.setSession({ id: 'herdr-session', recent: [] })
    expect(recorder.requests.at(-1)?.params).toMatchObject({
      state: 'working',
      agent_session_id: 'herdr-session',
      resume_argv: ['omdsh', '--resume', 'herdr-session'],
    })
    tui.setStatus('idle')
    expect(recorder.requests.at(-1)?.params).toMatchObject({
      state: 'idle',
      agent_session_id: 'herdr-session',
      resume_argv: ['omdsh', '--resume', 'herdr-session'],
    })

    // User-initiated prompts (notify: false) must not trigger Herdr blocked/done transitions or sounds.
    const countBeforeQuietPrompt = recorder.requests.length
    const quiet = tui.prompt({
      title: 'Settings',
      question: 'Choose a setting',
      options: [{ label: 'On', value: 'true' }, { label: 'Off', value: 'false' }],
      allowCustom: false,
      notify: false,
    })
    expect(recorder.requests).toHaveLength(countBeforeQuietPrompt)
    press(term, '\r')
    expect(await quiet).toBe('true')
    expect(recorder.requests).toHaveLength(countBeforeQuietPrompt)

    tui.dispose()
    expect(recorder.requests.at(-1)?.method).toBe('pane.release_agent')
  })

  it('restores the terminal immediately but keeps disposal pending until Herdr release settles', async () => {
    const term = new FakeTerminal()
    let acknowledge: ((success: boolean) => void) | undefined
    const reporter = new HerdrAgentReporter({
      env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p2', HERDR_SOCKET_PATH: '/tmp/omdsh-herdr-dispose.sock' },
      transport: () => ({ send: request => request.method === 'pane.release_agent'
        ? new Promise<boolean>(resolve => { acknowledge = resolve })
        : true }),
    })
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { herdrReporter: reporter })
    let finished = false
    const disposal = tui.dispose()
    void disposal.then(() => { finished = true })
    expect(term.raw).toBe(false)
    expect(term.destroyed).toBe(true)
    expect(tui.dispose()).toBe(disposal)
    await Promise.resolve()
    expect(finished).toBe(false)
    acknowledge?.(true)
    await disposal
    expect(finished).toBe(true)
  })

  it('ignores status updates from an inspected subagent while still reporting human prompts', async () => {
    const term = new FakeTerminal()
    const recorder = createHerdrRecorder()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { herdrReporter: recorder.reporter })
    tui.setStatus('running')
    recorder.requests.length = 0

    tui.setInspectedSubagent({ id: 'child-1', label: 'Explore', phase: 'running', writable: false })
    tui.setStatus('idle')
    expect(recorder.requests).toHaveLength(0)

    // A human decision is pending even while the child transcript is shown.
    const answer = tui.prompt({
      title: 'Approval required',
      question: 'Continue?',
      options: [{ label: 'Allow once' }, { label: 'Reject' }],
    })
    expect(recorder.requests.at(-1)?.params).toMatchObject({ state: 'blocked', message: 'Approval required' })
    press(term, '\r')
    expect(await answer).toBe('Allow once')
    expect(recorder.requests.at(-1)?.params.state).toBe('working')

    tui.setInspectedSubagent(undefined)
    tui.setStatus('idle')
    expect(recorder.requests.at(-1)?.params.state).toBe('idle')
    tui.dispose()
  })

  it('keeps the Herdr reporter inert without a pane environment', () => {
    const term = new FakeTerminal()
    const requests: HerdrRequest[] = []
    const reporter = new HerdrAgentReporter({
      env: {},
      transport: () => ({ send: request => { requests.push(request) } }),
    })
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { herdrReporter: reporter })
    tui.setStatus('running')
    void tui.prompt({ title: 'Approval required', question: 'Continue?' })
    tui.dispose()
    expect(requests).toHaveLength(0)
  })

  it('skips a footer repaint when only non-visible session timing changes', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const stats = {
      turns: 1,
      steps: 2,
      llmMs: 10,
      toolMs: 5,
      ttftMs: 2,
      ttftSteps: 1,
      decodeMs: 8,
      decodeTokens: 16,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      contextTokens: 120,
      contextWindow: 1_000,
      elapsedMs: 100,
    }
    tui.setSession({ id: 'session-perf', recent: [], stats })
    const writesAfterVisibleStats = term.writes

    tui.setSession({ id: 'session-perf', recent: [], stats: { ...stats, elapsedMs: 200 } })

    expect(term.writes).toBe(writesAfterVisibleStats)
    tui.dispose()
  })

  it('moves to line start and end with ctrl+a / ctrl+e', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    press(term, 'hello')
    press(term, '\x01')
    press(term, 'X')
    expect(term.captured).toContain('Xhello')
    press(term, '\x05')
    press(term, '!')
    expect(term.captured).toContain('Xhello!')
    tui.dispose()
  })

  it('kills the previous word with ctrl+w', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    press(term, 'hello world')
    press(term, '\x17')
    expect(term.captured).toContain('hello')
    tui.dispose()
  })

  it('queues a follow-up with alt+enter and inserts a newline with ctrl+j', async () => {
    // Pi splits these: Enter is which turn, Ctrl+J is a newline, and Alt+Enter
    // parks the draft behind the running turn instead of interrupting the flow
    // of typing. omdsh keeps Alt+Enter as a newline alias only where the
    // platform has no follow-up chord of its own.
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, 'one')
    press(term, '\n')
    press(term, 'two\r')
    expect(await pending).toBe('one\ntwo')
    tui.dispose()
  })

  it('smart-pastes a clipboard image as an OMP-style draft and submits it with text', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      readClipboard: async () => 'text fallback',
      readClipboardImage: async () => ({ data: PNG_1X1, mediaType: 'image/png', name: 'clipboard.png' }),
    })
    const pending = tui.readInput()

    press(term, '\x16')
    await flushAsyncPaste()
    expect(stripAnsi(term.captured)).toContain('[Image #1, 1x1]')
    expect(stripAnsi(term.captured)).not.toContain('text fallback')

    press(term, 'describe this\r')
    await expect(pending).resolves.toEqual({
      text: 'describe this',
      images: [{ data: PNG_1X1, mediaType: 'image/png', name: 'clipboard.png', width: 1, height: 1 }],
      // The marker sat before the words, so the picture keeps that position.
      segments: [{ kind: 'image', index: 0 }, { kind: 'text', text: 'describe this' }],
    })
    tui.dispose()
  })

  it('loads Finder file-url clipboard images when no raw bitmap is available', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      readClipboard: async () => '',
      readClipboardImage: async () => null,
      readClipboardFiles: async () => ['/tmp/Screenshot 2026-08-15.png'],
      readImagePath: async () => ({ data: PNG_1X1, mediaType: 'image/png', name: 'Screenshot 2026-08-15.png' }),
    })
    const pending = tui.readInput()

    press(term, '\x16\r')
    await expect(pending).resolves.toMatchObject({
      text: '',
      images: [{ mediaType: 'image/png', name: 'Screenshot 2026-08-15.png' }],
    })
    tui.dispose()
  })

  it('turns a bracketed-paste image path into a draft attachment', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      readImagePath: async path => path === '/tmp/screenshot.png'
        ? { data: PNG_1X1, mediaType: 'image/png', name: 'screenshot.png' }
        : null,
    })
    const pending = tui.readInput()

    press(term, '\x1b[200~/tmp/screenshot.png\x1b[201~')
    await flushAsyncPaste()
    expect(stripAnsi(term.captured)).toContain('[Image #1, 1x1]')
    press(term, '\r')
    await expect(pending).resolves.toMatchObject({
      text: '',
      images: [{ mediaType: 'image/png', name: 'screenshot.png', width: 1, height: 1 }],
    })
    tui.dispose()
  })

  it('refuses a pasted image that fails Harness admission, with an error notice', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      readClipboardImage: async () => ({ data: PNG_1X1, mediaType: 'image/png', name: 'huge.png' }),
    })
    tui.setImageValidator(async () => { throw new Error('image exceeds the 2000px dimension limit') })
    const pending = tui.readInput()

    press(term, '\x16')
    await flushAsyncPaste()
    await flushAsyncPaste()
    expect(stripAnsi(term.captured)).toContain('image exceeds the 2000px dimension limit')
    expect(stripAnsi(term.captured)).not.toContain('[Image #1')

    press(term, 'just text\r')
    await expect(pending).resolves.toEqual({ text: 'just text', images: [] })
    tui.dispose()
  })

  it('drafts a pasted image that passes Harness admission', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      readClipboardImage: async () => ({ data: PNG_1X1, mediaType: 'image/png', name: 'clipboard.png' }),
    })
    tui.setImageValidator(async () => {})
    const pending = tui.readInput()

    press(term, '\x16')
    await flushAsyncPaste()
    await flushAsyncPaste()
    expect(stripAnsi(term.captured)).toContain('[Image #1, 1x1]')
    press(term, '\r')
    await expect(pending).resolves.toMatchObject({ text: '' })
    tui.dispose()
  })

  it('queues Enter behind an asynchronous image paste', async () => {
    const term = new FakeTerminal()
    let resolveImage: ((image: { data: Uint8Array; mediaType: 'image/png' }) => void) | undefined
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      readClipboardImage: () => new Promise(resolve => { resolveImage = resolve }),
    })
    const pending = tui.readInput()
    let settled = false
    void pending.then(() => { settled = true })

    press(term, '\x16\r')
    await Promise.resolve()
    expect(settled).toBe(false)
    resolveImage?.({ data: PNG_1X1, mediaType: 'image/png' })
    await expect(pending).resolves.toMatchObject({ text: '' })
    tui.dispose()
  })

  it('restores a failed image submission ahead of a newer draft without colliding markers', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      readClipboardImage: async () => ({ data: PNG_1X1, mediaType: 'image/png' }),
    })
    const firstRead = tui.readInput()
    press(term, '\x16\r')
    const first = await firstRead
    expect(first).not.toBeNull()

    press(term, '\x16')
    await flushAsyncPaste()
    tui.restoreInput(first as NonNullable<typeof first>)
    const restored = tui.readInput()
    press(term, '\r')

    await expect(restored).resolves.toMatchObject({
      text: '',
      images: [{ mediaType: 'image/png' }, { mediaType: 'image/png' }],
    })
    tui.dispose()
  })

  it('keeps the original image draft when a slash command is typed after a paste', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      readClipboardImage: async () => ({ data: PNG_1X1, mediaType: 'image/png' }),
    })
    const pending = tui.readInput()
    press(term, '\x16')
    await flushAsyncPaste()
    press(term, '/goal implement auth\r')
    const submitted = await pending
    expect(submitted).toMatchObject({
      text: '/goal implement auth',
      images: [{ mediaType: 'image/png' }],
    })
    tui.restoreInput(submitted as NonNullable<typeof submitted>)
    const restored = tui.readInput()
    press(term, '\r')
    await expect(restored).resolves.toMatchObject({
      text: '/goal implement auth',
      images: [{ mediaType: 'image/png' }],
    })
    tui.dispose()
  })

  it('keeps the original image draft when a slash command is typed before a paste', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      readClipboardImage: async () => ({ data: PNG_1X1, mediaType: 'image/png' }),
    })
    const pending = tui.readInput()
    press(term, '/plan the migration')
    press(term, '\x16')
    await flushAsyncPaste()
    press(term, '\r')
    await expect(pending).resolves.toMatchObject({
      text: '/plan the migration',
      images: [{ mediaType: 'image/png' }],
    })
    tui.dispose()
  })

  it('keeps the original image draft when a paste lands inside a slash command', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      readClipboardImage: async () => ({ data: PNG_1X1, mediaType: 'image/png' }),
    })
    const pending = tui.readInput()
    press(term, '/goal ')
    press(term, '\x16')
    await flushAsyncPaste()
    press(term, 'implement auth\r')
    await expect(pending).resolves.toMatchObject({
      text: '/goal implement auth',
      images: [{ mediaType: 'image/png' }],
    })
    tui.dispose()
  })

  it('recalls handwritten image placeholders from history when nothing is attached', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const first = tui.readline()
    press(term, '[Image #1] /goal literal\r')
    await first
    void tui.readline()
    press(term, '\x1b[A')
    expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).toContain('[Image #1] /goal literal')
    tui.dispose()
  })

  it('drops attached image markers from history but keeps handwritten ones', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      readClipboardImage: async () => ({ data: PNG_1X1, mediaType: 'image/png' }),
    })
    const pending = tui.readInput()
    press(term, '\x16')
    await flushAsyncPaste()
    press(term, 'see [Image #2] notes\r')
    await pending
    void tui.readInput()
    press(term, '\x1b[A')
    const screen = emulatedScreenRows(term.captured).map(stripAnsi).join('\n')
    expect(screen).toContain('[Image #2] notes')
    expect(screen).not.toContain('[Image #1, 1x1]')
    tui.dispose()
  })

  it('interrupts a running turn on Escape', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    let fired = 0
    tui.onInterrupt(() => { fired += 1 })
    tui.setStatus('running')
    press(term, '\x1b')
    // Lone ESC is flushed on the decoder timeout.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(fired).toBe(1)
        tui.dispose()
        resolve()
      }, 120)
    })
  })

  it('deletes forward with ctrl+d when the buffer is not empty', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    press(term, 'ab')
    press(term, '\x01')
    press(term, '\x04')
    expect(term.captured).toContain('b')
    tui.dispose()
  })

  it('opens slash-command suggestions when the buffer starts with /', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    press(term, '/')
    expect(term.captured).toContain('/help')
    expect(term.captured).toContain('/settings')
    expect(term.captured).not.toContain('/theme')
    expect(term.captured).not.toContain('/hotkeys')
    expect(term.captured).not.toContain('/pwd')
    expect(term.captured).not.toContain('/dirs')
    expect(term.captured).toContain('/copy')
    expect(term.captured).toContain('1/6')
    tui.dispose()
  })

  it('completes the selected slash command on Tab', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    press(term, '/cl')
    press(term, '\t')
    expect(term.captured).toContain('/clear ')
    tui.dispose()
  })

  it('offers no argument for /copy and completes the one /help declares', () => {
    // `/copy` used to advertise text|code|cmd|output; the kinds are gone, so the
    // popup must not claim them. `/help full` is the remaining builtin with one.
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    press(term, '/copy ')
    expect(term.captured).not.toContain('Last fenced code block')
    press(term, '\x15/help f')
    expect(term.captured).toContain('full')
    press(term, '\t')
    expect(term.captured).toContain('/help full ')
    tui.dispose()
  })

  it('completes @ paths from the injected listing', () => {
    const proj = resolve('/proj')
    const listing = (dir: string): readonly DirEntry[] | undefined => {
      if (dir === proj) {
        return [
          { name: 'src', directory: true },
          { name: 'README.md', directory: false },
        ]
      }
      if (dir === join(proj, 'src')) return [{ name: 'index.ts', directory: false }]
      return undefined
    }
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      cwd: proj,
      home: resolve('/home/me'),
      listDir: listing,
    })
    press(term, '@')
    expect(term.captured).toContain('src/')
    expect(term.captured).toContain('README.md')
    expect(term.captured).not.toContain('/src/')
    press(term, '\t')
    expect(term.captured).toContain('@src/')
    expect(term.captured).toContain('index.ts')
    press(term, '\t')
    expect(term.captured).toContain('@src/index.ts ')
    tui.dispose()
  })

  it('lists session mentions under the @ menu when a session searcher is injected', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      cwd: '/proj',
      home: '/home/me',
      listDir: () => [{ name: 'README.md', directory: false }],
      autocompleteDebounceMs: 0,
      searchSessions: async () => [{ sessionId: 'session-a', label: 'Research notes' }],
    })
    press(term, '@')
    await new Promise(resolve => { setTimeout(resolve, 10) })
    expect(stripAnsi(term.captured)).toContain('Files & folders')
    expect(stripAnsi(term.captured)).toContain('Session conversations')
    expect(stripAnsi(term.captured)).toContain('Research notes')
    press(term, '\x1b[B\t')
    expect(stripAnsi(term.captured)).toContain(formatSessionReferenceMention({
      sessionId: SessionId('session-a'),
      label: 'Research notes',
    }))
    tui.dispose()
  })

  it('lists file-reference candidates in the @ menu', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      cwd: '/proj',
      home: '/home/me',
      listDir: () => [],
      autocompleteDebounceMs: 0,
      searchFileMentions: async () => [
        { path: 'README.md', kind: 'file' },
        { path: 'src', kind: 'directory' },
      ],
    })
    press(term, '@')
    await new Promise(resolve => { setTimeout(resolve, 10) })
    expect(stripAnsi(term.captured)).toContain('README.md')
    expect(stripAnsi(term.captured)).toContain('src/')
    press(term, '\t')
    expect(stripAnsi(term.captured)).toContain('@README.md')
    tui.dispose()
  })

  it('updates @ suggestions from asynchronous recursive project search', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      cwd: '/proj/app',
      projectRoot: '/proj',
      home: '/home/me',
      listDir: () => [],
      autocompleteDebounceMs: 0,
      searchFiles: async (_root, query) => query === 'index'
        ? [{ path: 'src/index.ts', directory: false }]
        : [],
    })

    press(term, '@index')
    await new Promise(resolve => { setTimeout(resolve, 10) })

    expect(stripAnsi(term.captured)).toContain('src/index.ts')
    tui.dispose()
  })

  it('ignores a stale @ search response after the query changes', async () => {
    const pending = new Map<string, (entries: readonly ProjectPathEntry[]) => void>()
    const searchFiles: PathSearcher = async (_root, query) => new Promise((resolve) => {
      pending.set(query, resolve)
    })
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      cwd: '/proj',
      projectRoot: '/proj',
      home: '/home/me',
      listDir: () => [],
      autocompleteDebounceMs: 0,
      searchFiles,
    })

    press(term, '@a')
    await new Promise(resolve => { setTimeout(resolve, 5) })
    press(term, 'b')
    await new Promise(resolve => { setTimeout(resolve, 5) })
    expect([...pending.keys()]).toEqual(['a', 'ab'])

    pending.get('ab')?.([{ path: 'ab-new.ts', directory: false }])
    await new Promise(resolve => { setTimeout(resolve, 5) })
    expect(stripAnsi(term.captured)).toContain('ab-new.ts')

    const beforeStale = term.captured.length
    pending.get('a')?.([{ path: 'a-old.ts', directory: false }])
    await new Promise(resolve => { setTimeout(resolve, 5) })
    expect(stripAnsi(term.captured.slice(beforeStale))).not.toContain('a-old.ts')
    tui.dispose()
  })

  it('opens bare-word path suggestions on Tab and completes on a second Tab', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      cwd: '/proj',
      home: '/home/me',
      listDir: (dir) => dir === '/proj'
        ? [
          { name: 'src', directory: true },
          { name: 'README.md', directory: false },
        ]
        : undefined,
    })
    press(term, 'READ')
    expect(term.captured).not.toContain('README.md')
    press(term, '\t')
    expect(term.captured).toContain('README.md')
    expect(term.captured).not.toContain('README.md ')
    press(term, '\t')
    expect(term.captured).toContain('README.md ')
    tui.dispose()
  })

  it('does not replace the slash popup with file listings', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      cwd: '/proj',
      listDir: () => [{ name: 'src', directory: true }],
    })
    press(term, '/')
    expect(term.captured).toContain('/help')
    expect(term.captured).not.toContain('src/')
    tui.dispose()
  })

  it('navigates suggestions with up/down instead of history', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const first = tui.readline()
    press(term, 'one\r')
    await first
    const pending = tui.readline()
    press(term, '/')
    press(term, '\x1b[A')
    press(term, '\r')
    expect(await pending).toBe(null)
    tui.dispose()
  })


  it('opens the /copy picker and copies the selected row', async () => {
    const copied: string[] = []
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', async (text) => { copied.push(text) })
    const pending = tui.readline()
    tui.event(ev('assistant/message', {
      turn: 1,
      step: 1,
      message: { content: [{ type: 'text', text: 'hello from the model' }] },
      stream: [],
    }, 1))
    press(term, '/copy\r')
    await flushAsyncPaste()
    expect(term.captured).toContain('hello from the model')
    // The card's own vocabulary, not a copy-specific hint line.
    expect(term.captured).toContain('One thing to copy')
    expect(copied).toEqual([])
    press(term, '\r')
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(copied).toEqual(['hello from the model'])
    expect(term.captured).toContain('Copied last message')
    press(term, 'ok\r')
    expect(await pending).toBe('ok')
    tui.dispose()
  })

  it.each([false, true])('clears a plain filter on Escape without leaving its placeholder or glyph behind (colors=%s)', async colors => {
    // Escape gives back one layer. Only the tree used to do this, so a filtered
    // `/model` or `/copy` closed outright and had to be reopened for the full list.
    const term = new ScrollingTerminal(70, 24)
    const tui = new LocalTui(term, 'm', colors)
    const pending = tui.prompt({
      title: 'Pick',
      question: 'Choose',
      filterable: true,
      allowCustom: false,
      notify: false,
      options: [{ label: 'alpha', value: 'a' }, { label: 'beta', value: 'b' }],
    })
    await flushAsyncPaste()
    expect(term.visible().join('\n')).toContain('type to filter')
    expect(term.visible().join('\n')).not.toContain('⌕')
    press(term, 'beta')
    await flushAsyncPaste()
    expect(term.visible().join('\n')).toContain('beta · 1/1')
    expect(term.visible().join('\n')).not.toContain('type to filter')
    expect(term.visible().join('\n')).not.toContain('⌕')
    press(term, '\x1b')
    await new Promise(resolve => setTimeout(resolve, 150))
    // Still open, with the filter cleared rather than the list closed.
    const cleared = term.visible().join('\n')
    expect(cleared).toContain('Pick')
    expect(cleared).toContain('type to filter')
    expect(cleared).toContain('alpha')
    expect(cleared).not.toContain('beta · 1/1')
    expect(cleared).not.toContain('⌕')
    press(term, '\x03')
    expect(await pending).toBeNull()
    tui.dispose()
  })

  it('reports nothing to copy and refuses an argument', async () => {
    // There are no kinds any more: `/copy` asks which row, and an argument is a
    // mistake rather than a shortcut.
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', async () => { throw new Error('unused') })
    const pending = tui.readline()
    press(term, '/copy\r')
    expect(term.captured).toContain('Nothing to copy.')
    press(term, '/copy nope\r')
    expect(term.captured).toContain('Usage: /copy')
    press(term, 'ok\r')
    expect(await pending).toBe('ok')
    tui.dispose()
  })

  it('opens a long command catalog at its heading instead of its tail', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.setCommands(Array.from({ length: 24 }, (_, index) => ({
      name: `runtime-${index}`,
      description: `Runtime command ${index} with a deliberately descriptive explanation`,
    })))
    press(term, '/help\r')
    await flushAsyncPaste()
    expect(stripAnsi(term.captured)).toContain('1/31 · scroll for more')
    tui.dispose()
  })

  it('treats /exit as quit', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, '/exit\r')
    expect(await pending).toBe(null)
    tui.dispose()
  })

  it('browses the tool catalog and opens full descriptions', async () => {
    const term = new ScrollingTerminal(80, 30), tui = new LocalTui(term, 'm', false)
    try {
      tui.setTools([{ name: 'bash', description: 'Run a shell command.\n\nFull description.' }, { name: 'fs', description: '' }])
      press(term, '/tools\r')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('Search tools')
      press(term, 'bash')
      await flushAsyncPaste()
      const filtered = term.visible()
      press(term, '\r')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('Full description.')
      press(term, '\x1b[27u')
      await flushAsyncPaste()
      expect(term.visible()).toEqual(filtered)
      press(term, '\x03')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('🐳')
      press(term, '/tools\r')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('type to filter')
      press(term, '\x03')
      await flushAsyncPaste()
    } finally { tui.dispose() }
  })

  it('shows the last streamed chunk even when it arrived inside the paint window', async () => {
    // Two chunks inside one throttle window used to schedule a repaint of the
    // old text, so the words before a pause never appeared until more arrived.
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', true)
    let release: (() => void) | undefined
    const done = tui.asideQuestion?.({
      question: 'why?',
      signal: new AbortController().signal,
      run: async onUpdate => {
        onUpdate('first')
        onUpdate('first second')
        await new Promise<void>(resolve => { release = resolve })
        return { text: 'first second' }
      },
    })
    await new Promise(resolve => setTimeout(resolve, 120))
    // Still running, so only the throttled paint can have put this on screen.
    expect(stripAnsi(term.captured)).toContain('first second')
    release?.()
    await done
    tui.dispose()
  })

  it('offers the finished side answer to /copy', async () => {
    // Reading an answer and being unable to take it anywhere is a dead end.
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', true)
    let release: (() => void) | undefined
    const done = tui.asideQuestion?.({
      question: 'why did the build fail?',
      signal: new AbortController().signal,
      run: async onUpdate => {
        onUpdate('The lockfile changed.')
        await new Promise<void>(resolve => { release = resolve })
        return { text: 'The lockfile changed.' }
      },
    })
    await new Promise(resolve => setTimeout(resolve, 40))
    // A running answer has nothing to copy yet.
    term.captured = ''
    press(term, '/copy\r')
    await flushAsyncPaste()
    expect(stripAnsi(term.captured)).toContain('Nothing to copy')
    release?.()
    await done
    await flushAsyncPaste()
    term.captured = ''
    press(term, '/copy\r')
    await flushAsyncPaste()
    const picker = stripAnsi(term.captured)
    expect(picker).toContain('why did the build fail?')
    expect(picker).toContain('side answer')
    tui.dispose()
  })

  it('keeps a finished side answer as one line instead of losing it', async () => {
    // Closing the pane was the only way to get the screen height back, and it cost
    // the text. A folded block means the reader never has to choose.
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', true)
    let release: (() => void) | undefined
    const done = tui.asideQuestion?.({
      question: 'why did the build fail?',
      signal: new AbortController().signal,
      run: async onUpdate => {
        onUpdate('The lockfile changed between the two runs.')
        await new Promise<void>(resolve => { release = resolve })
        return { text: 'The lockfile changed between the two runs.' }
      },
    })
    await new Promise(resolve => setTimeout(resolve, 40))
    release?.()
    await done
    term.captured = ''
    press(term, '\x1b')
    await new Promise(resolve => setTimeout(resolve, 150))
    const folded = stripAnsi(term.captured)
    expect(folded).toContain('/btw why did the build fail?')
    expect(folded).toContain('Ctrl+O: Expand')
    expect(folded).not.toContain('The lockfile changed')
    // The same key that opens any other fold opens this one.
    term.captured = ''
    press(term, '\x0f')
    await flushAsyncPaste()
    expect(stripAnsi(term.captured)).toContain('The lockfile changed between the two runs.')
    tui.dispose()
  })

  it('records nothing when the reader leaves before there is an answer', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', true)
    let seen: AbortSignal | undefined
    const done = tui.asideQuestion?.({
      question: 'why?',
      signal: new AbortController().signal,
      run: async (_onUpdate, signal) => {
        seen = signal
        await new Promise<void>(resolve => { signal.addEventListener('abort', () => resolve(), { once: true }) })
        return { text: 'late', failed: true }
      },
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    term.captured = ''
    press(term, '\x1b')
    await new Promise(resolve => setTimeout(resolve, 150))
    await done
    expect(seen?.aborted).toBe(true)
    expect(stripAnsi(term.captured)).not.toContain('/btw why?')
    tui.dispose()
  })

  it('stops a side consultation when the reader closes the pane', async () => {
    // Closing used to hide the pane while the request kept running unseen.
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', true)
    let seen: AbortSignal | undefined
    const done = tui.asideQuestion?.({
      question: 'why?',
      signal: new AbortController().signal,
      run: async (_onUpdate, signal) => {
        seen = signal
        await new Promise<void>(resolve => { signal.addEventListener('abort', () => resolve(), { once: true }) })
        return { text: '', failed: true }
      },
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    press(term, '\x1b')
    // A bare Escape waits for a possible sequence before it settles.
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(seen?.aborted).toBe(true)
    await done
    tui.dispose()
  })

  it('filters help and inserts a command for confirmation', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.setCommands([{ name: 'model', description: 'Choose a model' }])
    const pending = tui.readline()
    press(term, '/help\r')
    await flushAsyncPaste()
    expect(stripAnsi(term.captured)).toContain('Find a command')
    press(term, 'model')
    await flushAsyncPaste()
    press(term, '\r')
    await flushAsyncPaste()
    expect(stripAnsi(term.captured)).toContain('/model')
    press(term, '\r')
    expect(await pending).toBe('/model')
    tui.dispose()
  })

  it('opens shortcuts from Help with Enter and yields to a foreground prompt', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      press(term, '/help\r')
      await flushAsyncPaste()
      press(term, '\r')
      await flushAsyncPaste()
      expect(stripAnsi(term.captured)).toContain('Keyboard Shortcuts')
      const pending = tui.prompt({ title: 'Approval required', question: 'Continue?', options: [{ label: 'Yes' }], allowCustom: false })
      await flushAsyncPaste()
      expect(stripAnsi(term.captured)).toContain('Approval required')
      term.captured = ''
      press(term, '\x03')
      await pending
      await flushAsyncPaste()
      expect(stripAnsi(term.captured)).not.toContain('Keyboard Shortcuts')
    } finally { tui.dispose() }
  })

  it('finds inside a rendered document, which has no source to search', async () => {
    // Documents that are not transcript output still need find: file recovery,
    // plugin settings, session composition. `/changelog` used to prove the path;
    // it is a transcript result now.
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.prompt({
      title: 'Composition',
      question: 'Declared presets',
      detail: 'Presets\n\n- settings preset\n- other preset',
      options: [{ label: 'Close', value: 'close' }],
      presentation: 'document',
      allowCustom: false,
      notify: false,
    } as never)
    await flushAsyncPaste()
    term.captured = ''
    press(term, '/')
    press(term, 'settings')
    await flushAsyncPaste()
    expect(stripAnsi(term.captured)).toContain('Find: settings')
    term.captured = ''
    press(term, '\r')
    await flushAsyncPaste()
    expect(stripAnsi(term.captured)).toMatch(/1\/\d+ matching rows · “settings”/u)
    press(term, '\x03')
    await pending
    tui.dispose()
  })

  it('opens the full shortcut catalog in a searchable reader', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    press(term, '/help full\r')
    await flushAsyncPaste()
    expect(stripAnsi(term.captured)).toContain('Keyboard Shortcuts')
    press(term, '/')
    press(term, 'Comparison')
    await flushAsyncPaste()
    press(term, '\r')
    await flushAsyncPaste()
    expect(stripAnsi(term.captured)).toContain('matching rows')
    press(term, '\x03')
    await flushAsyncPaste()
    tui.dispose()
  })

  it('submits a skill from the command catalog', async () => {
    const name = 'code-review'
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.setCommands([{ name: 'code-review', description: 'Review a change for correctness', skill: { userOnly: true } }])
    const pending = tui.readline()
    press(term, '/skill:code-review\r')
    expect(stripAnsi(term.captured)).toContain('unknown command: /skill')
    press(term, `/${name} focus on auth\r`)
    expect(await pending).toBe(`/${name} focus on auth`)
    tui.dispose()
  })

  it('exposes the interactive /permission command without a raw input hint', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.setCommands([
      { name: 'permission', description: 'Choose the session access level' },
    ])
    const pending = tui.readline()
    press(term, '/mode\r')
    expect(stripAnsi(term.captured)).toContain('unknown command: /mode')
    press(term, '/permission\r')
    expect(await pending).toBe('/permission')
    tui.dispose()
  })

  it.each([false, true])('opens plugin fields from Settings and returns to the selected row (color=%s)', async color => {
    const term = new ScrollingTerminal(80, 24)
    const tui = new LocalTui(term, 'm', color)
    const edit = vi.fn(async (id: string, signal: AbortSignal) => {
      await tui.prompt({ title: id, question: 'Choose a field', presentation: 'card',
        options: [{ label: 'timeout', value: 'timeout' }], allowCustom: false, signal })
    })
    const unbind = tui.bindPluginSettings({ entries: () => ['shell', 'subagent'].map(id => ({ id, label: id, description: 'Editable configuration' })), edit })
    try {
      const input = tui.readInput()
      press(term, '/settings\r\x1b[Z\x1b[B\r')
      await flushAsyncPaste()
      expect(edit).toHaveBeenCalledWith('subagent', expect.any(AbortSignal))
      expect(term.visible().join('\n')).toContain('timeout')
      // A live preference write while the form covers Settings must survive returning.
      tui.applyStoredPrefs({ theme: 'light', colors: color })
      press(term, '\x1b[27u')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('● Advanced')
      expect(term.visible().join('\n')).toContain('❯ subagent')
      press(term, '\t\t')
      expect(term.visible().join('\n')).toContain('light')
      press(term, '\x1b[27u')
      expect(term.visible().filter(row => row.includes('🐳'))).toHaveLength(1)
      press(term, 'next prompt\r')
      expect(await input).toEqual({ text: 'next prompt', images: [] })
    } finally { await unbind(); tui.dispose() }
  })

  it.each(['en', 'zh-CN'] as const)('stages Shell fields and restores inheritance without writing on cancellation (%s)', async language => {
    const z = (await import('@deepseek-ai/schemastery')).default
    const term = new ScrollingTerminal(72, 28), tui = new LocalTui(term, 'm', false), ctx = new Context(), mutate = vi.fn()
    const ns = process.platform === 'win32' ? 'pwsh' : 'bash'
    tui.applyStoredPrefs({ uiLanguage: language, colors: language === 'zh-CN' })
    ctx.provide('tui', tui)
    ctx.provide('settings', { writable: true, describe: () => [{ ns, revision: 1,
      schema: z.object({ timeoutMs: z.number().default(120000), maxOutputBytes: z.number().default(64000) }).toJSON(),
      value: { timeoutMs: 120000, maxOutputBytes: 64000 }, base: { timeoutMs: 120000 }, user: {} }], mutate } as never)
    try {
      const task = editSettingsEntry(ctx, ns, new AbortController().signal)
      await flushAsyncPaste()
      press(term, '\r'); await flushAsyncPaste()
      press(term, '\x1530s\r'); await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain(language === 'en' ? '30s · Draft' : '30s · 草稿')
      press(term, '\x1b[B\x1b[B\r'); await flushAsyncPaste()
      press(term, '\r'); await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain(language === 'en' ? '2m · Draft' : '2m · 草稿')
      expect(mutate).not.toHaveBeenCalled()
      press(term, '\x1b[27u'); await task
      expect(mutate).not.toHaveBeenCalled()
    } finally { tui.dispose(); await ctx.fiber.dispose() }
  })

  it.each(['en', 'zh-CN'] as const)('stages subagent limits and model choices with real keyboard input (%s)', async language => {
    const { openSubagentSettings } = await import('./subagent-settings.ts')
    const z = (await import('@deepseek-ai/schemastery')).default
    const term = new ScrollingTerminal(100, 32), tui = new LocalTui(term, 'm', false), ctx = new Context(), mutate = vi.fn()
    tui.applyStoredPrefs({ uiLanguage: language, colors: language === 'zh-CN' })
    ctx.provide('tui', tui)
    ctx.provide('settings', { writable: true, describe: () => [
      { ns: 'subagent', schema: z.object({ maxDepth: z.number().min(0), maxActiveSubagents: z.number().min(1) }).toJSON(), value: { maxDepth: 1, maxActiveSubagents: 8 }, base: {}, user: {}, revision: 1 },
      { ns: 'subagent-model-selection-settings', schema: z.object({ enabled: z.boolean(), allowedModels: z.array(z.object({ provider: z.string(), model: z.string() })) }).toJSON(), value: { enabled: false, allowedModels: [{ provider: 'offline', model: 'saved-model' }] }, base: {}, user: {}, revision: 1 },
    ], mutate } as never)
    ctx.provide('llm', { listProviders: () => [], listModels: async () => [] } as never)
    try {
      const task = openSubagentSettings(ctx, new AbortController().signal)
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain(language === 'en' ? 'Delegation depth' : '委派深度')
      press(term, '\r')
      await flushAsyncPaste()
      press(term, '\x153\r')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain(language === 'en' ? '3 · Draft' : '3 · 草稿')
      press(term, '\x1b[B\x1b[B\x1b[B\r')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('saved-model')
      press(term, ' \r')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain(language === 'en' ? '0 · Draft' : '0 · 草稿')
      expect(mutate).not.toHaveBeenCalled()
      press(term, '\x1b[27u')
      await task
      expect(mutate).not.toHaveBeenCalled()
    } finally { tui.dispose(); await ctx.fiber.dispose() }
  })

  it.each(['en', 'zh-CN'] as const)('edits Web settings through keyboard selectors without writing a cancelled draft (%s)', async language => {
    const { openWebSettings } = await import('./web-settings.ts')
    const z = (await import('@deepseek-ai/schemastery')).default
    const term = new ScrollingTerminal(100, 32), tui = new LocalTui(term, 'm', false), ctx = new Context(), mutate = vi.fn()
    tui.applyStoredPrefs({ uiLanguage: language })
    ctx.provide('tui', tui)
    ctx.provide('settings', { writable: true, describe: () => [
      { ns: 'web', schema: z.object({ searchProvider: z.string(), fetchProvider: z.string() }).toJSON(), value: { searchProvider: 'deepseek-search-api', fetchProvider: 'deepseek-fetch-api' }, base: {}, user: {}, revision: 1 },
      { ns: 'web-deepseek-api', schema: z.object({ count: z.number().min(1).max(50) }).toJSON(), value: { count: 10 }, base: { count: 10 }, user: {}, revision: 1 },
    ], mutate } as never)
    ctx.provide('omdshWebProviders', { list: () => ({ search: [{ id: 'deepseek-search-api', available: true }], fetch: [{ id: 'http', available: true }, { id: 'deepseek-fetch-api', available: true }] }) })
    try {
      const task = openWebSettings(ctx, new AbortController().signal)
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain(language === 'en' ? 'Web search and fetch' : '网页搜索与抓取')
      press(term, '\x1b[B\r')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain(language === 'en' ? 'Direct fetch' : '直接抓取')
      press(term, '\x1b[A\r')
      await flushAsyncPaste()
      press(term, '\x1b[B\x1b[B\r')
      await flushAsyncPaste()
      press(term, '\x1520\r')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('20')
      expect(mutate).not.toHaveBeenCalled()
      press(term, '\x1b[27u')
      await task
      expect(mutate).not.toHaveBeenCalled()
    } finally { tui.dispose(); await ctx.fiber.dispose() }
  })

  it.each([['en', false], ['zh-CN', true]] as const)('shows account details and keyboard actions in the real card (%s, colors=%s)', async (language, colors) => {
    const { openAccountSettings } = await import('./account-settings.ts')
    const term = new ScrollingTerminal(100, 32), tui = new LocalTui(term, 'm', colors), ctx = new Context()
    tui.applyStoredPrefs({ theme: 'dark', colors, uiLanguage: language })
    ctx.provide('tui', tui)
    const state = { status: 'credential-stored', attempt: null }
    const getBalance = vi.fn(async () => ({ status: 'ready', value: [{ currency: 'CNY', balance: '1234.567' }], bonusWallets: [] }))
    ctx.provide('deepseekAccount', {
      getState: async () => state,
      watch: async function* () { yield { type: 'snapshot', state } },
      getProfile: async () => ({ status: 'ready', value: { name: '账户 Test 🐳', contact: 'a***@test.example' } }),
      getBalance,
    } as never)
    try {
      const task = openAccountSettings(ctx, new AbortController().signal)
      await flushAsyncPaste()
      // Dynamic details settle through the same refresh timer as a mounted account provider.
      await vi.waitFor(() => expect(term.visible().join('\n')).toContain('1,234.56'))
      expect(term.visible().join('\n')).toContain('a***@test.example')
      expect(term.visible().join('\n')).toContain(language === 'en' ? 'Recharge balance' : '充值余额')
      press(term, '\x1b[B\x1b[B\r')
      await flushAsyncPaste()
      expect(getBalance).toHaveBeenCalledTimes(2)
      press(term, '\x1b[27u')
      await task
    } finally { tui.dispose(); await ctx.fiber.dispose() }
  })

  it.each(['en', 'zh-CN'] as const)('manages reminders through keyboard cards and refreshes live execution state (%s)', async language => {
    const { scheduleCommand } = await import('../commands/schedule.ts')
    const term = new ScrollingTerminal(72, 22), tui = new LocalTui(term, 'm', language === 'zh-CN'), ctx = new Context()
    tui.applyStoredPrefs({ colors: language === 'zh-CN', uiLanguage: language })
    tui.setSession({ id: 'demo', recent: [], stats: { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0,
      decodeMs: 0, decodeTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextTokens: 0, contextWindow: 1000, elapsedMs: 0 } })
    ctx.provide('tui', tui)
    let entry = { id: 'task', title: '定时 Test 🐳', prompt: 'Check the local demo', kind: 'every', everySeconds: 3600,
      scheduledAt: '2099-01-01T00:00:00Z', status: 'active', updatedAt: '2026-11-05T00:00:00Z', target: { kind: 'session', sessionId: 'demo' }, involvedSessionIds: ['demo'], executionActive: false }
    const edit = vi.fn(async (request: { patch: { active: boolean } }) => {
      entry = { ...entry, status: request.patch.active ? 'active' : 'paused' }
      ctx.emit('schedule/changed'); return entry
    })
    ctx.provide('schedule', { catalog: async () => [entry], edit } as never)
    const abort = new AbortController()
    const task = scheduleCommand(ctx, { agent: { session: { id: 'demo' } }, rawInput: '', signal: abort.signal } as never)
    try {
      await flushAsyncPaste(); press(term, '\r'); await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('Check the local demo')
      press(term, '\x1b[B\r'); await flushAsyncPaste()
      expect(entry.status).toBe('paused')
      expect(term.visible().join('\n')).toContain(language === 'en' ? 'Resume reminder' : '恢复提醒')
      expect(term.visible().join('\n')).toContain('Ctx 0%')
      press(term, '\r'); await flushAsyncPaste(); expect(entry.status).toBe('active')
      entry = { ...entry, executionActive: true }; ctx.emit('schedule/changed')
      await vi.waitFor(() => expect(term.visible().join('\n')).toContain(language === 'en' ? 'queued or running' : '已排队或正在执行'))
      expect(term.visible().join('\n')).toContain('Ctx 0%')
      expect(edit).toHaveBeenCalledTimes(2)
      press(term, '\x1b[27u'); await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain(language === 'en' ? 'Scheduled tasks' : '定时任务')
      press(term, '\x1b[27u'); await task
      expect(term.visible().filter(row => row.includes('🐳'))).toHaveLength(1)
    } finally { abort.abort(); await task; tui.dispose(); await ctx.fiber.dispose() }
  })

  it('keeps transient service notifications out of transcript and clears them across sessions', () => {
    const term = new ScrollingTerminal(100, 32), tui = new LocalTui(term, 'm', false)
    try {
      tui.notice('Account expired', { transient: true })
      expect(term.visible().join('\n')).toContain('Account expired')
      tui.replaceSession([], undefined, 'idle', 'open')
      expect(term.visible().join('\n')).not.toContain('Account expired')
      tui.replaceSession([], undefined, 'idle', 'refresh')
      expect(term.visible().join('\n')).not.toContain('Account expired')
    } finally { tui.dispose() }
  })

  it('reorders model drafts with the advertised keyboard actions and keeps the moved row selected', async () => {
    const { editModelCatalog } = await import('./model-catalog-editor.ts')
    const term = new ScrollingTerminal(100, 32), tui = new LocalTui(term, 'm', false), ctx = new Context()
    ctx.provide('tui', tui)
    try {
      const task = editModelCatalog(ctx, { models: [{ id: 'one' }, { id: 'two' }], inputField: 'input', reasoningLevels: [] }, new AbortController().signal)
      await flushAsyncPaste()
      press(term, '\x1b[B\x1b[1;3A')
      await flushAsyncPaste()
      const rows = term.visible().join('\n')
      expect(rows).toContain('❯ two')
      expect(rows.indexOf('❯ two')).toBeLessThan(rows.indexOf(' one'))
      press(term, '\x1b[B\x1b[B\x1b[B\r')
      expect(await task).toEqual([{ id: 'two' }, { id: 'one' }])
    } finally { tui.dispose(); await ctx.fiber.dispose() }
  })

  it.each(['en', 'zh-CN'] as const)('opens Models configuration, masks keys and returns to its settings row (%s)', async language => {
    const term = new ScrollingTerminal(100, 32), tui = new LocalTui(term, 'm', false), ctx = new Context()
    tui.applyStoredPrefs({ theme: 'dark', colors: false, uiLanguage: language })
    const mutate = vi.fn(), set = vi.fn()
    ctx.provide('settings', { writable: true, describe: () => [{ ns: 'llm-pi-ai', schema: { type: 'object', dict: {} }, revision: 1, autoGenerate: false, user: { providers: { relay: {} } }, base: {},
      value: { providers: { relay: { apiKeyEnv: 'RELAY_KEY', baseURL: 'https://relay.example/v1', models: [{ id: 'model' }] } } } }], mutate } as never)
    ctx.provide('credentials', { describe: async () => ({ configured: true, writable: true, source: 'file' }), set } as never)
    ctx.provide('llm', { listConfigurableProviders: () => [{ provider: 'relay', displayName: 'Settings', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'relay'], declared: true }],
      listProviders: () => [{ id: 'relay' }], listModels: async () => [{ id: 'model' }] } as never)
    ctx.provide('tui', tui)
    const unbind = tui.bindPluginSettings({ entries: () => pluginSettingsEntries(ctx), edit: (id, signal) => editSettingsEntry(ctx, id, signal) })
    const providerLabel = language === 'en' ? 'Model providers' : '模型服务商'
    try {
      const input = tui.readInput()
      press(term, '/settings\r\t\r')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain(providerLabel)
      expect(term.visible().join('\n')).toContain('Settings')
      press(term, '\r')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain(language === 'en' ? 'Edit the draft' : '编辑草稿')
      press(term, '\r')
      await flushAsyncPaste()
      press(term, 'sk-never-print')
      expect(term.visible().join('\n')).not.toContain('sk-never-print')
      press(term, '\x1b[27u')
      await flushAsyncPaste()
      press(term, '\x1b[B\x1b[B\x1b[B\x1b[B\r')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain(language === 'en' ? 'Keep list' : '保留列表')
      press(term, '\r')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain(language === 'en' ? 'Context window' : '上下文容量')
      press(term, '\x1b[B\x1b[B\r')
      await flushAsyncPaste()
      press(term, '64000\r')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('64000')
      press(term, '\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\r')
      await flushAsyncPaste()
      press(term, '\x1b[B\x1b[B\r')
      await flushAsyncPaste()
      expect(mutate).not.toHaveBeenCalled()

      press(term, '\x1b[27u')
      await flushAsyncPaste()
      press(term, '\x1b[27u')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('❯ ' + (language === 'en' ? 'Endpoints and model lists' : '服务地址与模型列表'))
      expect(mutate).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled()
      press(term, '\x1b[27u')
      press(term, 'next prompt\r')
      expect(await input).toEqual({ text: 'next prompt', images: [] })
    } finally { await unbind(); tui.dispose(); await ctx.fiber.dispose() }
  })

  it.each([
    ['Codex', 'codex', false], ['Codex', 'codex', true],
    ['Claude Code', 'claude', false], ['Claude Code', 'claude', true],
  ] as const)('reads %s status in place and returns through its settings (color=%s)', async (label, id, color) => {
    const term = new ScrollingTerminal(90, 24)
    const tui = new LocalTui(term, 'm', color)
    const ctx = new Context()
    const bundle = id === 'codex' ? '@deepseek-ai/dsh-subagent-codex' : '@deepseek-ai/dsh-subagent-claude-code'
    const row = { name: bundle, availability: 'installation', version: '0.2.1-rc.2', enabled: false, rows: [] }
    const listBundles = vi.fn(async () => [row])
    const listPlugins = vi.fn(async () => [])
    ctx.provide('settings', { describe: () => [] } as never)
    ctx.provide('pluginManager', { listBundles, listPlugins } as never)
    ctx.provide('tui', tui)
    const unbind = tui.bindPluginSettings({ entries: () => pluginSettingsEntries(ctx), edit: (id, signal) => editSettingsEntry(ctx, id, signal) })
    try {
      press(term, `/settings\r\t${id === 'claude' ? '\x1b[B' : ''}\r`)
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('Installation status')
      press(term, '\x1b[B\r')
      await flushAsyncPaste()
      expect(listPlugins).toHaveBeenCalledTimes(1)
      const status = term.visible().join('\n')
      expect(status).toContain(`${label} · Installation status`)
      expect(status).toContain('Included with omdsh')
      expect(status).toContain('Refresh')
      press(term, '\x1b[27u')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('❯ Installation status')
      expect(term.visible().join('\n')).not.toContain('type to filter')
      press(term, '\x1b[27u')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain(`❯ ${label}`)
      expect(term.visible().join('\n')).toContain('● Plugins')
      press(term, '\x1b[27u')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).not.toContain('Included with omdsh')
    } finally { await unbind(); tui.dispose(); await ctx.fiber.dispose() }
  })

  it.each(['field', 'integration'] as const)('settings audit: shows %s save errors before returning to its form', async kind => {
    const term = new ScrollingTerminal(100, 24), tui = new LocalTui(term, 'm', false), ctx = new Context()
    const schema = (await import('@deepseek-ai/schemastery')).default
    ctx.provide('settings', { writable: true, describe: () => kind === 'field' ? [{ ns: 'bash', revision: 1,
      schema: schema.object({ timeoutMs: schema.number().min(1) }).toJSON(), value: { timeoutMs: 5 }, base: {}, user: {} }] : [],
      mutate: async () => { throw new Error('Save failed') } } as never)
    if (kind === 'integration') ctx.provide('pluginManager', {
      listBundles: async () => [{ name: '@deepseek-ai/dsh-subagent-codex', availability: 'installation', enabled: false, rows: [] }],
      setBundleEnabled: async () => ({ application: 'failed', error: { diagnostic: 'Save failed' } }),
    } as never)
    ctx.provide('tui', tui)
    const unbind = tui.bindPluginSettings({ entries: () => pluginSettingsEntries(ctx), edit: (id, signal) => editSettingsEntry(ctx, id, signal) })
    try {
      press(term, '/settings\r\t\r')
      await flushAsyncPaste()
      press(term, '\r'); await flushAsyncPaste()
      if (kind === 'field') {
        press(term, '\x1542\r'); await flushAsyncPaste()
        expect(term.visible().join('\n')).not.toContain('Save failed')
        press(term, '\x1b[B\x1b[B\r'); await flushAsyncPaste()
      }
      expect(term.visible().join('\n')).toContain('Save failed')
      if (kind === 'integration') { press(term, '\x1b[27u'); await flushAsyncPaste() }
      expect(term.visible().join('\n')).toContain(kind === 'field' ? 'Default timeout' : 'Enable integration')
    } finally { await unbind(); tui.dispose(); await ctx.fiber.dispose() }
  })

  it('settings audit: rolls back appearance after a failed async save and retains newer loaded preferences', async () => {
    const term = new ScrollingTerminal(100, 24), tui = new LocalTui(term, 'm', false)
    const pending = Promise.withResolvers<void>()
    const persist = vi.fn(() => pending.promise)
    tui.setPrefsPersist(persist)
    try {
      press(term, '/settings\r\t\x1b[C')
      expect(tui.prefs().theme).toBe('light')
      press(term, '\x1b[C')
      expect(persist).toHaveBeenCalledTimes(1)
      pending.reject(new Error('Appearance save failed'))
      await flushAsyncPaste()
      expect(tui.prefs().theme).toBe('dark')
      expect(term.visible().join('\n')).toContain('Appearance save failed')
      press(term, '\x1b[27u'); await flushAsyncPaste()
      const raced = Promise.withResolvers<void>()
      tui.setPrefsPersist(() => raced.promise)
      press(term, '\x1b[C')
      tui.applyStoredPrefs({ theme: 'nord', colors: false })
      raced.reject(new Error('Configuration changed'))
      await flushAsyncPaste()
      expect(tui.prefs().theme).toBe('nord')
    } finally { pending.resolve(); await tui.dispose() }
  })

  it.each(['resolve', 'reject'] as const)('settings audit: drains an in-flight preference save during idempotent disposal (%s)', async result => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    const pending = Promise.withResolvers<void>()
    tui.setPrefsPersist(() => pending.promise)
    press(term, '/settings\r\t\x1b[C')
    const disposed = tui.dispose()
    expect(tui.dispose()).toBe(disposed)
    const output = term.captured
    let drained = false
    void disposed.then(() => { drained = true })
    await flushAsyncPaste()
    expect(drained).toBe(false)
    tui.applyStoredPrefs({ theme: 'nord', colors: false })
    if (result === 'resolve') pending.resolve()
    else pending.reject(new Error('Late save failure'))
    await disposed
    expect(drained).toBe(true)
    expect(term.captured).toBe(output)
  })

  it('settings audit: keeps feature values unchanged when their patch cannot be written', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'omdsh-feature-failure-'))
    const term = new ScrollingTerminal(100, 24), tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { featurePatch: directory })
    try {
      press(term, '/settings\r\t\x1b[C'); await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('Feature toggles were not saved')
      press(term, '\x1b[27u'); await flushAsyncPaste()
      expect(term.visible().find(row => row.includes('Record file changes'))).toMatch(/\bon\b/u)
    } finally { await tui.dispose(); rmSync(directory, { recursive: true, force: true }) }
  })

  it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)('settings audit: preserves an unreadable but writable Profile patch', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'omdsh-feature-read-failure-')), path = join(directory, 'cordis.patch.yml')
    const original = '# keep custom settings\n- id: custom-plugin\n  disabled: true\n'
    writeFileSync(path, original); chmodSync(path, 0o200)
    const term = new ScrollingTerminal(100, 24), tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { featurePatch: path })
    try {
      press(term, '/settings\r\t\x1b[C'); await flushAsyncPaste()
      chmodSync(path, 0o600)
      expect(readFileSync(path, 'utf8')).toBe(original)
      expect(term.visible().join('\n')).toContain('Feature toggles were not saved')
    } finally { await tui.dispose(); chmodSync(path, 0o600); rmSync(directory, { recursive: true, force: true }) }
  })

  it('serializes inline writes, shows only observed values, and refreshes after a rejected write', async () => {
    const term = new ScrollingTerminal(80, 24)
    const tui = new LocalTui(term, 'm', false)
    let value = 'On', revision = 7
    const settled = Promise.withResolvers<void>()
    const entries = () => [{ id: 'advisor', label: 'Advisor', description: 'Consultations', section: 'integrations' as const,
      inline: { path: ['allowModelConsultations'], value, revision, choices: [{ label: 'On', value: 'true' }, { label: 'Off', value: 'false' }] } }]
    const set = vi.fn(async (entry, choice, signal) => {
      expect(entry.inline.revision).toBe(7)
      expect(choice).toBe('false')
      expect(signal.aborted).toBe(false)
      await settled.promise
      value = 'Off'; revision++
      throw new Error('Configuration changed')
    })
    const unbind = tui.bindPluginSettings({ entries, edit: async () => {}, set })
    try {
      press(term, '/settings\r\t\x1b[C')
      await flushAsyncPaste()
      expect(set).toHaveBeenCalledTimes(1)
      expect(term.visible().join('\n')).toContain('On')
      press(term, '\x1b[C')
      await flushAsyncPaste()
      expect(set).toHaveBeenCalledTimes(1)
      settled.resolve()
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('Configuration changed')
      press(term, '\r')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('❯ Advisor')
      expect(term.visible().join('\n')).toContain('Off')
      expect(term.captured).toContain('Configuration changed')
      expect(tui.prefs()).not.toHaveProperty('allowModelConsultations')
    } finally { settled.resolve(); await unbind(); tui.dispose() }
  })

  it('returns to the same product row when a settings edit changes available categories', async () => {
    const term = new ScrollingTerminal(80, 24)
    const tui = new LocalTui(term, 'm', false)
    let updated = false
    const entries = () => [
      ...(updated ? [{ id: 'child-models', label: 'Subagent models', description: 'Child model selection', section: 'agent' as const }] : []),
      { id: 'advisor', label: 'Advisor', description: 'Consultations', section: 'integrations' as const },
    ]
    const unbind = tui.bindPluginSettings({ entries, edit: async (_id, signal) => {
      await tui.prompt({ title: 'Advisor', question: 'Model consultations', options: [{ label: 'Off' }], allowCustom: false, signal })
      updated = true
    } })
    try {
      press(term, '/settings\r\t\r')
      await flushAsyncPaste()
      press(term, '\x1b[27u')
      await flushAsyncPaste()
      const screen = term.visible().join('\n')
      expect(screen).toContain('● Plugins')
      expect(screen).toContain('❯ Advisor')
      expect(screen).not.toContain('❯ Subagent models')
    } finally { await unbind(); tui.dispose() }
  })

  it('aborts and drains an active plugin form when its Settings binding disappears', async () => {
    const term = new ScrollingTerminal(80, 24)
    const tui = new LocalTui(term, 'm', false)
    const settled = Promise.withResolvers<void>()
    const unbind = tui.bindPluginSettings({ entries: () => [{ id: 'shell', label: 'shell', description: 'Configuration' }],
      edit: async (_id, signal) => {
        await tui.prompt({ title: 'shell', question: 'Choose a field', options: [{ label: 'timeout' }], signal })
        await settled.promise
      } })
    try {
      press(term, '/settings\r\x1b[Z\r')
      await flushAsyncPaste()
      const closed = unbind()
      let drained = false
      void closed.then(() => { drained = true })
      await flushAsyncPaste()
      expect(drained).toBe(false)
      settled.resolve()
      await closed
      expect(term.visible().join('\n')).not.toContain('Advanced')
      press(term, '\x1b[27u')
      expect(term.visible().filter(row => row.includes('🐳'))).toHaveLength(1)
    } finally { settled.resolve(); await unbind(); tui.dispose() }
  })

  it('opens the settings overlay on /settings and cycles theme', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, '/settings\r\t')
    expect(term.captured).toContain('Settings')
    expect(term.captured).toContain('Theme')
    expect(term.captured).toContain('dark')
    press(term, '\r')
    expect(term.captured).toContain('light')
    press(term, '\x1b')
    return new Promise<void>((resolve) => {
      setTimeout(async () => {
        press(term, 'after\r')
        expect(await pending).toBe('after')
        tui.dispose()
        resolve()
      }, 120)
    })
  })

  it('hides the terminal cursor while the non-editable settings overlay is open', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    void tui.readline()
    const beforeOpen = term.captured.length
    press(term, '/settings\r')
    expect(term.captured.slice(beforeOpen)).toContain('\x1b[?25l')
    const beforeClose = term.captured.length
    press(term, '\x03')
    expect(term.captured.slice(beforeClose)).toContain('\x1b[?25h')
    tui.dispose()
  })

  it('opens settings from the /set alias', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    void tui.readline()
    press(term, '/set\r')
    expect(term.captured).toContain('Settings')
    expect(term.captured).toContain('UI language')
    tui.dispose()
  })

  it('keeps individual settings out of slash-command arguments', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    void tui.readline()
    press(term, '/settings theme\r')
    expect(term.captured).toContain('Usage: /settings')
    tui.dispose()
  })

  it('writes only changed preferences and returns from a searched product form to the same result', async () => {
    const term = new ScrollingTerminal(100, 24)
    const tui = new LocalTui(term, 'm', false)
    const persist = vi.fn()
    tui.setPrefsPersist(persist)
    const unbind = tui.bindPluginSettings({ entries: () => [{ id: 'shell', label: 'Shell', description: 'Timeout', section: 'tools' }],
      edit: async (_id, signal) => { await tui.prompt({ title: 'Shell field', question: 'Choose', options: [{ label: 'Timeout' }], signal }) } })
    try {
      press(term, '/settings\r\t\t\x1b[C')
      expect(persist.mock.calls[0]?.[1]).toEqual([{ op: 'set', path: ['theme'], value: 'light' }])
      press(term, 'Shell\r')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('Shell field')
      press(term, '\x1b[27u')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('Search: Shell')
      expect(term.visible().join('\n')).toContain('❯ Shell')
    } finally { await unbind(); await tui.dispose() }
  })

  it('refreshes integration summaries without losing a typed search and ignores a stale refresh', async () => {
    const term = new ScrollingTerminal(100, 24)
    const tui = new LocalTui(term, 'm', false)
    const first = Promise.withResolvers<readonly import('../views/settings-list.ts').PluginSettingsEntry[]>()
    const second = Promise.withResolvers<readonly import('../views/settings-list.ts').PluginSettingsEntry[]>()
    const row = { id: 'integration:codex', label: 'Codex', description: 'Registered integration', section: 'integrations' as const }
    const refresh = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const unbind = tui.bindPluginSettings({ entries: () => [row], edit: async () => {}, refresh })
    try {
      press(term, '/settings\r')
      press(term, 'Codex')
      tui.applyStoredPrefs({ theme: 'dark', colors: false })
      second.resolve([{ ...row, summary: 'Enabled' }]); await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('Search: Codex')
      expect(term.visible().join('\n')).toContain('Enabled')
      first.resolve([{ ...row, summary: 'Disabled' }]); await flushAsyncPaste()
      expect(term.visible().join('\n')).not.toContain('Disabled')
    } finally { first.resolve([row]); second.resolve([row]); await unbind(); await tui.dispose() }
  })

  it('opens the registered model selector from Agent settings and returns on cancellation', async () => {
    const term = new ScrollingTerminal(100, 24)
    const tui = new LocalTui(term, 'm', false)
    tui.setCommands([{ name: 'model', description: 'Choose model' }])
    const input = tui.readline()
    try {
      press(term, '/settings\r')
      press(term, 'Model and reasoning')
      press(term, '\r')
      await flushAsyncPaste()
      expect(await input).toBe('/model')
      const selector = tui.prompt({ title: 'Existing model selector', question: 'Choose a model', options: [{ label: 'Current' }] })
      expect(term.visible().join('\n')).toContain('Existing model selector')
      press(term, '\x1b[27u'); expect(await selector).toBeNull(); await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('Search: Model and reasoning')
      expect(term.visible().join('\n')).toContain('❯ Model and reasoning')
    } finally { await tui.dispose(); await input }
  })

  it('persists theme changes made in the settings overlay', async () => {
    const persisted: Array<{ theme: string; colors: boolean }> = []
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.setPrefsPersist((prefs) => { persisted.push(prefs) })
    const pending = tui.readline()
    press(term, '/settings\r\t')
    press(term, '\r')
    expect(persisted).toEqual([{
      uiLanguage: 'auto',
      theme: 'light',
      colors: false,
      motion: 'full',
      mathMode: 'auto',
      mermaidMode: 'auto',
      hideThinking: true,
      showFileChanges: true,
      editor: 'auto',
      terminalTitle: 'status',
      terminalState: 'auto',
      copyOnSelect: true,
      mouseInteraction: 'auto',
      busyEnter: 'queue',
      pasteProtection: true,
      checkUpdates: true,
      startupChangelog: 'summary',
      notifications: 'off',
      statusBar: {
        density: 'standard',
        // The whole document goes out, not a density-only projection: dropping
        // the deltas made every later re-read of the preferences show the parts
        // the reader had just hidden.
        hidden: [],
        shown: [],
        enabled: true,
      },
    }])
    press(term, '\x03')
    tui.applyStoredPrefs({ theme: 'dark', colors: true, expandTools: false })
    expect(term.captured).not.toContain('Theme: dark')
    press(term, 'ok\r')
    expect(await pending).toBe('ok')
    tui.dispose()
  })

  it('persists a status density change and restores it on the next launch', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    let saved: ReturnType<LocalTui['prefs']> | undefined
    tui.setPrefsPersist(prefs => { saved = prefs })
    void tui.readline()
    // Interface → walk down to Density → cycle its value. The row lives in
    // Interface because it shapes the whole footer, not just its second line.
    press(term, '/settings\r\t')
    press(term, 'Density')
    press(term, '\r')
    press(term, '\x1b[C')
    if (saved === undefined) throw new Error('Density was not persisted')
    expect(saved.statusBar?.density).not.toBe('standard')
    tui.dispose()
    const restored = new LocalTui(new FakeTerminal(), 'm', false)
    restored.applyStoredPrefs(saved)
    expect(restored.prefs().statusBar?.density).toBe(saved.statusBar?.density)
    restored.dispose()
  })

  it('persists the Ralph feature toggle across TUI launches', () => {
    const directory = mkdtempSync(join(tmpdir(), 'omdsh-feature-toggle-'))
    const featurePatch = join(directory, 'cordis.patch.yml')
    const handwritten = '# keep this row\n- id: custom-plugin\n  disabled: true\n'
    writeFileSync(featurePatch, handwritten)
    let tui: LocalTui | undefined
    try {
      for (const initial of ['off', 'on']) {
        const term = new FakeTerminal()
        tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { featurePatch })
        void tui.readline()
        press(term, '/settings\r\t')
        press(term, '\x1b[B\x1b[B')
        const screen = emulatedScreenRows(term.captured).map(stripAnsi).join('\n')
        expect(screen).toMatch(new RegExp(`Ralph loop\\s+${initial}`, 'u'))
        press(term, '\r')
        const patch = readFileSync(featurePatch, 'utf8')
        expect(patch).toContain(handwritten.trim())
        if (initial === 'off') expect(patch).toContain('- id: tool-ralph\n  disabled: false')
        else expect(patch).not.toContain('tool-ralph')
        tui.dispose()
        tui = undefined
      }
    } finally {
      tui?.dispose()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps an unconfigured session colorless under NO_COLOR', () => {
    vi.stubEnv('NO_COLOR', '1')
    vi.stubEnv('COLORTERM', 'truecolor')
    try {
      const term = new FakeTerminal()
      const tui = new LocalTui(term, 'm', undefined)
      tui.notice('probe', { level: 'error' })

      // The viewport still emits cursor and sync controls (`?2026h`, `2K`), so
      // the no-color contract is the absence of every SGR sequence.
      expect(term.captured).toContain('probe')
      expect(term.captured).not.toMatch(/\x1b\[[0-9;]*m/u)
      tui.dispose()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('lets an explicit color preference override NO_COLOR', () => {
    vi.stubEnv('NO_COLOR', '1')
    vi.stubEnv('COLORTERM', 'truecolor')
    try {
      const term = new FakeTerminal()
      const tui = new LocalTui(term, 'm', true)
      tui.notice('probe', { level: 'error' })

      // NO_COLOR still suppresses 24-bit, but an explicit preference keeps SGR.
      expect(term.captured).toContain('\x1b[31mprobe')
      tui.dispose()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('treats an empty NO_COLOR as unset for an unconfigured session', () => {
    vi.stubEnv('NO_COLOR', '')
    vi.stubEnv('COLORTERM', 'truecolor')
    try {
      const term = new FakeTerminal()
      const tui = new LocalTui(term, 'm', undefined)
      tui.notice('probe', { level: 'error' })

      expect(term.captured).toContain('\x1b[38;2;243;139;168mprobe')
      tui.dispose()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('keeps an unconfigured session colorless on a piped output stream', () => {
    vi.stubEnv('NO_COLOR', undefined)
    vi.stubEnv('FORCE_COLOR', undefined)
    try {
      const term = new FakeTerminal()
      term.output.isTTY = false
      const tui = new LocalTui(term, 'm', undefined)
      tui.notice('probe', { level: 'error' })

      expect(term.captured).toContain('probe')
      expect(term.captured).not.toMatch(/\x1b\[[0-9;]*m/u)
      tui.dispose()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('repaints the settings overlay with color after the switch is toggled on', () => {
    vi.stubEnv('COLORTERM', 'truecolor')
    vi.stubEnv('NO_COLOR', undefined)
    vi.stubEnv('FORCE_COLOR', undefined)
    try {
      const term = new FakeTerminal()
      const tui = new LocalTui(term, 'm', false)
      void tui.readline()
      press(term, '/settings\r\t')
      press(term, '\x1b[B')
      // Dark accent is brand blue #7c93ff; a colorless session emits no SGR at all.
      expect(term.captured).not.toContain('\x1b[38;2;137;180;250m')

      // Row 1 is `Colors`; toggling it applies immediately, without a restart.
      press(term, '\r')
      expect(term.captured).toContain('\x1b[38;2;137;180;250m')
      expect(term.captured).not.toContain('\x1b[33m')
      tui.dispose()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('repaints notices with 24-bit color once settings turn color back on', () => {
    // Pin the capability query so the assertion cannot inherit the runner's
    // own terminal environment.
    vi.stubEnv('COLORTERM', 'truecolor')
    vi.stubEnv('NO_COLOR', undefined)
    vi.stubEnv('FORCE_COLOR', undefined)
    try {
      const term = new FakeTerminal()
      const tui = new LocalTui(term, 'm', false)
      tui.notice('colorless', { level: 'error' })
      expect(term.captured).not.toContain('\x1b[38;2;243;139;168m')
      expect(term.captured).not.toContain('\x1b[31m')

      tui.applyStoredPrefs({ theme: 'dark', colors: true, expandTools: false })
      tui.notice('colorful', { level: 'error' })

      // Dark error ink is #fc4353; the 16-color fallback emits `31`.
      expect(term.captured).toContain('\x1b[38;2;243;139;168mcolorful')
      expect(term.captured).not.toContain('\x1b[31m')
      tui.dispose()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('mirrors the folded session title into the terminal window title', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.applyStoredPrefs({ theme: 'dark', colors: false, terminalTitle: 'session', terminalState: 'off' })
    const titleWrites = (sequence: string): number => term.captured.split(sequence).length - 1

    tui.setSession({ id: 'session-1', title: 'Fix \u001b[31mthe parser\u0007', recent: [] })
    // Control characters are replaced, so a title can never inject or close OSC 2.
    const written = '\x1b]2;Fix [31mthe parser\x07'
    expect(titleWrites(written)).toBe(1)

    // An unchanged title must not re-emit the sequence on every session push.
    tui.setSession({ id: 'session-1', title: 'Fix \u001b[31mthe parser\u0007', recent: [] })
    expect(titleWrites(written)).toBe(1)

    tui.setSession({ id: 'session-1', title: 'Add the export flag', recent: [] })
    expect(term.captured).toContain('\x1b]2;Add the export flag\x07')
    tui.dispose()
  })

  it('switches UI language immediately, preserves the row and saves only the UI preference', async () => {
    const term = new ScrollingTerminal(100, 24), tui = new LocalTui(term, 'm', false)
    const persist = vi.fn(), response = vi.fn(async () => {})
    tui.setPrefsPersist(persist)
    tui.bindAgentBehaviorSettings({ get: () => ({ language: 'en' }), update: response, watch: () => () => {} })
    try {
      press(term, '/settings\r\x1b[C')
      expect(term.visible().join('\n')).toContain('❯ 界面语言')
      expect(term.visible().join('\n')).toContain('回复语言')
      expect(persist.mock.calls[0]?.[1]).toEqual([{ op: 'set', path: ['uiLanguage'], value: 'zh-CN' }])
      expect(response).not.toHaveBeenCalled()
      press(term, '\x1b[C')
      expect(term.visible().join('\n')).toContain('❯ UI language')
      expect(tui.prefs().uiLanguage).toBe('en')
      expect(term.captured).not.toContain('\x1b[3J')
    } finally { await tui.dispose() }
  })

  it('localizes the exit hint while retaining an executable resume command', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    tui.applyStoredPrefs({ ...tui.prefs(), uiLanguage: 'zh-CN' })
    tui.setSession({ id: 'language-resume', recent: [] })
    press(term, '\x03\x03')
    await tui.dispose()
    expect(term.captured).toContain('使用以下命令恢复此会话：omdsh --resume language-resume')
    expect(term.raw).toBe(false)
    expect(term.captured).not.toContain('\x1b[3J')
  })

  it('updates open menu copy while retaining its selection and canonical answer', async () => {
    const term = new ScrollingTerminal(100, 24), tui = new LocalTui(term, 'm', false)
    try {
      const answer = tui.prompt({ localize: true, title: 'Plugins', question: 'Manage this profile',
        detail: 'Input', options: [{ label: 'Allow once' }, { label: 'Reject' }], allowCustom: false })
      press(term, '\x1b[B')
      tui.applyStoredPrefs({ ...tui.prefs(), uiLanguage: 'zh-CN' })
      expect(term.visible().join('\n')).toContain('插件')
      expect(term.visible().join('\n')).toContain('Input')
      expect(term.visible().join('\n')).toContain('拒绝')
      press(term, '\r')
      expect(await answer).toBe('Reject')
      const question = tui.prompt({ title: 'Question', question: 'Cancel', options: [{ label: 'Allow once' }], allowCustom: false })
      expect(term.visible().join('\n')).toContain('Cancel')
      expect(term.visible().join('\n')).toContain('Allow once')
      press(term, '\r')
      expect(await question).toBe('Allow once')
    } finally { await tui.dispose() }
  })

  it('rolls back a failed UI-language write and preserves native history', async () => {
    const term = new ScrollingTerminal(100, 24), tui = new LocalTui(term, 'm', false)
    tui.setPrefsPersist(() => Promise.reject(new Error('Language save failed')))
    try {
      tui.applyStoredPrefs({ ...tui.prefs(), uiLanguage: 'en' })
      press(term, '/settings\r\x1b[D')
      expect(term.visible().join('\n')).toContain('界面语言')
      await flushAsyncPaste()
      expect(tui.prefs().uiLanguage).toBe('en')
      expect(term.visible().join('\n')).toContain('Language save failed')
      expect(term.captured).not.toContain('\x1b[3J')
    } finally { await tui.dispose() }
  })

  it('binds the product-owned Agent language section and persists its value', async () => {
    const updates: Array<{ language: string }> = []
    let publish: ((next: { language: 'auto' | 'zh-CN' | 'en' }) => void) | undefined
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const unbind = tui.bindAgentBehaviorSettings({
      get: () => ({ language: 'auto' }),
      update: async next => { updates.push(next) },
      watch: listener => {
        publish = listener
        return () => { publish = undefined }
      },
    })
    void tui.readline()
    press(term, '/settings\r')
    expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).toContain('● General')
    press(term, '\x1b[B\x1b[C')
    await flushAsyncPaste()
    expect(updates).toEqual([{ language: 'zh-CN' }])
    expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).toContain('Simplified Chinese')
    publish?.({ language: 'en' })
    expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).toContain('English')
    unbind()
    tui.dispose()
  })

  it('rolls back an optimistic Agent language change when persistence fails', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.bindAgentBehaviorSettings({
      get: () => ({ language: 'auto' }),
      update: async () => { throw new Error('disk unavailable') },
      watch: () => () => {},
    })
    void tui.readline()
    press(term, '/settings\r')
    press(term, '\x1b[B\x1b[C')
    expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).toContain('Simplified Chinese')
    await flushAsyncPaste()
    expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).toContain('Could not save Agent language: disk unavailable')
    press(term, '\x1b')
    await new Promise<void>(resolve => { setTimeout(resolve, 120) })
    expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).toContain('Auto')
    press(term, '\x1b')
    await new Promise<void>(resolve => { setTimeout(resolve, 120) })
    expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).toContain(
      'Could not save Agent language: disk unavailable',
    )
    tui.dispose()
  })

  it('does not submit /clear as a prompt', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'keep-me' }] }, 1))
    press(term, '/clear\r')
    press(term, 'next\r')
    expect(await pending).toBe('next')
    tui.dispose()
  })

  it('keeps the cleared transcript in the terminal history, behind a seam', async () => {
    const term = new FakeTerminal()
    term.height = () => 24
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'before-the-clear' }] }, 1))
    // Exchanges, not tool calls: a run of calls folds into one header, and a
    // folded row never reaches scrollback, which is the only place "retained"
    // can be observed from.
    for (let i = 0; i < 20; i += 1) {
      tui.event(ev('assistant/message', {
        turn: i + 1,
        step: 1,
        message: { role: 'assistant', content: [{ type: 'text', text: `answer-number-${i}` }] },
      }, 10 + i * 2))
    }
    press(term, '/clear\r')
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'after-the-clear' }] }, 900))
    const screen = emulatedScreenRows(term.captured).map(stripAnsi).join('\n')
    expect(screen).toContain('transcript cleared · earlier output retained')
    expect(screen).toContain('after-the-clear')
    expect(screen).not.toContain('before-the-clear')
    // What the reader scrolled past is still there to scroll back into, and the
    // escape that would have destroyed it is never emitted.
    expect(term.captured).not.toContain('\x1b[3J')
    expect(term.captured).toContain('answer-number-19')
    // `/clear` re-arms the composer with an empty prompt, so the readline this
    // test opened is settled by the next submit rather than by the clear.
    press(term, '\r')
    expect(await pending).toBe('')
    tui.dispose()
  })

  it('treats an unknown slash command as a local notice', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, '/nope\r')
    expect(term.captured).toContain('unknown command: /nope')
    press(term, 'ok\r')
    expect(await pending).toBe('ok')
    tui.dispose()
  })

  it('opens history search on ctrl+r', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const first = tui.readline()
    press(term, 'find the files\r')
    await first
    void tui.readline()
    press(term, '\x12')
    expect(term.captured).toContain('Search History')
    expect(term.captured).toContain('find the files')
    tui.dispose()
  })

  it('honors a remapped history-search chord', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'omdsh-keys-')), 'keys.json')
    writeFileSync(path, JSON.stringify({ 'ctrl+r': 'toggle-tools', 'alt+s': 'search-history' }))
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', async () => {}, { keybindingsPath: path })
    const first = tui.readline()
    press(term, 'find the files\r')
    await first
    void tui.readline()

    press(term, '\x12')
    expect(term.captured).not.toContain('Search History')
    press(term, '\x1bs')
    expect(term.captured).toContain('Search History')
    tui.dispose()
  })

  it('opens transcript search with ctrl+f on an empty composer', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const first = tui.readline()
    press(term, 'find the needle\r')
    await first
    void tui.readline()

    press(term, '\x06')
    expect(term.captured).toContain('Search:')
    press(term, 'needle')
    expect(term.captured).toContain('Search: needle')
    press(term, '\r')
    press(term, 'n')
    expect(term.captured).toContain('n/N next')
    tui.dispose()
  })

  it('leaves ctrl+f to the editor while a draft is present', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    void tui.readline()

    press(term, 'ab')
    press(term, '\x06')
    expect(term.captured).not.toContain('Search:')
    tui.dispose()
  })

  it('filters history and inserts a match without submitting', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const first = tui.readline()
    press(term, 'aaa\r')
    await first
    const second = tui.readline()
    press(term, 'unique zebra\r')
    await second
    const pending = tui.readline()
    press(term, '\x12')
    press(term, 'zebra')
    expect(term.captured).toContain('unique zebra')
    press(term, '\r')
    press(term, '\r')
    expect(await pending).toBe('unique zebra')
    tui.dispose()
  })

  it('cancels history search on Escape and restores the editor', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const first = tui.readline()
    press(term, 'keep\r')
    await first
    const pending = tui.readline()
    press(term, 'draft')
    press(term, '\x12')
    press(term, '\x1b')
    return new Promise<void>((resolve) => {
      setTimeout(async () => {
        press(term, '\r')
        expect(await pending).toBe('draft')
        tui.dispose()
        resolve()
      }, 120)
    })
  })

  it('closes history search on Ctrl-C without interrupting', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    let fired = 0
    tui.onInterrupt(() => { fired += 1 })
    tui.setStatus('running')
    press(term, '\x12')
    press(term, '\x03')
    expect(fired).toBe(0)
    expect(term.captured).toContain('Search History')
    tui.dispose()
  })

  it('dismisses the slash popup on Escape without interrupting', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    let fired = 0
    tui.onInterrupt(() => { fired += 1 })
    press(term, '/')
    press(term, '\x1b')
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(fired).toBe(0)
        tui.dispose()
        resolve()
      }, 120)
    })
  })

  it('scrolls the clipped transcript with pageUp and pageDown', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    for (let i = 0; i < 16; i += 1) {
      tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'mark-' + i }] }, i))
    }
    // Follow mode renders the full transcript and lets the terminal's native
    // scrollback keep it; no in-frame scroll indicators.
    expect(term.captured).toContain('mark-15')
    expect(term.captured).not.toContain('earlier lines')
    expect(term.captured).not.toContain('later line')
    press(term, '\x1b[5~')
    expect(term.captured).toContain('later line')
    const before = term.captured.length
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'NEW-TAIL' }] }, 99))
    expect(term.captured.slice(before)).not.toContain('NEW-TAIL')
    for (let i = 0; i < 24; i += 1) press(term, '\x1b[6~')
    expect(term.captured).toContain('NEW-TAIL')
    tui.dispose()
  })

  it('retains multiline streamed call input for the approval reader', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.event(ev('tool/call', { callId: 'call-9', name: 'bash', arguments: '{"command":"rm -rf build"}' }, 1))

    const summary = tui.toolCallContext('call-9')
    expect(summary).toContain('rm -rf build')
    expect(summary).toContain('\n')
    expect(tui.toolCallContext('never-streamed')).toBeUndefined()
    tui.dispose()
  })

  it.each(['compact', 'standard', 'detailed', 'verbose'] as const)('normalizes old %s preferences without changing the turn presentation', foldDensity => {
    const term = new ScrollingTerminal(80, 40)
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 3, 1)
    const before = term.visible()
    tui.applyStoredPrefs({ theme: 'dark', colors: false, expandTools: true, foldDensity })
    expect(tui.prefs()).not.toHaveProperty('foldDensity')
    expect(term.visible()).toEqual(before)
    press(term, '\x0f')
    expect(term.visible().join('\n')).toContain('src/c3b.ts')
    expect(term.visible().join('\n')).not.toContain('Worked')
    tui.dispose()
  })

  it('folds a background job that settles mid-turn into the turn, and not one that settles after', () => {
    const term = new FakeTerminal()
    term.height = () => 60
    const tui = new LocalTui(term, 'm', false)
    const read = (id: string, seq: number): void => {
      tui.event(ev('tool/call', { turn: 1, step: 1, callId: id, name: 'read', arguments: `{"path":"${id}"}` }, seq))
      tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: id, content: [{ type: 'text', text: 'x' }] } }, seq + 1))
    }
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] }, 1))
    tui.event(ev('turn/start', { turn: 1 }, 2))
    read('a', 3)
    tui.notice('Background job bash-1 completed', { process: true })
    read('b', 5)
    tui.event(ev('assistant/message', {
      turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'All done.' }] },
    }, 7))
    tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 8))
    tui.notice('Background job bash-2 completed', { process: true })
    const screen = emulatedScreenRows(term.captured).map(stripAnsi).join('\n')

    // One run for the whole turn: the mid-turn notice is one of its rows.
    expect(screen.match(/^  ▸ /gmu)).toHaveLength(1)
    expect(screen).not.toContain('bash-1')
    // With no turn running, a notice speaks to the reader and stays visible.
    expect(screen).toContain('bash-2')
    tui.dispose()
  })

  it('opens a completed single-call turn, expands the call, and closes it again', () => {
    const term = new ScrollingTerminal(80, 40)
    const tui = new LocalTui(term, 'm', false)
    tui.event(ev('turn/start', { turn: 1 }, 0))
    tui.event(ev('tool/call', { callId: 'call-1', name: 'bash', arguments: '{"command":"ls"}' }, 1))
    tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: Array.from({ length: 14 }, (_, i) => `tool-line-${i}`).join('\n') }] } }, 2))
    tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3))
    const before = term.visible()
    const history = term.scrollback()
    expect(before.join('\n')).toContain('Worked')
    expect(before.join('\n')).not.toContain('tool-line-13')
    press(term, '\x0f')
    expect(term.visible().join('\n')).not.toContain('tool-line-13')
    press(term, '\r')
    expect(term.visible().join('\n')).toContain('tool-line-13')
    expect(term.visible().join('\n')).toContain('tool-line-0')
    expect(term.visible().join('\n')).not.toContain('Worked')
    press(term, '\x0f')
    expect(term.visible()).toEqual(before)
    expect(term.scrollback()).toEqual(history)
    tui.dispose()
  })

  it('opens an earlier completed turn after paging back', () => {
    const term = new ScrollingTerminal(80, 30)
    const tui = new LocalTui(term, 'm', false)
    for (let turn = 1; turn <= 10; turn++) longTurn(tui, 2, 1, true, turn)
    press(term, '\x1b[5~')
    const before = term.visible()
    const history = term.scrollback()
    press(term, '\x0f')
    const opened = term.visible().join('\n')
    expect(term.visible()).not.toEqual(before)
    expect(opened).toMatch(/src\/(?:t[2-9])?c2b\.ts/u)
    expect(opened).not.toContain('src/t10c2b.ts')
    expect(term.scrollback()).toEqual(history)
    tui.dispose()
  })

  it.each(['standard', 'verbose'] as const)('reads thinking inside a finished run in %s density', (foldDensity) => {
    const term = new ScrollingTerminal(100, 40)
    const tui = new LocalTui(term, 'm', false)
    tui.applyStoredPrefs({ theme: 'dark', colors: false, foldDensity })
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] }, 1))
    tui.event(ev('turn/start', { turn: 1 }, 2))
    tui.event(ev('assistant/message', {
      turn: 1, step: 1, message: { role: 'assistant', content: [
        { type: 'reasoning', text: 'first thought paragraph\n\nLatest heading\nsecond thought paragraph with detail' },
      ] },
    }, 3))
    tui.event(ev('tool/call', { turn: 1, step: 1, callId: 'thought-read', name: 'read', arguments: '{"path":"src/file.ts"}' }, 4))
    tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: 'thought-read', content: [{ type: 'text', text: 'payload first line\nfull tool detail' }] } }, 5))
    tui.event(ev('assistant/message', { turn: 1, step: 2, message: { role: 'assistant', content: [
      { type: 'reasoning', text: 'answer thought start\n\nLatest answer heading\nanswer thought detail' },
      { type: 'text', text: 'all done' },
    ] } }, 6))
    tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 7))
    tui.setStatus('idle')
    expect(term.visible().join('\n')).not.toContain('second thought paragraph with detail')
    const history = term.scrollback()
    press(term, '\x0f')
    expect(term.visible().join('\n')).not.toContain('second thought paragraph with detail')
    press(term, '\x1b[A\x1b[A\r')
    expect(term.visible().join('\n')).toContain('second thought paragraph with detail')
    expect(term.visible().join('\n')).toContain('Read file · src/file.ts')
    expect(term.visible().join('\n')).not.toContain('full tool detail')
    expect(term.visible().join('\n')).not.toContain('answer thought detail')
    press(term, '\x1b[B\x1b[B\r')
    expect(term.visible().join('\n')).toContain('answer thought detail')
    press(term, '\x0f')
    expect(term.visible().join('\n')).not.toContain('second thought paragraph with detail')
    expect(term.scrollback()).toEqual(history)
    tui.dispose()
  })

  it('opens a folded thought with ctrl+o and closes it again', () => {
    const term = new FakeTerminal()
    term.height = () => 40
    const tui = new LocalTui(term, 'm', false)
    tui.event(ev('assistant/message', {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'first paragraph\n\nsecond paragraph with the detail' },
          { type: 'text', text: 'the-answer' },
        ],
      },
    }, 1))
    const folded = term.captured
    expect(folded).not.toContain('second paragraph with the detail')
    const beforeOpen = term.captured.length
    // A fold state that never reaches the render cache would leave the screen
    // byte-identical here, so this asserts the repaint, not just the state.
    press(term, '\x0f\r')
    const opened = term.captured.slice(beforeOpen)
    expect(opened).toContain('second paragraph with the detail')
    const beforeClose = term.captured.length
    press(term, '\x0f')
    expect(term.captured.slice(beforeClose)).not.toContain('second paragraph with the detail')
    tui.dispose()
  })

  it('opens a folded process group with ctrl+o and closes it again', () => {
    const term = new FakeTerminal()
    term.height = () => 40
    const tui = new LocalTui(term, 'm', false)
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] }, 1))
    for (let i = 0; i < 3; i += 1) {
      tui.event(ev('tool/call', { callId: `c${i}`, name: 'bash', arguments: `{"command":"cmd-${i}"}` }, 2 + i * 2))
      tui.event(ev('tool/result', {
        message: { role: 'tool', toolCallId: `c${i}`, content: [{ type: 'text', text: `out-${i}` }] },
      }, 3 + i * 2))
    }
    tui.event(ev('assistant/message', {
      turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    }, 9))
    expect(term.captured).toContain('Worked')
    expect(emulatedScreenRows(term.captured).join('\n')).not.toContain('cmd-1')
    const beforeOpen = term.captured.length
    press(term, '\x0f\r')
    const opened = term.captured.slice(beforeOpen)
    expect(opened).toMatch(/cmd-[0-2]/u)
    const beforeClose = term.captured.length
    press(term, '\x0f')
    expect(term.captured.slice(beforeClose)).not.toMatch(/cmd-[0-2]/u)
    tui.dispose()
  })

  it('does not render background activity, but a selected external agent prints its detail', () => {
    vi.useFakeTimers()
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    try {
      const agent = { id: 'child', depth: 1, label: 'Worker', phase: 'running' as const, mode: 'external' as const, activity: [] }
      tui.setSubagents({ agents: [agent] })
      vi.advanceTimersByTime(8)
      const width = vi.spyOn(term, 'width')
      for (let index = 0; index < 120; index += 1) {
        tui.setSubagents({ agents: [{ ...agent, activity: [{ text: `read file-${index}`, status: 'running' }] }] })
      }
      vi.advanceTimersByTime(8)
      expect(width.mock.calls.length).toBe(0)
      expect(term.captured).not.toContain('read file-')
      // The bar selects without opening anything: `↓` then `Enter` asks for the
      // row the reader pointed at.
      press(term, '\x1b[B')
      press(term, '\r')
      expect(term.captured).toContain('read file-119')
      width.mockClear()
      tui.setSubagents({ agents: [{ ...agent, activity: [{ text: 'read next-file', status: 'running' }] }] })
      vi.advanceTimersByTime(8)
      // Nothing is watching the row any more, so a new activity repaints nothing.
      expect(width.mock.calls.length).toBe(0)
      // The printed result is a snapshot: a later activity does not rewrite it.
      expect(term.captured).not.toContain('read next-file')
    } finally {
      tui.dispose()
      vi.useRealTimers()
    }
  })

  it('coalesces settlement event renders while busy but keeps control events immediate', () => {
    vi.useFakeTimers()
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    try {
      tui.event(ev('turn/start', { turn: 1 }, 1))
      const width = vi.spyOn(term, 'width')
      for (let seq = 2; seq <= 10; seq += 1) {
        tui.event(ev('step/start', { turn: 1, step: seq }, seq))
        tui.event(ev('step/end', {}, seq + 100))
      }
      // Every settlement event coalesced into one pending stream render.
      expect(width.mock.calls.length).toBe(0)
      vi.advanceTimersByTime(8)
      expect(width.mock.calls.length).toBe(1)
      // Control events still paint at once even while the turn is running.
      tui.event(ev('command/run', { commandId: 'c1', name: 'compact', source: { kind: 'user' } }, 200))
      expect(width.mock.calls.length).toBe(2)
      // turn/end flips status to idle, so the settle paint stays immediate.
      tui.event(ev('command/done', { commandId: 'c1', kind: 'success' }, 201))
      tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 202))
      expect(width.mock.calls.length).toBeGreaterThanOrEqual(4)
    } finally {
      tui.dispose()
      vi.useRealTimers()
    }
  })

  it('coalesces roster state changes and handles input without waiting for the roster timer', () => {
    vi.useFakeTimers()
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    try {
      const width = vi.spyOn(term, 'width')
      const agent = { id: 'child', depth: 1, label: 'Worker', activity: [] }
      tui.setSubagents({ agents: [{ ...agent, phase: 'starting' }] })
      tui.setSubagents({ agents: [{ ...agent, phase: 'running' }] })
      tui.setSubagents({ agents: [{ ...agent, phase: 'waiting' }] })
      expect(width.mock.calls.length).toBe(0)
      vi.advanceTimersByTime(8)
      expect(width.mock.calls.length).toBe(1)
      expect(term.captured).toContain('Worker · Ready')
      tui.setSubagents({ agents: [{ ...agent, phase: 'completed' }] })
      press(term, 'input')
      expect(term.captured).toContain('input')
      expect(term.captured).toContain('Worker · Done')
      const renders = width.mock.calls.length
      vi.advanceTimersByTime(8)
      expect(width.mock.calls.length).toBe(renders)
    } finally {
      tui.dispose()
      vi.useRealTimers()
    }
  })

  it('selects a roster row with down and opens that agent directly', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const opened: string[] = []
    tui.onInspectSubagent(id => { opened.push(id) })
    tui.setSubagents({
      agents: [
        { id: 'child-1', depth: 1, label: 'Explore auth', phase: 'running', activity: [] },
        { id: 'child-2', depth: 1, label: 'Review tests', phase: 'waiting', activity: [] },
      ],
    })

    press(term, '\x1b[B')
    expect(term.captured).toContain('↑↓ · Enter open · Esc')
    // One stop, not two: the row chosen in the bar opens its transcript.
    press(term, '\x1b[B')
    press(term, '\r')
    await flushAsyncPaste()

    expect(opened).toEqual(['child-2'])
    tui.dispose()
  })

  it('steers a writable inspected subagent without resolving parent input', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const steered: string[] = []
    tui.onInspectSubmit(submission => { steered.push(submission.text) })
    const pending = tui.readInput()
    tui.setInspectedSubagent({
      id: 'child-1', label: 'Explore auth', phase: 'waiting', mode: 'continuable', writable: true,
    })
    press(term, 'keep going\r')
    expect(steered).toEqual(['keep going'])
    tui.dispose()
    expect(await pending).toBe(null)
  })

  it('clears a writable inspect draft on Escape before leaving', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const closed: number[] = []
    tui.onInspectClose(() => { closed.push(1) })
    tui.setInspectedSubagent({
      id: 'child-1', label: 'Explore auth', phase: 'waiting', mode: 'continuable', writable: true,
    })
    press(term, 'draft')
    press(term, '\x1b')
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(closed).toEqual([])
        press(term, '\x1b')
        setTimeout(() => {
          expect(closed).toEqual([1])
          tui.dispose()
          resolve()
        }, 120)
      }, 120)
    })
  })

  it('hides the composer cursor while a read-only inspect is open', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    term.captured = ''
    tui.setInspectedSubagent({
      id: 'child-1', label: 'Explore auth', phase: 'running', writable: false,
    })
    expect(term.captured).toContain('\x1b[?25l')
    term.captured = ''
    tui.setInspectedSubagent({
      id: 'child-1', label: 'Explore auth', phase: 'waiting', mode: 'continuable', writable: true,
    })
    expect(term.captured).toContain('\x1b[?25h')
    expect(term.captured).not.toContain('\x1b[?25l')
    tui.dispose()
  })

  it('returns from an inspected subagent on Escape', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const closed: number[] = []
    tui.onInspectClose(() => { closed.push(1) })
    tui.setInspectedSubagent({ id: 'child-1', label: 'Explore auth', phase: 'running', writable: false })
    press(term, '\x1b')
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(closed).toEqual([1])
        tui.dispose()
        resolve()
      }, 120)
    })
  })

  it('does not route repeated Escape to the parent after closing an inspected subagent', async () => {
    vi.useFakeTimers()
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    try {
      let closed = 0
      let interrupted = 0
      tui.onInterrupt(() => { interrupted += 1 })
      tui.onInspectClose(() => {
        closed += 1
        tui.setInspectedSubagent(undefined)
        tui.setStatus('running')
      })
      tui.setInspectedSubagent({ id: 'child-1', label: 'Explore auth', phase: 'running', writable: false })

      press(term, '\x1b')
      await vi.advanceTimersByTimeAsync(81)
      expect(closed).toBe(1)

      press(term, '\x1b')
      await vi.advanceTimersByTimeAsync(81)
      expect(interrupted).toBe(0)

      press(term, '\x0c')
      press(term, '\x1b')
      await vi.advanceTimersByTimeAsync(81)
      expect(interrupted).toBe(1)
    } finally {
      tui.dispose()
      vi.useRealTimers()
    }
  })

  it('does not type SGR mouse reports into the editor', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, '\x1b[<0;4;8M')
    press(term, 'ok\r')
    expect(await pending).toBe('ok')
    tui.dispose()
  })

  it('scrolls a few lines with shift+up', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    for (let i = 0; i < 16; i += 1) {
      tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'row-' + i }] }, i))
    }
    press(term, '\x1b[1;2A')
    expect(term.captured).toContain('later line')
    tui.dispose()
  })

  it('releases the tty on dispose', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.dispose()
    expect(term.raw).toBe(false)
    expect(term.destroyed).toBe(true)
  })
})

describe('LocalTui (plain)', () => {
  it('leaves progress pending on input lines until the operation finishes', async () => {
    const term = new FakeTerminal()
    term.input.isTTY = false
    term.output.isTTY = false
    const tui = new LocalTui(term, 'm', false)
    const done = new AbortController()
    const settled = vi.fn()
    try {
      const pending = tui.prompt({ title: 'Install plugin', question: 'demo', presentation: 'progress', signal: done.signal })
      void pending.then(settled)
      press(term, '\n')
      await flushAsyncPaste()
      expect(settled).not.toHaveBeenCalled()
      done.abort()
      await expect(pending).resolves.toBeNull()
    } finally { tui.dispose() }
  })
  it('reads lines from a non-tty stream and quits on EOF', async () => {
    const term = new FakeTerminal()
    term.input.isTTY = false
    term.output.isTTY = false
    const tui = new LocalTui(term, 'm', false)
    const first = tui.readline()
    press(term, 'hello\n')
    expect(await first).toBe('hello')
    const second = tui.readline()
    term.input.end()
    expect(await second).toBe(null)
    tui.dispose()
  })

  it('routes a human-interaction answer before the outstanding runner readline', async () => {
    const term = new FakeTerminal()
    term.input.isTTY = false
    term.output.isTTY = false
    const tui = new LocalTui(term, 'm', false)
    const runnerLine = tui.readline()
    const answer = tui.prompt({ title: 'Approval', question: 'Continue?' })
    press(term, 'yes\n')
    expect(await answer).toBe('yes')
    press(term, 'next prompt\n')
    expect(await runnerLine).toBe('next prompt')
    tui.dispose()
  })

  it('prints settled blocks only', async () => {
    const term = new FakeTerminal()
    term.input.isTTY = false
    term.output.isTTY = false
    const tui = new LocalTui(term, 'm', false)
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'q' }] }, 1))
    tui.streamDelta({ turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'partial' } })
    expect(term.captured).toContain('q')
    expect(term.captured).not.toContain('partial')
    tui.event(ev('assistant/message', {
      turn: 1,
      step: 1,
      message: { content: [{ type: 'text', text: 'final' }] },
      stream: [],
    }, 3))
    expect(term.captured).toContain('final')
    tui.dispose()
  })

  it('prints the full tool body in plain mode', () => {
    const term = new FakeTerminal()
    term.input.isTTY = false
    term.output.isTTY = false
    const tui = new LocalTui(term, 'm', false)
    const output = Array.from({ length: 14 }, (_, i) => 'plain-line-' + i).join('\n')
    tui.event(ev('tool/call', { callId: 'call-1', name: 'bash', arguments: '{}' }, 1))
    tui.event(ev('tool/result', {
      message: { role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: output }] },
    }, 2))
    expect(term.captured).toContain('plain-line-13')
    expect(term.captured).not.toContain('ctrl+o')
    tui.dispose()
  })
})


describe('document and file interaction', () => {
  it('toggles wrapping, pans with Alt arrows and retains reading position without consuming a draft', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    const position = vi.fn()
    try {
      press(term, 'draft')
      await flushAsyncPaste()
      const source = { text: 'left ' + '中文🐳'.repeat(40) + ' right', language: 'ts' }
      const answer = tui.prompt({ title: 'File', question: 'a.ts', presentation: 'document', documentSource: source,
        onDocumentPosition: position, options: [{ label: 'Files' }, { label: 'Open' }] })
      press(term, 'w')
      press(term, '\x1b[1;3C')
      press(term, '\x1b[C')
      press(term, '\r')
      expect(await answer).toBe('Open')
      expect(position).toHaveBeenLastCalledWith({ row: 0, wrap: 0, query: '', wordWrap: false, column: 8 })
      const reopened = tui.prompt({ title: 'File', question: 'a.ts', presentation: 'document', documentSource: source,
        documentPosition: position.mock.calls.at(-1)![0], onDocumentPosition: position, options: [{ label: 'Close' }] })
      press(term, '\x1b[1;3D')
      press(term, '\r')
      await reopened
      expect(position).toHaveBeenLastCalledWith({ row: 0, wrap: 0, query: '', wordWrap: false, column: 0 })
      const input = tui.readInput()
      press(term, '\r')
      expect(await input).toEqual({ text: 'draft', images: [] })
      expect(term.captured).not.toContain('\x1b[3J')
    } finally { tui.dispose() }
  })
  it.each([false, true])('searches source lines, cycles through bottom matches and restores the composer (color=%s)', async color => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', color)
    const position = vi.fn()
    try {
      press(term, 'draft 中文🐳')
      await flushAsyncPaste()
      const text = Array.from({ length: 60 }, (_, at) => at === 20 || at === 59 ? `literal [a.*] ${at}` : `line ${at}`).join('\n')
      const answer = tui.prompt({ title: 'Review', question: 'a.txt', presentation: 'document', documentSource: { text },
        onDocumentPosition: position, options: [{ label: 'Editor', value: 'editor' }], actions: [{ key: 'e', label: 'editor', valuePrefix: 'editor' }] })
      press(term, '/')
      press(term, '[a.*]')
      await flushAsyncPaste()
      press(term, '\r')
      let mark = term.captured.length
      press(term, '\x0e')
      expect(stripAnsi(term.captured.slice(mark))).toContain('2/2 matching lines')
      mark = term.captured.length
      press(term, '\x0e')
      expect(stripAnsi(term.captured.slice(mark))).toContain('1/2 matching lines')
      mark = term.captured.length
      press(term, '\x10')
      expect(stripAnsi(term.captured.slice(mark))).toContain('2/2 matching lines')
      press(term, 'E')
      await flushAsyncPaste()
      expect(await answer).toBe('editor')
      expect(position).toHaveBeenCalledWith({ row: expect.any(Number), wrap: 0, query: '[a.*]' })
      const input = tui.readInput()
      press(term, '\r')
      expect(await input).toEqual({ text: 'draft 中文🐳', images: [] })
      expect(term.captured).not.toContain('\x1b[3J')
    } finally { tui.dispose() }
  })

  it('keeps invalid line input editable, cancels search without dismissing, and retains source anchors on resize', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false), abort = new AbortController()
    const position = vi.fn(), settled = vi.fn()
    try {
      const text = Array.from({ length: 100 }, (_, at) => `row ${at + 1} ${'中文🐳 '.repeat(12)}`).join('\n')
      const answer = tui.prompt({ title: 'Review', question: 'a.txt', presentation: 'document', documentSource: { text },
        signal: abort.signal, onDocumentPosition: position, options: [{ label: 'Files' }] })
      void answer.then(settled)
      press(term, 'G')
      await flushAsyncPaste()
      press(term, '0\r')
      await flushAsyncPaste()
      expect(stripAnsi(term.captured)).toContain('Enter a line number in this file.')
      expect(settled).not.toHaveBeenCalled()
      press(term, '\x15')
      press(term, '42\r')
      await flushAsyncPaste()
      expect(stripAnsi(term.captured)).toContain('Line 42/100')
      let mark = term.captured.length
      term.resize(100, 24)
      expect(stripAnsi(term.captured.slice(mark))).toContain('Line 42/100')
      press(term, '/')
      press(term, 'row 99')
      await flushAsyncPaste()
      press(term, '\x1b[27u')
      await flushAsyncPaste()
      expect(settled).not.toHaveBeenCalled()
      mark = term.captured.length
      press(term, '\x1b[B\x1b[B\x1b[B')
      expect(stripAnsi(term.captured.slice(mark))).toContain('Line 43/100')
      abort.abort()
      expect(await answer).toBeNull()
      expect(position.mock.calls[0]?.[0]).toMatchObject({ row: 42, query: '' })
      expect(term.raw).toBe(true)
    } finally { tui.dispose() }
  })

  it('jumps through retained diff hunks and uses new-file line numbers', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    const position = vi.fn()
    try {
      const source = { diff: true, text: '@@ -1,30 +1,30 @@\n' + Array.from({ length: 30 }, (_, at) => ` context ${at}`).join('\n') + '\n@@ -80,2 +90,2 @@\n-old\n+new\n end\n' }
      const answer = tui.prompt({ title: 'Diff', question: 'a.ts', presentation: 'document', documentSource: source,
        onDocumentPosition: position, options: [{ label: 'Files' }] })
      press(term, ']')
      await flushAsyncPaste()
      let mark = term.captured.length
      press(term, ']')
      await flushAsyncPaste()
      expect(stripAnsi(term.captured.slice(mark))).toContain('Diff row 1/35')
      press(term, 'G')
      await flushAsyncPaste()
      press(term, '50\r')
      await flushAsyncPaste()
      expect(stripAnsi(term.captured)).toContain('Enter a new-file line shown in this diff.')
      press(term, '\x15')
      press(term, '90\r')
      await flushAsyncPaste()
      press(term, '\r')
      expect(await answer).toBe('Files')
      expect(position).toHaveBeenCalledWith({ row: expect.any(Number), wrap: 0, query: '' })
    } finally { tui.dispose() }
  })

  it('keeps browsing quiet while attention notifications remain enabled for questions', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      tui.applyStoredPrefs({ theme: 'dark', colors: false, motion: 'off', expandTools: false,
        notifications: 'always' })
      const before = term.captured.length
      const document = tui.prompt({ title: 'File', question: 'File', presentation: 'document', notify: false, options: [{ label: 'Files' }] })
      press(term, '\r')
      await document
      expect(term.captured.slice(before)).not.toMatch(/\x1b\]9;(?!4;)/u)
      const question = tui.prompt({ title: 'Question', question: 'Input required', options: [{ label: 'Yes' }] })
      await new Promise(resolve => setTimeout(resolve, 40))
      expect(term.captured.slice(before)).toContain('\x1b]9;')
      press(term, '\r')
      await question
    } finally { tui.dispose() }
  })
  it.each(['Files', 'Previous', 'Next', 'Open', 'Editor'])('activates the document %s button with Tab and Enter', async label => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      const labels = ['Files', 'Previous', 'Next', 'Open', 'Editor']
      const answer = tui.prompt({ title: 'File', question: 'test.txt', presentation: 'document', detail: 'Content',
        options: labels.map(label => ({ label, value: label.toLowerCase() })) })
      press(term, '\t'.repeat(labels.indexOf(label)) + '\r')
      expect(await answer).toBe(label.toLowerCase())
    } finally { tui.dispose() }
  })

  it.each(['N', 'P', 'O', 'E'])('accepts the displayed uppercase document shortcut %s', async key => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    const settled = vi.fn()
    try {
      const answer = tui.prompt({ title: 'File', question: 'test.txt', presentation: 'document', detail: 'Content',
        options: [{ label: 'Files', value: 'files' }], actions: [{ key: key.toLowerCase(), label: 'Action', valuePrefix: 'action' }] })
      void answer.then(settled)
      press(term, key)
      await flushAsyncPaste()
      expect(settled).toHaveBeenCalledWith('action')
    } finally { tui.dispose() }
  })

  it.each([false, true])('returns document actions directly and restores the composer (color=%s)', async color => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', color)
    try {
      press(term, 'draft')
      const answer = tui.prompt({ title: 'Review', question: 'File', presentation: 'document', detail: '# File\n\nContent',
        options: [{ label: 'Files', value: 'files' }, { label: 'Open', value: 'open' }], allowCustom: false })
      press(term, '\t\r')
      expect(await answer).toBe('open')
      expect(stripAnsi(term.captured)).not.toContain('Revision feedback')
      const submission = tui.readInput()
      press(term, '\r')
      expect(await submission).toEqual({ text: 'draft', images: [] })
    } finally { tui.dispose() }
  })

  it('refreshes live documents and releases the refresh timer on cancellation', async () => {
    vi.useFakeTimers()
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false), abort = new AbortController()
    let text = 'Before'
    const refresh = vi.fn(() => text)
    try {
      const answer = tui.prompt({ title: 'Terminal', question: 'Shell', presentation: 'document', detail: text, refreshDocument: refresh,
        documentTail: true, signal: abort.signal, options: [{ label: 'Input' }] })
      text = 'After'
      await vi.advanceTimersByTimeAsync(250)
      expect(stripAnsi(term.captured)).toContain('After')
      abort.abort()
      expect(await answer).toBeNull()
      const count = refresh.mock.calls.length
      await vi.advanceTimersByTimeAsync(1000)
      expect(refresh).toHaveBeenCalledTimes(count)
      expect(term.raw).toBe(true)
    } finally { tui.dispose(); vi.useRealTimers() }
  })

  it('stages a reference-only file draft and preserves it through a document prompt', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    const ref = { attachmentId: AttachmentId('file:test'), name: 'report.txt', bytes: 12 }
    try {
      tui.stageFileAttachment(ref)
      const answer = tui.prompt({ title: 'Review', question: 'File', presentation: 'document', detail: 'Content', options: [{ label: 'Back' }] })
      press(term, '\x1b')
      expect(await answer).toBeNull()
      const submission = tui.readInput()
      press(term, 'Review this\r')
      expect(await submission).toEqual({ text: 'Review this', images: [], files: [ref],
        segments: [{ kind: 'file', index: 0 }, { kind: 'text', text: 'Review this' }] })
    } finally { tui.dispose() }
  })
})

it('restores raw input after a file editor fails without erasing terminal history', () => {
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  const raw = vi.spyOn(term.input, 'setRawMode')
  vi.stubEnv('VISUAL', '/omdsh-missing-editor-command')
  try {
    const before = term.captured.length
    expect(() => tui.openFileInEditor('/unused/file.txt')).toThrow()
    expect(raw.mock.calls).toEqual([[false], [true]])
    expect(term.raw).toBe(true)
    expect(term.captured.slice(before)).not.toContain('\x1b[3J')
  } finally { tui.dispose(); vi.unstubAllEnvs() }
})

it('lets lowercase filename filtering coexist with Shift+P deliverable navigation', async () => {
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  try {
    const answer = tui.prompt({ title: 'Files · /workspace', question: '/workspace', presentation: 'card',
      filterable: true, allowCustom: false, options: [{ label: '../', value: '/above' }, { label: 'package.json', value: '/workspace/package.json' }],
      actions: [{ key: 'P', label: 'deliverables', valuePrefix: 'present:' }] })
    press(term, 'p\r')
    expect(await answer).toBe('/workspace/package.json')
    const deliverables = tui.prompt({ title: 'Files', question: '/workspace', presentation: 'card', filterable: true,
      options: [{ label: '../', value: '/above' }], actions: [{ key: 'P', label: 'deliverables', valuePrefix: 'present:' }] })
    press(term, 'P')
    expect(await deliverables).toBe('present:/above')
  } finally { tui.dispose() }
})

it('persists the selected editor and uses it for both file and prompt editing', async () => {
  const choices = vi.spyOn(editorDiscovery, 'discoverEditors').mockReturnValue([
    { id: 'auto', label: 'Auto (VS Code)' }, { id: 'code', label: 'VS Code' },
  ])
  const fileEditor = vi.spyOn(externalEditor, 'editFileExternally').mockImplementation(() => {})
  const promptEditor = vi.spyOn(externalEditor, 'editExternally').mockReturnValue('saved prompt')
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  const persist = vi.fn()
  tui.setPrefsPersist(persist)
  const pending = tui.readline()
  try {
    press(term, '/settings\r')
    press(term, '\t' + '\x1b[B'.repeat(tuiSettingItems(tui.prefs()).findIndex(item => item.id === 'editor') - tuiSettingItems(tui.prefs()).findIndex(item => item.id === 'theme')) + '\r')
    expect(persist.mock.calls[0]?.[0].editor).toBe('code')
    press(term, '\x1b')
    tui.openFileInEditor('/workspace/a.ts')
    expect(fileEditor).toHaveBeenCalledWith('/workspace/a.ts', 'code')
    press(term, '\x18')
    expect(promptEditor).toHaveBeenCalledWith('', 'code')
    expect(term.raw).toBe(true)
    press(term, '\r')
    expect(await pending).toBe('saved prompt')
    expect(term.captured).not.toContain('\x1b[3J')
    const second = new LocalTui(new FakeTerminal(), 'm', false)
    try {
      second.applyStoredPrefs(persist.mock.calls[0]?.[0])
      expect(second.prefs().editor).toBe('code')
      second.openFileInEditor('/workspace/b.ts')
      expect(fileEditor).toHaveBeenLastCalledWith('/workspace/b.ts', 'code')
    } finally { second.dispose() }
  } finally { tui.dispose(); choices.mockRestore(); fileEditor.mockRestore(); promptEditor.mockRestore() }
})

describe('composer paste and steering', () => {
  const source = Array.from({ length: 12 }, (_, i) => `line ${i} 中文 🐳`).join('\n')
  it('keeps folded original text through browsing prompts, copying, and queue editing', async () => {
    const term = new FakeTerminal(), copied: string[] = []
    const tui = new LocalTui(term, 'm', false, 'dark', value => { copied.push(value) })
    try {
      press(term, '\x1b[200~' + source + '\x1b[201~')
      await flushAsyncPaste()
      expect(stripAnsi(term.captured)).toContain('[Pasted #1: 12 lines]')
      const question = tui.prompt({ question: 'Confirm', options: [{ label: 'Yes' }] })
      press(term, '\r')
      await question
      press(term, '\x1bc')
      await flushAsyncPaste()
      expect(copied).toEqual([source])
      press(term, '\r')
      press(term, '\x1b[A\r')
      expect((await tui.readInput())?.text).toBe(source)
    } finally { tui.dispose() }
  })

  it('expands the folded block for editing and retains original text on undo', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      press(term, '\x1b[200~' + source + '\x1b[201~')
      await flushAsyncPaste()
      press(term, '\x1bi!\x1f\r')
      expect((await tui.readInput())?.text).toBe(source)
    } finally { tui.dispose() }
  })

  it('keeps pasted slash-prefixed source literal through queued draft restoration', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    const original = '/clear\n' + source
    try {
      press(term, '\x1b[200~' + original + '\x1b[201~')
      await flushAsyncPaste()
      press(term, '\r')
      const submission = await tui.readInput()
      expect(submission).toMatchObject({ text: original, literal: true })
      tui.restoreInput(submission!)
      press(term, '\r')
      expect(await tui.readInput()).toMatchObject({ text: original, literal: true })
    } finally { tui.dispose() }
  })

  it('guards legacy multiline paste and submits only after a later intentional Enter', async () => {
    vi.useFakeTimers()
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      const received = vi.fn()
      const pending = tui.readInput().then(received)
      press(term, 'first line\rsecond line\r')
      await vi.advanceTimersByTimeAsync(100)
      expect(received).not.toHaveBeenCalled()
      press(term, '\r')
      await pending
      expect(received.mock.calls[0]?.[0]?.text).toBe('first line\nsecond line\n')
    } finally { tui.dispose(); vi.useRealTimers() }
  })

  it('can disable legacy detection without disabling explicit paste safety', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      tui.applyStoredPrefs({ theme: 'dark', colors: false, pasteProtection: false })
      press(term, 'one\rtwo\r')
      expect((await tui.readInput())?.text).toBe('one')
      expect((await tui.readInput())?.text).toBe('two')
      press(term, '\x1b[200~a\nb\x1b[201~')
      await flushAsyncPaste()
      press(term, '\r')
      expect((await tui.readInput())?.text).toBe('a\nb')
    } finally { tui.dispose() }
  })

  it('persists the busy Enter setting through its own field', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    const persist = vi.fn()
    tui.setPrefsPersist(persist)
    try {
      press(term, '/settings\rSend behavior while busy\x1b[C')
      await flushAsyncPaste()
      expect(tui.prefs().busyEnter).toBe('steer')
      expect(persist).toHaveBeenCalledWith(expect.objectContaining({ busyEnter: 'steer' }), [{ op: 'set', path: ['busyEnter'], value: 'steer' }])
    } finally { tui.dispose() }
  })

  it('keeps command delivery ordinary and recalled follow-ups queued under Steer preference', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      tui.applyStoredPrefs({ theme: 'dark', colors: false, busyEnter: 'steer' })
      tui.setStatus('running')
      press(term, '!echo hello\r')
      expect(await tui.readInput()).toEqual({ text: '!echo hello', images: [] })
      press(term, 'queued task\x1b\r\x1b[A\r')
      expect(await tui.readInput()).toMatchObject({ text: 'queued task', delivery: 'queue' })
      press(term, '/literal guidance\x1bs')
      expect(await tui.readInput()).toMatchObject({ text: '/literal guidance', delivery: 'steer', literal: true })
    } finally { tui.dispose() }
  })

  it.each(['queue', 'steer'] as const)('freezes %s delivery and keeps explicit shortcuts independent', async busyEnter => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      tui.applyStoredPrefs({ theme: 'dark', colors: false, busyEnter })
      tui.setStatus('running')
      press(term, 'default message\r')
      tui.applyStoredPrefs({ theme: 'dark', colors: false, busyEnter: busyEnter === 'queue' ? 'steer' : 'queue' })
      expect(await tui.readInput()).toMatchObject({ text: 'default message', delivery: busyEnter })
      press(term, 'correct course\x1bs')
      expect(await tui.readInput()).toMatchObject({ text: 'correct course', delivery: 'steer' })
      press(term, 'next task\x1b\r')
      expect(await tui.readInput()).toMatchObject({ text: 'next task', delivery: 'queue' })
      expect(stripAnsi(term.captured)).toContain('Enter: Steer')
    } finally { tui.dispose() }
  })

  it('keeps an idle steering draft and uses ordinary Enter even with Steer preference', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      tui.applyStoredPrefs({ theme: 'dark', colors: false, busyEnter: 'steer' })
      press(term, 'keep my text\x1bs')
      expect(stripAnsi(term.captured)).toContain('active turn')
      press(term, '\r')
      expect(await tui.readInput()).toEqual({ text: 'keep my text', images: [] })
    } finally { tui.dispose() }
  })

  it.each((['queue', 'steer'] as const).flatMap(busyEnter =>
    ['\x1b[13;5u', '\x1b[13;9u', '\x1b[27;5;13~'].map(chord => ({ busyEnter, chord })),
  ))('sends the opposite mode with modified Enter ($busyEnter, $chord)', async ({ busyEnter, chord }) => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      tui.applyStoredPrefs({ theme: 'dark', colors: false, busyEnter })
      tui.setStatus('running')
      press(term, 'ordinary\r')
      expect(await tui.readInput()).toMatchObject({ text: 'ordinary', delivery: busyEnter })
      press(term, 'other mode' + chord)
      tui.applyStoredPrefs({ theme: 'dark', colors: false, busyEnter: busyEnter === 'queue' ? 'steer' : 'queue' })
      expect(await tui.readInput()).toMatchObject({ text: 'other mode', delivery: busyEnter === 'queue' ? 'steer' : 'queue' })
    } finally { tui.dispose() }
  })

  it.each(['\x1b[13;5u', '\x1b[13;9u'])('uses ordinary idle sends and preserves multiline editing (%s)', async chord => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      tui.applyStoredPrefs({ theme: 'dark', colors: false, busyEnter: 'steer' })
      press(term, chord)
      expect(tui.pendingInputs.list()).toHaveLength(0)
      press(term, 'first\x1b[13;2usecond\nthird' + chord)
      expect(await tui.readInput()).toEqual({ text: 'first\nsecond\nthird', images: [] })
    } finally { tui.dispose() }
  })

  it.each([false, true])('honors alternate-send remapping and unbinding (remapped=%s)', async remapped => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-alternate-keys-')), path = join(root, 'keybindings.json')
    writeFileSync(path, JSON.stringify({ 'ctrl+enter': null, 'command+enter': null, ...(remapped ? { f6: 'alternate-send' } : {}) }))
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { keybindingsPath: path })
    try {
      tui.setStatus('running')
      expect(stripAnsi(term.captured)).toContain(`Enter: Queue · ${remapped ? 'F6' : 'Alt+S'}: Steer`)
      press(term, 'retained\x1b[13;5u')
      press(term, remapped ? '\x1b[17~' : '\r')
      expect(await tui.readInput()).toMatchObject({ text: 'retained\n', delivery: remapped ? 'steer' : 'queue' })
    } finally { tui.dispose(); rmSync(root, { recursive: true, force: true }) }
  })

  it('retains commands, attachment order, queue edits, and prompt ownership with alternate send', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    const files = [{ attachmentId: AttachmentId('alternate-file'), name: '中文.txt', bytes: 1 }]
    try {
      tui.setCommands([{ name: 'example', description: 'Example command' }])
      tui.setStatus('running')
      press(term, '/example arg\x1b[13;5u')
      expect(await tui.readInput()).toEqual({ text: '/example arg', images: [] })
      press(term, '!echo hello\x1b[13;9u')
      expect(await tui.readInput()).toEqual({ text: '!echo hello', images: [] })
      const segments = [{ kind: 'file' as const, index: 0 }, { kind: 'text' as const, text: 'describe' }, { kind: 'image' as const, index: 0 }]
      tui.restoreInput({ text: 'describe', images: [{ data: PNG_1X1, mediaType: 'image/png' }], files, segments })
      press(term, '\x1b[13;5u')
      expect(await tui.readInput()).toMatchObject({ text: 'describe', delivery: 'steer', files, segments, images: [{ data: PNG_1X1 }] })
      tui.applyStoredPrefs({ theme: 'dark', colors: false, busyEnter: 'steer' })
      press(term, 'queued\x1b\r\x1b[A edited\x1b[13;5u')
      expect(await tui.readInput()).toMatchObject({ text: 'queued edited', delivery: 'queue' })
      const pending = tui.readInput(), received = vi.fn()
      void pending.then(received)
      const answer = tui.prompt({ question: 'Choose', options: [{ label: 'Yes' }] })
      press(term, '\x1b[13;5u\x1b[13;9u')
      await flushAsyncPaste()
      expect(received).not.toHaveBeenCalled()
      press(term, '\r')
      expect(await answer).toBe('Yes')
      press(term, 'after prompt\r')
      expect(await pending).toMatchObject({ text: 'after prompt', delivery: 'steer' })
    } finally { tui.dispose() }
  })

  it('prefers established busy keys until modified Enter can be distinguished', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    term.columns = 120
    try {
      tui.setStatus('running')
      expect(stripAnsi(term.captured)).toContain('Enter: Queue · Alt+S: Steer')
      expect(stripAnsi(term.captured)).not.toContain('Ctrl+Enter: Steer')
      press(term, '\x1b[?0u\x1b[?1;2c')
      tui.setStatus('idle'); tui.setStatus('running')
      expect(stripAnsi(term.captured)).toContain('Enter: Queue · Ctrl+Enter: Steer')
      expect(stripAnsi(term.captured)).not.toContain('Cmd+Enter: Steer')
      press(term, '\x1b[13;9u')
      if (process.platform === 'darwin') expect(stripAnsi(term.captured)).toContain('Cmd+Enter / Ctrl+Enter: Steer')
      press(term, 'forwarded\x1b[13;9u')
      expect(await tui.readInput()).toMatchObject({ text: 'forwarded', delivery: 'steer' })
    } finally { tui.dispose() }
  })

  it('accepts forwarded Command editing and restores a cleared draft with Command undo', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      const original = '保留 🐳e\u0301\n删除 中文'
      const files = [{ attachmentId: AttachmentId('command-edit'), name: 'a.txt', bytes: 1 }]
      tui.restoreInput({ text: original, images: [], files })
      press(term, '\x1b[1;9D\x1b[1;9C\x1b[127;9u\x1b[122;9u\x03\x1b[122;9u\r')
      expect(await tui.readInput()).toMatchObject({ text: original, files })
    } finally { tui.dispose() }
  })

  it('runs user overrides ahead of forwarded Command editing and decodes legacy clipboard alternatives', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-command-overrides-')), path = join(root, 'keys.json')
    writeFileSync(path, JSON.stringify({ 'cmd+left': 'paste-clipboard', 'control+option+v': 'paste-clipboard' }))
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      keybindingsPath: path, readClipboard: async () => 'clipboard text', readClipboardImage: async () => null, readClipboardFiles: async () => [],
    })
    try {
      press(term, '\x1b[1;9D')
      await flushAsyncPaste()
      press(term, '\x1b\x16')
      await flushAsyncPaste()
      press(term, '\r')
      expect(await tui.readInput()).toMatchObject({ text: 'clipboard textclipboard text' })
    } finally { tui.dispose(); rmSync(root, { recursive: true, force: true }) }
  })

  it('keeps selectors isolated and sends attachments through the normal submission reader', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      tui.setStatus('running')
      const modal = tui.prompt({ question: 'Choose', options: [{ label: 'Yes' }] })
      press(term, '\x1bs\r')
      await modal
      expect(tui.pendingInputs.list()).toHaveLength(0)
      const files = [{ attachmentId: AttachmentId('file-steer'), name: 'a.txt', bytes: 1 }]
      tui.restoreInput({ text: 'attached', images: [], files })
      press(term, '\x1bs\x1bs')
      expect(await tui.readInput()).toMatchObject({ text: 'attached', delivery: 'steer', files })
      expect(tui.pendingInputs.list()).toHaveLength(0)
    } finally { tui.dispose() }
  })

})

describe('focus-aware notifications', () => {
  it('suppresses focused notifications, coalesces attention first, and restores focus reporting on exit', async () => {
    vi.useFakeTimers()
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      tui.applyStoredPrefs({ theme: 'dark', colors: false, notifications: 'unfocused' })
      expect(term.captured).toContain('\x1b[?1004h')
      press(term, '\x1b[I')
      tui.event(ev('turn/start', { turn: 1 }, 100))
      tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 200))
      await vi.advanceTimersByTimeAsync(30)
      expect(term.captured).not.toMatch(/\x1b\]9;(?!4;)/u)
      press(term, '\x1b[O')
      const question = tui.prompt({ question: 'Approval required', options: [{ label: 'Yes' }] })
      tui.event(ev('turn/start', { turn: 2 }, 300))
      tui.event(ev('turn/end', { turn: 2, reason: { kind: 'completed' } }, 400))
      await vi.advanceTimersByTimeAsync(30)
      expect(term.captured.match(/\x1b\]9;(?!4;)/gu)).toHaveLength(1)
      expect(term.captured).toContain('omdsh needs attention: Input required')
      press(term, '\r')
      await question
    } finally { tui.dispose(); vi.useRealTimers() }
    expect(term.captured).toContain('\x1b[?1004l')
  })

  it('drops pending notifications when focus returns or the provider is disposed', async () => {
    vi.useFakeTimers()
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      tui.applyStoredPrefs({ theme: 'dark', colors: false, notifications: 'unfocused' })
      press(term, '\x1b[O')
      tui.event(ev('turn/start', { turn: 1 }, 1))
      tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 2))
      press(term, '\x1b[I')
      await vi.advanceTimersByTimeAsync(30)
      expect(term.captured).not.toMatch(/\x1b\]9;(?!4;)/u)
      press(term, '\x1b[O')
      tui.event(ev('turn/start', { turn: 2 }, 3))
      tui.event(ev('turn/end', { turn: 2, reason: { kind: 'completed' } }, 4))
      tui.dispose()
      const output = term.captured
      await vi.advanceTimersByTimeAsync(100)
      expect(term.captured).toBe(output)
    } finally { tui.dispose(); vi.useRealTimers() }
  })

  it('reports while focused in always mode, and marks one-shot endings unfocused-only', async () => {
    vi.useFakeTimers()
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      // Attention requests ignore focus in either mode: the turn cannot continue
      // without the reader, so staying silent while they watch is wrong.
      tui.applyStoredPrefs({ theme: 'dark', colors: false, notifications: 'always' })
      expect(term.captured).toContain('\x1b[?1004h')
      const question = tui.prompt({ question: 'Input', options: [{ label: 'Yes' }] })
      await vi.advanceTimersByTimeAsync(30)
      expect(term.captured.match(/\x1b\]9;(?!4;)/gu)).toHaveLength(1)
      press(term, '\r')
      await question

      // A finished turn is news only if the reader looked away, so `always`
      // reports it while focused and `unfocused` does not.
      press(term, '\x1b[I')
      tui.applyStoredPrefs({ theme: 'dark', colors: false, notifications: 'unfocused' })
      tui.event(ev('turn/start', { turn: 1 }, 1))
      tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 2))
      await vi.advanceTimersByTimeAsync(30)
      expect(term.captured.match(/\x1b\]9;(?!4;)/gu)).toHaveLength(1)

      tui.applyStoredPrefs({ theme: 'dark', colors: false, notifications: 'always' })
      tui.event(ev('turn/start', { turn: 2 }, 3))
      tui.event(ev('turn/end', { turn: 2, reason: { kind: 'completed' } }, 4))
      await vi.advanceTimersByTimeAsync(30)
      expect(term.captured.match(/\x1b\]9;(?!4;)/gu)).toHaveLength(2)
    } finally { tui.dispose(); vi.useRealTimers() }
  })
})

it('releases focus reports for a suspended terminal and restores them on resume without leaking listeners', () => {
  if (process.platform === 'win32') return
  const before = process.listenerCount('SIGCONT')
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
  try {
    press(term, '\x1a')
    expect(term.captured).toContain('\x1b[?1004l')
    process.emit('SIGCONT')
    expect(term.captured.match(/\x1b\[\?1004h/gu)).toHaveLength(2)
  } finally { kill.mockRestore(); tui.dispose() }
  expect(process.listenerCount('SIGCONT')).toBe(before)
})

it('uses original pasted source in the external editor and retains slash-literal intent after expansion', async () => {
  const original = '/clear\n' + 'source line\n'.repeat(12)
  const edit = vi.spyOn(externalEditor, 'editExternally').mockImplementation(text => text)
  try {
    for (const shortcut of ['\x1bi', '\x18']) {
      const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
      try {
        press(term, '\x1b[200~' + original + '\x1b[201~')
        await flushAsyncPaste()
        press(term, shortcut + '\r')
        expect(await tui.readInput()).toMatchObject({ text: original, literal: true })
      } finally { tui.dispose() }
    }
    expect(edit).toHaveBeenCalledWith(original, 'auto')
  } finally { edit.mockRestore() }
})

it('preserves tabs and normalizes CRLF once when bracketed paste spans reads', async () => {
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  try {
    press(term, '\x1b[200~\tfirst\r')
    press(term, '\n\tsecond\r\n\x1b[201~')
    await flushAsyncPaste()
    press(term, '\r')
    expect((await tui.readInput())?.text).toBe('\tfirst\n\tsecond\n')
  } finally { tui.dispose() }
})


describe('list-wide prompt actions', () => {
  it.each(['card', 'tree'] as const)('keeps list actions working with no match in %s', async presentation => {
    const term = new ScrollingTerminal(80, 24)
    const tui = new LocalTui(term, 'm', false)
    try {
      tui.restoreInput({ text: 'Preserve the draft 🐳', images: [] })
      const request = { title: 'Library', question: '', presentation, filterable: true, allowCustom: false,
        actions: [{ key: 'Alt+A', label: 'archive', valuePrefix: 'archive:' },
          { key: 'Alt+V', label: 'switch view', valuePrefix: 'view:', scope: 'list' as const }], options: [] }
      const pending = tui.prompt(request)
      const history = term.scrollback()
      press(term as never, 'no match\x1ba')
      expect(term.visible().join('\n')).toContain('Library')
      press(term as never, '\x1bv')
      expect(await pending).toBe('view:')
      expect(term.visible().join('\n')).toContain('Preserve the draft 🐳')
      expect(term.scrollback()).toEqual(history)
      const populated = tui.prompt({ ...request, options: [{ label: '中文会话 🐳', value: 'session-a' }] })
      press(term as never, '中文\x1ba')
      expect(await populated).toBe('archive:session-a')
      expect(term.visible().join('\n')).toContain('Preserve the draft 🐳')
    } finally { tui.dispose() }
  })
})

it.each(['kitty', 'none'] as const)('previews a draft then restores text, image bytes and raw-mode ownership (%s)', async protocol => {
  const data = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#1569a5' } }).png().toBuffer()
  const term = new FakeTerminal()
  const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { imageProtocol: protocol, terminalProfile: 'direct',
    readClipboardImage: async () => ({ data, mediaType: 'image/png', name: '预览🐳.png' }) })
  try {
    const pending = tui.readInput()
    press(term, 'draft ')
    press(term, '\x16')
    await flushAsyncPaste()
    term.captured = ''
    press(term, '\x1bm')
    await vi.waitFor(() => expect(term.captured).toContain(protocol === 'kitty' ? 'a=T' : 'Inline images are unavailable'))
    if (protocol === 'kitty') {
      expect(term.captured).toContain('\x1b[16t')
      term.captured = ''
      press(term, '\x1b[6;12;12t')
      expect(term.captured).toContain('a=T')
      term.captured = ''
    }
    press(term, '\x1b')
    await vi.waitFor(() => expect(term.captured).toContain(protocol === 'kitty' ? '\x1b[?1049l' : 'draft'))
    if (protocol === 'kitty') expect(term.captured).toContain('a=d,d=I')
    expect(term.raw).toBe(true)
    press(term, '\r')
    expect(await pending).toMatchObject({ text: 'draft ', images: [{ data, mediaType: 'image/png' }] })
  } finally { tui.dispose() }
  expect(term.raw).toBe(false)
  expect(term.captured).not.toContain('\x1b[3J')
})


describe('live source readers', () => {
  it('freezes paused terminal output, resumes following and stops refreshes after abort', async () => {
    vi.useFakeTimers()
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false), abort = new AbortController()
    let lines = Array.from({ length: 100 }, (_, at) => `row ${at + 1}`)
    // The tail view a live reader shows: the newest rows, re-read on every tick.
    const read = (): { text: string; totalLines: number; lineBegin: number; lineEnd: number; truncated: boolean } => {
      const count = 300
      const end = lines.length, start = Math.max(0, end - count)
      return { text: lines.slice(start, end).join('\n'), totalLines: lines.length, lineBegin: start, lineEnd: end, truncated: false }
    }
    const refresh = vi.fn((_following: boolean) => read())
    try {
      const answer = tui.prompt({ title: 'Terminal', question: 'Shell', presentation: 'document', notify: false,
        documentSource: read(), refreshDocumentSource: refresh, documentTail: true, signal: abort.signal, options: [{ label: 'Close' }] })
      press(term, '\x1b[H')
      term.captured = ''
      lines = [...lines, 'LATEST AFTER PAUSE']
      await vi.advanceTimersByTimeAsync(500)
      expect(refresh).toHaveBeenLastCalledWith(false)
      expect(term.captured).not.toContain('LATEST AFTER PAUSE')
      press(term, '\x1b[F')
      await vi.advanceTimersByTimeAsync(250)
      expect(refresh).toHaveBeenLastCalledWith(true)
      expect(term.captured).toContain('LATEST AFTER PAUSE')
      abort.abort()
      expect(await answer).toBeNull()
      const reads = refresh.mock.calls.length
      await vi.advanceTimersByTimeAsync(1000)
      expect(refresh).toHaveBeenCalledTimes(reads)
    } finally { tui.dispose(); vi.useRealTimers() }
  })

  it('preserves source anchors when older output is prepended', async () => {
    vi.useFakeTimers()
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    let source = { text: Array.from({ length: 60 }, (_, at) => `row ${at + 301}`).join('\n'), firstLine: 301 }
    const refresh = vi.fn(() => source)
    const position = vi.fn()
    try {
      const answer = tui.prompt({ title: 'Terminal', question: 'Shell', presentation: 'document', documentSource: source,
        refreshDocumentSource: refresh, onDocumentPosition: position, options: [{ label: 'Close' }] })
      press(term, '\x1b[H')
      source = { text: Array.from({ length: 360 }, (_, at) => `row ${at + 1}`).join('\n'), firstLine: 1 }
      term.captured = ''
      await vi.advanceTimersByTimeAsync(250)
      press(term, '\x03')
      expect(await answer).toBeNull()
      expect(position).toHaveBeenCalledWith(expect.objectContaining({ row: 300 }))
    } finally { tui.dispose(); vi.useRealTimers() }
  })

  it('searches pasted text in a reader without changing the composer draft', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    try {
      tui.restoreInput({ text: 'draft', images: [] })
      const answer = tui.prompt({ title: 'File', question: 'source', presentation: 'document', documentSource: { text: 'first\nneedle 中文🐳\nlast' }, options: [{ label: 'Close' }] })
      press(term, '/')
      press(term, '\x1b[200~needle\x1b[201~')
      await flushAsyncPaste()
      press(term, '\r')
      expect(stripAnsi(term.captured)).toContain('1/1 matching lines')
      press(term, '\x03')
      expect(await answer).toBeNull()
      const submitted = tui.readInput()
      press(term, '\r')
      expect(await submitted).toMatchObject({ text: 'draft' })
    } finally { tui.dispose() }
  })

  it('yields a quiet document to a human question while retaining draft ownership', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
    const superseded = vi.fn()
    try {
      tui.restoreInput({ text: 'draft', images: [] })
      const reader = tui.prompt({ title: 'Terminal', question: 'Shell', presentation: 'document', notify: false,
        onSuperseded: superseded, documentSource: { text: 'output' }, options: [{ label: 'Close' }] })
      const question = tui.prompt({ title: 'Question', question: 'Continue?', options: [{ label: 'Yes' }] })
      expect(await reader).toBeNull()
      expect(superseded).toHaveBeenCalledOnce()
      press(term, '\r')
      expect(await question).toBe('Yes')
      const submitted = tui.readInput()
      press(term, '\r')
      expect(await submitted).toMatchObject({ text: 'draft' })
    } finally { tui.dispose() }
  })
})


it('reports parent completion while a running child is inspected, without applying it to the child view', () => {
  const term = new FakeTerminal(), recorder = createHerdrRecorder()
  const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { herdrReporter: recorder.reporter })
  try {
    tui.setStatus('running')
    tui.setInspectedSubagent({ id: 'child-1', label: 'Explore', phase: 'running', writable: false })
    tui.setStatus('running')
    tui.setStatus('idle', { root: true })
    expect(recorder.requests.at(-1)?.params.state).toBe('idle')
  } finally { tui.dispose() }
})


it('persists Mermaid source mode and refreshes the live reply after leaving Settings', async () => {
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  term.resize(80, 40)
  const persist = vi.fn()
  tui.setPrefsPersist(persist)
  const pending = tui.readline()
  try {
    tui.event(ev('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [
      { type: 'text', text: '```mermaid\ngraph TD\nA[First] --> B[Second]\n```' },
    ] } }, 1))
    expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).toContain('First')
    expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).not.toContain('-->')
    press(term, '/settings\r')
    const row = tuiSettingItems(tui.prefs()).findIndex(item => item.id === 'mermaidMode')
    press(term, '\t' + '\x1b[B'.repeat(row - tuiSettingItems(tui.prefs()).findIndex(item => item.id === 'theme')) + '\r')
    expect(persist.mock.calls[0]?.[0].mermaidMode).toBe('source')
    press(term, '\x1b')
    await vi.waitFor(() => expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).toContain('A[First] --> B[Second]'))
    const restored = new LocalTui(new FakeTerminal(), 'm', false)
    try {
      restored.applyStoredPrefs(persist.mock.calls[0]![0])
      expect(restored.prefs().mermaidMode).toBe('source')
    } finally { restored.dispose() }
    press(term, 'ok\r')
    expect(await pending).toBe('ok')
  } finally { tui.dispose() }
})

it.each([false, true])('retains checked models across filtering and saves an explicit empty selection (color=%s)', async color => {
  const term = new FakeTerminal()
  const tui = new LocalTui(term, 'm', color)
  try {
    const request = { title: 'Models', question: '', presentation: 'card' as const, filterable: true, multiSelect: true, allowEmptySelection: true, initialValues: ['a'], allowCustom: false,
      options: [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }] }
    const pending = tui.prompt(request)
    press(term, 'Beta')
    press(term, ' ')
    press(term, '\r')
    await expect(pending).resolves.toBe('a, b')
    const empty = tui.prompt(request)
    press(term, ' ')
    press(term, '\r')
    await expect(empty).resolves.toBe('')
    const input = tui.readline()
    press(term, 'normal input\r')
    await expect(input).resolves.toBe('normal input')
  } finally { tui.dispose() }
})

it('detects program-status support, reports root outcomes, preserves editor input and clears on exit', async () => {
  vi.useFakeTimers()
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  try {
    tui.applyStoredPrefs({ theme: 'dark', colors: false, notifications: 'always' })
    tui.setSession({ id: 'root', title: 'Fix parser', recent: [] })
    expect(term.captured).toContain('\x1b]7501;?\x1b\\')
    expect(term.captured).not.toContain('state=idle:app=omdsh')
    press(term, '\x1b]7501;?')
    press(term, '\x1b\\')
    tui.setStatus('running', { root: true })
    expect(term.captured).toContain('state=working:app=omdsh')
    const question = tui.prompt({ title: 'Approval required', question: 'private body', options: [{ label: 'Allow' }] })
    await vi.advanceTimersByTimeAsync(30)
    expect(term.captured).toContain('state=blocked:app=omdsh')
    tui.event(ev('turn/start', { turn: 1 }, 1))
    tui.setStatus('idle', { root: true, outcome: 'error' })
    press(term, '\x1b')
    await vi.advanceTimersByTimeAsync(100)
    await expect(question).resolves.toBeNull()
    tui.event(ev('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'test', message: 'private error' } } }, 2))
    await vi.advanceTimersByTimeAsync(30)
    expect(term.captured).toContain('state=error:app=omdsh')
    const input = tui.readline()
    press(term, 'normal input\r')
    await expect(input).resolves.toBe('normal input')
    tui.setSession({ id: 'new-root', recent: [] })
    expect(term.captured).toContain('state=idle:app=omdsh')
    tui.applyStoredPrefs({ theme: 'dark', colors: false, terminalTitle: 'off', terminalState: 'off' })
    expect(term.captured).toContain('state=clear:app=omdsh')
  } finally { await tui.dispose(); vi.useRealTimers() }
})

it.each([[false, true], [true, false]])('emits no terminal protocol when stdin TTY=%s and stdout TTY=%s', async (inputTTY, outputTTY) => {
  const term = new FakeTerminal()
  term.input.isTTY = inputTTY; term.output.isTTY = outputTTY
  const tui = new LocalTui(term, 'm', false)
  tui.applyStoredPrefs({ theme: 'dark', colors: false, terminalTitle: 'status', terminalState: 'on' })
  tui.setSession({ id: 'pipe-root', title: 'Pipe test', recent: [] })
  tui.setStatus('running', { root: true })
  tui.notice('Plain output')
  await tui.dispose()
  expect(term.captured).toContain('Plain output')
  expect(term.captured).not.toContain('\x1b')
  expect(term.raw).toBe(false)
})

it('keeps unsupported terminals quiet and supports explicit state enablement and cleanup', async () => {
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { deferInitialRender: true })
  tui.applyStoredPrefs({ theme: 'dark', colors: false, terminalTitle: 'off', terminalState: 'off' })
  expect(term.captured).not.toContain('\x1b]2;')
  expect(term.captured).not.toContain('\x1b]7501;')
  tui.applyStoredPrefs({ theme: 'dark', colors: false, terminalTitle: 'status', terminalState: 'auto' })
  tui.setStatus('running', { root: true })
  expect(term.captured).toContain('Working')
  expect(term.captured).not.toContain('state=working:app=omdsh')
  tui.applyStoredPrefs({ theme: 'dark', colors: false, terminalTitle: 'status', terminalState: 'on' })
  expect(term.captured).toContain('state=working:app=omdsh')
  expect(term.captured).toContain('\x1b]2;\x07')
  tui.setInspectedSubagent({ id: 'child', label: 'Child', phase: 'running', writable: false })
  tui.setStatus('idle')
  expect(term.captured).not.toContain('state=idle:app=omdsh')
  tui.setStatus('idle', { root: true, outcome: 'completed' })
  expect(term.captured).toContain('state=done:app=omdsh')
  const completedAt = term.captured.lastIndexOf('state=done:app=omdsh')
  tui.setStatus('running')
  expect(term.captured.slice(completedAt)).not.toContain('state=working:app=omdsh')
  await tui.dispose()
  expect(term.captured).toContain('\x1b]2;\x07')
  expect(term.captured).toContain('state=clear:app=omdsh')
})

it.each(['status', 'workspace'] as const)('keeps the %s title on the root directory while child completion follows the inspected directory', async terminalTitle => {
  const directory = mkdtempSync(join(tmpdir(), 'omdsh-inspected-title-'))
  const root = join(directory, 'root-workspace')
  const child = join(directory, 'child-workspace')
  const moved = join(directory, 'moved-root')
  for (const path of [root, child, moved]) mkdirSync(path)
  const term = new FakeTerminal()
  const listed: string[] = []
  const tui = new LocalTui(term, 'm', false, 'dark', async () => {}, { cwd: root, listDir: dir => { listed.push(dir); return [] } })
  const title = () => term.captured.match(/\x1b\]2;[^\x07]*\x07/g)?.at(-1)
  try {
    tui.applyStoredPrefs({ terminalTitle })
    tui.setSession({ id: 'root', recent: [] })
    tui.setWorkingDirectory(root, { root: true })
    tui.setStatus('running', { root: true })
    const rootTitle = title()
    tui.setWorkingDirectory(child, { root: false })
    expect(title()).toBe(rootTitle)
    tui.setInspectedSubagent({ id: 'child', label: 'Child', phase: 'waiting', writable: true })
    tui.setStatus('idle')
    expect(title()).toBe(rootTitle)
    tui.setWorkingDirectory(moved, { root: true })
    expect(title()).toContain('Working · moved-root · omdsh')
    const input = tui.readline()
    press(term, '@./')
    expect(listed.at(-1)).toBe(child)
    expect(title()).not.toContain('child-workspace')
    press(term, '\x03')
    tui.setInspectedSubagent(undefined)
    press(term, '@./')
    expect(listed.at(-1)).toBe(moved)
    press(term, '\x03\x03')
    await input
  } finally { await tui.dispose(); rmSync(directory, { recursive: true, force: true }) }
})

it('restores a Ctrl+C cleared draft with Ctrl+- and stashes/restores drafts with Ctrl+S across a submission', async () => {
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  try {
    const first = tui.readline()
    press(term, 'long draft in progress')
    press(term, '\x03') // Ctrl+C clears composer
    press(term, '\x1f') // Ctrl+- restores cleared draft
    press(term, '\x13') // Ctrl+S stashes the draft
    expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).toContain('Stashed composer draft')
    press(term, 'quick side question\r')
    await expect(first).resolves.toBe('quick side question')
    // Stashed draft is automatically restored into the composer after submitting the intervening prompt
    const second = tui.readline()
    press(term, '\r')
    await expect(second).resolves.toBe('long draft in progress')
  } finally { await tui.dispose() }
})

it('recalls the latest queued submission into the composer on Alt+Up and guards armed prompts against accidental Enter', async () => {
  vi.useFakeTimers()
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  try {
    // Submit while no readInput() is waiting so it enters the local queue, then recall with Alt+Up
    press(term, 'queued follow-up\r')
    press(term, 'unsent draft')
    press(term, '\x1b[1;3A') // Alt+Up recalls the queued submission even when composer has a draft
    const first = tui.readline()
    press(term, ' edited\r')
    await expect(first).resolves.toBe('queued follow-up edited')
    const second = tui.readline()
    await expect(second).resolves.toBe('unsent draft')

    let settled = false
    const approval = tui.prompt({
      title: 'Approval required',
      question: 'Run command?',
      options: [{ label: 'Allow once', value: 'approved' }, { label: 'Reject', value: 'rejected' }],
      allowCustom: false,
      armMs: 500,
    }).then(val => { settled = true; return val })
    // Pressing Enter during the 500ms arming window is ignored
    press(term, '\r')
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    press(term, '\r')
    await expect(approval).resolves.toBe('approved')
  } finally {
    vi.useRealTimers()
    await tui.dispose()
  }
})

it.each([
  ['Model and reasoning', '/model'],
  ['Sign in / add API key', '/login'],
  ['Sign out / remove key', '/logout'],
])('keeps the grouped Models action %s connected to %s', async (label, command) => {
  const term = new ScrollingTerminal(110, 24), tui = new LocalTui(term, 'm', false)
  tui.setCommands(['model', 'login', 'logout'].map(name => ({ name, description: name })))
  const pending = tui.readline()
  try {
    press(term, '/settings\r\t')
    const screen = term.visible().join('\n')
    expect(screen).toContain('Model selection')
    expect(screen).toContain('Accounts and API keys')
    expect(screen.indexOf('Model and reasoning')).toBeLessThan(screen.indexOf('Sign in / add API key'))
    expect(screen.indexOf('Sign in / add API key')).toBeLessThan(screen.indexOf('Sign out / remove key'))
    press(term, label + '\r')
    await expect(pending).resolves.toBe(command)
  } finally { await tui.dispose(); await pending }
})

it('returns to /settings with refreshed action values after opening a sub-command dialog', async () => {
  const term = new FakeTerminal(), tui = new LocalTui(term, 'old-model', false)
  try {
    tui.setCommands([{ name: 'model', description: 'Select model' }])
    const pending = tui.readline()
    press(term, '/settings\r')
    press(term, 'Model and reasoning') // Find the current-model action across sections
    expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).toContain('Model and reasoning')
    expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).toContain('old-model')
    // Press Enter on the first row (Model and reasoning) to dispatch /model
    press(term, '\r')
    await expect(pending).resolves.toBe('/model')
    // Simulate /model opening a prompt, updating the model, and settling
    const modelPrompt = tui.prompt({
      title: 'Model',
      question: 'Select model',
      options: [{ label: 'new-model', value: 'new-model' }],
      allowCustom: false,
      notify: false,
    })
    tui.setModel('new-model', 'high')
    press(term, '\r')
    await expect(modelPrompt).resolves.toBe('new-model')
    const screen = emulatedScreenRows(term.captured).map(stripAnsi).join('\n')
    expect(screen).toContain('Settings')
    expect(screen).toContain('new-model · high')
  } finally {
    await tui.dispose()
  }
})

describe('keyboard protocol ownership', () => {
  const count = (text: string, sequence: string): number => text.split(sequence).length - 1

  it('pushes the Kitty protocol once after a flags report and pops it once on exit', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    // The query only asks; nothing is pushed before the terminal answers.
    expect(term.captured).toContain('\x1b[?u')
    expect(term.captured).toContain('\x1b[?2031$p\x1b[c')
    expect(term.captured).not.toMatch(/\x1b\[>\d*u/u)
    press(term, '\x1b[?0u\x1b[?62;22c')
    // A late or repeated report never pushes a second entry.
    press(term, '\x1b[?1u')
    expect(count(term.captured, '\x1b[>1u')).toBe(1)
    await tui.dispose()
    expect(count(term.captured, '\x1b[<u')).toBe(1)
  })

  it('leaves a terminal without the protocol on its legacy encoding', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    press(term, '\x1b[?62;22c')
    await tui.dispose()
    expect(term.captured).not.toMatch(/\x1b\[>\d*u|\x1b\[<u|\x1b\[>4;\dm/u)
  })
})

describe('startup probe gating', () => {
  it('holds the first frame until the probe answers, then paints', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { deferInitialRender: true })
    try {
      tui.replaceSession([ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'initial session' }] }, 1)], undefined, 'idle', 'initial')
      expect(term.captured).not.toContain('initial session')
      press(term, '\x1b[?62;22c')
      expect(term.captured).toContain('initial session')
    } finally { await tui.dispose() }
  })

  it('paints after the probe timeout when the terminal never answers', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { deferInitialRender: true })
    try {
      tui.replaceSession([ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'initial session' }] }, 1)], undefined, 'idle', 'initial')
      expect(term.captured).not.toContain('initial session')
      await vi.waitFor(() => { expect(term.captured).toContain('initial session') }, { timeout: 2_000 })
    } finally { await tui.dispose() }
  })
})

describe('choice list pointer interaction', () => {
  function clickText(term: ScrollingTerminal, text: string) {
    const row = term.visible().findIndex(line => line.includes(text))
    expect(row).toBeGreaterThanOrEqual(0)
    const column = term.visible()[row]!.indexOf(text) + 1
    press(term, `\x1b[<0;${column};${row + 1}M\x1b[<0;${column};${row + 1}m`)
  }

  it.each([[40, false], [80, false], [40, true], [80, true]] as const)('selects rows and activates buttons at %s columns (colors=%s)', async (width, colors) => {
    const term = new ScrollingTerminal(width, 30), tui = new LocalTui(term, 'm', colors)
    try {
      press(term, 'my draft')
      const before = term.visible(), history = term.scrollback()
      const pending = tui.prompt({ title: 'Models', question: 'Choose a model', filterable: true, allowCustom: false,
        options: [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }],
        actions: [{ key: 'alt+f', label: 'Favorite/unfavorite', valuePrefix: 'favorite:' }] })
      clickText(term, 'Beta')
      expect(term.visible().join('\n')).toContain('Models')
      clickText(term, 'alt+f')
      expect(await pending).toBe('favorite:b')
      expect(term.visible()).toEqual(before)
      expect(term.scrollback()).toEqual(history)
    } finally { tui.dispose() }
  })

  it.each([false, true])('keeps preview padding and click targets aligned after reflow (colors=%s)', async colors => {
    const term = new ScrollingTerminal(80, 40), tui = new LocalTui(term, 'm', colors)
    try {
      const pending = tui.prompt({ title: 'Tools', question: 'A long question that wraps on a narrow terminal.',
        detail: 'First detail line\nSecond detail line', filterable: true, allowCustom: false,
        options: [{ label: 'Alpha', value: 'a', preview: 'x'.repeat(180) }, { label: 'Beta', value: 'b', preview: 'y'.repeat(180) }] })
      term.resize(40)
      const rows = term.visible().filter(line => line.includes('xxx'))
      expect(rows).toHaveLength(3)
      expect(rows.every(line => line.startsWith('│   '))).toBe(true)
      clickText(term, 'Beta')
      expect(term.visible().filter(line => line.includes('yyy'))).toHaveLength(3)
      clickText(term, 'Enter select')
      expect(await pending).toBe('b')
    } finally { tui.dispose() }
  })

  it('cancels a button gesture after dragging over another action', async () => {
    const term = new ScrollingTerminal(80, 28), tui = new LocalTui(term, 'm', false)
    try {
      const pending = tui.prompt({ title: 'Actions', question: '', allowCustom: false,
        options: [{ label: 'Alpha', value: 'a' }],
        actions: [{ key: 'alt+f', label: 'Favorite', valuePrefix: 'favorite:' }] })
      const row = term.visible().findIndex(line => line.includes('[ Enter select ]'))
      const primary = term.visible()[row]!.indexOf('Enter select') + 1
      const secondary = term.visible()[row]!.indexOf('alt+f') + 1
      press(term, `\x1b[<0;${primary};${row + 1}M\x1b[<32;${secondary};${row + 1}M\x1b[<32;${primary};${row + 1}M\x1b[<0;${primary};${row + 1}m`)
      expect(term.visible().join('\n')).toContain('[ Enter select ]')
      clickText(term, 'alt+f')
      expect(await pending).toBe('favorite:a')
    } finally { tui.dispose() }
  })

  it('keeps letters available for filtering and clamps wheel navigation', async () => {
    const term = new ScrollingTerminal(80, 28), tui = new LocalTui(term, 'm', false)
    try {
      const pending = tui.prompt({ title: 'Library', question: '', filterable: true, allowCustom: false,
        options: [{ label: 'react project', value: 'react' }, { label: 'python project', value: 'python' }],
        actions: [{ key: 'alt+r', label: 'rename', valuePrefix: 'rename:' }, { key: 'alt+p', label: 'pin', valuePrefix: 'pin:' }] })
      press(term, 'r')
      expect(term.visible().join('\n')).toContain('react project')
      press(term, '\x1b')
      press(term, '\x1b[<65;10;8M\x1b[<65;10;8M')
      clickText(term, 'Enter select')
      expect(await pending).toBe('python')
    } finally { tui.dispose() }
  })

  it('keeps drag selection copyable and never submits a disabled or armed choice', async () => {
    const term = new ScrollingTerminal(80, 28), copy = vi.fn(async (_text: string) => {})
    const tui = new LocalTui(term, 'm', false, 'dark', copy)
    try {
      const pending = tui.prompt({ title: 'Approval', question: 'Continue?', allowCustom: false, armMs: 60_000,
        options: [{ label: 'Disabled', value: 'disabled', disabled: true }, { label: 'Confirm', value: 'confirm' }] })
      clickText(term, 'Confirm')
      clickText(term, 'Enter select')
      expect(term.visible().join('\n')).toContain('Approval')
      const row = term.visible().findIndex(line => line.includes('Confirm'))
      const column = term.visible()[row]!.indexOf('Confirm') + 1
      press(term, `\x1b[<0;${column};${row + 1}M\x1b[<32;${column + 6};${row + 1}M\x1b[<0;${column + 6};${row + 1}m`)
      press(term, `\x1b[<2;${column};${row + 1}M`)
      await flushAsyncPaste()
      expect(copy).toHaveBeenCalledWith('Confirm')
      press(term, '\x03')
      expect(await pending).toBeNull()
      const disabled = tui.prompt({ title: 'Disabled row', question: '', allowCustom: false, options: [{ label: 'Unavailable', disabled: true }] })
      clickText(term, 'Unavailable')
      clickText(term, 'Enter select')
      expect(term.visible().join('\n')).toContain('Disabled row')
      press(term, '\x03')
      expect(await disabled).toBeNull()
    } finally { tui.dispose() }
  })
})

describe('context overview interaction', () => {
  const snapshot = {
    sessionId: 'session-context', model: 'deepseek/model', agent: 'Standard', workflow: 'Default',
    turns: 12, steps: 38, inputTokens: 280_000, outputTokens: 18_000, followUp: 0, steering: 0,
    pressure: { contextWindow: 128_000, projectedTokens: 64_000 },
  }

  it.each([false, true])('opens directly, handles mouse actions and restores the draft and history (colors=%s)', async colors => {
    const term = new ScrollingTerminal(80, 30), tui = new LocalTui(term, 'm', colors)
    try {
      longTurn(tui, 1, 50)
      press(term, '\x1b[5~')
      press(term, 'keep this draft')
      const before = term.visible(), history = term.scrollback()
      const pending = tui.openContext({ read: () => snapshot, canCompact: true, signal: new AbortController().signal, onSuperseded: vi.fn() })
      expect(term.visible().join('\n')).toContain('50.0%')
      expect(term.visible().join('\n')).toContain('12 turns')
      const row = term.visible().findIndex(line => line.includes('[ Copy session ID ]'))
      const column = term.visible()[row]!.indexOf('Copy session ID') + 2
      press(term, `\x1b[<0;${column};${row + 1}M\x1b[<0;${column};${row + 1}m`)
      expect(await pending).toBe('copy')
      expect(term.visible()).toEqual(before)
      expect(term.scrollback()).toEqual(history)
    } finally { tui.dispose() }
  })

  it('scrolls a short panel, searches the rendered rows, and activates actions with the keyboard', async () => {
    const term = new ScrollingTerminal(40, 20), tui = new LocalTui(term, 'm', false)
    try {
      const pending = tui.openContext({ read: () => snapshot, canCompact: false, signal: new AbortController().signal, onSuperseded: vi.fn() })
      const before = term.visible()
      press(term, '\x1b[<65;10;8M')
      expect(term.visible()).not.toEqual(before)
      press(term, '/')
      press(term, '12 turns\r')
      expect(term.visible().join('\n')).toContain('12 turns')
      press(term, '\t\r')
      expect(await pending).toBe('copy')
    } finally { tui.dispose() }
  })

  it('activates a clicked action while the search field is open', async () => {
    const term = new ScrollingTerminal(80, 24), tui = new LocalTui(term, 'm', false)
    try {
      const pending = tui.openContext({ read: () => snapshot, canCompact: true, signal: new AbortController().signal, onSuperseded: vi.fn() })
      press(term, '/')
      press(term, 'turns')
      const row = term.visible().findIndex(line => line.includes('[ Details ]'))
      const column = term.visible()[row]!.indexOf('Details') + 2
      press(term, `\x1b[<0;${column};${row + 1}M\x1b[<0;${column};${row + 1}m`)
      expect(await pending).toBe('details')
    } finally { tui.dispose() }
  })

  it('refreshes projections and releases the panel when an approval arrives', async () => {
    const term = new ScrollingTerminal(80, 30), tui = new LocalTui(term, 'm', false)
    try {
      let current = snapshot
      const superseded = vi.fn()
      const pending = tui.openContext({ read: () => current, canCompact: true, signal: new AbortController().signal, onSuperseded: superseded })
      current = { ...snapshot, pressure: { contextWindow: 128_000, projectedTokens: 96_000 } }
      await vi.waitFor(() => { expect(term.visible().join('\n')).toContain('75.0%') })
      const approval = tui.prompt({ title: 'Approve', question: 'Continue?', options: [{ label: 'Yes' }], allowCustom: false })
      expect(await pending).toBeNull()
      expect(superseded).toHaveBeenCalledTimes(1)
      press(term, '\x03')
      await approval
    } finally { tui.dispose() }
  })
})

describe('text reader pointer interaction', () => {
  const wheelDown = '\x1b[<65;10;5M'
  const wheelUp = '\x1b[<64;10;5M'
  const body = Array.from({ length: 100 }, (_, index) => `ROW_${String(index).padStart(3, '0')}`).join('\n')

  const markdown = body.split('\n').map(line => '- ' + line).join('\n')

  it('activates the visible Back button in a full-screen reader', async () => {
    const term = new ScrollingTerminal(80, 24), tui = new LocalTui(term, 'm', false)
    try {
      const pending = tui.prompt({ title: 'Reader', question: '', presentation: 'document', detail: markdown, notify: false,
        allowCustom: false, options: [{ label: 'Back', value: 'close' }] })
      const row = term.visible().findIndex(line => line.includes('[ Back ]'))
      const column = term.visible()[row]!.indexOf('Back') + 2
      press(term, `\x1b[<0;${column};${row + 1}M\x1b[<0;${column};${row + 1}m`)
      expect(await pending).toBe('close')
    } finally { tui.dispose() }
  })

  it.each([
    ['document', false, false], ['document', false, true],
    ['document', true, false], ['document', true, true],
    ['plan-review', false, false], ['plan-review', false, true],
  ] as const)('scrolls %s (source=%s, colors=%s) and restores the conversation', async (presentation, source, colors) => {
    const term = new ScrollingTerminal(80, 24)
    const tui = new LocalTui(term, 'm', colors, 'dark', copyToClipboard, { wheelAcceleration: false })
    try {
      tui.applyStoredPrefs({ mouseInteraction: 'tui' })
      longTurn(tui, 1, 50)
      press(term, '\x1b[5~')
      press(term, 'keep draft')
      const before = term.visible(), history = term.scrollback()
      const position = vi.fn()
      const pending = tui.prompt({ title: 'Reader', question: '', presentation, notify: false, allowCustom: false,
        ...(source ? { documentSource: { text: body } } : { detail: markdown }),
        options: [{ label: 'Close' }], onDocumentPosition: position })
      expect(term.visible().join('\n')).toContain('ROW_000')
      press(term, wheelDown)
      const firstScroll = term.visible()
      press(term, wheelDown)
      press(term, wheelUp)
      expect(term.visible().join('\n')).not.toContain('ROW_000')
      expect(term.visible()).toEqual(firstScroll)
      press(term, '\x03')
      await pending
      if (presentation === 'document') expect(position).toHaveBeenCalledWith(expect.objectContaining({ row: 3 }))
      expect(term.visible()).toEqual(before)
      expect(term.scrollback()).toEqual(history)
    } finally { tui.dispose() }
  })

  it('bounds scrolling and pauses a live source until End resumes following', async () => {
    const term = new ScrollingTerminal(80, 24), tui = new LocalTui(term, 'm', false)
    try {
      tui.applyStoredPrefs({ mouseInteraction: 'tui' })
      const position = vi.fn()
      const pending = tui.prompt({ title: 'Log', question: '', presentation: 'document', notify: false,
        documentSource: { text: body }, documentTail: true, onDocumentPosition: position, options: [{ label: 'Close' }] })
      expect(term.visible().join('\n')).toContain('Following')
      press(term, wheelUp)
      expect(term.visible().join('\n')).toContain('Paused')
      for (let at = 0; at < 150; at++) press(term, wheelUp)
      expect(term.visible().join('\n')).toContain('ROW_000')
      const top = term.visible()
      press(term, wheelUp)
      expect(term.visible()).toEqual(top)
      for (let at = 0; at < 150; at++) press(term, wheelDown)
      expect(term.visible().join('\n')).toContain('ROW_099')
      expect(term.visible().join('\n')).toContain('Paused')
      press(term, '\x1b[F')
      expect(term.visible().join('\n')).toContain('Following')
      press(term, '\x03')
      await pending
      expect(position).toHaveBeenCalledWith(expect.objectContaining({ following: true }))
    } finally { tui.dispose() }
  })

  it.each([false, true])('retains drag selection and right-click copy (copyOnSelect=%s)', async copyOnSelect => {
    const term = new ScrollingTerminal(80, 24), copy = vi.fn(async (_text: string) => {})
    const tui = new LocalTui(term, 'm', false, 'dark', copy)
    try {
      tui.applyStoredPrefs({ mouseInteraction: 'tui', copyOnSelect })
      const pending = tui.prompt({ title: 'Reader', question: '', presentation: 'document', detail: markdown, notify: false, options: [{ label: 'Close' }] })
      const row = term.visible().findIndex(line => line.includes('ROW_001'))
      const column = term.visible()[row]!.indexOf('ROW_001')
      press(term, `\x1b[<0;${column + 1};${row + 1}M\x1b[<32;${column + 7};${row + 1}M\x1b[<0;${column + 7};${row + 1}m`)
      await flushAsyncPaste()
      expect(copy).toHaveBeenCalledTimes(copyOnSelect ? 1 : 0)
      if (copyOnSelect) expect(term.visible().join('\n')).toContain('Copied selection')
      press(term, `\x1b[<2;${column + 1};${row + 1}M`)
      await flushAsyncPaste()
      expect(copy).toHaveBeenLastCalledWith('ROW_001')
      expect(term.visible().join('\n')).toContain('Copied selection')
      press(term, wheelDown)
      const calls = copy.mock.calls.length
      press(term, `\x1b[<0;${column + 7};${row + 1}m`)
      await flushAsyncPaste()
      expect(copy).toHaveBeenCalledTimes(calls)
      press(term, '\x03')
      await pending
    } finally { tui.dispose() }
  })

  it('keeps the search query while scrolling and remembers the resulting position', async () => {
    const term = new ScrollingTerminal(80, 24), tui = new LocalTui(term, 'm', false)
    try {
      const position = vi.fn()
      const pending = tui.prompt({ title: 'Reader', question: '', presentation: 'document', detail: markdown, notify: false,
        options: [{ label: 'Close' }], onDocumentPosition: position })
      press(term, '/')
      press(term, 'ROW_060')
      press(term, '\r')
      press(term, wheelDown)
      expect(term.visible().join('\n')).toContain('“ROW_060”')
      press(term, '\x03')
      await pending
      expect(position.mock.calls[0]?.[0]).toMatchObject({ query: 'ROW_060' })
      expect(position.mock.calls[0]?.[0].row).toBeGreaterThan(59)
    } finally { tui.dispose() }
  })

  it('leaves native mouse mode alone and releases capture for a choice prompt', async () => {
    const term = new ScrollingTerminal(80, 24), tui = new LocalTui(term, 'm', false)
    try {
      tui.applyStoredPrefs({ mouseInteraction: 'native' })
      const abort = new AbortController()
      const pending = tui.prompt({ title: 'Reader', question: '', presentation: 'document', detail: markdown, signal: abort.signal,
        notify: false, options: [{ label: 'Close' }] })
      const before = term.visible()
      press(term, wheelDown)
      expect(term.visible()).toEqual(before)
      tui.applyStoredPrefs({ mouseInteraction: 'tui' })
      press(term, wheelDown)
      expect(term.visible()).not.toEqual(before)
      abort.abort()
      await pending
      const choice = tui.prompt({ title: 'Choose', question: '', options: [{ label: 'One' }], notify: false })
      const card = term.visible()
      press(term, wheelDown)
      expect(term.visible()).toEqual(card)
      press(term, '\x03')
      await choice
    } finally { tui.dispose() }
  })
})

describe('wheel acceleration option', () => {
  const wheelUp = '\x1b[<64;10;5M'
  const firstLineRow = (rows: readonly string[]): { at: number; label: string } | undefined => {
    for (const [index, row] of rows.entries()) {
      const match = /answer 1 line \d+/.exec(row)
      if (match !== null) return { at: index, label: match[0] }
    }
    return undefined
  }

  it.each([false, true] as const)('moves a flat three lines per event when acceleration is off (wheelAcceleration=%s)', accel => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, { wheelAcceleration: accel })
    try {
      longTurn(tui, 1, 60)
      press(term as never, wheelUp)
      const before = firstLineRow(term.visible())
      expect(before).not.toBeUndefined()
      // A back-to-back report is a burst follow-up only when acceleration is on.
      press(term as never, wheelUp)
      const after = term.visible().findIndex(row => row.includes(before!.label))
      expect(after - before!.at).toBe(accel ? 1 : 3)
    } finally { tui.dispose() }
  })
})

describe('transcript thinking controls', () => {
  it('folds every thought with Ctrl+T and reports the change on the composer border', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.event(ev('assistant/message', {
      message: {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'weighing the two options' },
          { type: 'text', text: 'Done.' },
        ],
      },
    }, 1))
    press(term, '\x14')
    expect(tui.prefs().hideThinking).toBe(false)
    const shown = stripAnsi(term.captured)
    expect(shown).toContain('weighing the two options')
    press(term, '\x14')
    const hidden = stripAnsi(term.captured)
    // The thought collapses to one row that still says what it was about.
    expect(hidden).toContain('Thinking · weighing the two options')
    expect(hidden).toContain('Thinking: hidden')
    // The confirmation rides the composer border, never the transcript.
    expect(tui.prefs().hideThinking).toBe(true)
    tui.dispose()
  })
})

describe('completionDescribes', () => {
  // The `@` menu is rebuilt from a debounced search, so a keystroke almost never
  // has an answer yet. Whether the rows already on screen may stand in for it is
  // the whole of the flicker fix: before this predicate existed, every keystroke
  // cleared the menu and it came back once the search returned.
  it('keeps the rows for a token the reader is extending', () => {
    expect(completionDescribes('', '')).toBe(true)
    expect(completionDescribes('', 's')).toBe(true)
    expect(completionDescribes('sr', 'src')).toBe(true)
  })

  it('keeps the rows for a token the reader is shortening', () => {
    // Deleting flashes exactly like typing if the shorter prefix cannot reuse
    // the longer prefix's rows.
    expect(completionDescribes('src', 'sr')).toBe(true)
    expect(completionDescribes('s', '')).toBe(true)
  })

  it('refuses rows that describe a different token', () => {
    expect(completionDescribes('src', 'lib')).toBe(false)
    expect(completionDescribes('a', 'b')).toBe(false)
  })

  it('refuses a menu that never recorded a token', () => {
    // Slash-command and plain-path completions carry no `@` prefix, so their
    // rows cannot stand in for an `@` token.
    expect(completionDescribes(undefined, '')).toBe(false)
    expect(completionDescribes(undefined, 's')).toBe(false)
  })
})

describe('review-changes (Alt+V)', () => {
  it('reports when no tool files sit under the viewport instead of forwarding /diff', () => {
    // It used to derive the turn under the viewport and run `/diff turn N`
    // itself. `/diff` asks for that on its own, so the key now does exactly one
    // thing — open the files the tool under the reader's eye declared — and says
    // so when there are none.
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    try {
      press(term, '\x1bv')
      const painted = stripAnsi(term.captured)
      expect(painted).toContain('No tool files here')
      expect(painted).toContain('/diff')
      // The old behaviour called the command; this one must not.
      expect(painted).not.toContain('Current workspace changes')
    } finally { tui.dispose() }
  })
})

describe('status line settings survive a refresh', () => {
  /**
   * The reported bounce: hide a footer part, and while the overlay is still open
   * something re-reads the preferences and the row flips back to `shown`.
   *
   * `#syncSettingsActions` runs on every session projection refresh and reseeds
   * the overlay from `prefs()`. That projection used to carry the density only,
   * so the narrowing the reader had just written was gone by the time the rows
   * were redrawn.
   */
  it('keeps a hidden footer part hidden when the settings overlay is reseeded', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    try {
      void tui.readline()
      press(term, '/settings\r')
      press(term, 'Context\r')
      expect(tui.prefs().statusBar?.hidden).toContain('context')
      // A session refresh reseeds the rows from the preferences. Before the fix
      // this rewrote the document with the density only, so the row came back
      // saying `shown` — the bounce the recording showed.
      tui.setSession({ id: 's', recent: [] })
      expect(tui.prefs().statusBar?.hidden).toContain('context')
      const rows = tuiSettingItems(tui.prefs())
      expect(rows.find(item => item.id === 'statusItem:context')?.value).toBe('hidden')
    } finally {
      tui.dispose()
    }
  })

  it('keeps a part added beyond the density when the overlay is reseeded', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    try {
      void tui.readline()
      press(term, '/settings\r')
      press(term, 'Turns / steps\r')
      expect(tui.prefs().statusBar?.shown).toContain('counts')
      tui.setSession({ id: 's', recent: [] })
      expect(tui.prefs().statusBar?.shown).toContain('counts')
      expect(tui.prefs().statusBar?.hidden).not.toContain('counts')
    } finally {
      tui.dispose()
    }
  })
})

it.each(['queue', 'steer'] as const)('targets all child submission keys with %s Enter preference', async busyEnter => {
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  const submitted = vi.fn()
  tui.setSession({ id: 'parent', recent: [] })
  tui.onInspectSubmit(submitted)
  const parent = tui.readInput()
  try {
    tui.applyStoredPrefs({ theme: 'dark', colors: false, busyEnter })
    tui.setInspectedSubagent({ id: 'child', label: 'Child', phase: 'running', writable: true })
    tui.setStatus('running')
    press(term, 'default\r')
    press(term, 'alternate control\x1b[13;5u')
    press(term, 'alternate command\x1b[13;9u')
    press(term, '/literal guidance\x1bs')
    press(term, 'next task\x1b\r')
    expect(submitted.mock.calls.map(([message]) => [message.text, message.delivery])).toEqual([
      ['default', busyEnter], ['alternate control', busyEnter === 'queue' ? 'steer' : 'queue'],
      ['alternate command', busyEnter === 'queue' ? 'steer' : 'queue'], ['/literal guidance', 'steer'], ['next task', 'queue'],
    ])
    tui.setInspectedSubagent({ id: 'readonly', label: 'Read only', phase: 'running', writable: false })
    tui.restoreInput({ text: 'keep this', images: [] })
    press(term, '\x1b\r\x1bs\x1b[13;5u\x1b[13;9u\r')
    expect(submitted).toHaveBeenCalledTimes(5)
  } finally { tui.dispose() }
  expect(await parent).toBeNull()
})

it('keeps a selected child by identity when the roster changes order', async () => {
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  const opened = vi.fn()
  const a = { id: 'a', label: 'A', phase: 'running' as const, depth: 1, activity: [] }
  const b = { ...a, id: 'b', label: 'B' }
  try {
    tui.onInspectSubagent(opened)
    tui.setSubagents({ agents: [a, b] })
    press(term, '\x1b[B')
    tui.setSubagents({ agents: [b, a] })
    press(term, '\r')
    await flushAsyncPaste()
    expect(opened).toHaveBeenCalledWith('a')
  } finally { tui.dispose() }
})

it('routes child Ctrl+C past the parent Shell and leaves parent queued messages alone', async () => {
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  const abort = vi.fn(), interrupted = vi.fn()
  const done = Promise.withResolvers<{ output: string; code: number }>()
  try {
    tui.setSession({ id: 'parent', recent: [] })
    press(term, 'parent queue\r')
    const shell = tui.shellCommand({ command: 'parent command', abort, signal: new AbortController().signal, run: () => done.promise })
    tui.onInterrupt(interrupted)
    tui.setInspectedSubagent({ id: 'child', label: 'Child', phase: 'running', writable: true })
    tui.setStatus('running')
    press(term, '\x03')
    expect(interrupted).toHaveBeenCalledOnce()
    expect(abort).not.toHaveBeenCalled()
    press(term, '\x1b[A')
    expect((await tui.readInput())?.text).toBe('parent queue')
    done.resolve({ output: '', code: 0 })
    await shell
  } finally { done.resolve({ output: '', code: 0 }); tui.dispose() }
})

it('retains workflows in the roster and selects them by identity across live updates', async () => {
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  const opened = vi.fn()
  const a = { id: 'a', name: 'First workflow', status: 'open', members: [] }
  const b = { ...a, id: 'b', name: 'Second workflow' }
  try {
    tui.onInspectWorkflow(opened)
    tui.setSubagents({ agents: [], workflows: [a, b] })
    press(term, '\x1b[B')
    expect(stripAnsi(term.captured)).toContain('Workflow · First workflow · Running')
    tui.setSubagents({ agents: [], workflows: [b, { ...a, status: 'completed' }] })
    press(term, '\r')
    await flushAsyncPaste()
    expect(opened).toHaveBeenCalledWith('a')
    await vi.waitFor(() => expect(stripAnsi(term.captured)).toContain('First workflow · Completed'))
  } finally { tui.dispose() }
})

it('keeps the selected child when workflow rows are added or removed', async () => {
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false), opened = vi.fn()
  const child = { id: 'same', label: 'Child', phase: 'running' as const, depth: 1, activity: [] }
  try {
    tui.onInspectSubagent(opened)
    tui.setSubagents({ agents: [child] })
    press(term, '\x1b[B')
    tui.setSubagents({ agents: [child], workflows: [{ id: 'same', name: 'Workflow', status: 'open', members: [] }] })
    press(term, '\r')
    await flushAsyncPaste()
    expect(opened).toHaveBeenCalledWith('same')
  } finally { tui.dispose() }
})

it.each(['idle', 'running', 'steer'] as const)('preserves mixed file command order through retry (%s)', async mode => {
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  const first = { attachmentId: AttachmentId('first'), name: '任务.txt', bytes: 5 }
  const second = { attachmentId: AttachmentId('second'), name: 'other.txt', bytes: 8 }
  const draft = { text: '/plan inspect', images: [{ data: PNG_1X1, mediaType: 'image/png' as const }], files: [first, second],
    segments: [{ kind: 'text' as const, text: '/plan inspect' }, { kind: 'file' as const, index: 1 },
      { kind: 'image' as const, index: 0 }, { kind: 'file' as const, index: 0 }] }
  try {
    if (mode !== 'idle') tui.setStatus('running')
    tui.restoreInput(draft)
    const pending = tui.readInput()
    press(term, mode === 'steer' ? '\x1bs' : '\r')
    const submission = await pending
    expect(submission).toMatchObject(draft)
    if (mode === 'steer') expect(submission).toMatchObject({ delivery: 'steer', literal: true })
    else expect(submission?.delivery).toBeUndefined()
    tui.restoreInput(submission!)
    const retry = tui.readInput(); press(term, '\r')
    expect(await retry).toMatchObject(draft)
  } finally { tui.dispose() }
})

it('opens a durable compaction summary with Ctrl+O while preserving the draft and native history', async () => {
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  tui.event(ev('compaction/start', { compactionId: 'readable', turn: null }, 1))
  tui.event(ev('compaction/summary', { compactionId: 'readable', summary: [{ type: 'text', text: 'SUMMARY_BODY 中文 🐳' }], shadowedSeqs: [1], shadowedTokenCount: 900 }, 2))
  tui.event(ev('compaction/end', { compactionId: 'readable', turn: null }, 3))
  expect(stripAnsi(term.captured)).not.toContain('SUMMARY_BODY')
  press(term, 'keep draft')
  term.captured = ''
  press(term, '\x0f')
  expect(stripAnsi(term.captured)).toContain('SUMMARY_BODY')
  expect(term.captured).not.toContain('\x1b[3J')
  term.captured = ''
  press(term, '\x0f')
  expect(stripAnsi(term.captured)).not.toContain('SUMMARY_BODY')
  term.captured = ''
  press(term, '\x0f')
  expect(stripAnsi(term.captured)).toContain('SUMMARY_BODY')
  press(term, '\x0f')
  const pending = tui.readline(); press(term, '\r')
  expect(await pending).toBe('keep draft')
  tui.dispose()
})

it('opens goal controls from Alt+G without submitting or losing a multiline draft', async () => {
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  let signal: AbortSignal | undefined
  const off = tui.setGoalHandler(async owned => {
    signal = owned
    await tui.prompt({ title: 'Current goal', question: 'Manage goal', options: [{ label: 'Back' }], allowCustom: false, notify: false, signal: owned })
  })
  try {
    tui.restoreInput({ text: 'draft\n第二行 🐳', images: [] })
    press(term, '\x1bg')
    expect(stripAnsi(term.captured)).toContain('Current goal')
    expect(signal?.aborted).toBe(false)
    press(term, '\x1b[27u')
    await flushAsyncPaste()
    const next = tui.readline(); press(term, '\r')
    expect(await next).toBe('draft\n第二行 🐳')
    press(term, '\x1bg')
    off()
    expect(signal?.aborted).toBe(true)
  } finally { tui.dispose() }
})

describe('process disclosure navigation', () => {

  it.each([false, true])('keeps long tool context and restores a folded reading position (colors=%s)', colors => {
    const term = new ScrollingTerminal(100, 28), tui = new LocalTui(term, 'm', colors)
    try {
      tui.setStatus('running')
      tui.event(ev('turn/start', { turn: 1 }, 1))
      tui.event(ev('tool/call', { turn: 1, step: 1, callId: 'long', name: 'bash', arguments: JSON.stringify({ command: 'print-output', description: 'Long result' }) }, 2))
      tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: 'long', content: [{ type: 'text', text: Array.from({ length: 120 }, (_, i) => `OUTPUT_${String(i).padStart(3, '0')}`).join('\n') }] } }, 3))
      press(term, 'keep draft')
      press(term, '\x0f\r\x1b[6~\x1b[6~')
      const rows = () => term.visible().filter(row => /OUTPUT_\d+/.test(row))
      const position = rows()
      expect(position.length).toBeGreaterThan(3)
      expect(position.join('\n')).not.toContain('OUTPUT_000')
      expect(term.visible()[0]).toContain('Long result')
      const history = term.scrollback()
      press(term, '\x1b[D')
      expect(rows()).toHaveLength(0)
      expect(term.visible().join('\n')).toContain('Long result')
      press(term, '\x1b[C')
      expect(rows()).toEqual(position)
      expect(term.visible().join('\n')).toContain('keep draft')
      press(term, '\x1b[H')
      expect(rows().join('\n')).toContain('OUTPUT_000')
      expect(term.visible().join('\n')).toContain('$ print-output')
      expect(term.scrollback()).toEqual(history)
      // A changed width invalidates visual-row offsets instead of restoring the wrong text.
      press(term, '\x1b[6~\x1b[D')
      term.resize(80)
      press(term, '\x1b[C')
      expect(rows().join('\n')).toContain('OUTPUT_000')
      // Leaving inspection clears its saved positions, including on the same call.
      press(term, '\x1b[6~\x1b[D\x1b[F\x0f\r')
      expect(rows().join('\n')).toContain('OUTPUT_000')
      expect(term.visible().join('\n')).toContain('keep draft')
    } finally { tui.dispose() }
  })

  it.each([false, true])('keeps item choices and the draft through completion (colors=%s)', colors => {
    const term = new ScrollingTerminal(100, 45)
    const tui = new LocalTui(term, 'm', colors)
    try {
      tui.setStatus('running')
      tui.event(ev('turn/start', { turn: 1 }, 1))
      tui.event(ev('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [
        { type: 'reasoning', text: 'A short summary.\n\nLatest heading\nTHOUGHT_DETAIL' },
        { type: 'text', text: 'I will check both files.' },
      ] } }, 2))
      for (const id of ['first', 'second']) {
        tui.event(ev('tool/call', { turn: 1, step: 1, callId: id, name: 'read', arguments: JSON.stringify({ path: id + '.ts' }) }, 3))
        tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: id, content: [{ type: 'text', text: 'BODY_' + id }] } }, 4))
      }
      press(term, 'draft')
      const history = term.scrollback()
      press(term, '\x0f\x1b[A\x1b[A')
      expect(term.visible().join('\n')).not.toContain('THOUGHT_DETAIL')
      press(term, '\r')
      expect(term.visible().join('\n')).toContain('THOUGHT_DETAIL')
      press(term, '\x1b[B\x1b[C')
      expect(term.visible().join('\n')).toContain('BODY_first')
      expect(term.visible().join('\n')).not.toContain('BODY_second')
      const selectedAt = term.visible().findIndex(line => line.includes('❯'))
      tui.event(ev('assistant/message', { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'Both files checked.' }] } }, 5))
      tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 6))
      tui.setStatus('idle')
      expect(term.visible().findIndex(line => line.includes('❯'))).toBe(selectedAt)
      expect(term.visible().join('\n')).toContain('BODY_first')
      expect(term.visible().join('\n')).toContain('draft')
      press(term, '\x1b[D')
      expect(term.visible().join('\n')).not.toContain('BODY_first')
      press(term, '\x1b[27u')
      const screen = term.visible().join('\n')
      expect(screen).toContain('Worked for')
      expect(screen).toContain('I will check both files.')
      expect(screen).toContain('Both files checked.')
      expect(screen).toContain('draft')
      expect(screen).not.toContain('Process ·')
      expect(term.scrollback()).toEqual(history)
    } finally { tui.dispose() }
  })

  it('lets individual thoughts close when the saved preference is shown', () => {
    const term = new ScrollingTerminal(100, 35), tui = new LocalTui(term, 'm', false)
    try {
      tui.applyStoredPrefs({ hideThinking: false })
      tui.event(ev('turn/start', { turn: 1 }, 1))
      tui.event(ev('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [
        { type: 'reasoning', text: 'Summary.\n\nLatest heading\nDETAIL_TO_CLOSE' },
      ] } }, 2))
      tui.setStatus('running')
      expect(term.visible().join('\n')).toContain('DETAIL_TO_CLOSE')
      press(term, '\x0f\x1b[D')
      expect(term.visible().join('\n')).not.toContain('DETAIL_TO_CLOSE')
      expect(tui.prefs().hideThinking).toBe(false)
      press(term, '\x1b[C')
      expect(term.visible().join('\n')).toContain('DETAIL_TO_CLOSE')
    } finally { tui.dispose() }
  })
})

describe('process disclosure pointer interaction', () => {
  const mouse = (term: ScrollingTerminal, row: number, column: number, action: 'press' | 'release' | 'drag', shift = false) => {
    press(term, `\x1b[<${(action === 'drag' ? 32 : 0) + (shift ? 4 : 0)};${column + 1};${row + 1}${action === 'release' ? 'm' : 'M'}`)
  }
  const seed = (tui: LocalTui) => {
    tui.event(ev('turn/start', { turn: 1 }, 1))
    tui.setStatus('running')
    tui.event(ev('tool/call', { turn: 1, step: 1, callId: 'c', name: 'read', arguments: '{"path":"sample.ts","limit":80}' }, 2))
    tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: 'c', content: [{ type: 'text', text: 'READABLE_BODY' }] } }, 3))
    tui.applyStoredPrefs({ mouseInteraction: 'tui' })
  }
  const click = (term: ScrollingTerminal, label: string, column = 2) => {
    const row = term.visible().findIndex(line => line.includes(label))
    expect(row).toBeGreaterThanOrEqual(0)
    mouse(term, row, column, 'press')
    mouse(term, row, column, 'release')
  }

  it.each([false, true])('opens command output by click and restores its draft and reading position (colors=%s)', async colors => {
    const term = new ScrollingTerminal(80, 30), tui = new LocalTui(term, 'm', colors)
    try {
      tui.applyStoredPrefs({ mouseInteraction: 'tui', copyOnSelect: false })
      tui.commandOutput('context', 'Context Details\n\n' + Array.from({ length: 40 }, (_, i) => `- ROW_${i}`).join('\n'), { focus: true })
      press(term, 'keep draft')
      const history = term.scrollback()
      click(term, 'Context Details', 10)
      const row = term.visible().findIndex(line => line.includes('Context Details'))
      expect(term.visible()[row]).toContain('▾')
      const before = term.visible()
      click(term, 'Context Details', 77)
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('/ find')
      press(term, '\x03')
      await flushAsyncPaste()
      expect(term.visible()).toEqual(before)
      expect(term.scrollback()).toEqual(history)
      expect(term.visible().join('\n')).toContain('keep draft')
      mouse(term, row, 5, 'press')
      mouse(term, row, 15, 'drag')
      mouse(term, row, 15, 'release')
      expect(term.visible()[row]).toContain('▾')
    } finally { tui.dispose() }
  })

  it.each([false, true])('shares keyboard state and preserves draft and native history (colors=%s)', colors => {
    const term = new ScrollingTerminal(100, 40), tui = new LocalTui(term, 'm', colors)
    try {
      seed(tui)
      press(term, 'keep draft')
      const history = term.scrollback()
      click(term, 'Read file · sample.ts')
      expect(term.visible().join('\n')).toContain('READABLE_BODY')
      expect(term.visible().join('\n')).not.toContain('"limit"')
      press(term, '\x1bo')
      expect(term.visible().join('\n')).toContain('"limit": 80')
      press(term, '\x1b[D')
      expect(term.visible().join('\n')).not.toContain('READABLE_BODY')
      press(term, '\x1b[C')
      expect(term.visible().join('\n')).toContain('READABLE_BODY')
      click(term, 'Read file · sample.ts')
      expect(term.visible().join('\n')).not.toContain('READABLE_BODY')
      press(term, '\x1b[F')
      tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 4))
      tui.setStatus('idle')
      click(term, 'Worked for')
      click(term, 'Read file · sample.ts')
      expect(term.visible().join('\n')).toContain('READABLE_BODY')
      expect(term.visible().join('\n')).toContain('keep draft')
      expect(term.scrollback()).toEqual(history)
    } finally { tui.dispose() }
  })

  it('keeps titles selectable and lets a drag from the arrow win over clicking', async () => {
    const copied: string[] = []
    const term = new ScrollingTerminal(100, 40), tui = new LocalTui(term, 'm', false, 'dark', async text => { copied.push(text) })
    try {
      seed(tui)
      let row = term.visible().findIndex(line => line.includes('sample.ts'))
      const column = term.visible()[row]!.indexOf('sample.ts')
      for (let count = 0; count < 2; count++) {
        mouse(term, row, column + 2, 'press')
        mouse(term, row, column + 2, 'release')
      }
      await vi.waitFor(() => expect(copied).toContain('sample.ts'))
      expect(term.visible().join('\n')).not.toContain('READABLE_BODY')
      // Starting a fresh drag in the gutter still selects the title text.
      mouse(term, row, 2, 'press')
      mouse(term, row, column + 9, 'drag')
      mouse(term, row, column + 9, 'release')
      await vi.waitFor(() => expect(copied.some(text => text.includes('Read file · sample.ts'))).toBe(true))
      expect(term.visible().join('\n')).not.toContain('READABLE_BODY')
      row = term.visible().findIndex(line => line.includes('sample.ts'))
      mouse(term, row, 2, 'press')
      mouse(term, row, 4, 'drag')
      mouse(term, row, 2, 'release')
      expect(term.visible().join('\n')).not.toContain('READABLE_BODY')
    } finally { tui.dispose() }
  })

  it.each(['shift', 'native', 'moved', 'changed', 'wheel'] as const)('does not activate an unsafe or selection-only click (%s)', scenario => {
    const term = new ScrollingTerminal(100, 40), tui = new LocalTui(term, 'm', false)
    try {
      seed(tui)
      if (scenario === 'native') tui.applyStoredPrefs({ mouseInteraction: 'native' })
      const row = term.visible().findIndex(line => line.includes('sample.ts'))
      expect(row).toBeGreaterThanOrEqual(0)
      mouse(term, row, 2, 'press', scenario === 'shift')
      if (scenario === 'changed') {
        tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 4))
        tui.setStatus('idle')
      }
      if (scenario === 'wheel') press(term, '\x1b[<64;3;3M')
      mouse(term, row, scenario === 'moved' ? 4 : 2, 'release', scenario === 'shift')
      expect(term.visible().join('\n')).not.toContain('READABLE_BODY')
      if (scenario === 'changed') expect(term.visible().join('\n')).toContain('Worked for')
    } finally { tui.dispose() }
  })

  it.each(['left-margin', 'release-drift', 'same-cell-motion', 'gutter-motion'] as const)('accepts an ordinary click with %s', gesture => {
    const term = new ScrollingTerminal(100, 40), tui = new LocalTui(term, 'm', false)
    try {
      seed(tui)
      const row = term.visible().findIndex(line => line.includes('sample.ts'))
      expect(row).toBeGreaterThanOrEqual(0)
      const start = gesture === 'left-margin' ? 0 : 2
      mouse(term, row, start, 'press')
      if (gesture === 'same-cell-motion') mouse(term, row, 2, 'drag')
      if (gesture === 'gutter-motion') mouse(term, row, 3, 'drag')
      mouse(term, row, gesture === 'release-drift' || gesture === 'gutter-motion' ? 3 : start, 'release')
      expect(term.visible().join('\n')).toContain('READABLE_BODY')
    } finally { tui.dispose() }
  })

  it('accepts a click while the same thought updates its preview', () => {
    const term = new ScrollingTerminal(100, 40), tui = new LocalTui(term, 'm', false)
    const thought = (text: string, seq: number) => tui.event(ev('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [
      { type: 'reasoning', text },
    ] } }, seq))
    try {
      tui.event(ev('turn/start', { turn: 1 }, 1))
      tui.setStatus('running')
      thought('First heading\nfirst body', 2)
      tui.applyStoredPrefs({ mouseInteraction: 'tui' })
      const row = term.visible().findIndex(line => line.includes('Thinking'))
      expect(row).toBeGreaterThanOrEqual(0)
      mouse(term, row, 2, 'press')
      thought('Latest heading\nLATEST_BODY', 3)
      tui.applyStoredPrefs({ mouseInteraction: 'tui' })
      mouse(term, row, 2, 'release')
      expect(term.visible().join('\n')).toContain('LATEST_BODY')
    } finally { tui.dispose() }
  })

  it('clicks thinking separately from the answer carried by the same block', () => {
    const term = new ScrollingTerminal(100, 40), tui = new LocalTui(term, 'm', false)
    try {
      tui.event(ev('turn/start', { turn: 1 }, 1))
      tui.setStatus('running')
      tui.event(ev('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [
        { type: 'reasoning', text: 'Latest heading\nTHOUGHT_BODY' },
        { type: 'text', text: 'Answer stays visible.' },
      ] } }, 2))
      tui.applyStoredPrefs({ mouseInteraction: 'tui' })
      click(term, 'Thinking')
      expect(term.visible().join('\n')).toContain('THOUGHT_BODY')
      click(term, 'Thinking')
      expect(term.visible().join('\n')).not.toContain('THOUGHT_BODY')
      expect(term.visible().join('\n')).toContain('Answer stays visible.')
    } finally { tui.dispose() }
  })
})

describe('current tool actions and selected quotes', () => {
  const pointer = (term: ScrollingTerminal, row: number, column: number, action: 'press' | 'release' | 'drag', shift = false) =>
    press(term, `\x1b[<${(action === 'drag' ? 32 : 0) + (shift ? 4 : 0)};${column + 1};${row + 1}${action === 'release' ? 'm' : 'M'}`)
  const clickLabel = (term: ScrollingTerminal, label: string) => {
    const row = term.visible().findIndex(line => line.includes(label))
    expect(row).toBeGreaterThanOrEqual(0)
    const col = term.visible()[row]!.indexOf(label)
    pointer(term, row, col, 'press'); pointer(term, row, col, 'release')
  }

  it.each([false, true])('opens the selected tool by mouse and shows copy feedback over navigation (colors=%s)', async colors => {
    const term = new ScrollingTerminal(120, 40), copy = vi.fn(async () => {})
    const tui = new LocalTui(term, 'm', colors, 'dark', copy)
    const prompt = vi.spyOn(tui, 'prompt')
    try {
      twoTools(tui)
      tui.restoreInput({ text: 'keep draft', images: [] })
      press(term, '\x0f\x1b[A')
      const history = term.scrollback()
      clickLabel(term, '[···]')
      expect(prompt.mock.calls[0]?.[0].question).toBe('command-0')
      press(term, '\r')
      await vi.waitFor(() => expect(term.visible().join('\n')).toContain('Copied command'))
      expect(copy).toHaveBeenCalledWith('command-0')
      expect(term.visible().join('\n')).toContain('keep draft')
      expect(term.scrollback()).toEqual(history)
    } finally { tui.dispose() }
  })

  it.each(['drag', 'shift', 'resize', 'native'] as const)('does not activate a menu after %s', async mode => {
    const term = new ScrollingTerminal(120, 40), tui = new LocalTui(term, 'm', false)
    const prompt = vi.spyOn(tui, 'prompt')
    try {
      twoTools(tui); press(term, '\x0f')
      const row = term.visible().findIndex(line => line.includes('[···]'))
      const column = term.visible()[row]!.indexOf('[···]')
      if (mode === 'native') tui.applyStoredPrefs({ mouseInteraction: 'native' })
      pointer(term, row, column, 'press', mode === 'shift')
      if (mode === 'drag') { pointer(term, row - 1, column, 'drag'); pointer(term, row, column, 'drag') }
      if (mode === 'resize') term.resize(100)
      pointer(term, row, column, 'release', mode === 'shift')
      await flushAsyncPaste()
      expect(prompt).not.toHaveBeenCalled()
    } finally { tui.dispose() }
  })

  it.each(['confirmed', 'requested', 'failure'] as const)('shows automatic selection copy feedback (%s) and retains Quote', async delivery => {
    const term = new ScrollingTerminal(120, 32), copy = vi.fn(async () => {
      if (delivery === 'failure') throw new Error('unavailable')
      return delivery
    })
    const tui = new LocalTui(term, 'm', false, 'dark', copy)
    try {
      twoTools(tui)
      tui.event(ev('assistant/message', { turn: 1, step: 3, message: { role: 'assistant', content: [{ type: 'text', text: 'SELECT_THIS' }] } }, 9))
      tui.restoreInput({ text: 'keep draft', images: [] })
      const row = term.visible().findIndex(line => line.includes('SELECT_THIS'))
      const col = term.visible()[row]!.indexOf('SELECT_THIS')
      const history = term.scrollback()
      pointer(term, row, col, 'press'); pointer(term, row, col + 11, 'drag'); pointer(term, row, col + 11, 'release')
      await flushAsyncPaste()
      expect(copy).toHaveBeenCalledWith('SELECT_THIS')
      const text = term.visible().join('\n')
      expect(text).toContain(delivery === 'failure' ? 'Copy failed' : delivery === 'requested' ? 'Selection sent to terminal clipboard' : 'Copied selection')
      expect(text).toContain('[Copy]')
      expect(text).toContain('[Quote]')
      expect(term.scrollback()).toEqual(history)
      clickLabel(term, '[Quote]')
      expect(term.visible().join('\n')).toContain('Quoted in composer')
      expect(term.visible().join('\n')).toContain('keep draft')
    } finally { tui.dispose() }
  })

  it.each(['escape', 'session'] as const)('drops delayed selection feedback after %s', async ending => {
    let complete!: () => void
    const pending = new Promise<void>(resolve => { complete = resolve })
    const term = new ScrollingTerminal(120, 32), copy = vi.fn(async () => { await pending })
    const tui = new LocalTui(term, 'm', false, 'dark', copy)
    try {
      twoTools(tui)
      tui.event(ev('assistant/message', { turn: 1, step: 3, message: { role: 'assistant', content: [{ type: 'text', text: 'SELECT_THIS' }] } }, 9))
      const row = term.visible().findIndex(line => line.includes('SELECT_THIS'))
      const col = term.visible()[row]!.indexOf('SELECT_THIS')
      pointer(term, row, col, 'press'); pointer(term, row, col + 11, 'drag'); pointer(term, row, col + 11, 'release')
      await flushAsyncPaste()
      expect(copy).toHaveBeenCalledWith('SELECT_THIS')
      if (ending === 'session') tui.replaceSession([])
      else press(term, '\x1b[27u')
      complete()
      await flushAsyncPaste()
      expect(term.visible().join('\n')).not.toContain('Copied selection')
    } finally { complete(); tui.dispose() }
  })

  it.each(['copy', 'quote', 'failure'] as const)('uses the selection %s button without losing the draft', async action => {
    const term = new ScrollingTerminal(120, 32), copy = vi.fn(async () => { if (action === 'failure') throw new Error('unavailable') })
    const tui = new LocalTui(term, 'm', false, 'dark', copy)
    try {
      twoTools(tui); tui.applyStoredPrefs({ copyOnSelect: false })
      tui.event(ev('assistant/message', { turn: 1, step: 3, message: { role: 'assistant', content: [{ type: 'text', text: 'SELECT_THIS' }] } }, 9))
      tui.restoreInput({ text: 'keep draft', images: [] })
      const row = term.visible().findIndex(line => line.includes('SELECT_THIS'))
      const col = term.visible()[row]!.indexOf('SELECT_THIS')
      pointer(term, row, col, 'press'); pointer(term, row, col + 11, 'drag'); pointer(term, row, col + 11, 'release')
      const history = term.scrollback()
      clickLabel(term, action === 'quote' ? '[Quote]' : '[Copy]')
      await flushAsyncPaste()
      expect(term.scrollback()).toEqual(history)
      expect(term.visible().join('\n')).toContain('keep draft')
      if (action === 'quote') {
        expect(term.visible().join('\n')).toContain('Quoted in composer')
        press(term, '\x1bc'); await flushAsyncPaste()
        expect(copy).toHaveBeenCalledWith('keep draft\n\n> SELECT_THIS\n\n')
      } else {
        expect(copy).toHaveBeenCalledWith('SELECT_THIS')
        expect(term.visible().join('\n')).toContain(action === 'failure' ? 'Copy failed' : 'Copied selection')
      }
    } finally { tui.dispose() }
  })

  it.each(['copy', 'quote', 'readonly'] as const)('offers retained Read source for %s', async action => {
    const term = new ScrollingTerminal(120, 40), copy = vi.fn(async () => {})
    const tui = new LocalTui(term, 'm', false, 'dark', copy)
    const prompt = vi.spyOn(tui, 'prompt')
    const text = '  const value = "中文🐳";\n\t// ' + 'long'.repeat(100)
    try {
      tui.event(ev('tool/call', { callId: 'source', turn: 1, step: 1, name: 'read', arguments: '{}' }, 1))
      tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: 'source', content: [{ type: 'text', text: 'decorated result' }] } }, 2),
        { result: { card: 'read', path: 'missing.ts', offset: 99, totalLines: 100, lines: text.split('\n').map((text, i) => ({ number: i + 99, text })) } })
      tui.restoreInput({ text: 'keep draft', images: [] })
      if (action === 'readonly') tui.setInspectedSubagent({ id: 'child', label: 'Read only', phase: 'running', writable: false })
      press(term, '\x0f\x1ba')
      const options = prompt.mock.calls[0]![0].options!
      expect(options.find(option => option.value === 'source-copy')?.description).toBe('missing.ts:99–100')
      if (action === 'readonly') {
        expect(options.some(option => option.value === 'source-quote')).toBe(false)
        return
      }
      const index = options.findIndex(option => option.value === 'source-' + action)
      expect(index).toBeGreaterThanOrEqual(0)
      press(term, '\x1b[B'.repeat(index) + '\r'); await flushAsyncPaste()
      if (action === 'copy') expect(copy).toHaveBeenCalledWith(text)
      else {
        press(term, '\x1bc'); await flushAsyncPaste()
        expect(copy).toHaveBeenCalledWith('keep draft\n\nmissing.ts:99–100\n\n```ts\n' + text + '\n```\n\n')
      }
    } finally { tui.dispose() }
  })

  function twoTools(tui: LocalTui) {
    tui.event(ev('turn/start', { turn: 1 }, 1))
    for (const [index, name] of ['pwsh', 'bash'].entries()) {
      tui.event(ev('tool/call', { turn: 1, step: index + 1, callId: `action-${index}`, name, arguments: JSON.stringify({ command: `command-${index}` }) }, 2 + index * 2))
      tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: `action-${index}`, content: [{ type: 'text', text: `result-${index}` }] } }, 3 + index * 2))
    }
    tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 6))
  }

  it.each([false, true])('copies the selected older tool and restores draft and reading position (colors=%s)', async colors => {
    const term = new ScrollingTerminal(120, 40), copy = vi.fn(async () => {})
    const tui = new LocalTui(term, 'm', colors, 'dark', copy)
    const prompt = vi.spyOn(tui, 'prompt')
    try {
      twoTools(tui)
      tui.restoreInput({ text: 'keep draft', images: [] })
      press(term, '\x0f\x1b[A')
      const before = term.visible()
      const history = term.scrollback()
      press(term, '\x1ba')
      expect(prompt.mock.calls[0]?.[0].options?.[0]).toMatchObject({ label: 'Copy command', description: 'command-0' })
      press(term, '\r')
      await vi.waitFor(() => expect(copy).toHaveBeenCalledWith('command-0'))
      expect(term.visible().filter(row => row.includes('command-'))).toEqual(before.filter(row => row.includes('command-')))
      expect(term.visible().join('\n')).toContain('keep draft')
      expect(term.scrollback()).toEqual(history)
      press(term, '\x1ba\x1b[B\r')
      await vi.waitFor(() => expect(copy).toHaveBeenCalledWith('result-0'))
    } finally { tui.dispose() }
  })

  it.each(['approval', 'session', 'subagent'] as const)('cancels tool actions when %s takes over', async takeover => {
    const term = new ScrollingTerminal(100, 32), copy = vi.fn(async () => {})
    const tui = new LocalTui(term, 'm', false, 'dark', copy)
    try {
      twoTools(tui)
      press(term, '\x0f\x1ba')
      if (takeover === 'approval') {
        const pending = tui.prompt({ title: 'Approval required', question: 'Allow?', options: [{ label: 'Allow once' }] })
        await flushAsyncPaste()
        press(term, '\r')
        expect(await pending).toBe('Allow once')
      } else if (takeover === 'subagent') tui.setInspectedSubagent({ id: 'child', label: 'Child', phase: 'running', writable: true })
      else tui.setSession({ id: 'replacement', recent: [] })
      await flushAsyncPaste()
      expect(copy).not.toHaveBeenCalled()
      expect(term.visible().join('\n')).not.toContain('Tool actions')
    } finally { tui.dispose() }
  })

  it.each([false, true])('quotes Unicode selection into the draft without submitting or losing attachments (copyOnSelect=%s)', async copyOnSelect => {
    const term = new ScrollingTerminal(120, 32), copy = vi.fn(async () => {})
    const tui = new LocalTui(term, 'm', false, 'dark', copy)
    try {
      tui.applyStoredPrefs({ theme: 'dark', colors: false, copyOnSelect })
      twoTools(tui)
      tui.event(ev('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '引用 中文🐳e\u0301 text' }] } }, 1))
      const files = [{ attachmentId: AttachmentId('quote-file'), name: 'a.txt', bytes: 1 }]
      tui.restoreInput({ text: 'keep draft', images: [], files })
      const submitted = vi.fn()
      const input = tui.readInput(); void input.then(submitted)
      const row = term.visible().findIndex(line => line.includes('引用'))
      const column = term.visible()[row]!.indexOf('引用')
      press(term, `\x1b[<0;${column + 1};${row + 1}M\x1b[<32;${column + 20};${row + 1}M\x1b[<0;${column + 20};${row + 1}m`)
      await flushAsyncPaste()
      press(term, '\x1by')
      await flushAsyncPaste()
      expect(submitted).not.toHaveBeenCalled()
      expect(copy).toHaveBeenCalledTimes(copyOnSelect ? 1 : 0)
      press(term, '\r')
      expect(await input).toMatchObject({ text: 'keep draft \n\n> 引用 中文🐳e\u0301 text', files })
    } finally { tui.dispose() }
  })

  it.each(['quote', 'undo', 'readonly', 'resized'] as const)('preserves a folded draft with multiline selection (%s)', async mode => {
    const term = new ScrollingTerminal(120, 40), copy = vi.fn(async (_text: string) => {})
    const tui = new LocalTui(term, 'm', false, 'dark', copy)
    try {
      twoTools(tui)
      tui.event(ev('assistant/message', { turn: 1, step: 3, message: { role: 'assistant', content: [{ type: 'text', text: 'first selected line\n\nsecond selected line' }] } }, 9))
      tui.setSession({ id: 'quote-parent', recent: [] })
      const draft = 'existing pasted text\n'.repeat(15).trimEnd()
      press(term, '\x1b[200~' + draft + '\x1b[201~')
      await flushAsyncPaste()
      if (mode === 'readonly') tui.setInspectedSubagent({ id: 'child', label: 'Read only', phase: 'running', writable: false })
      const start = term.visible().findIndex(line => line.includes('first selected'))
      const end = term.visible().findIndex(line => line.includes('second selected'))
      expect(end).toBeGreaterThan(start)
      const column = term.visible()[start]!.indexOf('first')
      press(term, `\x1b[<0;${column + 1};${start + 1}M\x1b[<32;${column + 20};${end + 1}M\x1b[<0;${column + 20};${end + 1}m`)
      if (mode === 'resized') term.resize(100)
      press(term, '\x1by')
      if (mode === 'undo') press(term, '\x1f')
      if (mode === 'readonly') {
        press(term, '\x1b[27u')
        await flushAsyncPaste()
        press(term, '\x1bc')
        await flushAsyncPaste()
        expect(copy.mock.calls.at(-1)?.[0]).toBe('')
        tui.setInspectedSubagent(undefined)
      }
      // Explicit copy reads expanded paste atoms without submitting or losing them.
      press(term, '\x1b[27u')
      await flushAsyncPaste()
      press(term, '\x1bc')
      await flushAsyncPaste()
      const copied = copy.mock.calls.at(-1)?.[0] as string | undefined
      if (mode === 'quote') {
        expect(copied).toContain(draft + '\n\n> first selected line\n> ')
        expect(copied).toContain('second selected line')
      } else expect(copied).toBe(draft)
    } finally { tui.dispose() }
  })

  it('opens the chosen match, then restores the same transcript and draft', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-match-action-'))
    writeFileSync(join(root, 'a.ts'), Array.from({ length: 80 }, (_, i) => `source line ${i + 1}`).join('\n'))
    const term = new ScrollingTerminal(100, 32), tui = new LocalTui(term, 'm', false, 'dark', async () => {})
    const prompt = vi.spyOn(tui, 'prompt')
    try {
      tui.event(ev('tool/call', { callId: 'search', turn: 1, step: 1, name: 'grep', arguments: '{}' }, 1))
      tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: 'search', content: [{ type: 'text', text: 'matches' }] } }, 2),
        { cwd: root, result: { card: 'search', shape: 'matches', files: [{ path: 'a.ts', matches: [{ lineNumber: 12, line: 'first match' }, { lineNumber: 70, line: 'second match' }] }], total: 2, truncated: false } })
      tui.restoreInput({ text: 'keep draft', images: [] })
      press(term, '\x0f')
      const history = term.scrollback()
      press(term, '\x1ba\x1b[B\r')
      await vi.waitFor(() => expect(prompt.mock.calls[1]?.[0].options).toHaveLength(2))
      press(term, '\x1b[B\r')
      await vi.waitFor(() => expect(prompt.mock.calls[2]?.[0].documentPosition?.row).toBe(69))
      expect(term.visible().join('\n')).toContain('source line 70')
      press(term, '\x1b[27u')
      await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(4))
      press(term, '\x1b[27u')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('keep draft')
      expect(term.scrollback()).toEqual(history)
    } finally { tui.dispose(); rmSync(root, { recursive: true, force: true }) }
  })
})


describe('terminal key tester', () => {
  it.each(['escape', 'approval', 'session', 'subagent'] as const)('captures keys without dispatch or draft edits and yields to %s', async ending => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-key-test-')), path = join(root, 'keys.json')
    const bindings = JSON.stringify({ f6: 'copy-prompt' })
    writeFileSync(path, bindings)
    const term = new ScrollingTerminal(120, 40), copy = vi.fn(async () => {})
    const tui = new LocalTui(term, 'm', false, 'dark', copy, { keybindingsPath: path })
    try {
      void tui.readInput()
      press(term, '/settings\r')
      tui.restoreInput({ text: 'keep draft', images: [] })
      press(term, 'Keybindings\r')
      await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('Test keys')
      press(term, '\r'); await flushAsyncPaste()
      expect(term.visible().join('\n')).toContain('Key test')
      expect(term.visible().join('\n')).not.toContain('enter answer')
      for (const [bytes, diagnostic] of [['\x1b[17~', 'Key received: f6'], ['\x1ba', 'Key received: alt+a'], ['å¥', 'Text received: "å¥"'], ['\x04', 'Key received: ctrl+d'], ['\x1b[200~literal\x1b[201~', 'Paste received.']]) {
        press(term, bytes!); await flushAsyncPaste()
        expect(term.visible().join('\n')).toContain(diagnostic)
      }
      expect(copy).not.toHaveBeenCalled()
      expect(readFileSync(path, 'utf8')).toBe(bindings)
      if (ending === 'escape') {
        press(term, '\x1b[27u'); await flushAsyncPaste()
        expect(term.visible().join('\n')).toContain('Test keys')
        press(term, '\x1b[27u'); await flushAsyncPaste()
        press(term, '\x03')
        expect(term.visible().join('\n')).toContain('keep draft')
        press(term, '\x1b[17~'); await flushAsyncPaste()
        expect(copy).toHaveBeenCalledWith('keep draft')
      } else {
        if (ending === 'approval') {
          const approval = tui.prompt({ title: 'Approval required', question: 'Allow?', options: [{ label: 'Allow' }] })
          await flushAsyncPaste(); press(term, '\r'); await approval
        } else if (ending === 'session') tui.setSession({ id: 'replacement', recent: [] })
        else tui.setInspectedSubagent({ id: 'child', label: 'Child', phase: 'running', writable: true })
        await flushAsyncPaste()
        expect(term.visible().join('\n')).not.toContain('Key test')
        expect(term.visible().join('\n')).not.toContain('Test keys')
      }
    } finally { tui.dispose(); rmSync(root, { recursive: true, force: true }) }
  })
})


describe('Trajectory pointer ownership', () => {
  it.each([false, true])('clicks records, scrolls details, copies selections and restores native history (color=%s)', async color => {
    const term = new ScrollingTerminal(120, 24)
    const copy = vi.fn(async (_text: string) => {})
    const tui = new LocalTui(term, 'm', color, 'dark', copy)
    try {
      tui.applyStoredPrefs({ mouseInteraction: 'tui', copyOnSelect: false })
      const before = term.visible()
      const history = term.scrollback()
      const output = Array.from({ length: 70 }, (_, index) => `result-line-${index}`).join('\n')
      tui.openTrajectory([
        ev('tool/call', { turn: 1, step: 1, callId: 'read-1', name: 'read', arguments: '{"file_path":"README.md"}' }, 1),
        ev('tool/result', { turn: 1, step: 1, message: { toolCallId: 'read-1', content: [{ type: 'text', text: output }] } }, 2),
      ])
      const click = (row: number, col: number): void => press(term, `\x1b[<0;${col + 1};${row + 1}M\x1b[<0;${col + 1};${row + 1}m`)
      const row = term.visible().findIndex(line => line.includes('README.md'))
      expect(row).toBeGreaterThan(2)
      // Far from the small disclosure marker: the entire row is a target.
      click(row, 75)
      expect(term.visible().join('\n')).toContain('Overview')
      click(4, term.visible()[4]!.indexOf('Result'))
      expect(term.visible().join('\n')).toContain('result-line-0')
      press(term, '\x1b[<65;100;14M')
      expect(term.visible().join('\n')).not.toContain('result-line-0')
      press(term, '\x1b[F\x1b[A')
      expect(term.visible().join('\n')).toContain('result-line-68')
      press(term, '\x1b[H')
      const selectedRow = term.visible().findIndex(line => line.includes('result-line-0'))
      const col = term.visible()[selectedRow]!.indexOf('result-line-0')
      press(term, `\x1b[<0;${col + 1};${selectedRow + 1}M\x1b[<32;${col + 13};${selectedRow + 1}M\x1b[<0;${col + 13};${selectedRow + 1}m`)
      expect(copy).not.toHaveBeenCalled()
      press(term, '\r')
      await flushAsyncPaste()
      expect(copy).toHaveBeenCalledWith('result-line-0')
      expect(term.visible().join('\n')).toContain('Copied selection')
      // One escape clears selection, one closes details, one closes Trajectory.
      press(term, '\x1b[27u\x1b[27u\x1b[27u')
      expect(term.visible()).toEqual(before)
      expect(term.scrollback()).toEqual(history)
    } finally { tui.dispose() }
  })
})

it('keeps file review clicks, text selection, modal displacement and composer restoration under terminal ownership', async () => {
  const term = new FakeTerminal(); term.columns = 120
  const copy = vi.fn(async () => {})
  const tui = new LocalTui(term, 'test', false, 'dark', copy)
  const abort = new AbortController()
  const reads = vi.fn(async (index: number) => ({ source: { text: `file ${index}\n` + 'content\n'.repeat(60), diff: false } }))
  const input = tui.readInput()
  try {
    press(term, 'draft')
    const review = tui.reviewFiles({ title: 'Review fixture', files: [{ path: 'a.ts', label: 'a.ts' }, { path: 'b.ts', label: 'b.ts' }],
      signal: abort.signal, read: reads, action: vi.fn(), canEdit: true, canQuote: true })
    await flushAsyncPaste()
    expect(term.captured).toContain('Review fixture')
    expect(term.captured).toContain('\x1b[?1000h')
    // A click on the second full-width file row selects it; a drag never selects another file.
    press(term, '\x1b[<0;10;6M\x1b[<0;10;6m'); await flushAsyncPaste()
    expect(reads.mock.calls.at(-1)?.[0]).toBe(1)
    press(term, '\x1b[<0;3;5M\x1b[<32;12;5M\x1b[<0;12;5m'); await flushAsyncPaste()
    expect(reads.mock.calls.at(-1)?.[0]).toBe(1)
    press(term, '\x1b[27u') // clear the drag selection
    const prompt = tui.prompt({ title: 'Approval', question: 'Continue?', options: [{ label: 'Yes', value: 'yes' }], notify: false })
    press(term, '\r'); expect(await prompt).toBe('yes')
    await flushAsyncPaste()
    const mark = term.captured.length
    press(term, '\t\x1b[B')
    expect(term.captured.slice(mark)).toContain('content')
    press(term, '\x1b[27u'); await review
    press(term, '\r')
    expect(await input).toEqual({ text: 'draft', images: [] })
  } finally { abort.abort(); await tui.dispose() }
})

it('copies file-review text without switching files or disturbing native history', async () => {
  const term = new ScrollingTerminal(120, 24)
  const copy = vi.fn(async (_text: string) => {})
  const tui = new LocalTui(term, 'm', true, 'dark', copy)
  try {
    tui.applyStoredPrefs({ mouseInteraction: 'tui', copyOnSelect: false })
    const before = term.visible(), history = term.scrollback()
    const review = tui.reviewFiles({ title: 'Diff selection fixture', files: [{ path: 'a.ts', label: 'a.ts' }],
      signal: new AbortController().signal, read: async () => ({ source: { text: 'selectable-content\nsecond-line' } }), action: vi.fn(), canEdit: false, canQuote: false })
    await flushAsyncPaste()
    const row = term.visible().findIndex(line => line.includes('selectable-content'))
    const column = term.visible()[row]!.indexOf('selectable-content')
    press(term, `\x1b[<0;${column + 1};${row + 1}M\x1b[<32;${column + 18};${row + 1}M\x1b[<0;${column + 18};${row + 1}m`)
    expect(copy).not.toHaveBeenCalled()
    press(term, '\r'); await flushAsyncPaste()
    expect(copy).toHaveBeenCalledWith('selectable-content')
    expect(term.visible().join('\n')).toContain('Copied selection')
    press(term, '\x1b[27u')
    expect(term.visible().join('\n')).toContain('selectable-content')
    press(term, '\x1b[27u'); await review
    expect(term.visible()).toEqual(before)
    expect(term.scrollback()).toEqual(history)
  } finally { await tui.dispose() }
})

it.each([false, true])('restores browsing filters and selection across actions and catalog changes (colors=%s)', async colors => {
  const term = new ScrollingTerminal(55, 24), tui = new LocalTui(term, 'm', colors)
  const browse = createPromptBrowser(request => tui.prompt(request))
  const options = Array.from({ length: 30 }, (_, index) => ({ label: `model-${String(index).padStart(2, '0')}`, value: String(index) }))
  const request = { title: 'Models', question: '', filterable: true, allowCustom: false, notify: false, options,
    actions: [{ key: 'alt+f', label: 'Favorite', valuePrefix: 'favorite:' }] }
  try {
    press(term, 'unsent draft')
    const first = browse(request, 'models')
    press(term, 'model-1')
    await flushAsyncPaste()
    press(term, '\x1b[F')
    const before = term.visible()
    press(term, '\x1bf')
    expect(await first).toBe('favorite:19')
    const again = browse({ ...request }, 'models')
    expect(term.visible()).toEqual(before)
    press(term, '\r')
    expect(await again).toBe('19')
    const empty = browse({ ...request, title: 'Favorites', options: [] }, 'models')
    expect(term.visible().join('\n')).toContain('model-1')
    press(term, '\x03')
    expect(await empty).toBeNull()
    const all = browse({ ...request }, 'models')
    press(term, '\r')
    expect(await all).toBe('19')
    const changed = browse({ ...request, options: options.slice(0, 15) }, 'models')
    press(term, '\r')
    expect(await changed).toBe('10')
    const other = browse({ ...request }, 'other-list')
    expect(term.visible().join('\n')).toContain('type to filter')
    press(term, '\x03')
    await other
    expect(term.visible().join('\n')).toContain('unsent draft')
  } finally { tui.dispose() }
})


describe('structured question answers', () => {
  it.each([false, true])('keeps checked labels and supplementary text together (color=%s)', async color => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', color)
    try {
      const answer = tui.prompt({ title: 'Question', question: 'Choose', multiSelect: true, allowCustom: true, answerFormat: 'json',
        options: [{ label: 'Read, then write' }, { label: 'Test' }] })
      press(term, ' ')
      press(term, 'also check 中文, please')
      press(term, '\x1b[B\x07')
      press(term, '\r')
      expect(JSON.parse((await answer)!)).toEqual({ selected: ['Read, then write', 'Test'], custom: 'also check 中文, please' })
      const customOnly = tui.prompt({ title: 'Question', question: 'Choose', multiSelect: true, allowCustom: true, answerFormat: 'json', options: [{ label: 'Test' }] })
      press(term, 'something else\r')
      expect(JSON.parse((await customOnly)!)).toEqual({ selected: [], custom: 'something else' })
    } finally { tui.dispose() }
  })

  it('captures both parts before returning a navigation action and restores them', async () => {
    const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false), onAnswerDraft = vi.fn()
    try {
      const request = { title: 'Question', question: 'Choose', multiSelect: true, allowCustom: true, answerFormat: 'json' as const,
        options: [{ label: 'Read, then write' }], onAnswerDraft,
        actions: [{ key: 'alt+left', label: 'previous question', valuePrefix: '__back__', scope: 'list' as const }] }
      const pending = tui.prompt(request)
      press(term, ' ')
      press(term, 'draft text')
      press(term, '\x1b[1;3D')
      expect(await pending).toBe('__back__')
      expect(onAnswerDraft).toHaveBeenLastCalledWith({ selected: ['Read, then write'], custom: 'draft text' })
      const restored = tui.prompt({ ...request, initialValues: ['Read, then write'], initialInput: 'draft text' })
      press(term, '\r')
      expect(JSON.parse((await restored)!)).toEqual({ selected: ['Read, then write'], custom: 'draft text' })
    } finally { tui.dispose() }
  })
})


it('uses the durable shared message as delivery confirmation, never the Shell intent', async () => {
  const term = new FakeTerminal(), tui = new LocalTui(term, 'm', false)
  try {
    await tui.shellCommand({ command: 'echo captured', share: true, signal: new AbortController().signal, abort: () => {},
      run: async () => ({ output: 'captured' }) })
    expect(term.captured).toContain('captured')
    expect(term.captured).not.toContain('shared to conversation')
  } finally { tui.dispose() }
})
