/**
 * Settings overlay: cycleable terminal, Agent, and status-line preferences.
 * Pure — the provider owns live application of the selected values.
 * @module @agi-fans/dsh-tui
 */

import { TERMINAL_TITLE_MODES, TERMINAL_STATE_MODES, type TerminalTitleMode, type TerminalStateMode } from '../runtime/terminal-state.ts'
import type { EditorChoice, EditorId } from '../input/editor-discovery.ts'
import type { KeyEvent } from '../input/keys.ts'
import { STARTUP_CHANGELOG_MODES, type StartupChangelogMode } from '../session/release-notes.ts'
import {
  STATUS_DENSITIES,
  STATUS_ITEM_IDS,
  isStatusItemId,
  resolveStatusBarConfig,
  statusBarDocument,
  statusItemVisible,
  toggleStatusItem,
  type ResolvedStatusBarConfig,
  type StatusBarConfig,
  type StatusBarInput,
  type StatusDensity,
  type StatusItemId,
  type StatusPreset,
} from '../chrome/status-config.ts'
import { renderStatusFooter } from '../chrome/status-line.ts'
import { BOX, THEME_NAMES, type Theme, type ThemeColor, type ThemeName, isThemeName } from '../chrome/theme.ts'
import { padToWidth, truncateToWidth, visibleWidth, wrapTextStable } from '../chrome/width.ts'
import type { TuiAgentBehaviorSettings } from '../definition.ts'
import {
  MOTION_MODES,
  NOTIFICATION_MODES,
  resolveNotificationMode,
  type LegacyNotificationThreshold,
  type MotionMode,
  type NotificationMode,
  type StoredNotificationMode,
} from '../session/tui-settings.ts'
import { MATH_MODES, type MathMode } from '../chrome/math.ts'
import { MERMAID_MODES, type MermaidMode } from '../chrome/mermaid.ts'
import type { FoldDensity } from '../session/fold-policy.ts'
import type { HotkeyRow } from './hotkey-format.ts'
import { listNavigation } from './list-navigation.ts'
import { LIST_CURSOR_CELLS, renderListRowWithValue, type ListRow } from './list-view.ts'
import { FEATURE_TOGGLES, type FeatureStates } from '../session/feature-toggles.ts'
import { rankSearchResults } from '../input/fuzzy-search.ts'
import { moveGraphemeLeft } from '../chrome/grapheme.ts'

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
  group?: string
  keywords?: readonly string[]
  action?: string
  resettable?: boolean
}

/** Active plugin configuration available through the Settings overlay. */
export interface PluginSettingsEntry {
  id: string
  label: string
  description: string
  section?: 'agent' | 'tools' | 'integrations' | 'advanced'
  namespace?: string
  fields?: readonly string[]
  summary?: string
  keywords?: readonly string[]
  /** Schema-derived choices and the revision actually displayed to the user. */
  inline?: {
    path: readonly string[]
    revision: number
    value: string
    choices: readonly { label: string; value: string }[]
  }
}

/** Session-local TUI prefs the overlay can change. */
export interface TuiPrefs {
  theme: ThemeName
  colors: boolean
  motion?: MotionMode
  mathMode?: MathMode
  mermaidMode?: MermaidMode
  /** Transcript starts with thinking collapsed to one line. */
  hideThinking?: boolean
  editor?: EditorId
  terminalTitle?: TerminalTitleMode
  terminalState?: TerminalStateMode
  pasteProtection?: boolean
  copyOnSelect?: boolean
  mouseInteraction?: 'auto' | 'tui' | 'native'
  /** Legacy input; ignored by the turn presentation. */
  foldDensity?: FoldDensity
  /** Legacy input; ignored by the turn presentation. */
  expandTools?: boolean
  checkUpdates?: boolean
  startupChangelog?: StartupChangelogMode
  notifications?: StoredNotificationMode
  /** Legacy input; {@link resolveNotificationMode} folds it onto `notifications`. */
  notificationFocus?: 'always' | 'unfocused' | undefined
  /** Legacy input from when the minimum turn duration was adjustable. */
  notificationThreshold?: LegacyNotificationThreshold
  statusBar?: StatusBarInput
  /** Read-only migration input for settings written before status-line customization. */
  statusPreset?: StatusPreset
}

