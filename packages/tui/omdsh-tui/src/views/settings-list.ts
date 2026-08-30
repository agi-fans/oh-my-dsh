/**
 * Settings overlay: cycleable terminal, Agent, and status-line preferences.
 * Pure — the provider owns live application of the selected values.
 * @module @agi-fans/dsh-tui
 */

import type { KeyEvent } from '../input/keys.ts'
import { STARTUP_CHANGELOG_MODES, type StartupChangelogMode } from '../session/release-notes.ts'
import {
  STATUS_COLOR_TOKENS,
  STATUS_GROUP_IDS,
  STATUS_LABEL_STYLES,
  STATUS_META_IDS,
  isStatusItemId,
  isStatusMetaId,
  itemSide,
  resolveStatusBarConfig,
  type StatusBarConfig,
  type StatusColorToken,
  type StatusGroupId,
  type StatusItemId,
  type StatusPreset,
  type StatusSide,
} from '../chrome/status-config.ts'
import { renderStatusFooter } from '../chrome/status-line.ts'
import { BOX, SYMBOL, THEME_NAMES, type Theme, type ThemeColor, type ThemeName, isThemeName } from '../chrome/theme.ts'
import { padToWidth, truncateToWidth, visibleWidth, wrapText } from '../chrome/width.ts'
import type { TuiAgentBehaviorSettings } from '../definition.ts'
import { MOTION_MODES, type MotionMode } from '../session/tui-settings.ts'

/** One cycleable row in the overlay. */
export interface SettingItem {
  id: string
  label: string
  description: string
  value: string
  values: readonly string[]
  /** Preview fragment this row controls, when it is a footer item. */
  sample?: string
  /** Theme token used to paint the color value. */
  swatch?: ThemeColor
  hidden?: boolean
}

/** Session-local TUI prefs the overlay can change. */
export interface TuiPrefs {
  theme: ThemeName
  colors: boolean
  motion?: MotionMode
  terminalProgress?: boolean
  expandTools: boolean
  checkUpdates?: boolean
  startupChangelog?: StartupChangelogMode
  notifications?: 'off' | 'long-running' | 'always'
  notificationThreshold?: '15s' | '30s' | '1m' | '2m'
  statusBar?: StatusBarConfig
  /** Read-only migration input for settings written before status-line customization. */
  statusPreset?: StatusPreset
}

/** Live overlay state. */
export interface SettingsState {
  selected: number
  prefs: TuiPrefs
  /** Product-owned Agent settings are absent when no host binding is mounted. */
  agent?: TuiAgentBehaviorSettings
  /** Footer item currently attached to the up/down reorder gesture. */
  moving?: StatusItemId
}

/** Outcome of one key against the overlay. */
export type SettingsCommand =
  | { kind: 'update'; state: SettingsState }
  | { kind: 'apply'; domain: 'tui' | 'agent'; state: SettingsState }
  | { kind: 'close' }
  | { kind: 'ignore' }

