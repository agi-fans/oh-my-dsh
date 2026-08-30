import { describe, expect, it } from 'vitest'
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