/** Live overlay state. */
export interface SettingsState {
  selected: number
  prefs: TuiPrefs
  /** Product-owned Agent settings are absent when no host binding is mounted. */
  agent?: TuiAgentBehaviorSettings
  /** Optional-feature state; absent when no feature registry was supplied. */
  features?: FeatureStates
  plugins?: readonly PluginSettingsEntry[]
  editors?: readonly EditorChoice[]
  /** Footer item currently attached to the up/down reorder gesture. */
  search?: string
  searchOrigin?: string
  actions?: readonly SettingItem[]
}

/** Outcome of one key against the overlay. */
export type SettingsCommand =
  | { kind: 'update'; state: SettingsState }
  | { kind: 'apply'; domain: 'tui' | 'agent' | 'features'; state: SettingsState }
  | { kind: 'close' }
  | { kind: 'open-plugin'; id: string }
  | { kind: 'set-plugin'; entry: PluginSettingsEntry; value: string }
  | { kind: 'reset'; id: string; label: string; entry?: PluginSettingsEntry }
  | { kind: 'open-command'; name: string }
  | { kind: 'ignore' }

const COLOR_VALUES = ['on', 'off'] as const
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
const STATUS_ITEM_CONTROLS = 'Space shows or hides it.'
const STATUS_ITEM_COPY: Record<StatusItemId, { label: string; description: string; sample: string }> = {
  model: { label: 'Model', description: `Model name on the first footer line. ${STATUS_ITEM_CONTROLS}`, sample: 'deepseek' },
  effort: { label: 'Effort', description: `Reasoning effort on the first footer line. ${STATUS_ITEM_CONTROLS}`, sample: 'max' },
  path: { label: 'Path', description: `Workspace path on the right of the first footer line. ${STATUS_ITEM_CONTROLS}`, sample: '~/project' },
  git: { label: 'Git', description: `Git branch on the first footer line. A dirty worktree stays warning. ${STATUS_ITEM_CONTROLS}`, sample: 'main *1' },
  session: { label: 'Session', description: `Folded session title on the first footer line. Off at Standard and Minimal; the terminal window title shows it regardless. ${STATUS_ITEM_CONTROLS}`, sample: 'Fix the parser' },
  context: { label: 'Context', description: `Context occupancy, on the left of the second line. Its representation follows the density. ${STATUS_ITEM_CONTROLS}`, sample: 'Ctx 1.6%' },
  cache: { label: 'Cache', description: `Prompt-cache hit rate, beside occupancy on the left. Cache-hit percentages stay on the success color. ${STATUS_ITEM_CONTROLS}`, sample: 'Cache 99%' },
  tokens: { label: 'Tokens', description: `Input and output token counts, on the right with the other cost figures. ${STATUS_ITEM_CONTROLS}`, sample: '5.9M in' },
  speed: { label: 'Latency', description: `First-token latency and decode rate, on the right. ${STATUS_ITEM_CONTROLS}`, sample: 'TTFT 1.2s' },
  durations: { label: 'Time', description: `LLM and tool duration, on the right. ${STATUS_ITEM_CONTROLS}`, sample: 'LLM 16m51s' },
  counts: { label: 'Activity', description: `Turn and step counts, on the right. ${STATUS_ITEM_CONTROLS}`, sample: '3 turns' },
}


function statusItemRow(config: ResolvedStatusBarConfig, id: StatusItemId): SettingItem {
  const visible = statusItemVisible(config, id)
  const copy = STATUS_ITEM_COPY[id]
  return {
    id: `statusItem:${id}`,
    label: copy.label,
    description: copy.description,
    sample: visible ? copy.sample : 'hidden',
    value: visible ? 'shown' : 'hidden',
    values: ['shown', 'hidden'],
    hidden: !visible,
  }
}

