import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { formatTranscriptMarkdown } from './transcript-export.ts'

describe('formatTranscriptMarkdown', () => {
  it('exports semantic events in order and omits structural boundaries', () => {
    const events = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'image', attachment: { width: 20, height: 10, mediaType: 'image/png' } }] } },
      { type: 'tool/call', data: { name: 'bash', arguments: '{"command":"pwd"}' } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done' }] } } },
    ] as unknown as SessionEvent[]
    const text = formatTranscriptMarkdown('session-1', 'Work log', events)
    expect(text).toContain('# Work log')
    expect(text).toContain('Session: `session-1`')
    expect(text).toContain('## User\n\nhello')
    expect(text).toContain('## Tool call: bash')
    expect(text).toContain('[image 20×10 · image/png]')
    expect(text).toContain('## Assistant\n\ndone')
    expect(text).not.toContain('turn/start')
  })
})
