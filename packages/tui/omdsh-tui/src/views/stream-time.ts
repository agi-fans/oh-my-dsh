/**
 * First-token derivation shared by session stats and /trajectory.
 *
 * Format-v2 assistant events embed the exact timed model stream
 * (`AssistantStreamRecord[]`). Both consumers derive the first visible token
 * boundary from it; a malformed or stub stream degrades to `undefined`
 * instead of failing the caller's fold.
 * @module @agi-fans/dsh-tui/stream-time
 */

import { expandAssistantStream, type AssistantStreamRecord, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Whether a stream chunk establishes the first visible model-output boundary. */
export function isVisibleModelDelta(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text !== ''
    case 'tool-call-delta':
      return chunk.argumentsDelta !== '' || chunk.name !== undefined
    default:
      return false
  }
}

/** First visible token time of an embedded stream, or undefined when absent or malformed. */
export function firstVisibleStreamTime(stream: readonly AssistantStreamRecord[]): number | undefined {
  try {
    return expandAssistantStream(stream).find(entry => isVisibleModelDelta(entry.chunk))?.time
  } catch {
    return undefined
  }
}
