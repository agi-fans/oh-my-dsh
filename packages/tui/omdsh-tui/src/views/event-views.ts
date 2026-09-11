/**
 * Transcript fold: SessionEvent/StreamDelta -> TranscriptState.
 *
 * applyEvent is the single writer of TranscriptState; replayEvents folds an
 * immutable log without repeatedly copying its growing block array. Both are
 * pure so the whole fold is testable without a terminal. Rendering lives in
 * transcript-render.ts; consumers keep importing this module, which re-exports
 * both halves.
 * @module @agi-fans/dsh-tui
 */

import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type {} from '@deepseek-ai/dsh-tool-todo'
import type { SessionEvent, ToolResultMessage } from '@deepseek-ai/dsh-session'
import type { TuiToolPresentation } from '../chrome/tool-renderers.ts'
import { formatTokens } from '../chrome/status-line.ts'
import {
  contentToReasoning,
  contentToText,
  initialTranscript,
  prettyArgs,
  type Block,
  type StreamDelta,
  type TranscriptState,
} from './transcript-types.ts'

export * from './transcript-types.ts'
export * from './transcript-render.ts'

function isRetryNotice(block: Block | undefined): boolean {
  return block?.kind === 'notice' && block.level === 'info' && block.text.startsWith('retrying ')
}

function formatRetryNotice(event: Extract<SessionEvent, { type: 'llm/retry' }>): string {
  const budget = event.data.mode === 'always'
    ? `${event.data.retry}`
    : `${event.data.retry}/${event.data.maxRetries}`
  return `retrying ${event.data.failure.code} (${budget})`
}

function dropRetryNotice(blocks: Block[]): void {
  if (isRetryNotice(blocks[blocks.length - 1])) blocks.pop()
}

const MAX_TOKENS_NOTICE = 'Output token limit reached before the response completed. Send “continue” to resume.'
const MAX_TOKENS_TOOL_NOTICE = 'Output token limit reached. A partial tool call was not executed because its arguments may be incomplete. Send “continue” to resume.'
const INTERRUPTED_NOTICE = 'Session was interrupted before completion.'
const INTERRUPTED_TOOL_NOTICE = 'Session was interrupted before completion. A partial tool call was not executed.'
const UNFINISHED_TOOL_OUTPUT = 'No durable tool result was recorded before the turn ended. The tool\'s outcome is unknown.'

const COMPACTED_NOTICE_PREFIX = 'Context compacted'
const TRIMMED_NOTICE_PREFIX = 'Context trimmed'

/** One-line condensation record: what the model's view lost and how much. */
function compactionNoticeText(action: 'compacted' | 'trimmed', events: number, tokens: number): string {
  const parts: string[] = []
  if (events > 0) parts.push(`${events} ${action === 'compacted' ? 'events' : 'results'}`)
  if (tokens > 0) parts.push(`${formatTokens(tokens)} tokens condensed`)
  const head = action === 'compacted' ? COMPACTED_NOTICE_PREFIX : TRIMMED_NOTICE_PREFIX
  return parts.length === 0 ? head : `${head} · ${parts.join(' · ')}`
}

function isCompactionNotice(block: Block | undefined): boolean {
  return block?.kind === 'notice'
    && (block.text.startsWith(COMPACTED_NOTICE_PREFIX) || block.text.startsWith(TRIMMED_NOTICE_PREFIX))
}

/** Replace the previous cycle's condensation notice instead of stacking them. */
function dropCompactionNotice(blocks: Block[]): void {
  if (isCompactionNotice(blocks[blocks.length - 1])) blocks.pop()
}

interface ReplayIndexes {
  readonly toolByCallId: Map<string, number>
}

function isMutableAttemptBlock(block: Block, turn: number, step?: number): boolean {
  if (block.kind === 'assistant') {
    return block.streaming && block.turn === turn && (step === undefined || block.step === step)
  }
  return block.kind === 'tool' && block.partial === true
}

/** Drop trailing live mutable rows from a failed attempt and keep replay indexes aligned. */
function hideFailedAttempt(
  blocks: Block[],
  turn: number,
  step: number | undefined,
  indexes?: ReplayIndexes,
): void {
  while (blocks.length > 0) {
    const last = blocks[blocks.length - 1]
    if (last === undefined) break
    if (isRetryNotice(last)) {
      blocks.pop()
      continue
    }
    if (!isMutableAttemptBlock(last, turn, step)) break
    blocks.pop()
    if (last.kind === 'tool') indexes?.toolByCallId.delete(last.callId)
  }
}

