import { describe, expect, it } from 'vitest'
import { DEFAULT_FOLD_DENSITY, FOLD_DENSITIES, foldPolicy, foldPolicyKey, isFoldDensity, resolveFoldDensity } from './fold-policy.ts'

describe('legacy transcript preferences', () => {
  it.each(FOLD_DENSITIES)('normalizes %s to the shared turn policy', foldDensity => {
    expect(resolveFoldDensity({ foldDensity, expandTools: true })).toBe(DEFAULT_FOLD_DENSITY)
    expect(foldPolicy(foldDensity)).toEqual(foldPolicy('standard'))
    expect(foldPolicyKey(foldPolicy(foldDensity))).toBe('turn')
  })
  it('accepts old configuration values without restoring old layouts', () => {
    expect(resolveFoldDensity({ expandTools: true })).toBe('standard')
    expect(resolveFoldDensity({})).toBe('standard')
    expect(isFoldDensity('verbose')).toBe(true)
    expect(isFoldDensity('invalid')).toBe(false)
  })
})
