/** Durable file references shared by browsing and archive export. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-tool-present/types'

export function deliverableFiles(events: readonly SessionEvent[]): string[] {
  const paths: string[] = []
  for (const event of events) {
    if (event.type !== 'deliverables/presented') continue
    for (const file of event.data.files) paths.push(file.path)
  }
  return [...new Set(paths)]
}

export function sessionAttachments(events: readonly SessionEvent[]): (FileAttachmentRef | ImageAttachmentRef)[] {
  const refs = new Map<string, FileAttachmentRef | ImageAttachmentRef>()
  for (const event of events) {
    if (event.type !== 'user/message') continue
    for (const part of event.data.content) if (part.type === 'file' || part.type === 'image') refs.set(`${part.attachment.attachmentId}:${part.attachment.name ?? ''}`, part.attachment)
  }
  return [...refs.values()]
}

/** Collect stored references from declared log content, including generated output. */
export function logAttachments(events: readonly SessionEvent[]): (FileAttachmentRef | ImageAttachmentRef)[] {
  const refs = new Map<string, FileAttachmentRef | ImageAttachmentRef>()
  const content = (value: unknown): void => {
    if (!Array.isArray(value)) return
    for (const part of value) {
      if (part?.type !== 'image' && part?.type !== 'file') continue
      const ref = part.attachment
      if (ref === null || typeof ref !== 'object' || typeof ref.attachmentId !== 'string' || typeof ref.bytes !== 'number') continue
      if (part.type === 'file' && typeof ref.name !== 'string' || part.type === 'image' && typeof ref.mediaType !== 'string') continue
      refs.set(`${part.type}:${ref.attachmentId}:${ref.name ?? ''}`, ref as FileAttachmentRef | ImageAttachmentRef)
    }
  }
  for (const event of events) {
    const row = event as unknown as { type: string; data: {
      content?: unknown; message?: { content?: unknown }; inserted?: { content?: unknown }[];
      summary?: unknown; rawOutput?: unknown; stream?: { type: string; chunk?: { type: string; block?: unknown } }[];
    } }
    if (row.type === 'user/message' || row.type === 'tool/ptc-dispatch') content(row.data.content)
    else if (['system/message', 'developer/message', 'tool/result', 'team/message/queued'].includes(row.type)) content(row.data.message?.content)
    else if (row.type === 'agent/inbox/spliced') for (const message of row.data.inserted ?? []) content(message.content)
    else if (row.type === 'compaction/summary') { content(row.data.summary); content(row.data.rawOutput) }
    else if (row.type === 'assistant/message' || row.type === 'assistant/attempt') {
      content(row.data.message?.content)
      for (const record of row.data.stream ?? []) if (record.type === 'chunk' && record.chunk?.type === 'block-end') content([record.chunk.block])
    }
  }
  return [...refs.values()]
}
