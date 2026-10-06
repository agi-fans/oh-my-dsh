import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { LocalTui, type TerminalLike } from './provider-local.ts'
import { openMessageQueue } from '../session/message-queue.ts'
import { stripAnsi } from '../chrome/width.ts'

class Terminal implements TerminalLike {
  captured = ''
  input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {} })
  output = { isTTY: true, write: (text: string): void => { this.captured += text } }
  width(): number { return 80 }
  height(): number { return 24 }
  press(text: string): void { this.input.write(text) }
}
const instances: LocalTui[] = []
afterEach(() => { for (const tui of instances.splice(0)) tui.dispose(); vi.useRealTimers(); vi.restoreAllMocks() })
const flush = async (): Promise<void> => { await new Promise<void>(resolve => { setImmediate(resolve) }) }
function fixture() {
  const term = new Terminal()
  const tui = new LocalTui(term, 'm', false)
  instances.push(tui)
  const agent = { inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent
  tui.setQueueHandler(signal => openMessageQueue({ agent, tui, signal, assertActive: () => {}, restore: async () => ({ text: '', images: [] }) }))
  return { tui, term }
}

describe('local Message Queue controls', () => {
  it('opens with Alt+Q, edits one waiting message and keeps the composer draft intact', async () => {
    const { tui, term } = fixture()
    term.press('one\r'); term.press('two\r'); term.press('composer draft')
    term.press('\x1bq')
    expect(stripAnsi(term.captured)).toContain('Message Queue')
    term.press('\x1b[B\r')
    await flush()
    expect(stripAnsi(term.captured)).toContain('Edit Queued Message')
    term.press('\x01\x0b  updated\x1b\rline\r')
    await flush()
    term.press('\x1b[27u')
    await flush()
    expect(await tui.readline()).toBe('one')
    expect(await tui.readline()).toBe('  updated\nline')
    const draft = tui.readline()
    term.press('\r')
    expect(await draft).toBe('composer draft')
  })

  it('moves entries with Alt+Up/Down and deletes the selected entry with Alt+D', async () => {
    const { tui, term } = fixture()
    term.press('one\r'); term.press('two\r'); term.press('three\r')
    term.press('\x1bq\x1b[B\x1b[1;3A')
    await flush()
    expect(tui.pendingInputs.list().map(row => row.submission.text)).toEqual(['two', 'one', 'three'])
    term.press('\x1b[1;3B')
    await flush()
    expect(tui.pendingInputs.list().map(row => row.submission.text)).toEqual(['one', 'two', 'three'])
    term.press('\x1bd')
    await flush()
    expect(tui.pendingInputs.list().map(row => row.submission.text)).toEqual(['one', 'three'])
    term.press('\x1b[27u')
    expect(await tui.readline()).toBe('one')
    expect(await tui.readline()).toBe('three')
  })

  it('keeps stable delivery identities after editing and rejects an already dispatched ID', async () => {
    const { tui, term } = fixture()
    const file = { attachmentId: AttachmentId('file'), name: '中文.txt', bytes: 12 }
    tui.stageFileAttachment(file)
    term.press('file message\r')
    const row = tui.pendingInputs.list()[0]!
    expect(tui.pendingInputs.update(row.id, { kind: 'replace', submission: { ...row.submission, text: 'updated' } })).toBe(true)
    expect(tui.pendingInputs.list()[0]?.id).toBe(row.id)
    expect(await tui.readInput()).toMatchObject({ text: 'updated', files: [file] })
    expect(tui.pendingInputs.update(row.id, { kind: 'remove' })).toBe(false)
  })

  it('does not open Queue in inspected child sessions or during legacy queue navigation', async () => {
    const { tui, term } = fixture()
    tui.setInspectedSubagent({ id: 'child', label: 'Child', phase: 'idle', writable: true })
    term.press('\x1bq')
    expect(stripAnsi(term.captured)).toContain('Return to the parent session')
    tui.setInspectedSubagent(undefined)
    term.press('queued\r\x1b[A\x1bq')
    await flush()
    expect(stripAnsi(term.captured)).toContain('Finish editing the queued follow-up')
  })

  it('does not steer queue-edit text or open nested queue management from a prompt', async () => {
    const { tui, term } = fixture()
    tui.setStatus('running')
    const steer = vi.fn(), handler = vi.fn(async () => {})
    tui.setSteerHandler(steer); tui.setQueueHandler(handler)
    const prompt = tui.prompt({ title: 'Edit', question: 'Edit', initialInput: 'queued text', preserveWhitespace: true })
    term.press('\x1bs\x1bq\r')
    expect(await prompt).toBe('queued text')
    expect(steer).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it('refreshes live choices without changing the selected message after a reorder', async () => {
    vi.useFakeTimers()
    const { tui, term } = fixture()
    let options = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }]
    const refreshOptions = vi.fn(() => options)
    const prompt = tui.prompt({ title: 'Live', question: '', options, refreshOptions, presentation: 'fullscreen-list', allowCustom: false })
    term.press('\x1b[B')
    options = [options[1]!, options[0]!]
    await vi.advanceTimersByTimeAsync(250)
    term.press('\r')
    expect(await prompt).toBe('b')
    const calls = refreshOptions.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(refreshOptions).toHaveBeenCalledTimes(calls)
  })

  it('restores input and stops refreshing when the refresh owner fails', async () => {
    vi.useFakeTimers()
    const { tui, term } = fixture()
    term.press('unsent')
    const refresh = vi.fn(() => { throw new Error('session changed') })
    const prompt = tui.prompt({ title: 'Live', question: '', options: [{ label: 'A' }], refreshOptions: refresh, presentation: 'fullscreen-list' })
    await vi.advanceTimersByTimeAsync(250)
    expect(await prompt).toBe(null)
    expect(stripAnsi(term.captured)).toContain('session changed')
    const pending = tui.readline()
    term.press('\r')
    expect(await pending).toBe('unsent')
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('yields queue editing to a tool question and retains the edit without changing the accepted queue', async () => {
    const { tui, term } = fixture()
    term.press('accepted\r'); term.press('existing draft'); term.press('\x1bq\r')
    await flush()
    term.press(' revised')
    const question = tui.prompt({ title: 'Tool question', question: 'Continue?' })
    await flush()
    expect(stripAnsi(term.captured)).toContain('Tool question')
    term.press('yes\r')
    expect(await question).toBe('yes')
    expect(await tui.readline()).toBe('accepted')
    const draft = tui.readline()
    term.press('\r')
    expect(await draft).toBe('accepted revised\nexisting draft')
  })

  it('aborts the shortcut owner when the provider is disposed', () => {
    const { tui, term } = fixture()
    let signal: AbortSignal | undefined
    tui.setQueueHandler(async next => { signal = next })
    term.press('\x1bq')
    expect(signal?.aborted).toBe(false)
    tui.dispose()
    expect(signal?.aborted).toBe(true)
  })
})
