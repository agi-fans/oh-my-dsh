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
import type {} from '@deepseek-ai/dsh-workspace-changes'
import type { ContentBlock, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { WorkspaceChangesSummary } from '@deepseek-ai/dsh-workspace-changes'
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
  type WorkspaceBlock,
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

/**
 * Index of the changed-file block already appended for one turn.
 *
 * The Harness may re-announce a turn (a late snapshot, or a second pass over
 * the same top-level turn), and the latest event for a turn replaces earlier
 * ones, so the fold updates in place instead of stacking duplicates.
 * @param blocks - current display blocks.
 * @param turn - the turn the event names.
 * @returns the block index, or -1 when the turn has no block yet.
 */
function findWorkspaceBlock(blocks: readonly Block[], turn: number): number {
  return blocks.findIndex(block => block.kind === 'workspace' && block.turn === turn)
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
 * @param presentation - tool presentation resolved for this event, when any.
 * @param workspace - host-served changed-file summary for a `workspace/changes`
 *   event; absent when the plugin is not mounted or the recorder is gone.
 * @returns the next state.
 */
export function applyEvent(
  state: TranscriptState,
  event: SessionEvent,
  presentation?: TuiToolPresentation,
  workspace?: WorkspaceChangesSummary,
): TranscriptState {
  return foldEvent(state, event, presentation, false, undefined, workspace)
}

/**
 * Attach a host-served changed-file summary to a turn's existing block.
 *
 * The Harness appends `workspace/changes` and only then files the summary
 * under the event's sequence, so a listener running inside that append cannot
 * read it back. The caller resolves it on the next microtask and calls this to
 * enrich the block it already rendered, which keeps the transcript truthful
 * without replaying the event.
 *
 * @param state - current transcript state.
 * @param turn - the turn whose block receives the summary.
 * @param summary - the summary the host serves.
 * @returns the next state, or the same state when the turn has no block.
 */
export function withWorkspaceSummary(
  state: TranscriptState,
  turn: number,
  summary: WorkspaceChangesSummary,
): TranscriptState {
  const index = findWorkspaceBlock(state.blocks, turn)
  if (index < 0) return state
  const current = state.blocks[index] as WorkspaceBlock
  if (current.summary !== undefined) return state
  const blocks = state.blocks.slice()
  blocks[index] = { kind: 'workspace', turn, summary }
  return { ...state, blocks }
}

/**
 * Replay one immutable event log without repeatedly copying its growing block
 * array. The mutable array is private to this fold and becomes readonly when
 * the completed state escapes.
 *
 * @param events - the log to fold.
 * @param presentations - tool presentations keyed by event sequence.
 * @param workspaces - changed-file summaries keyed by event sequence. Only a
 *   live Session still has them, so a resumed log replays turn-only blocks.
 */
export function replayEvents(
  events: readonly SessionEvent[],
  presentations?: ReadonlyMap<number, TuiToolPresentation>,
  workspaces?: ReadonlyMap<number, WorkspaceChangesSummary>,
): TranscriptState {
  let state = initialTranscript()
  const indexes: ReplayIndexes = { toolByCallId: new Map() }
  for (const event of events) {
    state = foldEvent(state, event, presentations?.get(event.seq), true, indexes, workspaces?.get(event.seq))
  }
  return state
}

function foldEvent(
  state: TranscriptState,
  event: SessionEvent,
  presentation: TuiToolPresentation | undefined,
  mutable: boolean,
  indexes?: ReplayIndexes,
  workspace?: WorkspaceChangesSummary,
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
    case 'tool/call':
      return startToolCall(state, event.data.callId, event.data.name, event.data.arguments, undefined, presentation, mutable, indexes)
    // PTC mode records the calls a program made under its `run_code` call
    // rather than as tool/call events, but the Harness asks UIs to render a
    // sub-call through the same path as a native one, so it is the same block.
    // `parentCallId` is the only difference the reader can see.
    case 'tool/ptc-dispatch-start':
      return startToolCall(
        state, event.data.subCallId, event.data.name, event.data.arguments,
        event.data.parentCallId, presentation, mutable, indexes,
      )
    case 'tool/ptc-dispatch':
      return applyToolResult(
        state,
        event.data.subCallId,
        event.data.content,
        event.data.isError,
        event.data.isError ? event.data.error ?? { name: 'ToolError', code: 'TOOL_FAILED' } : undefined,
        presentation,
        mutable,
        indexes,
        { parentCallId: event.data.parentCallId, name: event.data.name, arguments: event.data.arguments },
      )
    case 'tool/result':
      return applyToolResult(
        state,
        event.data.message.toolCallId,
        event.data.message.content,
        event.data.message.isError === true,
        event.data.error,
        presentation,
        mutable,
        indexes,
      )
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
    // A completed top-level turn's changed-file summary. The durable event
    // carries only the turn; the file list stays on the Harness host and is
    // served per live Session, so the block degrades to its turn-only form
    // rather than inventing counts we cannot recover on a resumed log.
    case 'workspace/changes': {
      const blocks = editableBlocks(state, mutable)
      const index = findWorkspaceBlock(blocks, event.data.turn)
      const block: WorkspaceBlock = workspace === undefined
        ? { kind: 'workspace', turn: event.data.turn }
        : { kind: 'workspace', turn: event.data.turn, summary: workspace }
      if (index < 0) blocks.push(block)
      else blocks[index] = block
      return { ...state, blocks }
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

/** Push or replace the tool block for one call, by call id. */
function startToolCall(
  state: TranscriptState,
  callId: ToolCallId,
  name: string,
  args: unknown,
  parentCallId: ToolCallId | undefined,
  presentation: TuiToolPresentation | undefined,
  mutable: boolean,
  indexes?: ReplayIndexes,
): TranscriptState {
  const block: Block = {
    kind: 'tool',
    callId,
    name,
    args: prettyArgs(typeof args === 'string' ? args : JSON.stringify(args)),
    status: 'running',
    output: '',
    ...(parentCallId === undefined ? {} : { parentCallId }),
    ...(presentation === undefined ? {} : { presentation }),
  }
  const blocks = editableBlocks(state, mutable)
  dropRetryNotice(blocks)
  const partial = indexes === undefined
    ? blocks.findIndex(item => item.kind === 'tool' && item.callId === callId)
    : indexes.toolByCallId.get(callId) ?? -1
  if (partial >= 0) blocks[partial] = block
  else {
    blocks.push(block)
    indexes?.toolByCallId.set(callId, blocks.length - 1)
  }
  return { ...state, blocks }
}

/** Identity a settle event carries so it can stand in for a missing start. */
interface ToolCallOrigin {
  parentCallId: ToolCallId
  name: string
  arguments: unknown
}

/**
 * Fold one tool outcome into its tool block.
 *
 * A native `tool/result` and a PTC sub-call's `tool/ptc-dispatch` describe the
 * same thing in different words, so both arrive here as the three facts the
 * block actually needs: which call, what it said, and whether it failed.
 */
function applyToolResult(
  state: TranscriptState,
  callId: ToolCallId,
  content: readonly ContentBlock[],
  isError: boolean,
  error: { name: string; code: string } | undefined,
  presentation: TuiToolPresentation | undefined,
  mutable: boolean,
  indexes?: ReplayIndexes,
  origin?: ToolCallOrigin,
): TranscriptState {
  const blocks = editableBlocks(state, mutable)
  const indexed = indexes?.toolByCallId.get(callId)
  if (indexed !== undefined) {
    const block = blocks[indexed]
    if (block?.kind === 'tool') {
      blocks[indexed] = settleTool(block, content, isError, error, presentation)
      return { ...state, blocks }
    }
  }
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]
    if (block?.kind === 'tool' && block.callId === callId) {
      blocks[i] = settleTool(block, content, isError, error, presentation)
      return { ...state, blocks }
    }
  }
  // A log window can cut between a sub-call's start and its settle. PTC
  // dispatch events carry the name and arguments themselves, so the call can
  // still be shown rather than lost — dropping it would leave a hole in the
  // record the session actually kept.
  if (origin === undefined) return state
  const created = startToolCall(state, callId, origin.name, origin.arguments, origin.parentCallId, undefined, mutable, indexes)
  return applyToolResult(created, callId, content, isError, error, presentation, mutable, indexes)
}

function settleTool(
  block: Extract<Block, { kind: 'tool' }>,
  content: readonly ContentBlock[],
  isError: boolean,
  error: { name: string; code: string } | undefined,
  presentation: TuiToolPresentation | undefined,
): Extract<Block, { kind: 'tool' }> {
  return {
    ...block,
    // A result can report failure on the message alone, with no structured
    // error beside it, so both signals have to be honoured.
    status: isError || error !== undefined ? 'error' : 'ok',
    output: contentToText(content),
    ...(presentation === undefined ? {} : { presentation }),
  }
}

/** View options: terminal geometry and live input state. */
