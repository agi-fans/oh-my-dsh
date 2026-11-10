import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYBINDINGS } from '../input/keybindings-config.ts'
import { useWindowsKeybindings } from '../input/key-platform.ts'
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
    keys: ['↑↓', '←→', 'Space', 'Enter', 'Tab / Shift+Tab', 'Home / End', '/ or Text', 'Backspace / Ctrl+U', 'Ctrl+R', 'Esc', 'Ctrl+C'],
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
      '↑↓', 'Home / End', '↑↓ / PgUp / PgDn', 'Enter', '←→', 'Tab',
      'Ctrl+N / Ctrl+P', 'Space', 'f', 'e', 's', 'y', '/', 'n/N',
      'Ctrl+N / Ctrl+P', 't', 'c', 'Text', 'Backspace', 'Esc / Ctrl+C',
    ],
  },
  {
    label: 'Prompts',
    rows: PROMPT_SELECTOR_HOTKEYS,
    keys: [
      'Text', '↑↓', 'Tab / Shift+Tab', '←→', 'PgUp / PgDn', 'Home / End', 'Space', 'Ctrl+G',
      'Enter', 'Enter', 'Ctrl+J', 'Esc', 'Esc', 'Ctrl+C', 'Ctrl+T', 'Ctrl+S',
    ],
  },
]

describe('overlay key catalogs', () => {
  it('keeps every overlay key in the `/help` Overlays table', () => {
    const text = formatHotkeysText()
    for (const overlay of OVERLAY_CATALOGS) {
      expect(text).toContain(`## ${overlay.label}`)
      for (const row of overlay.rows) {
        // The rendered row carries both cells, so a key cannot pass by matching
        // another section, and an overlay cannot silently lose its rows.
        expect(text, `${overlay.label} is missing ${row.keys}`).toContain(`\`${row.keys}\` | ${row.action}`)
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
    expect(text).toContain('## Navigation')
    expect(text).toContain('## Editing')
    expect(text).toContain('## Transcript')
    expect(text).toContain('## Session')
    expect(text).toContain('| Shortcut | Action |')
    expect(text).toContain('Enter')
    expect(text).toContain('Send the message')
    expect(text).toContain('Ctrl+R')
    expect(text).toContain('Esc twice')
    expect(text).toContain('Show or hide thinking')
    expect(text).toContain('Queue the draft for after the active turn')
    expect(text).toContain('Browse conversation turns and branches')
    expect(text).toContain('@ / ./ / ~/')
    expect(text).toContain('/copy')
    expect(text).toContain('/help')
    expect(text).not.toContain('/hotkeys')
    expect(text).toContain('PgUp')
    expect(text).toContain('Ctrl+O')
    expect(text).toContain('Ctrl+P')
    expect(text).toContain('favorite model')
    expect(text).toContain('reasoning effort')
    expect(text).toContain('Comparison / current file')
    // Thinking is now a first-class control, so the catalog names it.
    expect(text).toContain('Show or hide thinking')
    expect(text).not.toContain('Speech-to-text')
  })

  it('uses effective configurable bindings', () => {
    const text = formatHotkeysText({ ...DEFAULT_KEYBINDINGS, 'ctrl+g': 'retry' })
    // The shipped chord keeps its catalog position and the user's chord follows.
    expect(text).toContain('Alt+R / Ctrl+G')
  })

  it.each([false, true])('keeps the help subset compact with an extra Alt paste binding=%s', extraAltPaste => {
    const text = formatEssentialHotkeysText({ ...DEFAULT_KEYBINDINGS, 'ctrl+g': 'paste-clipboard', ...(extraAltPaste ? { 'ctrl+alt+v': 'paste-clipboard' } : {}) })
    expect(text.split('\n')).toHaveLength(16)
    expect(text).toContain('Send with the other behavior while busy')
    expect(text).toContain('Alt+M')
    expect(text).toContain('Alt+O')
    const paste = text.split('\n').find(line => line.includes('Paste clipboard'))!
    expect(paste).toContain('Ctrl+V')
    expect(paste).toContain('Ctrl+G')
    if (useWindowsKeybindings() || extraAltPaste) expect(paste).toContain('Ctrl+Alt+V')
    if (!useWindowsKeybindings() && process.platform === 'darwin') expect(paste).toContain('Cmd+V')
    expect(text).toContain('Esc twice')
    expect(text).toContain('Show or hide thinking')
    expect(text).not.toMatch(/(?:`| \/ )Ctrl\+A(?:`| \/ )/u)
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

  it('orders newline hints by terminal support and hides overridden editor keys', () => {
    expect(formatEssentialHotkeysText(DEFAULT_KEYBINDINGS, false)).toContain('Ctrl+J / Shift+Enter')
    expect(formatEssentialHotkeysText(DEFAULT_KEYBINDINGS, true)).toContain('Shift+Enter / Ctrl+J')
    const remapped = { ...DEFAULT_KEYBINDINGS, 'ctrl+j': 'retry', 'super+left': 'tool-actions' } as const
    expect(formatHotkeysText(remapped, false)).toContain('`Shift+Enter` | Insert a new line')
    expect(formatHotkeysText(remapped)).toContain('`Ctrl+A / Home` | Move to the start of the line')
  })

  it('lists the transcript search under the chord it now teaches', () => {
    // Ctrl+F is a migration alias; the catalog teaches Ctrl+Shift+F so the
    // composer keeps its own forward-character binding.
    expect(formatHotkeysText()).toContain('Ctrl+Shift+F')
    expect(formatEssentialHotkeysText()).toContain('Ctrl+Shift+F')
    expect(formatEssentialHotkeysText()).not.toContain('Ctrl+F ')
  })

  it('counts catalog rows after configurable bindings are merged by action', () => {
    expect(hotkeyCount()).toBeGreaterThan(0)
    expect(hotkeyCount({ ...DEFAULT_KEYBINDINGS, 'ctrl+g': 'retry' })).toBe(hotkeyCount())
  })
})
