/** Preference field ownership and minimal Profile patches. */
import { isDeepStrictEqual } from 'node:util'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { TuiPrefs } from '../views/settings-list.ts'

export function preferenceChanges(previous: TuiPrefs, next: TuiPrefs): SettingsPathOp[] {
  const edits: SettingsPathOp[] = []
  const walk = (before: unknown, after: unknown, path: string[]): void => {
    if (isDeepStrictEqual(before, after)) return
    if (after !== null && typeof after === 'object' && !Array.isArray(after)) {
      const old = before !== null && typeof before === 'object' ? before as Record<string, unknown> : {}
      for (const [key, value] of Object.entries(after)) walk(old[key], value, [...path, key])
    } else if (after !== undefined) edits.push({ op: 'set', path, value: after })
  }
  for (const [key, value] of Object.entries(next)) walk((previous as unknown as Record<string, unknown>)[key], value, [key])
  return edits
}

/** Configuration paths for controls that restore complete fields. */
export function preferencePaths(id: string): string[][] | undefined {
  if (id === 'statusReset') return [['statusBar'], ['statusPreset']]
  const status: Record<string, string> = { statusEnabled: 'enabled', statusDensity: 'density', statusLabels: 'labels', statusContextStyle: 'contextStyle' }
  if (Object.hasOwn(status, id)) return [['statusBar', status[id]!]]
  if (['uiLanguage', 'theme', 'colors', 'motion', 'mathMode', 'mermaidMode', 'hideThinking', 'showFileChanges', 'editor', 'terminalTitle', 'terminalState', 'busyEnter', 'pasteProtection', 'copyOnSelect', 'mouseInteraction', 'checkUpdates', 'startupChangelog', 'notifications', 'notificationFocus', 'notificationThreshold'].includes(id)) return [[id]]
  return undefined
}
