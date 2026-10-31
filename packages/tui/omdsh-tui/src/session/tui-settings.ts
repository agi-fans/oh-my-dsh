/**
 * Durable TUI appearance and status-line preferences as volatile plugin config.
 * @module @agi-fans/dsh-tui
 */

import { EDITOR_IDS, type EditorId } from '../input/editor-discovery.ts'
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { STARTUP_CHANGELOG_MODES, type StartupChangelogMode } from './release-notes.ts'
import { FOLD_DENSITIES, DEFAULT_FOLD_DENSITY, type FoldDensity } from './fold-policy.ts'
import {
  STATUS_DENSITIES,
  STATUS_ITEM_IDS,
  STATUS_PRESETS,
  type StatusBarConfig,
  type StatusPreset,
} from '../chrome/status-config.ts'
import { THEME_NAMES, type ThemeName } from '../chrome/theme.ts'
import { MATH_MODES, type MathMode } from '../chrome/math.ts'
import { MERMAID_MODES, type MermaidMode } from '../chrome/mermaid.ts'

import { TERMINAL_TITLE_MODES, TERMINAL_STATE_MODES, type TerminalTitleMode, type TerminalStateMode } from '../runtime/terminal-state.ts'

/** Available terminal animation policies. */
export const MOTION_MODES = ['full', 'reduced', 'off'] as const
export type MotionMode = typeof MOTION_MODES[number]

/**
 * Notification detail level. Both non-`off` modes report finished turns and
 * pending input; they differ only in whether the terminal's own focus report
 * suppresses a notification while the reader is still watching.
 */
export const NOTIFICATION_MODES = ['off', 'unfocused', 'always'] as const
export type NotificationMode = typeof NOTIFICATION_MODES[number]
/** Values a document may still carry; `long-running` predates the two-mode split. */
export const STORED_NOTIFICATION_MODES = ['off', 'long-running', 'unfocused', 'always'] as const
export type StoredNotificationMode = typeof STORED_NOTIFICATION_MODES[number]

/**
 * A turn shorter than this never notifies. The duration is fixed rather than
 * configurable: it only decides whether an arriving notification is noise, and
 * a settings row was asking the reader to predict a boundary the product
 * already knew.
 */
export const NOTIFICATION_THRESHOLD_MS = 30_000

/** Threshold values a pre-merge document could carry. */
export const LEGACY_NOTIFICATION_THRESHOLDS = ['15s', '30s', '1m', '2m'] as const
export type LegacyNotificationThreshold = typeof LEGACY_NOTIFICATION_THRESHOLDS[number]

/** Milliseconds a legacy threshold value named. */
export function legacyThresholdMs(value: LegacyNotificationThreshold): number {
  return { '15s': 15_000, '30s': 30_000, '1m': 60_000, '2m': 120_000 }[value]
}

/**
 * Fold a stored notification document onto one mode. A document still carrying
 * the retired long-running policy becomes `unfocused`: that is the mode that
 * notifies after the reader has left, which is what the policy meant.
 */
export function resolveNotificationMode(
  notifications: string | undefined,
  focus: 'always' | 'unfocused' | undefined,
): NotificationMode {
  if (notifications === 'always') return 'always'
  if (notifications === 'unfocused') return 'unfocused'
  if (notifications === 'long-running') return focus === 'always' ? 'always' : 'unfocused'
  return 'off'
}

/**
 * Profile entry id owning these preferences. A form edit is addressed to the
 * entry, so this is the id of the `@agi-fans/dsh-tui` row in the composition,
 * never a section of a separate settings document.
 */
export const TUI_SETTINGS_ENTRY = 'tui'

