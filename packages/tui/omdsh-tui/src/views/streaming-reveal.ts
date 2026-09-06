/**
 * Pure, grapheme-safe reveal projection for the latest streaming assistant block.
 * The durable transcript always retains the complete provider payload; this
 * module only limits the text handed to the renderer between stream frames.
 * @module @agi-fans/dsh-tui
 */

import type { TranscriptState } from './event-views.ts'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

// One-slot segmentation cache: the latest streaming block is the only text
// sliced per reveal tick, so caching its grapheme list keeps a long stream
// linear instead of re-segmenting the growing answer every frame.
const partsCache: { text: string; parts: string[] } = { text: '', parts: [] }

function graphemes(text: string): string[] {
  if (text === partsCache.text) return partsCache.parts
  partsCache.text = text
  partsCache.parts = [...segmenter.segment(text)].map(item => item.segment)
  return partsCache.parts
}

/** Count user-visible text units without splitting emoji or combining marks. */
export function revealUnitCount(text: string): number {
  let count = 0
  for (const _ of segmenter.segment(text)) count += 1
  return count
}

/** Reveal enough units to catch an eight-frame backlog, with a small floor. */
export function nextRevealStep(backlog: number): number {
  return Math.max(3, Math.ceil(Math.max(0, backlog) / 8))
}

/** Identity of the latest streaming assistant block, if one exists. */
export function streamingAssistantKey(state: TranscriptState): string | undefined {
  const block = state.blocks.at(-1)
  return block?.kind === 'assistant' && block.streaming ? `${block.turn}:${block.step}` : undefined
}

/** Total reveal units in the latest streaming block, reasoning before prose. */
export function streamingAssistantUnits(state: TranscriptState): number {
  const block = state.blocks.at(-1)
  if (block?.kind !== 'assistant' || !block.streaming) return 0
  return revealUnitCount(block.reasoning) + revealUnitCount(block.text)
}

function revealText(text: string, units: number): string {
  if (units <= 0 || text === '') return ''
  const parts = graphemes(text)
  return units >= parts.length ? text : parts.slice(0, units).join('')
}

/**
 * Return a render-only transcript projection with the latest assistant stream
 * limited to `revealed` graphemes. Earlier and settled blocks retain identity.
 */
export function revealStreamingAssistant(state: TranscriptState, revealed: number): TranscriptState {
  const block = state.blocks.at(-1)
  if (block?.kind !== 'assistant' || !block.streaming) return state
  const reasoningUnits = revealUnitCount(block.reasoning)
  const visible = Math.max(0, Math.floor(revealed))
  const reasoning = revealText(block.reasoning, visible)
  const text = revealText(block.text, Math.max(0, visible - reasoningUnits))
  if (reasoning === block.reasoning && text === block.text) return state
  return {
    ...state,
    blocks: [...state.blocks.slice(0, -1), { ...block, reasoning, text }],
  }
}
