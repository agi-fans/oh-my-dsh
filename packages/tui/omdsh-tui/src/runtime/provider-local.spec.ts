/**
 * LocalTui contract tests over a fake terminal: key routing (edit, history,
 * slash/tab autocomplete, Ctrl-R history search, PgUp/PgDn transcript
 * scroll, Ctrl-O tool expand, submit), double-Escape rewind, double Ctrl-C exit, Ctrl-D quit and the
 * cross-turn quit latch, plain-mode line input, and event rendering.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import { copyToClipboard } from '../input/clipboard.ts'
import { LocalTui, type TerminalLike } from './provider-local.ts'
import { HerdrAgentReporter, type HerdrRequest } from './herdr-agent.ts'
import { initialTranscript, renderView } from '../views/event-views.ts'
import { createHistorySearch } from '../views/history-search.ts'
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
  const tokens = output.match(/\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[?0-9;]*[ -/]*[@-~]|\r|\n|[^\x1b\r\n]+/gu) ?? []
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

/** Status-line workspace label: home-relative git root, matching LocalTui. */
function shortenedWorkspaceRoot(): string {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const home = homedir()
  if (root === home) return '~'
  if (root.startsWith(`${home}/`)) return `~${root.slice(home.length)}`
  return root
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
  constructor(readonly columns: number, readonly rows: number) {
    this.screen = Array.from({ length: rows }, () => '')
  }
  width(): number { return this.columns }
  height(): number { return this.rows }
  visible(): string[] { return this.screen.map(row => stripAnsi(row)) }
  scrollback(): string[] { return this.history.map(row => stripAnsi(row)) }
  #write(chunk: string): void {
    this.captured += chunk
    for (const token of chunk.match(/\x1b\[[?0-9;]*[ -/]*[@-~]|\r\n|\r|\n|[^\r\n\x1b]+/gu) ?? []) {
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

describe('LocalTui folds against a scrolling terminal', () => {
  it.each([false, true].flatMap(color => [false, true].map(browsing => ({ color, browsing }))))('does not recommit frozen prompts after a density shrink and later growth (color=$color, browsing=$browsing)', ({ color, browsing }) => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', color)
    try {
      tui.applyStoredPrefs({ theme: 'dark', colors: color, foldDensity: 'verbose' })
      longTurn(tui, 30, 1)
      expect(term.scrollback().filter(row => row.includes('map the project 1'))).toHaveLength(1)
      const frozen = term.scrollback()
      if (browsing) press(term as never, '\x1b[5~')
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

  it.each([false, true].flatMap(color => (['trajectory', 'agentHub', 'settings', 'fullscreen-list', 'plan-review'] as const).map(surface => ({ color, surface }))))(
    'restores the inspected run after closing $surface (color=$color)', async ({ surface, color }) => {
      const term = new ScrollingTerminal(80, 20)
      const tui = new LocalTui(term, 'm', color)
      try {
        const input = tui.readInput()
        if (surface === 'trajectory') tui.setCommands([{ name: 'trajectory', description: 'Inspect session trajectory' }])
        if (surface === 'agentHub') tui.setSubagents({ agents: [{ id: 'child', label: 'Review', depth: 1, phase: 'running', activity: [] }] })
        longTurn(tui, 30, 30)
        press(term, '\x0f')
        press(term, '\x1b[5~')
        const screen = term.visible()
        const history = term.scrollback()
        const mark = term.captured.length
        let answer: Promise<unknown> | undefined
        if (surface === 'trajectory') {
          press(term, '/trajectory\r')
          expect(await input).toEqual({ text: '/trajectory', images: [] })
          tui.openTrajectory([])
        }
        else if (surface === 'agentHub') press(term, '\x1ba')
        else if (surface === 'settings') press(term, '/settings\r')
        else answer = tui.prompt({
          title: 'Choose', question: 'Continue?', presentation: surface,
          detail: '# Plan\n\n- Read the project',
          options: [{ label: 'Approve' }, { label: 'Cancel' }], allowCustom: false,
          ...(surface === 'plan-review' ? { approveValue: 'Approve' } : {}),
        })
        expect(term.visible()).not.toEqual(screen)
        expect(term.captured.slice(mark)).toContain('\x1b[?1000l')
        const restore = term.captured.length
        press(term, '\x1b[27u')
        if (answer !== undefined) expect(await answer).toBeNull()
        expect(term.visible()).toEqual(screen)
        expect(term.scrollback()).toEqual(history)
        expect(term.captured.slice(restore)).toContain('\x1b[?1000h')
        // The restored frame must still accept wheel input, not only look right.
        press(term, '\x1b[<64;5;5M')
        expect(term.visible()).not.toEqual(screen)
        press(term, '\x0f')
        expect(term.captured).toContain('\x1b[?1000l')
      } finally { tui.dispose() }
    },
  )

  it.each([false, true])('keeps background output in inspection and reveals requested command output (color=%s)', (color) => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', color)
    try {
      longTurn(tui, 30, 40)
      press(term, '\x0f\x1b[5~')
      const content = () => term.visible().filter(line => line.includes('"path"') || line.includes('Step '))
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
      expect(term.captured.slice(mark)).toContain('\x1b[?1000l')
      expect(term.scrollback().slice(0, history.length)).toEqual(history)
    } finally { tui.dispose() }
  })

  it('opens a long finished run at its newest work and lets the reader scroll upwards', () => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 30, 30)
    const history = term.scrollback()
    press(term as never, '\x0f')

    const opened = term.visible().join('\n')
    expect(opened).toContain('src/c30b.ts')
    expect(opened).not.toContain('src/c1a.ts')
    press(term as never, '\x1b[5~')
    expect(term.visible().join('\n')).toContain('src/c29b.ts')
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

  it('opens a long tool result at its last lines and returns to the folded view after wheel browsing', () => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false)
    tui.event(ev('tool/call', { callId: 'long-result', name: 'bash', arguments: '{}' }, 1))
    tui.event(ev('tool/result', {
      message: { role: 'tool', toolCallId: 'long-result', content: [{
        type: 'text', text: Array.from({ length: 60 }, (_, i) => `result line ${i}`).join('\n'),
      }] },
    }, 2))
    const screen = term.visible()
    const history = term.scrollback()
    press(term as never, '\x0f')
    expect(term.visible().join('\n')).toContain('result line 59')
    expect(term.visible().join('\n')).not.toContain('result line 0')
    press(term as never, '\x1b[<64;10')
    press(term as never, ';5M'.concat('\x1b[<64;10;5M'.repeat(30)))
    expect(term.visible().join('\n')).toContain('Into the Unknown')
    press(term as never, '\x1b[<65;10;5M'.repeat(4))
    expect(term.visible().join('\n')).toContain('result line 0')
    press(term as never, '\x1b[<65;10;5M'.repeat(40))
    expect(term.visible()).toEqual(screen)
    expect(term.scrollback()).toEqual(history)
    tui.dispose()
  })

  it('opens a long thought at its latest paragraph', () => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false)
    tui.event(ev('assistant/message', {
      turn: 1, step: 1, message: { role: 'assistant', content: [
        { type: 'reasoning', text: Array.from({ length: 40 }, (_, i) => `Reasoning paragraph ${i}.`).join('\n\n') },
        { type: 'text', text: 'A short answer.' },
      ] },
    }, 1))
    press(term as never, '\x0f')
    expect(term.visible().join('\n')).toContain('Reasoning paragraph 39.')
    expect(term.visible().join('\n')).not.toContain('Reasoning paragraph 0.')
    tui.dispose()
  })

  it('opens a call inside a live turn and returns to the turn as it was', () => {
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
    expect(screen.join('\n')).toContain('∴ Thought · Still going.')
    press(term as never, '\x0f')
    expect(term.visible().join('\n')).toMatch(/╭─── ✔ read/u)
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

    expect(all.filter(row => /^▸ Worked for/u.test(row))).toHaveLength(1)
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

    expect(screen).toMatch(/^▾ Worked for/mu)
    expect(screen).toContain('src/t2c3b.ts')
    // The previous turn remains folded; only this turn's calls read in full.
    expect(screen).toMatch(/╭─── [✔✘⟳•]/u)
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
    expect(term.visible().join('\n')).toContain('src/c12b.ts')
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

  it('renders the package version in the welcome title', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as { version: string }
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)

    expect(stripAnsi(term.captured)).toContain(`omdsh v${manifest.version}`)
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

  it('renders typed input inside the rounded editor', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', true)
    press(term, 'ab')
    expect(term.captured).toContain('ab')
    expect(term.captured).toContain('╰─')
    expect(term.raw).toBe(true)
    tui.dispose()
  })

  it('clears the screen before the first frame in tty mode', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    expect(term.captured).toContain('\x1b[2J\x1b[H')
    tui.dispose()
  })

  it('does not emit any mouse mode sequence from startup through disposal', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.dispose()
    expect(term.captured).not.toContain('\x1b[?1000h')
    expect(term.captured).not.toContain('\x1b[?1006h')
    expect(term.captured).not.toContain('\x1b[?1000l')
    expect(term.captured).not.toContain('\x1b[?1006l')
    expect(term.captured).toContain('\x1b[?2004l')
    expect(term.raw).toBe(false)
    expect(term.destroyed).toBe(true)
  })

  it('keeps mouse scrolling with the terminal while browsing a folded transcript with PgUp', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 12, 30)
    press(term, '\x1b[5~')
    expect(term.captured).not.toContain('\x1b[?1000h')
    const mark = term.captured.length
    press(term, '\x1b[<64;10;5M\x1b[<65;10;5M')
    expect(term.captured.length).toBe(mark)
    tui.dispose()
  })

  it.each(['close', 'tail', 'clear', 'dispose'])('restores native mouse scrolling after leaving an inspection via %s', (exit) => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    longTurn(tui, 30, 1)
    expect(term.captured).not.toContain('\x1b[?1000h')
    press(term, '\x0f')
    expect(term.captured).toContain('\x1b[?1000h\x1b[?1006h')
    const mark = term.captured.length
    if (exit === 'close') press(term, '\x0f')
    else if (exit === 'tail') press(term, '\x1b[6~'.repeat(6))
    else if (exit === 'clear') press(term, '/clear\r')
    else tui.dispose()
    expect(term.captured.slice(mark)).toContain('\x1b[?1000l\x1b[?1006l')
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
    vi.stubEnv('VISUAL', '')
    try {
      press(term, '\x18')
      expect(modesAtHandoff).toContain('\x1b[?1000l\x1b[?1006l')
      expect(term.raw).toBe(true)
      expect(term.captured.slice(modesAtHandoff.length)).toContain('\x1b[?1000h\x1b[?1006h')
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
      expect(modesAtSuspend).toContain('\x1b[?1000l\x1b[?1006l')
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
    expect(repaint).toContain('\x1b[2J\x1b[H')
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
    expect(term.captured).toContain('╰─')
    tui.dispose()
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

  it('filters a full-screen prompt and returns the hidden option value', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const answer = tui.prompt({
      title: 'Resume Session',
      question: '',
      presentation: 'fullscreen-list',
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
    expect(stripAnsi(term.captured)).toContain('enter run')
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
    expect(stripAnsi(term.captured)).toContain('│ Queued · typed during turn')
    expect(stripAnsi(term.captured)).toContain('↑ edit')
    const next = tui.readline()
    expect(await next).toBe('typed during turn')
    tui.dispose()
  })

  it('restores the newest queued line into an empty composer with up arrow', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    press(term, 'first queued\rsecond queued\r')
    expect(stripAnsi(term.captured)).toContain('Queued · 2')
    press(term, '\x1b[A')
    const restored = stripAnsi(term.captured)
    expect(restored).toContain('│ Queued · first queued')
    expect(restored).toContain('second queued')
    const next = tui.readline()
    expect(await next).toBe('first queued')
    tui.dispose()
  })

  it('walks backward through queued lines with repeated up arrows without reordering them', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    press(term, 'first queued\rsecond queued\rthird queued\r')

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
    expect(term.captured).toContain('╰─')
    tui.dispose()
  })

  it('clears the line on idle Ctrl-C without interrupting', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    let fired = 0
    tui.onInterrupt(() => { fired += 1 })
    press(term, 'abc\x03')
    expect(fired).toBe(0)
    expect(term.captured).toContain('╰─')
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

  it('blocks composer input while compacting instead of queueing it', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    let interrupted = 0
    tui.onInterrupt(() => { interrupted += 1 })
    tui.event(ev('command/run', {
      commandId: 'cmd-compact-1',
      name: 'compact',
      source: { kind: 'user' },
    }, 1))

    press(term, 'must not queue\r')
    expect(stripAnsi(term.captured)).toContain('Compacting')
    press(term, '\x03')
    expect(interrupted).toBe(1)

    tui.event(ev('command/done', {
      commandId: 'cmd-compact-1',
      kind: 'success',
    }, 2))
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
    const statusRow = rows.findIndex(line => line.includes(shortenedWorkspaceRoot()))
    const resumeRow = rows.findIndex(line => line.includes('Resume this session with omdsh --resume'))
    expect(statusRow).toBeGreaterThanOrEqual(0)
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
      terminalProgress: false,
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

  it('mirrors busy state to opt-in native terminal progress and clears it', async () => {
    vi.useFakeTimers()
    try {
      const term = new FakeTerminal()
      const tui = new LocalTui(term, 'm', false)
      tui.applyStoredPrefs({
        theme: 'dark',
        colors: false,
        motion: 'off',
        terminalProgress: true,
        expandTools: false,
      })
      tui.event(ev('turn/start', { turn: 1 }, 1))
      expect(term.captured.match(/\x1b\]9;4;3\x07/gu)).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(term.captured.match(/\x1b\]9;4;3\x07/gu)).toHaveLength(2)
      tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 2))
      expect(term.captured).toContain('\x1b]9;4;0;\x07')
      tui.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the durable turn ending reason in terminal notifications', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.applyStoredPrefs({
      theme: 'dark',
      colors: false,
      motion: 'off',
      terminalProgress: false,
      expandTools: false,
      notifications: 'always',
      notificationThreshold: '30s',
    })
    tui.event(ev('turn/start', { turn: 1 }, 1))
    tui.event(ev('turn/end', { turn: 1, reason: { kind: 'max-tokens' } }, 2))

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
    tui.setStatus('idle')
    expect(recorder.requests.at(-1)?.params).toMatchObject({ state: 'idle', agent_session_id: 'herdr-session' })

    tui.dispose()
    expect(recorder.requests.at(-1)?.method).toBe('pane.release_agent')
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

  it('inserts a newline with alt+enter and submits the multiline buffer', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, 'one')
    press(term, '\x1b\r')
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
      text: '[Image #1, 1x1] describe this',
      images: [{ data: PNG_1X1, mediaType: 'image/png', name: 'clipboard.png', width: 1, height: 1 }],
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
      text: '[Image #1, 1x1]',
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
      text: '[Image #1, 1x1]',
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
    await expect(pending).resolves.toMatchObject({ text: '[Image #1, 1x1]' })
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
    await expect(pending).resolves.toMatchObject({ text: '[Image #1, 1x1]' })
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
      text: '[Image #1, 1x1]\n[Image #2, 1x1]',
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
      text: '[Image #1, 1x1] /goal implement auth',
      images: [{ mediaType: 'image/png' }],
    })
    tui.restoreInput(submitted as NonNullable<typeof submitted>)
    const restored = tui.readInput()
    press(term, '\r')
    await expect(restored).resolves.toMatchObject({
      text: '[Image #1, 1x1] /goal implement auth',
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
      text: '/plan the migration [Image #1, 1x1]',
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
      text: '/goal [Image #1, 1x1] implement auth',
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

  it('suggests /copy arguments and completes the selected kind', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    press(term, '/copy c')
    expect(term.captured).toContain('code')
    expect(term.captured).toContain('cmd')
    press(term, '\t')
    expect(term.captured).toContain('/copy code ')
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

  it('copies the last assistant reply on /copy', async () => {
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
    press(term, '/copy text\r')
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(copied).toEqual(['hello from the model'])
    expect(term.captured).toContain('Copied assistant text')
    press(term, 'ok\r')
    expect(await pending).toBe('ok')
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
    expect(term.captured).toContain('hello from the model')
    expect(term.captured).toContain('enter copy')
    expect(copied).toEqual([])
    press(term, '\r')
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(copied).toEqual(['hello from the model'])
    expect(term.captured).toContain('Copied last message')
    press(term, 'ok\r')
    expect(await pending).toBe('ok')
    tui.dispose()
  })

  it('reports nothing to copy and rejects unknown /copy args', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', async () => { throw new Error('unused') })
    const pending = tui.readline()
    press(term, '/copy\r')
    expect(term.captured).toContain('Nothing to copy.')
    press(term, '/copy nope\r')
    expect(term.captured).toContain('Usage: /copy [code|cmd]')
    press(term, 'ok\r')
    expect(await pending).toBe('ok')
    tui.dispose()
  })

  it('opens long command catalogs at their heading instead of their tail', () => {
    const cases = [
      {
        command: '/help\r',
        heading: 'Commands · 30 core',
        prepare: (tui: LocalTui): void => {
          tui.setCommands(Array.from({ length: 24 }, (_, index) => ({
            name: `runtime-${index}`,
            description: `Runtime command ${index} with a deliberately descriptive explanation`,
          })))
        },
      },
      {
        command: '/tools\r',
        heading: 'Available Tools',
        prepare: (tui: LocalTui): void => {
          tui.setTools(Array.from({ length: 24 }, (_, index) => ({
            name: `tool-${index}`,
            description: `Tool ${index} performs a concrete operation for the active agent`,
          })))
        },
      },
    ]

    for (const entry of cases) {
      const term = new FakeTerminal()
      const tui = new LocalTui(term, 'm', false)
      entry.prepare(tui)
      const before = term.captured.length
      press(term, entry.command)
      expect(stripAnsi(term.captured.slice(before))).toContain(entry.heading)
      tui.dispose()
    }
  })

  it('treats /exit as quit', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, '/exit\r')
    expect(await pending).toBe(null)
    tui.dispose()
  })

  it('lists agent tools on /tools after setTools', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, '/tools\r')
    expect(term.captured).toContain('Available Tools')
    expect(term.captured).toContain('0 active')
    expect(term.captured).toContain('No tools are currently visible to the agent.')
    tui.setTools([
      { name: 'bash', description: 'Run a shell command and return its complete output with COMPLETE_TAIL metadata for diagnostics.' },
      { name: 'fs', description: '' },
    ])
    press(term, '/tools\r')
    expect(term.captured).toContain('2 active')
    expect(term.captured).toContain('Tool')
    expect(term.captured).toContain('Description')
    expect(term.captured).toContain('bash')
    expect(term.captured).toContain('Run a shell command')
    expect(term.captured).toContain('Descriptions shortened')
    expect(term.captured).not.toContain('COMPLETE_TAIL')
    expect(term.captured).toContain('No description provided.')
    press(term, '\x0f')
    expect(term.captured).toContain('COMPLETE_TAIL')
    expect(term.captured).toContain('Collapse descriptions')
    press(term, 'ok\r')
    expect(await pending).toBe('ok')
    tui.dispose()
  })

  it('runs /help locally and keeps readline pending', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, '/help\r')
    expect(term.captured).toContain('/settings, /set')
    expect(term.captured).toContain('Essential Shortcuts')
    expect(term.captured).toContain('/help [full]')
    press(term, '/help full\r')
    for (let index = 0; index < 12; index += 1) press(term, '\x1b[6~')
    expect(term.captured).toContain('Keyboard Shortcuts')
    expect(term.captured).toContain('Navigation')
    expect(term.captured).not.toContain('/hotkeys')
    press(term, 'hi\r')
    expect(await pending).toBe('hi')
    tui.dispose()
  })

  it('submits a namespaced skill command from the flat command catalog', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.setCommands([{ name: 'skill:code-review', description: 'Review a change for correctness' }])
    const pending = tui.readline()
    press(term, '/skill:code-review focus on auth\r')
    expect(await pending).toBe('/skill:code-review focus on auth')
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

  it('opens the settings overlay on /settings and cycles theme', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, '/settings\r')
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
    expect(term.captured).toContain('Color palette')
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

  it('persists theme changes made in the settings overlay', async () => {
    const persisted: Array<{ theme: string; colors: boolean }> = []
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.setPrefsPersist((prefs) => { persisted.push(prefs) })
    const pending = tui.readline()
    press(term, '/settings\r')
    press(term, '\r')
    expect(persisted).toEqual([{
      theme: 'light',
      colors: false,
      motion: 'full',
      terminalProgress: false,
      foldDensity: 'standard',
      checkUpdates: true,
      startupChangelog: 'summary',
      notifications: 'off',
      notificationThreshold: '30s',
      statusBar: {
        enabled: true,
        labels: 'compact',
        groups: ['context', 'cache', 'tokens', 'speed', 'durations', 'counts'],
        order: ['context', 'cache', 'tokens', 'speed', 'durations', 'counts'],
        meta: ['model', 'effort', 'path', 'git'],
        metaOrder: ['model', 'effort', 'path', 'git', 'session'],
        colors: {
          model: 'default',
          effort: 'default',
          path: 'default',
          git: 'default',
          session: 'default',
          metrics: 'default',
          context: 'default',
          cache: 'default',
          tokens: 'default',
          speed: 'default',
          durations: 'default',
          counts: 'default',
        },
        sides: {
          model: 'left',
          effort: 'left',
          path: 'right',
          git: 'right',
          session: 'left',
          context: 'left',
          cache: 'left',
          tokens: 'left',
          speed: 'left',
          durations: 'right',
          counts: 'right',
        },
      },
    }])
    press(term, '\x03')
    tui.applyStoredPrefs({ theme: 'dark', colors: true, expandTools: false })
    expect(term.captured).not.toContain('Theme: dark')
    press(term, 'ok\r')
    expect(await pending).toBe('ok')
    tui.dispose()
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

      expect(term.captured).toContain('\x1b[38;2;252;58;75mprobe')
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
      press(term, '/settings\r')
      press(term, '\x1b[B')
      // Dark accent is #febc38; a colorless session emits no SGR at all.
      expect(term.captured).not.toContain('\x1b[38;2;254;188;56m')

      // Row 1 is `Colors`; toggling it applies immediately, without a restart.
      press(term, '\r')
      expect(term.captured).toContain('\x1b[38;2;254;188;56m')
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
      expect(term.captured).not.toContain('\x1b[38;2;252;58;75m')
      expect(term.captured).not.toContain('\x1b[31m')

      tui.applyStoredPrefs({ theme: 'dark', colors: true, expandTools: false })
      tui.notice('colorful', { level: 'error' })

      // Dark `error` is #fc3a4b, so 16-color fallback would emit `31` instead.
      expect(term.captured).toContain('\x1b[38;2;252;58;75mcolorful')
      expect(term.captured).not.toContain('\x1b[31m')
      tui.dispose()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('mirrors the folded session title into the terminal window title', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
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
    press(term, '\t')
    expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).toContain('● Agent')
    press(term, '\x1b[C')
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
    press(term, '\t')
    press(term, '\x1b[C')
    expect(emulatedScreenRows(term.captured).map(stripAnsi).join('\n')).toContain('Simplified Chinese')
    await flushAsyncPaste()
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

  it('summarizes a streamed tool call on one line for a pending decision', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.event(ev('tool/call', { callId: 'call-9', name: 'bash', arguments: '{"command":"rm -rf build"}' }, 1))

    const summary = tui.toolCallContext('call-9')
    expect(summary).toContain('rm -rf build')
    // The approval prompt renders its detail on a single row.
    expect(summary).not.toContain('\n')
    expect(tui.toolCallContext('never-streamed')).toBeUndefined()
    tui.dispose()
  })

  it('carries a legacy expandTools document into the density that says the same thing', () => {
    const term = new FakeTerminal()
    term.height = () => 80
    const tui = new LocalTui(term, 'm', false)
    // A document written before the density existed: no foldDensity at all, and
    // a reader who had asked for expanded tool output. The rung that now means
    // that is `verbose`, so their transcript keeps the shape they chose.
    tui.applyStoredPrefs({ theme: 'dark', colors: false, expandTools: true })
    expect(tui.prefs().foldDensity).toBe('verbose')
    const output = Array.from({ length: 14 }, (_, i) => 'tool-line-' + i).join('\n')
    tui.event(ev('tool/call', { callId: 'call-1', name: 'bash', arguments: '{}' }, 1))
    tui.event(ev('tool/result', {
      message: { role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: output }] },
    }, 2))
    expect(term.captured).toContain('tool-line-13')
    expect(term.captured).not.toContain('Ctrl+O: Expand')
    tui.dispose()
  })

  it('prefers an explicit density over a leftover expandTools flag', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    tui.applyStoredPrefs({ theme: 'dark', colors: false, expandTools: true, foldDensity: 'compact' })
    expect(tui.prefs().foldDensity).toBe('compact')
    tui.dispose()
  })

  it('repaints the transcript when the reader picks another density', () => {
    const term = new FakeTerminal()
    term.height = () => 80
    const tui = new LocalTui(term, 'm', false)
    const output = Array.from({ length: 14 }, (_, i) => 'tool-line-' + i).join('\n')
    tui.event(ev('tool/call', { callId: 'call-1', name: 'bash', arguments: '{}' }, 1))
    tui.event(ev('tool/result', {
      message: { role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: output }] },
    }, 2))
    expect(term.captured).toContain('Run command')
    expect(term.captured).not.toContain('tool-line-0')
    // The density is a resting shape, so the same settled call has to repaint
    // the moment the reader asks for a different one — with no keystroke.
    tui.applyStoredPrefs({ theme: 'dark', colors: false, foldDensity: 'verbose' })
    expect(term.captured).toContain('tool-line-0')
    expect(term.captured).toContain('tool-line-13')
    const afterVerbose = term.captured.length
    tui.applyStoredPrefs({ theme: 'dark', colors: false, foldDensity: 'compact' })
    expect(term.captured.slice(afterVerbose)).toContain('Run command')
    expect(term.captured.slice(afterVerbose)).not.toContain('tool-line-13')
    tui.dispose()
  })

  it('keeps a call the reader opened open across a density change', () => {
    const term = new FakeTerminal()
    term.height = () => 80
    const tui = new LocalTui(term, 'm', false)
    const output = Array.from({ length: 14 }, (_, i) => 'tool-line-' + i).join('\n')
    tui.event(ev('tool/call', { callId: 'call-1', name: 'bash', arguments: '{}' }, 1))
    tui.event(ev('tool/result', {
      message: { role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: output }] },
    }, 2))
    press(term, '\x0f')
    expect(term.captured).toContain('tool-line-0')
    // An opening the reader made on purpose is not an artifact of the rung they
    // happened to be on, so choosing another density must not take it away.
    tui.applyStoredPrefs({ theme: 'dark', colors: false, foldDensity: 'compact' })
    expect(tui.prefs().foldDensity).toBe('compact')
    expect(term.captured).toContain('tool-line-0')
    tui.dispose()
  })

  it('clears the open-everything override when the density changes under it', () => {
    const term = new FakeTerminal()
    term.height = () => 40
    const tui = new LocalTui(term, 'm', false)
    tui.applyStoredPrefs({ theme: 'dark', colors: false, foldDensity: 'compact' })
    for (let i = 0; i < 10; i += 1) {
      tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'mark-' + i }] }, i * 10))
      tui.event(ev('tool/call', { callId: `call-${i}`, name: 'bash', arguments: '{}' }, i * 10 + 1))
      tui.event(ev('tool/result', {
        message: { role: 'tool', toolCallId: `call-${i}`, content: [{ type: 'text', text: `payload-${i}` }] },
      }, i * 10 + 2))
    }
    // Above every call there is nothing this key can open one at a time, so it
    // falls through to opening everything — and every payload showing up at
    // once is what tells the two paths apart.
    for (let i = 0; i < 5; i += 1) press(term, '\x1b[5~')
    const beforeExpand = term.captured.length
    press(term, '\x0f')
    const opened = term.captured.slice(beforeExpand)
    // Several calls opening in one press is what tells the fallthrough apart
    // from the per-call toggle; the newest one is off-window and stays unseen.
    expect(opened).toContain('payload-0')
    expect(opened).toContain('payload-1')
    // Leaving the override set would pin the previous rung's answer and read as
    // a setting that does nothing. The screen has to be read, not the emitted
    // delta: rows that did not change are not re-emitted, so an unchanged
    // expanded box is invisible in the delta and obvious on the screen.
    tui.applyStoredPrefs({ theme: 'dark', colors: false, foldDensity: 'standard' })
    // The frame is the unambiguous marker: a folded call is one unframed row,
    // an expanded one is a box. The payload text cannot stand in for it because
    // a folded row can carry the output's first line as its own fact.
    const screen = emulatedScreenRows(term.captured).map(stripAnsi).join('\n')
    expect(screen).toContain('Run command')
    expect(screen).not.toContain('╭─── ✔ bash')
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
    expect(screen.match(/^▸ /gmu)).toHaveLength(1)
    expect(screen).not.toContain('bash-1')
    // With no turn running, a notice speaks to the reader and stays visible.
    expect(screen).toContain('bash-2')
    tui.dispose()
  })

  it('folds a settled call to a row and toggles its output on ctrl+o', () => {
    const term = new FakeTerminal()
    term.height = () => 80
    const tui = new LocalTui(term, 'm', false)
    const output = Array.from({ length: 14 }, (_, i) => 'tool-line-' + i).join('\n')
    tui.event(ev('tool/call', { callId: 'call-1', name: 'bash', arguments: '{}' }, 1))
    tui.event(ev('tool/result', {
      message: { role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: output }] },
    }, 2))
    expect(term.captured).toContain('Run command')
    expect(term.captured).not.toContain('tool-line-0')
    const beforeExpand = term.captured.length
    press(term, '\x0f')
    expect(term.captured).toContain('tool-line-0')
    expect(term.captured).toContain('tool-line-13')
    const afterExpand = term.captured.length
    press(term, '\x0f')
    expect(term.captured.slice(afterExpand)).not.toContain('tool-line-13')
    expect(term.captured.slice(afterExpand)).toContain('Run command')
    expect(beforeExpand).toBeGreaterThan(0)
    tui.dispose()
  })

  it('expands the call under the viewport, not the newest one, after scrolling back', () => {
    const term = new FakeTerminal()
    term.height = () => 40
    const tui = new LocalTui(term, 'm', false)
    for (let i = 0; i < 10; i += 1) {
      tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'mark-' + i }] }, i * 10))
      tui.event(ev('tool/call', { callId: `call-${i}`, name: 'bash', arguments: '{}' }, i * 10 + 1))
      tui.event(ev('tool/result', {
        message: { role: 'tool', toolCallId: `call-${i}`, content: [{ type: 'text', text: `payload-${i}` }] },
      }, i * 10 + 2))
    }
    // A folded row has to stay reachable after the reader scrolls away from the
    // tail. Expanding only the newest call would change rows above the window
    // and leave the screen looking untouched, so this asserts that the press
    // repaints something the reader can actually see.
    press(term, '\x1b[5~')
    const beforeExpand = term.captured.length
    press(term, '\x0f')
    expect(term.captured.slice(beforeExpand)).toMatch(/payload-[0-9]/u)
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
        { type: 'reasoning', text: 'first thought paragraph\n\nsecond thought paragraph with detail' },
      ] },
    }, 3))
    tui.event(ev('tool/call', { turn: 1, step: 1, callId: 'thought-read', name: 'read', arguments: '{"path":"src/file.ts"}' }, 4))
    tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: 'thought-read', content: [{ type: 'text', text: 'payload first line\nfull tool detail' }] } }, 5))
    tui.event(ev('assistant/message', { turn: 1, step: 2, message: { role: 'assistant', content: [
      { type: 'reasoning', text: 'answer thought start\n\nanswer thought detail' },
      { type: 'text', text: 'all done' },
    ] } }, 6))
    tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 7))
    tui.setStatus('idle')
    expect(term.visible().join('\n')).not.toContain('second thought paragraph with detail')
    const history = term.scrollback()
    press(term, '\x0f')
    expect(term.visible().join('\n')).toContain('second thought paragraph with detail')
    expect(term.visible().join('\n')).toContain('full tool detail')
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
    press(term, '\x0f')
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
    expect(term.captured).toContain('Ran commands')
    expect(term.captured).not.toContain('cmd-1')
    const beforeOpen = term.captured.length
    press(term, '\x0f')
    const opened = term.captured.slice(beforeOpen)
    expect(opened).toMatch(/cmd-[0-2]/u)
    const beforeClose = term.captured.length
    press(term, '\x0f')
    expect(term.captured.slice(beforeClose)).not.toMatch(/cmd-[0-2]/u)
    tui.dispose()
  })

  it('does not render background activity, but keeps its details available in the Agent Hub', () => {
    vi.useFakeTimers()
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    try {
      const agent = { id: 'child', depth: 1, label: 'Worker', phase: 'running' as const, activity: [] }
      tui.setSubagents({ agents: [agent] })
      vi.advanceTimersByTime(8)
      const width = vi.spyOn(term, 'width')
      for (let index = 0; index < 120; index += 1) {
        tui.setSubagents({ agents: [{ ...agent, activity: [{ text: `read file-${index}`, status: 'running' }] }] })
      }
      vi.advanceTimersByTime(8)
      expect(width.mock.calls.length).toBe(0)
      expect(term.captured).not.toContain('read file-')
      press(term, '\x1ba')
      press(term, '\t')
      expect(term.captured).toContain('read file-119')
      width.mockClear()
      tui.setSubagents({ agents: [{ ...agent, activity: [{ text: 'read next-file', status: 'running' }] }] })
      vi.advanceTimersByTime(8)
      expect(width.mock.calls.length).toBeGreaterThan(0)
      expect(term.captured).toContain('read next-file')
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
      expect(term.captured).toContain('Worker · Waiting')
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

  it('focuses the task launcher with down and activates an agent through the hub', async () => {
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
    expect(term.captured).toContain('Enter open · Esc return')
    press(term, '\r')
    expect(term.captured).toContain('Agent Hub')
    expect(term.captured).toContain('Enter transcript · Tab inspector')
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
