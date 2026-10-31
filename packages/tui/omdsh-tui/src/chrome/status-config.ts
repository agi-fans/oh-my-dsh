/**
 * Status-line customization shared by settings, persistence, and rendering.
 *
 * The footer is two rows of fixed copy. This module owns *which* parts of those
 * rows appear and how much of each telemetry group is shown — nothing more.
 *
 * There used to be a layout engine here: twelve independently placed items, each
 * with its own colour, its own column, and two levels of ordering, plus a legacy
 * `metrics` colour slot for groups that had no colour of their own. That is a
 * page of settings for a two-line footer, and it asked the reader to decide
 * things the footer could decide better. The reader now picks a density, and can
 * turn individual telemetry groups off when a terminal is narrow or a metric is
 * not interesting to them.
 *
 * @module @agi-fans/dsh-tui/status-config
 */

import type { VolatileSnapshot } from '@deepseek-ai/cordis'

/**
 * Telemetry groups on the second line, in the order they are shown.
 *
 * The order is fixed and follows the priority stated in `AGENTS.md`: cache,
 * tokens, and latency first because they say how the turn is going; durations
 * second; turn and step counts last, because they are the least actionable.
 */
export const STATUS_GROUP_IDS = ['context', 'cache', 'tokens', 'speed', 'durations', 'counts'] as const
export type StatusGroupId = (typeof STATUS_GROUP_IDS)[number]

/** First-line pieces: model, reasoning effort, workspace path, Git branch, and session title. */
export const STATUS_META_IDS = ['model', 'effort', 'path', 'git', 'session'] as const
export type StatusMetaId = (typeof STATUS_META_IDS)[number]

/** Every part of the footer a reader can show or hide. */
export const STATUS_ITEM_IDS = [...STATUS_META_IDS, ...STATUS_GROUP_IDS] as const
export type StatusItemId = (typeof STATUS_ITEM_IDS)[number]

export const STATUS_LABEL_STYLES = ['compact', 'full'] as const
export type StatusLabelStyle = (typeof STATUS_LABEL_STYLES)[number]

/** How context occupancy is written, which is a rendering choice, not a layout one. */
export const STATUS_CONTEXT_STYLES = ['percent', 'bar', 'tokens', 'detailed'] as const
export type StatusContextStyle = (typeof STATUS_CONTEXT_STYLES)[number]

/**
 * How much the footer says.
 *
 * A density is the whole vocabulary now: three whole-footer shapes a reader can
 * recognize, instead of twelve items they have to assemble. Individual groups
 * can still be hidden on top of one, which is the one per-item decision that
 * survives — "I do not care about this number" is real, "put this number on the
 * left in accent green" is chrome nobody asked for.
 */
export const STATUS_DENSITIES = ['minimal', 'standard', 'verbose'] as const
export type StatusDensity = (typeof STATUS_DENSITIES)[number]

/**
 * Groups that belong on the left, because they read as one figure: how much of
 * the window is used, and how much of what was sent was already known.
 *
 * The rest of the row is latency, duration and activity — what the session has
 * spent and how far it has got — and they sit against the right edge, so the
 * row states occupancy on one side and cost on the other.
 */
export const STATUS_LEFT_GROUPS: readonly StatusGroupId[] = ['context', 'cache']

/** Which side of the second line a group is drawn on. */
export function statusGroupSide(id: StatusGroupId): 'left' | 'right' {
  return STATUS_LEFT_GROUPS.includes(id) ? 'left' : 'right'
}

/** Which groups each density shows, in footer order. */
export const DENSITY_GROUPS: Readonly<Record<StatusDensity, readonly StatusGroupId[]>> = {
  /** Occupancy only: how full the window is and how much of it came from cache. */
  minimal: ['context', 'cache'],
  /** Adds latency — the first number that says a turn feels slow rather than long. */
  standard: ['context', 'cache', 'speed'],
  /** Every group, with full labels and the detailed context form. */
  verbose: [...STATUS_GROUP_IDS],
}

/** Which first-line pieces each density shows. */
export const DENSITY_META: Readonly<Record<StatusDensity, readonly StatusMetaId[]>> = {
  /** Where the model is and where the work is; the footer's original two facts. */
  minimal: ['model', 'path'],
  standard: ['model', 'effort', 'path', 'git'],
  /** `session` joins at the widest setting; the terminal title shows it anyway. */
  verbose: ['model', 'effort', 'path', 'git', 'session'],
}

/** The label style each density defaults to. */
export const DENSITY_LABELS: Readonly<Record<StatusDensity, StatusLabelStyle>> = {
  minimal: 'compact',
  standard: 'compact',
  verbose: 'full',
}