/** Remove streamed tool previews that never became durable tool/call events. */
function dropPartialToolPreviews(blocks: Block[], indexes?: ReplayIndexes): boolean {
  let removed = false
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block?.kind !== 'tool' || block.partial !== true) continue
    blocks.splice(index, 1)
    removed = true
  }
  if (removed && indexes !== undefined) {
    indexes.toolByCallId.clear()
    for (const [index, block] of blocks.entries()) {
      if (block.kind === 'tool') indexes.toolByCallId.set(block.callId, index)
    }
  }
  return removed
}

/** Preserve dispatched calls for audit while ensuring none remain visually active after a turn. */
function settleUnfinishedToolCalls(blocks: Block[]): void {
  for (const [index, block] of blocks.entries()) {
    if (block.kind !== 'tool' || block.status !== 'running' || block.partial === true) continue
    blocks[index] = {
      ...block,
      status: 'error',
      output: block.output === '' ? UNFINISHED_TOOL_OUTPUT : block.output,
    }
  }
}

/** Replace the trailing streaming block with a settled one, or append. */
function editableBlocks(state: TranscriptState, mutable: boolean): Block[] {
  return mutable ? state.blocks as Block[] : state.blocks.slice()
}

function settleAssistant(
  state: TranscriptState,
  turn: number,
  step: number,
  text: string,
  reasoning: string,
  interrupted: boolean,
  mutable: boolean,
): TranscriptState {
  const blocks = editableBlocks(state, mutable)
  dropRetryNotice(blocks)
  const settled: Block = {
    kind: 'assistant',
    turn,
    step,
    text,
    reasoning,
    streaming: false,
    ...(interrupted ? { interrupted: true } : {}),
  }
  let streamingIndex = -1
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const candidate = blocks[index]
    if (candidate?.kind === 'assistant' && candidate.streaming && candidate.turn === turn && candidate.step === step) {
      streamingIndex = index
      break
    }
  }
  if (streamingIndex >= 0) {
    blocks[streamingIndex] = settled
  } else if (text !== '' || reasoning !== '') {
    blocks.push(settled)
  }
  return { ...state, blocks }
}


/**
 * Fold one live assistant stream chunk into the transcript state. Durable
 * settlement still arrives as `assistant/message` (or `assistant/attempt`
 * for a committed attempt with no surface message) on the session log.
 */
export function applyStreamChunk(state: TranscriptState, delta: StreamDelta): TranscriptState {
  const { turn, step, chunk } = delta
  if (chunk.type === 'text-delta') {
    const blocks = editableBlocks(state, false)
    dropRetryNotice(blocks)
    const last = blocks[blocks.length - 1]
    if (last?.kind === 'assistant' && last.streaming && last.turn === turn && last.step === step) {
      blocks[blocks.length - 1] = { ...last, text: last.text + chunk.text }
    } else {
      blocks.push({ kind: 'assistant', turn, step, text: chunk.text, reasoning: '', streaming: true })
    }
    return { ...state, blocks }
  }
  if (chunk.type === 'reasoning-delta') {
    const blocks = editableBlocks(state, false)
    dropRetryNotice(blocks)
    const last = blocks[blocks.length - 1]
    if (last?.kind === 'assistant' && last.streaming && last.turn === turn && last.step === step) {
      blocks[blocks.length - 1] = { ...last, reasoning: last.reasoning + chunk.text }
    } else {
      blocks.push({ kind: 'assistant', turn, step, text: '', reasoning: chunk.text, streaming: true })
    }
    return { ...state, blocks }
  }
  if (chunk.type === 'tool-call-delta') {
    const blocks = editableBlocks(state, false)
    dropRetryNotice(blocks)
    const index = blocks.findIndex(block => block.kind === 'tool' && block.callId === chunk.id)
    const existing = blocks[index]
    if (existing?.kind === 'tool') {
      blocks[index] = {
        ...existing,
        name: chunk.name ?? existing.name,
        args: existing.args + chunk.argumentsDelta,
        partial: true,
      }
    } else {
      blocks.push({
        kind: 'tool', callId: chunk.id, name: chunk.name ?? 'tool',
        args: chunk.argumentsDelta, status: 'running', output: '', partial: true,
      })
    }
    return { ...state, blocks }
  }
  return state
}

/**
 * Fold one session-log event into the transcript state.
 * @param state - prior state.
 * @param event - the appended session event.
 * @returns the next state.
 */
export function applyEvent(
  state: TranscriptState,
  event: SessionEvent,
  presentation?: TuiToolPresentation,
): TranscriptState {
  return foldEvent(state, event, presentation, false)
}

/**
 * Replay one immutable event log without repeatedly copying its growing block
 * array. The mutable array is private to this fold and becomes readonly when
 * the completed state escapes.
 */
export function replayEvents(
  events: readonly SessionEvent[],
  presentations?: ReadonlyMap<number, TuiToolPresentation>,
): TranscriptState {
  let state = initialTranscript()
  const indexes: ReplayIndexes = { toolByCallId: new Map() }
  for (const event of events) state = foldEvent(state, event, presentations?.get(event.seq), true, indexes)
  return state
}

