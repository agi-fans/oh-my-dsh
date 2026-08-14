import { describe, expect, it } from 'vitest'
import { TuiSettingsSchema } from './tui-settings.ts'

describe('TuiSettingsSchema', () => {
  it('defaults to dark + colors and accepts light', () => {
    const empty = TuiSettingsSchema as unknown as (input: object) => {
      theme: string
      colors: boolean
      expandTools: boolean
      statusPreset: string
    }
    expect(empty({})).toEqual({ theme: 'dark', colors: true, expandTools: false, statusPreset: 'compact' })
    expect(TuiSettingsSchema({ theme: 'light', colors: false, expandTools: true })).toEqual({
      theme: 'light',
      colors: false,
      expandTools: true,
      statusPreset: 'compact',
    })
  })
})
