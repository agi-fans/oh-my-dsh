/**
 * omdsh Profile composition: product bundle first, then user bundles, then
 * the per-profile patch, the home patch, MCP inserts, and the shipped
 * agent-preset overlay. The empty Profile root exists so Loader `baseUrl`
 * is the Profile directory; the file is rewritten every boot because a
 * Loader write-back can otherwise bake composed rows into it.
 * @module @agi-fans/oh-my-dsh
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  initProfile,
  loadOptionalPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  readProfileManifest,
  resolveProfileDir,
  writeProfileManifest,
  type ConfigDumpLayer,
  type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { omdshHome } from './config-paths.ts'
import { loadLspPatches } from './lsp-config.ts'
import { loadMcpPatches } from './mcp-config.ts'

type PatchOptions = ConfigDumpLayer['patches'][number]

export const NAME = 'omdsh'
export const PROFILE_NAME = 'omdsh'
export const PRODUCT_BUNDLE = '@agi-fans/oh-my-dsh'
export const AUTO_REVIEW_BUNDLE = '@deepseek-ai/dsh-experimental-auto-review'
export const WORKTREE_BUNDLE = '@deepseek-ai/dsh-experimental-tool-worktree'
export const DEFAULT_PROFILE_BUNDLES = [
  PRODUCT_BUNDLE,
  AUTO_REVIEW_BUNDLE,
  WORKTREE_BUNDLE,
] as const
export const PROFILE_ROOT_FILENAME = 'cordis.yml'
export const PROFILE_PATCH_LABEL = 'profiles/omdsh/cordis.patch.yml'

interface BundleDefaults {
  readonly autoReviewBundle?: boolean
  readonly worktreeBundle?: boolean
  readonly worktree?: boolean
}

const SEEDED_BUNDLES: ReadonlyArray<{
  readonly key: 'autoReviewBundle' | 'worktreeBundle'
  readonly bundle: string
}> = [
  { key: 'autoReviewBundle', bundle: AUTO_REVIEW_BUNDLE },
  { key: 'worktreeBundle', bundle: WORKTREE_BUNDLE },
]

const WORKTREE_RETENTION_PATCH = `- id: worktree\n  name: '@deepseek-ai/dsh-experimental-worktree'\n  config:\n    retainOnArchive: true\n`

function bundleDefaultsPath(home: string): string {
  return join(home, NAME, 'bundle-defaults.json')
}

function readBundleDefaults(home: string): BundleDefaults {
  const path = bundleDefaultsPath(home)
  if (!existsSync(path)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as BundleDefaults
      : {}
  } catch {
    return {}
  }
}

export function hasBundleDefault(home: string, key: keyof BundleDefaults): boolean {
  return readBundleDefaults(home)[key] === true
}

function recordBundleDefaults(home: string, keys: readonly (keyof BundleDefaults)[]): void {
  if (keys.length === 0) return
  const next: Record<string, boolean> = { ...readBundleDefaults(home) }
  for (const key of keys) next[key] = true
  mkdirSync(join(home, NAME), { recursive: true })
  writeFileSync(bundleDefaultsPath(home), JSON.stringify(next, undefined, 2) + '\n')
}

export function recordBundleDefault(home: string, key: keyof BundleDefaults): void {
  recordBundleDefaults(home, [key])
}

/** Seed product defaults once for shipped bundles without overriding user edits. */
function seedOptionalBundleDefaults(home: string, dir: string): void {
  const defaults = readBundleDefaults(home)
  let manifest = readProfileManifest(NAME, dir)
  const missing = SEEDED_BUNDLES.filter(entry => defaults[entry.key] !== true)
  if (missing.length > 0) {
    const shippedSet = new Set<string>(DEFAULT_PROFILE_BUNDLES)
    const current = [...(manifest.dsh?.profile?.bundles ?? [PRODUCT_BUNDLE])]
    const toInsert = missing.map(entry => entry.bundle).filter(bundle => !current.includes(bundle))
    if (toInsert.length > 0) {
      const wantedShipped = new Set<string>([
        PRODUCT_BUNDLE,
        ...current.filter(bundle => shippedSet.has(bundle)),
        ...toInsert,
      ])
      const next = [
        ...DEFAULT_PROFILE_BUNDLES.filter(bundle => wantedShipped.has(bundle)),
        ...current.filter(bundle => !shippedSet.has(bundle)),
      ]
      manifest = {
        ...manifest,
        dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: next } },
      }
      writeProfileManifest(dir, manifest)
    }
    recordBundleDefaults(home, missing.map(entry => entry.key))
  }
  if (!manifest.dsh?.profile?.bundles?.includes(WORKTREE_BUNDLE) || hasBundleDefault(home, 'worktree')) return
  const patchPath = join(dir, PROFILE_PATCH_FILENAME)
  const before = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  const existing = loadOptionalPatches(NAME, patchPath)
  if (existing?.some(patch => (patch as { id?: string }).id === 'worktree')) {
    recordBundleDefault(home, 'worktree')
    return
  }
  if (existing === undefined || existing.length === 0) {
    const comments = before.split('\n').filter(line => line.trimStart().startsWith('#')).join('\n')
    writeFileSync(patchPath, `${comments === '' ? '' : `${comments}\n`}${WORKTREE_RETENTION_PATCH}`)
    recordBundleDefault(home, 'worktree')
    return
  }
  if (!before.trimStart().startsWith('[')) {
    writeFileSync(patchPath, `${before}${before.endsWith('\n') ? '' : '\n'}${WORKTREE_RETENTION_PATCH}`)
    recordBundleDefault(home, 'worktree')
  }
}

