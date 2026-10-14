import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { ARCHIVE_MAX_BYTES, importSessionArchive, sessionArchive } from './session-archive.ts'

function harness() {
  const ref = { attachmentId: '../opaque-id', name: '..\\report.txt', bytes: 5 }
  const headers = [
    { id: 'grandchild', origin: 'subagent', parentSession: 'child' },
    { id: 'root' }, { id: 'child', origin: 'subagent', parentSession: 'root' },
    { id: 'unrelated', origin: 'subagent', parentSession: 'elsewhere' },
  ]
  const message = { type: 'user/message', data: { content: [{ type: 'file', attachment: ref }] } } as unknown as SessionEvent
  const close = vi.fn(async () => {})
  const read = vi.fn(async (offset: number, count: number) => ({ events: Array.from({ length: Math.min(count, 270 - offset) }, () => message) }))
  const storage = {
    list: vi.fn(async () => headers.map(header => ({ header }))),
    stat: vi.fn(async () => ({ eventCount: 270 })),
    open: vi.fn(async (id: string) => ({ header: headers.find(header => header.id === id), inheritedEventCount: 0, read, close })),
  }
  const attachments = { readFileStream: vi.fn(async function* () { yield new TextEncoder().encode('hello') }) }
  const ctx = { sessionPersistence: storage, sessions: { flush: vi.fn(async () => {}), get: () => undefined }, attachments,
    get: (name: string) => name === 'attachments' ? attachments : name === 'sessionPersistence' ? storage : { flush: vi.fn(async () => {}), get: () => undefined } } as unknown as Context
  const agent = { id: 'root', session: {} } as unknown as Agent
  return { ctx, agent, storage, attachments, read, close }
}

describe('portable session archive', () => {
  it('pages root and descendant logical logs, deduplicates bytes, and keeps opaque ids out of paths', async () => {
    const h = harness()
    const files = unzipSync(await sessionArchive(h.ctx, h.agent, new AbortController().signal))
    const manifest = JSON.parse(strFromU8(files['manifest.json']!))
    expect(manifest.sessions.map((session: { id: string }) => session.id)).toEqual(['root', 'child', 'grandchild'])
    expect(manifest.attachments[0].path).toBe('attachments/0001/report.txt')
    expect(strFromU8(files[manifest.attachments[0].path]!)).toBe('hello')
    expect(strFromU8(files['sessions/0001.jsonl']!).trimEnd().split('\n')).toHaveLength(271)
    expect(h.read).toHaveBeenCalledWith(256, 14, expect.anything())
    expect(h.attachments.readFileStream).toHaveBeenCalledOnce()
    expect(h.close).toHaveBeenCalledTimes(3)
    expect(Object.keys(files).some(path => path.includes('..'))).toBe(false)
  })
  it('closes read handles on failure and rejects oversized attachments before returning an archive', async () => {
    const h = harness()
    h.read.mockRejectedValueOnce(new Error('Read failed'))
    await expect(sessionArchive(h.ctx, h.agent, new AbortController().signal)).rejects.toThrow('Read failed')
    expect(h.close).toHaveBeenCalledOnce()
    const big = harness()
    big.attachments.readFileStream.mockImplementation(async function* () { yield new Uint8Array(ARCHIVE_MAX_BYTES) })
    await expect(sessionArchive(big.ctx, big.agent, new AbortController().signal)).rejects.toThrow('64 MiB')
    expect(big.close).toHaveBeenCalledTimes(3)
  })
  it('honors cancellation before archive compression', async () => {
    const h = harness(), abort = new AbortController()
    abort.abort(new Error('Cancelled'))
    await expect(sessionArchive(h.ctx, h.agent, abort.signal)).rejects.toThrow('Cancelled')
    expect(h.close).toHaveBeenCalledOnce()
  })
  it('imports a portable session archive, remapping attachments and writing sessions to persistence', async () => {
    const h = harness()
    const zipBytes = await sessionArchive(h.ctx, h.agent, new AbortController().signal)
    const append = vi.fn(async () => undefined)
    const close = vi.fn(async () => undefined)
    const create = vi.fn(async () => ({ append, close }))
    const saveFile = vi.fn(async () => ({ attachmentId: 'new-att-id', bytes: 5 }))
    const destStorage = {
      stat: vi.fn(async () => undefined),
      create,
    }
    const destCtx = {
      sessionPersistence: destStorage,
      attachments: { saveFile },
      get: (name: string) => name === 'sessionPersistence' ? destStorage : name === 'attachments' ? { saveFile } : undefined,
    } as unknown as Context
    const result = await importSessionArchive(destCtx, zipBytes, new AbortController().signal)
    expect(result).toEqual({ rootSession: 'root', importedSessions: 3, importedAttachments: 1 })
    expect(saveFile).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledTimes(3)
    expect(append).toHaveBeenCalledTimes(3)
    expect(close).toHaveBeenCalledTimes(3)
  })
  it('rejects importing when a session ID already exists or the archive is invalid', async () => {
    const h = harness()
    const zipBytes = await sessionArchive(h.ctx, h.agent, new AbortController().signal)
    const existingStorage = { stat: vi.fn(async () => ({ eventCount: 1 })) }
    const existingAttachments = { saveFile: vi.fn() }
    const existingCtx = {
      sessionPersistence: existingStorage,
      attachments: existingAttachments,
      get: (name: string) => name === 'sessionPersistence' ? existingStorage : name === 'attachments' ? existingAttachments : undefined,
    } as unknown as Context
    await expect(importSessionArchive(existingCtx, zipBytes, new AbortController().signal))
      .rejects.toThrow('already exists in local storage')
    const invalidZip = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'wrong' })) })
    await expect(importSessionArchive(existingCtx, invalidZip, new AbortController().signal))
      .rejects.toThrow('Unsupported session archive format or version.')
  })
})
