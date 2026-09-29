import { describe, expect, it } from 'vitest'
import z from '@deepseek-ai/schemastery'
import { resolveStatusBarConfig, type StatusBarConfig } from '../chrome/status-config.ts'
import { TUI_SETTINGS_FIELDS } from './tui-settings.ts'

const RowSettings = z.object(TUI_SETTINGS_FIELDS)

/** Resolve one raw row config and read what each volatile reference committed. */
function resolve(input: object): Record<string, unknown> {
  const parsed = RowSettings(input) as Record<string, { get(): unknown }>
  return Object.fromEntries(Object.entries(parsed).map(([field, ref]) => [field, ref.get()]))
}

describe('TUI row settings', () => {
  it('defaults the palette and every non-derived preference', () => {
    expect(resolve({})).toEqual({
      theme: 'dark',
      // Resolved against the output stream, which a schema cannot know.
      colors: undefined,
      motion: 'full',
      terminalProgress: false,
      foldDensity: 'standard',
      // Legacy migration input; the schema still reads it so an older document
      // resolves, but nothing writes it any more.
      expandTools: false,
      checkUpdates: true,
      startupChangelog: 'summary',
      notifications: 'off',
      notificationThreshold: '30s',
      statusBar: undefined,
      statusPreset: undefined,
    })
  })

  it('accepts explicit palette, motion, and transcript density overrides', () => {
    expect(resolve({ theme: 'light', colors: false, motion: 'off', foldDensity: 'verbose' })).toMatchObject({
      theme: 'light',
      colors: false,
      motion: 'off',
      terminalProgress: false,
      foldDensity: 'verbose',
    })
  })

  it('validates the status-line detail and drops retired display fields', () => {
    expect(resolve({ statusBar: { enabled: false, labels: 'full', groups: ['tokens', 'cache'] } })).toMatchObject({
      statusBar: { enabled: false, labels: 'full', groups: ['tokens', 'cache'] },
    })
    const retired = resolve({
      statusBar: { enabled: true, labels: 'compact', groups: ['context'], contextDisplay: 'gauge' },
    }).statusBar
    expect(resolveStatusBarConfig(retired as StatusBarConfig)).not.toHaveProperty('contextDisplay')
    expect(resolve({
      statusBar: {
        enabled: true,
        labels: 'compact',
        groups: ['cache'],
        order: ['tokens', 'cache', 'context'],
        colors: { model: 'accent', metrics: 'warning' },
      },
    })).toMatchObject({
      statusBar: {
        order: ['tokens', 'cache', 'context'],
        colors: { model: 'accent', metrics: 'warning' },
      },
    })
  })

  it('validates startup update and release-note preferences', () => {
    expect(resolve({ checkUpdates: false, startupChangelog: 'expanded' })).toMatchObject({
      checkUpdates: false,
      startupChangelog: 'expanded',
    })
  })

  it('keeps a legacy status preset available for runtime migration', () => {
    expect(resolve({ statusPreset: 'minimal' })).toMatchObject({ statusPreset: 'minimal' })
  })

  it('rejects values outside the declared vocabulary', () => {
    expect(() => RowSettings({ theme: 'neon' })).toThrow()
    expect(() => RowSettings({ motion: 'sometimes' })).toThrow()
  })
})
