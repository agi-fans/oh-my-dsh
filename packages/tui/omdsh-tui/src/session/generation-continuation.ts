/** Terminal eligibility derived from the latest durable turn, including cold replay. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'omdsh-retry': { kind: 'retry' }
  }
}

const recoverable = new Set(['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE', 'STREAM_CLOSED'])
const cache = new WeakMap<readonly SessionEvent[], number | null>()

/** Only failed model requests after admitted human work can continue without another prompt. */
export function continuableFailure(events: readonly SessionEvent[]): number | undefined {
  if (cache.has(events)) return cache.get(events) ?? undefined
  const end = events.findLastIndex(event => event.type === 'turn/start' || event.type === 'turn/end')
  const event = events[end]
  let result: number | undefined
  if (event?.type === 'turn/end' && event.data.reason.kind === 'error' && recoverable.has(event.data.reason.error.code)) {
    let admitted = false, failed: boolean | undefined
    for (let i = end - 1; i >= 0; i--) {
      const previous = events[i]!
      if (previous.type === 'turn/start' || previous.type === 'turn/end') break
      if (previous.type === 'user/message' && previous.surfaceOp === 'append') {
        admitted ||= previous.data.source.kind === 'user' && previous.data.content.length > 0
          || previous.data.source.kind === 'retry' && previous.data.content.length === 0
      }
      // The latest request step must have failed, rather than a tool or maintenance task.
      if (failed === undefined) {
        if (previous.type === 'assistant/attempt') failed = true
        else if (previous.type === 'step/start' || previous.type === 'assistant/message') failed = false
      }
    }
    if (admitted && failed) result = event.seq
  }
  cache.set(events, result ?? null)
  return result
}
