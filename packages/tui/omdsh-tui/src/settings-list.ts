/**
 * Settings overlay: cycleable theme, color, tool, and status-line preferences.
 * Pure — the provider owns live application of the selected values.
 * @module @omdsh/tui
 */

import type { KeyEvent } from './keys.ts'
import {
  STATUS_GROUP_IDS,
  STATUS_LABEL_STYLES,
  resolveStatusBarConfig,
  type StatusBarConfig,
  type StatusGroupId,
  type StatusPreset,
} from './status-config.ts'
import { renderSessionStatusLabel } from './status-line.ts'
import { BOX, SYMBOL, THEME_NAMES, type Theme, type ThemeName, isThemeName } from './theme.ts'
import { padToWidth, truncateToWidth, visibleWidth, wrapText } from './width.ts'

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
  expandTools: boolean
  statusBar?: StatusBarConfig
  /** Read-only migration input for settings written before status-line customization. */
  statusPreset?: StatusPreset
}

/** Live overlay state. */
export interface SettingsState {
  selected: number
  prefs: TuiPrefs
  /** Status group currently attached to the up/down reorder gesture. */
  moving?: StatusGroupId
}

/** Outcome of one key against the overlay. */
export type SettingsCommand =
  | { kind: 'update'; state: SettingsState }
  | { kind: 'apply'; state: SettingsState }
  | { kind: 'close' }
  | { kind: 'ignore' }

const COLOR_VALUES = ['on', 'off'] as const
const TOOL_DETAIL_VALUES = ['compact', 'expanded'] as const
const STATUS_GROUP_COPY: Record<StatusGroupId, { label: string; description: string }> = {
  context: { label: 'Context', description: 'Context-window pressure' },
  cache: { label: 'Cache', description: 'Prompt-cache hit rate' },
  tokens: { label: 'Tokens', description: 'Input and output token counts' },
  speed: { label: 'Latency', description: 'First-token latency and decode rate' },
  durations: { label: 'Time', description: 'LLM and tool duration' },
  counts: { label: 'Activity', description: 'Turn and step counts' },
}

function statusGroupItem(config: StatusBarConfig, id: StatusGroupId): SettingItem {
  const visible = config.groups.includes(id)
  return {
    id: `statusGroup:${id}`,
    label: STATUS_GROUP_COPY[id].label,
    description: STATUS_GROUP_COPY[id].description + '. Enter to move; Space to show or hide.',
    value: visible ? 'shown' : 'hidden',
    values: ['shown', 'hidden'],
  }
}

/** Rows shown in `/settings` (OMP settings-list cycle widgets). */
export function tuiSettingItems(prefs: TuiPrefs): SettingItem[] {
  const statusBar = resolveStatusBarConfig(prefs.statusBar, prefs.statusPreset)
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
    {
      id: 'expandTools',
      label: 'Tool details',
      description: 'Expand tool output and catalog details (Ctrl+O)',
      value: prefs.expandTools ? 'expanded' : 'compact',
      values: TOOL_DETAIL_VALUES,
    },
    {
      id: 'statusEnabled',
      label: 'Status line',
      description: 'Show the fixed two-line footer below the composer',
      value: statusBar.enabled ? 'on' : 'off',
      values: COLOR_VALUES,
    },
    {
      id: 'statusLabels',
      label: 'Labels',
      description: 'Compact or full metric labels',
      value: statusBar.labels,
      values: STATUS_LABEL_STYLES,
    },
    ...statusBar.order.map(id => statusGroupItem(statusBar, id)),
  ]
}

function updateStatusGroup(config: StatusBarConfig, id: StatusGroupId, value: string): StatusBarConfig {
  const groups = config.groups.filter(group => group !== id)
  if (value === 'hidden' || value === 'off') return { ...config, groups }
  if (value === 'shown') {
    const order = config.order ?? STATUS_GROUP_IDS
    const position = order.indexOf(id)
    const next = groups.findIndex(group => order.indexOf(group) > position)
    groups.splice(next < 0 ? groups.length : next, 0, id)
    return { ...config, groups }
  }
  const position = Number.parseInt(value, 10)
  if (!Number.isInteger(position) || position < 1 || position > STATUS_GROUP_IDS.length) return config
  groups.splice(Math.min(position - 1, groups.length), 0, id)
  return { ...config, groups }
}

