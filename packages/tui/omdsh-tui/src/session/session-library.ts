/** Product-owned ordering metadata for the durable Session Library. */

import { readJsonFile, writeJsonAtomic } from './json-file.ts'

interface SessionLibraryDocument {
  readonly pinned: readonly string[]
}

function validIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map(id => id.trim()))]
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
