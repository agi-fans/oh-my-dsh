/** Compatibility for stored transcript preferences from earlier versions. */
export const FOLD_DENSITIES = ['compact', 'standard', 'detailed', 'verbose'] as const
export type FoldDensity = typeof FOLD_DENSITIES[number]

/** @deprecated Turns now use one presentation policy. */
export interface FoldPolicy {
  groups: boolean
  tools: boolean
  reasoning: boolean
  detail: boolean
  subject: boolean
}

export const DEFAULT_FOLD_DENSITY: FoldDensity = 'standard'
const TURN_POLICY: FoldPolicy = { groups: true, tools: true, reasoning: false, detail: false, subject: true }

/** All legacy values resolve to the current turn presentation. */
export function foldPolicy(_density: FoldDensity): FoldPolicy { return TURN_POLICY }

export function isFoldDensity(value: string): value is FoldDensity {
  return (FOLD_DENSITIES as readonly string[]).includes(value)
}

/** Old preferences remain readable but no longer select a different layout. */
export function resolveFoldDensity(_prefs: { foldDensity?: FoldDensity; expandTools?: boolean }): FoldDensity {
  return DEFAULT_FOLD_DENSITY
}

export function foldPolicyKey(_policy: FoldPolicy): string { return 'turn' }
