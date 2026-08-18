/** User-overridable application keybindings loaded from one JSON document. */

import { readFileSync } from 'node:fs'

export type TuiAction = 'external-editor' | 'retry' | 'paste-clipboard' | 'copy-prompt' | 'copy-line'

export const DEFAULT_KEYBINDINGS: Readonly<Record<string, TuiAction>> = Object.freeze({
  'ctrl+x': 'external-editor',
  'alt+r': 'retry',
  'ctrl+v': 'paste-clipboard',
  'alt+c': 'copy-prompt',
  'ctrl+alt+c': 'copy-line',
})

const ACTIONS: readonly TuiAction[] = ['external-editor', 'retry', 'paste-clipboard', 'copy-prompt', 'copy-line']

/** Load `{ "key-id": "action" }`; invalid rows are ignored independently. */
export function loadKeybindings(path: string | undefined): Record<string, TuiAction> {
  const result: Record<string, TuiAction> = { ...DEFAULT_KEYBINDINGS }
  if (path === undefined) return result
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return result
    for (const [key, action] of Object.entries(parsed)) {
      if (typeof action === 'string' && ACTIONS.includes(action as TuiAction)) result[key.toLowerCase()] = action as TuiAction
    }
  } catch { /* missing/malformed user config falls back to shipped bindings */ }
  return result
}
