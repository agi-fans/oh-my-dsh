/**
 * Pure, grapheme-safe reveal projection for the latest streaming assistant block.
 * The durable transcript always retains the complete provider payload; this
 * module only limits the text handed to the renderer between stream frames.
 * @module @agi-fans/dsh-tui
 */

import type { TranscriptState } from './event-views.ts'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Counts for recently seen texts. A reveal tick reads the same growing text two
 * or three times in a row — total units, then the reasoning share — so a few
 * slots are needed because reasoning and prose are counted alternately and a
 * single slot would be evicted by the other on every call. These hold counts
 * only, unlike the previous 32-entry cache of whole cluster arrays, which kept
 * dozens of full-text copies alive for a long answer.
 */
interface CountEntry {
  readonly text: string
  readonly count: number
  /** Offset of this text's final cluster, where an append must re-count from. */
  readonly lastStart: number
  /** Cluster count before `lastStart`. */
  readonly countBeforeLast: number
}

const countCache: CountEntry[] = []
const COUNT_CACHE_SLOTS = 4

function remember(entry: CountEntry): number {
  countCache.unshift(entry)
  if (countCache.length > COUNT_CACHE_SLOTS) countCache.pop()
  return entry.count
}

function countAll(text: string): CountEntry {
  let count = 0
  let lastStart = 0
  let countBeforeLast = 0
  for (const part of segmenter.segment(text)) {
    countBeforeLast = count
    lastStart = part.index
    count += 1
  }
  return { text, count, lastStart, countBeforeLast }
}

/** Count user-visible text units without splitting emoji or combining marks. */
export function revealUnitCount(text: string): number {
  if (text === '') return 0
  for (const entry of countCache) {
    if (entry.text === text) return entry.count
    // A streaming answer only ever grows, and appending characters can change
    // only the final cluster (a ZWJ sequence or an unfinished flag pair). Re-count
    // from that cluster's start instead of rescanning the whole answer: a
    // 176,000-character reply cost 2.9 ms per tick when every frame re-counted
    // the full text.
    if (text.length > entry.text.length && text.startsWith(entry.text)) {
      let count = entry.countBeforeLast
      let lastStart = entry.lastStart
      let countBeforeLast = count
      for (const part of segmenter.segment(text.slice(entry.lastStart))) {
        countBeforeLast = count
        lastStart = entry.lastStart + part.index
        count += 1
      }
      return remember({ text, count, lastStart, countBeforeLast })
    }
  }
  return remember(countAll(text))
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

/**
 * Slice the first `units` clusters. The segmenter iterator is lazy, so this
 * costs the revealed prefix rather than the whole answer: segmenting and
 * re-joining the full text measured 2.20 ms per tick on a 200,000-character
 * reply, and every tick paid it again.
 */
function revealText(text: string, units: number): string {
  if (units <= 0 || text === '') return ''
  let end = 0
  let count = 0
  for (const part of segmenter.segment(text)) {
    if (count >= units) return text.slice(0, end)
    count += 1
    end = part.index + part.segment.length
  }
  return text
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