function generalSettingItems(prefs: TuiPrefs, editors: readonly EditorChoice[] = [{ id: 'auto', label: 'Auto' }]): SettingItem[] {
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
      id: 'mathMode',
      label: 'Math in replies',
      description: 'Auto formats supported formulas as terminal text; Source keeps the original LaTeX. Copy and export retain the source.',
      value: prefs.mathMode ?? 'auto',
      values: MATH_MODES,
    },
    {
      id: 'mermaidMode',
      label: 'Mermaid in replies',
      description: 'Auto draws complete diagrams that fit; Source shows Mermaid code. Unsupported or incomplete diagrams retain their source.',
      value: prefs.mermaidMode ?? 'auto',
      values: MERMAID_MODES,
    },
    {
      id: 'hideThinking',
      label: 'Thinking in turns',
      description: 'Shown keeps reasoning visible while a turn runs; Hidden collapses it to one line. Ctrl+T flips this for the session.',
      value: prefs.hideThinking === true ? 'hidden' : 'shown',
      values: ['shown', 'hidden'],
    },
    {
      id: 'editor',
      label: 'Editor',
      description: 'Open files and edit prompts with this app. Save and close the file to return.',
      value: editors.find(editor => editor.id === (prefs.editor ?? 'auto'))?.label ?? prefs.editor ?? 'Auto',
      values: editors.map(editor => editor.label),
    },
    {
      id: 'mouseInteraction',
      label: 'Mouse interaction',
      description: 'Auto supports scrolling and text selection, respecting tmux mouse off. Native leaves the mouse to the terminal; TUI overrides the tmux preference.',
      value: prefs.mouseInteraction ?? 'auto',
      values: ['auto', 'tui', 'native'],
    },
    {
      id: 'pasteProtection',
      label: 'Paste protection',
      description: 'Treat rapid text and Enter keys as a paste when the terminal does not mark pasted input.',
      value: prefs.pasteProtection === false ? 'off' : 'on',
      values: COLOR_VALUES,
    },
    {
      id: 'copyOnSelect',
      label: 'Copy on select',
      description: 'Copy selected text when the mouse is released. With this off, use Alt+C, Enter, or right-click to copy.',
      value: prefs.copyOnSelect === false ? 'off' : 'on',
      values: COLOR_VALUES,
    },
    {
      id: 'terminalTitle', label: 'Terminal title', description: 'Status and session, session only, status and workspace, or Off. Changes the terminal tab title.', value: prefs.terminalTitle ?? 'status', values: TERMINAL_TITLE_MODES,
    },
    {
      id: 'terminalState', label: 'Terminal status', description: 'Auto reports the root Agent lifecycle once the terminal answers an OSC 7501 capability query; On reports regardless; Off clears reports.', value: prefs.terminalState ?? 'auto', values: TERMINAL_STATE_MODES,
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
      description: 'Notify when a long turn finishes or input is required. Away also waits until the terminal loses focus; Always reports regardless of focus.',
      value: resolveNotificationMode(prefs.notifications, prefs.notificationFocus),
      values: NOTIFICATION_MODES,
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
      label: 'Telemetry',
      description: 'Show session metrics below the first footer line',
      value: statusBar.enabled ? 'on' : 'off',
      values: COLOR_VALUES,
    },
    {
      id: 'statusDensity',
      label: 'Density',
      description: 'Minimal shows occupancy and cache; Standard adds latency; Verbose adds tokens on the same line and gives durations and activity a third, with long labels and the detailed context form',
      value: statusBar.density,
      values: STATUS_DENSITIES,
    },

    // Each part has one fixed place, so the rows below are a list of what
    // appears rather than a layout to assemble: Space shows or hides, and
    // nothing has to be dragged into a column.
    ...STATUS_ITEM_IDS.map(id => statusItemRow(statusBar, id)),
  ]
}

/**
 * Optional-feature rows. A feature's value cycles on/off like any other row,
 * but the write lands in the Profile patch rather than this row's volatile
 * config, so it is applied through the `features` apply domain instead.
 */
function featureSettingItems(features: FeatureStates): SettingItem[] {
  return FEATURE_TOGGLES.map(feature => ({
    id: `feature:${feature.id}`,
    label: feature.label,
    description: `${feature.description} Saved in profile; applies live when supported.`,
    value: features[feature.id] === false ? 'off' : 'on',
    values: COLOR_VALUES,
  }))
}

/** Product-owned rows shown in `/settings` (OMP settings-list cycle widgets). */
export function tuiSettingItems(
  prefs: TuiPrefs,
  agent?: TuiAgentBehaviorSettings,
  features?: FeatureStates,
  plugins?: readonly PluginSettingsEntry[],
  editors?: readonly EditorChoice[],
  actions?: readonly SettingItem[],
): SettingItem[] {
  return settingGroups({ prefs, ...(agent === undefined ? {} : { agent }), ...(features === undefined ? {} : { features }),
    ...(plugins === undefined ? {} : { plugins }), ...(editors === undefined ? {} : { editors }),
    ...(actions === undefined ? {} : { actions }) }).flatMap(group => group.items)
}




