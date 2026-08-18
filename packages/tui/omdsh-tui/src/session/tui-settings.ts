/**
 * Durable TUI appearance and status-line preferences on the user-settings seam.
 * @module @agi-fans/dsh-tui
 */

import z from '@deepseek-ai/schemastery'
import { STARTUP_CHANGELOG_MODES, type StartupChangelogMode } from './release-notes.ts'
import {
  STATUS_COLOR_TOKENS,
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

/** Settings namespace owned by the local TUI provider. */
export const TUI_SETTINGS_NAMESPACE = 'omdsh-tui'

/** Durable TUI section stored in the user settings document. */
export interface TuiSettings {
  theme: ThemeName
  colors: boolean
  expandTools: boolean
  checkUpdates: boolean
  startupChangelog: StartupChangelogMode
  statusBar?: StatusBarConfig
  /** Legacy input retained so older settings documents can be migrated. */
  statusPreset?: StatusPreset
}

/** Schema: palette, SGR, tool expansion, and status-line detail. */
export const TuiSettingsSchema: z<TuiSettings> = z.object({
  theme: z.union([...THEME_NAMES]).default('dark'),
  colors: z.boolean().default(true),
  expandTools: z.boolean().default(false),
  checkUpdates: z.boolean().default(true),
  startupChangelog: z.union([...STARTUP_CHANGELOG_MODES]).default('summary'),
  statusBar: z.union([z.object({
    enabled: z.boolean().default(true),
    labels: z.union([...STATUS_LABEL_STYLES]).default('compact'),
    groups: z.array(z.union([...STATUS_GROUP_IDS])).default([...STATUS_GROUP_IDS]),
    order: z.array(z.union([...STATUS_GROUP_IDS])),
    meta: z.array(z.union([...STATUS_META_IDS])),
    metaOrder: z.array(z.union([...STATUS_META_IDS])),
    colors: z.object({
      model: z.union([...STATUS_COLOR_TOKENS]),
      effort: z.union([...STATUS_COLOR_TOKENS]),
      path: z.union([...STATUS_COLOR_TOKENS]),
      git: z.union([...STATUS_COLOR_TOKENS]),
      metrics: z.union([...STATUS_COLOR_TOKENS]),
      context: z.union([...STATUS_COLOR_TOKENS]),
      cache: z.union([...STATUS_COLOR_TOKENS]),
      tokens: z.union([...STATUS_COLOR_TOKENS]),
      speed: z.union([...STATUS_COLOR_TOKENS]),
      durations: z.union([...STATUS_COLOR_TOKENS]),
      counts: z.union([...STATUS_COLOR_TOKENS]),
    }),
    sides: z.object(Object.fromEntries(STATUS_ITEM_IDS.map(id => [id, z.union([...STATUS_SIDES])]))),
  })]),
  statusPreset: z.union([...STATUS_PRESETS]),
})
