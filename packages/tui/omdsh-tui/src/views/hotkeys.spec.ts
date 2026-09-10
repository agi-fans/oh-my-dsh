import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYBINDINGS } from '../input/keybindings-config.ts'
import { formatEssentialHotkeysText, formatHotkeysText, hotkeyCount } from './hotkeys.ts'

describe('formatHotkeysText', () => {
  it('groups the bindings this TUI implements into Markdown tables', () => {
    const text = formatHotkeysText()
    expect(text).toContain('**Navigation**')
    expect(text).toContain('**Editing**')
    expect(text).toContain('**Transcript**')
    expect(text).toContain('**Session**')
    expect(text).toContain('| Shortcut | Action |')
    expect(text).toContain('Enter')
    expect(text).toContain('Send the message')
    expect(text).toContain('Ctrl+R')
    expect(text).toContain('Esc twice')
    expect(text).toContain('Rewind to an earlier conversation turn')
    expect(text).toContain('@ / ./ / ~/')
    expect(text).toContain('/copy')
    expect(text).toContain('/help')
    expect(text).not.toContain('/hotkeys')
    expect(text).toContain('PgUp')
    expect(text).toContain('Ctrl+O')
    expect(text).toContain('Alt+A')
    expect(text).toContain('subagent transcript')
    expect(text).toContain('Ctrl+P')
    expect(text).toContain('favorite model')
    expect(text).toContain('reasoning effort')
    expect(text).not.toContain('thinking')
    expect(text).not.toContain('Speech-to-text')
  })

  it('uses effective configurable bindings', () => {
    const text = formatHotkeysText({ ...DEFAULT_KEYBINDINGS, 'ctrl+g': 'retry' })
    expect(text).toContain('Alt+R / Ctrl+G')
  })

  it('keeps the default help subset compact and honors the paste binding', () => {
    const text = formatEssentialHotkeysText({ ...DEFAULT_KEYBINDINGS, 'ctrl+g': 'paste-clipboard' })
    expect(text.split('\n')).toHaveLength(9)
    expect(text).toContain('Ctrl+V / Ctrl+G')
    expect(text).toContain('Esc twice')
    expect(text).not.toContain('Ctrl+A')
  })

  it('names the effective bindings rather than fixed keys', () => {
    // The subset used to spell out Ctrl+R, PgUp/PgDn and Ctrl+O, so a rebound
    // action left the help text naming keys that no longer did anything. With
    // the defaults removed, only a lookup can still name the new binding.
    const rebound: Record<string, string> = { ...DEFAULT_KEYBINDINGS }
    delete rebound['ctrl+r']
    delete rebound['pageup']
    rebound['ctrl+g'] = 'search-history'
    rebound['ctrl+y'] = 'scroll-page-up'

    const text = formatEssentialHotkeysText(rebound)
    expect(text).toContain('Ctrl+G')
    expect(text).toContain('Ctrl+Y')
    expect(text).not.toContain('Ctrl+R')
    expect(text).not.toContain('PgUp')
    expect(text).toContain('Search the current transcript')
  })

  it('lists the transcript search, which had no entry in either help list', () => {
    expect(formatHotkeysText()).toContain('Ctrl+F')
    expect(formatEssentialHotkeysText()).toContain('Ctrl+F')
  })

  it('counts catalog rows after configurable bindings are merged by action', () => {
    expect(hotkeyCount()).toBeGreaterThan(0)
    expect(hotkeyCount({ ...DEFAULT_KEYBINDINGS, 'ctrl+g': 'retry' })).toBe(hotkeyCount())
  })
})
