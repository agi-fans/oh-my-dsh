import { describe, expect, it } from 'vitest'
import { resolveStatusBarConfig, type StatusBarConfig } from '../chrome/status-config.ts'
import { TuiSettingsSchema } from './tui-settings.ts'

describe('TuiSettingsSchema', () => {
  it('defaults to dark + colors and accepts light', () => {
    const validate = TuiSettingsSchema as unknown as (input: object) => {
      theme: string
      colors: boolean
      expandTools: boolean
      statusBar?: { enabled: boolean; labels: string; groups: string[]; order?: string[] }
      statusPreset?: string
    }
    expect(validate({})).toEqual({
      theme: 'dark',
      colors: true,
      motion: 'full',
      terminalProgress: false,
      expandTools: false,
      checkUpdates: true,
      startupChangelog: 'summary',
      notifications: 'off',
      notificationThreshold: '30s',
    })
    expect(validate({ theme: 'light', colors: false, expandTools: true })).toEqual({
      theme: 'light',
      colors: false,
      motion: 'full',
      terminalProgress: false,
      expandTools: true,
      checkUpdates: true,
      startupChangelog: 'summary',
      notifications: 'off',
      notificationThreshold: '30s',
    })
    expect(validate({ statusBar: { enabled: false, labels: 'full', groups: ['tokens', 'cache'] } })).toMatchObject({
      statusBar: { enabled: false, labels: 'full', groups: ['tokens', 'cache'] },
    })
    const retiredContextDisplay = validate({
      statusBar: { enabled: true, labels: 'compact', groups: ['context'], contextDisplay: 'gauge' },
    }).statusBar
    expect(resolveStatusBarConfig(retiredContextDisplay as StatusBarConfig)).not.toHaveProperty('contextDisplay')
    expect(validate({
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
    const validate = TuiSettingsSchema as unknown as (input: object) => {
      checkUpdates: boolean
      startupChangelog: string
    }
    expect(validate({ checkUpdates: false, startupChangelog: 'expanded' })).toMatchObject({
      checkUpdates: false,
      startupChangelog: 'expanded',
    })
  })

  it('keeps a legacy status preset available for runtime migration', () => {
    const validate = TuiSettingsSchema as unknown as (input: object) => { statusPreset?: string }
    expect(validate({ statusPreset: 'minimal' })).toMatchObject({ statusPreset: 'minimal' })
  })
})