const COLOR_VALUES = ['on', 'off'] as const
const TOOL_DETAIL_VALUES = ['compact', 'expanded'] as const
const STARTUP_CHANGELOG_VALUES = [...STARTUP_CHANGELOG_MODES]
const AGENT_LANGUAGE_VALUES = ['Auto', 'Simplified Chinese', 'English'] as const
const AGENT_LANGUAGE_LABELS: Record<TuiAgentBehaviorSettings['language'], typeof AGENT_LANGUAGE_VALUES[number]> = {
  auto: 'Auto',
  'zh-CN': 'Simplified Chinese',
  en: 'English',
}
const AGENT_LANGUAGE_IDS = Object.fromEntries(
  Object.entries(AGENT_LANGUAGE_LABELS).map(([id, label]) => [label, id]),
) as Record<typeof AGENT_LANGUAGE_VALUES[number], TuiAgentBehaviorSettings['language']>
const STATUS_ITEM_COPY: Record<StatusItemId, { label: string; description: string; sample: string }> = {
  model: { label: 'Model', description: 'Model name on the left of the first footer line. Left/Right sets color; Space shows or hides; Enter then arrows move it.', sample: 'deepseek' },
  effort: { label: 'Effort', description: 'Reasoning effort on the first footer line. Left/Right sets color; Space shows or hides; Enter then arrows move it.', sample: 'max' },
  path: { label: 'Path', description: 'Workspace path on the right of the first footer line. Left/Right sets color; Space shows or hides; Enter then arrows move it.', sample: '~/project' },
  git: { label: 'Git', description: 'Git branch on the right of the first footer line. A dirty worktree stays warning while color is default. Left/Right sets color; Space shows or hides; Enter then arrows move it.', sample: 'main *1' },
  context: { label: 'Context', description: 'Context pressure as percentage and used/window tokens. Left/Right sets color; Space shows or hides; Enter then arrows move it.', sample: 'Ctx 1.6% · 16.4K/1M' },
  cache: { label: 'Cache', description: 'Prompt-cache hit rate. Cache-hit percentages stay on the success color. Left/Right sets color; Space shows or hides; Enter then arrows move it.', sample: 'Cache 99%' },
  tokens: { label: 'Tokens', description: 'Input and output token counts. Left/Right sets color; Space shows or hides; Enter then arrows move it.', sample: '5.9M in' },
  speed: { label: 'Latency', description: 'First-token latency and decode rate. Left/Right sets color; Space shows or hides; Enter then arrows move it.', sample: 'TTFT 1.2s' },
  durations: { label: 'Time', description: 'LLM and tool duration. Left/Right sets color; Space shows or hides; Enter then arrows move it.', sample: 'LLM 16m51s' },
  counts: { label: 'Activity', description: 'Turn and step counts. Left/Right sets color; Space shows or hides; Enter then arrows move it.', sample: '3 turns' },
}

function itemSwatch(id: StatusItemId, token: StatusColorToken): ThemeColor {
  if (token !== 'default') return token === 'label' ? 'customMessageLabel' : token
  if (id === 'effort') return 'customMessageLabel'
  if (id === 'git') return 'warning'
  if (id === 'path') return 'muted'
  return 'text'
}

function statusItemVisible(config: StatusBarConfig, id: StatusItemId): boolean {
  return isStatusMetaId(id) ? (config.meta ?? STATUS_META_IDS).includes(id) : config.groups.includes(id)
}

function statusItemRow(config: StatusBarConfig, id: StatusItemId): SettingItem {
  const visible = statusItemVisible(config, id)
  const color = config.colors?.[id] ?? 'default'
  const copy = STATUS_ITEM_COPY[id]
  return {
    id: `statusItem:${id}`,
    label: (itemSide(config, id) === 'right' ? '→ ' : '← ') + copy.label,
    description: copy.description,
    sample: visible ? copy.sample : 'hidden',
    value: color,
    values: STATUS_COLOR_TOKENS,
    swatch: itemSwatch(id, color),
    hidden: !visible,
  }
}

function generalSettingItems(prefs: TuiPrefs): SettingItem[] {
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
      id: 'motion',
      label: 'Motion',
      description: 'Full adds smooth streaming and a working shimmer; Reduced keeps smooth streaming without the shimmer; Off follows provider chunks with static activity marks',
      value: prefs.motion ?? 'full',
      values: MOTION_MODES,
    },
    {
      id: 'terminalProgress',
      label: 'Terminal activity',
    description: 'Busy/idle status in supported terminal tabs and taskbars',
      value: prefs.terminalProgress === true ? 'on' : 'off',
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
      id: 'checkUpdates',
      label: 'Update checks',
      description: 'Check npm once a day and notify when a newer release is available',
      value: prefs.checkUpdates === false ? 'off' : 'on',
      values: COLOR_VALUES,
    },
    {
      id: 'startupChangelog',
      label: 'Release notes',
      description: 'Show new release notes once after an upgrade',
      value: prefs.startupChangelog ?? 'summary',
      values: STARTUP_CHANGELOG_VALUES,
    },
    {
      id: 'notifications',
      label: 'Notifications',
      description: 'Notify when a turn finishes or input is required',
      value: prefs.notifications ?? 'off',
      values: ['off', 'long-running', 'always'],
    },
    {
      id: 'notificationThreshold',
      label: 'Long turn',
      description: 'Minimum duration for long-running notifications',
      value: prefs.notificationThreshold ?? '30s',
      values: ['15s', '30s', '1m', '2m'],
    },
  ]
}

