import { describe, expect, it } from 'vitest'
import { IDLE_WHEEL, terminalAcceleratesWheel, wheelStep, type WheelGesture } from './wheel-scroll.ts'

/** Feed a sequence of timestamps in one direction and sum the scrolled lines. */
function spin(times: readonly number[], direction: -1 | 1 = 1, start: WheelGesture = IDLE_WHEEL): { lines: number; gesture: WheelGesture } {
  let gesture = start
  let lines = 0
  for (const at of times) {
    const step = wheelStep(gesture, at, direction)
    gesture = step.gesture
    lines += step.lines
  }
  return { lines, gesture }
}

describe('wheel scrolling', () => {
  it('keeps three lines for one notch of a classic mouse', () => {
    expect(wheelStep(IDLE_WHEEL, 1_000, 1).lines).toBe(3)
    expect(wheelStep(IDLE_WHEEL, 1_000, -1).lines).toBe(-3)
  })

  it('moves one line per near-simultaneous follow-up report', () => {
    // A notch split into four reports used to move twelve lines.
    expect(spin([1_000, 1_001, 1_002, 1_004]).lines).toBe(6)
    // A batch of reports read together still travels.
    expect(spin(Array.from({ length: 31 }, () => 1_000)).lines).toBe(33)
  })

  it('does not accelerate a deliberate scroll', () => {
    expect(spin([1_000, 1_150, 1_300]).lines).toBe(9)
  })

  it('moves further per notch when a spin speeds up, up to the cap', () => {
    const fast = spin([1_000, 1_030, 1_060, 1_090]).lines
    expect(fast).toBeGreaterThan(12)
    expect(fast).toBeLessThanOrEqual(3 + 3 * 6)
  })

  it('carries fractions so a mid-speed spin stays smooth', () => {
    // An 80ms spacing sits halfway between slow and fast: 4.5 lines per notch.
    expect(spin([1_000, 1_080, 1_160]).lines).toBe(3 + 9)
  })

  it('starts a fresh gesture after a pause or a change of direction', () => {
    const first = spin([1_000, 1_030])
    expect(wheelStep(first.gesture, 1_500, 1).lines).toBe(3)
    expect(wheelStep(first.gesture, 1_040, -1).lines).toBe(-3)
  })
})

describe('terminal-accelerated wheels', () => {
  it('keeps a flat three lines per event at any gap', () => {
    for (const gap of [0, 16, 300]) {
      const gesture: WheelGesture = { countedAt: 1_000 - gap, direction: 1, carry: 0.5 }
      const step = wheelStep(gesture, 1_000, 1, true)
      expect(step.lines).toBe(3)
      expect(step.gesture).toEqual(IDLE_WHEEL)
    }
  })

  it('detects local macOS terminals as already accelerated', () => {
    expect(terminalAcceleratesWheel({}, 'darwin')).toBe(true)
    expect(terminalAcceleratesWheel({ SSH_TTY: '/dev/ttys1' }, 'darwin')).toBe(false)
    expect(terminalAcceleratesWheel({ SSH_CONNECTION: 'x' }, 'darwin')).toBe(false)
    expect(terminalAcceleratesWheel({ SSH_CLIENT: 'x' }, 'darwin')).toBe(false)
    expect(terminalAcceleratesWheel({}, 'linux')).toBe(false)
  })
})
