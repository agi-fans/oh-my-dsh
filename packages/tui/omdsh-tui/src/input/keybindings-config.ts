/** User-overridable application keybindings loaded from one JSON document. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type TuiAction = 'external-editor' | 'retry' | 'paste-clipboard' | 'copy-prompt' | 'copy-line' | 'inspect-subagent'
  | 'cycle-model-forward' | 'cycle-model-backward' | 'cycle-reasoning'
  | 'toggle-tools' | 'scroll-page-up' | 'scroll-page-down' | 'scroll-fast-up' | 'scroll-fast-down' | 'search-history'
  | 'search-transcript' | 'toggle-tool-details' | 'review-changes' | 'expand-paste' | 'steer-turn' | 'manage-queue' | 'preview-images'
  | 'stash-draft'

export const DEFAULT_KEYBINDINGS: Readonly<Record<string, TuiAction>> = Object.freeze({
  'ctrl+x': 'external-editor',
  'ctrl+s': 'stash-draft',
  'alt+m': 'preview-images',
  'alt+i': 'expand-paste',
  'alt+s': 'steer-turn',
  'alt+q': 'manage-queue',
  'alt+v': 'review-changes',
  'alt+r': 'retry',
  'ctrl+v': 'paste-clipboard',
  'alt+c': 'copy-prompt',
  'ctrl+alt+c': 'copy-line',
  'alt+a': 'inspect-subagent',
  'ctrl+p': 'cycle-model-forward',
  'alt+p': 'cycle-model-backward',
  'ctrl+t': 'cycle-reasoning',
  'ctrl+o': 'toggle-tools',
  'alt+o': 'toggle-tool-details',
  'pageup': 'scroll-page-up',
  'pagedown': 'scroll-page-down',
  'shift+up': 'scroll-fast-up',
  'shift+down': 'scroll-fast-down',
  'ctrl+r': 'search-history',
  'ctrl+f': 'search-transcript',
})

export const TUI_ACTIONS: readonly TuiAction[] = [
  'external-editor', 'stash-draft', 'retry', 'paste-clipboard', 'copy-prompt', 'copy-line', 'inspect-subagent',
  'cycle-model-forward', 'cycle-model-backward', 'cycle-reasoning',
  'toggle-tools', 'scroll-page-up', 'scroll-page-down', 'scroll-fast-up', 'scroll-fast-down', 'search-history',
  'search-transcript', 'toggle-tool-details', 'review-changes', 'expand-paste', 'steer-turn', 'manage-queue', 'preview-images',
]

export const TUI_ACTION_LABELS: Readonly<Record<TuiAction, string>> = Object.freeze({
  'external-editor': 'Edit prompt in external editor',
  'stash-draft': 'Stash or restore composer draft',
  'retry': 'Retry latest human prompt',
  'paste-clipboard': 'Paste clipboard text or image',
  'copy-prompt': 'Copy selection or current prompt',
  'copy-line': 'Copy current line',
  'inspect-subagent': 'Open subagent transcript',
  'cycle-model-forward': 'Cycle to next favorite model',
  'cycle-model-backward': 'Cycle to previous favorite model',
  'cycle-reasoning': 'Cycle model reasoning effort',
  'toggle-tools': 'Toggle completed turn details',
  'toggle-tool-details': 'Toggle full tool inputs and results',
  'scroll-page-up': 'Scroll transcript up one page',
  'scroll-page-down': 'Scroll transcript down one page',
  'scroll-fast-up': 'Scroll transcript up quickly',
  'scroll-fast-down': 'Scroll transcript down quickly',
  'search-history': 'Search prompt history',
  'search-transcript': 'Search current transcript',
  'review-changes': 'Preview tool files or review turn changes',
  'expand-paste': 'Expand pasted block for editing',
  'steer-turn': 'Steer active turn',
  'manage-queue': 'Manage queued messages',
  'preview-images': 'Preview draft images',
})

/** Load `{ "key-id": "action" }`; invalid rows are ignored independently, and `null` unbinds a default key. */
export function loadKeybindings(path: string | undefined): Record<string, TuiAction> {
  const result: Record<string, TuiAction> = { ...DEFAULT_KEYBINDINGS }
  if (path === undefined) return result
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return result
    for (const [key, action] of Object.entries(parsed)) {
      const normalized = key.toLowerCase()
      if (action === null) delete result[normalized]
      else if (typeof action === 'string' && TUI_ACTIONS.includes(action as TuiAction)) result[normalized] = action as TuiAction
    }
  } catch { /* missing/malformed user config falls back to shipped bindings */ }
  return result
}

/** Persist user keybinding overrides relative to {@link DEFAULT_KEYBINDINGS}. */
export function saveKeybindings(path: string, bindings: Readonly<Record<string, TuiAction>>): void {
  const overrides: Record<string, TuiAction | null> = {}
  for (const [key, defaultAction] of Object.entries(DEFAULT_KEYBINDINGS)) {
    const current = bindings[key]
    if (current === undefined) overrides[key] = null
    else if (current !== defaultAction) overrides[key] = current
  }
  for (const [key, action] of Object.entries(bindings)) {
    const normalized = key.toLowerCase()
    if (!(normalized in DEFAULT_KEYBINDINGS) && TUI_ACTIONS.includes(action)) {
      overrides[normalized] = action
    }
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(overrides, null, 2) + '\n', 'utf8')
}