function foldEvent(
  state: TranscriptState,
  event: SessionEvent,
  presentation: TuiToolPresentation | undefined,
  mutable: boolean,
  indexes?: ReplayIndexes,
): TranscriptState {
  switch (event.type) {
    case 'turn/start':
      return { ...state, status: 'running', turn: event.data.turn, todos: [], compactCommandId: undefined, compaction: undefined }
    case 'llm/retry': {
      const blocks = editableBlocks(state, mutable)
      hideFailedAttempt(blocks, event.data.turn, event.data.step, indexes)
      const notice: Block = { kind: 'notice', level: 'info', text: formatRetryNotice(event) }
      if (isRetryNotice(blocks[blocks.length - 1])) blocks[blocks.length - 1] = notice
      else blocks.push(notice)
      return { ...state, blocks, status: 'running', turn: event.data.turn }
    }
    case 'turn/end': {
      const reason = event.data.reason
      const blocks = editableBlocks(state, mutable)
      let failure: string | undefined
      if (reason.kind === 'error') hideFailedAttempt(blocks, event.data.turn, undefined, indexes)
      const droppedPartialTool = dropPartialToolPreviews(blocks, indexes)
      settleUnfinishedToolCalls(blocks)
      dropRetryNotice(blocks)
      const settledLast = blocks[blocks.length - 1]
      if (settledLast?.kind === 'assistant' && settledLast.streaming) {
        blocks[blocks.length - 1] = { ...settledLast, streaming: false }
      }
      if (reason.kind === 'error') {
        failure = 'error: ' + reason.error.code + ': ' + reason.error.message
        blocks.push({ kind: 'notice', level: 'error', text: failure })
      } else if (reason.kind === 'max-tokens') {
        blocks.push({
          kind: 'notice',
          level: 'warning',
          text: droppedPartialTool ? MAX_TOKENS_TOOL_NOTICE : MAX_TOKENS_NOTICE,
        })
      } else if (reason.kind === 'interrupted') {
        blocks.push({
          kind: 'notice',
          level: 'warning',
          text: droppedPartialTool ? INTERRUPTED_TOOL_NOTICE : INTERRUPTED_NOTICE,
        })
      } else if (reason.kind === 'blocked') {
        blocks.push({ kind: 'notice', level: 'warning', text: 'Turn was blocked before the next model step could start.' })
      } else if (reason.kind === 'aborted') {
        // A cancelled turn that already delivered a prefix finalizes it as an
        // assistant block marked interrupted; the bare notice only covers a
        // turn that aborted before any visible content.
        const settledLast = blocks[blocks.length - 1]
        if (settledLast?.kind !== 'assistant' || settledLast.interrupted !== true) {
          blocks.push({ kind: 'notice', level: 'info', text: 'interrupted' })
        }
      }
      // A compaction still open here cannot be the turn's own: clear it so a
      // late `compaction/end` cannot restore a stale running status.
      return {
        ...state,
        blocks,
        status: 'idle',
        compactCommandId: undefined,
        compaction: undefined,
        turnError: failure,
      }
    }
    case 'user/message': {
      // Synthetic plugin injections (system-prompt runtime context, skill
      // catalog) reach the surface as user-role messages but are model input,
      // not what the human typed; only human prompts render as transcript.
      if (event.data.source.kind !== 'user') return state
      const text = contentToText(event.data.content)
      if (text === '') return state
      const blocks = editableBlocks(state, mutable)
      blocks.push({ kind: 'user', text })
      // A new submission is the acknowledgement that clears the fixed failure row.
      return { ...state, blocks, turnError: undefined }
    }
    case 'assistant/attempt': {
      // A settled model attempt with no surface message (failed, retried,
      // cancelled, or stream-error) leaves no visible transcript row.
      return state
    }
    case 'assistant/message': {
      const { turn, step, message } = event.data
      return settleAssistant(
        state,
        turn,
        step,
        contentToText(message.content),
        contentToReasoning(message.content),
        event.data.interrupted === true,
        mutable,
      )
    }
    case 'tool/call': {
      const block: Block = {
        kind: 'tool',
        callId: event.data.callId,
        name: event.data.name,
        args: prettyArgs(event.data.arguments),
        status: 'running',
        output: '',
        ...(presentation === undefined ? {} : { presentation }),
      }
      const blocks = editableBlocks(state, mutable)
      dropRetryNotice(blocks)
      const partial = indexes === undefined
        ? blocks.findIndex(item => item.kind === 'tool' && item.callId === event.data.callId)
        : indexes.toolByCallId.get(event.data.callId) ?? -1
      if (partial >= 0) blocks[partial] = block
      else {
        blocks.push(block)
        indexes?.toolByCallId.set(event.data.callId, blocks.length - 1)
      }
      return { ...state, blocks }
    }
    case 'tool/result':
      return applyToolResult(state, event.data.message, event.data.error, presentation, mutable, indexes)
    case 'todo/write':
      return { ...state, todos: event.data.todos.map(todo => ({ ...todo })) }
    case 'command/run':
      if (event.data.name !== 'compact') return state
      return {
        ...state,
        status: 'compacting',
        compactCommandId: event.data.commandId,
      }
    case 'command/done':
      if (state.compactCommandId !== event.data.commandId) return state
      return {
        ...state,
        compactCommandId: undefined,
        status: state.compaction === undefined ? 'idle' : 'compacting',
      }
    // Durable condensation. The manual `/compact` command and the automatic
    // pressure path emit the same lifecycle, so one set of cases covers both.
    case 'compaction/start':
      return {
        ...state,
        status: 'compacting',
        compaction: { id: event.data.compactionId, events: 0, tokens: 0, resume: state.status },
      }
    case 'compaction/summary': {
      if (state.compaction?.id !== event.data.compactionId) return state
      return {
        ...state,
        compaction: {
          id: state.compaction.id,
          events: event.data.shadowedSeqs.length,
          tokens: event.data.shadowedTokenCount,
          resume: state.compaction.resume,
        },
      }
    }
    case 'compaction/end': {
      if (state.compaction?.id !== event.data.compactionId) return state
      const error = event.data.error
      const notice = error !== undefined
        ? `Context compaction failed: ${error}`
        : state.compaction.events === 0 && state.compaction.tokens === 0
          ? undefined
          : compactionNoticeText('compacted', state.compaction.events, state.compaction.tokens)
      if (notice === undefined) {
        return { ...state, compaction: undefined, status: state.compaction.resume }
      }
      const blocks = editableBlocks(state, mutable)
      dropCompactionNotice(blocks)
      blocks.push({ kind: 'notice', level: error === undefined ? 'info' : 'error', text: notice })
      return { ...state, blocks, compaction: undefined, status: state.compaction.resume }
    }
    // The model-free prune pass runs before a summarizing compaction, so its
    // notice is superseded when a summary follows in the same cycle.
    case 'compaction/prune': {
      if (event.data.shadowedSeqs.length === 0) return state
      const blocks = editableBlocks(state, mutable)
      dropCompactionNotice(blocks)
      blocks.push({
        kind: 'notice',
        level: 'info',
        text: compactionNoticeText('trimmed', event.data.shadowedSeqs.length, event.data.shadowedTokenCount),
      })
      return { ...state, blocks }
    }
    case 'agent/inbox/spliced': {
      const key = event.data.target === 'next-turn' ? 'nextTurnInbox' : 'nextStepInbox'
      return {
        ...state,
        [key]: state[key].toSpliced(
          event.data.start,
          event.data.removedCount ?? 0,
          ...event.data.inserted,
        ),
      }
    }
    case 'session/end-seed':
      return { ...state, nextTurnInbox: [], nextStepInbox: [] }
    // Log-only vocabulary (boundaries, usage, compaction, approvals, ...):
    // nothing to display; the recognized core events above own the surface.
    default:
      return state
  }
}

