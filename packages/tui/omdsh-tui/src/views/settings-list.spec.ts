import { describe, expect, it } from 'vitest'
import {
  applySettingValue,
  applySettingsEvent,
  createSettings,
  renderSettings,
  refreshSettings,
  tuiSettingItems,
  type TuiPrefs,
} from './settings-list.ts'
import { createTheme } from '../chrome/theme.ts'
import { defaultFeatureStates } from '../session/feature-toggles.ts'
import type { KeyEvent } from '../input/keys.ts'
import { visibleWidth } from '../chrome/width.ts'

const theme = createTheme(false)
const key = (id: string): KeyEvent => ({ type: 'key', id })

const prefs = { theme: 'dark' as const, colors: true }
const agent = { language: 'auto' as const }

describe('settings search and inheritance', () => {
  const entries = [{ id: 'bash', label: 'Shell', description: 'Timeouts', section: 'tools' as const, fields: ['timeoutMs'], keywords: ['maxOutputBytes'] },
    { id: 'advisor', label: 'Advisor model calls', description: 'Manual advisor remains available', section: 'integrations' as const }]
  const update = (state: ReturnType<typeof createSettings>, event: KeyEvent) => {
    const command = applySettingsEvent(state, event)
    if (command.kind !== 'update') throw new Error(`Expected search update, got ${command.kind}`)
    return command.state
  }

  it.each([false, true])('searches field keywords across categories and restores the original row (color=%s)', color => {
    const start = createSettings(prefs, 'colors', agent, undefined, entries)
    const state = update(start, { type: 'text', value: 'maxOutputBytes' })
    expect(applySettingsEvent(state, key('enter'))).toEqual({ kind: 'open-plugin', id: 'bash' })
    for (const width of [32, 80, 160]) {
      const frame = renderSettings(state, createTheme(color), width, 20)
      expect(frame.lines.join('\n')).toContain('Shell')
      expect(frame.lines.join('\n')).not.toContain('Advisor model calls')
      expect(frame.lines).toHaveLength(20)
      expect(frame.lines.every(row => visibleWidth(row) <= width)).toBe(true)
    }
    const cleared = update(state, key('escape'))
    expect(cleared.search).toBe('')
    const browsing = update(cleared, key('escape'))
    expect(browsing.search).toBeUndefined()
    expect(browsing.selected).toBe(start.selected)
    expect(applySettingsEvent(browsing, key('escape'))).toEqual({ kind: 'close' })
  })

  it('keeps the query and selected identity through catalog insertion and refresh', () => {
    const state = update(createSettings(prefs, undefined, agent, undefined, entries), { type: 'text', value: 'Shell' })
    const next = refreshSettings(state, createSettings(prefs, undefined, agent, undefined,
      [{ id: 'child-models', label: 'Subagent models', description: '', section: 'agent' }, ...entries]))
    expect(next.search).toBe('Shell')
    expect(applySettingsEvent(next, key('enter'))).toEqual({ kind: 'open-plugin', id: 'bash' })
    expect(update(next, key('tab')).search).toBeUndefined()
  })

  it('handles grapheme deletion and blocks editing an empty result', () => {
    const state = update(createSettings(prefs), { type: 'text', value: '中文🐳e\u0301' })
    expect(update(state, key('backspace')).search).toBe('中文🐳')
    expect(update(state, key('ctrl+u')).search).toBe('')
    for (const id of ['enter', 'left', 'right', 'ctrl+r']) expect(applySettingsEvent(state, key(id))).toEqual({ kind: 'ignore' })
    expect(renderSettings(state, theme, 40, 12).lines.join('\n')).toContain('No matching settings')
  })

  it('exposes narrow-screen section navigation, dependencies, reset and existing command links', () => {
    const start = createSettings(prefs, 'notificationFocus', agent, undefined, entries)
    const frame = renderSettings(start, theme, 40, 20).lines.join('\n')
    expect(frame).toContain('1/5')
    expect(frame).toContain('Tab sections')
    expect(frame).toContain('Inactive while Notifications is')
    expect(applySettingsEvent(start, key('ctrl+r'))).toEqual({ kind: 'reset', id: 'notificationFocus', label: 'Notify when' })
    const action = { id: 'command:model', label: 'Model and reasoning', description: 'Session route', value: 'm', values: [], action: 'model' }
    expect(applySettingsEvent(createSettings(prefs, action.id, agent, undefined, [], undefined, [action]), key('enter')))
      .toEqual({ kind: 'open-command', name: 'model' })
    expect(applySettingsEvent(createSettings(prefs, 'statusReset'), key('enter')))
      .toEqual({ kind: 'reset', id: 'statusReset', label: 'Restore layout' })
  })
})

