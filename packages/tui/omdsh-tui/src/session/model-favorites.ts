/** Durable, product-owned model favorites used by keyboard model cycling. */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface FavoriteModel {
  provider: string
  model: string
  reasoningEffort?: string
}

const MAX_FAVORITES = 16

function favorite(value: unknown): FavoriteModel | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (typeof row['provider'] !== 'string' || row['provider'] === '') return undefined
  if (typeof row['model'] !== 'string' || row['model'] === '') return undefined
  return {
    provider: row['provider'],
    model: row['model'],
    ...(typeof row['reasoningEffort'] === 'string' && row['reasoningEffort'] !== ''
      ? { reasoningEffort: row['reasoningEffort'] }
      : {}),
  }
}

function key(value: Pick<FavoriteModel, 'provider' | 'model'>): string {
  return `${value.provider}\0${value.model}`
}

export function readModelFavorites(path: string): FavoriteModel[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const result: FavoriteModel[] = []
    for (const value of parsed) {
      const entry = favorite(value)
      if (entry === undefined || seen.has(key(entry))) continue
      seen.add(key(entry))
      result.push(entry)
      if (result.length >= MAX_FAVORITES) break
    }
    return result
  } catch {
    return []
  }
}

export function writeModelFavorites(path: string, favorites: readonly FavoriteModel[]): void {
  const normalized = readDistinct(favorites)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, JSON.stringify(normalized, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}

export function addModelFavorite(favorites: readonly FavoriteModel[], entry: FavoriteModel): FavoriteModel[] {
  return [...favorites.filter(item => key(item) !== key(entry)), entry].slice(-MAX_FAVORITES)
}

export function removeModelFavorite(favorites: readonly FavoriteModel[], entry: Pick<FavoriteModel, 'provider' | 'model'>): FavoriteModel[] {
  return favorites.filter(item => key(item) !== key(entry))
}

export function updateFavoriteEffort(favorites: readonly FavoriteModel[], entry: FavoriteModel): FavoriteModel[] {
  return favorites.map(item => key(item) === key(entry) ? entry : item)
}

function readDistinct(favorites: readonly FavoriteModel[]): FavoriteModel[] {
  const seen = new Set<string>()
  const result: FavoriteModel[] = []
  for (const value of favorites) {
    const entry = favorite(value)
    if (entry === undefined || seen.has(key(entry))) continue
    seen.add(key(entry))
    result.push(entry)
  }
  return result.slice(-MAX_FAVORITES)
}
