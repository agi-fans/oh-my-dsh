import { describe, expect, it } from 'vitest'
import { LiveAttemptTracker } from './live-attempt-tracker.ts'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

const KEY = 'session-1:attempt-1'

function text(rev: number, index: number, text: string): { revision: number; index: number; time: number; chunk: StreamChunk } {
  return { revision: rev, index, time: rev * 10, chunk: { type: 'text-delta', index, text } }
}

describe('LiveAttemptTracker', () => {
  it('folds a real start/chunk/end sequence with advancing revisions', () => {
    const tracker = new LiveAttemptTracker()
    tracker.start(KEY, { revision: 1, turn: 1, step: 1 })
    expect(tracker.chunk(KEY, text(2, 0, 'a'))).toEqual({ turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } })
    expect(tracker.chunk(KEY, text(3, 1, 'b'))).toEqual({ turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: 'b' } })
    expect(tracker.deltas(KEY)).toHaveLength(2)
    tracker.end(KEY)
    expect(tracker.activeKeys().next().done).toBe(true)
  })

  it('drops a chunk whose revision equals the start revision (sequence starts at start+1)', () => {
    const tracker = new LiveAttemptTracker()
    tracker.start(KEY, { revision: 1, turn: 1, step: 1 })
    expect(tracker.chunk(KEY, text(1, 0, 'x'))).toBeUndefined()
    expect(tracker.activeKeys().next().done).toBe(true)
    // A later chunk without a new start is dropped too.
    expect(tracker.chunk(KEY, text(2, 0, 'y'))).toBeUndefined()
  })

  it('drops and clears on a revision gap or an index gap', () => {
    const tracker = new LiveAttemptTracker()
    tracker.start(KEY, { revision: 5, turn: 2, step: 3 })
    expect(tracker.chunk(KEY, text(7, 0, 'skip-a-revision'))).toBeUndefined()
    tracker.start(KEY, { revision: 8, turn: 2, step: 3 })
    expect(tracker.chunk(KEY, text(9, 0, 'a'))).toBeDefined()
    expect(tracker.chunk(KEY, text(10, 2, 'index-gap'))).toBeUndefined()
    expect(tracker.deltas(KEY)).toHaveLength(0)
  })

  it('drops chunks without a start frame and on an unknown key', () => {
    const tracker = new LiveAttemptTracker()
    expect(tracker.chunk(KEY, text(1, 0, 'orphan'))).toBeUndefined()
    tracker.start('session-1:attempt-2', { revision: 1, turn: 1, step: 1 })
    expect(tracker.chunk(KEY, text(2, 0, 'stale'))).toBeUndefined()
  })

  it('buffers deltas for transcript rebuild and restarts cleanly per attempt', () => {
    const tracker = new LiveAttemptTracker()
    tracker.start(KEY, { revision: 1, turn: 1, step: 1 })
    tracker.chunk(KEY, text(2, 0, 'p'))
    tracker.chunk(KEY, text(3, 1, 'q'))
    tracker.end(KEY)
    expect(tracker.deltas(KEY)).toHaveLength(0)
    tracker.start(KEY, { revision: 4, turn: 1, step: 1 })
    expect(tracker.chunk(KEY, text(5, 0, 'r'))?.chunk.text).toBe('r')
    expect(tracker.deltas(KEY)).toHaveLength(1)
  })
})
