import { describe, expect, it } from 'vitest'
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
      expandTools: false,
      checkUpdates: true,
      startupChangelog: 'summary',
    })
    expect(validate({ theme: 'light', colors: false, expandTools: true })).toEqual({
      theme: 'light',
      colors: false,
      expandTools: true,
      checkUpdates: true,
      startupChangelog: 'summary',
    })
    expect(validate({ statusBar: { enabled: false, labels: 'full', groups: ['tokens', 'cache'] } })).toMatchObject({
      statusBar: { enabled: false, labels: 'full', groups: ['tokens', 'cache'] },
    })
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
