import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { LocalTui, type TerminalLike } from './provider-local.ts'
import { openMessageQueue } from '../session/message-queue.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TuiQueueEditRequest } from '../definition.ts'
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
  tui.setCommands([{ name: 'queue', description: 'Manage pending messages' }])
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
    term.press('\x01\x0b  updated\nline\r')
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

  it('uses Alt+S on the selected queue entry without submitting or changing the composer draft', async () => {
    const { tui, term } = fixture()
    const first = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] })
    const second = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] })
    const nextTurn = [first, second], nextStep: UserMessage[] = []
    const steer = vi.fn((message: UserMessage) => { nextStep.push(message) })
    const agent = { status: 'running', steer, session: { snapshotEvents: () => [] }, inbox: { nextTurn, nextStep,
      remove: (id: string) => { const index = nextTurn.findIndex(item => item.id === id); if (index < 0) return false; nextTurn.splice(index, 1); return true },
    } } as unknown as Agent
    tui.setQueueHandler(signal => openMessageQueue({ agent, tui, signal, assertActive: () => {}, restore: async () => ({ text: 'second', images: [] }) }))
    term.press('unsent composer draft\x1bq\x1b[B\x1bs')
    await flush()
    expect(steer).toHaveBeenCalledOnce()
    expect(steer).toHaveBeenCalledWith(second)
    expect(nextTurn).toEqual([first])
    expect(nextStep).toEqual([second])
    expect(stripAnsi(term.captured)).toContain('Steer · next step')
    term.press('\x1b[27u')
    await flush()
    const input = tui.readline()
    term.press('\r')
    expect(await input).toBe('unsent composer draft')
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

  it.each(['\x1bq', '/queue\r'])('opens the child queue without parent pending deliveries (%s)', async key => {
    const { tui, term } = fixture()
    tui.setSession({ id: 'root', recent: [] })
    term.press('parent pending\r')
    tui.setInspectedSubagent({ id: 'child', label: 'Child', phase: 'waiting', writable: true })
    term.press(key)
    await flush()
    expect(stripAnsi(term.captured)).toContain('Message Queue')
    expect(tui.pendingInputs.list()).toEqual([])
    term.press('\x1b[27u')
    await flush()
    tui.setInspectedSubagent(undefined)
    expect(tui.pendingInputs.list().map(row => row.submission.text)).toEqual(['parent pending'])
  })

  it('rejects nested management during legacy queue navigation', async () => {
    const { tui, term } = fixture()
    term.press('queued\r\x1b[A\x1bq')
    await flush()
    expect(stripAnsi(term.captured)).toContain('Finish editing the queued follow-up')
  })

  it('recalls only child messages and keeps newer drafts across navigation, always resubmitting as Queue', () => {
    const { tui, term } = fixture()
    tui.setSession({ id: 'root', recent: [] })
    term.press('parent pending\r')
    const child = { id: 'child', label: 'Child', phase: 'running' as const, writable: true }
    tui.setInspectedSubagent(child)
    tui.event({ type: 'agent/inbox/spliced', seq: 1, time: 1, data: { target: 'next-turn', start: 0, inserted: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'accepted' }] })] } } as SessionEvent)
    const requests: TuiQueueEditRequest[] = []
    tui.onQueueEdit(request => { requests.push(request!) })
    const send = vi.fn()
    tui.onInspectSubmit(send)
    term.press('newer draft\x1b[1;3A')
    expect(requests[0]?.sessionId).toBe('child')
    tui.resolveQueueEdit({ text: 'accepted', images: [], literal: true }, requests[0])
    tui.setInspectedSubagent(undefined)
    expect(tui.pendingInputs.list().map(row => row.submission.text)).toEqual(['parent pending'])
    tui.setInspectedSubagent(child)
    tui.setStatus('running')
    tui.applyStoredPrefs({ busyEnter: 'steer' })
    term.press(' revised\r')
    expect(send.mock.calls.map(([submission]) => [submission.text, submission.delivery])).toEqual([['accepted revised', 'queue'], ['newer draft', 'queue']])
  })

  it('cancels a recall on navigation and rescues late results without clearing a newer request', () => {
    const { tui, term } = fixture()
    tui.setSession({ id: 'root', recent: [] })
    const child = { id: 'child', label: 'Child', phase: 'running' as const, writable: true }
    tui.setInspectedSubagent(child)
    tui.event({ type: 'agent/inbox/spliced', seq: 1, time: 1, data: { target: 'next-turn', start: 0, inserted: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'accepted' }] })] } } as SessionEvent)
    const requests: TuiQueueEditRequest[] = []
    tui.onQueueEdit(request => { requests.push(request!) })
    term.press('\x1b[1;3A')
    tui.setInspectedSubagent(undefined)
    expect(requests[0]?.signal.aborted).toBe(true)
    tui.setInspectedSubagent(child)
    term.press('\x1b[1;3A')
    tui.resolveQueueEdit({ text: 'late withdrawn', images: [], literal: true }, requests[0])
    expect(requests[1]?.signal.aborted).toBe(false)
    tui.resolveQueueEdit({ text: 'latest recall', images: [], literal: true }, requests[1])
    const send = vi.fn()
    tui.onInspectSubmit(send)
    term.press('\r')
    expect(send.mock.calls.map(([submission]) => submission.text)).toEqual(['latest recall', 'late withdrawn'])
    tui.setInspectedSubagent(undefined)
    expect(tui.pendingInputs.list()).toEqual([])
  })

  it('releases queue shortcuts when navigation cancels a slow previous menu', async () => {
    const { tui, term } = fixture()
    tui.setSession({ id: 'root', recent: [] })
    const signals: AbortSignal[] = []
    let finish: () => void = () => {}
    tui.setQueueHandler(signal => {
      signals.push(signal)
      return signals.length === 1 ? new Promise<void>(resolve => { finish = resolve }) : Promise.resolve()
    })
    term.press('\x1bq')
    tui.setInspectedSubagent({ id: 'child', label: 'Child', phase: 'waiting', writable: true })
    expect(signals[0]?.aborted).toBe(true)
    term.press('\x1bq')
    expect(signals).toHaveLength(2)
    finish()
    await flush()
  })

  it('does not steer queue-edit text or open nested queue management from a prompt', async () => {
    const { tui, term } = fixture()
    tui.setStatus('running')
    const handler = vi.fn(async () => {})
    tui.setQueueHandler(handler)
    const prompt = tui.prompt({ title: 'Edit', question: 'Edit', initialInput: 'queued text', preserveWhitespace: true })
    term.press('\x1bs\x1bq\r')
    expect(await prompt).toBe('queued text')
    expect(tui.pendingInputs.list()).toHaveLength(0)
    expect(handler).not.toHaveBeenCalled()
  })

  it('refreshes live choices without changing the selected message after a reorder', async () => {
    vi.useFakeTimers()
    const { tui, term } = fixture()
    let options = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }]
    const refreshOptions = vi.fn(() => options)
    const prompt = tui.prompt({ title: 'Live', question: '', options, refreshOptions, presentation: 'card', allowCustom: false })
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
    const prompt = tui.prompt({ title: 'Live', question: '', options: [{ label: 'A' }], refreshOptions: refresh, presentation: 'card' })
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

  it.each(['\x1b[27u', '\x03'])('interrupts without withdrawing accepted messages (%s)', key => {
    const { tui, term } = fixture()
    const edit = vi.fn(), interrupt = vi.fn()
    tui.onQueueEdit(edit); tui.onInterrupt(interrupt)
    tui.setStatus('running')
    tui.event({ type: 'agent/inbox/spliced', seq: 1, time: 1, data: { target: 'next-turn', start: 0, inserted: [
      { id: 'a', source: { kind: 'user' }, content: [{ type: 'text', text: 'keep queued' }] },
    ] } } as unknown as SessionEvent)
    term.press(key)
    expect(interrupt).toHaveBeenCalledOnce()
    expect(edit).not.toHaveBeenCalled()
  })

  it.each([false, true])('does not announce an ordinary idle send as queued (refresh=%s)', refresh => {
    const { tui, term } = fixture()
    const admission = { type: 'agent/inbox/spliced', seq: 1, time: 1, data: { target: 'next-turn', start: 0,
      inserted: [{ id: 'direct', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }],
    } } as unknown as SessionEvent
    tui.event(admission)
    if (refresh) tui.replaceSession([admission], undefined, 'idle', 'refresh')
    tui.event({ type: 'turn/start', seq: 2, time: 2, data: { turn: 1 } } as SessionEvent)
    tui.event({ type: 'agent/inbox/spliced', seq: 3, time: 3, data: {
      target: 'next-turn', start: 0, removedCount: 1, inserted: [],
    } } as unknown as SessionEvent)
    expect(stripAnsi(term.captured)).not.toContain('Queue taken for the next turn')
  })

  it.each(['next-turn', 'next-step'])('announces live consumption but not withdrawal of %s', target => {
    const { tui, term } = fixture()
    tui.setStatus('running')
    const splice = (data: object, seq: number) => tui.event({ type: 'agent/inbox/spliced', seq, time: seq, data: { target, ...data } } as unknown as SessionEvent)
    const inserted = [{ id: 'a', source: { kind: 'user' }, content: [{ type: 'text', text: 'message' }] }]
    splice({ start: 0, inserted }, 1)
    let mark = term.captured.length
    splice({ start: 0, removedCount: 1, inserted: [], outcome: 'canceled' }, 2)
    expect(stripAnsi(term.captured.slice(mark))).not.toContain('taken for')
    splice({ start: 0, inserted }, 3)
    // A queued follow-up is claimed after the previous turn settles.
    if (target === 'next-turn') {
      tui.setStatus('idle')
      tui.event({ type: 'turn/start', seq: 4, time: 4, data: { turn: 2 } } as SessionEvent)
    }
    mark = term.captured.length
    splice({ start: 0, removedCount: 1, inserted: [] }, 5)
    expect(stripAnsi(term.captured.slice(mark))).toContain(target === 'next-turn' ? 'Queue taken for the next turn' : 'Steer taken for the next step')
  })

  it('keeps consumption feedback for pending input restored from a session', () => {
    const { tui, term } = fixture()
    tui.replaceSession([{ type: 'agent/inbox/spliced', seq: 1, time: 1, data: { target: 'next-turn', start: 0,
      inserted: [{ id: 'restored', source: { kind: 'user' }, content: [{ type: 'text', text: 'waiting' }] }],
    } } as unknown as SessionEvent])
    tui.event({ type: 'turn/start', seq: 2, time: 2, data: { turn: 1 } } as SessionEvent)
    const mark = term.captured.length
    tui.event({ type: 'agent/inbox/spliced', seq: 3, time: 3, data: {
      target: 'next-turn', start: 0, removedCount: 1, inserted: [],
    } } as unknown as SessionEvent)
    expect(stripAnsi(term.captured.slice(mark))).toContain('Queue taken for the next turn')
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
