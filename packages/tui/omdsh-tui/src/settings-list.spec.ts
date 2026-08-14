import { describe, expect, it } from 'vitest'
import {
  applySettingValue,
  applySettingsEvent,
  createSettings,
  renderSettings,
  tuiSettingItems,
} from './settings-list.ts'
import { createTheme } from './theme.ts'
import type { KeyEvent } from './keys.ts'

const theme = createTheme(false)
const key = (id: string): KeyEvent => ({ type: 'key', id })

const prefs = { theme: 'dark' as const, colors: true }

describe('tuiSettingItems / applySettingValue', () => {
  it('exposes theme and color cycle rows', () => {
    const items = tuiSettingItems(prefs)
    expect(items.map((item) => item.id)).toEqual(['theme', 'colors'])
    expect(items[0]?.value).toBe('dark')
    expect(items[1]?.value).toBe('on')
    expect(applySettingValue(prefs, 'theme', 'light')).toEqual({ theme: 'light', colors: true })
    expect(applySettingValue(prefs, 'colors', 'off')).toEqual({ theme: 'dark', colors: false })
    expect(applySettingValue(prefs, 'theme', 'nope')).toEqual(prefs)
  })
})

describe('applySettingsEvent', () => {
  it('cycles the focused row on enter or space', () => {
    const open = createSettings(prefs, 'theme')
    const cycled = applySettingsEvent(open, key('enter'))
    expect(cycled).toEqual({ kind: 'apply', state: { selected: 0, prefs: { theme: 'light', colors: true } } })
    const again = applySettingsEvent(cycled.kind === 'apply' ? cycled.state : open, { type: 'text', value: ' ' })
    expect(again.kind === 'apply' && again.state.prefs.theme).toBe('dark')
  })

  it('moves between rows and closes on escape', () => {
    const open = createSettings(prefs)
    const down = applySettingsEvent(open, key('down'))
    expect(down).toEqual({ kind: 'update', state: { selected: 1, prefs } })
    const wrap = applySettingsEvent(down.kind === 'update' ? down.state : open, key('down'))
    expect(wrap.kind === 'update' && wrap.state.selected).toBe(0)
    expect(applySettingsEvent(open, key('escape'))).toEqual({ kind: 'close' })
    expect(applySettingsEvent(open, key('ctrl+c'))).toEqual({ kind: 'close' })
  })

  it('ignores unrelated keys and non-space text', () => {
    const open = createSettings(prefs)
    expect(applySettingsEvent(open, key('ctrl+k'))).toEqual({ kind: 'ignore' })
    expect(applySettingsEvent(open, { type: 'text', value: 'x' })).toEqual({ kind: 'ignore' })
  })
})

describe('renderSettings', () => {
  it('paints the title, both rows, and hints', () => {
    const lines = renderSettings(createSettings(prefs), theme, 50).lines.join('\n')
    expect(lines).toContain('Settings')
    expect(lines).toContain('Theme')
    expect(lines).toContain('dark')
    expect(lines).toContain('Color')
    expect(lines).toContain('on')
    expect(lines).toContain('enter cycle')
    expect(lines).toContain('Color palette')
  })

  it('marks the selected row with the cursor glyph', () => {
    const selected = renderSettings(createSettings(prefs, 'colors'), theme, 40).lines.join('\n')
    expect(selected).toContain('❯')
    expect(selected).toContain('SGR styling')
  })
})
