import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { continuableFailure } from './generation-continuation.ts'

function event(type: string, data: unknown = {}, seq = 1, surfaceOp = 'append'): SessionEvent {
  return { type, data, seq, surfaceOp } as SessionEvent
}
const human = event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] })
const attempt = event('assistant/attempt')
const end = (code = 'SERVER') => event('turn/end', { reason: { kind: 'error', error: { code } } }, 9)
const failed = () => [event('turn/start'), human, event('step/start'), attempt, end()]

describe('durable generation continuation', () => {
  it.each(['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE', 'STREAM_CLOSED'])('accepts exhausted %s failures, including cold replay', code => {
    const events = [...failed().slice(0, -1), end(code)]
    expect(continuableFailure(events)).toBe(9)
    expect(continuableFailure(JSON.parse(JSON.stringify(events)))).toBe(9)
  })
  it.each(['AUTH', 'INVALID_REQUEST', 'CONTEXT_OVERFLOW', 'API_ERROR', 'TOOL_ERROR'])('rejects permanent or unrelated %s failures', code => {
    expect(continuableFailure([...failed().slice(0, -1), end(code)])).toBeUndefined()
  })
  it.each(['completed', 'aborted', 'interrupted', 'max-tokens', 'blocked'])('does not continue %s turns', kind => {
    expect(continuableFailure([...failed().slice(0, -1), event('turn/end', { reason: { kind } })])).toBeUndefined()
  })
  it('requires human input admitted in this turn and a failed final request', () => {
    expect(continuableFailure([human, event('turn/start'), attempt, end()])).toBeUndefined()
    expect(continuableFailure([event('turn/start'), { ...human, surfaceOp: 'replace' } as SessionEvent, attempt, end()])).toBeUndefined()
    expect(continuableFailure([event('turn/start'), human, end()])).toBeUndefined()
    for (const reset of ['step/start', 'assistant/message']) {
      expect(continuableFailure([...failed().slice(0, -1), event(reset), end()])).toBeUndefined()
    }
  })
  it('allows another continuation after an empty retry fails, but never empty human or plugin input', () => {
    for (const kind of ['retry', 'user', 'plugin']) {
      const events = [event('turn/start'), event('user/message', { source: { kind }, content: [] }), attempt, end()]
      expect(continuableFailure(events)).toBe(kind === 'retry' ? 9 : undefined)
    }
  })
  it('invalidates the old failure on a new turn while preserving immutable snapshots', () => {
    const old = failed()
    expect(continuableFailure(old)).toBe(9)
    expect(continuableFailure([...old, event('turn/start')])).toBeUndefined()
    expect(continuableFailure([...old, event('turn/start'), end()])).toBeUndefined()
    expect(continuableFailure(old)).toBe(9)
  })
})
