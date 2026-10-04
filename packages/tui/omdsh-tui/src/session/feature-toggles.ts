/**
 * Optional product features and their managed Profile-patch overrides.
 *
 * A feature is a composition row a deployment may not want: it costs context,
 * runtime, or transcript noise. The row's `disabled` field is a Loader option
 * rather than plugin config, so the settings service cannot write it — the
 * Loader does read a Profile patch's `disabled`, and that patch is the
 * documented, user-authored surface for exactly this.
 *
 * The writes therefore maintain one clearly delimited block in the Profile
 * patch and touch nothing else in the file, so hand-written rows, `!!js`
 * expressions, and comments all survive a toggle. Toggling takes effect on the
 * next launch, or after the host's configuration watcher recomposes the tree.
 * @module @agi-fans/dsh-tui
 */

import { join } from 'node:path'

/** One optional product feature, addressed by its composition row id. */
export interface FeatureToggle {
  /** Composition row id; the key a Profile patch keys its override by. */
  id: string
  /** Short row label for the settings overlay. */
  label: string
  /** What the feature does, and what turning it off costs. */
  description: string
  /** Whether the shipped composition mounts it. */
  enabledByDefault: boolean
}

/**
 * Features this build can enable or disable.
 *
 * Rows that make the agent non-functional (`tool-fs`, `tool-bash`, `todo`), rows
 * that back a command (`session-query` backs `/sessions`, `workspace` backs
 * `@` mentions), and rows that are already conditional at no cost
 * (`mcp-resources` appears only with a connected MCP server) are deliberately
 * absent. `tool-web` is absent for a different reason: `web_search` and
 * `web_fetch` share one row, so no row-level toggle can express "search off,
 * fetch on".
 */
export const FEATURE_TOGGLES: readonly FeatureToggle[] = [
  {
    id: 'workspace-changes',
    label: 'Changed-file summary',
    description: 'End every turn with the files it changed and their line counts. Off skips two Git snapshots per turn and the transcript row.',
    enabledByDefault: true,
  },
  {
    id: 'tool-session-query',
    label: 'Session history tools',
    description: 'Five tools that let the model search, trace and read its own earlier sessions. Off removes five tool schemas from every request.',
    enabledByDefault: true,
  },
  {
    id: 'tool-ralph',
    label: 'Ralph loop',
    description: 'Let the model re-run a task until it reports completion. Off by default because the tool is a self-report, not an evaluation.',
    enabledByDefault: false,
  },
  {
    id: 'repeat-tool-reminder',
    label: 'Repeat-tool reminder',
    description: 'Nudge the model out of identical tool-call loops. Off removes the advisory text those nudges add to the context.',
    enabledByDefault: true,
  },
]

/** Opening delimiter of the block this module owns. */
export const FEATURE_BLOCK_BEGIN = '# >>> omdsh feature toggles >>>'

/** Closing delimiter of the block this module owns. */
export const FEATURE_BLOCK_END = '# <<< omdsh feature toggles <<<'

/** Current on/off state of every feature, keyed by row id. */
export type FeatureStates = Readonly<Record<string, boolean>>

/** The shipped composition's state, before any Profile patch override. */
export function defaultFeatureStates(
  features: readonly FeatureToggle[] = FEATURE_TOGGLES,
): Record<string, boolean> {
  return Object.fromEntries(features.map(feature => [feature.id, feature.enabledByDefault]))
}

/**
 * Render only states that differ from the shipped defaults. Returning a
 * feature to its default removes its override, including shipped-off features.
 *
 * @param states - desired feature state.
 * @returns the block text, including a trailing newline.
 */
export function renderFeatureBlock(states: FeatureStates): string {
  const lines = [FEATURE_BLOCK_BEGIN]
  for (const feature of FEATURE_TOGGLES) {
    const enabled = states[feature.id] ?? feature.enabledByDefault
    if (enabled !== feature.enabledByDefault) lines.push(`- id: ${feature.id}`, `  disabled: ${!enabled}`)
  }
  lines.push(FEATURE_BLOCK_END, '')
  return lines.join('\n')
}

/**
 * Replace the managed block, leaving every other byte of the patch untouched.
 *
 * A patch that carries no block is simply appended to, so a file the user has
 * been editing by hand keeps its formatting, comments, and `!!js` expressions.
 *
 * @param text - current patch file contents.
 * @param block - the block to install.
 * @returns the new patch file contents.
 */
export function replaceFeatureBlock(text: string, block: string): string {
  const begin = text.indexOf(FEATURE_BLOCK_BEGIN)
  const end = text.indexOf(FEATURE_BLOCK_END)
  if (begin < 0 || end < 0 || end < begin) {
    const head = text.trimEnd()
    return head === '' ? block : `${head}\n\n${block}`
  }
  const before = text.slice(0, begin).trimEnd()
  const after = text.slice(end + FEATURE_BLOCK_END.length).replace(/^\n+/, '')
  const head = before === '' ? '' : `${before}\n\n`
  const tail = after.trim() === '' ? '' : `\n${after}`
  return `${head}${block.trimEnd()}${tail}\n`
}

/**
 * Read the feature state a patch file currently declares.
 *
 * Only the managed block is parsed, by row id, so a hand-written
 * overrides elsewhere in the file are left for the composition to honour
 * and is not double-counted as a feature toggle.
 *
 * @param text - patch file contents.
 * @param features - known features; defaults to the shipped registry.
 * @returns the state the block declares over the shipped defaults.
 */
export function featureStatesFromPatch(
  text: string,
  features: readonly FeatureToggle[] = FEATURE_TOGGLES,
): Record<string, boolean> {
  const begin = text.indexOf(FEATURE_BLOCK_BEGIN)
  const end = text.indexOf(FEATURE_BLOCK_END)
  const states = Object.fromEntries(features.map(f => [f.id, f.enabledByDefault]))
  if (begin < 0 || end < 0 || end < begin) return states
  let current: string | undefined
  for (const raw of text.slice(begin, end).split('\n')) {
    const id = raw.match(/^\s*-\s*id:\s*(\S+)\s*$/u)
    if (id !== null) { current = id[1]; continue }
    const disabled = raw.match(/^\s*disabled:\s*(true|false)\s*$/u)
    if (disabled !== null && current !== undefined) {
      if (Object.hasOwn(states, current)) states[current] = disabled[1] === 'false'
      current = undefined
    }
  }
  return states
}

/** Absolute path of the Profile patch this build edits. */
export function featurePatchPath(dshHome: string): string {
  return join(dshHome, 'profiles', 'omdsh', 'cordis.patch.yml')
}
