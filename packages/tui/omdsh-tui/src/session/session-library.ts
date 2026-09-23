/** Product-owned ordering metadata for the durable Session Library. */

import type { TuiRecentSession } from '../definition.ts'
import { readJsonFile, writeJsonAtomic } from './json-file.ts'

interface SessionLibraryDocument {
  readonly pinned: readonly string[]
}

/**
 * One memoized Session Library read, reusable while its stored revision holds.
 * A null row records a log that produced no library row, so the next process
 * skips it without reading it again.
 */
export interface SessionRowMemo {
  readonly revision: string
  readonly row: TuiRecentSession | null
}

const RECENT_ROW_STATUSES: Record<string, true> = { done: true, interrupted: true, blocked: true, failed: true }

function validIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map(id => id.trim()))]
}

/** Accept one memoized row, or undefined for anything a stored document may have degraded into. */
function recentRowMemo(id: string, value: unknown): SessionRowMemo | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as { revision?: unknown; row?: unknown }
  if (typeof entry.revision !== 'string') return undefined
  if (entry.row === null) return { revision: entry.revision, row: null }
  if (typeof entry.row !== 'object') return undefined
  const candidate = entry.row as Record<string, unknown>
  if (candidate.id !== id || typeof candidate.title !== 'string' || typeof candidate.createdAt !== 'number') return undefined
  const accepted: TuiRecentSession = { id, title: candidate.title, createdAt: candidate.createdAt }
  if (typeof candidate.preview === 'string') accepted.preview = candidate.preview
  if (typeof candidate.updatedAt === 'number') accepted.updatedAt = candidate.updatedAt
  if (typeof candidate.eventCount === 'number') accepted.eventCount = candidate.eventCount
  const status = candidate.status
  if (typeof status === 'string' && RECENT_ROW_STATUSES[status] === true) {
    accepted.status = status as NonNullable<TuiRecentSession['status']>
  }
  return { revision: entry.revision, row: accepted }
}

/**
 * Read the memoized Session Library rows. A row is reusable only while the
 * persistence reports the same revision, so a stale or hand-edited document
 * costs one log read instead of a wrong label.
 * @param path - memo document the previous process wrote.
 * @returns the accepted rows, keyed by session id.
 */
export function readRecentRows(path: string): Map<string, SessionRowMemo> {
  const parsed = readJsonFile(path) as { rows?: unknown } | undefined
  const rows = parsed?.rows
  if (typeof rows !== 'object' || rows === null || Array.isArray(rows)) return new Map()
  const accepted = new Map<string, SessionRowMemo>()
  for (const [id, value] of Object.entries(rows as Record<string, unknown>)) {
    const memo = recentRowMemo(id, value)
    if (memo !== undefined) accepted.set(id, memo)
  }
  return accepted
}

/** Write the memo document atomically so the next process reuses these rows. */
export function writeRecentRows(path: string, rows: ReadonlyMap<string, SessionRowMemo>): void {
  writeJsonAtomic(path, { rows: Object.fromEntries(rows) })
}

export function readPinnedSessions(path: string): string[] {
  const parsed = readJsonFile(path) as Partial<SessionLibraryDocument> | undefined
  return validIds(parsed?.pinned)
}

export function writePinnedSessions(path: string, pinned: readonly string[]): void {
  writeJsonAtomic(path, { pinned: validIds(pinned) })
}

export function togglePinnedSession(pinned: readonly string[], id: string): string[] {
  return pinned.includes(id) ? pinned.filter(item => item !== id) : [id, ...pinned]
}

export function sortSessionRows<T extends { id: string; createdAt: number }>(rows: readonly T[], pinned: readonly string[]): T[] {
  const rank = new Map(pinned.map((id, index) => [id, index]))
  return [...rows].sort((left, right) => {
    const leftRank = rank.get(left.id)
    const rightRank = rank.get(right.id)
    if (leftRank !== undefined || rightRank !== undefined) {
      if (leftRank === undefined) return 1
      if (rightRank === undefined) return -1
      return leftRank - rightRank
    }
    return right.createdAt - left.createdAt
  })
}
