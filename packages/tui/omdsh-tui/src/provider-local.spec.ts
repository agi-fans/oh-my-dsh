/**
 * LocalTui contract tests over a fake terminal: key routing (edit, history,
 * slash/tab autocomplete, Ctrl-R history search, PgUp/PgDn transcript
 * scroll, Ctrl-O tool expand, submit), double Ctrl-C exit, Ctrl-D quit and the
 * cross-turn quit latch, plain-mode line input, and event rendering.
 */
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { copyToClipboard } from './clipboard.ts'
import { LocalTui, type TerminalLike } from './provider-local.ts'
import { initialTranscript, renderView } from './event-views.ts'
import { SETTINGS_ITEM_ROW } from './settings-list.ts'
import { createHistorySearch } from './history-search.ts'
import type { DirEntry } from './path-complete.ts'
import { stripAnsi } from './width.ts'

class FakeTerminal implements TerminalLike {
  captured = ''
  writes = 0
  raw = false
  destroyed = false
  output = {
    isTTY: true,
    write: (chunk: string): void => { this.writes += 1; this.captured += chunk },
  }
  input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (on: boolean): void => { this.raw = on },
    destroy: (): void => { this.destroyed = true },
  })
  width(): number { return 60 }
  height(): number { return 24 }
}

function ev(type: string, data: unknown, seq: number): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

const press = (term: FakeTerminal, bytes: string): void => {
  term.input.write(bytes)
}

