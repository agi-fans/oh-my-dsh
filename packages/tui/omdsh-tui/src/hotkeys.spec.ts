import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYBINDINGS } from './keybindings-config.ts'
import { formatHotkeysText, hotkeyCount, renderHotkeysPanel } from './hotkeys.ts'
import { createTheme } from './theme.ts'
import { stripAnsi, visibleWidth } from './width.ts'

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
    expect(text).toContain('@ / ./ / ~/')
    expect(text).toContain('/copy')
    expect(text).toContain('PgUp')
    expect(text).toContain('Ctrl+O')
    expect(text).toContain('Mouse wheel')
    expect(text).not.toContain('thinking')
    expect(text).not.toContain('Speech-to-text')
  })

  it('uses effective configurable bindings', () => {
    const text = formatHotkeysText({ ...DEFAULT_KEYBINDINGS, 'ctrl+g': 'retry' })
    expect(text).toContain('Alt+R / Ctrl+G')
  })

  it('renders like the tools catalog without a second outer frame', () => {
    const theme = createTheme(false, false)
    const lines = renderHotkeysPanel(DEFAULT_KEYBINDINGS, theme, 72)
    expect(lines.every(line => visibleWidth(line) <= 72)).toBe(true)
    expect(stripAnsi(lines[0] ?? '')).toBe(` Keyboard Shortcuts · ${hotkeyCount()} bindings`)
    expect(stripAnsi(lines[0] ?? '')).not.toMatch(/[╭│╰]/u)
    expect(lines[1]).toBe('')
    expect(lines.join('\n')).toContain('Navigation')
    expect(lines.join('\n')).toContain('Shortcut')
    expect(lines.filter(line => stripAnsi(line).trimStart().startsWith('╭'))).toHaveLength(4)
    expect(lines.filter(line => stripAnsi(line).trimStart().startsWith('╰'))).toHaveLength(4)
  })
})
