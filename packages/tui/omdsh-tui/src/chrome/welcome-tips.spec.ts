import { describe, expect, it } from 'vitest'
import { WELCOME_HINTS } from './welcome-tips.ts'

describe('WELCOME_HINTS', () => {
  it('teaches discovery, not the keys a reader learns once', () => {
    const keys = WELCOME_HINTS.map(hint => hint.key)
    expect(keys).toContain('/')
    expect(keys).toContain('@')
    // Cancel, submit, and exit are learned on the first minute of use; a header
    // that keeps repeating them spends its only line on nothing new.
    expect(keys).not.toContain('Esc')
    expect(keys).not.toContain('Enter')
    expect(keys).not.toContain('Ctrl+C')
  })

  it('stays short enough to read at a glance', () => {
    // The whole line has to fit beside the lockup it sits under; four entries is
    // what a header can carry without becoming a manual.
    expect(WELCOME_HINTS.length).toBeLessThanOrEqual(4)
    for (const hint of WELCOME_HINTS) {
      expect(hint.key.length).toBeGreaterThan(0)
      expect(hint.text.split(/\s+/u).length).toBeLessThanOrEqual(2)
    }
  })

  it('uses portable textual key names', () => {
    const keys = WELCOME_HINTS.map(hint => hint.key).join(' ')
    expect(keys).not.toMatch(/[⌥⌘↵]/u)
  })
})
