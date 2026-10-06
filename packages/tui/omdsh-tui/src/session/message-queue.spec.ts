import { describe, expect, it, vi } from 'vitest'
import type { Agent, InboxTarget } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { TuiPrompt, TuiSubmission, TuiPendingInputs } from '../definition.ts'
import { editedQueuedMessage, moveQueuedMessage, openMessageQueue, queuedMessages } from './message-queue.ts'

const message = (text: string): UserMessage => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
function fixture(nextTurn: UserMessage[] = [], nextStep: UserMessage[] = [], local: { id: string; submission: TuiSubmission }[] = []) {
  const inbox = {
    nextTurn, nextStep,
    splice: vi.fn((target: InboxTarget, start: number, count: number, inserted: UserMessage[]) => (target === 'next-turn' ? nextTurn : nextStep).splice(start, count, ...inserted)),
    remove: vi.fn((id: string) => {
      for (const list of [nextTurn, nextStep]) { const index = list.findIndex(item => item.id === id); if (index >= 0) { list.splice(index, 1); return true } }
      return false
    }),
    replace: vi.fn((id: string, replacement: UserMessage) => {
      for (const list of [nextTurn, nextStep]) { const index = list.findIndex(item => item.id === id); if (index >= 0) { list[index] = replacement; return true } }
      return false
    }),
  }
  const pending: TuiPendingInputs = {
    list: () => local,
    update: (id, change) => {
      const index = local.findIndex(item => item.id === id)
      if (index < 0) return false
      if (change.kind === 'remove') local.splice(index, 1)
      else if (change.kind === 'replace') local[index] = { id, submission: change.submission }
      else {
        const destination = index + change.direction
        if (destination < 0 || destination >= local.length) return false
        const other = local[destination]!
        local[destination] = local[index]!; local[index] = other
      }
      return true
    },
  }
  const agent = { inbox } as unknown as Agent
  const tui = { pendingInputs: pending, prompt: vi.fn<(prompt: TuiPrompt) => Promise<string | null>>(), notice: vi.fn(), restoreInput: vi.fn() }
  const assertActive = vi.fn()
  const restore = vi.fn(async (item: UserMessage): Promise<TuiSubmission> => ({ text: item.content.filter(block => block.type === 'text').map(block => block.text).join('\n'), images: [] }))
  const open = (signal = new AbortController().signal): Promise<void> => openMessageQueue({ agent, tui, assertActive, restore, signal })
  return { agent, inbox, tui, pending, assertActive, restore, open }
}

describe('pending message mutations', () => {
  it('orders human guidance, follow-ups and pending delivery without exposing internal messages', () => {
    const internal = createUserMessage({ content: [{ type: 'text', text: 'internal' }], source: { kind: 'subagent', sessionId: 'child' } } as never)
    const f = fixture([message('next'), internal], [message('guide')], [{ id: 'local', submission: { text: 'waiting', images: [] } }])
    expect(queuedMessages(f.agent, f.pending).map(row => [row.target, row.text])).toEqual([['next-step', 'guide'], ['next-turn', 'next'], ['delivery', 'waiting']])
  })

  it('reorders with one splice and leaves internal entries and the other target unchanged', () => {
    const a = message('a'), b = message('b'), guide = message('guide')
    const internal = createUserMessage({ content: [], source: { kind: 'subagent', sessionId: 'child' } } as never)
    const f = fixture([internal, a, b], [guide])
    expect(moveQueuedMessage(f.agent, 'next-turn', b.id, -1)).toBe(true)
    expect(f.inbox.nextTurn).toEqual([internal, b, a])
    expect(f.inbox.splice).toHaveBeenCalledOnce()
    expect(f.inbox.nextStep).toEqual([guide])
    expect(moveQueuedMessage(f.agent, 'next-turn', b.id, -1)).toBe(false)
    expect(moveQueuedMessage(f.agent, 'next-turn', internal.id, 1)).toBe(false)
    expect(moveQueuedMessage(f.agent, 'next-turn', 'missing', 1)).toBe(false)
    expect(f.inbox.splice).toHaveBeenCalledOnce()
    const barrier = fixture([a, internal, b])
    expect(moveQueuedMessage(barrier.agent, 'next-turn', b.id, -1)).toBe(false)
    expect(barrier.inbox.splice).not.toHaveBeenCalled()
  })

  it('edits text verbatim with original image/file references and human attribution', () => {
    const file = { attachmentId: AttachmentId('file'), name: '中文.txt', bytes: 42 }
    const image = { attachmentId: AttachmentId('image'), mediaType: 'image/png', width: 1, height: 1, bytes: 3 }
    const original = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'old' }, { type: 'file', attachment: file }, { type: 'image', attachment: image }] } as never)
    const edited = editedQueuedMessage(original, '  中文 🐳\n    code\n')
    expect(edited.content).toEqual([{ type: 'text', text: '  中文 🐳\n    code\n' }, ...original.content.slice(1)])
    expect(edited.id).not.toBe(original.id)
    expect(edited.source).toEqual(original.source)
    expect(original.content[0]).toEqual({ type: 'text', text: 'old' })
    expect(() => editedQueuedMessage(message('text only'), ' ')).toThrow('Enter a message')
    expect(editedQueuedMessage(original, '').content).toEqual(original.content.slice(1))
  })
})

