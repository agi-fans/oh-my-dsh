import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYBINDINGS } from '../input/keybindings-config.ts'
import { AGENT_HUB_HOTKEYS } from './agent-hub.ts'
import { COPY_SELECTOR_HOTKEYS } from './copy-selector.ts'
import { HISTORY_SEARCH_HOTKEYS } from './history-search.ts'
import { PROMPT_SELECTOR_HOTKEYS } from './prompt-selector.ts'
import { SETTINGS_HOTKEYS } from './settings-list.ts'
import { TRAJECTORY_HOTKEYS } from './trajectory.ts'
import { TRANSCRIPT_SEARCH_HOTKEYS } from './transcript-search.ts'
import { formatEssentialHotkeysText, formatHotkeysText, hotkeyCount, type HotkeyRow } from './hotkeys.ts'

/**
 * Keys each overlay handler reacts to, transcribed from its event branches. The
 * lists are pinned so dropping a catalog row, or an overlay from the `/help`
 * Overlays table, fails here instead of shrinking both sides of the check.
 */
const OVERLAY_CATALOGS: readonly { label: string; rows: readonly HotkeyRow[]; keys: readonly string[] }[] = [
  {
    label: 'Settings',
    rows: SETTINGS_HOTKEYS,
    keys: ['↑↓', '←→', 'Space', 'Enter', 'Tab / Shift+Tab', 'Home / End', 'Esc', 'Ctrl+C', '↑↓', '←→', 'Enter / Esc'],
  },
  {
    label: 'Copy picker',
    rows: COPY_SELECTOR_HOTKEYS,
    keys: ['↑↓', 'Tab / Shift+Tab', 'PgUp / PgDn', 'Home / End', 'Enter', 'Space', 'Esc / Ctrl+C'],
  },
  {
    label: 'Agent Hub',
    rows: AGENT_HUB_HOTKEYS,
    keys: ['↑↓', 'Home / End', 'Enter', 'Tab', '← / →', 'PgUp / PgDn', 'T', 'Esc / Ctrl+C'],
  },
  {
    label: 'History search',
    rows: HISTORY_SEARCH_HOTKEYS,
    keys: [
      'Text', '↑↓', 'Tab / Shift+Tab', 'PgUp / PgDn', 'Home / End', 'Enter', 'Esc / Ctrl+C',
      '← / Ctrl+B', '→ / Ctrl+F', 'Ctrl+A', 'Ctrl+E', 'Backspace', 'Delete / Ctrl+D',
      'Ctrl+W / Alt+Backspace', 'Ctrl+U', 'Ctrl+K',
    ],
  },
  {
    label: 'Transcript search',
    rows: TRANSCRIPT_SEARCH_HOTKEYS,
    keys: ['Text', 'Backspace', 'Ctrl+N / Ctrl+P', 'Enter', 'n/N', '/', 'Esc / Ctrl+C'],
  },
  {
    label: 'Trajectory',
    rows: TRAJECTORY_HOTKEYS,
    keys: [
      '↑↓', 'Home / End', 'PgUp / PgDn', 'Enter', 'Tab / ←→', '/', 'n/N',
      'Ctrl+N / Ctrl+P', 't', 'c', 'Text', 'Backspace', 'Esc / Ctrl+C',
    ],
  },
  {
    label: 'Prompts',
    rows: PROMPT_SELECTOR_HOTKEYS,
    keys: [
      'Text', '↑↓', 'Tab / Shift+Tab', '←→', 'PgUp / PgDn', 'Home / End', 'Space',
      'Enter', 'Enter', 'Ctrl+J', 'Esc', 'Esc', 'Ctrl+C',
    ],
  },
]

describe('overlay key catalogs', () => {
  it('keeps every overlay key in the `/help` Overlays table', () => {
    const text = formatHotkeysText()
    for (const overlay of OVERLAY_CATALOGS) {
      for (const row of overlay.rows) {
        // The rendered row carries both cells, so a key cannot pass by matching
        // another section, and an overlay cannot silently lose its rows.
        expect(text, `${overlay.label} is missing ${row.keys}`).toContain(`\`${row.keys}\` | ${overlay.label}: ${row.action}`)
      }
    }
  })

  it('pins each catalog to the keys its handler accepts', () => {
    for (const overlay of OVERLAY_CATALOGS) {
      expect(overlay.rows.map(row => row.keys), overlay.label).toEqual(overlay.keys)
    }
  })
})

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
