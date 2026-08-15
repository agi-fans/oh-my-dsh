/**
 * Durable TUI appearance and status-line preferences on the user-settings seam.
 * @module @oh-my-dsh/dsh-tui
 */

import z from '@deepseek-ai/schemastery'
import {
  STATUS_GROUP_IDS,
  STATUS_LABEL_STYLES,
  STATUS_PRESETS,
  type StatusBarConfig,
  type StatusPreset,
} from './status-config.ts'
import { THEME_NAMES, type ThemeName } from './theme.ts'

/** Settings namespace owned by the local TUI provider. */
export const TUI_SETTINGS_NAMESPACE = 'omdsh-tui'

/** Durable TUI section stored in the user settings document. */
export interface TuiSettings {
  theme: ThemeName
  colors: boolean
  expandTools: boolean
  statusBar?: StatusBarConfig
  /** Legacy input retained so older settings documents can be migrated. */
  statusPreset?: StatusPreset
}

/** Schema: palette, SGR, tool expansion, and status-line detail. */
export const TuiSettingsSchema: z<TuiSettings> = z.object({
  theme: z.union([...THEME_NAMES]).default('dark'),
  colors: z.boolean().default(true),
  expandTools: z.boolean().default(false),
  statusBar: z.union([z.object({
    enabled: z.boolean().default(true),
    labels: z.union([...STATUS_LABEL_STYLES]).default('compact'),
    groups: z.array(z.union([...STATUS_GROUP_IDS])).default([...STATUS_GROUP_IDS]),
    order: z.array(z.union([...STATUS_GROUP_IDS])),
  })]),
  statusPreset: z.union([...STATUS_PRESETS]),
})