/** Apply one cycled value back onto the prefs record. */
export function applySettingValue(prefs: TuiPrefs, id: string, value: string): TuiPrefs {
  if (id === 'theme' && isThemeName(value)) return { ...prefs, theme: value }
  if (id === 'colors') return { ...prefs, colors: value === 'on' }
  if (id === 'motion' && MOTION_MODES.includes(value as MotionMode)) return { ...prefs, motion: value as MotionMode }
  if (id === 'mathMode' && MATH_MODES.includes(value as MathMode)) return { ...prefs, mathMode: value as MathMode }
  if (id === 'mermaidMode' && MERMAID_MODES.includes(value as MermaidMode)) return { ...prefs, mermaidMode: value as MermaidMode }
  if (id === 'hideThinking') return { ...prefs, hideThinking: value === 'hidden' }
  if (id === 'pasteProtection') return { ...prefs, pasteProtection: value === 'on' }
  if (id === 'copyOnSelect') return { ...prefs, copyOnSelect: value === 'on' }
  if (id === 'mouseInteraction' && ['auto', 'tui', 'native'].includes(value)) {
    return { ...prefs, mouseInteraction: value as NonNullable<TuiPrefs['mouseInteraction']> }
  }
  if (id === 'terminalTitle' && TERMINAL_TITLE_MODES.includes(value as TerminalTitleMode)) return { ...prefs, terminalTitle: value as TerminalTitleMode }
  if (id === 'terminalState' && TERMINAL_STATE_MODES.includes(value as TerminalStateMode)) return { ...prefs, terminalState: value as TerminalStateMode }
  if (id === 'checkUpdates') return { ...prefs, checkUpdates: value === 'on' }
  if (id === 'startupChangelog' && STARTUP_CHANGELOG_MODES.includes(value as StartupChangelogMode)) {
    return { ...prefs, startupChangelog: value as StartupChangelogMode }
  }
  if (id === 'notifications' && NOTIFICATION_MODES.includes(value as NotificationMode)) {
    return { ...prefs, notifications: value as NotificationMode }
  }
  /**
   * The status line is one document: a density, plus the parts hidden on top of
   * it. Row identity decides which field moves — there is no per-item colour or
   * column left to write, and `enabled` survives only as "telemetry off".
   */
  const statusBar = storedStatusBar(prefs)
  if (id === 'statusDensity' && STATUS_DENSITIES.includes(value as StatusDensity)) {
    return { ...prefs, statusBar: { ...statusBar, density: value as StatusDensity } }
  }
  if (id === 'statusEnabled') return { ...prefs, statusBar: { ...statusBar, enabled: value === 'on' } }
  if (id.startsWith('statusItem:')) {
    const item = id.slice('statusItem:'.length)
    if (!isStatusItemId(item)) return prefs
    if (value !== 'shown' && value !== 'hidden' && value !== 'off') return prefs
    const resolved = resolveStatusBarConfig(statusBar)
    if (statusItemVisible(resolved, item) === (value === 'shown')) return prefs
    return { ...prefs, statusBar: toggleStatusItem(statusBar, item) }
  }
  return prefs
}

/**
 * The document as it stands, ready for one edit.
 *
 * The narrowing is read from the *stored* document, not reconstructed from what
 * the footer is showing. Reconstructing it turned every part the density happens
 * to omit into an explicit hiding: pressing Space on one row then silently made
 * a different density show less, which is the drift this replaced.
 */
function storedStatusBar(prefs: TuiPrefs): StatusBarConfig {
  return statusBarDocument(resolveStatusBarConfig(prefs.statusBar, prefs.statusPreset))
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
  features?: FeatureStates,
  plugins?: readonly PluginSettingsEntry[],
  editors?: readonly EditorChoice[],
  actions?: readonly SettingItem[],
): SettingsState {
  const items = tuiSettingItems(prefs, agent, features, plugins, editors, actions)
  const focused = focusId === undefined ? 0 : items.findIndex((item) => item.id === focusId)
  return {
    prefs,
    selected: focused >= 0 ? focused : 0,
    ...(agent === undefined ? {} : { agent }),
    ...(features === undefined ? {} : { features }),
    ...(plugins === undefined ? {} : { plugins }),
    ...(editors === undefined ? {} : { editors }),
    ...(actions === undefined ? {} : { actions }),
  }
}

function selectedStatusItem(state: SettingsState): StatusItemId | undefined {
  const id = tuiSettingItems(state.prefs, state.agent, state.features, state.plugins, state.editors, state.actions)[state.selected]?.id
  if (id?.startsWith('statusItem:') !== true) return undefined
  const item = id.slice('statusItem:'.length)
  return isStatusItemId(item) ? item : undefined
}





interface SettingsSection {
  id: 'general' | 'agent' | 'tools' | 'status' | 'integrations' | 'advanced'
  label: string
  start: number
  end: number
}

