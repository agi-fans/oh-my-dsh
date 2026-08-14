/**
 * Settings overlay: OMP-style cycleable TUI prefs (theme + color).
 * Pure — the provider owns live application of the selected values.
 * @module @omdsh/tui
 */

import type { KeyEvent } from './keys.ts'
import { SYMBOL, THEME_NAMES, type Theme, type ThemeName, isThemeName } from './theme.ts'
import { truncateToWidth, visibleWidth } from './width.ts'

/** One cycleable row in the overlay. */
export interface SettingItem {
  id: string
  label: string
  description: string
  value: string
  values: readonly string[]
}

/** Session-local TUI prefs the overlay can change. */
export interface TuiPrefs {
  theme: ThemeName
  colors: boolean
}

/** Live overlay state. */
export interface SettingsState {
  selected: number
  prefs: TuiPrefs
}

/** Outcome of one key against the overlay. */
export type SettingsCommand =
  | { kind: 'update'; state: SettingsState }
  | { kind: 'apply'; state: SettingsState }
  | { kind: 'close' }
  | { kind: 'ignore' }

const COLOR_VALUES = ['on', 'off'] as const

/** Rows shown in `/settings` (OMP settings-list cycle widgets). */
export function tuiSettingItems(prefs: TuiPrefs): SettingItem[] {
  return [
    {
      id: 'theme',
      label: 'Theme',
      description: 'Color palette',
      value: prefs.theme,
      values: THEME_NAMES,
    },
    {
      id: 'colors',
      label: 'Color',
      description: 'SGR styling',
      value: prefs.colors ? 'on' : 'off',
      values: COLOR_VALUES,
    },
  ]
}

/** Apply one cycled value back onto the prefs record. */
export function applySettingValue(prefs: TuiPrefs, id: string, value: string): TuiPrefs {
  if (id === 'theme' && isThemeName(value)) return { ...prefs, theme: value }
  if (id === 'colors') return { ...prefs, colors: value === 'on' }
  return prefs
}

function nextValue(current: string, values: readonly string[]): string {
  const index = values.indexOf(current)
  return values[(index + 1) % values.length] ?? values[0] ?? current
}

/** Open the overlay on the current prefs, optionally focused on one row. */
export function createSettings(prefs: TuiPrefs, focusId?: string): SettingsState {
  const items = tuiSettingItems(prefs)
  const focused = focusId === undefined ? 0 : items.findIndex((item) => item.id === focusId)
  return { prefs, selected: focused >= 0 ? focused : 0 }
}

function moveSelected(state: SettingsState, next: number): SettingsState {
  const n = tuiSettingItems(state.prefs).length
  if (n === 0) return state
  const selected = (next % n + n) % n
  if (selected === state.selected) return state
  return { ...state, selected }
}

function cycleSelected(state: SettingsState): SettingsState {
  const items = tuiSettingItems(state.prefs)
  const item = items[state.selected]
  if (item === undefined) return state
  const value = nextValue(item.value, item.values)
  return { selected: state.selected, prefs: applySettingValue(state.prefs, item.id, value) }
}

/** Apply one decoded event to the overlay. */
export function applySettingsEvent(state: SettingsState, event: KeyEvent): SettingsCommand {
  if (event.type === 'text' && event.value === ' ') {
    return { kind: 'apply', state: cycleSelected(state) }
  }
  if (event.type !== 'key') return { kind: 'ignore' }
  switch (event.id) {
    case 'enter':
      return { kind: 'apply', state: cycleSelected(state) }
    case 'escape':
    case 'ctrl+c':
      return { kind: 'close' }
    case 'up':
    case 'shift+tab':
      return { kind: 'update', state: moveSelected(state, state.selected - 1) }
    case 'down':
    case 'tab':
      return { kind: 'update', state: moveSelected(state, state.selected + 1) }
    case 'home':
      return { kind: 'update', state: moveSelected(state, 0) }
    case 'end':
      return { kind: 'update', state: moveSelected(state, tuiSettingItems(state.prefs).length - 1) }
    default:
      return { kind: 'ignore' }
  }
}

/** Overlay frame: title, cycleable rows, selected description, hints. */
export function renderSettings(
  state: SettingsState,
  theme: Theme,
  width: number,
): { lines: string[]; cursor: { row: number; column: number } } {
  const items = tuiSettingItems(state.prefs)
  const index = Math.max(0, Math.min(state.selected, Math.max(0, items.length - 1)))
  const title = ' ' + theme.bold(theme.fg('accent', '⚙ Settings'))
  const rows = items.map((item, i) => renderSettingRow(item, i === index, theme, width))
  const selected = items[index]
  const description = selected === undefined
    ? ''
    : '  ' + theme.fg('muted', selected.description)
  const hints = ' ' + theme.fg('dim', '↑↓ navigate') + theme.fg('dim', ' · ')
    + theme.fg('dim', 'enter cycle') + theme.fg('dim', ' · ')
    + theme.fg('dim', 'esc close')
  const lines = ['', title, '', ...rows, '', description, '', hints]
  return {
    lines,
    cursor: { row: 3 + index, column: 2 },
  }
}

function renderSettingRow(item: SettingItem, selected: boolean, theme: Theme, width: number): string {
  const cursor = selected ? theme.fg('accent', SYMBOL.cursor + ' ') : '  '
  const label = selected ? theme.bold(theme.fg('accent', item.label)) : item.label
  const value = selected ? theme.fg('accent', item.value) : theme.fg('muted', item.value)
  const fill = Math.max(1, width - visibleWidth(cursor) - visibleWidth(label) - visibleWidth(value))
  return truncateToWidth(cursor + label + ' '.repeat(fill) + value, width)
}
