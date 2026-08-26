import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addModelFavorite, readModelFavorites, removeModelFavorite, updateFavoriteEffort, writeModelFavorites } from './model-favorites.ts'

describe('model favorites', () => {
  it('loads only distinct valid entries and tolerates a corrupt file', () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-model-favorites-'))
    const path = join(root, 'favorites.json')
    writeFileSync(path, JSON.stringify([
      { provider: 'deepseek-official', model: 'flash' },
      { provider: 'deepseek-official', model: 'flash' },
      { provider: '', model: 'invalid' },
    ]))
    expect(readModelFavorites(path)).toEqual([{ provider: 'deepseek-official', model: 'flash' }])
    writeFileSync(path, '{')
    expect(readModelFavorites(path)).toEqual([])
  })

  it('adds, updates, removes, and atomically persists favorites', () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-model-favorites-'))
    const path = join(root, 'nested', 'favorites.json')
    const first = { provider: 'deepseek-official', model: 'flash' }
    const second = { provider: 'openai', model: 'gpt', reasoningEffort: 'high' }
    let favorites = addModelFavorite([], first)
    favorites = addModelFavorite(favorites, second)
    favorites = updateFavoriteEffort(favorites, { ...first, reasoningEffort: 'max' })
    favorites = removeModelFavorite(favorites, second)
    writeModelFavorites(path, favorites)

    expect(readModelFavorites(path)).toEqual([{ ...first, reasoningEffort: 'max' }])
    expect(readFileSync(path, 'utf8').endsWith('\n')).toBe(true)
  })
})
