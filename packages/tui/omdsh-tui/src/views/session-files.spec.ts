import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { logAttachments, sessionAttachments } from './session-files.ts'

const ref = { attachmentId: 'stored', name: 'report.txt', bytes: 5 }
const image = { attachmentId: 'generated', mediaType: 'image/png', bytes: 10, width: 1, height: 1 }
const file = { type: 'file', attachment: ref }
const part = { type: 'image', attachment: image }
const event = (type: string, data: unknown) => ({ type, data }) as SessionEvent

it('archives declared output and queued references without interpreting unrelated tool arguments', () => {
  const events = [
    event('user/message', { content: [file] }),
    event('tool/result', { message: { content: [part] } }),
    event('assistant/attempt', { stream: [{ type: 'chunk', chunk: { type: 'block-end', block: part } }] }),
    event('agent/inbox/spliced', { inserted: [{ content: [file] }] }),
    event('compaction/summary', { summary: [file], rawOutput: [part] }),
    event('tool/call', { arguments: { content: [{ type: 'file', attachment: { ...ref, attachmentId: 'fake' } }] } }),
    event('extension/opaque', { content: [{ type: 'file', attachment: { ...ref, attachmentId: 'opaque' } }] }),
  ]
  expect(logAttachments(events)).toEqual([ref, image])
  expect(sessionAttachments(events)).toEqual([ref])
})