function agentSettingItems(agent: TuiAgentBehaviorSettings | undefined): SettingItem[] {
  if (agent === undefined) return []
  return [{
    id: 'agentLanguage',
    label: 'Language',
    description: 'Preferred language for reasoning and replies',
    value: AGENT_LANGUAGE_LABELS[agent.language],
    values: AGENT_LANGUAGE_VALUES,
  }]
}

function statusSettingItems(prefs: TuiPrefs): SettingItem[] {
  const statusBar = resolveStatusBarConfig(prefs.statusBar, prefs.statusPreset)
  return [
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
    ...statusBar.metaOrder.filter(id => itemSide(statusBar, id) === 'left').map(id => statusItemRow(statusBar, id)),
    ...statusBar.metaOrder.filter(id => itemSide(statusBar, id) === 'right').map(id => statusItemRow(statusBar, id)),
    ...statusBar.order.filter(id => itemSide(statusBar, id) === 'left').map(id => statusItemRow(statusBar, id)),
    ...statusBar.order.filter(id => itemSide(statusBar, id) === 'right').map(id => statusItemRow(statusBar, id)),
  ]
}

/** Product-owned rows shown in `/settings` (OMP settings-list cycle widgets). */
export function tuiSettingItems(
  prefs: TuiPrefs,
  agent?: TuiAgentBehaviorSettings,
): SettingItem[] {
  return [
    ...generalSettingItems(prefs),
    ...agentSettingItems(agent),
    ...statusSettingItems(prefs),
  ]
}

function showInOrder<T extends string>(visible: T[], order: readonly T[], id: T): T[] {
  const next = visible.filter(item => item !== id)
  const position = order.indexOf(id)
  const insert = next.findIndex(item => order.indexOf(item) > position)
  next.splice(insert < 0 ? next.length : insert, 0, id)
  return next
}

function updateStatusGroup(config: StatusBarConfig, id: StatusGroupId, value: string): StatusBarConfig {
  const groups = config.groups.filter(group => group !== id)
  if (value === 'hidden' || value === 'off') return { ...config, groups }
  if (value === 'shown') return { ...config, groups: showInOrder(groups, config.order ?? STATUS_GROUP_IDS, id) }
  const position = Number.parseInt(value, 10)
  if (!Number.isInteger(position) || position < 1 || position > STATUS_GROUP_IDS.length) return config
  groups.splice(Math.min(position - 1, groups.length), 0, id)
  return { ...config, groups }
}

function toggleStatusItem(config: StatusBarConfig, id: StatusItemId): StatusBarConfig {
  if (isStatusMetaId(id)) {
    const meta = config.meta ?? [...STATUS_META_IDS]
    const hidden = !meta.includes(id)
    return {
      ...config,
      meta: hidden ? showInOrder(meta.filter(item => item !== id), config.metaOrder ?? STATUS_META_IDS, id) : meta.filter(item => item !== id),
    }
  }
  return updateStatusGroup(config, id, statusItemVisible(config, id) ? 'hidden' : 'shown')
}

function reorderVisible<T extends string>(visible: readonly T[], order: readonly T[], moving: T, direction: 1 | -1): { visible: T[]; order: T[] } {
  const from = visible.indexOf(moving)
  if (from < 0) return { visible: [...visible], order: [...order] }
  const to = Math.max(0, Math.min(visible.length - 1, from + direction))
  const nextVisible = [...visible]
  if (to !== from) {
    nextVisible.splice(from, 1)
    nextVisible.splice(to, 0, moving)
  }
  const visibleSet = new Set(nextVisible)
  const nextOrder: T[] = []
  let visibleIndex = 0
  for (const item of order) {
    if (visibleSet.has(item)) nextOrder.push(nextVisible[visibleIndex++] as T)
    else nextOrder.push(item)
  }
  for (const item of nextVisible) if (!nextOrder.includes(item)) nextOrder.push(item)
  return { visible: nextVisible, order: nextOrder }
}