/** Apply one cycled value back onto the prefs record. */
export function applySettingValue(prefs: TuiPrefs, id: string, value: string): TuiPrefs {
  if (id === 'theme' && isThemeName(value)) return { ...prefs, theme: value }
  if (id === 'colors') return { ...prefs, colors: value === 'on' }
  if (id === 'expandTools') return { ...prefs, expandTools: value === 'expanded' || value === 'on' }
  const statusBar = resolveStatusBarConfig(prefs.statusBar, prefs.statusPreset)
  if (id === 'statusEnabled') return { ...prefs, statusBar: { ...statusBar, enabled: value === 'on' } }
  if (id === 'statusLabels' && STATUS_LABEL_STYLES.includes(value as StatusBarConfig['labels'])) {
    return { ...prefs, statusBar: { ...statusBar, labels: value as StatusBarConfig['labels'] } }
  }
  if (id.startsWith('statusGroup:')) {
    const group = id.slice('statusGroup:'.length) as StatusGroupId
    if (STATUS_GROUP_IDS.includes(group)) return { ...prefs, statusBar: updateStatusGroup(statusBar, group, value) }
  }
  return prefs
}

function adjacentValue(current: string, values: readonly string[], direction: 1 | -1): string {
  const index = values.indexOf(current)
  return values[(index + direction + values.length) % values.length] ?? values[0] ?? current
}

/** Open the overlay on the current prefs, optionally focused on one row. */
export function createSettings(prefs: TuiPrefs, focusId?: string): SettingsState {
  const items = tuiSettingItems(prefs)
  const focused = focusId === undefined ? 0 : items.findIndex((item) => item.id === focusId)
  return { prefs, selected: focused >= 0 ? focused : 0 }
}

function selectedStatusGroup(state: SettingsState): StatusGroupId | undefined {
  const id = tuiSettingItems(state.prefs)[state.selected]?.id
  if (id?.startsWith('statusGroup:') !== true) return undefined
  const group = id.slice('statusGroup:'.length) as StatusGroupId
  return STATUS_GROUP_IDS.includes(group) ? group : undefined
}

function startMoving(state: SettingsState, group: StatusGroupId): SettingsState {
  const config = resolveStatusBarConfig(state.prefs.statusBar, state.prefs.statusPreset)
  const prefs = config.groups.includes(group)
    ? state.prefs
    : { ...state.prefs, statusBar: updateStatusGroup(config, group, 'shown') }
  const selected = tuiSettingItems(prefs).findIndex(item => item.id === `statusGroup:${group}`)
  return { prefs, selected: Math.max(0, selected), moving: group }
}

function moveStatusGroup(state: SettingsState, direction: 1 | -1): SettingsState {
  const moving = state.moving
  if (moving === undefined) return state
  const config = resolveStatusBarConfig(state.prefs.statusBar, state.prefs.statusPreset)
  const from = config.groups.indexOf(moving)
  if (from < 0) return state
  const to = Math.max(0, Math.min(config.groups.length - 1, from + direction))
  if (to === from) return state
  const groups = [...config.groups]
  groups.splice(from, 1)
  groups.splice(to, 0, moving)
  const visible = new Set(groups)
  const hiddenBySlot = config.order.filter(group => !visible.has(group))
  const order: StatusGroupId[] = []
  let visibleIndex = 0
  for (const group of config.order) {
    if (visible.has(group)) order.push(groups[visibleIndex++] as StatusGroupId)
    else order.push(group)
  }
  // Defensive: normalization guarantees completeness, but keep all hidden IDs if a caller supplied a partial config.
  for (const group of hiddenBySlot) if (!order.includes(group)) order.push(group)
  const prefs = { ...state.prefs, statusBar: { ...config, groups, order } }
  const selected = tuiSettingItems(prefs).findIndex(item => item.id === `statusGroup:${moving}`)
  return { prefs, selected, moving }
}

function moveSelected(state: SettingsState, next: number): SettingsState {
  const n = tuiSettingItems(state.prefs).length
  if (n === 0) return state
  const selected = (next % n + n) % n
  if (selected === state.selected) return state
  return { ...state, selected }
}

const GENERAL_SETTING_COUNT = 3

function moveSection(state: SettingsState, direction: 1 | -1): SettingsState {
  const inGeneral = state.selected < GENERAL_SETTING_COUNT
  const selected = direction > 0
    ? (inGeneral ? GENERAL_SETTING_COUNT : 0)
    : (inGeneral ? tuiSettingItems(state.prefs).length - 1 : 0)
  return { ...state, selected }
}

function cycleSelected(state: SettingsState, direction: 1 | -1 = 1): SettingsState {
  const items = tuiSettingItems(state.prefs)
  const item = items[state.selected]
  if (item === undefined) return state
  const value = adjacentValue(item.value, item.values, direction)
  return { selected: state.selected, prefs: applySettingValue(state.prefs, item.id, value) }
}

