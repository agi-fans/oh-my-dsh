import sharp from 'sharp'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachFile } from './files.ts'
import * as filesCommand from './files.ts'
import type { TuiPrompt } from '../definition.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'omdsh-attach-')); roots.push(root)
  await writeFile(join(root, 'report.txt'), 'hello')
  const ref = { attachmentId: 'stored', name: 'report.txt', bytes: 5 }
  const stageFileAttachment = vi.fn()
  const saveFileStream = vi.fn(async (input: { data: AsyncIterable<Uint8Array> }) => {
    const chunks: Uint8Array[] = []
    for await (const chunk of input.data) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString()).toBe('hello')
    return ref
  })
  const ctx = new Context()
  ctx.provide('tui', { interactive: true, stageFileAttachment } as never)
  ctx.provide('attachments', { saveFileStream } as never)
  const abort = new AbortController()
  const invocation = { rawInput: 'report.txt', agent: { session: { header: { cwd: root } } }, signal: abort.signal } as unknown as CommandInvocation
  return { ctx, invocation, ref, stageFileAttachment, saveFileStream, abort }
}

describe('file attachment admission', () => {
  it('resolves attachments from the current directory while retaining the original project header', async () => {
    const h = await harness()
    const original = h.invocation.agent.session.header.cwd
    h.ctx.provide('workingDirectory', { get: () => original } as never)
    Object.assign(h.invocation.agent.session.header, { cwd: join(original!, 'old-project') })
    expect(await attachFile(h.ctx, h.invocation)).toMatchObject({ kind: 'success' })
    expect(h.stageFileAttachment).toHaveBeenCalledWith(h.ref)
    expect(h.invocation.agent.session.header.cwd).toBe(join(original!, 'old-project'))
    await h.ctx.fiber.dispose()
  })

  it('streams original bytes to storage and stages only a verified durable reference', async () => {
    const h = await harness()
    expect(await attachFile(h.ctx, h.invocation)).toMatchObject({ kind: 'success' })
    expect(h.stageFileAttachment).toHaveBeenCalledWith(h.ref)
    await h.ctx.fiber.dispose()
  })
  it('does not put a cancelled file into the composer after storage resolves', async () => {
    const h = await harness()
    h.saveFileStream.mockImplementationOnce(async input => {
      for await (const chunk of input.data) { void chunk }
      h.abort.abort(new Error('Cancelled'))
      return h.ref
    })
    await expect(attachFile(h.ctx, h.invocation)).rejects.toThrow('Cancelled')
    expect(h.stageFileAttachment).not.toHaveBeenCalled()
    await h.ctx.fiber.dispose()
  })
})

it('previews verified durable image bytes when the provider has no host path', async () => {
  const data = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#1569a5' } }).png().toBuffer()
  const ref = { attachmentId: 'stored-image', name: '中文.png', bytes: data.length, mediaType: 'image/png' }
  const ctx = new Context(), requests: TuiPrompt[] = []
  const answers = ['0', null, null]
  const readImage = vi.fn().mockResolvedValue({ ref, data })
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    ctx.provide('tui', { interactive: true, prompt: async (request: TuiPrompt) => { requests.push(request); return answers.shift() ?? null } } as never)
    ctx.provide('attachments', { readImage, imageHostPath: () => undefined } as never)
    await ctx.plugin(filesCommand)
    const session = ctx.sessions.create(SessionId('image-attachment-test'))
    session.append('user/message', { source: { kind: 'user' }, content: [{ type: 'image', attachment: ref }] } as never, { surfaceOp: 'append' })
    const abort = new AbortController()
    const result = await ctx.commands.execute({ id: session.id, session, status: 'idle' } as unknown as Agent, '/attach', [], abort.signal)
    expect(result).toMatchObject({ result: { kind: 'success' } })
    // Without a composer there is nothing to attach to, so the list stays a list.
    expect(requests[0]?.options?.map(option => option.value)).toEqual(['0'])
    expect(readImage).toHaveBeenCalledWith(ref, abort.signal)
    expect(requests[1]?.documentImage).toMatchObject({ width: 20, height: 10 })
    expect(requests[1]?.options?.map(option => option.value)).toEqual(['close'])
  } finally { await ctx.fiber.dispose() }
})

it('leads the attachment picker with Add when the composer can stage a draft', async () => {
  const ctx = new Context(), requests: TuiPrompt[] = []
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    ctx.provide('tui', { interactive: true, stageFileAttachment: vi.fn(), prompt: async (request: TuiPrompt) => {
      requests.push(request)
      return null
    } } as never)
    ctx.provide('attachments', {} as never)
    await ctx.plugin(filesCommand)
    const session = ctx.sessions.create(SessionId('attach-picker'))
    const result = await ctx.commands.execute(
      { id: session.id, session, status: 'idle' } as unknown as Agent, '/attach', [], new AbortController().signal)
    expect(result).toMatchObject({ result: { kind: 'success' } })
    // One gesture: the stored rows and the way to add another live together.
    expect(requests[0]?.options?.map(option => option.value)).toEqual(['add:'])
    expect(requests[0]?.question).toBe('Choose a stored attachment, or add a file')
  } finally { await ctx.fiber.dispose() }
})

it('retires the separate /attachments command', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    ctx.provide('tui', { interactive: false } as never)
    ctx.provide('attachments', {} as never)
    await ctx.plugin(filesCommand)
    const session = ctx.sessions.create(SessionId('retired-attachments'))
    const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
    // The name is gone rather than aliased: one surface, one spelling.
    expect(await ctx.commands.execute(agent, '/attachments', [], new AbortController().signal)).toBeUndefined()
    expect(await ctx.commands.execute(agent, '/attach', [], new AbortController().signal))
      .toMatchObject({ result: { kind: 'success', text: 'No attachments in this session.' } })
  } finally { await ctx.fiber.dispose() }
})
