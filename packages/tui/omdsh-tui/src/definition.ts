/**
 * TUI capability seam — Service Definition.

 * The tui service is the presentation role of the omdsh capability seam:
 * the provider (./provider-local.ts) owns the terminal and the renderer,
 * and consumers (./runner.ts) forward session events and read user input
 * through this protocol. The vocabulary mirrors the SDK wire surface
 * (session.event / session.status), so a future remote UI can reuse the
 * definition unchanged.
 * @module @agi-fans/dsh-tui
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { TuiToolPresentation } from './tool-renderers.ts'

/** Context service name providers publish under. */
export const TUI_SERVICE = 'tui'

/** Whole-agent liveness, mirroring the SDK session.status vocabulary. */
export type TuiStatus = 'idle' | 'running'

/** Command metadata contributed by the active agent's plugin scope. */
export interface TuiCommand {
  name: string
  description: string
  inputHint?: string
}

/** Presentation intent for a direct, non-session notice. */
export interface TuiNoticeOptions {
  level?: 'info' | 'error'
  /** Reserve a component frame for callers that explicitly own a panel. */
  framed?: boolean
}

/** One terminal-owned human prompt used by approval and question adapters. */
export interface TuiPrompt {
  title: string
  question: string
  detail?: string
  options?: readonly {
    /** Human-facing option name. */
    label: string
    /** Answer returned to the caller; defaults to {@link label}. */
    value?: string
    /** Secondary content preview shown above metadata in spacious lists. */
    preview?: string
    description?: string
    /** Optional semantic badge painted after the description. */
    badge?: { label: string; tone: 'success' | 'warning' | 'error' | 'muted' }
  }[]
  multiSelect?: boolean
  allowCustom?: boolean
  /** Mask custom input while retaining the real value only in the prompt editor. */
  secret?: boolean
  /** Option value selected when a fixed-choice prompt opens. */
  initialValue?: string
  /** Full-height searchable list instead of the default prompt card. */
  presentation?: 'fullscreen-list' | 'plan-review'
  /** Row density for full-screen lists; compact rows keep short choices together. */
  optionLayout?: 'compact' | 'spacious'
  /** Choice that approves a dedicated review; other choices may collect feedback. */
  approveValue?: string
  /** Let typed text filter the available options. */
  filterable?: boolean
  /** Verb shown after Enter in selector navigation, such as "run". */
  submitLabel?: string
  signal?: AbortSignal
}

/** Durable, Harness-owned session controls projected into terminal chrome. */
export interface TuiSessionControls {
  /** Logged Plan Mode state, including a selection awaiting the next step boundary. */
  plan?: { active: boolean; pending: boolean }
  /** Effective permission preset, such as workspace-write or danger-full-access. */
  permission?: string
}

/** Lightweight durable session row used by the welcome card and resume UI. */
export interface TuiRecentSession {
  id: string
  title: string
  preview?: string
  createdAt: number
  updatedAt?: number
  eventCount?: number
  status?: 'done' | 'interrupted' | 'blocked' | 'failed'
}

/** Optional whole-session figures shown below the editor. */
export interface TuiSessionStats {
  turns: number
  steps: number
  /** Summed model wall time over completed assistant messages. */
  llmMs: number
  /** Summed matched tool-call wall time. */
  toolMs: number
  /** Summed first-token latency over {@link ttftSteps}. */
  ttftMs: number
  /** Number of steps carrying a recorded first-token latency. */
  ttftSteps: number
  /** Summed decode wall time over usage-reporting steps. */
  decodeMs: number
  /** Output tokens covered by {@link decodeMs}. */
  decodeTokens: number
  /** All disjoint prompt-side billing buckets combined. */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  contextTokens?: number
  contextWindow?: number
  elapsedMs?: number
}

/** One unsent image draft owned by the terminal until submission succeeds. */
export interface TuiInputImage {
  data: Uint8Array
  mediaType: ImageMediaType
  name?: string
  width?: number
  height?: number
}

/** Atomic composer submission: visible text plus its client-owned image drafts. */
export interface TuiSubmission {
  text: string
  images: readonly TuiInputImage[]
}

/**
 * Terminal presentation service.
 * Implementations must be single-consumer: one runner owns readInput().
 */
export interface TuiService {
  /** Render one session-log event (streamed as recorded). */
  event(event: SessionEvent, presentation?: TuiToolPresentation): void
  /** Update the status line liveness. */
  setStatus(status: TuiStatus): void
  /** Update the model and effective reasoning effort shown in the composer. */
  setModel(model: string, reasoningEffort?: string): void
  /** Replace the tool list shown by `/tools`. */
  setTools(tools: readonly { name: string; description: string }[]): void
  /** Replace commands contributed by the active agent's Harness scope. */
  setCommands(commands: readonly TuiCommand[]): void
  /** Append a direct UI/command result without fabricating a session event. */
  notice(text: string, options?: TuiNoticeOptions): void
  /** Append one successful plugin command result using the command-output surface. */
  commandOutput(command: string, text: string): void
  /** Temporarily own the composer and collect one human answer. */
  prompt(request: TuiPrompt): Promise<string | null>
  /** Replace the transcript when a new or resumed session becomes active. */
  replaceSession(events: readonly SessionEvent[], presentations?: ReadonlyMap<number, TuiToolPresentation>): void
  /** Update session identity, recent rows, projected controls, and aggregate figures. */
  setSession(info: {
    id: string
    recent: readonly TuiRecentSession[]
    stats?: TuiSessionStats
    controls?: TuiSessionControls
  }): void
  /**
   * Read the next submitted composer value. Resolves null when the user quits
   * (Ctrl-D on empty input, or stdin EOF in non-tty mode). One in-flight
   * call at a time.
   */
  readInput(): Promise<TuiSubmission | null>
  /** Restore an accepted draft when persistence or dispatch fails. */
  restoreInput(submission: TuiSubmission): void
  /** Resolve one queued-message back-navigation request into the composer. */
  resolveQueueEdit(submission: TuiSubmission | null): void
  /**
   * Subscribe to Ctrl-C. The listener fires when the user presses Ctrl-C
   * while a turn is running; an idle Ctrl-C clears the input line instead.
   * @returns disposer removing the listener.
   */
  onInterrupt(listener: () => void): () => void
  /**
   * Subscribe to an Up gesture while browsing queued follow-ups. The session
   * runtime owns removing the previous durable message and resolving the
   * request through {@link resolveQueueEdit}.
   * @returns disposer removing the listener.
   */
  onQueueEdit(listener: () => void): () => void
  /**
   * Subscribe to the idle double-Escape gesture that opens conversation rewind.
   * @returns disposer removing the listener.
   */
  onRewind(listener: () => void): () => void
  /** Restore terminal state and settle a pending input read with null. */
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The omdsh terminal presentation service. */
    tui: TuiService
  }
}
