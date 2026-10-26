/** Compact English relative time shared by session discovery surfaces. */

export function formatRelativeAge(timestamp: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

/**
 * Compact English delay until an instant still to come: `in 12m`, `in 2h`.
 *
 * The mirrored question of {@link formatRelativeAge}, and it exists because a
 * reminder is read forward: "next 2026-10-27 03:15 UTC" makes the reader do the
 * subtraction that the surface already knows how to do. A timestamp that has
 * already passed is reported as `due now` rather than as a negative delay, since
 * a reminder whose time arrived is late, not early.
 */
export function formatRelativeUntil(timestamp: number, now = Date.now()): string {
  const seconds = Math.floor((timestamp - now) / 1000)
  if (seconds <= 0) return 'due now'
  if (seconds < 60) return `in ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `in ${hours}h` : `in ${Math.floor(hours / 24)}d`
}