/** Apply one cycled value back onto the prefs record. */
export function applySettingValue(prefs: TuiPrefs, id: string, value: string): TuiPrefs {
  if (id === 'theme' && isThemeName(value)) return { ...prefs, theme: value }
  if (id === 'colors') return { ...prefs, colors: value === 'on' }
  if (id === 'motion' && MOTION_MODES.includes(value as MotionMode)) return { ...prefs, motion: value as MotionMode }
  if (id === 'terminalProgress') return { ...prefs, terminalProgress: value === 'on' }
  if (id === 'expandTools') return { ...prefs, expandTools: value === 'expanded' || value === 'on' }
  if (id === 'checkUpdates') return { ...prefs, checkUpdates: value === 'on' }
  if (id === 'startupChangelog' && STARTUP_CHANGELOG_MODES.includes(value as StartupChangelogMode)) {
    return { ...prefs, startupChangelog: value as StartupChangelogMode }
  }
  if (id === 'notifications' && ['off', 'long-running', 'always'].includes(value)) {
    return { ...prefs, notifications: value as NonNullable<TuiPrefs['notifications']> }
  }
  if (id === 'notificationThreshold' && ['15s', '30s', '1m', '2m'].includes(value)) {
    return { ...prefs, notificationThreshold: value as NonNullable<TuiPrefs['notificationThreshold']> }
  }
  const statusBar = resolveStatusBarConfig(prefs.statusBar, prefs.statusPreset)
  if (id === 'statusEnabled') return { ...prefs, statusBar: { ...statusBar, enabled: value === 'on' } }
  if (id === 'statusLabels' && STATUS_LABEL_STYLES.includes(value as StatusBarConfig['labels'])) {
    return { ...prefs, statusBar: { ...statusBar, labels: value as StatusBarConfig['labels'] } }
  }
  if (id.startsWith('statusItem:')) {
    const item = id.slice('statusItem:'.length)
    if (isStatusItemId(item) && STATUS_COLOR_TOKENS.includes(value as StatusColorToken)) {
      return { ...prefs, statusBar: { ...statusBar, colors: { ...statusBar.colors, [item]: value as StatusColorToken } } }
    }
    if (isStatusItemId(item) && (value === 'shown' || value === 'hidden' || value === 'off')) {
      const wantVisible = value === 'shown'
      if (statusItemVisible(statusBar, item) === wantVisible) return prefs
      return { ...prefs, statusBar: toggleStatusItem(statusBar, item) }
    }
    if (STATUS_GROUP_IDS.includes(item as StatusGroupId)) {
      return { ...prefs, statusBar: updateStatusGroup(statusBar, item as StatusGroupId, value) }
    }
  }
  return prefs
}

function adjacentValue(current: string, values: readonly string[], direction: 1 | -1): string {
  const index = values.indexOf(current)
  return values[(index + direction + values.length) % values.length] ?? values[0] ?? current
}

/** Open the overlay on the current prefs, optionally focused on one row. */
export function createSettings(
  prefs: TuiPrefs,
  focusId?: string,
  agent?: TuiAgentBehaviorSettings,
): SettingsState {
  const items = tuiSettingItems(prefs, agent)
  const focused = focusId === undefined ? 0 : items.findIndex((item) => item.id === focusId)
  return { prefs, selected: focused >= 0 ? focused : 0, ...(agent === undefined ? {} : { agent }) }
}

function selectedStatusItem(state: SettingsState): StatusItemId | undefined {
  const id = tuiSettingItems(state.prefs, state.agent)[state.selected]?.id
  if (id?.startsWith('statusItem:') !== true) return undefined
  const item = id.slice('statusItem:'.length)
  return isStatusItemId(item) ? item : undefined
}

function startMoving(state: SettingsState, item: StatusItemId): SettingsState {
  const config = resolveStatusBarConfig(state.prefs.statusBar, state.prefs.statusPreset)
  const prefs = statusItemVisible(config, item)
    ? state.prefs
    : { ...state.prefs, statusBar: toggleStatusItem(config, item) }
  const selected = tuiSettingItems(prefs, state.agent).findIndex(row => row.id === `statusItem:${item}`)
  return { ...state, prefs, selected: Math.max(0, selected), moving: item }
}

