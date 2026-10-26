import { describe, expect, it } from 'vitest'
import { formatRelativeUntil } from './relative-time.ts'


describe('formatRelativeUntil', () => {
  const now = Date.UTC(2026, 9, 27, 12, 0, 0)

  it('reads forward in the unit a reader would use', () => {
    expect(formatRelativeUntil(now + 30_000, now)).toBe('in 30s')
    expect(formatRelativeUntil(now + 12 * 60_000, now)).toBe('in 12m')
    expect(formatRelativeUntil(now + 2 * 3_600_000, now)).toBe('in 2h')
    expect(formatRelativeUntil(now + 3 * 86_400_000, now)).toBe('in 3d')
  })

  it('calls a passed instant due rather than a negative delay', () => {
    // A reminder whose time arrived is late, not early.
    expect(formatRelativeUntil(now - 1_000, now)).toBe('due now')
    expect(formatRelativeUntil(now, now)).toBe('due now')
  })

  it('floors instead of rounding, so it never overstates the wait', () => {
    expect(formatRelativeUntil(now + 59_900, now)).toBe('in 59s')
    expect(formatRelativeUntil(now + 119_000, now)).toBe('in 1m')
  })
})