function settingGroups(state: Omit<SettingsState, 'selected'>): { id: SettingsSection['id']; label: string; items: SettingItem[] }[] {
  const owned = (section: PluginSettingsEntry['section']): SettingItem[] => (state.plugins ?? [])
    .filter(entry => (entry.section ?? 'advanced') === section)
    .map(entry => ({ ...entry, id: `plugin:${entry.id}`, value: entry.inline?.value ?? entry.summary ?? 'Configure',
      values: entry.inline?.choices.map(choice => choice.label) ?? [], resettable: (entry.fields?.length ?? 0) > 0 }))
  return [
    { id: 'general' as const, label: 'Interface', items: [...generalSettingItems(state.prefs, state.editors).map(item => ({ ...item,
      resettable: true, group: ['theme', 'colors', 'motion', 'mathMode', 'mermaidMode', 'hideThinking', 'terminalTitle', 'terminalState'].includes(item.id) ? 'Appearance'
        : ['editor', 'mouseInteraction', 'pasteProtection', 'copyOnSelect'].includes(item.id) ? 'Input'
          : ['checkUpdates', 'startupChangelog'].includes(item.id) ? 'Startup' : 'Notifications',
      description: item.description,
    })), ...(state.actions ?? []).filter(item => item.group === 'Input')].sort((a, b) => ['Appearance', 'Input', 'Notifications', 'Startup'].indexOf(a.group ?? '') - ['Appearance', 'Input', 'Notifications', 'Startup'].indexOf(b.group ?? '')) },
    { id: 'agent' as const, label: 'Agent', items: [...(state.actions ?? []).filter(item => item.group !== 'Input'), ...agentSettingItems(state.agent).map(item => ({ ...item, resettable: true, description: `${item.description}. Saved in this profile; applies from the next turn.` })), ...owned('agent')] },
    { id: 'tools' as const, label: 'Tools', items: [...(state.features === undefined ? [] : featureSettingItems(state.features)), ...owned('tools')] },
    { id: 'status' as const, label: 'Status line', items: [...statusSettingItems(state.prefs).map(item => ({ ...item, resettable: true })),
      { id: 'statusReset', label: 'Restore layout', value: 'Restore', values: [], resettable: true, description: 'Restore the inherited status-line layout, colors and visibility. Confirmation shows what will be restored.' }] },
    { id: 'integrations' as const, label: 'Integrations', items: owned('integrations') },
    { id: 'advanced' as const, label: 'Advanced', items: owned('advanced') },
  ].filter(group => group.items.length > 0)
}

function settingSections(state: SettingsState): SettingsSection[] {
  let start = 0
  return settingGroups(state).map(group => {
    const section = { id: group.id, label: group.label, start, end: start + group.items.length }
    start = section.end
    return section
  })
}

function selectedSection(state: SettingsState): SettingsSection {
  const sections = settingSections(state)
  return sections.find(section => state.selected >= section.start && state.selected < section.end)
    ?? sections[0] as SettingsSection
}

interface SettingsMatch { item: SettingItem; index: number; section: string }

function settingsMatches(state: SettingsState): readonly SettingsMatch[] {
  let index = 0
  const rows = settingGroups(state).flatMap(group => group.items.map(item => ({ item, index: index++, section: group.label })))
  return rankSearchResults(rows, state.search ?? '', row => [row.item.label, row.item.description, row.section, row.item.group ?? '', ...row.item.keywords ?? []])
}

function searchSettings(state: SettingsState, query: string): SettingsState {
  const next = { ...state, search: query }
  const rows = settingsMatches(next)
  return { ...next, selected: rows.find(row => row.index === state.selected)?.index ?? rows[0]?.index ?? state.selected }
}

/** Preserve selection and a cross-category search when live configuration refreshes. */
export function refreshSettings(state: SettingsState, next: SettingsState): SettingsState {
  const id = tuiSettingItems(state.prefs, state.agent, state.features, state.plugins, state.editors, state.actions)[state.selected]?.id
  const selected = tuiSettingItems(next.prefs, next.agent, next.features, next.plugins, next.editors, next.actions).findIndex(item => item.id === id)
  const updated = { ...next, selected: selected < 0 ? next.selected : selected,
    ...(state.searchOrigin === undefined ? {} : { searchOrigin: state.searchOrigin }) }
  return state.search === undefined ? updated : searchSettings(updated, state.search)
}