/** Apply one decoded event to the overlay. */
export function applySettingsEvent(state: SettingsState, event: KeyEvent): SettingsCommand {
  if (state.moving !== undefined) {
    if (event.type !== 'key') return { kind: 'ignore' }
    if (event.id === 'up' || event.id === 'down') {
      return { kind: 'apply', state: moveStatusGroup(state, event.id === 'up' ? -1 : 1) }
    }
    if (event.id === 'enter' || event.id === 'escape' || event.id === 'ctrl+c') {
      const { moving: _, ...rest } = state
      return { kind: 'update', state: rest }
    }
    return { kind: 'ignore' }
  }
  if (event.type === 'text' && event.value === ' ') {
    return { kind: 'apply', state: cycleSelected(state) }
  }
  if (event.type !== 'key') return { kind: 'ignore' }
  switch (event.id) {
    case 'enter':
      {
        const group = selectedStatusGroup(state)
        if (group !== undefined) return { kind: 'apply', state: startMoving(state, group) }
      }
      return { kind: 'apply', state: cycleSelected(state) }
    case 'right':
      return { kind: 'apply', state: cycleSelected(state) }
    case 'left':
      return { kind: 'apply', state: cycleSelected(state, -1) }
    case 'escape':
    case 'ctrl+c':
      return { kind: 'close' }
    case 'up':
      return { kind: 'update', state: moveSelected(state, state.selected - 1) }
    case 'down':
      return { kind: 'update', state: moveSelected(state, state.selected + 1) }
    case 'tab':
      return { kind: 'update', state: moveSection(state, 1) }
    case 'shift+tab':
      return { kind: 'update', state: moveSection(state, -1) }
    case 'home':
      return { kind: 'update', state: moveSelected(state, 0) }
    case 'end':
      return { kind: 'update', state: moveSelected(state, tuiSettingItems(state.prefs).length - 1) }
    default:
      return { kind: 'ignore' }
  }
}

/** First overlay-local row that paints a setting item. */
export const SETTINGS_ITEM_ROW = 3

/** Item index under an overlay-local row, or undefined on chrome. */
export function hitTestSettings(
  itemCountOrRows: number | readonly (number | undefined)[],
  localRow: number,
): number | undefined {
  if (typeof itemCountOrRows !== 'number') return itemCountOrRows[localRow]
  const itemCount = itemCountOrRows
  const index = localRow - SETTINGS_ITEM_ROW
  if (index < 0 || index >= itemCount) return undefined
  return index
}

/** Move the highlight to `index` without cycling the value. */
export function selectSetting(state: SettingsState, index: number): SettingsState {
  const n = tuiSettingItems(state.prefs).length
  if (n === 0) return state
  const selected = Math.max(0, Math.min(index, n - 1))
  if (selected === state.selected) return state
  return { ...state, selected }
}

function fit(text: string, width: number): string {
  if (width <= 0) return ''
  return padToWidth(truncateToWidth(text, width), width)
}

function border(theme: Theme, text: string): string {
  return theme.fg('border', text)
}

function topBorder(theme: Theme, width: number): string {
  const inner = Math.max(0, width - 2)
  const title = truncateToWidth(' ⚙ Settings ', Math.max(0, inner - 2))
  const fill = Math.max(0, inner - 1 - visibleWidth(title))
  return border(theme, BOX.topLeft + BOX.horizontal)
    + theme.bold(theme.fg('accent', title))
    + border(theme, BOX.horizontal.repeat(fill) + BOX.topRight)
}

function divider(theme: Theme, width: number): string {
  return border(theme, BOX.teeRight + BOX.horizontal.repeat(Math.max(0, width - 2)) + BOX.teeLeft)
}

function bottomBorder(theme: Theme, width: number): string {
  return border(theme, BOX.bottomLeft + BOX.horizontal.repeat(Math.max(0, width - 2)) + BOX.bottomRight)
}

function framedRow(theme: Theme, content: string, width: number): string {
  const inner = Math.max(0, width - 4)
  return border(theme, BOX.vertical) + ' ' + fit(content, inner) + ' ' + border(theme, BOX.vertical)
}

function renderSectionTabs(active: 'general' | 'status', theme: Theme, width: number): string {
  const tab = (id: 'general' | 'status', label: string): string => id === active
    ? theme.bold(theme.fg('accent', `● ${label}`))
    : theme.fg('muted', `○ ${label}`)
  return framedRow(theme, ` ${tab('general', 'General')}    ${tab('status', 'Status line')}`, width)
}

const STATUS_PREVIEW_STATS = {
  turns: 3,
  steps: 24,
  llmMs: 1_011_000,
  toolMs: 213_000,
  ttftMs: 3_600,
  ttftSteps: 3,
  decodeMs: 922_500,
  decodeTokens: 73_800,
  inputTokens: 5_900_000,
  outputTokens: 73_800,
  cacheReadTokens: 5_841_000,
  cacheWriteTokens: 0,
  contextTokens: 16_400,
  contextWindow: 1_000_000,
}

