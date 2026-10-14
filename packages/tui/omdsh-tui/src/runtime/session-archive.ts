/** Portable logical logs, descendant sessions, and verified attachment bytes. */

import { basename } from 'node:path'
import { strFromU8, strToU8, unzip, zip } from 'fflate'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, SessionLogOffset, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { logAttachments } from '../views/session-files.ts'

export const ARCHIVE_MAX_BYTES = 64 * 1024 * 1024

export interface ImportedSessionArchive {
  rootSession: string
  importedSessions: number
  importedAttachments: number
}

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
  files['README.txt'] = admit(strToU8('Logical session headers and validated JSONL events, plus original attachments.\nThis archive is for backup, inspection, and restoration via /import.\nRunning sessions are captured individually at read time, not as an atomic multi-session snapshot.\nLogs and attachments are not redacted and may contain private data.\n'))
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

export async function importSessionArchive(
  ctx: Context,
  archiveBytes: Uint8Array,
  signal: AbortSignal,
): Promise<ImportedSessionArchive> {
  const storage = ctx.get('sessionPersistence')
  const attachmentStore = ctx.get('attachments')
  if (storage === undefined) throw new Error('Session persistence is required to import an archive.')
  if (archiveBytes.length > ARCHIVE_MAX_BYTES) {
    throw new Error('Session archive exceeds the 64 MiB limit.')
  }
  signal.throwIfAborted()
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    let uncompressedBytes = 0
    const cancel = unzip(archiveBytes, {
      filter: (file) => {
        uncompressedBytes += file.originalSize
        if (uncompressedBytes > ARCHIVE_MAX_BYTES) {
          throw new Error('Session archive exceeds the 64 MiB uncompressed limit.')
        }
        return true
      },
    }, (error, unpacked) => {
      signal.removeEventListener('abort', abort)
      if (error !== null) reject(error)
      else resolve(unpacked)
    })
    const abort = (): void => { cancel(); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  const totalBytes = Object.values(files).reduce((sum, entry) => sum + entry.length, 0)
  if (totalBytes > ARCHIVE_MAX_BYTES) {
    throw new Error('Session archive exceeds the 64 MiB uncompressed limit.')
  }
  const manifestBytes = files['manifest.json']
  if (manifestBytes === undefined) throw new Error('Invalid session archive: missing manifest.json.')
  const manifest = JSON.parse(strFromU8(manifestBytes)) as {
    format?: unknown
    version?: unknown
    rootSession?: unknown
    sessions?: { id?: unknown; events?: unknown; inheritedEventCount?: unknown }[]
    attachments?: { ref?: FileAttachmentRef | ImageAttachmentRef; path?: unknown }[]
  }
  if (manifest.format !== 'omdsh-session-archive' || manifest.version !== 1) {
    throw new Error('Unsupported session archive format or version.')
  }
  if (typeof manifest.rootSession !== 'string' || manifest.rootSession.trim() === '') {
    throw new Error('Invalid session archive: missing rootSession.')
  }
  if (!Array.isArray(manifest.sessions) || manifest.sessions.length === 0) {
    throw new Error('Invalid session archive: no sessions listed in manifest.')
  }
  const attachments = Array.isArray(manifest.attachments) ? manifest.attachments : []
  if (attachments.length > 0 && attachmentStore === undefined) {
    throw new Error('Attachment storage is required to import an archive with attachments.')
  }
  const parsedSessions: {
    header: SessionHeader
    events: SessionEvent[]
    inheritedEventCount: number
  }[] = []
  for (let index = 0; index < manifest.sessions.length; index += 1) {
    signal.throwIfAborted()
    const item = manifest.sessions[index]!
    if (typeof item.id !== 'string' || item.id === '') {
      throw new Error('Invalid session archive: session entry is missing an id.')
    }
    const existing = await storage.stat(SessionId(item.id), { signal })
    if (existing !== undefined) {
      throw new Error(`Session ${item.id} already exists in local storage.`)
    }
    const ordinal = String(index + 1).padStart(4, '0')
    const rawLog = files[`sessions/${ordinal}.jsonl`]
    if (rawLog === undefined) {
      throw new Error(`Invalid session archive: missing sessions/${ordinal}.jsonl.`)
    }
    const lines = strFromU8(rawLog).split('\n').filter(line => line.trim() !== '')
    if (lines.length === 0) {
      throw new Error(`Invalid session archive: empty sessions/${ordinal}.jsonl.`)
    }
    const header = JSON.parse(lines[0]!) as SessionHeader
    if (header.id !== item.id) {
      throw new Error(`Invalid session archive: header id mismatch in sessions/${ordinal}.jsonl.`)
    }
    const events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
    const inheritedEventCount = typeof item.inheritedEventCount === 'number' && item.inheritedEventCount > 0
      ? item.inheritedEventCount
      : 0
    parsedSessions.push({ header, events, inheritedEventCount })
  }
  for (const entry of attachments) {
    signal.throwIfAborted()
    if (entry.ref === undefined || typeof entry.path !== 'string' || entry.path.includes('..')) {
      throw new Error('Invalid session archive: malformed attachment entry.')
    }
    const data = files[entry.path]
    if (data === undefined) {
      throw new Error(`Invalid session archive: missing attachment ${entry.path}.`)
    }
    if ('mediaType' in entry.ref) {
      await attachmentStore!.saveImage({
        data,
        mediaType: entry.ref.mediaType,
        ...(entry.ref.name === undefined ? {} : { name: entry.ref.name }),
      })
    } else {
      await attachmentStore!.saveFile({
        data,
        ...(entry.ref.name === undefined ? {} : { name: entry.ref.name }),
      })
    }
  }
  for (const session of parsedSessions) {
    signal.throwIfAborted()
    const handle = await storage.create(session.header, {
      ...(session.inheritedEventCount > 0 ? { inheritedEventCount: SessionLogOffset(session.inheritedEventCount) } : {}),
      signal,
    })
    try {
      if (session.events.length > 0) {
        await handle.append(session.events, { signal })
      }
    } finally {
      await handle.close()
    }
  }
  return {
    rootSession: manifest.rootSession,
    importedSessions: parsedSessions.length,
    importedAttachments: attachments.length,
  }
}
