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

  it('reports live OSC 7501 blocked and done states without clearing on muted or focused turns', async () => {
    vi.useFakeTimers()
    const terminal = new Terminal(), tui = new LocalTui(terminal, 'm', false)
    try {
      tui.applyStoredPrefs({ colors: false, theme: 'dark', terminalState: 'on', notifications: 'off' })
      tui.setSession({ id: 'root', title: 'Fix parser', recent: [] })
      expect(records(terminal.captured).filter(record => record.startsWith('2;')).at(-1)).toBe('2;Fix parser')
      tui.setStatus('running', { root: true })
      const mark = terminal.captured.length
      const prompt = tui.prompt({ title: 'Approval', question: 'Allow?', attentionKind: 'permission', options: [{ label: 'Allow' }] })
      await flush()
      const output = records(terminal.captured.slice(mark))
      const expectedTitle = Buffer.from('Fix parser').toString('base64')
      expect(output.filter(record => record.startsWith('7501;state='))).toEqual([`7501;state=blocked:app=omdsh:kind=permission:title=${expectedTitle}`])
      expect(output.some(record => record.startsWith('9;') && !record.startsWith('9;4;'))).toBe(false)
      expect(output).toContain('9;4;4;0')
      terminal.input.write('\r')
      await prompt
      const completed = terminal.captured.length
      tui.event({ type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'completed' } } } as any)
      tui.setStatus('idle', { root: true, outcome: 'completed' })
      await flush()
      const settled = records(terminal.captured.slice(completed)).filter(record => record.startsWith('7501;state='))
      expect(settled).toEqual([`7501;state=done:app=omdsh:title=${expectedTitle}`])
      expect(settled).not.toContain('7501;state=clear:app=omdsh')
    } finally { await tui.dispose() }
  })

  it.each(['permission', 'question', 'auth'] as const)('reports %s attention immediately via OSC 7501 while suppressing duplicate OSC 9 alerts', async kind => {
    vi.useFakeTimers()
    const terminal = new Terminal(), tui = new LocalTui(terminal, 'm', false)
    try {
      tui.applyStoredPrefs({ colors: false, theme: 'dark', terminalState: 'on', notifications: 'always' })
      tui.setStatus('running', { root: true })
      const mark = terminal.captured.length
      const prompt = tui.prompt({ title: 'Approval', question: 'Private body', attentionKind: kind, options: [{ label: 'Allow' }] })
      await flush()
      const output = records(terminal.captured.slice(mark))
      expect(output.filter(record => record.startsWith('7501;state='))).toEqual([`7501;state=blocked:app=omdsh:kind=${kind}`])
      expect(output.some(record => record.startsWith('9;') && !record.startsWith('9;4;'))).toBe(false)
      terminal.input.write('\r')
      await prompt
      const dismissed = terminal.captured.length
      tui.event({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } } as any)
      tui.event({ type: 'compaction/start', seq: 2, time: 2, data: { compactionId: 'c1', turn: 1 } } as any)
      tui.event({ type: 'compaction/end', seq: 3, time: 3, data: { compactionId: 'c1', turn: 1 } } as any)
      tui.event({ type: 'turn/end', seq: 4, time: 4, data: { turn: 1, reason: { kind: 'completed' } } } as any)
      tui.setStatus('idle', { root: true, outcome: 'completed' })
      await flush()
      expect(records(terminal.captured.slice(dismissed)).some(record => record.startsWith('9;omdsh') || record.startsWith('7501;state=clear'))).toBe(false)
      expect(records(terminal.captured.slice(dismissed)).filter(record => record.startsWith('7501;state=done'))).toEqual(['7501;state=done:app=omdsh'])
    } finally { await tui.dispose() }
  })

  it('applies duration and focus policy to fallback OSC 9 notices while reporting manual compaction via OSC 7501', async () => {
    vi.useFakeTimers()
    const terminal = new Terminal(), tui = new LocalTui(terminal, 'm', false)
    const event = (type: 'turn/start' | 'turn/end', turn: number, time: number): void => {
      tui.event({ type, seq: time, time, data: { turn, reason: { kind: 'completed' } } } as any)
      tui.setStatus(type === 'turn/start' ? 'running' : 'idle', { root: true, ...(type === 'turn/end' ? { outcome: 'completed' } : {}) })
    }
    try {
      tui.applyStoredPrefs({ colors: false, theme: 'dark', terminalState: 'off', notifications: 'unfocused' })
      terminal.input.write('\x1b[O')
      event('turn/start', 1, 1)
      event('turn/end', 1, 30_000)
      await flush()
      expect(records(terminal.captured).some(record => record.startsWith('9;omdsh'))).toBe(false)
      event('turn/start', 2, 30_000)
      event('turn/end', 2, 60_000)
      await flush()
      expect(records(terminal.captured).filter(record => record.startsWith('9;omdsh'))).toHaveLength(1)
      event('turn/start', 3, 60_000)
      event('turn/end', 3, 90_000)
      terminal.input.write('\x1b[I')
      await flush()
      expect(records(terminal.captured).filter(record => record.startsWith('9;omdsh'))).toHaveLength(1)
      tui.applyStoredPrefs({ colors: false, theme: 'dark', terminalState: 'on', notifications: 'unfocused' })
      const compactMark = terminal.captured.length
      tui.event({ type: 'compaction/start', seq: 100, time: 100, data: { compactionId: 'manual', turn: null } } as any)
      expect(records(terminal.captured.slice(compactMark)).filter(record => record.startsWith('7501;state='))).toEqual(['7501;state=working:app=omdsh'])
      tui.event({ type: 'compaction/end', seq: 101, time: 101, data: { compactionId: 'manual', turn: null } } as any)
      expect(records(terminal.captured.slice(compactMark)).filter(record => record.startsWith('7501;state='))).toEqual([
        '7501;state=working:app=omdsh',
        '7501;state=done:app=omdsh',
      ])
      tui.setInspectedSubagent({ id: 'child-1', title: 'Child', phase: 'waiting' } as any)
      const inspectMark = terminal.captured.length
      tui.setStatus('idle', { root: true, compaction: { phase: 'start', id: 'root-c2' } })
      tui.setStatus('idle', { root: true, compaction: { phase: 'end', id: 'root-c2', error: 'boom' } })
      expect(records(terminal.captured.slice(inspectMark)).filter(record => record.startsWith('7501;state='))).toEqual([
        '7501;state=working:app=omdsh',
        '7501;state=error:app=omdsh',
      ])
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
      tui.setSession({ id: 'root', title: 'Fix parser', recent: [] })
      tui.setWorkingDirectory(cwd)
      tui.setStatus('running', { root: true })
      const mark = terminal.captured.length
      let handoffOutput: string[] = []
      const edit = vi.spyOn(externalEditor, 'editExternally').mockImplementation(text => {
        handoffOutput = records(terminal.captured.slice(mark))
        expect(terminal.raw).toBe(false)
        return text
      })
      terminal.input.write('\x18')
      expect(edit).toHaveBeenCalledOnce()
      expect(handoffOutput).toContain('7501;state=clear:app=omdsh')
      expect(handoffOutput).toContain('9;4;0')
      expect(handoffOutput).toContain('2;')
      expect(terminal.raw).toBe(true)
      const cwdRecords = records(terminal.captured.slice(mark)).filter(record => record.startsWith('7;'))
      expect(cwdRecords).toHaveLength(2)
      const url = new URL(cwdRecords[1]!.slice(2))
      expect(decodeURIComponent(url.pathname)).toContain('omdsh 中文 # %')
      expect(records(terminal.captured).filter(record => record.startsWith('2;')).at(-1)).toBe('2;Fix parser')
      const expectedTitle = Buffer.from('Fix parser').toString('base64')
      expect(records(terminal.captured).filter(record => record.startsWith('7501;state=')).at(-1)).toBe(`7501;state=working:app=omdsh:title=${expectedTitle}`)
    } finally { await tui.dispose() }
  })

  it.runIf(process.platform !== 'win32')('clears owned metadata on suspend and restores it on SIGCONT', async () => {
    const terminal = new Terminal(), tui = new LocalTui(terminal, 'm', false)
    try {
      tui.applyStoredPrefs({ colors: false, theme: 'dark', terminalState: 'on' })
      tui.setSession({ id: 'root', title: 'Fix parser', recent: [] })
      tui.setStatus('running', { root: true })
      const mark = terminal.captured.length
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
        expect(records(terminal.captured.slice(mark))).toContain('7501;state=clear:app=omdsh')
        expect(records(terminal.captured.slice(mark))).toContain('9;4;0')
        expect(records(terminal.captured.slice(mark))).toContain('2;')
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
      const expectedTitle = Buffer.from('Fix parser').toString('base64')
      expect(records(terminal.captured).filter(record => record.startsWith('7501;state=')).at(-1)).toBe(`7501;state=idle:app=omdsh:title=${expectedTitle}`)
    } finally { await tui.dispose() }
  })

  it('clears owned metadata in the synchronous exit fallback', async () => {
    const before = process.listeners('exit')
    const terminal = new Terminal(), tui = new LocalTui(terminal, 'm', false)
    try {
      tui.applyStoredPrefs({ colors: false, theme: 'dark', terminalState: 'on' })
      tui.setSession({ id: 'root', title: 'Fix parser', recent: [] })
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
