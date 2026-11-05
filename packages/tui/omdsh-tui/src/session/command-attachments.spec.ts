import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import CommandRuntime, { type CommandFileReceiptResolver, type CommandInvocation } from '@deepseek-ai/dsh-commands'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CommandAttachments } from './command-attachments.ts'

const file = { attachmentId: AttachmentId('file:staged'), name: '任务.txt', bytes: 10 }
const image = { mediaType: 'image/png' as const, data: new Uint8Array([1, 2, 3]) }

describe('command attachment receipts', () => {
  it('binds receipts to exact Agent identities and releases each dispatch independently', () => {
    let resolve!: CommandFileReceiptResolver
    const off = vi.fn()
    const bridge = new CommandAttachments({ registerFileReceiptResolver: value => { resolve = value; return off } })
    const agent = { id: 'same-id' } as Agent, other = { id: 'same-id' } as Agent
    const first = bridge.stage(agent, { text: '/plan', images: [image], files: [file],
      segments: [{ kind: 'file', index: 0 }, { kind: 'image', index: 0 }] })
    const second = bridge.stage(agent, { text: '/plan', images: [], files: [file] })
    const receipt = first.attachments[0]!, another = second.attachments[0]!
    expect(first.attachments.map(item => item.type)).toEqual(['file', 'image'])
    if (receipt.type !== 'file' || another.type !== 'file') throw new Error('Expected file receipts')
    expect(receipt.receiptId).not.toBe(another.receiptId)
    expect(resolve(agent, receipt.receiptId)).toEqual(file)
    expect(resolve(other, receipt.receiptId)).toBeUndefined()
    first.dispose()
    expect(resolve(agent, receipt.receiptId)).toBeUndefined()
    expect(resolve(agent, another.receiptId)).toEqual(file)
    bridge.dispose()
    expect(resolve(agent, another.receiptId)).toBeUndefined()
    expect(off).toHaveBeenCalledOnce()
  })

  it('uses published command admission for capabilities, ordering and expired receipts', async () => {
    const ctx = new Context()
    await ctx.plugin(CommandRuntime)
    const saveImages = vi.fn(async () => [{ ...image, attachmentId: AttachmentId('image:one'), bytes: 3, width: 1, height: 1 }])
    ctx.provide('attachments', { saveImages } as never)
    const agent = { session: Session.create(SessionId('receipt-test')) } as Agent
    const handler = vi.fn((_invocation: CommandInvocation) => ({ kind: 'success' as const }))
    ctx.commands.register({ name: 'accept', description: 'Accept', input: { hint: 'Task', attachments: true }, handler })
    ctx.commands.register({ name: 'plain', description: 'No attachments', handler })
    const bridge = new CommandAttachments(ctx.commands)
    const staged = bridge.stage(agent, { text: '/accept', images: [image], files: [file],
      segments: [{ kind: 'file', index: 0 }, { kind: 'image', index: 0 }] })
    try {
      const run = (line: string) => ctx.commands.execute(agent, line, staged.attachments, new AbortController().signal)
      expect((await run('/plain'))?.result).toMatchObject({ kind: 'error', text: '/plain does not accept attachments' })
      expect(handler).not.toHaveBeenCalled()
      expect(saveImages).not.toHaveBeenCalled()
      expect((await run('/accept'))?.result.kind).toBe('success')
      expect(handler.mock.calls[0]?.[0]).toMatchObject({ attachments: [{ type: 'file', attachment: file }, { type: 'image' }] })
      staged.dispose()
      expect((await run('/accept'))?.result.kind).toBe('error')
      expect(handler).toHaveBeenCalledOnce()
    } finally { staged.dispose(); bridge.dispose(); await ctx.fiber.dispose() }
  })
})