/** Fold one tool result into its tool block. */
function applyToolResult(
  state: TranscriptState,
  message: ToolResultMessage,
  error: { name: string; code: string } | undefined,
  presentation: TuiToolPresentation | undefined,
  mutable: boolean,
  indexes?: ReplayIndexes,
): TranscriptState {
  // A tool-result message carries exactly one tool-result block; the call
  // identity and outcome live on that inner block.
  const inner = message.content[0]
  if (inner?.type !== 'tool-result') return state
  const blocks = editableBlocks(state, mutable)
  const indexed = indexes?.toolByCallId.get(inner.toolCallId)
  if (indexed !== undefined) {
    const block = blocks[indexed]
    if (block?.kind === 'tool') {
      blocks[indexed] = settleTool(block, inner, error, presentation)
      return { ...state, blocks }
    }
  }
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]
    if (block?.kind === 'tool' && block.callId === inner.toolCallId) {
      blocks[i] = settleTool(block, inner, error, presentation)
      return { ...state, blocks }
    }
  }
  return state
}

function settleTool(
  block: Extract<Block, { kind: 'tool' }>,
  result: Extract<ToolResultMessage['content'][number], { type: 'tool-result' }>,
  error: { name: string; code: string } | undefined,
  presentation: TuiToolPresentation | undefined,
): Extract<Block, { kind: 'tool' }> {
  return {
    ...block,
    status: error !== undefined || result.isError === true ? 'error' : 'ok',
    output: contentToText(result.content),
    ...(presentation === undefined ? {} : { presentation }),
  }
}

/** View options: terminal geometry and live input state. */
