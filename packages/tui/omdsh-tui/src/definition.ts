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
import type { WorkspaceChangesSummary } from '@deepseek-ai/dsh-workspace-changes'
import type { StreamDelta } from './views/event-views.ts'
import type { TuiPrefs } from './views/settings-list.ts'
import type { FileAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { TuiToolPresentation } from './chrome/tool-renderers.ts'

/** Context service name providers publish under. */
export const TUI_SERVICE = 'tui'

/** Whole-agent liveness, mirroring the SDK session.status vocabulary. */
export type TuiStatus = 'idle' | 'running'

/** Why the controller is replacing the visible transcript. */
export type TuiTranscriptReplacement = 'initial' | 'new' | 'open' | 'refresh'

/** Command metadata contributed by the active agent's plugin scope. */
export interface TuiCommand {
  name: string
  description: string
  inputHint?: string
}

/** Whether direct output should interrupt transcript browsing. */
export interface TuiOutputOptions {
  /** Reveal a requested result at the live tail, ending any inspection. */
  focus?: boolean
}

/** Presentation intent for a direct, non-session notice. */
export interface TuiNoticeOptions extends TuiOutputOptions {
  level?: 'info' | 'error'
  /** Reserve a component frame for callers that explicitly own a panel. */
  framed?: boolean
  /**
   * The notice reports work inside the running turn — a background job
   * settling — so it folds into the turn's run instead of splitting it. It is
   * ignored when no turn is running: then it speaks to the reader directly.
   */
  process?: boolean
  /**
   * Durable id of what a process notice reports on — a job id, a retry id.
   * A run is keyed by its first block, so notices sharing a run need to be
   * told apart or two runs in one document collide on one key.
   */
  processSource?: string
  /** Job settlement to merge into its visible originating tool call when identifiable. */
  job?: { id: string; label: string; startedAt: number; status: 'completed' | 'failed' | 'killed'; detail?: string }
}

/** One terminal-owned human prompt used by approval and question adapters. */
export interface TuiPrompt {
  title: string
  question: string
  detail?: string
  /**
   * Text for an empty option list. Callers that own the domain supply their own
   * wording; the selector otherwise falls back to a generic line, which used to
   * say "No sessions found." even for approvals and questions.
   */
  emptyText?: string
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
  /** Optional single-key actions applied to the active option while the filter is empty. */
  actions?: readonly {
    key: string
    label: string
    /** Prefix returned before the selected option value. */
    valuePrefix: string
  }[]
  multiSelect?: boolean
  allowCustom?: boolean
  /** Mask custom input while retaining the real value only in the prompt editor. */
  secret?: boolean
  /** Option value selected when a fixed-choice prompt opens. */
  initialValue?: string
  /** Full-height searchable list instead of the default prompt card. */
  presentation?: 'fullscreen-list' | 'plan-review' | 'document'
  /** Suppress attention notifications for user-initiated browsing surfaces. */
  notify?: boolean
  /** Refresh a human-owned document while it is open; stopped on dismissal or abort. */
  refreshDocument?: () => string
  /** Open a live document at its latest rows. */
  documentTail?: boolean
  /** Row density for full-screen lists; compact rows keep short choices together. */
  optionLayout?: 'compact' | 'spacious'
  /** Choice that approves a dedicated review; other choices may collect feedback. */
  approveValue?: string
  /** Let typed text filter the available options. */
  filterable?: boolean
  /** Verb shown after Enter in selector navigation, such as "run". */
  submitLabel?: string
  /** Dismissing an answerable question leaves it pending rather than cancelling it. */
  dismissLabel?: string
  /** Ctrl+S submits an explicit empty answer for this question. */
  skippable?: boolean
  /** Local countdown for a claimed Harness wait; editing or Ctrl+T holds the wait. */
  wait?: { deadline: number; hold(): void }
  /** Distinguish Ctrl+C interruption from dismissing an answerable question. */
  interrupt?(): void
  signal?: AbortSignal
}

/** Durable, Harness-owned session controls projected into terminal chrome. */
export interface TuiSessionControls {
  /** Harness Agent preset mounted for this session. */
  agentPreset?: string
  /** Logged Plan Mode state, including a selection awaiting the next step boundary. */
  plan?: { active: boolean; pending: boolean }
  /** Effective permission preset, such as workspace-write or danger-full-access. */
  permission?: string
  /** Current durable goal; absent before the first goal and after a clear or completion. */
  goal?: TuiGoalStatus
  /** Unanswered continued questions from the Harness projection. */
  pendingQuestions?: number
}

/**
 * One durable goal projected into the bar above the composer. A completed goal
 * is reported as absent, matching the Harness projection's own visibility rule.
 */
export interface TuiGoalStatus {
  phase: 'active' | 'paused' | 'blocked'
  objective: string
  /** Present exactly while `phase` is `blocked`. */
  blockedReason?: string
  /** Highest admitted goal round. */
  roundsStarted: number
  /** Admitted round cap; `0` means no cap was configured. */
  maxGoalRounds: number
}

/** Process-local repeated-prompt state contributed by the Loop plugin. */
export interface TuiLoopStatus {
  phase: 'waiting' | 'running' | 'paused' | 'completed'
  /** Automatic submissions already dispatched by this Loop. */
  repeats?: number
  /** Configured automatic submissions for a count-limited Loop. */
  total?: number
  /** Absolute deadline while a duration-limited Loop is running. */
  deadline?: number
  /** Original duration expression for a time-limited loop. */
  limit?: string
}

/** Lifecycle shown for one descendant subagent in the live roster. */
export type TuiSubagentPhase = 'starting' | 'running' | 'waiting' | 'completed' | 'error'

/** Latest child work folded from that child's own session log. */
export interface TuiSubagentActivity {
  /** Compact tool or thinking label, already shortened for a one-line HUD. */
  readonly text: string
  readonly status: 'running' | 'ok' | 'error' | 'thinking'
}

/** One origin-classified descendant projected into the terminal HUD. */
export interface TuiSubagentView {
  readonly id: string
  readonly parentId?: string
  /** Edge distance from the active root session; direct children are `1`. */
  readonly depth: number
  readonly label: string
  readonly mode?: 'one-shot' | 'continuable'
  readonly phase: TuiSubagentPhase
  readonly activity: readonly TuiSubagentActivity[]
  /** First durable event and latest hydrated or changed activity/state timestamps. */
  readonly startedAt?: number
  readonly updatedAt?: number
  readonly workflow?: { name: string; phase?: string; outcome?: 'completed' | 'failed' | 'cancelled' }
}

export interface TuiWorkflowRun {
  readonly id: string
  readonly name: string
  /** Open is a durable record without an end, not proof a restored worker is running. */
  readonly status: string
  readonly phase?: string
  readonly members: readonly { seq: number; childId: string; label: string; phase?: string; outcome?: 'completed' | 'failed' | 'cancelled' }[]
}

/** Live descendant roster for the active root session. */
export interface TuiSubagentRoster {
  readonly agents: readonly TuiSubagentView[]
  readonly workflows?: readonly TuiWorkflowRun[]
}

/** The descendant whose own transcript currently replaces the parent view. */
export interface TuiInspectedSubagent {
  readonly id: string
  readonly label: string
  readonly phase: TuiSubagentPhase
  readonly mode?: 'one-shot' | 'continuable'
  /** Continuable children accept composer follow-ups; one-shot runs stay read-only. */
  readonly writable: boolean
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
  files?: readonly FileAttachmentRef[]
}

/** Product-owned language preference projected into the settings overlay. */
export interface TuiAgentBehaviorSettings {
  language: 'auto' | 'zh-CN' | 'en'
}

/** Closed binding between the product settings owner and the terminal surface. */
export interface TuiAgentBehaviorSettingsBinding {
  get(): TuiAgentBehaviorSettings
  update(next: TuiAgentBehaviorSettings): Promise<void>
  watch(listener: (next: TuiAgentBehaviorSettings) => void): () => void
}

/**
 * Terminal presentation service.
 * Implementations must be single-consumer: one runner owns readInput().
 */
export interface TuiService {
  /** True when the provider owns a keyboard-driven terminal viewport. */
  readonly interactive?: boolean
  /** Hand the terminal to the configured editor, then restore the live viewport. */
  openFileInEditor?(path: string): void
  /** Add a durably stored file to the editable composer; sending remains explicit. */
  stageFileAttachment?(file: FileAttachmentRef): void
  /**
   * Render one session-log event (streamed as recorded).
   *
   * @param event - the appended event.
   * @param presentation - tool presentation resolved for this event, when any.
   * @param workspace - changed-file summary the host serves for a
   *   `workspace/changes` event; omitted when the plugin is unmounted or its
   *   recorder for the Session is gone, which renders the turn-only form.
   */
  event(event: SessionEvent, presentation?: TuiToolPresentation, workspace?: WorkspaceChangesSummary): void
  /**
   * Attach a changed-file summary to a turn block that was already rendered
   * without one.
   *
   * The Harness files the summary only after appending its event, so the
   * controller resolves it on the next microtask and enriches the block here
   * instead of replaying the event.
   *
   * @param turn - the turn whose block receives the summary.
   * @param summary - the summary the host serves for that turn.
   */
  setWorkspaceSummary(turn: number, summary: WorkspaceChangesSummary): void
  /** Fold one live `agent/assistant-stream` chunk into the transcript. */
  streamDelta(delta: StreamDelta): void
  /** Update the status line liveness. */
  setStatus(status: TuiStatus): void
  /** Update the model and effective reasoning effort shown in the composer. */
  setModel(model: string, reasoningEffort?: string): void
  /** Update the optional process-local Loop indicator in the fixed footer. */
  setLoopStatus(status: TuiLoopStatus | undefined): void
  /** Replace the live descendant-subagent roster above the composer. */
  setSubagents(roster: TuiSubagentRoster | undefined): void
  /** Open or leave a descendant transcript view without changing the active Agent. */
  setInspectedSubagent(inspected: TuiInspectedSubagent | undefined): void
  /** Replace the tool list shown by `/tools`. */
  setTools(tools: readonly { name: string; description: string }[]): void
  /** Replace commands contributed by the active agent's Harness scope. */
  setCommands(commands: readonly TuiCommand[]): void
  /** Open a keyboard-driven event ledger for the active session. */
  openTrajectory(events: readonly SessionEvent[]): boolean
  /**
   * One-line plain-text summary of a tool call this interface already rendered,
   * for surfaces that must explain a pending decision. Undefined when the call
   * has not streamed yet, so callers keep their own fallback instead of blocking.
   */
  toolCallContext(callId: string): string | undefined
  /** Append a direct UI/command result without fabricating a session event. */
  notice(text: string, options?: TuiNoticeOptions): void
  /** Append command output; preserve the viewport unless focus is requested. */
  commandOutput(command: string, text: string, options?: TuiOutputOptions): void
  /** Bind the product-owned Agent settings section; only one binding may be active. */
  bindAgentBehaviorSettings?(binding: TuiAgentBehaviorSettingsBinding): () => void
  /** Currently applied preferences, for sibling rows that must honor them. */
  prefs(): TuiPrefs
  /** Temporarily own the composer and collect one human answer. */
  prompt(request: TuiPrompt): Promise<string | null>
  /**
   * Replace the transcript while retaining earlier terminal output. Opening a
   * session adds a boundary; /new adds one only after transcript content.
   * Initial presentation and refreshes omit it. Defaults to opening a session.
   */
  replaceSession(
    events: readonly SessionEvent[],
    presentations?: ReadonlyMap<number, TuiToolPresentation>,
    status?: TuiStatus,
    reason?: TuiTranscriptReplacement,
  ): void
  /** Update session identity, recent rows, projected controls, and aggregate figures. */
  setSession(info: {
    id: string
    /** Folded title of the active session, when it has one. */
    title?: string
    recent: readonly TuiRecentSession[]
    stats?: TuiSessionStats
    controls?: TuiSessionControls
  }): void
  /**
   * Read the next submitted composer value. Resolves null when the user quits
   * (Ctrl-D on empty input, or stdin EOF in non-tty mode), on dispose, or when
   * `signal` aborts (the runner unmount must not leak a pending read). One
   * in-flight call at a time.
   */
  readInput(signal?: AbortSignal): Promise<TuiSubmission | null>
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
  /**
   * Subscribe to a request to open one descendant transcript.
   * @returns disposer removing the listener.
   */
  onInspectSubagent(listener: (id: string) => void): () => void
  /**
   * Subscribe to a request to return from a descendant transcript to the parent.
   * @returns disposer removing the listener.
   */
  onInspectClose(listener: () => void): () => void
  /**
   * Subscribe to a composer submission meant for the inspected continuable child.
   * The provider does not resolve {@link readInput} for these submissions.
   * @returns disposer removing the listener.
   */
  onInspectSubmit(listener: (submission: TuiSubmission) => void): () => void
  /** Replace the optional `@` session candidate source used by composer completion. */
  setSessionSearch(search?: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<readonly { sessionId: string; label: string; cwd?: string }[]>): void
  /** Replace the optional `@` file candidate source used by composer completion. */
  setFileSearch(search?: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<readonly { path: string; kind: 'file' | 'directory' }[]>): void
  /** Replace the optional Harness image-admission check applied when a paste drafts an image. */
  setImageValidator(validate?: (image: TuiInputImage) => Promise<void>): void
  /** Restore terminal state and settle a pending input read with null. */
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The omdsh terminal presentation service. */
    tui: TuiService
  }
}
