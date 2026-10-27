import { describe, expect, it } from 'vitest'
import z from '@deepseek-ai/schemastery'
import { resolveStatusBarConfig, STATUS_CONTEXT_STYLES, type StatusBarConfig } from '../chrome/status-config.ts'
import { FOLD_DENSITIES } from './fold-policy.ts'
import { resolveNotificationMode, TUI_SETTINGS_FIELDS } from './tui-settings.ts'

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
      mathMode: 'auto',
      mermaidMode: 'auto',
      hideThinking: false,
      editor: 'auto',
      terminalTitle: 'status',
      terminalState: 'auto',
      copyOnSelect: true,
      pasteProtection: true,
      mouseInteraction: 'auto',
      foldDensity: 'standard',
      // Legacy migration input; the schema still reads it so an older document
      // resolves, but nothing writes it any more.
      expandTools: false,
      checkUpdates: true,
      startupChangelog: 'summary',
      notifications: 'off',
      notificationFocus: undefined,
      notificationThreshold: undefined,
      // The status line is one plain object now, so it always materializes.
      statusBar: {
        density: 'standard',
        hidden: [],
        // Declared so an older document still loads; nothing writes them.
        enabled: undefined,
        labels: undefined,
        contextStyle: undefined,
        groups: undefined,
        order: undefined,
        meta: undefined,
        metaOrder: undefined,
        colors: undefined,
        sides: undefined,
      },
      statusPreset: undefined,
    })
  })

  it('validates durable selection and mouse ownership preferences', () => {
    expect(resolve({ copyOnSelect: false, mouseInteraction: 'native' })).toMatchObject({ copyOnSelect: false, mouseInteraction: 'native' })
    expect(() => RowSettings({ mouseInteraction: 'unknown' })).toThrow()
  })

  it('persists formula display and rejects unsupported modes', () => {
    expect(resolve({ mathMode: 'source' })).toMatchObject({ mathMode: 'source' })
    expect(() => RowSettings({ mathMode: 'image' })).toThrow()
  })

  it('persists Mermaid display and rejects unsupported modes', () => {
    expect(resolve({ mermaidMode: 'source' })).toMatchObject({ mermaidMode: 'source' })
    expect(() => RowSettings({ mermaidMode: 'image' })).toThrow()
  })

  it('accepts explicit palette and motion overrides', () => {
    expect(resolve({ theme: 'light', colors: false, motion: 'off', foldDensity: 'verbose' })).toMatchObject({
      theme: 'light',
      colors: false,
      motion: 'off',
      foldDensity: 'verbose',
    })
  })

  it.each(FOLD_DENSITIES)('accepts the legacy %s density and expandTools preference', foldDensity => {
    expect(resolve({ foldDensity, expandTools: true })).toMatchObject({ foldDensity, expandTools: true })
  })

  it('folds a stored notification document onto one mode', () => {
    // Every stored value, including the one this change introduces, has to
    // survive the fold; only the retired policy is rewritten.
    expect(resolveNotificationMode('off', undefined)).toBe('off')
    expect(resolveNotificationMode('off', 'always')).toBe('off')
    expect(resolveNotificationMode('unfocused', undefined)).toBe('unfocused')
    expect(resolveNotificationMode('unfocused', 'always')).toBe('unfocused')
    expect(resolveNotificationMode('always', 'unfocused')).toBe('always')
    expect(resolveNotificationMode('long-running', undefined)).toBe('unfocused')
    expect(resolveNotificationMode('long-running', 'always')).toBe('always')
    expect(resolveNotificationMode(undefined, undefined)).toBe('off')
    // A pre-merge short-turn threshold no longer exists as a choice.
    expect(resolve({ notificationThreshold: '1m' }).notificationThreshold).toBe('1m')
    expect(resolve({ notifications: 'long-running' }).notifications).toBe('long-running')
  })

  it('stores a density and its narrowings, and drops the retired layout engine', () => {
    expect(resolve({ statusBar: { density: 'verbose', hidden: ['session'] } })).toMatchObject({
      statusBar: { density: 'verbose', hidden: ['session'] },
    })
    // A document written by the old engine still parses; the retired layout
    // fields it carries are simply not part of the stored shape any more.
    const legacy = resolve({
      statusBar: {
        enabled: true,
        labels: 'compact',
        groups: ['cache'],
        order: ['tokens', 'cache', 'context'],
        colors: { model: 'accent', metrics: 'warning' },
        sides: { model: 'right' },
      },
    }).statusBar
    // The resolver reduces the old document to a density: what it listed as
    // shown survives as a narrowing, and its per-item colour and column are gone.
    const reduced = resolveStatusBarConfig(legacy as StatusBarConfig)
    expect(reduced.groups).toEqual(['cache'])
    expect(reduced).not.toHaveProperty('colors')
    expect(reduced).not.toHaveProperty('sides')
  })

  it('validates startup update and release-note preferences', () => {
    expect(resolve({ checkUpdates: false, startupChangelog: 'expanded' })).toMatchObject({
      checkUpdates: false,
      startupChangelog: 'expanded',
    })
  })

  it.each(STATUS_CONTEXT_STYLES)('renders the %s context representation from a density', contextStyle => {
    // The representation is chosen by density now, so it is still reachable and
    // still validated — just not as an independent stored field.
    const config = { ...resolveStatusBarConfig({ density: 'standard' }), contextStyle }
    expect(config.contextStyle).toBe(contextStyle)
    expect(resolveStatusBarConfig(resolve({ statusBar: {} }).statusBar as StatusBarConfig).contextStyle).toBe('percent')
  })

  it('keeps a legacy status preset available for runtime migration', () => {
    expect(resolve({ statusPreset: 'minimal' })).toMatchObject({ statusPreset: 'minimal' })
  })

  it('rejects values outside the declared vocabulary', () => {
    expect(() => RowSettings({ theme: 'neon' })).toThrow()
    expect(() => RowSettings({ motion: 'sometimes' })).toThrow()
    expect(() => RowSettings({ editor: 'missing-editor' })).toThrow()
    expect(resolve({ editor: 'cursor' }).editor).toBe('cursor')
  })
})
