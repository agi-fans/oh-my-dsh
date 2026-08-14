/**
 * TUI capability seam — Service Definition.

 * The tui service is the presentation role of the omdsh capability seam:
 * the provider (./provider-local.ts) owns the terminal and the renderer,
 * and consumers (./runner.ts) forward session events and read user input
 * through this protocol. The vocabulary mirrors the SDK wire surface
 * (session.event / session.status), so a future remote UI can reuse the
 * definition unchanged.
 * @module @omdsh/tui
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TuiToolRenderer } from './tool-renderers.ts'

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

/** One terminal-owned human prompt used by approval and question adapters. */
export interface TuiPrompt {
  title: string
  question: string
  detail?: string
  options?: readonly { label: string; description?: string }[]
  multiSelect?: boolean
  allowCustom?: boolean
  /** Verb shown after Enter in selector navigation, such as "run". */
  submitLabel?: string
  signal?: AbortSignal
}

/** Lightweight durable session row used by the welcome card and resume UI. */
export interface TuiRecentSession {
  id: string
  title: string
  createdAt: number
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

/**
 * Terminal presentation service.
 * Implementations must be single-consumer: one runner owns readline().
 */
export interface TuiService {
  /** Render one session-log event (streamed as recorded). */
  event(event: SessionEvent): void
  /** Update the status line liveness. */
  setStatus(status: TuiStatus): void
  /** Update the model label shown on the status line. */
  setModel(model: string): void
  /** Replace the tool list shown by `/tools`. */
  setTools(tools: readonly { name: string; description: string }[]): void
  /** Register a rich exact-name tool renderer; later registrations win. */
  registerToolRenderer(renderer: TuiToolRenderer): () => void
  /** Replace commands contributed by the active agent's Harness scope. */
  setCommands(commands: readonly TuiCommand[]): void
  /** Append a direct UI/command result without fabricating a session event. */
  notice(text: string, level?: 'info' | 'error'): void
  /** Temporarily own the composer and collect one human answer. */
  prompt(request: TuiPrompt): Promise<string | null>
  /** Replace the transcript when a new or resumed session becomes active. */
  replaceSession(events: readonly SessionEvent[]): void
  /** Update session identity, recent rows, and aggregate status figures. */
  setSession(info: { id: string; recent: readonly TuiRecentSession[]; stats?: TuiSessionStats }): void
  /**
   * Read the next submitted input line. Resolves null when the user quits
   * (Ctrl-D on empty input, or stdin EOF in non-tty mode). One in-flight
   * call at a time.
   */
  readline(): Promise<string | null>
  /**
   * Subscribe to Ctrl-C. The listener fires when the user presses Ctrl-C
   * while a turn is running; an idle Ctrl-C clears the input line instead.
   * @returns disposer removing the listener.
   */
  onInterrupt(listener: () => void): () => void
  /** Restore terminal state and settle a pending readline with null. */
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The omdsh terminal presentation service. */
    tui: TuiService
  }
}
