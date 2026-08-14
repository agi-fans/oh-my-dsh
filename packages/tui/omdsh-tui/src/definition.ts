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

/** Context service name providers publish under. */
export const TUI_SERVICE = 'tui'

/** Whole-agent liveness, mirroring the SDK session.status vocabulary. */
export type TuiStatus = 'idle' | 'running'

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