/** Absolute path of this installation's package.json (src/ and lib/ both sit one level under apps/omdsh). */
export const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/** The empty root entry list every Profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# omdsh profile root — an empty entry list. The tree is composed as patches:
# the @agi-fans/oh-my-dsh product bundle, then each extra name in
# package.json's dsh.profile.bundles, then cordis.patch.yml, then the home
# patch, MCP inserts, and LSP inserts. Edit cordis.patch.yml, not this file.
[]
`

/** Absolute path of the machine-local user patch layer. */
export function homePatchPath(environment: NodeJS.ProcessEnv = process.env): string {
  return join(omdshHome(environment), PROFILE_PATCH_FILENAME)
}

/** Keep the product bundle first; user bundles stay after it in their current order. */
export function ensureProductBundleFirst(dir: string): void {
  const manifest = readProfileManifest(NAME, dir)
  const bundles = [...(manifest.dsh?.profile?.bundles ?? [])]
  const next = [PRODUCT_BUNDLE, ...bundles.filter(name => name !== PRODUCT_BUNDLE)]
  if (next.length === bundles.length && next.every((name, index) => name === bundles[index])) return
  writeProfileManifest(dir, {
    ...manifest,
    dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: next } },
  })
}

/**
 * Create `$OMDSH_HOME/profiles/omdsh` when missing, then restore the product
 * bundle as the first layer if a hand edit dropped it.
 */
export function ensureOmdshProfile(home: string): string {
  const dir = resolveProfileDir(PROFILE_NAME, home)
  if (!existsSync(join(dir, 'package.json'))) {
    // Only fresh profiles adopt Follow UI. An existing patch may predate its manifest.
    const hasPatch = existsSync(join(dir, PROFILE_PATCH_FILENAME))
    initProfile(dir, [...DEFAULT_PROFILE_BUNDLES])
    recordBundleDefaults(home, ['autoReviewBundle', 'worktreeBundle'])
    if (!hasPatch) writeFileSync(join(dir, PROFILE_PATCH_FILENAME),
      '# Response language for this profile; UI language is configured separately.\n- id: agent-behavior\n  config:\n    language: follow-ui\n')
  }
  ensureProductBundleFirst(dir)
  return dir
}

/**
 * Ensure the Profile exists, load its bundles, and rewrite the empty root
 * include. `runOmdsh` derives the runtime package resolution from the
 * resolved Profile after this function returns.
 */
export function prepareProfile(home: string, userLayer = true): Profile {
  const dir = ensureOmdshProfile(home)
  if (userLayer) seedOptionalBundleDefaults(home, dir)
  const profile = loadProfile(NAME, PROFILE_NAME, INSTALL_ANCHOR, home, { userLayer })
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}

/** One launch's labeled layers and the flattened patch list `boot()` mounts. */
export interface LaunchComposition {
  profile: Profile
  rootConfig: string
  layers: ConfigDumpLayer[]
  patches: PatchOptions[]
  /** Layers above the Profile patch; the Profile facts re-derive them for a reconciliation. */
  overlays: PatchOptions[]
}

/**
 * Compose the live launch layers in product → user bundles → Profile patch
 * → home patch → MCP → LSP order.
 */
export function composeLaunch(
  cwd: string = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
  options: { userLayer?: boolean } = {},
): LaunchComposition {
  const userLayer = options.userLayer !== false
  const home = omdshHome(environment)
  const profile = prepareProfile(home, userLayer)
  const layers: ConfigDumpLayer[] = profile.layers.map(layer => ({
    label: layer.packageName,
    patches: layer.patches,
  }))
  if (userLayer && existsSync(profile.patchPath)) {
    layers.push({ label: PROFILE_PATCH_LABEL, patches: profile.patches })
  }
  const homePatches = loadOptionalPatches(NAME, homePatchPath(environment))
  if (homePatches !== undefined) layers.push({ label: PROFILE_PATCH_FILENAME, patches: homePatches })
  const mcp = loadMcpPatches(cwd, environment)
  if (mcp.length > 0) layers.push({ label: 'mcp.json', patches: mcp })
  const lsp = loadLspPatches(cwd, environment)
  if (lsp.length > 0) layers.push({ label: 'lsp.json', patches: lsp })
  return {
    profile,
    rootConfig: join(profile.dir, PROFILE_ROOT_FILENAME),
    layers,
    patches: layers.flatMap(layer => layer.patches),
    overlays: [...mcp, ...lsp],
  }
}
