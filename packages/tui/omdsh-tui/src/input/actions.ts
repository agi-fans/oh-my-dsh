/**
 * One named catalog of application actions.
 *
 * Every key the application answers to belongs to exactly one action, so a
 * concept has one identity across dispatch, the `/help` catalog, the hints an
 * overlay prints, and the document a user writes overrides into. Keys the
 * application honours but no longer advertises are listed as `aliases`: they
 * still resolve, they are never shown, and removing one is a documentation
 * change rather than a behavior change.
 * @module @agi-fans/dsh-tui
 */

/** Where an action applies, so an overlay can present only what it owns. */
export type TuiActionScope = 'composer' | 'turn' | 'transcript' | 'session'

export interface TuiActionDefinition {
  readonly id: TuiAction
  /** Ship-default keys, in the order a hint should print them. */
  readonly primary: readonly string[]
  /** Accepted keys that are never advertised; a migration keeps them working. */
  readonly aliases?: readonly string[]
  readonly label: string
  readonly scope: TuiActionScope
}

export type TuiAction =
  // The four keys that end or rescue whatever is happening.
  | 'interrupt' | 'clear-composer' | 'quit' | 'suspend'
  | 'reset-display'
  // Composer
  | 'external-editor' | 'stash-draft' | 'paste-clipboard' | 'expand-paste' | 'preview-images'
  | 'copy-prompt' | 'copy-line' | 'follow-up' | 'dequeue' | 'steer-turn' | 'manage-queue' | 'retry'
  // Model and thinking
  | 'select-model' | 'cycle-model-forward' | 'cycle-model-backward' | 'cycle-thinking' | 'toggle-thinking'
  // Transcript
  | 'toggle-tools' | 'toggle-tool-details' | 'review-changes' | 'search-history' | 'search-transcript'
  | 'scroll-page-up' | 'scroll-page-down' | 'scroll-fast-up' | 'scroll-fast-down' | 'inspect-subagent'

const WINDOWS = process.platform === 'win32'

export const TUI_ACTION_CATALOG: readonly TuiActionDefinition[] = [
  { id: 'interrupt', primary: ['escape'], label: 'Cancel, interrupt, or leave the current surface', scope: 'turn' },
  { id: 'clear-composer', primary: ['ctrl+c'], label: 'Clear the composer; twice exits', scope: 'composer' },
  { id: 'quit', primary: ['ctrl+d'], label: 'Exit when the composer is empty', scope: 'session' },
  {
    id: 'suspend',
    primary: WINDOWS ? [] : ['ctrl+z'],
    label: 'Suspend to the background (POSIX only)',
    scope: 'session',
  },
  { id: 'reset-display', primary: ['alt+l'], label: 'Repaint the terminal display', scope: 'session' },

  // Ctrl+X is the established omdsh chord and Ctrl+G is the Pi one; both are
  // primary, so neither habit becomes a hidden alias.
  { id: 'external-editor', primary: ['ctrl+x', 'ctrl+g'], label: 'Edit the prompt in the selected editor', scope: 'composer' },
  { id: 'stash-draft', primary: ['ctrl+s'], label: 'Stash or restore the composer draft', scope: 'composer' },
  { id: 'paste-clipboard', primary: ['ctrl+v'], label: 'Paste clipboard text or an image', scope: 'composer' },
  { id: 'expand-paste', primary: ['alt+i'], label: 'Expand a pasted block for editing', scope: 'composer' },
  { id: 'preview-images', primary: ['alt+m'], label: 'Preview draft images', scope: 'composer' },
  { id: 'copy-prompt', primary: ['alt+c'], label: 'Copy the selection or current prompt', scope: 'composer' },
  { id: 'copy-line', primary: ['ctrl+alt+c'], label: 'Copy the current line', scope: 'composer' },
  {
    id: 'follow-up',
    primary: [WINDOWS ? 'ctrl+q' : 'alt+enter'],
    aliases: WINDOWS ? ['alt+enter'] : [],
    label: 'Queue the draft for after the active turn',
    scope: 'composer',
  },
  { id: 'dequeue', primary: ['alt+up'], label: 'Recall the latest queued message', scope: 'composer' },
  { id: 'steer-turn', primary: ['alt+s'], label: 'Send the draft to the active turn’s next step', scope: 'composer' },
  { id: 'manage-queue', primary: ['alt+q'], label: 'Manage queued messages', scope: 'composer' },
  { id: 'retry', primary: ['alt+r'], label: 'Retry the latest human prompt', scope: 'composer' },

  { id: 'select-model', primary: ['ctrl+l'], label: 'Choose model and reasoning effort', scope: 'session' },
  { id: 'cycle-model-forward', primary: ['ctrl+p'], label: 'Cycle to the next favorite model', scope: 'session' },
  {
    id: 'cycle-model-backward',
    primary: ['ctrl+shift+p'],
    aliases: ['alt+p'],
    label: 'Cycle to the previous favorite model',
    scope: 'session',
  },
  { id: 'cycle-thinking', primary: ['shift+tab'], aliases: ['ctrl+shift+t'], label: 'Cycle the reasoning effort', scope: 'session' },
  { id: 'toggle-thinking', primary: ['ctrl+t'], label: 'Show or hide thinking in the transcript', scope: 'transcript' },

  { id: 'toggle-tools', primary: ['ctrl+o'], label: 'Toggle completed turn details', scope: 'transcript' },
  { id: 'toggle-tool-details', primary: ['alt+o'], label: 'Toggle full tool inputs and results', scope: 'transcript' },
  { id: 'review-changes', primary: ['alt+v'], label: 'Preview the files the tool under the viewport declared', scope: 'transcript' },
  { id: 'search-history', primary: ['ctrl+r'], label: 'Search prompt history', scope: 'composer' },
  {
    id: 'search-transcript',
    primary: ['ctrl+shift+f'],
    aliases: ['ctrl+f'],
    label: 'Search the current transcript',
    scope: 'transcript',
  },
  { id: 'scroll-page-up', primary: ['pageup'], label: 'Scroll the transcript up one page', scope: 'transcript' },
  { id: 'scroll-page-down', primary: ['pagedown'], label: 'Scroll the transcript down one page', scope: 'transcript' },
  { id: 'scroll-fast-up', primary: ['shift+up'], label: 'Scroll the transcript up quickly', scope: 'transcript' },
  { id: 'scroll-fast-down', primary: ['shift+down'], label: 'Scroll the transcript down quickly', scope: 'transcript' },
]

