/**
 * Fold density contract.
 *
 * The density is a reading preference, not a rendering question: four names in
 * `/settings` resolve to four booleans, and the renderer only ever reads those
 * booleans. These tests pin the table itself — that every rung says something
 * different, that no rung strands `Ctrl+O` with nothing to open, and that a
 * document written before the setting existed keeps the shape its author chose.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FOLD_DENSITY,
  FOLD_DENSITIES,
  FOLD_DENSITY_COPY,
  foldPolicy,
  foldPolicyKey,
  isFoldDensity,
  resolveFoldDensity,
} from './fold-policy.ts'

describe('fold density table', () => {
  it('resolves every density to a complete policy', () => {
    for (const density of FOLD_DENSITIES) {
      expect(foldPolicy(density)).toEqual({
        groups: expect.any(Boolean),
        tools: expect.any(Boolean),
        reasoning: expect.any(Boolean),
        detail: expect.any(Boolean),
        subject: expect.any(Boolean),
      })
    }
  })

  it('gives each rung its own shape', () => {
    // Four rungs that collapse into two would be a two-state switch wearing
    // four labels, which is worse than one honest toggle.
    const shapes = FOLD_DENSITIES.map(density => foldPolicyKey(foldPolicy(density)))
    expect(new Set(shapes).size).toBe(FOLD_DENSITIES.length)
  })

  it('leaves something folded at every rung, so ctrl+o always has a target', () => {
    for (const density of FOLD_DENSITIES) {
      const policy = foldPolicy(density)
      expect(policy.groups || policy.tools || policy.reasoning).toBe(true)
    }
  })

  it('opens the work one surface at a time on the way up', () => {
    // The work is the run and the calls. Every rung from `standard` up opens
    // more of it and never re-folds what the rung below already showed, so the
    // order means something to a reader scrolling the list.
    const work = (density: typeof DEFAULT_FOLD_DENSITY): boolean[] =>
      [foldPolicy(density).groups, foldPolicy(density).tools]
    expect(work('standard')).toEqual([true, true])
    expect(work('detailed')).toEqual([false, true])
    expect(work('verbose')).toEqual([false, false])
  })

  it('folds the thinking again at the top rung, and says so', () => {
    // `detailed` reads the reasoning in full and `verbose` does not. That step
    // is the one place the rungs are not a ladder, it is deliberate, and the
    // settings copy tells the reader before they pick.
    expect(foldPolicy('detailed').reasoning).toBe(false)
    expect(foldPolicy('verbose').reasoning).toBe(true)
    expect(FOLD_DENSITY_COPY.verbose).toContain('the thinking stays folded')
  })

  it('is the shipped default', () => {
    expect(DEFAULT_FOLD_DENSITY).toBe('standard')
    expect(foldPolicy(DEFAULT_FOLD_DENSITY))
      .toEqual({ groups: true, tools: true, reasoning: true, detail: true, subject: true })
  })

  it('separates the two quietest rungs on the row specifics alone', () => {
    // A rung that only differs somewhere the reader rarely looks is a rung that
    // does nothing in the case they meet most, so the two quiet rungs have to
    // part ways on what a surviving row says.
    const compact = foldPolicy('compact')
    const standard = foldPolicy('standard')
    expect(compact.detail).toBe(false)
    expect(standard.detail).toBe(true)
    expect(compact.subject).toBe(false)
    expect(standard.subject).toBe(true)
    expect(compact.groups).toBe(standard.groups)
    expect(compact.tools).toBe(standard.tools)
    expect(compact.reasoning).toBe(standard.reasoning)
  })

  it('describes every rung in the words the settings row shows', () => {
    for (const density of FOLD_DENSITIES) {
      expect(FOLD_DENSITY_COPY[density]).not.toBe('')
    }
    expect(new Set(Object.values(FOLD_DENSITY_COPY)).size).toBe(FOLD_DENSITIES.length)
  })

  it('keys two different policies apart', () => {
    expect(foldPolicyKey(foldPolicy('compact'))).not.toBe(foldPolicyKey(foldPolicy('standard')))
    expect(foldPolicyKey(foldPolicy('detailed'))).not.toBe(foldPolicyKey(foldPolicy('verbose')))
  })

  it('narrows only a real density name', () => {
    expect(isFoldDensity('compact')).toBe(true)
    expect(isFoldDensity('verbose')).toBe(true)
    expect(isFoldDensity('expanded')).toBe(false)
    expect(isFoldDensity('')).toBe(false)
  })
})

describe('resolveFoldDensity', () => {
  it('takes the density the document asks for', () => {
    expect(resolveFoldDensity({ foldDensity: 'detailed' })).toBe('detailed')
  })

  it('prefers that density over a leftover expandTools flag', () => {
    // Once the reader has chosen a rung, the flag they can no longer set must
    // not keep steering the transcript from under them.
    expect(resolveFoldDensity({ foldDensity: 'compact', expandTools: true })).toBe('compact')
  })

  it('carries a document that only has the old flag into the rung that says the same thing', () => {
    expect(resolveFoldDensity({ expandTools: true })).toBe('verbose')
  })

  it('defaults a document that predates both', () => {
    expect(resolveFoldDensity({})).toBe(DEFAULT_FOLD_DENSITY)
    expect(resolveFoldDensity({ expandTools: false })).toBe(DEFAULT_FOLD_DENSITY)
  })
})