function moveSelected(state: SettingsState, next: number): SettingsState {
  if (state.search !== undefined) {
    const rows = settingsMatches(state), current = rows.findIndex(row => row.index === state.selected)
    const index = rows[Math.max(0, Math.min(rows.length - 1, current + next - state.selected))]?.index
    return index === undefined ? state : { ...state, selected: index }
  }
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
  const { search: _, searchOrigin: __, ...browse } = state
  return { ...browse, selected: sections[next]?.start ?? 0 }
}

function cycleSelected(state: SettingsState, direction: 1 | -1 = 1): SettingsCommand {
  const items = tuiSettingItems(state.prefs, state.agent, state.features, state.plugins, state.editors, state.actions)
  const item = items[state.selected]
  if (item === undefined) return { kind: 'ignore' }
  if (item.action !== undefined) return { kind: 'ignore' }
  if (item.id.startsWith('plugin:')) {
    const entry = state.plugins?.find(entry => `plugin:${entry.id}` === item.id)
    const choices = entry?.inline?.choices
    if (entry === undefined || choices === undefined || choices.length === 0) return { kind: 'ignore' }
    const current = choices.findIndex(choice => choice.label === item.value)
    const next = current < 0 ? direction === 1 ? 0 : choices.length - 1 : (current + direction + choices.length) % choices.length
    return { kind: 'set-plugin', entry, value: choices[next]!.value }
  }
  const value = adjacentValue(item.value, item.values, direction)
  if (item.id === 'editor') {
    const editor = state.editors?.find(choice => choice.label === value)?.id ?? 'auto'
    return { kind: 'apply', domain: 'tui', state: { ...state, prefs: { ...state.prefs, editor } } }
  }
  if (item.id.startsWith('feature:') && state.features !== undefined) {
    const id = item.id.slice('feature:'.length)
    return {
      kind: 'apply',
      domain: 'features',
      state: { ...state, features: { ...state.features, [id]: value === 'on' } },
    }
  }
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
  {
    if (event.type === 'text' && (state.search !== undefined || event.value !== ' ')) {
      const origin = tuiSettingItems(state.prefs, state.agent, state.features, state.plugins, state.editors, state.actions)[state.selected]?.id
      const searching = state.search === undefined ? { ...state, search: '', ...(origin === undefined ? {} : { searchOrigin: origin }) } : state
      return { kind: 'update', state: searchSettings(searching, (searching.search ?? '') + (event.value === '/' && state.search === undefined ? '' : event.value.replace(/[\r\n]/gu, ' '))) }
    }
    if (state.search !== undefined && event.type === 'key') {
      if (event.id === 'escape' || event.id === 'ctrl+c') {
        if (state.search !== '') return { kind: 'update', state: searchSettings(state, '') }
        const { search: _, searchOrigin, ...browse } = state
        const index = tuiSettingItems(state.prefs, state.agent, state.features, state.plugins, state.editors, state.actions).findIndex(item => item.id === searchOrigin)
        return { kind: 'update', state: { ...browse, selected: index < 0 ? state.selected : index } }
      }
      if (event.id === 'backspace' || event.id === 'ctrl+u') return { kind: 'update', state: searchSettings(state,
        event.id === 'ctrl+u' ? '' : state.search.slice(0, moveGraphemeLeft(state.search, state.search.length))) }
      if (event.id === 'home' || event.id === 'end') {
        const rows = settingsMatches(state)
        return { kind: 'update', state: { ...state, selected: (event.id === 'home' ? rows[0] : rows.at(-1))?.index ?? state.selected } }
      }
      if (settingsMatches(state).length === 0 && ['enter', 'left', 'right', 'ctrl+r'].includes(event.id)) return { kind: 'ignore' }
    }
    const selected = tuiSettingItems(state.prefs, state.agent, state.features, state.plugins, state.editors, state.actions)[state.selected]
    if (event.type === 'key' && event.id === 'ctrl+r' && selected?.resettable) {
      const entry = state.plugins?.find(entry => `plugin:${entry.id}` === selected.id)
      return { kind: 'reset', id: selected.id, label: selected.label, ...(entry === undefined ? {} : { entry }) }
    }
    if (event.type === 'key' && event.id === 'enter' && selected?.id === 'statusReset') return { kind: 'reset', id: selected.id, label: selected.label }
    if (selected?.action !== undefined && event.type === 'key' && event.id === 'enter') return { kind: 'open-command', name: selected.action }
  }
  if ((event.type === 'key' && event.id === 'enter') || (event.type === 'text' && event.value === ' ')) {
    const selected = tuiSettingItems(state.prefs, state.agent, state.features, state.plugins, state.editors, state.actions)[state.selected]
    if (selected?.id.startsWith('plugin:') && (event.type === 'key' || selected.values.length === 0)) return { kind: 'open-plugin', id: selected.id.slice('plugin:'.length) }
  }
  if (event.type === 'text' && event.value === ' ') {
    const item = selectedStatusItem(state)
    if (item === undefined) return cycleSelected(state)
    return {
      kind: 'apply',
      domain: 'tui',
      state: {
        ...state,
        prefs: { ...state.prefs, statusBar: toggleStatusItem(storedStatusBar(state.prefs), item) },
      },
    }
  }
  if (event.type !== 'key') return { kind: 'ignore' }
  switch (event.id) {
    case 'enter':
      return cycleSelected(state)
    case 'right':
      return cycleSelected(state)
    case 'left':
      return cycleSelected(state, -1)
    // This overlay keeps three keys that a plain list would spend on movement:
    // `tab` switches section, and `home`/`end` jump to the edge of the current
    // section rather than of the whole list, which is the only reading that makes
    // sense when the rows above belong to another category.
    case 'tab':
      return { kind: 'update', state: moveSection(state, 1) }
    case 'shift+tab':
      return { kind: 'update', state: moveSection(state, -1) }
    case 'home':
      return { kind: 'update', state: moveSelected(state, selectedSection(state).start) }
    case 'end':
      return { kind: 'update', state: moveSelected(state, selectedSection(state).end - 1) }
    default: {
      const navigation = listNavigation(event)
      if (navigation.kind === 'close') return { kind: 'close' }
      if (navigation.kind === 'move') return { kind: 'update', state: moveSelected(state, state.selected + navigation.delta) }
      return { kind: 'ignore' }
    }
  }
}

