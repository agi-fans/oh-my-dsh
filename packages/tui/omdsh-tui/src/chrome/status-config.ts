/**
 * Status-line customization shared by settings, persistence, and rendering.
 * @module @agi-fans/dsh-tui/status-config
 */

/** Stable telemetry groups users can show, hide, and reorder. */
export const STATUS_GROUP_IDS = ['context', 'cache', 'tokens', 'speed', 'durations', 'counts'] as const
export type StatusGroupId = (typeof STATUS_GROUP_IDS)[number]

/** First-line pieces: model, reasoning effort, workspace path, and Git branch. */
export const STATUS_META_IDS = ['model', 'effort', 'path', 'git'] as const
export type StatusMetaId = (typeof STATUS_META_IDS)[number]

/** Every independently placed footer item. */
export const STATUS_ITEM_IDS = [...STATUS_META_IDS, ...STATUS_GROUP_IDS] as const
export type StatusItemId = (typeof STATUS_ITEM_IDS)[number]

export const STATUS_LABEL_STYLES = ['compact', 'full'] as const
export type StatusLabelStyle = (typeof STATUS_LABEL_STYLES)[number]

/**
 * Color slots: one per preview item, plus legacy `metrics` as a fallback for
 * telemetry groups that do not have their own color yet.
 */
export const STATUS_COLOR_SLOTS = [...STATUS_ITEM_IDS, 'metrics'] as const
export type StatusColorSlot = (typeof STATUS_COLOR_SLOTS)[number]

/** Theme tokens offered for a status item. `default` keeps the built-in hierarchy. */
export const STATUS_COLOR_TOKENS = ['default', 'text', 'muted', 'accent', 'success', 'warning', 'border', 'label'] as const
export type StatusColorToken = (typeof STATUS_COLOR_TOKENS)[number]

/** Footer column an item can occupy. */
export const STATUS_SIDES = ['left', 'right'] as const
export type StatusSide = (typeof STATUS_SIDES)[number]

export const DEFAULT_STATUS_SIDES: Record<StatusItemId, StatusSide> = {
  model: 'left',
  effort: 'left',
  path: 'right',
  git: 'right',
  context: 'left',
  cache: 'left',
  tokens: 'left',
  speed: 'left',
  durations: 'right',
  counts: 'right',
}

/** Per-item color choices. Omitted items keep their built-in tone. */
export type StatusBarColors = Partial<Record<StatusColorSlot, StatusColorToken>>

/** User-owned status-line layout. Missing `groups`/`meta` are hidden; `order` retains their slots. */
export interface StatusBarConfig {
  enabled: boolean
  labels: StatusLabelStyle
  groups: StatusGroupId[]
  /** Complete visual order, including hidden groups. Absent in legacy settings. */
  order?: StatusGroupId[]
  /** Visible first-line items. Absent means every meta item is shown. */
  meta?: StatusMetaId[]
  /** Complete first-line order, including hidden meta items. */
  metaOrder?: StatusMetaId[]
  /** Optional per-item colors for the two-line footer. */
  colors?: StatusBarColors
  /** Optional left/right column for each item. */
  sides?: Partial<Record<StatusItemId, StatusSide>>
}

/** Normalized layout always carries complete orders, colors, and columns. */
export interface ResolvedStatusBarConfig extends StatusBarConfig {
  order: StatusGroupId[]
  meta: StatusMetaId[]
  metaOrder: StatusMetaId[]
  colors: Required<StatusBarColors>
  sides: Record<StatusItemId, StatusSide>
}

/** Legacy value accepted while existing settings documents migrate. */
export const STATUS_PRESETS = ['minimal', 'compact', 'full'] as const
export type StatusPreset = (typeof STATUS_PRESETS)[number]

export const DEFAULT_STATUS_GROUPS: readonly StatusGroupId[] = STATUS_GROUP_IDS
export const DEFAULT_STATUS_META: readonly StatusMetaId[] = STATUS_META_IDS