describe('Message Queue interaction', () => {
  it('cancels without changing the inbox or restoring anything into the composer', async () => {
    const original = message('keep')
    const f = fixture([original])
    f.tui.prompt.mockResolvedValue(null)
    await f.open()
    expect(f.inbox.nextTurn).toEqual([original])
    expect(f.inbox.remove).not.toHaveBeenCalled()
    expect(f.tui.restoreInput).not.toHaveBeenCalled()
  })

  it('keeps selection stable after moving an entry and shows the updated order', async () => {
    const a = message('a'), b = message('b')
    const f = fixture([a, b])
    f.tui.prompt.mockResolvedValueOnce(`up:next-turn:${b.id}`).mockImplementationOnce(async request => {
      expect(request.initialValue).toBe(`next-turn:${b.id}`)
      expect(request.options?.map(option => option.value)).toEqual([`next-turn:${b.id}`, `next-turn:${a.id}`])
      return null
    })
    await f.open()
    expect(f.inbox.nextTurn).toEqual([b, a])
  })

  it('edits a selected entry in place without requeueing or deleting its neighbors', async () => {
    const a = message('a'), b = message('b')
    const f = fixture([a, b])
    f.tui.prompt.mockResolvedValueOnce(`next-turn:${a.id}`).mockResolvedValueOnce('  updated\n').mockResolvedValueOnce(null)
    await f.open()
    expect(f.inbox.nextTurn[0]?.content).toEqual([{ type: 'text', text: '  updated\n' }])
    expect(f.inbox.nextTurn[1]).toBe(b)
    expect(f.inbox.replace).toHaveBeenCalledOnce()
    expect(f.inbox.remove).not.toHaveBeenCalled()
    expect(f.tui.prompt.mock.calls[1]?.[0]).toMatchObject({ initialInput: 'a', preserveWhitespace: true })
    expect(f.tui.restoreInput).not.toHaveBeenCalled()
  })

  it('cancels editing without withdrawing accepted input', async () => {
    const a = message('a')
    const f = fixture([a])
    f.tui.prompt.mockResolvedValueOnce(`next-turn:${a.id}`).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    await f.open()
    expect(f.inbox.nextTurn).toEqual([a])
    expect(f.inbox.remove).not.toHaveBeenCalled()
    expect(f.inbox.replace).not.toHaveBeenCalled()
  })

  it('deletes one entry and refreshes new and claimed messages while open', async () => {
    const a = message('a'), b = message('b'), c = message('c')
    const f = fixture([a, b])
    f.tui.prompt.mockImplementationOnce(async request => {
      const options = request.refreshOptions!()
      expect(request.refreshOptions!()).toBe(options)
      f.inbox.nextTurn.splice(0, 1)
      f.inbox.nextTurn.push(c)
      expect(request.refreshOptions!().map(option => option.value)).toEqual([`next-turn:${b.id}`, `next-turn:${c.id}`])
      return `delete:next-turn:${b.id}`
    }).mockResolvedValueOnce(null)
    await f.open()
    expect(f.inbox.nextTurn).toEqual([c])
  })

  it('rejects a stale action without touching a different entry', async () => {
    const a = message('a'), b = message('b')
    const f = fixture([a, b])
    f.tui.prompt.mockImplementationOnce(async () => { f.inbox.nextTurn.shift(); return `delete:next-turn:${a.id}` }).mockResolvedValueOnce(null)
    await f.open()
    expect(f.inbox.remove).not.toHaveBeenCalled()
    expect(f.inbox.nextTurn).toEqual([b])
    expect(f.tui.notice).toHaveBeenCalledWith('That message is no longer pending.')
  })

  it('restores raced edits as unsent drafts, never silently duplicates already claimed input', async () => {
    const a = message('a')
    const f = fixture([a])
    f.tui.prompt.mockResolvedValueOnce(`next-turn:${a.id}`).mockImplementationOnce(async () => { f.inbox.nextTurn.shift(); return 'my edit' })
    await f.open()
    expect(f.tui.restoreInput).toHaveBeenCalledWith({ text: 'my edit', images: [], literal: true })
    expect(f.inbox.nextTurn).toEqual([])
  })

  it('retains an edited draft on persistence failure and leaves accepted input unchanged', async () => {
    const a = message('accepted')
    const f = fixture([a])
    f.inbox.replace.mockImplementationOnce(() => { throw new Error('disk full') })
    f.tui.prompt.mockResolvedValueOnce(`next-turn:${a.id}`).mockResolvedValueOnce('edited')
    await f.open()
    expect(f.inbox.nextTurn).toEqual([a])
    expect(f.tui.restoreInput).toHaveBeenCalledWith({ text: 'edited', images: [], literal: true })
    expect(f.tui.notice).toHaveBeenCalledWith(expect.stringContaining('disk full'), { level: 'error' })
  })

  it('does not withdraw input when image recovery fails or the agent changes during recovery', async () => {
    const a = message('a')
    const f = fixture([a])
    f.restore.mockRejectedValue(new Error('missing image'))
    f.tui.prompt.mockResolvedValueOnce(`next-turn:${a.id}`).mockResolvedValueOnce(null)
    await f.open()
    expect(f.inbox.nextTurn).toEqual([a])
    expect(f.inbox.remove).not.toHaveBeenCalled()
    expect(f.tui.notice).toHaveBeenCalledWith('missing image', { level: 'error' })
    const changed = fixture([a])
    changed.tui.prompt.mockResolvedValueOnce(`next-turn:${a.id}`)
    changed.restore.mockImplementationOnce(async () => { changed.assertActive.mockImplementation(() => { throw new Error('changed') }); return { text: 'a', images: [] } })
    await expect(changed.open()).rejects.toThrow('changed')
    expect(changed.inbox.nextTurn).toEqual([a])
    expect(changed.tui.restoreInput).not.toHaveBeenCalled()
  })

  it('manages waiting delivery independently with attachments and literal slash semantics intact', async () => {
    const submission = { text: '/literal', images: [{ data: new Uint8Array([1]), mediaType: 'image/png' as const }], literal: true }
    const f = fixture([], [], [{ id: 'a', submission }, { id: 'b', submission: { text: 'b', images: [] } }])
    f.tui.prompt.mockResolvedValueOnce('up:delivery:b').mockResolvedValueOnce('delivery:a').mockResolvedValueOnce('/updated').mockResolvedValueOnce('delete:delivery:b').mockResolvedValueOnce(null)
    await f.open()
    expect(f.pending.list()).toEqual([{ id: 'a', submission: { ...submission, text: '/updated' } }])
    expect(f.restore).not.toHaveBeenCalled()
  })

  it('aborts safely before applying an answer or opening a nested prompt', async () => {
    const a = message('a')
    const f = fixture([a])
    const abort = new AbortController()
    f.tui.prompt.mockImplementationOnce(async () => { abort.abort(new Error('cancelled')); return `delete:next-turn:${a.id}` })
    await expect(f.open(abort.signal)).rejects.toThrow('cancelled')
    expect(f.inbox.nextTurn).toEqual([a])
    expect(f.inbox.remove).not.toHaveBeenCalled()
  })
})
