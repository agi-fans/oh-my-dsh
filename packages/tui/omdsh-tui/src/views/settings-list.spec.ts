import { describe, expect, it } from 'vitest'
import {
  applySettingValue,
  applySettingsEvent,
  createSettings,
  renderSettings,
  tuiSettingItems,
  type TuiPrefs,
} from './settings-list.ts'
import { createTheme } from '../chrome/theme.ts'
import type { KeyEvent } from '../input/keys.ts'
import { visibleWidth } from '../chrome/width.ts'

const theme = createTheme(false)
const key = (id: string): KeyEvent => ({ type: 'key', id })

const prefs = { theme: 'dark' as const, colors: true, expandTools: false }

describe('tuiSettingItems / applySettingValue', () => {
  it('exposes theme and color cycle rows', () => {
    const items = tuiSettingItems(prefs)
    expect(items.map((item) => item.id)).toEqual([
      'theme',
      'colors',
      'expandTools',
      'checkUpdates',
      'startupChangelog',
      'statusEnabled',
      'statusLabels',
      'statusItem:model',
      'statusItem:effort',
      'statusItem:path',
      'statusItem:git',
      'statusItem:context',
      'statusItem:cache',
      'statusItem:tokens',
      'statusItem:speed',
      'statusItem:durations',
      'statusItem:counts',
    ])
    expect(items[0]?.value).toBe('dark')
    expect(items[1]?.value).toBe('on')
    expect(items[2]).toMatchObject({ label: 'Tool details', value: 'compact' })
    expect(items[3]).toMatchObject({ label: 'Update checks', value: 'on' })
    expect(items[4]).toMatchObject({ label: 'Release notes', value: 'summary' })
    expect(items[5]?.value).toBe('on')
    expect(items[5]?.label).toBe('Status line')
    expect(items[6]?.value).toBe('compact')
    expect(items[7]).toMatchObject({ label: '← Model', value: 'default', sample: 'deepseek' })
    expect(items[11]).toMatchObject({ label: '← Context', value: 'default', sample: 'Ctx 1.6%' })
    expect(applySettingValue(prefs, 'theme', 'light')).toEqual({ theme: 'light', colors: true, expandTools: false })
    expect(applySettingValue(prefs, 'colors', 'off')).toEqual({ theme: 'dark', colors: false, expandTools: false })
    expect(applySettingValue(prefs, 'expandTools', 'expanded')).toEqual({ theme: 'dark', colors: true, expandTools: true })
    expect(applySettingValue(prefs, 'statusEnabled', 'off').statusBar?.enabled).toBe(false)
    expect(applySettingValue(prefs, 'statusLabels', 'full').statusBar?.labels).toBe('full')
    expect(applySettingValue(prefs, 'statusItem:model', 'accent').statusBar?.colors?.model).toBe('accent')
    expect(applySettingValue(prefs, 'statusItem:cache', 'warning').statusBar?.colors?.cache).toBe('warning')
    expect(applySettingValue(prefs, 'theme', 'nope')).toEqual(prefs)
  })

  it('hides and reorders individual status groups without duplicate positions', () => {
    const hidden = applySettingValue(prefs, 'statusItem:context', 'off')
    expect(hidden.statusBar?.groups).toEqual(['cache', 'tokens', 'speed', 'durations', 'counts'])
    const moved = applySettingValue(hidden, 'statusItem:counts', '1')
    expect(moved.statusBar?.groups).toEqual(['counts', 'cache', 'tokens', 'speed', 'durations'])
    const hiddenGit = applySettingValue(prefs, 'statusItem:git', 'hidden')
    expect(hiddenGit.statusBar?.meta).toEqual(['model', 'effort', 'path'])
  })

  it('exposes update and startup release-note controls', () => {
    const items = tuiSettingItems(prefs)
    expect(items.find(item => item.id === 'checkUpdates')).toMatchObject({ value: 'on' })
    expect(items.find(item => item.id === 'startupChangelog')).toMatchObject({ value: 'summary' })
    expect(applySettingValue(prefs, 'checkUpdates', 'off').checkUpdates).toBe(false)
    expect(applySettingValue(prefs, 'startupChangelog', 'expanded').startupChangelog).toBe('expanded')
  })
})

