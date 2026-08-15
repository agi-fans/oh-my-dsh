/**
 * Status-line customization shared by settings, persistence, and rendering.
 * @module @omdsh/tui/status-config
 */

/** Stable telemetry groups users can show, hide, and reorder. */
export const STATUS_GROUP_IDS = ['context', 'cache', 'tokens', 'speed', 'durations', 'counts'] as const
export type StatusGroupId = (typeof STATUS_GROUP_IDS)[number]

export const STATUS_LABEL_STYLES = ['compact', 'full'] as const
export type StatusLabelStyle = (typeof STATUS_LABEL_STYLES)[number]

/** User-owned status-line layout. Missing `groups` are hidden; `order` retains their slots. */
export interface StatusBarConfig {
  enabled: boolean
  labels: StatusLabelStyle
  groups: StatusGroupId[]
  /** Complete visual order, including hidden groups. Absent in legacy settings. */
  order?: StatusGroupId[]
}

/** Normalized layout always carries a complete order. */
export interface ResolvedStatusBarConfig extends StatusBarConfig {
  order: StatusGroupId[]
}

/** Legacy value accepted while existing settings documents migrate. */
export const STATUS_PRESETS = ['minimal', 'compact', 'full'] as const
export type StatusPreset = (typeof STATUS_PRESETS)[number]

export const DEFAULT_STATUS_GROUPS: readonly StatusGroupId[] = STATUS_GROUP_IDS

/** Return a fresh default so callers can safely replace its group list. */
export function defaultStatusBarConfig(): ResolvedStatusBarConfig {
  return {
    enabled: true,
    labels: 'compact',
    groups: [...DEFAULT_STATUS_GROUPS],
    order: [...DEFAULT_STATUS_GROUPS],
  }
}

function isStatusGroupId(value: unknown): value is StatusGroupId {
  return typeof value === 'string' && STATUS_GROUP_IDS.includes(value as StatusGroupId)
}

function isStatusLabelStyle(value: unknown): value is StatusLabelStyle {
  return typeof value === 'string' && STATUS_LABEL_STYLES.includes(value as StatusLabelStyle)
}

/**
 * Normalize persisted input at the single configuration seam. Invalid and
 * duplicate groups disappear; legacy presets retain their previous meaning.
 */
export function resolveStatusBarConfig(
  config?: Partial<StatusBarConfig>,
  legacyPreset?: StatusPreset,
): ResolvedStatusBarConfig {
  if (config === undefined) {
    const fallback = defaultStatusBarConfig()
    if (legacyPreset === 'minimal') fallback.enabled = false
    if (legacyPreset === 'full') fallback.labels = 'full'
    return fallback
  }

  const groups = config.groups === undefined
    ? [...DEFAULT_STATUS_GROUPS]
    : [...new Set(config.groups.filter(isStatusGroupId))]
  const explicitOrder = config.order?.filter(isStatusGroupId)
  const ordered = [...new Set(explicitOrder === undefined ? groups : explicitOrder)]
  const order = [...ordered, ...STATUS_GROUP_IDS.filter(id => !ordered.includes(id))]
  return {
    enabled: config.enabled ?? true,
    labels: isStatusLabelStyle(config.labels) ? config.labels : 'compact',
    groups,
    order,
  }
}
