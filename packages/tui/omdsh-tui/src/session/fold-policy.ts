/** Compatibility for stored transcript preferences from earlier versions. */
export const FOLD_DENSITIES = ['compact', 'standard', 'detailed', 'verbose'] as const
export type FoldDensity = typeof FOLD_DENSITIES[number]

export const DEFAULT_FOLD_DENSITY: FoldDensity = 'standard'