describe('applySettingsEvent', () => {
  it('cycles the focused row on enter or space', () => {
    const open = createSettings(prefs, 'theme')
    const cycled = applySettingsEvent(open, key('enter'))
    expect(cycled).toEqual({
      kind: 'apply',
      state: { selected: 0, prefs: { theme: 'light', colors: true, expandTools: false } },
    })
    const again = applySettingsEvent(cycled.kind === 'apply' ? cycled.state : open, { type: 'text', value: ' ' })
    expect(again.kind === 'apply' && again.state.prefs.theme).toBe('midnight')
  })

  it('moves between rows and closes on escape', () => {
    const open = createSettings(prefs)
    const down = applySettingsEvent(open, key('down'))
    expect(down).toEqual({ kind: 'update', state: { selected: 1, prefs } })
    const mid = applySettingsEvent(down.kind === 'update' ? down.state : open, key('down'))
    expect(mid.kind === 'update' && mid.state.selected).toBe(2)
    const last = applySettingsEvent(mid.kind === 'update' ? mid.state : open, key('down'))
    expect(last.kind === 'update' && last.state.selected).toBe(3)
    const next = applySettingsEvent(last.kind === 'update' ? last.state : open, key('down'))
    expect(next.kind === 'update' && next.state.selected).toBe(4)
    expect(applySettingsEvent(open, key('escape'))).toEqual({ kind: 'close' })
    expect(applySettingsEvent(open, key('ctrl+c'))).toEqual({ kind: 'close' })
  })

  it('keeps up and down inside the active settings tab', () => {
    const lastGeneral = createSettings(prefs, 'startupChangelog')
    const down = applySettingsEvent(lastGeneral, key('down'))
    expect(down).toEqual({ kind: 'update', state: lastGeneral })
    const firstStatus = createSettings(prefs, 'statusEnabled')
    const up = applySettingsEvent(firstStatus, key('up'))
    expect(up).toEqual({ kind: 'update', state: firstStatus })
    const end = applySettingsEvent(firstStatus, key('end'))
    expect(end.kind === 'update' && end.state.selected).toBe(tuiSettingItems(prefs).length - 1)
    const home = applySettingsEvent(end.kind === 'update' ? end.state : firstStatus, key('home'))
    expect(home.kind === 'update' && home.state.selected).toBe(5)
  })

  it('uses tab to jump between General and Status line sections', () => {
    const open = createSettings(prefs, 'theme')
    const status = applySettingsEvent(open, key('tab'))
    expect(status.kind === 'update' && status.state.selected).toBe(5)
    const general = applySettingsEvent(status.kind === 'update' ? status.state : open, key('tab'))
    expect(general.kind === 'update' && general.state.selected).toBe(0)
  })

  it('reorders first-line preview items independently of telemetry groups', () => {
    const open = createSettings(prefs, 'statusItem:git')
    const grabbed = applySettingsEvent(open, key('enter'))
    const moved = applySettingsEvent(grabbed.kind === 'apply' ? grabbed.state : open, key('up'))
    expect(moved.kind === 'apply' && moved.state.prefs.statusBar?.metaOrder).toEqual([
      'model', 'effort', 'git', 'path',
    ])
    const preview = renderSettings(moved.kind === 'apply' ? moved.state : open, theme, 80, 16).lines.join('\n')
    expect(preview).toMatch(/deepseek · max\s+main \*1 · ~\/project/)
    const toLeft = applySettingsEvent(moved.kind === 'apply' ? moved.state : open, key('left'))
    expect(toLeft.kind === 'apply' && toLeft.state.prefs.statusBar?.sides?.git).toBe('left')
  })

  it('grabs a status group and reorders the visible list directly with up/down', () => {
    const open = createSettings(prefs, 'statusItem:tokens')
    const grabbed = applySettingsEvent(open, key('enter'))
    expect(grabbed.kind).toBe('apply')
    expect(grabbed.kind === 'apply' && grabbed.state.moving).toBe('tokens')
    const moved = applySettingsEvent(grabbed.kind === 'apply' ? grabbed.state : open, key('up'))
    expect(moved.kind === 'apply' && moved.state.prefs.statusBar?.groups).toEqual([
      'context', 'tokens', 'cache', 'speed', 'durations', 'counts',
    ])
    expect(moved.kind === 'apply' && moved.state.prefs.statusBar?.order).toEqual([
      'context', 'tokens', 'cache', 'speed', 'durations', 'counts',
    ])
    expect(moved.kind === 'apply' && tuiSettingItems(moved.state.prefs)[moved.state.selected]?.label).toBe('← Tokens')
    const placed = applySettingsEvent(moved.kind === 'apply' ? moved.state : open, key('enter'))
    expect(placed.kind === 'update' && placed.state.moving).toBeUndefined()
  })

  it('shows or hides a status group with space while preserving the visible order', () => {
    const open = createSettings(prefs, 'statusItem:cache')
    const hidden = applySettingsEvent(open, { type: 'text', value: ' ' })
    expect(hidden.kind === 'apply' && hidden.state.prefs.statusBar?.groups).toEqual([
      'context', 'tokens', 'speed', 'durations', 'counts',
    ])
    expect(hidden.kind === 'apply' && tuiSettingItems(hidden.state.prefs)[12]?.id).toBe('statusItem:cache')
    const shown = applySettingsEvent(hidden.kind === 'apply' ? hidden.state : open, { type: 'text', value: ' ' })
    expect(shown.kind === 'apply' && shown.state.prefs.statusBar?.groups).toEqual([
      'context', 'cache', 'tokens', 'speed', 'durations', 'counts',
    ])
    expect(shown.kind === 'apply' && shown.state.selected).toBe(12)
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
    expect(lines).toContain('←→ change')
    expect(lines).toContain('Color palette')
    expect(lines).toContain('Tool details')
    const tools = renderSettings(createSettings(prefs, 'expandTools'), theme, 50).lines.join('\n')
    expect(tools).toContain('Expand tool output')
    const status = renderSettings(createSettings(prefs, 'statusEnabled'), theme, 50).lines.join('\n')
    expect(status).toContain('Status line')
    expect(status).toContain('Show the fixed two-line footer')
    expect(status).toContain('Context')
    expect(status).toContain('Latency')
    expect(status).toContain('deepseek')
    expect(status).toContain('Cache 99%')
    expect(status).toContain('Model')
    expect(status).toContain('Git')
    expect(status).toContain('deepseek')
    expect(status).toContain('~/project')
    const wide = renderSettings(createSettings(prefs, 'statusItem:git'), theme, 120, 20).lines.join('\n')
    expect(wide).toMatch(/deepseek · max\s+~\/project · main \*1/)
    expect(wide).toContain('Tools 3m33s')
    expect(wide).not.toMatch(/main \*1…|Tools…/u)
  })

  it('renders status rows in their effective order and marks a grabbed row', () => {
    const reordered: TuiPrefs = {
      ...prefs,
      statusBar: {
        enabled: true,
        labels: 'compact',
        groups: ['counts', 'context', 'cache', 'tokens', 'speed', 'durations'],
        order: ['counts', 'context', 'cache', 'tokens', 'speed', 'durations'],
      },
    }
    const open = createSettings(reordered, 'statusItem:counts')
    const grabbed = applySettingsEvent(open, key('enter'))
    const view = renderSettings(grabbed.kind === 'apply' ? grabbed.state : open, theme, 72, 18)
    const text = view.lines.join('\n')
    expect(text).toContain('↕ → Activity')
    expect(text).toContain('moving')
    expect(text).toContain('↑↓ order · ←→ column')
  })

  it('marks the selected row with the cursor glyph', () => {
    const selected = renderSettings(createSettings(prefs, 'colors'), theme, 40).lines.join('\n')
    expect(selected).toContain('❯')
    expect(selected).toContain('SGR styling')
  })

  it('renders a stable full-height framed panel', () => {
    const view = renderSettings(createSettings(prefs, 'statusEnabled'), theme, 60, 18)
    expect(view.lines).toHaveLength(18)
    expect(view.lines.every(line => visibleWidth(line) === 60)).toBe(true)
    expect(view.lines[0]).toMatch(/^╭─ .*Settings.*╮$/)
    expect(view.lines.at(-1)).toMatch(/^╰─+╯$/)
    expect(view.lines.join('\n')).toContain('● Status line')
    expect(view.cursor.row).toBeGreaterThanOrEqual(3)
    const compact = renderSettings(createSettings(prefs, 'statusItem:counts'), theme, 40, 10)
    expect(compact.lines).toHaveLength(10)
    expect(compact.lines.join('\n')).toContain('Activity')
    const tiny = renderSettings(createSettings(prefs, 'statusItem:counts'), theme, 40, 8)
    expect(tiny.lines).toHaveLength(8)
    expect(tiny.lines.every(line => visibleWidth(line) === 40)).toBe(true)
    expect(tiny.lines.join('\n')).toContain('Activity')
  })

})
