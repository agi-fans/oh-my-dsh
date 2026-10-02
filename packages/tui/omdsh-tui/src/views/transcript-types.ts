/**
 * Shared transcript contracts: the Block union both halves of the pipeline
 * exchange, the TranscriptState applyEvent produces, and the content helpers
 * fold and render both use.
 * @module @agi-fans/dsh-tui
 */

import type {} from '@deepseek-ai/dsh-tool-todo'
import type { ContentBlock, StreamChunk, ToolCallId, UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { WorkspaceChangesSummary } from '@deepseek-ai/dsh-workspace-changes'
import type { TuiToolPresentation } from '../chrome/tool-renderers.ts'
import type { ToolInfo } from '../chrome/tools-list.ts'
import { blocksText } from '../session/content-text.ts'

export type TodoItem = Extract<SessionEvent, { type: 'todo/write' }>['data']['todos'][number]

/** Display state of one tool invocation. */
export type ToolBlockStatus = 'running' | 'ok' | 'error'

/**
 * Per-turn changed-file summary for one `workspace/changes` event.
 *
 * The durable event carries only the turn number; the summary itself stays on
 * the Harness host and is served by the `workspaceChanges` service for as long
 * as the Session lives. `summary` is therefore undefined when the plugin is
 * not mounted and when a resumed or replayed log no longer has a live recorder,
 * and the block degrades to its turn-only form instead of inventing counts.
 */
export interface WorkspaceBlock {
  kind: 'workspace'
  turn: number
  summary?: WorkspaceChangesSummary
}

/** One rendered block of the transcript. */
export type Block =
  | { kind: 'user'; text: string }
  | {
    kind: 'assistant'
    turn: number
    step: number
    text: string
    reasoning: string
    streaming: boolean
    interrupted?: boolean

  }
  | {
    kind: 'tool'
    callId: ToolCallId
    startedAt?: number
    name: string
    args: string
    status: ToolBlockStatus
    output: string
    /** Settlement of the background job started by this call. */
    job?: { id: string; status: 'completed' | 'failed' | 'killed'; detail?: string }
    partial?: boolean
    presentation?: TuiToolPresentation
    /**
     * The `run_code` call this one was dispatched from, in PTC mode.
     *
     * PTC programs call tools instead of emitting tool calls, so the durable
     * log records the inner calls as `tool/ptc-dispatch*` under the parent's id
     * rather than as `tool/call`. They still render through the same tool path —
     * this only says the call was nested, so the row can show it as such
     * instead of letting it read as something the agent asked for directly.
     */
    parentCallId?: ToolCallId
    /** The turn that made the call, so two turns with no prompt between them still read as two runs. */
    turn?: number
  }
  | { kind: 'toolCatalog'; tools: readonly ToolInfo[] }
  | { kind: 'commandOutput'; command: string; text: string }
  | WorkspaceBlock
  | {
    kind: 'notice'
    level: 'info' | 'warning' | 'error'
    text: string
    framed?: boolean
    /**
     * This row is a seam, not a message: it marks where the transcript was
     * replaced and the earlier output stayed in the terminal's history above.
     * Document switches rebuild the whole block list with one seam; initial
     * presentation and refreshes omit it.
     */
    boundary?: true
    /**
     * This notice reports work inside a running turn — a retry, a background
     * job settling — rather than speaking to the reader, so it belongs to the
     * turn's run instead of splitting it. It carries the turn it arrived in.
     *
     * `source` is the durable id of the thing it reports on, which is what
     * makes two such notices in one document tellable apart. A run is keyed by
     * its first block, so a run led by a notice would otherwise be keyed by
     * kind alone and every one of them in the session would share one key.
     */
    process?: { turn: number; source?: string }
  }

/** Live session activity controlling the composer and activity row. */
export type SessionStatus = 'idle' | 'running' | 'compacting'

/** Mutable-free transcript state produced by applyEvent. */
export interface TranscriptState {
  /** Ordered display blocks (user, assistant, tool). */
  blocks: Block[]
  /** Whole-agent liveness for the status line. */
  status: SessionStatus
  /** The most recent turn number. */
  turn: number
  /** Latest whole Todo projection emitted by the Harness for this turn. */
  todos: TodoItem[]
  /** Lifecycle id of a manual compact command currently owning the UI. */
  compactCommandId: string | undefined
  /**
   * Durable compaction in flight: its identity, the shadow price its summary
   * reported, and the status to restore when it settles. Automatic compaction
   * runs inside an open turn, so the restored status is usually `running`.
   */
  compaction: { id: string; events: number; tokens: number; resume: SessionStatus } | undefined
  /** Durable follow-up turns waiting in the Harness-owned agent inbox. */
  nextTurnInbox: UserMessage[]
  /** Durable steering/context waiting for a later step (kept for splice fidelity). */
  nextStepInbox: UserMessage[]
  /**
   * Text of the turn that ended in failure, held until the next submission.
   * The transcript keeps its own error notice, but that row scrolls away while
   * the composer stays fixed, so a failed turn would otherwise leave an
   * apparently idle screen behind.
   */
  turnError: string | undefined
  /**
   * When each turn started and, once settled, ended, in session-log time.
   *
   * A finished run is summarized by how long the turn took — the one number a
   * reader wants when a whole turn has folded to a row — and the durable
   * `turn/start` and `turn/end` events are the only honest source of it: a
   * replayed session reports the time it originally took, not the replay's.
   */
  turnSpans?: Readonly<Record<number, { start: number; end?: number }>>

}

/** Empty starting state. */
export function initialTranscript(): TranscriptState {
  return {
    blocks: [],
    status: 'idle',
    turn: 0,
    todos: [],
    compactCommandId: undefined,
    compaction: undefined,
    nextTurnInbox: [],
    nextStepInbox: [],
    turnError: undefined,
  }
}

/** Extract plain text from text blocks, ignoring other block kinds. */
export function contentToText(content: readonly ContentBlock[]): string {
  return content
    .flatMap((block) => {
      if (block.type === 'text') return [block.text]
      if (block.type === 'image') {
        const ref = block.attachment
        return [`[image ${ref.width}×${ref.height} · ${ref.mediaType}]`]
      }
      if (block.type === 'file') {
        const ref = block.attachment
        return [`[file ${ref.name} · ${ref.bytes} bytes]`]
      }
      return []
    })
    .join('')
}

/** Extract reasoning text from reasoning blocks. */
export function contentToReasoning(content: readonly ContentBlock[]): string {
  return blocksText(content, { kinds: ['reasoning'], join: '' })
}
/**
 * One live assistant stream delta: a chunk folded with the owning attempt's
 * turn/step (live frames carry neither durable seq nor turn/step; the bridge
 * records them from the attempt's start frame).
 */
export interface StreamDelta {
  readonly turn: number
  readonly step: number
  readonly chunk: StreamChunk
}

/**
 * Identity of one assistant step's reasoning, used to address its fold.
 *
 * Reasoning is a field on the assistant block rather than a block of its own,
 * so it needs a key of its own for a per-step open/closed state. Turn and step
 * are already unique within a transcript and survive replay, so a reader's
 * choice is still attached to the same thought after resuming the session.
 */
export function reasoningKey(block: Extract<Block, { kind: 'assistant' }>): string {
  return `${block.turn}:${block.step}`
}

/** Compact pretty-print of a tool call's raw arguments JSON. */
export function prettyArgs(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw))
  } catch {
    return raw
  }
}
