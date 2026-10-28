/**
 * The four intents a caller actually has when it asks the reader something.
 *
 * `TuiPrompt` grew to forty-six optional fields because every new surface added
 * one: `presentation`, `optionLayout`, `filterable`, `approveValue`,
 * `dismissLabel`, `skippable`, `wait`, `interrupt`, `onSuperseded`,
 * `refreshDocument`, `refreshOptions` … A caller passing `{ title, question,
 * allowCustom: true }` had to know that omitting `options` means "free text" and
 * that `allowCustom: false` is what makes a list non-editable. Nothing in the
 * type said which fields belong together, so each new caller assembled its own
 * combination and the interface kept widening.
 *
 * These four intents are measured, not invented: across 196 call sites, 109 ask
 * for free text, 45 offer a list, 14 read a document, and the rest are those
 * shapes with one extra field. Each function below names the intent, defaults
 * what the intent always wants, and leaves the escape hatch — {@link TuiService.prompt}
 * with the full type — for the handful of surfaces that genuinely need it.
 *
 * @module @agi-fans/dsh-tui/prompt-intents
 */

import type { TuiDocumentPosition, TuiDocumentSource, TuiPrompt } from './definition.ts'

/** One choice a {@link choose} offers. */
export interface PromptChoice {
  label: string
  /** Answer returned to the caller; defaults to {@link label}. */
  value?: string
  description?: string
  /** Parent value when the list is a tree; a missing parent makes a root. */
  parentValue?: string
  /** Secondary content shown above the metadata in a spacious list. */
  preview?: string
  /** Verb shown for Enter on this row. */
  submitLabel?: string
  /** Semantic badge painted after the description. */
  badge?: { label: string; tone: 'success' | 'warning' | 'error' | 'muted' }
}

/** One keyboard chord a {@link choose} list accepts besides Enter and the arrows. */
export interface PromptAction {
  key: string
  label: string
  /** Returned before the selected value, so the caller can tell which chord fired. */
  valuePrefix: string
  /** `list` returns only the prefix, even with no row selected. */
  scope?: 'selection' | 'list'
}

/** A surface that needs no answer, only a decision to stop. */
export interface CancelSurface {
  /** Label of the option that cancels; defaults to `Cancel`. */
  cancelLabel?: string
  /** What cancelling does and does not undo. */
  detail?: string
  signal?: AbortSignal
  /**
   * The work behind the surface, so `Esc` and `Ctrl+C` can stop it.
   *
   * Returning true keeps a primary turn running: a progress surface belongs to
   * one operation, not to the session.
   */
  interrupt?: () => boolean | void
  /** The surface was taken by something with a stronger claim on the screen. */
  onSuperseded?: (input: string) => void
  /** Repaint an open document; read on every refresh. */
  refreshDocument?: () => string
}

/**
 * Ask for free text.
 *
 * This is the shape 109 of 196 call sites wanted and had to spell as
 * `{ allowCustom: true, notify: false }`. A bare input needs no `options` array
 * and no `presentation`; both are supplied here so the caller states one thing.
 */