/** First overlay-local row that paints a setting item. */
export const SETTINGS_ITEM_ROW = 3

// Every key `applySettingsEvent` accepts. Rows whose first word is the footer
// label are also printed by the overlay's bottom hint.
const HOTKEY_NAVIGATE: HotkeyRow = { keys: '↑↓', action: 'Navigate rows' }
const HOTKEY_CHANGE: HotkeyRow = { keys: '←→', action: 'Change the selected value' }
const HOTKEY_TOGGLE: HotkeyRow = { keys: 'Space', action: 'Toggle — show or hide a status item, or cycle other rows' }
const HOTKEY_MOVE: HotkeyRow = { keys: 'Enter', action: 'Change — open configuration, or cycle other rows' }
const HOTKEY_SECTION: HotkeyRow = { keys: 'Tab / Shift+Tab', action: 'Switch section' }
const HOTKEY_EDGE: HotkeyRow = { keys: 'Home / End', action: 'Jump to the section edges' }
const HOTKEY_CLOSE: HotkeyRow = { keys: 'Esc', action: 'Clear search, return to browsing, or close the overlay' }
const HOTKEY_CANCEL: HotkeyRow = { keys: 'Ctrl+C', action: 'Close the overlay' }

/** Keys the settings overlay accepts; `/help` and its bottom hint read this list. */
export const SETTINGS_HOTKEYS: readonly HotkeyRow[] = [
  HOTKEY_NAVIGATE,
  HOTKEY_CHANGE,
  HOTKEY_TOGGLE,
  HOTKEY_MOVE,
  HOTKEY_SECTION,
  HOTKEY_EDGE,
  { keys: '/ or Text', action: 'Search across all categories' },
  { keys: 'Backspace / Ctrl+U', action: 'Edit or clear the settings search' },
  { keys: 'Ctrl+R', action: 'Restore inheritance for the selected setting' },
  HOTKEY_CLOSE,
  HOTKEY_CANCEL,
]

