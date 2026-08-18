import { describe, expect, it } from 'vitest'
import { pickWelcomeTips, WELCOME_TIPS } from './welcome-tips.ts'

describe('pickWelcomeTips', () => {
  it('uses portable textual key names in the welcome catalog', () => {
    const keys = WELCOME_TIPS.map(tip => tip.key)

    expect(keys).toContain('Shift+Enter/Ctrl+J')
    expect(keys).toContain('PgUp/PgDn')
    expect(keys.join(' ')).not.toMatch(/[⌥⌘↵]/u)
  })

  it('samples distinct tips in deterministic random order', () => {
    const samples = [0.999, 0, 0.5]
    let index = 0
    const tips = pickWelcomeTips(() => samples[index++] ?? 0, 3)

    expect(tips).toHaveLength(3)
    expect(new Set(tips.map(tip => tip.key)).size).toBe(3)
    expect(tips[0]).toBe(WELCOME_TIPS.at(-1))
    expect(tips[1]).toBe(WELCOME_TIPS[0])
  })

  it('clamps the requested count to the catalog', () => {
    expect(pickWelcomeTips(() => 0, -1)).toEqual([])
    expect(pickWelcomeTips(() => 0, WELCOME_TIPS.length + 10)).toHaveLength(WELCOME_TIPS.length)
  })
})
