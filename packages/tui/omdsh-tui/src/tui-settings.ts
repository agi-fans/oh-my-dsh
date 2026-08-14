/**
 * Durable TUI prefs (`theme`, `colors`, `expandTools`) on the user-settings seam.
 * @module @omdsh/tui
 */

import z from '@deepseek-ai/schemastery'
import { THEME_NAMES, type ThemeName } from './theme.ts'
import { STATUS_PRESETS, type StatusPreset } from './settings-list.ts'

/** Settings namespace owned by the local TUI provider. */
export const TUI_SETTINGS_NAMESPACE = 'omdsh-tui'

/** Durable TUI section stored in the user settings document. */
export interface TuiSettings {
  theme: ThemeName
  colors: boolean
  expandTools: boolean
  statusPreset?: StatusPreset
}

/** Schema: palette, SGR switch, and default tool-output expansion. */
export const TuiSettingsSchema: z<TuiSettings> = z.object({
  theme: z.union([...THEME_NAMES]).default('dark'),
  colors: z.boolean().default(true),
  expandTools: z.boolean().default(false),
  statusPreset: z.union([...STATUS_PRESETS]).default('compact'),
})
