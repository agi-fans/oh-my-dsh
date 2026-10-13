import { describe, expect, it } from 'vitest'
import { preferenceChanges, preferencePaths } from './settings-preferences.ts'
import { resolveStatusBarConfig } from '../chrome/status-config.ts'

describe('Profile preference edits', () => {
  const previous = { theme: 'dark' as const, colors: true, motion: 'full' as const, statusBar: resolveStatusBarConfig() }

  it('writes only the edited appearance field, retaining inheritance elsewhere', () => {
    expect(preferenceChanges(previous, { ...previous, theme: 'light' })).toEqual([{ op: 'set', path: ['theme'], value: 'light' }])
    expect(preferenceChanges(previous, { ...previous, statusBar: structuredClone(previous.statusBar) })).toEqual([])
  })

  it('writes nested colors individually and treats layout order as one array', () => {
    expect(preferenceChanges(previous, { ...previous, statusBar: { ...previous.statusBar, colors: { ...previous.statusBar.colors, context: 'success' as const } } }))
      .toEqual([{ op: 'set', path: ['statusBar', 'colors', 'context'], value: 'success' as const }])
    const groups = [...previous.statusBar.groups].reverse()
    expect(preferenceChanges(previous, { ...previous, statusBar: { ...previous.statusBar, groups } }))
      .toEqual([{ op: 'set', path: ['statusBar', 'groups'], value: groups }])
  })

  it('restores a single field or color, and removes both forms of a complete layout override', () => {
    expect(preferencePaths('theme')).toEqual([['theme']])
    expect(preferencePaths('statusItem:context')).toEqual([['statusBar', 'colors', 'context']])
    expect(preferencePaths('statusReset')).toEqual([['statusBar'], ['statusPreset']])
    expect(preferencePaths('statusItem:unknown')).toBeUndefined()
    expect(preferencePaths('unknown')).toBeUndefined()
  })
})