/** Durable TUI preferences as live references on the owning entry's config. */
export interface TuiSettings {
  theme: Volatile<ThemeName>
  colors: Volatile<boolean | undefined>
  motion: Volatile<MotionMode>
  mathMode: Volatile<MathMode>
  mermaidMode: Volatile<MermaidMode>
  hideThinking: Volatile<boolean>
  editor: Volatile<EditorId>
  terminalTitle: Volatile<TerminalTitleMode>
  terminalState: Volatile<TerminalStateMode>
  pasteProtection: Volatile<boolean>
  copyOnSelect: Volatile<boolean>
  mouseInteraction: Volatile<'auto' | 'tui' | 'native'>
  /** Legacy configuration, accepted without changing the turn presentation. */
  foldDensity: Volatile<FoldDensity>
  /** Legacy configuration; no longer changes transcript presentation. */
  expandTools: Volatile<boolean>
  checkUpdates: Volatile<boolean>
  startupChangelog: Volatile<StartupChangelogMode>
  notifications: Volatile<StoredNotificationMode>
  /** Legacy inputs; read only to resolve a document written before the merge. */
  notificationFocus: Volatile<'always' | 'unfocused' | undefined>
  notificationThreshold: Volatile<LegacyNotificationThreshold | undefined>
  statusBar: Volatile<StatusBarConfig>
  /** Legacy input retained so older documents can be migrated. */
  statusPreset: Volatile<StatusPreset | undefined>
}

/**
 * The whole status-line document is now a density and a set of narrowings, so it
 * is a plain object rather than a nested union: there is no longer a present or
 * absent sub-object to distinguish from a present one with default fields.
 */
/**
 * The status line is a density plus its narrowings.
 *
 * `strip` removes every field the retired layout engine wrote. A profile that
 * still carries one is read once by the resolver — which reduces it to a density
 * — and the next write persists only these two fields, so the engine does not
 * live on in the reader's document.
 */
const STATUS_BAR_SCHEMA: z<any, any, any> = z.object({
  density: z.union([...STATUS_DENSITIES]).default('standard'),
  hidden: z.array(z.union([...STATUS_ITEM_IDS])).default([]),
  // Parts added beyond the density. Declared so the document survives validation:
  // `z.object` drops keys it does not know, which would make the reader's choice
  // look like it applied and then vanish on the next load.
  shown: z.array(z.union([...STATUS_ITEM_IDS])).default([]),
  // Read once by the resolver, never written. A profile that still carries the
  // old layout keeps working and is reduced to a density on the next edit; the
  // fields stay declared because a schema that rejected them would fail the
  // whole settings document rather than migrate it, the same reason
  // `foldDensity`, `expandTools` and `statusPreset` are still declared below.
  enabled: z.any(),
  labels: z.any(),
  contextStyle: z.any(),
  groups: z.any(),
  order: z.any(),
  meta: z.any(),
  metaOrder: z.any(),
  colors: z.any(),
  sides: z.any(),
})

/**
 * Schema: palette, SGR, and status-line detail, plus legacy transcript inputs. Every field is
 * volatile, so a settings edit commits into these references and the provider
 * re-reads them instead of remounting. `colors` stays undefined until the
 * provider resolves it against the output stream, and the two migration inputs
 * stay undefined unless a value was written.
 */
export const TUI_SETTINGS_FIELDS = {
  theme: z.union([...THEME_NAMES]).default('dark').volatile(),
  colors: z.boolean().volatile(),
  motion: z.union([...MOTION_MODES]).default('full').volatile(),
  mathMode: z.union([...MATH_MODES]).default('auto').volatile(),
  mermaidMode: z.union([...MERMAID_MODES]).default('auto').volatile(),
  hideThinking: z.boolean().default(false).volatile(),
  editor: z.union([...EDITOR_IDS]).default('auto').volatile(),
  terminalTitle: z.union([...TERMINAL_TITLE_MODES]).default('status').volatile(),
  terminalState: z.union([...TERMINAL_STATE_MODES]).default('auto').volatile(),
  pasteProtection: z.boolean().default(true).volatile(),
  copyOnSelect: z.boolean().default(true).volatile(),
  mouseInteraction: z.union(['auto', 'tui', 'native'] as const).default('auto').volatile(),
  foldDensity: z.union([...FOLD_DENSITIES]).default(DEFAULT_FOLD_DENSITY).volatile(),
  expandTools: z.boolean().default(false).volatile(),
  checkUpdates: z.boolean().default(true).volatile(),
  startupChangelog: z.union([...STARTUP_CHANGELOG_MODES]).default('summary').volatile(),
  notifications: z.union([...STORED_NOTIFICATION_MODES]).default('off').volatile(),
  notificationFocus: z.union(['always', 'unfocused'] as const).volatile(),
  notificationThreshold: z.union([...LEGACY_NOTIFICATION_THRESHOLDS]).volatile(),
  statusBar: STATUS_BAR_SCHEMA.volatile(),
  statusPreset: z.union([...STATUS_PRESETS]).volatile(),
} as const
