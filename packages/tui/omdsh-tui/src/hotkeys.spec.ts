import { describe, expect, it } from 'vitest'
import { formatHotkeysText } from './hotkeys.ts'

describe('formatHotkeysText', () => {
  it('lists the bindings this TUI implements', () => {
    const text = formatHotkeysText()
    expect(text).toContain('Keyboard shortcuts')
    expect(text).toContain('Enter')
    expect(text).toContain('submit')
    expect(text).toContain('Ctrl+R')
    expect(text).toContain('@ ./ ~/')
    expect(text).toContain('/copy')
    expect(text).toContain('PgUp')
    expect(text).toContain('Ctrl+O')
    expect(text).toContain('mouse wheel')
    expect(text).not.toContain('thinking')
    expect(text).not.toContain('Speech-to-text')
  })
})
