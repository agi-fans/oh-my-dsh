/**
 * One cancellable long operation with its own progress surface.
 *
 * A long command needs three things wired together, and every call site used to
 * write the same wiring by hand:
 *
 * 1. a signal that combines the caller's own cancellation with the reader's;
 * 2. a prompt that gives the reader a way to cancel — Enter, Escape, `Ctrl+C`;
 * 3. a "finished" signal so that dismissing the prompt because the *work* ended
 *    is not mistaken for the reader cancelling the work.
 *
 * The third point is where hand-written copies went wrong: the prompt's promise
 * settles both when the reader cancels and when the operation completes, so a
 * naive `.then(() => controller.abort())` aborted the operation on its own
 * success. Each site had to guard it with a second `finished` controller, and
 * each site wrote that guard differently.
 *
 * `run()` owns the whole lifecycle: the body receives the combined signal, and
 * the prompt is dismissed when the body settles either way.
 *
 * @module @agi-fans/dsh-tui/cancellable
 */

import type { TuiService } from '../definition.ts'

/** One progress surface the reader can cancel from. */
export interface CancellableProgress {
  /** Title of the surface, such as `Creating worktree`. */
  title: string
  /** The subject line: what is being done, in one row. */
  question: string
  /** What cancelling does and does not undo. Shown under the subject. */
  detail?: string
  /** Label of the cancel option. */
  cancelLabel?: string
  /**
   * Progress card, or a reading surface that updates while the work streams.
   *
   * A streaming operation (a side question's answer) needs a document the reader
   * can watch and scroll; a file restore only needs to say what is happening. The
   * lifecycle is identical, so both are one option rather than two helpers.
   */
  presentation?: 'progress' | 'document'
  /** Repaint the open document; read on each refresh. */
  document?: () => string
  /**
   * Whether to open the surface at all.
   *
   * The caller decides, because the three operations disagreed: a worktree and a
   * side question are interactive-only, while a file restore reports progress even
   * when the caller did not claim an interactive screen. Inferring this from
   * `tui.interactive` silently dropped the restore's progress surface.
   */
  surface: boolean
}

/**
 * Why a cancellable operation stopped early.
 *
 * The two are not the same event: a reader who presses cancel is watching, and
 * knows the work stopped, while a superseded surface means the screen was taken
 * by something else and the reader never saw the result. Callers that report a
 * partial outcome treat them differently.
 */
export type CancellationReason = 'cancelled' | 'superseded'

/**
 * Run one long operation behind a cancel surface.
 *
 * Returns `undefined` when the operation never started because the caller was
 * already aborted, so callers can skip their success path without checking.
 *
 * A non-interactive host runs the body without a surface: there is no reader to
 * cancel it, and opening a prompt would claim a screen the pipe does not have.
 */
export async function cancellable<T>(
  tui: Pick<TuiService, 'interactive' | 'prompt'>,
  progress: CancellableProgress,
  parent: AbortSignal,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<{ value: T; reason: CancellationReason | undefined } | undefined> {
  if (parent.aborted) return undefined
  const cancel = new AbortController()
  const finished = new AbortController()
  const signal = AbortSignal.any([parent, cancel.signal])
  let superseded = false

  const surface = progress.surface
    ? tui.prompt({
      title: progress.title,
      question: progress.question,
      ...(progress.detail === undefined ? {} : { detail: progress.detail }),
      ...(progress.document === undefined ? {} : { refreshDocument: progress.document }),
      // Both surfaces report cancellation through the `interrupt` hook instead of
      // the returned value, because the reader may be reading while it runs; the
      // option list is only the keyboard affordance.
      presentation: progress.presentation ?? 'progress',
      options: [{ label: progress.cancelLabel ?? 'Cancel', value: 'cancel' }],
      allowCustom: false,
      notify: false,
      signal: AbortSignal.any([parent, finished.signal]),
      interrupt: () => { cancel.abort(); return true },
      // A superseding prompt takes the screen, which ends this operation rather
      // than letting it run behind a surface nobody can see.
      onSuperseded: () => { superseded = true; cancel.abort() },
    })
      .then(() => { if (!finished.signal.aborted) cancel.abort() }, () => { cancel.abort() })
    : Promise.resolve()

  try {
    const value = await run(signal)
    // `cancel` also fires when the parent aborted; only a stop the reader caused
    // is reported as one.
    const stopped = cancel.signal.aborted && !parent.aborted
    return { value, reason: stopped ? (superseded ? 'superseded' : 'cancelled') : undefined }
  } finally {
    // Dismiss the surface exactly once, whether the work finished, failed, or
    // was cancelled. Aborting `finished` first is what tells the prompt's own
    // `.then` that this dismissal is not a cancellation.
    finished.abort()
    await surface
  }
}
