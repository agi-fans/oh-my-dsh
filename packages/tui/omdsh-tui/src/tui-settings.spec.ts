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
    expect(validate({})).toEqual({ theme: 'dark', colors: true, expandTools: false })
    expect(validate({ theme: 'light', colors: false, expandTools: true })).toEqual({
      theme: 'light',
      colors: false,
      expandTools: true,
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
      },
    })).toMatchObject({ statusBar: { order: ['tokens', 'cache', 'context'] } })
  })

  it('keeps a legacy status preset available for runtime migration', () => {
    const validate = TuiSettingsSchema as unknown as (input: object) => { statusPreset?: string }
    expect(validate({ statusPreset: 'minimal' })).toMatchObject({ statusPreset: 'minimal' })
  })
})