function assignItemSide(config: StatusBarConfig, id: StatusItemId, side: StatusSide): StatusBarConfig {
  if (itemSide(config, id) === side) return config
  const next: StatusBarConfig = { ...config, sides: { ...config.sides, [id]: side } }
  if (isStatusMetaId(id)) {
    const order = (next.metaOrder ?? STATUS_META_IDS).filter(item => item !== id)
    let last = -1
    for (let index = 0; index < order.length; index += 1) {
      if (itemSide(next, order[index] as StatusItemId) === side) last = index
    }
    order.splice(last + 1, 0, id)
    return { ...next, metaOrder: order }
  }
  const order = (next.order ?? STATUS_GROUP_IDS).filter(item => item !== id)
  let last = -1
  for (let index = 0; index < order.length; index += 1) {
    if (itemSide(next, order[index] as StatusItemId) === side) last = index
  }
  order.splice(last + 1, 0, id)
  return { ...next, order }
}

function moveStatusItem(state: SettingsState, direction: 1 | -1): SettingsState {
  const moving = state.moving
  if (moving === undefined) return state
  const config = resolveStatusBarConfig(state.prefs.statusBar, state.prefs.statusPreset)
  const side = itemSide(config, moving)
  if (isStatusMetaId(moving)) {
    const reordered = reorderVisible(
      config.meta.filter(id => itemSide(config, id) === side),
      config.metaOrder,
      moving,
      direction,
    )
    const prefs = { ...state.prefs, statusBar: { ...config, meta: reordered.visible.concat(config.meta.filter(id => itemSide(config, id) !== side)), metaOrder: reordered.order } }
    const selected = tuiSettingItems(prefs, state.agent).findIndex(row => row.id === `statusItem:${moving}`)
    return { ...state, prefs, selected, moving }
  }
  const reordered = reorderVisible(
    config.groups.filter(id => itemSide(config, id) === side),
    config.order,
    moving,
    direction,
  )
  const prefs = { ...state.prefs, statusBar: { ...config, groups: reordered.visible.concat(config.groups.filter(id => itemSide(config, id) !== side)), order: reordered.order } }
  const selected = tuiSettingItems(prefs, state.agent).findIndex(row => row.id === `statusItem:${moving}`)
  return { ...state, prefs, selected, moving }
}

function moveStatusItemSide(state: SettingsState, side: StatusSide): SettingsState {
  const moving = state.moving
  if (moving === undefined) return state
  const config = resolveStatusBarConfig(state.prefs.statusBar, state.prefs.statusPreset)
  const prefs = { ...state.prefs, statusBar: assignItemSide(config, moving, side) }
  const selected = tuiSettingItems(prefs, state.agent).findIndex(row => row.id === `statusItem:${moving}`)
  return { ...state, prefs, selected, moving }
}

interface SettingsSection {
  id: 'general' | 'agent' | 'status'
  label: string
  start: number
  end: number
}

function settingSections(state: SettingsState): SettingsSection[] {
  const generalEnd = generalSettingItems(state.prefs).length
  const agentEnd = generalEnd + agentSettingItems(state.agent).length
  return [
    { id: 'general', label: 'General', start: 0, end: generalEnd },
    ...(agentEnd === generalEnd ? [] : [{ id: 'agent' as const, label: 'Agent', start: generalEnd, end: agentEnd }]),
    { id: 'status', label: 'Status line', start: agentEnd, end: tuiSettingItems(state.prefs, state.agent).length },
  ]
}

function selectedSection(state: SettingsState): SettingsSection {
  const sections = settingSections(state)
  return sections.find(section => state.selected >= section.start && state.selected < section.end)
    ?? sections[0] as SettingsSection
}

function moveSelected(state: SettingsState, next: number): SettingsState {
  const section = selectedSection(state)
  const selected = Math.max(section.start, Math.min(next, section.end - 1))
  if (selected === state.selected) return state
  return { ...state, selected }
}

function moveSection(state: SettingsState, direction: 1 | -1): SettingsState {
  const sections = settingSections(state)
  const active = selectedSection(state)
  const current = sections.findIndex(section => section.id === active.id)
  const next = (current + direction + sections.length) % sections.length
  return { ...state, selected: sections[next]?.start ?? 0 }
}