export const DEFAULT_STATUS_COLORS: Required<StatusBarColors> = {
  model: 'default',
  effort: 'default',
  path: 'default',
  git: 'default',
  metrics: 'default',
  context: 'default',
  cache: 'default',
  tokens: 'default',
  speed: 'default',
  durations: 'default',
  counts: 'default',
}

/** Return a fresh default so callers can safely replace its group list. */
export function defaultStatusBarConfig(): ResolvedStatusBarConfig {
  return {
    enabled: true,
    labels: 'compact',
    groups: [...DEFAULT_STATUS_GROUPS],
    order: [...DEFAULT_STATUS_GROUPS],
    meta: [...DEFAULT_STATUS_META],
    metaOrder: [...DEFAULT_STATUS_META],
    colors: { ...DEFAULT_STATUS_COLORS },
    sides: { ...DEFAULT_STATUS_SIDES },
  }
}

function isStatusGroupId(value: unknown): value is StatusGroupId {
  return typeof value === 'string' && STATUS_GROUP_IDS.includes(value as StatusGroupId)
}

export function isStatusMetaId(value: unknown): value is StatusMetaId {
  return typeof value === 'string' && STATUS_META_IDS.includes(value as StatusMetaId)
}

export function isStatusItemId(value: unknown): value is StatusItemId {
  return typeof value === 'string' && STATUS_ITEM_IDS.includes(value as StatusItemId)
}

function isStatusLabelStyle(value: unknown): value is StatusLabelStyle {
  return typeof value === 'string' && STATUS_LABEL_STYLES.includes(value as StatusLabelStyle)
}

function isStatusColorToken(value: unknown): value is StatusColorToken {
  return typeof value === 'string' && STATUS_COLOR_TOKENS.includes(value as StatusColorToken)
}

function isStatusSide(value: unknown): value is StatusSide {
  return value === 'left' || value === 'right'
}

export function itemSide(config: StatusBarConfig, id: StatusItemId): StatusSide {
  return config.sides?.[id] ?? DEFAULT_STATUS_SIDES[id]
}

function resolveStatusSides(sides?: Partial<Record<StatusItemId, StatusSide>>): Record<StatusItemId, StatusSide> {
  const resolved = { ...DEFAULT_STATUS_SIDES }
  if (sides === undefined) return resolved
  for (const id of STATUS_ITEM_IDS) {
    const side = sides[id]
    if (isStatusSide(side)) resolved[id] = side
  }
  return resolved
}

function completeOrder<T extends string>(ids: readonly T[], preferred: readonly T[]): T[] {
  const ordered = [...new Set(preferred.filter((id): id is T => ids.includes(id)))]
  return [...ordered, ...ids.filter(id => !ordered.includes(id))]
}

function resolveStatusColors(colors?: StatusBarColors): Required<StatusBarColors> {
  const resolved = { ...DEFAULT_STATUS_COLORS }
  if (colors === undefined) return resolved
  for (const slot of STATUS_COLOR_SLOTS) {
    const token = colors[slot]
    if (isStatusColorToken(token)) resolved[slot] = token
  }
  const legacyMetrics = resolved.metrics
  if (legacyMetrics !== 'default') {
    for (const group of STATUS_GROUP_IDS) {
      if (colors[group] === undefined) resolved[group] = legacyMetrics
    }
  }
  return resolved
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
  const meta = config.meta === undefined
    ? [...DEFAULT_STATUS_META]
    : [...new Set(config.meta.filter(isStatusMetaId))]
  return {
    enabled: config.enabled ?? true,
    labels: isStatusLabelStyle(config.labels) ? config.labels : 'compact',
    groups,
    order: completeOrder(STATUS_GROUP_IDS, config.order === undefined ? groups : config.order),
    meta,
    metaOrder: completeOrder(STATUS_META_IDS, config.metaOrder === undefined ? meta : config.metaOrder),
    colors: resolveStatusColors(config.colors),
    sides: resolveStatusSides(config.sides),
  }
}