function renderStatusPreview(state: SettingsState, theme: Theme, width: number): string {
  const config = resolveStatusBarConfig(state.prefs.statusBar, state.prefs.statusPreset)
  const available = Math.max(0, width - visibleWidth('Preview  '))
  const preview = renderSessionStatusLabel(STATUS_PREVIEW_STATS, config, theme, available).trim()
  const content = preview === '' ? theme.fg('muted', 'disabled') : preview
  return framedRow(theme, theme.fg('dim', 'Preview  ') + content, width)
}

/** Fullscreen OMP-style settings frame with stable chrome and section tabs. */
export function renderSettings(
  state: SettingsState,
  theme: Theme,
  width: number,
  height: number = 24,
): { lines: string[]; cursor: { row: number; column: number }; itemRows: (number | undefined)[] } {
  const items = tuiSettingItems(state.prefs)
  const index = Math.max(0, Math.min(state.selected, Math.max(0, items.length - 1)))
  const active = index < GENERAL_SETTING_COUNT ? 'general' : 'status'
  const sectionStart = active === 'general' ? 0 : GENERAL_SETTING_COUNT
  const sectionEnd = active === 'general' ? GENERAL_SETTING_COUNT : items.length
  const sectionItems = items.slice(sectionStart, sectionEnd)
  const descriptionRows = height >= 12 ? 2 : height >= 10 ? 1 : 0
  const previewRows = active === 'status' && height >= 9 ? 2 : 0
  const viewportHeight = Math.max(1, height - 6 - descriptionRows - previewRows)
  const localSelection = index - sectionStart
  const visibleCount = Math.min(viewportHeight, sectionItems.length)
  const start = Math.max(0, Math.min(
    localSelection - Math.floor(visibleCount / 2),
    sectionItems.length - visibleCount,
  ))
  const visibleItems = sectionItems.slice(start, start + visibleCount)
  const selected = items[index]
  const lines = [topBorder(theme, width), renderSectionTabs(active, theme, width), divider(theme, width)]
  if (previewRows > 0) lines.push(renderStatusPreview(state, theme, width), divider(theme, width))
  const itemRows: (number | undefined)[] = Array.from({ length: height })
  let cursorRow = SETTINGS_ITEM_ROW
  for (let row = 0; row < viewportHeight; row += 1) {
    const item = visibleItems[row]
    if (item === undefined) {
      lines.push(framedRow(theme, '', width))
      continue
    }
    const itemIndex = sectionStart + start + row
    const selectedRow = itemIndex === index
    if (selectedRow) cursorRow = lines.length
    itemRows[lines.length] = itemIndex
    const above = start > 0 && row === 0 ? theme.fg('dim', '↑ ') : ''
    const below = start + visibleCount < sectionItems.length && row === viewportHeight - 1 ? theme.fg('dim', '↓ ') : ''
    lines.push(framedRow(theme, renderSettingRow(
      item,
      selectedRow,
      theme,
      Math.max(1, width - 4),
      above || below,
      state.moving === item.id.slice('statusGroup:'.length),
    ), width))
  }
  lines.push(divider(theme, width))
  const description = selected?.description ?? ''
  const descriptionLines = wrapText(description, Math.max(1, width - 8)).slice(0, descriptionRows)
  for (let row = 0; row < descriptionRows; row += 1) {
    const text = descriptionLines[row] ?? ''
    lines.push(framedRow(theme, text === '' ? '' : '  ' + theme.fg('muted', text), width))
  }
  const hints = theme.fg('dim', state.moving === undefined
    ? '↑↓ navigate · ←→ change · enter move · space show/hide · tab section · esc close'
    : '↑↓ move item · enter place · esc done')
  lines.push(framedRow(theme, hints, width), bottomBorder(theme, width))
  return {
    lines,
    cursor: { row: cursorRow, column: 2 },
    itemRows,
  }
}

function renderSettingRow(
  item: SettingItem,
  selected: boolean,
  theme: Theme,
  width: number,
  edge = '',
  moving = false,
): string {
  const cursor = selected ? theme.fg('accent', (moving ? '↕' : SYMBOL.cursor) + ' ') : '  '
  const label = selected ? theme.bold(theme.fg('accent', item.label)) : item.label
  const rawValue = moving ? 'moving' : item.value
  const value = selected ? theme.fg('accent', rawValue) : theme.fg('muted', rawValue)
  const fill = Math.max(1, width - visibleWidth(cursor) - visibleWidth(label) - visibleWidth(value) - visibleWidth(edge))
  return truncateToWidth(cursor + label + ' '.repeat(fill) + value + edge, width)
}
