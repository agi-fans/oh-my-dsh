import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as externalEditor from '../input/external-editor.ts'
import { LocalTui, type TerminalLike } from './provider-local.ts'

class Terminal implements TerminalLike {
  captured = ''
  raw = false
  input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (on: boolean): void => { this.raw = on },
  })
  output = { isTTY: true, write: (text: string): void => { this.captured += text } }
  width(): number { return 90 }
  height(): number { return 30 }
}
const records = (text: string): string[] => [...text.matchAll(/\x1b\]([^\x07\x1b]*)(?:\x07|\x1b\\)/gu)].map(match => match[1]!)
const flush = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(30) }
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('foreground terminal integration', () => {
  it.each([false, true])('keeps working status through a user message repaint (colors=%s)', async colors => {
    const terminal = new Terminal(), tui = new LocalTui(terminal, 'm', colors)
    try {
      tui.applyStoredPrefs({ colors, theme: 'dark', motion: 'off', terminalState: 'on' })
      tui.setStatus('running', { root: true })
      tui.event({ type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] } } as any)
      expect(records(terminal.captured).filter(record => record.startsWith('133;'))).toEqual([])
      expect(records(terminal.captured).filter(record => record.startsWith('7501;state=')).at(-1)).toBe('7501;state=working:app=omdsh')
    } finally { await tui.dispose() }
  })

  it('keeps muted approvals visible through progress without triggering native notifications', async () => {
    vi.useFakeTimers()
    const terminal = new Terminal(), tui = new LocalTui(terminal, 'm', false)
    try {
      tui.applyStoredPrefs({ colors: false, theme: 'dark', terminalState: 'on', notifications: 'off' })
      tui.setStatus('running', { root: true })
      const mark = terminal.captured.length
      const prompt = tui.prompt({ title: 'Approval', question: 'Allow?', attentionKind: 'permission', options: [{ label: 'Allow' }] })
      await flush()
      const output = records(terminal.captured.slice(mark))
      expect(output.some(record => record.startsWith('7501;state=blocked'))).toBe(false)
      expect(output.some(record => record.startsWith('9;') && !record.startsWith('9;4;'))).toBe(false)
      expect(output).toContain('9;4;4;0')
      terminal.input.write('\r')
      await prompt
    } finally { await tui.dispose() }
  })

  it.each(['permission', 'question', 'auth'] as const)('delivers %s attention once through native status and cancels stale attention', async kind => {
    vi.useFakeTimers()
    const terminal = new Terminal(), tui = new LocalTui(terminal, 'm', false)
    try {
      tui.applyStoredPrefs({ colors: false, theme: 'dark', terminalState: 'on', notifications: 'always' })
      tui.setStatus('running', { root: true })
      const mark = terminal.captured.length
      const prompt = tui.prompt({ title: 'Approval', question: 'Private body', attentionKind: kind, options: [{ label: 'Allow' }] })
      await flush()
      const output = records(terminal.captured.slice(mark))
      expect(output.filter(record => record.startsWith('7501;state=blocked'))).toEqual([`7501;state=blocked:app=omdsh:kind=${kind}`])
      expect(output.some(record => record.startsWith('9;') && !record.startsWith('9;4;'))).toBe(false)
      terminal.input.write('\r')
      await prompt
      const dismissed = terminal.captured.length
      tui.event({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } } as any)
      const second = tui.prompt({ title: 'Question', question: 'Already answered', options: [{ label: 'Yes' }] })
      terminal.input.write('\r')
      await second
      tui.event({ type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'completed' } } } as any)
      tui.setStatus('idle', { root: true, outcome: 'completed' })
      await flush()
      expect(records(terminal.captured.slice(dismissed)).some(record => record.startsWith('7501;state=blocked') || record.startsWith('9;omdsh'))).toBe(false)
      expect(records(terminal.captured.slice(dismissed)).filter(record => record.startsWith('7501;state=done'))).toHaveLength(1)
    } finally { await tui.dispose() }
  })

  it('applies duration and focus policy to native completion reports', async () => {
    vi.useFakeTimers()
    const terminal = new Terminal(), tui = new LocalTui(terminal, 'm', false)
    const event = (type: 'turn/start' | 'turn/end', turn: number, time: number): void => {
      tui.event({ type, seq: time, time, data: { turn, reason: { kind: 'completed' } } } as any)
      tui.setStatus(type === 'turn/start' ? 'running' : 'idle', { root: true, ...(type === 'turn/end' ? { outcome: 'completed' } : {}) })
    }
    try {
      tui.applyStoredPrefs({ colors: false, theme: 'dark', terminalState: 'on', notifications: 'unfocused' })
      terminal.input.write('\x1b[O')
      event('turn/start', 1, 1)
      event('turn/end', 1, 30_000)
      await flush()
      expect(records(terminal.captured).some(record => record.startsWith('7501;state=done'))).toBe(false)
      event('turn/start', 2, 30_000)
      event('turn/end', 2, 60_000)
      await flush()
      expect(records(terminal.captured).filter(record => record.startsWith('7501;state=done'))).toHaveLength(1)
      event('turn/start', 3, 60_000)
      event('turn/end', 3, 90_000)
      terminal.input.write('\x1b[I')
      await flush()
      expect(records(terminal.captured).filter(record => record.startsWith('7501;state=done'))).toHaveLength(1)
      expect(records(terminal.captured).some(record => record.startsWith('9;omdsh'))).toBe(false)
    } finally { await tui.dispose() }
  })

  it('sends and clears progress with a bounded keepalive, including status off', async () => {
    vi.useFakeTimers()
    const terminal = new Terminal(), tui = new LocalTui(terminal, 'm', false)
    try {
      tui.setStatus('running', { root: true })
      const mark = terminal.captured.length
      await vi.advanceTimersByTimeAsync(1000)
      expect(records(terminal.captured.slice(mark))).toContain('9;4;3')
      tui.setStatus('idle', { root: true, outcome: 'completed' })
      expect(records(terminal.captured).filter(record => record.startsWith('9;4;')).at(-1)).toBe('9;4;0')
      const stopped = terminal.captured.length
      await vi.advanceTimersByTimeAsync(2000)
      expect(records(terminal.captured.slice(stopped)).filter(record => record.startsWith('9;4;'))).toEqual([])
      tui.applyStoredPrefs({ colors: false, theme: 'dark', terminalState: 'off' })
      const disabled = terminal.captured.length
      tui.setStatus('running', { root: true })
      await vi.advanceTimersByTimeAsync(1000)
      expect(records(terminal.captured.slice(disabled)).filter(record => record.startsWith('9;4;'))).toEqual([])
    } finally { await tui.dispose() }
  })

  it('restores metadata before the external editor and reacquires it afterwards', async () => {
    const terminal = new Terminal(), tui = new LocalTui(terminal, 'm', false)
    const cwd = join(tmpdir(), 'omdsh 中文 # %')
    try {
      tui.applyStoredPrefs({ colors: false, theme: 'dark', terminalState: 'on' })
      tui.setWorkingDirectory(cwd)
      tui.setStatus('running', { root: true })
      const mark = terminal.captured.length
      const edit = vi.spyOn(externalEditor, 'editExternally').mockImplementation(text => {
        const output = records(terminal.captured.slice(mark))
        expect(output).toContain('7501;state=clear:app=omdsh')
        expect(output).toContain('9;4;0')
        expect(output).toContain('2;')
        expect(terminal.raw).toBe(false)
        return text
      })
      terminal.input.write('\x18')
      expect(edit).toHaveBeenCalledOnce()
      expect(terminal.raw).toBe(true)
      const cwdRecords = records(terminal.captured.slice(mark)).filter(record => record.startsWith('7;'))
      expect(cwdRecords).toHaveLength(2)
      const url = new URL(cwdRecords[1]!.slice(2))
      expect(decodeURIComponent(url.pathname)).toContain('omdsh 中文 # %')
      expect(records(terminal.captured).filter(record => record.startsWith('7501;state=')).at(-1)).toBe('7501;state=working:app=omdsh')
    } finally { await tui.dispose() }
  })

  it.runIf(process.platform !== 'win32')('clears owned metadata on suspend and restores it on SIGCONT', async () => {
    const terminal = new Terminal(), tui = new LocalTui(terminal, 'm', false)
    try {
      tui.applyStoredPrefs({ colors: false, theme: 'dark', terminalState: 'on' })
      tui.setStatus('running', { root: true })
      const mark = terminal.captured.length
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
        expect(records(terminal.captured.slice(mark))).toContain('7501;state=clear:app=omdsh')
        expect(records(terminal.captured.slice(mark))).toContain('9;4;0')
        expect(terminal.raw).toBe(false)
        return true
      })
      terminal.input.write('\x1a')
      expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTSTP')
      const suspended = terminal.captured.length
      tui.setStatus('idle', { root: true })
      expect(records(terminal.captured.slice(suspended))).toEqual([])
      process.emit('SIGCONT')
      expect(terminal.raw).toBe(true)
      expect(records(terminal.captured).filter(record => record.startsWith('7501;state=')).at(-1)).toBe('7501;state=idle:app=omdsh')
    } finally { await tui.dispose() }
  })

  it('clears owned metadata in the synchronous exit fallback', async () => {
    const before = process.listeners('exit')
    const terminal = new Terminal(), tui = new LocalTui(terminal, 'm', false)
    try {
      tui.applyStoredPrefs({ colors: false, theme: 'dark', terminalState: 'on' })
      tui.setStatus('running', { root: true })
      const mark = terminal.captured.length
      for (const handler of process.listeners('exit').filter(handler => !before.includes(handler))) handler(0)
      expect(records(terminal.captured.slice(mark))).toContain('7501;state=clear:app=omdsh')
      expect(records(terminal.captured.slice(mark))).toContain('9;4;0')
      expect(records(terminal.captured.slice(mark))).toContain('2;')
      expect(terminal.raw).toBe(false)
    } finally { await tui.dispose() }
  })

  it.runIf(process.platform !== 'win32')('takes terminal ownership back if suspension fails', async () => {
    const terminal = new Terminal(), tui = new LocalTui(terminal, 'm', false)
    try {
      tui.applyStoredPrefs({ colors: false, theme: 'dark', terminalState: 'on' })
      tui.setStatus('running', { root: true })
      vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('no controlling tty') })
      terminal.input.write('\x1a')
      expect(terminal.raw).toBe(true)
      expect(records(terminal.captured).filter(record => record.startsWith('7501;state=')).at(-1)).toBe('7501;state=working:app=omdsh')
    } finally { await tui.dispose() }
  })
})