describe('tuiSettingItems / applySettingValue', () => {
  it.each([false, true])('shows schema choices and dispatches inline edits without copying preferences (color=%s)', color => {
    const entry = { id: 'advisor', label: '咨询 🐳', description: 'Inherited', section: 'integrations' as const, namespace: 'advisor',
      inline: { path: ['allowModelConsultations'], revision: 7, value: 'On', choices: [{ label: 'On', value: 'true' }, { label: 'Off', value: 'false' }] } }
    const state = createSettings(prefs, 'plugin:advisor', undefined, undefined, [entry])
    for (const event of [key('left'), key('right'), { type: 'text' as const, value: ' ' }]) {
      expect(applySettingsEvent(state, event)).toEqual({ kind: 'set-plugin', entry, value: 'false' })
    }
    expect(applySettingsEvent(state, key('enter'))).toEqual({ kind: 'open-plugin', id: 'advisor' })
    expect(state.prefs).toEqual(prefs)
    expect(state.plugins?.[0]?.inline?.value).toBe('On')
    for (const width of [32, 80, 160]) {
      const rendered = renderSettings(state, createTheme(color), width, 20)
      expect(rendered.lines.join('\n')).toContain('On')
      expect(rendered.lines.every(row => visibleWidth(row) <= width)).toBe(true)
    }
    entry.inline.choices = []
    expect(applySettingsEvent(state, key('right'))).toEqual({ kind: 'ignore' })
  })
  it.each([false, true])('groups owned forms beside product settings and bounds section navigation (color=%s)', color => {
    const plugins = [
      { id: 'advisor', label: 'Advisor', description: 'Consultations', section: 'integrations' as const },
      { id: 'child-models', label: 'Subagent models', description: 'Child model selection', section: 'agent' as const },
      { id: 'parallel', label: 'Tool parallelism', description: 'Concurrency', section: 'agent' as const },
      { id: 'shell', label: 'Shell', description: 'Timeout', section: 'tools' as const },
      { id: 'custom', label: 'Custom plugin', description: 'Advanced' },
    ]
    const categories = [['parallel', 'Agent'], ['child-models', 'Agent'], ['shell', 'Tools'], ['advisor', 'Integrations'], ['custom', 'Advanced']]
    for (const [id, label] of categories) {
      const state = createSettings(prefs, `plugin:${id}`, agent, defaultFeatureStates(), plugins)
      expect(applySettingsEvent(state, key('enter'))).toEqual({ kind: 'open-plugin', id })
      for (const width of [32, 80, 160]) {
        const frame = renderSettings(state, createTheme(color), width, 20)
        expect(frame.lines.join('\n')).toContain(`● ${label}`)
        expect(frame.lines).toHaveLength(20)
        expect(frame.lines.every(row => visibleWidth(row) <= width)).toBe(true)
      }
      const end = applySettingsEvent(state, key('end'))
      expect(end.kind).toBe('update')
      const last = end.kind === 'update' ? end.state : state
      expect(applySettingsEvent(last, key('down'))).toEqual({ kind: 'update', state: last })
    }
  })
  it('keeps plugin entries in their own section and opens them without cycling a preference', () => {
    const plugins = [{ id: 'shell', label: 'Shell', description: 'Live plugin settings' }]
    const state = createSettings(prefs, 'plugin:shell', undefined, undefined, plugins)
    expect(applySettingsEvent(state, { type: 'key', id: 'enter' })).toEqual({ kind: 'open-plugin', id: 'shell' })
    expect(applySettingsEvent(state, { type: 'text', value: ' ' })).toEqual({ kind: 'open-plugin', id: 'shell' })
    expect(applySettingsEvent(state, { type: 'key', id: 'right' })).toEqual({ kind: 'ignore' })
    for (const width of [32, 80]) {
      const rendered = renderSettings(state, createTheme(false, 'dark'), width, 20)
      expect(rendered.lines.join('\n')).toContain('● Advanced')
      expect(rendered.lines.join('\n')).toContain('Shell')
      for (const row of rendered.lines) expect(visibleWidth(row)).toBeLessThanOrEqual(width)
    }
  })

  it('hides Advanced when no plugin exposes unclaimed fields', () => {
    const state = createSettings(prefs, 'theme', agent, defaultFeatureStates(), [])
    const rendered = renderSettings(state, createTheme(false, 'dark'), 100, 24)
    expect(rendered.lines.join('\n')).not.toContain('● Advanced')
  })

  it('exposes theme and color cycle rows', () => {
    const items = tuiSettingItems(prefs)
    expect(items.map((item) => item.id)).toEqual([
      'theme',
      'colors',
      'motion',
      'mathMode',
      'mermaidMode',
      'hideThinking',
      'terminalTitle',
      'terminalState',
      'terminalProgress',
      'editor',
      'mouseInteraction',
      'pasteProtection',
      'copyOnSelect',
      'notifications',
      'notificationFocus',
      'notificationThreshold',
      'checkUpdates',
      'startupChangelog',
      'statusEnabled',
      'statusLabels',
      'statusContextStyle',
      'statusItem:model',
      'statusItem:effort',
      'statusItem:session',
      'statusItem:path',
      'statusItem:git',
      'statusItem:context',
      'statusItem:cache',
      'statusItem:tokens',
      'statusItem:speed',
      'statusItem:durations',
      'statusItem:counts',
      'statusReset',
    ])
    expect(items[0]?.value).toBe('dark')
    expect(items[1]?.value).toBe('on')
    expect(items[2]).toMatchObject({ label: 'Motion', value: 'full' })
    expect(items.find(item => item.id === 'terminalProgress')).toMatchObject({ label: 'Terminal activity', value: 'off' })
    expect(items.find(item => item.id === 'checkUpdates')).toMatchObject({ label: 'Update checks', value: 'on' })
    expect(items.find(item => item.id === 'startupChangelog')).toMatchObject({ label: 'Release notes', value: 'summary' })
    expect(items.find(item => item.id === 'statusEnabled')?.value).toBe('on')
    expect(items.find(item => item.id === 'statusEnabled')?.label).toBe('Telemetry')
    expect(items.find(item => item.id === 'statusLabels')?.value).toBe('compact')
    expect(items.find(item => item.id === 'statusItem:model')).toMatchObject({ label: '← Model', value: 'default', sample: 'deepseek' })
    expect(items.find(item => item.id === 'statusItem:context'))
      .toMatchObject({ label: '← Context', value: 'default', sample: 'Ctx 1.6%' })
    expect(applySettingValue(prefs, 'theme', 'light')).toEqual({ theme: 'light', colors: true })
    expect(applySettingValue(prefs, 'colors', 'off')).toEqual({ theme: 'dark', colors: false })
    expect(applySettingValue(prefs, 'foldDensity', 'verbose'))
      .toEqual(prefs)
    expect(applySettingValue(prefs, 'foldDensity', 'nope')).toEqual(prefs)
    // The density replaced the setting this used to be, so there is no row left
    // that could write the legacy flag back.
    expect(applySettingValue(prefs, 'expandTools', 'expanded')).toEqual(prefs)
    expect(applySettingValue(prefs, 'motion', 'reduced').motion).toBe('reduced')
    expect(applySettingValue(prefs, 'mathMode', 'source').mathMode).toBe('source')
    expect(applySettingValue(prefs, 'mathMode', 'invalid').mathMode).toBe(prefs.mathMode)
    expect(applySettingValue(prefs, 'mermaidMode', 'source').mermaidMode).toBe('source')
    expect(applySettingValue(prefs, 'mermaidMode', 'invalid').mermaidMode).toBe(prefs.mermaidMode)
    expect(applySettingValue(prefs, 'copyOnSelect', 'off').copyOnSelect).toBe(false)
    expect(applySettingValue(prefs, 'mouseInteraction', 'native').mouseInteraction).toBe('native')
    expect(applySettingValue(prefs, 'mouseInteraction', 'invalid')).toEqual(prefs)
    expect(applySettingValue(prefs, 'terminalProgress', 'on').terminalProgress).toBe(true)
    expect(applySettingValue(prefs, 'statusEnabled', 'off').statusBar?.enabled).toBe(false)
    expect(applySettingValue(prefs, 'statusLabels', 'full').statusBar?.labels).toBe('full')
    expect(applySettingValue(prefs, 'statusItem:model', 'accent').statusBar?.colors?.model).toBe('accent')
    expect(applySettingValue(prefs, 'statusItem:cache', 'warning').statusBar?.colors?.cache).toBe('warning')
    expect(applySettingValue(prefs, 'theme', 'nope')).toEqual(prefs)
  })

  it('cycles detected editors and saves stable ids rather than display labels', () => {
    const editors = [{ id: 'auto' as const, label: 'Auto (VS Code)' }, { id: 'code' as const, label: 'VS Code' }, { id: 'vim' as const, label: 'Vim' }]
    const state = createSettings(prefs, 'editor', undefined, undefined, undefined, editors)
    const next = applySettingsEvent(state, key('enter'))
    expect(next.kind === 'apply' && next.state.prefs.editor).toBe('code')
    const again = applySettingsEvent(next.kind === 'apply' ? next.state : state, key('right'))
    expect(again.kind === 'apply' && again.state.prefs.editor).toBe('vim')
    const auto = applySettingsEvent(again.kind === 'apply' ? again.state : state, key('right'))
    expect(auto.kind === 'apply' && auto.state.prefs.editor).toBe('auto')
    for (const colors of [true, false]) {
      const view = renderSettings(next.kind === 'apply' ? next.state : state, createTheme(colors), 40, 12)
      expect(view.lines.join('\n')).toContain('VS Code')
      for (const line of view.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40)
    }
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

  it('exposes opt-in terminal notification controls', () => {
    const items = tuiSettingItems(prefs)
    expect(items.find(item => item.id === 'notifications')).toMatchObject({ value: 'off' })
    expect(items.find(item => item.id === 'notificationThreshold')).toMatchObject({ value: '30s' })
    expect(applySettingValue(prefs, 'notifications', 'long-running').notifications).toBe('long-running')
    expect(applySettingValue(prefs, 'notificationThreshold', '1m').notificationThreshold).toBe('1m')
  })

  it('projects Agent language only when the host binds Agent settings', () => {
    expect(tuiSettingItems(prefs).some(item => item.id === 'agentLanguage')).toBe(false)
    expect(tuiSettingItems(prefs, agent).find(item => item.id === 'agentLanguage')).toMatchObject({
      id: 'agentLanguage',
      label: 'Language',
      value: 'Auto',
      values: ['Auto', 'Simplified Chinese', 'English'],
    })
  })
})

describe('applySettingsEvent', () => {
  it('cycles the focused row on enter or space', () => {
    const open = createSettings(prefs, 'theme')
    const cycled = applySettingsEvent(open, key('enter'))
    expect(cycled).toEqual({
      kind: 'apply',
      domain: 'tui',
      state: { selected: 0, prefs: { theme: 'light', colors: true } },
    })
    const again = applySettingsEvent(cycled.kind === 'apply' ? cycled.state : open, { type: 'text', value: ' ' })
    expect(again.kind === 'apply' && again.state.prefs.theme).toBe('system')
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
    expect(home.kind === 'update' && home.state.selected).toBe(tuiSettingItems(prefs).findIndex(item => item.id === 'statusEnabled'))
  })

  it('uses tab to jump between General and Status line sections', () => {
    const open = createSettings(prefs, 'theme')
    const status = applySettingsEvent(open, key('tab'))
    expect(status.kind === 'update' && status.state.selected).toBe(tuiSettingItems(prefs).findIndex(item => item.id === 'statusEnabled'))
    const general = applySettingsEvent(status.kind === 'update' ? status.state : open, key('tab'))
    expect(general.kind === 'update' && general.state.selected).toBe(0)
  })

  it('navigates General, Agent, and Status line as three bounded sections', () => {
    const open = createSettings(prefs, 'theme', agent)
    const agentTab = applySettingsEvent(open, key('tab'))
    expect(agentTab.kind === 'update' && agentTab.state.selected).toBe(tuiSettingItems(prefs).findIndex(item => item.id === 'statusEnabled'))
    const down = applySettingsEvent(agentTab.kind === 'update' ? agentTab.state : open, key('down'))
    expect(down).toEqual(agentTab)
    const status = applySettingsEvent(agentTab.kind === 'update' ? agentTab.state : open, key('tab'))
    expect(status.kind === 'update' && status.state.selected).toBe(tuiSettingItems(prefs, agent).findIndex(item => item.id === 'statusEnabled'))
    const general = applySettingsEvent(status.kind === 'update' ? status.state : open, key('tab'))
    expect(general.kind === 'update' && general.state.selected).toBe(0)
    const reverseStatus = applySettingsEvent(general.kind === 'update' ? general.state : open, key('shift+tab'))
    expect(reverseStatus.kind === 'update' && reverseStatus.state.selected).toBe(tuiSettingItems(prefs, agent).findIndex(item => item.id === 'statusEnabled'))
  })

  it('cycles Agent language independently of TUI preferences', () => {
    const open = createSettings(prefs, 'agentLanguage', agent)
    const chinese = applySettingsEvent(open, key('right'))
    expect(chinese).toEqual({
      kind: 'apply',
      domain: 'agent',
      state: { ...open, agent: { language: 'zh-CN' } },
    })
    const english = applySettingsEvent(chinese.kind === 'apply' ? chinese.state : open, key('enter'))
    expect(english.kind === 'apply' && english.domain).toBe('agent')
    expect(english.kind === 'apply' && english.state.agent?.language).toBe('en')
    expect(english.kind === 'apply' && english.state.prefs).toEqual(prefs)
  })

  it('reorders first-line preview items independently of telemetry groups', () => {
    const open = createSettings(prefs, 'statusItem:git')
    const grabbed = applySettingsEvent(open, key('enter'))
    const moved = applySettingsEvent(grabbed.kind === 'apply' ? grabbed.state : open, key('up'))
    expect(moved.kind === 'apply' && moved.state.prefs.statusBar?.metaOrder).toEqual([
      'model', 'effort', 'git', 'path', 'session',
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
    expect(hidden.kind === 'apply'
      && tuiSettingItems(hidden.state.prefs)[hidden.state.selected]?.id).toBe('statusItem:cache')
    const shown = applySettingsEvent(hidden.kind === 'apply' ? hidden.state : open, { type: 'text', value: ' ' })
    expect(shown.kind === 'apply' && shown.state.prefs.statusBar?.groups).toEqual([
      'context', 'cache', 'tokens', 'speed', 'durations', 'counts',
    ])
    expect(shown.kind === 'apply'
      && tuiSettingItems(shown.state.prefs)[shown.state.selected]?.id).toBe('statusItem:cache')
  })

  it('ignores unrelated keys and searches typed text', () => {
    const open = createSettings(prefs)
    expect(applySettingsEvent(open, key('ctrl+k'))).toEqual({ kind: 'ignore' })
    expect(applySettingsEvent(open, { type: 'text', value: 'x' })).toMatchObject({ kind: 'update', state: { search: 'x' } })
  })
})

describe('Features section', () => {
  const features = defaultFeatureStates()

  it('appears only when a feature registry is supplied', () => {
    expect(renderSettings(createSettings(prefs, undefined, undefined, features), theme, 80, 40).lines.join('\n'))
      .toContain('Tools')
    expect(renderSettings(createSettings(prefs), theme, 80, 40).lines.join('\n')).not.toContain('Tools')
  })

  it('lists every feature with its shipped state', () => {
    // The overlay body is windowed, so the Features rows are only painted once
    // selection has moved into the section.
    const items = tuiSettingItems(prefs, undefined, features)
    const at = items.findIndex(item => item.id === 'feature:workspace-changes')
    const open = { ...createSettings(prefs, undefined, undefined, features), selected: at }
    const lines = renderSettings(open, theme, 80, 40).lines.join('\n')
    expect(lines).toContain('Changed-file summary')
    expect(lines).toContain('Session history tools')
    expect(lines).toContain('Ralph loop')
    expect(lines).toContain('Repeat-tool reminder')
    // ralph ships off; the rest ship on.
    expect(lines).toMatch(/Ralph loop\s+off/u)
  })

  it('states that live application depends on the profile host', () => {
    const items = tuiSettingItems(prefs, undefined, features)
    const at = items.findIndex(item => item.id === 'feature:workspace-changes')
    const open = { ...createSettings(prefs, undefined, undefined, features), selected: at }
    const lines = renderSettings(open, theme, 220, 40).lines.join('\n')
    expect(lines).toContain('Saved in profile; applies live when supported')
  })

  it('routes a feature toggle to the features apply domain, not the prefs one', () => {
    const items = tuiSettingItems(prefs, undefined, features)
    const start = createSettings(prefs, undefined, undefined, features)
    const at = items.findIndex(item => item.id === 'feature:workspace-changes')
    const command = applySettingsEvent({ ...start, selected: at }, key('right'))
    expect(command.kind).toBe('apply')
    expect(command.kind === 'apply' && command.domain).toBe('features')
    expect(command.kind === 'apply' && command.state.features?.['workspace-changes']).toBe(false)
    // The durable preferences must be untouched by a feature toggle.
    expect(command.kind === 'apply' && command.state.prefs).toEqual(prefs)
  })

  it('turns a shipped-off feature on without touching the others', () => {
    const items = tuiSettingItems(prefs, undefined, features)
    const start = createSettings(prefs, undefined, undefined, features)
    const at = items.findIndex(item => item.id === 'feature:tool-ralph')
    const command = applySettingsEvent({ ...start, selected: at }, key('right'))
    expect(command.kind === 'apply' && command.state.features?.['tool-ralph']).toBe(true)
    expect(command.kind === 'apply' && command.state.features?.['workspace-changes']).toBe(true)
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
    expect(lines).toContain('Tab sections')
    expect(lines).toContain('Color palette')
    expect(lines).not.toContain('Transcript')
    const terminalActivity = renderSettings(createSettings(prefs, 'terminalProgress'), theme, 40, 12).lines.join('\n')
    expect(terminalActivity).toContain('Terminal activity')
    expect(terminalActivity).toContain('Busy/idle status in supported')
    expect(terminalActivity).toContain('terminal tabs and taskbars')
    const status = renderSettings(createSettings(prefs, 'statusEnabled'), theme, 50).lines.join('\n')
    expect(status).toContain('Status line')
    expect(status).toContain('Show session metrics on the second footer')
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
    const textPreview = renderSettings(createSettings(prefs, 'statusItem:context'), theme, 120, 14).lines.join('\n')
    expect(textPreview).toContain('Ctx 1.6%')
  })

  it('cycles context styles through live previews without moving or hiding the item', () => {
    let state = createSettings(prefs, 'statusContextStyle')
    expect(tuiSettingItems(prefs)[state.selected]).toMatchObject({ label: 'Context style', value: 'percent' })
    for (const [contextStyle, preview] of [['bar', 'Ctx ──────────'], ['tokens', 'Ctx 16.4K/1M'], ['detailed', 'Ctx 1.6% · 16.4K/1M'], ['percent', 'Ctx 1.6%']]) {
      const result = applySettingsEvent(state, key('enter'))
      expect(result.kind).toBe('apply')
      if (result.kind !== 'apply') throw new Error('Context style must apply immediately')
      state = result.state
      expect(state.prefs.statusBar?.contextStyle).toBe(contextStyle)
      expect(state.moving).toBeUndefined()
      expect(state.prefs.statusBar?.groups).toContain('context')
      expect(renderSettings(state, theme, 140, 20).lines.join('\n')).toContain(preview)
    }
    expect(applySettingValue(prefs, 'statusContextStyle', 'invalid')).toEqual(prefs)
  })

  it('previews metadata when telemetry is disabled, matching the live footer', () => {
    const hidden = applySettingValue(prefs, 'statusEnabled', 'off')
    const preview = renderSettings(createSettings(hidden, 'statusEnabled'), theme, 140, 20).lines.slice(3, 5).join('\n')
    expect(preview).toContain('deepseek')
    expect(preview).toContain('main *1')
    expect(preview).not.toContain('Cache')
    expect(preview).not.toContain('Ctx')
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

  it.each([40, 60, 80])('renders the Agent tab in display cells at width %i', (width) => {
    const view = renderSettings(createSettings(prefs, 'agentLanguage', agent), theme, width, 12)
    const text = view.lines.join('\n')
    expect(view.lines.every(line => visibleWidth(line) === width)).toBe(true)
    expect(text).toContain('● Agent')
    expect(text).toContain('Language')
    expect(text).toContain('Auto')
  })

})

it('persists paste protection and notification focus choices', () => {
  expect(applySettingValue(prefs, 'pasteProtection', 'off')).toMatchObject({ pasteProtection: false })
  expect(applySettingValue(prefs, 'notificationFocus', 'always')).toMatchObject({ notificationFocus: 'always' })
  expect(tuiSettingItems(prefs).find(row => row.id === 'notificationFocus')?.value).toBe('unfocused')
})