export const TUI_ACTIONS: readonly TuiAction[] = TUI_ACTION_CATALOG.map(entry => entry.id)

export const TUI_ACTION_LABELS: Readonly<Record<TuiAction, string>> = Object.freeze(
  Object.fromEntries(TUI_ACTION_CATALOG.map(entry => [entry.id, entry.label])) as Record<TuiAction, string>,
)

/** Every key the application answers to, including accepted aliases. */
export const DEFAULT_KEYBINDINGS: Readonly<Record<string, TuiAction>> = Object.freeze(
  Object.fromEntries(TUI_ACTION_CATALOG.flatMap(entry =>
    [...entry.primary, ...entry.aliases ?? []].map(key => [key, entry.id] as const))) as Record<string, TuiAction>,
)

/** Only the keys a hint may print; aliases stay out of the interface. */
export const DEFAULT_DISPLAY_BINDINGS: Readonly<Record<string, TuiAction>> = Object.freeze(
  Object.fromEntries(TUI_ACTION_CATALOG.flatMap(entry =>
    entry.primary.map(key => [key, entry.id] as const))) as Record<string, TuiAction>,
)

const PRIMARY_KEYS = new Map<TuiAction, ReadonlySet<string>>(
  TUI_ACTION_CATALOG.map(entry => [entry.id, new Set(entry.primary)]),
)

/** The shipped primary chords of one action, in hint order. */
export function primaryKeysOf(action: TuiAction): readonly string[] {
  return TUI_ACTION_CATALOG.find(entry => entry.id === action)?.primary ?? []
}

/** Whether `key` is a shipped default for `action`, alias or primary. */
export function isPrimaryKey(action: TuiAction, key: string): boolean {
  return PRIMARY_KEYS.get(action)?.has(key) === true
}

export interface TuiActionConflict {
  readonly action: TuiAction
  readonly key: string
  /** The shipped action that also claims `key`. */
  readonly conflictsWith: TuiAction
  /** The action `key` actually resolves to. */
  readonly resolvesTo: TuiAction
}

/**
 * Report user bindings that claim a key another action already owns.
 *
 * Two actions on one chord is not repairable by the loader — one of them has to
 * win, and which one is not obvious from the document alone. The loader still
 * resolves it the same way every time, and this read-only report lets `/help`
 * and the settings overlay say so instead of leaving a key silently dead.
 */
export function reportBindingConflicts(bindings: Readonly<Record<string, TuiAction>>): readonly TuiActionConflict[] {
  const claims = new Map<string, TuiAction[]>()
  for (const [key, action] of Object.entries(bindings)) {
    const normalized = key.toLowerCase()
    claims.set(normalized, [...claims.get(normalized) ?? [], action])
  }
  const conflicts: TuiActionConflict[] = []
  for (const [key, actions] of claims) {
    if (actions.length < 2) continue
    const resolvesTo = bindings[key] as TuiAction
    for (const action of actions) {
      const shipped = DEFAULT_KEYBINDINGS[key]
      // A chord shared inside one action (primary + alias) is not a conflict.
      if (action === resolvesTo && shipped !== action) continue
      conflicts.push({
        action,
        key,
        conflictsWith: actions.find(other => other !== action) ?? action,
        resolvesTo,
      })
    }
  }
  return conflicts
}
