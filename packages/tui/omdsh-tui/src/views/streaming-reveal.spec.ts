import { describe, expect, it } from 'vitest'
import { oracleClusters } from '../chrome/width.oracle.ts'
import { initialTranscript, type TranscriptState } from './event-views.ts'
import {
  nextRevealStep,
  revealStreamingAssistant,
  revealUnitCount,
  streamingAssistantKey,
  streamingAssistantUnits,
} from './streaming-reveal.ts'

function streaming(reasoning: string, text: string): TranscriptState {
  return {
    ...initialTranscript(),
    status: 'running',
    blocks: [{ kind: 'assistant', turn: 2, step: 3, reasoning, text, streaming: true }],
  }
}

describe('streaming reveal', () => {
  it('counts and slices grapheme clusters without splitting visible characters', () => {
    const state = streaming('想💭', 'e\u0301好')
    expect(revealUnitCount('想💭e\u0301好')).toBe(4)
    expect(streamingAssistantKey(state)).toBe('2:3')
    expect(streamingAssistantUnits(state)).toBe(4)
    expect(revealStreamingAssistant(state, 1).blocks.at(-1)).toMatchObject({ reasoning: '想', text: '' })
    expect(revealStreamingAssistant(state, 3).blocks.at(-1)).toMatchObject({ reasoning: '想💭', text: 'e\u0301' })
  })

  it('catches up in bounded frames and preserves settled state identity', () => {
    expect(nextRevealStep(0)).toBe(3)
    expect(nextRevealStep(80)).toBe(10)
    const settled = initialTranscript()
    expect(revealStreamingAssistant(settled, 1)).toBe(settled)
  })
})

describe('streaming reveal cost', () => {
  it('keeps incremental counts equal to a fresh segmentation', () => {
    const full = '中文 emoji 🚀 reasoning '.repeat(40)
    // Climbing lengths exercise the append path, where only the final cluster
    // may differ from the previously counted prefix.
    for (const length of [1, 3, 17, 200, 999, full.length]) {
      const slice = full.slice(0, length)
      expect(revealUnitCount(slice), `length ${length}`).toBe(oracleClusters(slice).length)
    }
  })

  it('counts an appending answer at the cost of the appended text', () => {
    // 121,000 revealed characters with a small delta per tick. Re-counting the
    // whole answer measured 2.9 ms per tick at this size, once per frame.
    const revealed = '中文 emoji 🚀 reasoning '.repeat(5500)
    const withTail = (extra: number): string => revealed + 'x'.repeat(extra)
    revealUnitCount(withTail(0))

    const started = performance.now()
    for (let tick = 1; tick <= 20; tick += 1) revealUnitCount(withTail(tick * 30))
    const perTick = (performance.now() - started) / 20

    expect(perTick).toBeLessThan(0.5)
    expect(revealUnitCount(withTail(600))).toBe(oracleClusters(withTail(600)).length)
  })
})