export function askPrompt(request: {
  title: string
  question: string
  detail?: string
  /** Prefilled text the reader can edit. */
  initialInput?: string
  /** Keep indentation and trailing newlines, for message-shaped input. */
  preserveWhitespace?: boolean
  /** Mask what is typed; the real value stays in the editor only. */
  secret?: boolean
  /** Rescue partially typed text when the prompt is dismissed or aborted. */
  onCancelDraft?: (draft: string) => void
  /** Verb shown for Enter, such as `validate`; the input is still free text. */
  submitLabel?: string
  signal?: AbortSignal
  /** Announce this prompt; off for user-initiated surfaces the reader just opened. */
  notify?: boolean
}): TuiPrompt {
  return {
    title: request.title,
    question: request.question,
    ...(request.detail === undefined ? {} : { detail: request.detail }),
    ...(request.initialInput === undefined ? {} : { initialInput: request.initialInput }),
    ...(request.preserveWhitespace === true ? { preserveWhitespace: true } : {}),
    ...(request.secret === true ? { secret: true } : {}),
    ...(request.onCancelDraft === undefined ? {} : { onCancelDraft: request.onCancelDraft }),
    ...(request.submitLabel === undefined ? {} : { submitLabel: request.submitLabel }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    allowCustom: true,
    notify: request.notify ?? false,
  }
}

/**
 * Offer a list of choices.
 *
 * The list is not editable: a caller that wants both a list and free text wants
 * {@link askPrompt} with `detail`, or the full {@link TuiPrompt} if it really
 * needs both. Keeping the two apart is what lets this function state the shape
 * without an `allowCustom` flag the caller has to reason about.
 */
export function choosePrompt<const T extends PromptChoice>(request: {
  title: string
  question: string
  detail?: string
  options: readonly T[]
  /** Value selected when the list opens. */
  initialValue?: string
  /** Let typed text filter the rows. */
  filterable?: boolean
  /** Full-screen page rather than an inline list. */
  fullscreen?: boolean
  /** Spell each row across two lines instead of one. */
  spacious?: boolean
  /** Text shown when the list has no rows; the caller owns this wording. */
  emptyText?: string
  /** Keyboard chords the list accepts besides Enter and the arrows. */
  actions?: readonly PromptAction[]
  /** Allow more than one row to be checked. */
  multiSelect?: boolean
  /** Values checked when a multi-select list opens. */
  initialValues?: readonly string[]
  /** Submit an empty answer when every choice is unchecked. */
  allowEmptySelection?: boolean
  /** Verb shown after Enter in the navigation hint. */
  submitLabel?: string
  signal?: AbortSignal
  notify?: boolean
}): TuiPrompt {
  const fullscreen = request.fullscreen === true
  return {
    title: request.title,
    question: request.question,
    ...(request.detail === undefined ? {} : { detail: request.detail }),
    options: request.options,
    ...(request.initialValue === undefined ? {} : { initialValue: request.initialValue }),
    ...(request.filterable === true ? { filterable: true } : {}),
    ...(fullscreen ? { presentation: 'fullscreen-list' as const, optionLayout: 'compact' as const } : {}),
    ...(request.spacious === true ? { optionLayout: 'spacious' as const } : {}),
    ...(request.emptyText === undefined ? {} : { emptyText: request.emptyText }),
    ...(request.actions === undefined ? {} : { actions: request.actions }),
    ...(request.multiSelect === true ? { multiSelect: true } : {}),
    ...(request.initialValues === undefined ? {} : { initialValues: request.initialValues }),
    ...(request.allowEmptySelection === true ? { allowEmptySelection: true } : {}),
    ...(request.submitLabel === undefined ? {} : { submitLabel: request.submitLabel }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    allowCustom: false,
    notify: request.notify ?? false,
  }
}

/**
 * Ask one yes/no question.
 *
 * Returns a boolean rather than a string or null, because "dismissed" and "no"
 * are the same answer: a reader who presses Escape has not agreed to anything.
 * Callers that need to tell those apart use the full prompt.
 */
export async function confirmPrompt(
  prompt: (request: TuiPrompt) => Promise<string | null>,
  request: {
    title: string
    question: string
    detail?: string
    /** Verb on the accepting row; the declining row is always a cancel. */
    acceptLabel?: string
    /** Label of the declining row; defaults to `Cancel`. */
    cancelLabel?: string
    signal?: AbortSignal
    notify?: boolean
  },
): Promise<boolean> {
  const accept = request.acceptLabel ?? 'Continue'
  const answer = await prompt({
    title: request.title,
    question: request.question,
    ...(request.detail === undefined ? {} : { detail: request.detail }),
    options: [{ label: accept, value: 'accept' }, { label: request.cancelLabel ?? 'Cancel', value: 'cancel' }],
    initialValue: 'cancel',
    allowCustom: false,
    notify: request.notify ?? false,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  return answer === 'accept'
}

/**
 * Show a document the reader can scroll, search, and leave.
 *
 * The surface is dropped automatically when the work it describes ends, so the
 * caller does not have to pair an open with a close.
 */
export function readPrompt(request: {
  title: string
  question: string
  /** The text to read; wrapped by default. */
  text?: string
  /** A prepared source reader with line numbers and search. */
  source?: TuiDocumentSource
  /** Open at this position. */
  position?: TuiDocumentPosition
  /** Open at the latest row, for output that is still arriving. */
  tail?: boolean
  /** A prepared image shown in the dedicated reader. */
  image?: TuiPrompt['documentImage']
  /** Repaint while open; read on every refresh. */
  refresh?: () => string
  /** Told the last visible position when the reader leaves. */
  onPosition?: (position: TuiDocumentPosition) => void
  cancelLabel?: string
  detail?: string
  signal?: AbortSignal
  interrupt?: () => boolean | void
  onSuperseded?: (input: string) => void
}): TuiPrompt {
  return {
    title: request.title,
    question: request.question,
    ...(request.detail === undefined ? {} : { detail: request.detail }),
    // A plain string becomes a source so the reader gets line numbers and search
    // rather than a wrapped prose page; an explicit source wins.
    ...(request.source !== undefined
      ? { documentSource: request.source }
      : request.text === undefined ? {} : { documentSource: { text: request.text } }),
    ...(request.position === undefined ? {} : { documentPosition: request.position }),
    ...(request.tail === true ? { documentTail: true } : {}),
    ...(request.image === undefined ? {} : { documentImage: request.image }),
    ...(request.refresh === undefined ? {} : { refreshDocument: request.refresh }),
    ...(request.onPosition === undefined ? {} : { onDocumentPosition: request.onPosition }),
    options: [{ label: request.cancelLabel ?? 'Cancel', value: 'cancel' }],
    presentation: 'document',
    allowCustom: false,
    notify: false,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    ...(request.interrupt === undefined ? {} : { interrupt: request.interrupt }),
    ...(request.onSuperseded === undefined ? {} : { onSuperseded: request.onSuperseded }),
  }
}
