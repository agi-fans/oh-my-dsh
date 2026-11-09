/**
 * User-overridable application keybindings loaded from one JSON document.
 *
 * The catalog in `./actions.ts` is the single source of truth: it supplies the
 * shipped chords, the accepted aliases, and the wording every surface prints.
 * This module only layers a user's `{ "key-id": "action" }` document on top and
 * reports the chords that document makes ambiguous.
 * @module @agi-fans/dsh-tui
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { normalizeKeyId } from './keys.ts'
import {
  DEFAULT_KEYBINDINGS,
  isPrimaryKey,
  TUI_ACTIONS,
  type TuiAction,
} from './actions.ts'

export {
  DEFAULT_KEYBINDINGS,
  TUI_ACTIONS,
  TUI_ACTION_CATALOG,
  TUI_ACTION_LABELS,
  type TuiAction,
  type TuiActionDefinition,
  type TuiActionScope,
} from './actions.ts'

/** Load `{ "key-id": "action" }`; invalid rows are ignored independently, and `null` unbinds a default key. */
export function loadKeybindings(path: string | undefined): Record<string, TuiAction> {
  const result: Record<string, TuiAction> = { ...DEFAULT_KEYBINDINGS }
  if (path === undefined) return result
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return result
    for (const [key, action] of Object.entries(parsed)) {
      const normalized = normalizeKeyId(key)
      if (action === null) delete result[normalized]
      else if (typeof action === 'string' && TUI_ACTIONS.includes(action as TuiAction)) result[normalized] = action as TuiAction
    }
  } catch { /* missing/malformed user config falls back to shipped bindings */ }
  return result
}

/** Persist user keybinding overrides relative to {@link DEFAULT_KEYBINDINGS}. */
export function saveKeybindings(path: string, bindings: Readonly<Record<string, TuiAction>>): void {
  const normalizedBindings = Object.fromEntries(Object.entries(bindings).map(([key, action]) => [normalizeKeyId(key), action]))
  const overrides: Record<string, TuiAction | null> = {}
  for (const [key, defaultAction] of Object.entries(DEFAULT_KEYBINDINGS)) {
    const current = normalizedBindings[key]
    if (current === undefined) overrides[key] = null
    else if (current !== defaultAction) overrides[key] = current
  }
  for (const [key, action] of Object.entries(normalizedBindings)) {
    if (!(key in DEFAULT_KEYBINDINGS) && TUI_ACTIONS.includes(action)) {
      overrides[key] = action
    }
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(overrides, null, 2) + '\n', 'utf8')
}

/**
 * The bindings a hint is allowed to print.
 *
 * A resolved table also names the aliases a migration kept working, and a hint
 * that printed `Ctrl+F / Ctrl+Shift+F` for one action would be telling the user
 * about a chord the interface does not want them to learn. Only chords that are
 * a shipped primary for their action survive, so an override that deliberately
 * moves an action is still printed and a straggler alias is not. When only an
 * alias remains, show it so an active action does not appear disabled.
 */
export function displayBindings(bindings: Readonly<Record<string, TuiAction>>): Record<string, TuiAction> {
  const preferred = new Set(Object.entries(bindings)
    .filter(([key, action]) => isPrimaryKey(action, key) || DEFAULT_KEYBINDINGS[key] !== action)
    .map(([, action]) => action))
  const shown: Record<string, TuiAction> = {}
  for (const [key, action] of Object.entries(bindings)) {
    // Shipped primary: always shown. Aliases stay hidden while a preferred key remains.
    // Any key the catalog does not give this action — a user override — is theirs to see.
    if (isPrimaryKey(action, key) || DEFAULT_KEYBINDINGS[key] !== action || !preferred.has(action)) shown[key] = action
  }
  return shown
}
