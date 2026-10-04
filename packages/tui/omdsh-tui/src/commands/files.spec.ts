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
  const ctx = { tui: { interactive: true, stageFileAttachment }, attachments: { saveFileStream } } as unknown as Context
  const abort = new AbortController()
  const invocation = { rawInput: 'report.txt', agent: { session: { header: { cwd: root } } }, signal: abort.signal } as unknown as CommandInvocation
  return { ctx, invocation, ref, stageFileAttachment, saveFileStream, abort }
}

describe('file attachment admission', () => {
  it('streams original bytes to storage and stages only a verified durable reference', async () => {
    const h = await harness()
    expect(await attachFile(h.ctx, h.invocation)).toMatchObject({ kind: 'success' })
    expect(h.stageFileAttachment).toHaveBeenCalledWith(h.ref)
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
  })
})

describe('file browsing actions', () => {
  it('reviews sibling files and returns to the directory instead of reopening a one-file list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omdsh-browse-')); roots.push(root)
    await writeFile(join(root, 'a.txt'), 'File A')
    await writeFile(join(root, 'b.txt'), 'File B')
    const ctx = new Context()
    const requests: TuiPrompt[] = []
    const answers = ['next', 'previous', 'files', null, null]
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(CommandRuntime)
      ctx.provide('tui', { interactive: true, notice: () => {}, prompt: async (request: TuiPrompt) => { requests.push(request); return answers.shift() ?? null } } as never)
      ctx.provide('attachments', {} as never)
      await ctx.plugin(filesCommand)
      const session = ctx.sessions.create(SessionId('file-browser'), { meta: { cwd: root } })
      await ctx.commands.execute({ id: session.id, session, status: 'idle' } as unknown as Agent, '/files a.txt', [], new AbortController().signal)
      expect(requests[0]?.detail).toContain('File A')
      expect(requests[1]?.detail).toContain('File B')
      expect(requests[2]?.detail).toContain('File A')
      expect(requests[3]?.options?.map(option => option.label)).toEqual(['a.txt', 'b.txt'])
      expect(requests[4]?.title).toBe(`Files · ${root}`)
    } finally { await ctx.fiber.dispose() }
  })
})
