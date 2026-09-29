/**
 * How much of the transcript stays folded at rest.
 *
 * The transcript has three collapsible surfaces and one detail toggle, and
 * "how much should I see" is a reading preference rather than a rendering
 * question. Naming the four rungs once here keeps the answer in the reader's
 * hands: `/settings` offers the names, the provider resolves one of them into
 * booleans, and the renderer only ever reads booleans.
 * @module @agi-fans/dsh-tui
 */

/** Density names, quietest transcript first. */
export const FOLD_DENSITIES = ['compact', 'standard', 'detailed', 'verbose'] as const
export type FoldDensity = typeof FOLD_DENSITIES[number]

/**
 * The shape of the transcript at rest.
 *
 * `groups` and `tools` nest — a collapsed run shows one header and no calls at
 * all — so the rungs are ordered to keep both useful at every level rather than
 * to be a strict ladder. The two clause booleans drop the specifics from a row
 * rather than the row itself, which is what separates the two quietest rungs.
 */
export interface FoldPolicy {
  /** Collapse a run of process blocks into its aggregate header. */
  groups: boolean
  /** Paint a settled call as its one-line fact instead of the framed output. */
  tools: boolean
  /** Paint a thought as its one-line preview instead of the full text. */
  reasoning: boolean
  /**
   * Name the kinds of work on a collapsed run's header.
   *
   * This is the clause a reader loses first, because a run's header is the one
   * row that survives at the quietest rung — dropping its specifics is what
   * makes that rung shorter in the case readers meet most.
   */
  detail: boolean
  /** Carry the call's argument subject on the folded row. */
  subject: boolean
}

/**
 * The shipped default: everything folds, and a call says what it acted on.
 *
 * The rungs govern the *work* monotonically — each step up opens one more
 * surface of the run and the calls. The model's thinking is the one exception,
 * and the exception is deliberate: `detailed` opens it, and `verbose` folds it
 * again, because `verbose` is a request for the work in full rather than for
 * the model's private notes. That also keeps `Ctrl+O` meaningful at every rung;
 * a density that already opened everything would leave the key with nothing to
 * do in the transcript, which reads as a broken key rather than a full screen.
 */
const FOLD_POLICIES: Record<FoldDensity, FoldPolicy> = {
  compact: { groups: true, tools: true, reasoning: true, detail: false, subject: false },
  standard: { groups: true, tools: true, reasoning: true, detail: true, subject: true },
  detailed: { groups: false, tools: true, reasoning: false, detail: true, subject: true },
  verbose: { groups: false, tools: false, reasoning: true, detail: true, subject: true },
}

export const DEFAULT_FOLD_DENSITY: FoldDensity = 'standard'

/** Narrow an untrusted value to a density name. */
export function isFoldDensity(value: string): value is FoldDensity {
  return (FOLD_DENSITIES as readonly string[]).includes(value)
}

/** The booleans a density asks the renderer for. */
export function foldPolicy(density: FoldDensity): FoldPolicy {
  return FOLD_POLICIES[density]
}

/** What a density changes, in the words `/settings` shows next to it. */
export const FOLD_DENSITY_COPY: Record<FoldDensity, string> = {
  compact: 'One row per run with no details, and a call names only the tool',
  standard: 'One row per run naming the kinds of work, and a call says what it acted on',
  detailed: 'Runs stay open so every call keeps its place, thoughts read in full, calls stay on one line',
  verbose: 'Runs stay open and every call paints its full output; the thinking stays folded until Ctrl+O',
}

/**
 * The density a preferences record asks for.
 *
 * `expandTools` predates the density setting and meant "start with tool output
 * expanded". The rung that now says that is `verbose`, so an older document
 * keeps the shape its author chose instead of silently reverting to the
 * default. A document written before the density existed has no `foldDensity`
 * at all, which is the only case the legacy value is consulted for.
 */
export function resolveFoldDensity(prefs: { foldDensity?: FoldDensity; expandTools?: boolean }): FoldDensity {
  if (prefs.foldDensity !== undefined && isFoldDensity(prefs.foldDensity)) return prefs.foldDensity
  if (prefs.expandTools === true) return 'verbose'
  return DEFAULT_FOLD_DENSITY
}

/** Cache-safe signature of a policy; the renderer compares it to reuse rows. */
export function foldPolicyKey(policy: FoldPolicy): string {
  return `${policy.groups ? 'g' : '-'}${policy.tools ? 't' : '-'}${policy.reasoning ? 'r' : '-'}${policy.detail ? 'd' : '-'}${policy.subject ? 's' : '-'}`
}