function cycleSelected(state: SettingsState, direction: 1 | -1 = 1): SettingsCommand {
  const items = tuiSettingItems(state.prefs, state.agent)
  const item = items[state.selected]
  if (item === undefined) return { kind: 'ignore' }
  const value = adjacentValue(item.value, item.values, direction)
  if (item.id === 'agentLanguage' && state.agent !== undefined) {
    const language = AGENT_LANGUAGE_IDS[value as typeof AGENT_LANGUAGE_VALUES[number]]
    if (language === undefined) return { kind: 'ignore' }
    return { kind: 'apply', domain: 'agent', state: { ...state, agent: { language } } }
  }
  return {
    kind: 'apply',
    domain: 'tui',
    state: { ...state, prefs: applySettingValue(state.prefs, item.id, value) },
  }
}

/** Apply one decoded event to the overlay. */
export function applySettingsEvent(state: SettingsState, event: KeyEvent): SettingsCommand {
  if (state.moving !== undefined) {
    if (event.type !== 'key') return { kind: 'ignore' }
    if (event.id === 'up' || event.id === 'down') {
      return { kind: 'apply', domain: 'tui', state: moveStatusItem(state, event.id === 'up' ? -1 : 1) }
    }
    if (event.id === 'left' || event.id === 'right') {
      return { kind: 'apply', domain: 'tui', state: moveStatusItemSide(state, event.id === 'left' ? 'left' : 'right') }
    }
    if (event.id === 'enter' || event.id === 'escape' || event.id === 'ctrl+c') {
      const { moving: _, ...rest } = state
      return { kind: 'update', state: rest }
    }
    return { kind: 'ignore' }
  }
  if (event.type === 'text' && event.value === ' ') {
    const item = selectedStatusItem(state)
    if (item === undefined) return cycleSelected(state)
    return {
      kind: 'apply',
      domain: 'tui',
      state: {
        ...state,
        prefs: {
          ...state.prefs,
          statusBar: toggleStatusItem(resolveStatusBarConfig(state.prefs.statusBar, state.prefs.statusPreset), item),
        },
      },
    }
  }
  if (event.type !== 'key') return { kind: 'ignore' }
  switch (event.id) {
    case 'enter':
      {
        const item = selectedStatusItem(state)
        if (item !== undefined) return { kind: 'apply', domain: 'tui', state: startMoving(state, item) }
      }
      return cycleSelected(state)
    case 'right':
      return cycleSelected(state)
    case 'left':
      return cycleSelected(state, -1)
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
      return { kind: 'update', state: moveSelected(state, selectedSection(state).end - 1) }
    default:
      return { kind: 'ignore' }
  }
}

/** First overlay-local row that paints a setting item. */
export const SETTINGS_ITEM_ROW = 3

function fit(text: string, width: number): string {
  if (width <= 0) return ''
  return padToWidth(truncateToWidth(text, width), width)
}

function border(theme: Theme, text: string): string {
  return theme.fg('border', text)
}