/** Bottom hint for the overlay; the grabbed-row state swaps in its own gestures. */
function settingsHints(): string {
  return '↑↓ select · ←→ change · Tab sections · / search · Ctrl+R reset · Esc back'
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
  const title = truncateToWidth(' Settings · Profile ', Math.max(0, inner - 2))
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
  const all = ' ' + sections.map(section => tab(section.id, section.label)).join('    ')
  const current = sections.findIndex(section => section.id === active)
  return framedRow(theme, visibleWidth(all) <= width - 4 ? all
    : ` ‹ ${tab(active, sections[current]?.label ?? active)} · ${current + 1}/${sections.length} ›` , width)
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
  const items = tuiSettingItems(state.prefs, state.agent, state.features, state.plugins, state.editors, state.actions)
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
  const matches = state.search === undefined ? undefined : settingsMatches(state)
  type Row = { item: SettingItem; index: number; section?: string } | { group: string }
  let previousGroup: string | undefined
  const rows: readonly Row[] = matches ?? sectionItems.flatMap<Row>((item, offset) => {
    const heading = item.group !== undefined && item.group !== previousGroup ? [{ group: item.group }] : []
    previousGroup = item.group
    return [...heading, { item, index: sectionStart + offset }]
  })
  const viewportHeight = Math.max(1, height - 6 - descriptionRows - previewRows - (matches === undefined ? 0 : 1))
  const localSelection = rows.findIndex(row => 'item' in row && row.index === index)
  const visibleCount = Math.min(viewportHeight, rows.length)
  const start = Math.max(0, Math.min(
    localSelection - Math.floor(visibleCount / 2),
    rows.length - visibleCount,
  ))
  const visibleItems = rows.slice(start, start + visibleCount)
  const selected = matches?.length === 0 ? undefined : items[index]
  const lines = [topBorder(theme, width), renderSectionTabs(active, sections, theme, width)]
  if (matches !== undefined) lines.push(framedRow(theme, `Search: ${state.search || 'type to filter'} · ${matches.length} matches`, width))
  lines.push(divider(theme, width))
  if (previewLines.length > 0) {
    lines.push(...previewLines, divider(theme, width))
  }
  let cursorRow = SETTINGS_ITEM_ROW
  for (let row = 0; row < viewportHeight; row += 1) {
    const entry = visibleItems[row]
    if (entry === undefined) {
      lines.push(framedRow(theme, row === 0 && matches?.length === 0 ? theme.fg('muted', 'No matching settings') : '', width))
      continue
    }
    if ('group' in entry) { lines.push(framedRow(theme, theme.fg('dim', ` ${entry.group}`), width)); continue }
    const item = entry.item
    const selectedRow = entry.index === index
    if (selectedRow) cursorRow = lines.length
    const above = start > 0 && row === 0 ? theme.fg('dim', '↑ ') : ''
    const below = start + visibleCount < rows.length && row === viewportHeight - 1 ? theme.fg('dim', '↓ ') : ''
    lines.push(framedRow(theme, renderSettingRow(
      entry.section === undefined ? item : { ...item, label: `${item.label} · ${entry.section}` },
      selectedRow,
      theme,
      Math.max(1, width - 4),
      above || below,
      false,
    ), width))
  }
  lines.push(divider(theme, width))
  const description = selected === undefined ? '' : selected.description
  const descriptionLines = wrapTextStable(description, Math.max(1, width - 8)).slice(0, descriptionRows)
  for (let row = 0; row < descriptionRows; row += 1) {
    const text = descriptionLines[row] ?? ''
    lines.push(framedRow(theme, text === '' ? '' : '  ' + theme.fg('muted', text), width))
  }
  const fullHint = matches !== undefined ? 'Type filter · ↑↓ select · ←→ change · Enter edit · Tab sections · Esc clear/back'
    : selected?.action !== undefined ? 'Enter open · Tab sections · / search · Esc back'
      : selected?.id.startsWith('plugin:') === true ? `Enter configure${selected.values.length > 0 ? ' · ←→ change' : ''} · Tab sections · / search${selected.resettable ? ' · Ctrl+R reset' : ''} · Esc back`
        : selected?.id.startsWith('statusItem:') === true
          ? 'Space show/hide · / search · Esc back'
          : selected?.resettable === false ? '←→ change · Tab sections · / search · Esc back' : settingsHints()
  const hints = theme.fg('dim', width < 60
    ? matches !== undefined ? 'Type filter · ↑↓ · Esc clear/back' : 'Tab sections · / search · Esc back'
    : fullHint)
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
  // A colour value keeps its swatch tone only when the row is not selected;
  // selection has to win, or the reader cannot tell which row the cursor is on.
  const rawValue = moving ? 'moving' : item.value
  const value = selected || item.swatch === undefined ? rawValue : theme.fg(item.swatch, rawValue)
  const row: ListRow = {
    label: item.label,
    ...(item.sample === undefined ? {} : { description: item.sample }),
    secondary: item.hidden === true,
    value,
  }
  const rendered = renderListRowWithValue(row, theme, width, visibleWidth(item.label), {
    selected,
    ...(moving ? { moving } : {}),
  })
  // An edge mark replaces the cursor cell, which the shared row already
  // reserved, so the row cannot shift when the reader reaches either end.
  if (edge === '') return rendered
  const mark = theme.fg('dim', edge.trimStart() + ' ')
  return truncateToWidth(mark + rendered.slice(LIST_CURSOR_CELLS), width)
}
