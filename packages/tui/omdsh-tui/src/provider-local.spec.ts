/**
 * LocalTui contract tests over a fake terminal: key routing (edit, history,
 * slash/tab autocomplete, Ctrl-R history search, PgUp/PgDn transcript
 * scroll, Ctrl-O tool expand, submit), Ctrl-C interrupt vs clear, Ctrl-D quit and the
 * cross-turn quit latch, plain-mode line input, and event rendering.
 */
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { LocalTui, type TerminalLike } from './provider-local.ts'

class FakeTerminal implements TerminalLike {
  captured = ''
  raw = false
  destroyed = false
  output = {
    isTTY: true,
    write: (chunk: string): void => { this.captured += chunk },
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
    tui.setModel('deepseek-v4-pro')
    expect(term.captured).toContain('deepseek-v4-pro')
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
    expect(term.captured).toContain('/theme')
    expect(term.captured).toContain('/clear')
    expect(term.captured).toContain('/quit')
    tui.dispose()
  })

  it('completes the selected slash command on Tab', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    press(term, '/c')
    press(term, '\t')
    expect(term.captured).toContain('/clear ')
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

  it('runs /help locally and keeps readline pending', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, '/help\r')
    expect(term.captured).toContain('Commands')
    press(term, 'hi\r')
    expect(await pending).toBe('hi')
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

  it('opens settings from the /set alias', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    void tui.readline()
    press(term, '/set\r')
    expect(term.captured).toContain('Settings')
    expect(term.captured).toContain('Color palette')
    tui.dispose()
  })

  it('applies /theme light without submitting a prompt', async () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    const pending = tui.readline()
    press(term, '/theme light\r')
    expect(term.captured).toContain('Theme: light')
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
    expect(term.captured).toContain('ctrl+o to expand')
    expect(term.captured).not.toContain('tool-line-13')
    press(term, '\x0f')
    expect(term.captured).toContain('tool-line-13')
    const afterExpand = term.captured.length
    press(term, '\x0f')
    expect(term.captured.slice(afterExpand)).toContain('ctrl+o to expand')
    expect(term.captured.slice(afterExpand)).not.toContain('tool-line-13')
    tui.dispose()
  })

  it('scrolls the transcript with the mouse wheel', () => {
    const term = new FakeTerminal()
    const tui = new LocalTui(term, 'm', false)
    for (let i = 0; i < 16; i += 1) {
      tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'mark-' + i }] }, i))
    }
    expect(term.captured).not.toContain('later line')
    press(term, '\x1b[<64;10;5M')
    expect(term.captured).toContain('later line')
    const before = term.captured.length
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'NEW-TAIL' }] }, 99))
    expect(term.captured.slice(before)).not.toContain('NEW-TAIL')
    for (let i = 0; i < 24; i += 1) press(term, '\x1b[<65;10;5M')
    expect(term.captured).toContain('NEW-TAIL')
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