/** The context representation each density defaults to. */
export const DENSITY_CONTEXT: Readonly<Record<StatusDensity, StatusContextStyle>> = {
  minimal: 'percent',
  standard: 'percent',
  verbose: 'detailed',
}

export const DEFAULT_STATUS_DENSITY: StatusDensity = 'standard'

/**
 * Stored status-line input.
 *
 * `density` is the whole user-facing decision. `meta` and `groups` are narrowings
 * on top of it: a reader who turned a number off keeps it off across densities,
 * because hiding something is a statement about the number, not about the layout.
 */
export interface StatusBarConfig {
  density: StatusDensity
  /** Pieces the reader hid, on top of what the density shows. */
  hidden: StatusItemId[]
  /**
   * Pieces the reader added beyond what the density shows.
   *
   * Without this, a part the density omits could not be turned on at all: `Space`
   * on it was a no-op, while the row still said `hidden` — a control that looked
   * broken. Positive and negative narrowing are both deltas from the density, so
   * changing the density still changes everything the reader has not overruled.
   */
  shown: StatusItemId[]
}

/** A status-line document, including every field earlier releases wrote. */
export type StatusBarInput = Partial<VolatileSnapshot<StatusBarConfig>> & {
  /** Earlier releases spelled the whole layout out; read only while migrating. */
  enabled?: boolean
  labels?: StatusLabelStyle
  contextStyle?: StatusContextStyle
  groups?: readonly StatusGroupId[]
  order?: readonly StatusGroupId[]
  meta?: readonly StatusMetaId[]
  metaOrder?: readonly StatusMetaId[]
  colors?: Readonly<Record<string, string>>
  sides?: Readonly<Record<string, string>>
}

/** What the renderer consumes: the density expanded, with narrowings applied. */
export interface ResolvedStatusBarConfig {
  density: StatusDensity
  /** False when the reader hid the whole second line. */
  enabled: boolean
  labels: StatusLabelStyle
  contextStyle: StatusContextStyle
  /** Visible telemetry groups, in fixed footer order. */
  groups: StatusGroupId[]
  /** Visible first-line pieces, in fixed footer order. */
  meta: StatusMetaId[]
}

/** Earlier releases stored a three-value `statusPreset` beside the layout. */
export const STATUS_PRESETS = ['minimal', 'compact', 'full'] as const
export type StatusPreset = (typeof STATUS_PRESETS)[number]

/** Everything shown at the shipped density. */
export const DEFAULT_STATUS_GROUPS: readonly StatusGroupId[] = DENSITY_GROUPS[DEFAULT_STATUS_DENSITY]
export const DEFAULT_STATUS_META: readonly StatusMetaId[] = DENSITY_META[DEFAULT_STATUS_DENSITY]

function isStatusDensity(value: unknown): value is StatusDensity {
  return typeof value === 'string' && STATUS_DENSITIES.includes(value as StatusDensity)
}

export function isStatusItemId(value: unknown): value is StatusItemId {
  return typeof value === 'string' && STATUS_ITEM_IDS.includes(value as StatusItemId)
}

export function isStatusMetaId(value: unknown): value is StatusMetaId {
  return typeof value === 'string' && STATUS_META_IDS.includes(value as StatusMetaId)
}

export function isStatusGroupId(value: unknown): value is StatusGroupId {
  return typeof value === 'string' && STATUS_GROUP_IDS.includes(value as StatusGroupId)
}

/**
 * Map a retired `statusPreset` onto a density.
 *
 * `minimal` meant "no second line"; that is now `minimal` density with telemetry
 * hidden, which is the same footer the reader had. `full` meant long labels,
 * which is what `verbose` says.
 */
function densityFromPreset(preset: StatusPreset | undefined): { density: StatusDensity; enabled: boolean } {
  if (preset === 'minimal') return { density: 'minimal', enabled: false }
  if (preset === 'full') return { density: 'verbose', enabled: true }
  return { density: DEFAULT_STATUS_DENSITY, enabled: true }
}

/**
 * Normalize persisted input at the single configuration seam.
 *
 * A document written by an earlier release described its layout item by item.
 * Rather than fail it or resurrect the engine, the shape it asked for is reduced
 * to the nearest density: what was visible decides the narrowing, and the retired
 * per-item colour and column choices are dropped, because both shipped palettes
 * already paint them the right way.
 */
export function resolveStatusBarConfig(
  config?: StatusBarInput,
  legacyPreset?: StatusPreset,
): ResolvedStatusBarConfig {
  const fallback = densityFromPreset(legacyPreset)
  if (config === undefined) return expand(fallback.density, { enabled: fallback.enabled, hidden: [] })

  const density = isStatusDensity(config.density) ? config.density : fallback.density
  /**
   * A legacy document listed what it wanted shown; a current one lists what it
   * wants hidden. Both cannot be read from `density`: the schema defaults that
   * field, so an old document arrives here already looking current, while the
   * layout arrays only exist on an old one.
   */
  const enabled = typeof config.enabled === 'boolean' ? config.enabled : fallback.enabled
  return expand(density, { enabled, hidden: statusNarrowing(config, density), shown: statusAdditions(config) })
}

