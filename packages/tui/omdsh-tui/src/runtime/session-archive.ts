/** Portable logical logs, descendant sessions, and verified attachment bytes. */

import { basename } from 'node:path'
import { strToU8, zip } from 'fflate'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { logAttachments } from '../views/session-files.ts'

export const ARCHIVE_MAX_BYTES = 64 * 1024 * 1024

export async function sessionArchive(ctx: Context, agent: Agent, signal: AbortSignal): Promise<Uint8Array> {
  const sessions = ctx.get('sessions')
  const storage = ctx.get('sessionPersistence')
  const attachmentStore = ctx.get('attachments')
  if (sessions === undefined || storage === undefined) throw new Error('Session persistence is required to create an archive.')
  await sessions.flush(agent.session)
  const snapshots = await storage.list({ signal })
  const ids = new Set<string>([agent.id])
  let added = true
  while (added) {
    added = false
    for (const snapshot of snapshots) if (snapshot.header.origin === 'subagent' && snapshot.header.parentSession !== undefined
      && ids.has(snapshot.header.parentSession) && !ids.has(snapshot.header.id)) { ids.add(snapshot.header.id); added = true }
  }
  const files: Record<string, Uint8Array> = {}
  const attachments = new Map<string, FileAttachmentRef | ImageAttachmentRef>()
  const manifest: { id: string; events: number; inheritedEventCount: number }[] = []
  let bytes = 0
  const admit = (data: Uint8Array): Uint8Array => {
    bytes += data.length
    if (bytes > ARCHIVE_MAX_BYTES) throw new Error('Session archive exceeds the 64 MiB uncompressed limit. No archive was written.')
    signal.throwIfAborted()
    return data
  }
  for (const id of ids) {
    const live = sessions.get(SessionId(id))
    if (live !== undefined) await sessions.flush(live)
    const handle = await storage.open(SessionId(id), 'read', { signal })
    try {
      const chunks = [admit(strToU8(JSON.stringify(handle.header) + '\n'))]
      let offset = 0
      const count = (await storage.stat(SessionId(id), { signal }))?.eventCount
      while (true) {
        const length = count === undefined ? 256 : Math.min(256, count - offset)
        if (length <= 0) break
        const page = await handle.read(offset, length, { signal })
        for (const event of page.events) chunks.push(admit(strToU8(JSON.stringify(event) + '\n')))
        for (const ref of logAttachments(page.events)) attachments.set(`${'mediaType' in ref ? 'image' : 'file'}:${ref.attachmentId}/${ref.name ?? 'image'}`, ref)
        offset += page.events.length
        if (page.events.length < length) break
      }
      const log = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
      let at = 0
      for (const chunk of chunks) { log.set(chunk, at); at += chunk.length }
      // Ids are opaque; an ordinal filename prevents path interpretation.
      const ordinal = String(manifest.length + 1).padStart(4, '0')
      files[`sessions/${ordinal}.jsonl`] = log
      manifest.push({ id, events: offset, inheritedEventCount: Number(handle.inheritedEventCount) })
    } finally { await handle.close() }
  }
  if (attachments.size > 0 && attachmentStore === undefined) throw new Error('Attachment storage is required to create a complete archive.')
  const archivedAttachments: { ref: FileAttachmentRef | ImageAttachmentRef; path: string }[] = []
  for (const ref of attachments.values()) {
    const name = basename((ref.name ?? 'image').replaceAll('\\', '/'))
    const path = `attachments/${String(archivedAttachments.length + 1).padStart(4, '0')}/${name === '' || name === '.' || name === '..' ? 'file' : name}`
    archivedAttachments.push({ ref, path })
    if ('mediaType' in ref) files[path] = admit((await attachmentStore!.readImage(ref, signal)).data)
    else {
      const chunks: Uint8Array[] = []
      for await (const chunk of attachmentStore!.readFileStream(ref, signal)) chunks.push(admit(chunk))
      const data = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
      let at = 0
      for (const chunk of chunks) { data.set(chunk, at); at += chunk.length }
      files[path] = data
    }
  }
  files['manifest.json'] = admit(strToU8(JSON.stringify({ format: 'omdsh-session-archive', version: 1, rootSession: agent.id,
    sessions: manifest, attachments: archivedAttachments, capturedAt: new Date().toISOString() }, null, 2)))
  files['README.txt'] = admit(strToU8('Logical session headers and validated JSONL events, plus original attachments.\nThis archive is for backup and inspection; it is not an automatic session import.\nRunning sessions are captured individually at read time, not as an atomic multi-session snapshot.\nLogs and attachments are not redacted and may contain private data.\n'))
  signal.throwIfAborted()
  return new Promise<Uint8Array>((resolve, reject) => {
    const cancel = zip(files, { level: 6 }, (error, data) => {
      signal.removeEventListener('abort', abort)
      if (error !== null) reject(error)
      else resolve(data)
    })
    const abort = (): void => { cancel(); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}
