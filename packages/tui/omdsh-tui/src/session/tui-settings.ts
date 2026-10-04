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
  STATUS_COLOR_TOKENS,
  STATUS_CONTEXT_STYLES,
  STATUS_GROUP_IDS,
  STATUS_ITEM_IDS,
  STATUS_META_IDS,
  STATUS_SIDES,
  STATUS_LABEL_STYLES,
  STATUS_PRESETS,
  type StatusBarConfig,
  type StatusPreset,
} from '../chrome/status-config.ts'
import { THEME_NAMES, type ThemeName } from '../chrome/theme.ts'

/** Available terminal animation policies. */
export const MOTION_MODES = ['full', 'reduced', 'off'] as const
export type MotionMode = typeof MOTION_MODES[number]

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
  editor: Volatile<EditorId>
  terminalProgress: Volatile<boolean>
  /** Legacy configuration, accepted without changing the turn presentation. */
  foldDensity: Volatile<FoldDensity>
  /** Legacy configuration; no longer changes transcript presentation. */
  expandTools: Volatile<boolean>
  checkUpdates: Volatile<boolean>
  startupChangelog: Volatile<StartupChangelogMode>
  notifications: Volatile<'off' | 'long-running' | 'always'>
  notificationThreshold: Volatile<'15s' | '30s' | '1m' | '2m'>
  statusBar: Volatile<StatusBarConfig | undefined>
  /** Legacy input retained so older documents can be migrated. */
  statusPreset: Volatile<StatusPreset | undefined>
}

/**
 * Present-or-absent live object. The single-member union is what keeps an
 * omitted `statusBar` undefined instead of materializing every default, so
 * `resolveStatusBarConfig` still falls back to the legacy preset or the
 * shipped default; the explicit annotation keeps the emitted declaration
 * portable.
 */
const STATUS_BAR_SCHEMA: z<any, any, any> = z.union([z.object({
  enabled: z.boolean().default(true),
  labels: z.union([...STATUS_LABEL_STYLES]).default('compact'),
  contextStyle: z.union([...STATUS_CONTEXT_STYLES]).default('percent'),
  groups: z.array(z.union([...STATUS_GROUP_IDS])).default([...STATUS_GROUP_IDS]),
  order: z.array(z.union([...STATUS_GROUP_IDS])),
  meta: z.array(z.union([...STATUS_META_IDS])),
  metaOrder: z.array(z.union([...STATUS_META_IDS])),
  colors: z.object({
    model: z.union([...STATUS_COLOR_TOKENS]),
    effort: z.union([...STATUS_COLOR_TOKENS]),
    path: z.union([...STATUS_COLOR_TOKENS]),
    git: z.union([...STATUS_COLOR_TOKENS]),
    session: z.union([...STATUS_COLOR_TOKENS]),
    metrics: z.union([...STATUS_COLOR_TOKENS]),
    context: z.union([...STATUS_COLOR_TOKENS]),
    cache: z.union([...STATUS_COLOR_TOKENS]),
    tokens: z.union([...STATUS_COLOR_TOKENS]),
    speed: z.union([...STATUS_COLOR_TOKENS]),
    durations: z.union([...STATUS_COLOR_TOKENS]),
    counts: z.union([...STATUS_COLOR_TOKENS]),
  }),
  sides: z.object(Object.fromEntries(STATUS_ITEM_IDS.map(id => [id, z.union([...STATUS_SIDES])]))),
})])

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
  editor: z.union([...EDITOR_IDS]).default('auto').volatile(),
  terminalProgress: z.boolean().default(false).volatile(),
  foldDensity: z.union([...FOLD_DENSITIES]).default(DEFAULT_FOLD_DENSITY).volatile(),
  expandTools: z.boolean().default(false).volatile(),
  checkUpdates: z.boolean().default(true).volatile(),
  startupChangelog: z.union([...STARTUP_CHANGELOG_MODES]).default('summary').volatile(),
  notifications: z.union(['off', 'long-running', 'always'] as const).default('off').volatile(),
  notificationThreshold: z.union(['15s', '30s', '1m', '2m'] as const).default('30s').volatile(),
  statusBar: STATUS_BAR_SCHEMA.volatile(),
  statusPreset: z.union([...STATUS_PRESETS]).volatile(),
} as const
