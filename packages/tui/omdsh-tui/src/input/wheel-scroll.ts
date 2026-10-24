/**
 * Wheel scrolling that follows one physical gesture instead of counting
 * events. Terminals disagree about what a "wheel event" is: a high-resolution
 * device can split one notch into several reports a few milliseconds apart,
 * while a classic mouse sends exactly one, and one terminal read can also
 * batch several real notches together. A notch keeps the familiar three lines;
 * a near-simultaneous follow-up report moves one line, so a split notch no
 * longer triples its distance while a batched spin still travels; and a fast
 * spin earns up to twice the distance per notch. Fractions carry into the next
 * event so the acceleration stays smooth.
 * @module @agi-fans/dsh-tui/wheel-scroll
 */

/** Lines one notch moves at a deliberate pace, the distance the TUI always used. */
const BASE_LINES = 3
/** Reports closer than this to the previous one are follow-ups, not new notches. */
const BURST_GAP_MS = 5
/** Lines a follow-up report moves. */
const BURST_LINES = 1
/** A pause this long, or a change of direction, ends the gesture. */
const GESTURE_GAP_MS = 200
/** Notch spacing at or below which a spin reaches full acceleration. */
const FAST_GAP_MS = 40
/** Notch spacing at or above which a spin is deliberate and not accelerated. */
const SLOW_GAP_MS = 120
/** Most a fast spin may multiply one notch's distance. */
const MAX_ACCELERATION = 2

/** Accumulated state of one wheel gesture. */
export interface WheelGesture {
  /** When the most recent report arrived. */
  countedAt: number
  /** Direction of the gesture: -1 up, 1 down, 0 idle. */
  direction: -1 | 0 | 1
  /** Fractional lines not yet scrolled, signed like the direction. */
  carry: number
}

/** The gesture to start with. */
export const IDLE_WHEEL: WheelGesture = { countedAt: 0, direction: 0, carry: 0 }

/**
 * How far one wheel event should scroll.
 * @param gesture - state returned by the previous call.
 * @param now - this event's timestamp in milliseconds.
 * @param direction - `-1` for up, `1` for down.
 * @returns the signed line count to move and the state to carry into the next event.
 */
export function wheelStep(gesture: WheelGesture, now: number, direction: -1 | 1): { lines: number; gesture: WheelGesture } {
  const gap = now - gesture.countedAt
  const fresh = gesture.direction !== direction || gap > GESTURE_GAP_MS
  // A follow-up report: part of a split notch, or one of several batched
  // notches. Either way it moves a single line, without acceleration.
  if (!fresh && gap < BURST_GAP_MS) {
    return { lines: direction * BURST_LINES, gesture: { countedAt: now, direction, carry: gesture.carry } }
  }
  const acceleration = fresh ? 1 : 1 + (MAX_ACCELERATION - 1)
    * Math.max(0, Math.min(1, (SLOW_GAP_MS - gap) / (SLOW_GAP_MS - FAST_GAP_MS)))
  const total = (fresh ? 0 : gesture.carry) + direction * BASE_LINES * acceleration
  const lines = Math.trunc(total)
  return { lines, gesture: { countedAt: now, direction, carry: total - lines } }
}