function topBorder(theme: Theme, width: number): string {
  const inner = Math.max(0, width - 2)
  const title = truncateToWidth(' Settings ', Math.max(0, inner - 2))
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

function renderSectionTabs(
  active: SettingsSection['id'],
  sections: readonly SettingsSection[],
  theme: Theme,
  width: number,
): string {
  const tab = (id: SettingsSection['id'], label: string): string => id === active
    ? theme.bold(theme.fg('accent', `● ${label}`))
    : theme.fg('muted', `○ ${label}`)
  return framedRow(theme, ' ' + sections.map(section => tab(section.id, section.label)).join('    '), width)
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

const STATUS_PREVIEW_META = {
  model: 'deepseek',
  reasoningEffort: 'max',
  pwd: '~/project',
  branch: 'main *1',
}

function renderStatusPreview(state: SettingsState, theme: Theme, width: number, rows: number): string[] {
  const config = resolveStatusBarConfig(state.prefs.statusBar, state.prefs.statusPreset)
  const inner = Math.max(0, width - 4)
  const prefix = 'Preview  '
  const label = theme.fg('dim', prefix)
  if (!config.enabled) {
    return [framedRow(theme, label + theme.fg('muted', 'disabled'), width)]
  }
  const focus = selectedStatusItem(state)
  const preview = renderStatusFooter({
    ...STATUS_PREVIEW_META,
    stats: STATUS_PREVIEW_STATS,
    config,
    width: inner,
    ...(focus === undefined ? {} : { focus }),
  }, theme)
  if (preview.length === 0) return [framedRow(theme, label + theme.fg('muted', 'disabled'), width)]
  return preview.slice(0, Math.max(1, rows)).map(line => framedRow(theme, line, width))
}

/** Fullscreen OMP-style settings frame with stable chrome and section tabs. */
export function renderSettings(
  state: SettingsState,
  theme: Theme,
  width: number,
  height: number = 24,
): { lines: string[]; cursor: { row: number; column: number } } {
  const items = tuiSettingItems(state.prefs, state.agent)
  const index = Math.max(0, Math.min(state.selected, Math.max(0, items.length - 1)))
  const viewState = index === state.selected ? state : { ...state, selected: index }
  const sections = settingSections(viewState)
  const section = selectedSection(viewState)
  const active = section.id
  const sectionStart = section.start
  const sectionEnd = section.end
  const sectionItems = items.slice(sectionStart, sectionEnd)
  const descriptionRows = height >= 12 ? 2 : height >= 10 ? 1 : 0
  const maxPreviewContent = active === 'status'
    ? (height >= 13 ? 3 : height >= 11 ? 2 : height >= 9 ? 1 : 0)
    : 0
  const previewLines = maxPreviewContent > 0
    ? renderStatusPreview(state, theme, width, maxPreviewContent)
    : []
  const previewRows = previewLines.length === 0 ? 0 : previewLines.length + 1
  const viewportHeight = Math.max(1, height - 6 - descriptionRows - previewRows)
  const localSelection = index - sectionStart
  const visibleCount = Math.min(viewportHeight, sectionItems.length)
  const start = Math.max(0, Math.min(
    localSelection - Math.floor(visibleCount / 2),
    sectionItems.length - visibleCount,
  ))
  const visibleItems = sectionItems.slice(start, start + visibleCount)
  const selected = items[index]
  const lines = [topBorder(theme, width), renderSectionTabs(active, sections, theme, width), divider(theme, width)]
  if (previewLines.length > 0) {
    lines.push(...previewLines, divider(theme, width))
  }
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
    const above = start > 0 && row === 0 ? theme.fg('dim', '↑ ') : ''
    const below = start + visibleCount < sectionItems.length && row === viewportHeight - 1 ? theme.fg('dim', '↓ ') : ''
    lines.push(framedRow(theme, renderSettingRow(
      item,
      selectedRow,
      theme,
      Math.max(1, width - 4),
      above || below,
      state.moving !== undefined && item.id === `statusItem:${state.moving}`,
    ), width))
  }
  lines.push(divider(theme, width))
  const description = selected?.description ?? ''
  const descriptionLines = wrapText(description, Math.max(1, width - 8)).slice(0, descriptionRows)
  for (let row = 0; row < descriptionRows; row += 1) {
    const text = descriptionLines[row] ?? ''
    lines.push(framedRow(theme, text === '' ? '' : '  ' + theme.fg('muted', text), width))
  }
  const hints = theme.fg('dim', state.moving !== undefined
    ? '↑↓ order · ←→ column · enter place · esc done'
    : active === 'status'
      ? '↑↓ navigate · ←→ change · space show/hide · enter move · tab section · esc close'
      : '↑↓ navigate · ←→ change · enter change · tab section · esc close')
  lines.push(framedRow(theme, hints, width), bottomBorder(theme, width))
  return {
    lines,
    cursor: { row: cursorRow, column: 2 },
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
  const label = selected
    ? theme.bold(theme.fg('accent', item.label))
    : item.hidden === true ? theme.fg('dim', item.label) : item.label
  const sample = item.sample === undefined
    ? ''
    : '  ' + theme.fg(item.hidden === true ? 'dim' : 'muted', item.sample)
  const rawValue = moving ? 'moving' : item.value
  const value = selected || item.swatch === undefined
    ? theme.fg(selected ? 'accent' : 'muted', rawValue)
    : theme.fg(item.swatch, rawValue)
  const fill = Math.max(1, width - visibleWidth(cursor) - visibleWidth(label) - visibleWidth(sample) - visibleWidth(value) - visibleWidth(edge))
  return truncateToWidth(cursor + label + sample + ' '.repeat(fill) + value + edge, width)
}