describe('LocalTui (tty)', () => {
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
    expect(term.captured).toContain('\x1b[?1000h')
    expect(term.captured).toContain('\x1b[?1006h')
    tui.dispose()
  })

  it('disables mouse tracking on dispose', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const before = term.captured.length
    tui.dispose()
    expect(term.captured.slice(before)).toContain('\x1b[?1000l')
    expect(term.captured.slice(before)).toContain('\x1b[?1006l')
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
    press(term, '\x1b[B\r')
    expect(await answer).toBe('research')
    tui.dispose()
  })

  it('queues a line submitted while a turn is running', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    // No readline in flight — the runner is busy driving a turn.
    press(term, 'typed during turn\r')
    const next = tui.readline()
    expect(await next).toBe('typed during turn')
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
    expect(term.captured).toContain('/hotkeys')
    expect(term.captured).toContain('/copy')
    expect(term.captured).toContain('1/8')
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
    const listing = (dir: string): readonly DirEntry[] | undefined => {
      if (dir === '/proj') {
        return [
          { name: 'src', directory: true },
          { name: 'README.md', directory: false },
        ]
      }
      if (dir === '/proj/src') return [{ name: 'index.ts', directory: false }]
      return undefined
    }
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false, 'dark', copyToClipboard, {
      cwd: '/proj',
      home: '/home/me',
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

  it('runs /hotkeys locally and keeps readline pending', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, '/hotkeys\r')
    expect(term.captured).toContain('Ctrl+R')
    expect(term.captured).toContain('Search prompt history')
    expect(term.captured).toContain('/hotkeys')
    press(term, 'hi\r')
    expect(await pending).toBe('hi')
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

  it('lists cwd and model on /pwd', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, '/pwd\r')
    expect(term.captured).toContain('Workspace')
    expect(term.captured).toContain('cwd: ' + process.cwd())
    expect(term.captured).toContain('model: m')
    press(term, '/dirs\r')
    expect(term.captured).toContain('Workspace')
    press(term, 'ok\r')
    expect(await pending).toBe('ok')
    tui.dispose()
  })

  it('runs /help locally and keeps readline pending', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, '/help\r')
    expect(term.captured).toContain('/help / /h / /?')
    expect(term.captured).toContain('├')
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
      expandTools: false,
      statusBar: {
        enabled: true,
        labels: 'compact',
        groups: ['context', 'cache', 'tokens', 'speed', 'durations', 'counts'],
        order: ['context', 'cache', 'tokens', 'speed', 'durations', 'counts'],
      },
    }])
    press(term, '\x03')
    tui.applyStoredPrefs({ theme: 'dark', colors: true, expandTools: false })
    expect(term.captured).not.toContain('Theme: dark')
    press(term, 'ok\r')
    expect(await pending).toBe('ok')
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

  it('inserts a history match when its result row is clicked', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const first = tui.readline()
    press(term, 'unique zebra\r')
    await first
    const pending = tui.readline()
    press(term, '\x12')
    const layout = renderView(initialTranscript(), {
      width: term.width(),
      height: term.height(),
      model: 'm',
      input: '',
      inputCursor: 0,
      colors: false,
      historySearch: createHistorySearch(['unique zebra']),
    })
    const start = layout.overlay?.start
    const resultsRow = layout.overlay?.resultsRow
    expect(start).toBeDefined()
    expect(resultsRow).toBeDefined()
    press(term, `\x1b[<0;1;${(start ?? 0) + (resultsRow ?? 0) + 1}M`)
    press(term, '\r')
    expect(await pending).toBe('unique zebra')
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
    expect(term.captured).toContain('earlier')
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

  it('expands tool output when expandTools pref is on', () => {
    const term = new FakeTerminal()
    term.height = () => 80
    const tui = new LocalTui(term, 'm', false)
    tui.applyStoredPrefs({ theme: 'dark', colors: false, expandTools: true })
    const output = Array.from({ length: 14 }, (_, i) => 'tool-line-' + i).join('\n')
    tui.event(ev('tool/call', { callId: 'call-1', name: 'bash', arguments: '{}' }, 1))
    tui.event(ev('tool/result', {
      message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: output }] }] },
    }, 2))
    expect(term.captured).toContain('tool-line-13')
    expect(term.captured).not.toContain('Ctrl+O: Expand')
    tui.dispose()
  })

  it('toggles truncated tool output on ctrl+o', () => {
    const term = new FakeTerminal()
    term.height = () => 80
    const tui = new LocalTui(term, 'm', false)
    const output = Array.from({ length: 14 }, (_, i) => 'tool-line-' + i).join('\n')
    tui.event(ev('tool/call', { callId: 'call-1', name: 'bash', arguments: '{}' }, 1))
    tui.event(ev('tool/result', {
      message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: output }] }] },
    }, 2))
    expect(term.captured).toContain('tool-line-0')
    expect(term.captured).toContain('Ctrl+O: Expand')
    expect(term.captured).not.toContain('tool-line-13')
    press(term, '\x0f')
    expect(term.captured).toContain('tool-line-13')
    const afterExpand = term.captured.length
    press(term, '\x0f')
    expect(term.captured.slice(afterExpand)).toContain('Ctrl+O: Expand')
    expect(term.captured.slice(afterExpand)).not.toContain('tool-line-13')
    tui.dispose()
  })

  it('scrolls the transcript with the mouse wheel', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    for (let i = 0; i < 16; i += 1) {
      tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'mark-' + i }] }, i))
    }
    expect(term.captured).not.toContain('later line')
    press(term, '\x1b[<64;10;5M')
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(term.captured).toContain('later line')
    const before = term.captured.length
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'NEW-TAIL' }] }, 99))
    expect(term.captured.slice(before)).not.toContain('NEW-TAIL')
    for (let i = 0; i < 24; i += 1) press(term, '\x1b[<65;10;5M')
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(term.captured).toContain('NEW-TAIL')
    tui.dispose()
  })

  it('coalesces a burst of transcript wheel events into one terminal update', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    for (let i = 0; i < 40; i += 1) {
      tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'wheel-' + i }] }, i))
    }
    const before = term.writes

    for (let i = 0; i < 12; i += 1) press(term, '\x1b[<64;10;5M')
    await new Promise<void>(resolve => { setImmediate(resolve) })

    expect(term.writes - before).toBe(1)
    expect(term.captured).toContain('later line')
    tui.dispose()
  })

  it('moves slash suggestions with the mouse wheel', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    press(term, '/')
    expect(term.captured).toContain('/help')
    press(term, '\x1b[<65;4;20M')
    expect(term.captured).toContain('❯')
    tui.dispose()
  })

  it('completes a slash command when its popup row is clicked', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    press(term, '/')
    const layout = renderView(initialTranscript(), {
      width: term.width(),
      height: term.height(),
      model: 'm',
      input: '/',
      inputCursor: 1,
      colors: false,
      autocomplete: {
        items: [
          { value: 'help', label: 'help' },
          { value: 'settings', label: 'settings' },
        ],
        selected: 0,
      },
    })
    const start = layout.overlay?.start
    expect(start).toBeDefined()
    press(term, `\x1b[<0;1;${(start ?? 0) + 2}M`)
    expect(term.captured).toContain('/settings ')
    tui.dispose()
  })

  it('selects a settings row on click and cycles on a second click', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    void tui.readline()
    press(term, '/settings\r')
    const layout = renderView(initialTranscript(), {
      width: term.width(),
      height: term.height(),
      model: 'm',
      input: '',
      inputCursor: 0,
      colors: false,
      settings: { selected: 0, prefs: { theme: 'dark', colors: false, expandTools: false } },
    })
    const start = layout.overlay?.start
    expect(start).toBeDefined()
    press(term, `\x1b[<0;1;${(start ?? 0) + SETTINGS_ITEM_ROW + 2}M`)
    expect(term.captured).toContain('SGR styling')
    const before = term.captured.length
    press(term, `\x1b[<0;1;${(start ?? 0) + SETTINGS_ITEM_ROW + 2}M`)
    expect(term.captured.slice(before)).toContain('on')
    tui.dispose()
  })

  it('moves the caret when the input row is clicked', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, 'hello')
    const layout = renderView(initialTranscript(), {
      width: term.width(),
      height: term.height(),
      model: 'm',
      input: 'hello',
      inputCursor: 5,
      colors: false,
    })
    const start = layout.editor?.start
    expect(start).toBeDefined()
    press(term, `\x1b[<0;3;${(start ?? 0) + 2}M`)
    press(term, 'X\r')
    expect(await pending).toBe('Xhello')
    tui.dispose()
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
    tui.event(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'partial' } }, 2))
    expect(term.captured).toContain('q')
    expect(term.captured).not.toContain('partial')
    tui.event(ev('assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'final' }] } }, 3))
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
      message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: output }] }] },
    }, 2))
    expect(term.captured).toContain('plain-line-13')
    expect(term.captured).not.toContain('ctrl+o')
    tui.dispose()
  })
})