/**
 * What a stored document asks to hide, relative to its density.
 *
 * Exported because writing the document back needs the same reading: a caller
 * that reconstructed the narrowing from the *rendered* footer instead would turn
 * every part its density happens to omit into a permanent hiding, and changing
 * the density afterwards would no longer restore them.
 */
export function statusNarrowing(config: StatusBarInput | undefined, density: StatusDensity): StatusItemId[] {
  if (config === undefined) return []
  const legacyLayout = config.groups !== undefined || config.meta !== undefined
    || config.order !== undefined || config.metaOrder !== undefined
  return legacyLayout
    ? legacyHidden(config, density)
    : [...new Set((config.hidden ?? []).filter(isStatusItemId))]
}

/** What a stored document adds beyond its density. */
export function statusAdditions(config: StatusBarInput | undefined): StatusItemId[] {
  return [...new Set((config?.shown ?? []).filter(isStatusItemId))]
}

/** What an earlier release's explicit lists hid, expressed as a narrowing. */
function legacyHidden(config: StatusBarInput, density: StatusDensity): StatusItemId[] {
  const shownGroups = config.groups === undefined ? DENSITY_GROUPS[density] : config.groups
  const shownMeta = config.meta === undefined ? DENSITY_META[density] : config.meta
  const hidden: StatusItemId[] = []
  for (const id of STATUS_GROUP_IDS) if (!shownGroups.includes(id)) hidden.push(id)
  for (const id of STATUS_META_IDS) if (!shownMeta.includes(id)) hidden.push(id)
  return hidden
}

/**
 * True when a document has already been expanded.
 *
 * `resolveStatusBarConfig` is idempotent only if it can tell the two shapes
 * apart: an expanded config carries `groups`/`meta`, which a stored document
 * never does. Without this the renderer re-resolved its own input and silently
 * dropped every narrowing, so a hidden group came back.
 */
export function isResolvedStatusBarConfig(
  config: ResolvedStatusBarConfig | StatusBarInput,
): config is ResolvedStatusBarConfig {
  return Array.isArray((config as ResolvedStatusBarConfig).groups)
    && Array.isArray((config as ResolvedStatusBarConfig).meta)
    && typeof (config as ResolvedStatusBarConfig).enabled === 'boolean'
}

/** Expand one density plus its deltas into the renderer's view. */
function expand(
  density: StatusDensity,
  options: { enabled: boolean; hidden: readonly StatusItemId[]; shown?: readonly StatusItemId[] },
): ResolvedStatusBarConfig {
  const hidden = new Set(options.hidden)
  const shown = new Set(options.shown ?? [])
  // Catalog order, so a part the reader added sits where its family sits rather
  // than at the end of the row where it would move every time it is toggled.
  const visible = <T extends StatusItemId>(catalog: readonly T[], base: readonly T[]): T[] =>
    catalog.filter(id => (base.includes(id) || shown.has(id)) && !hidden.has(id))
  return {
    density,
    enabled: options.enabled,
    labels: DENSITY_LABELS[density],
    contextStyle: DENSITY_CONTEXT[density],
    groups: visible(STATUS_GROUP_IDS, DENSITY_GROUPS[density]),
    meta: visible(STATUS_META_IDS, DENSITY_META[density]),
  }
}

/** True when the footer shows this part at the current narrowing. */
export function statusItemVisible(config: ResolvedStatusBarConfig, id: StatusItemId): boolean {
  return isStatusMetaId(id) ? config.meta.includes(id) : config.groups.includes(id)
}

/**
 * The same document with one part turned on or off.
 *
 * Both directions are deltas from the density, so a part the density omits can
 * be added and a part it includes can be removed, without either one rewriting
 * the other's state.
 */
export function toggleStatusItem(config: StatusBarConfig, id: StatusItemId): StatusBarConfig {
  const density = isStatusDensity(config.density) ? config.density : DEFAULT_STATUS_DENSITY
  const hidden = new Set((config.hidden ?? []).filter(isStatusItemId))
  const shown = new Set((config.shown ?? []).filter(isStatusItemId))
  const visible = statusItemVisible(expand(density, { enabled: true, hidden: [...hidden], shown: [...shown] }), id)
  if (visible) {
    hidden.add(id)
    shown.delete(id)
  } else {
    shown.add(id)
    hidden.delete(id)
  }
  return { ...config, hidden: [...hidden], shown: [...shown] }
}
