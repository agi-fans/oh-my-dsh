import { describe, expect, it, vi } from 'vitest'
import { checkForUpdate, type UpdateCheckCache } from './update-check.ts'

describe('update check', () => {
  it('reuses a fresh cache and refreshes a stale cache without blocking on prior results', async () => {
    let cache: UpdateCheckCache | undefined = { checkedAt: 900, latestVersion: '0.3.1' }
    const fetchLatest = vi.fn(async () => '0.3.2')
    const common = {
      currentVersion: '0.3.0',
      maxAgeMs: 200,
      readCache: async (): Promise<UpdateCheckCache | undefined> => cache,
      writeCache: async (next: UpdateCheckCache): Promise<void> => { cache = next },
      fetchLatest,
    }

    expect(await checkForUpdate({ ...common, now: 1_000 })).toBe('0.3.1')
    expect(fetchLatest).not.toHaveBeenCalled()
    expect(await checkForUpdate({ ...common, now: 1_101 })).toBe('0.3.2')
    expect(fetchLatest).toHaveBeenCalledOnce()
    expect(cache).toEqual({ checkedAt: 1_101, latestVersion: '0.3.2' })
  })
})
