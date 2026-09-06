/**
 * Dense `agent/assistant-stream` frame state for live transcript folding.
 *
 * Upstream advances `revision` on every emitted frame (start, each chunk, and
 * end) and `index` per chunk, dense from zero. A real run therefore delivers
 * start(rev N, index -), chunk(rev N+1, index 0), chunk(rev N+2, index 1), …
 * and end(rev N+k+1). The tracker keeps the per-attempt continuation state,
 * buffers every accepted delta for transcript rebuilds, and drops the stream
 * on a revision or index gap until the next start frame.
 * @module @agi-fans/dsh-tui/live-attempt-tracker
 */

import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { StreamDelta } from '../views/event-views.ts'

interface LiveAttempt {
  readonly turn: number
  readonly step: number
  readonly deltas: StreamDelta[]
  nextRevision: number
  nextIndex: number
}

/**
 * One keyed attempt at a time per agent session; the caller owns the key
 * (`${sessionId}:${attemptId}`) and the frame routing.
 */
export class LiveAttemptTracker {
  readonly #attempts = new Map<string, LiveAttempt>()

  /** Record the opening start frame, replacing any prior attempt under the same key. */
  start(key: string, frame: { readonly revision: number; readonly turn: number; readonly step: number }): void {
    this.#attempts.set(key, {
      turn: frame.turn,
      step: frame.step,
      deltas: [],
      nextRevision: frame.revision + 1,
      nextIndex: 0,
    })
  }

  /**
   * Fold one chunk frame.
   * @returns the live delta to present, or `undefined` when the frame broke
   *   continuation (revision jump or index gap) and the attempt was dropped.
   */
  chunk(key: string, frame: {
    readonly revision: number
    readonly index: number
    readonly time: number
    readonly chunk: StreamChunk
  }): StreamDelta | undefined {
    const attempt = this.#attempts.get(key)
    if (attempt === undefined || frame.revision !== attempt.nextRevision || frame.index !== attempt.nextIndex) {
      this.#attempts.delete(key)
      return undefined
    }
    attempt.nextRevision += 1
    attempt.nextIndex += 1
    const delta: StreamDelta = { turn: attempt.turn, step: attempt.step, chunk: frame.chunk }
    attempt.deltas.push(delta)
    return delta
  }

  /** Clear one attempt at its end frame or disposal. */
  end(key: string): void {
    this.#attempts.delete(key)
  }

  /** Buffered deltas for one attempt, for replaying a rebuilt transcript. */
  deltas(key: string): readonly StreamDelta[] {
    return this.#attempts.get(key)?.deltas ?? []
  }

  /** Live attempt keys currently tracked. */
  activeKeys(): IterableIterator<string> {
    return this.#attempts.keys()
  }
}
