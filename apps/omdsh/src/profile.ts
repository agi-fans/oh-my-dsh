/**
 * omdsh Profile composition: product bundle first, then user bundles, then
 * the per-profile patch, the home patch, MCP inserts, and the shipped
 * agent-preset overlay. The empty Profile root exists so Loader `baseUrl`
 * is the Profile directory; the file is rewritten every boot because a
 * Loader write-back can otherwise bake composed rows into it.
 * @module @agi-fans/oh-my-dsh
 */

import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  composeEntries,
  healProfilesModuleFallback,
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
import { loadMcpPatches, omdshHome } from './mcp-config.ts'

type PatchOptions = ConfigDumpLayer['patches'][number]

export const NAME = 'omdsh'
export const PROFILE_NAME = 'omdsh'
export const PRODUCT_BUNDLE = '@agi-fans/oh-my-dsh'
export const PROFILE_ROOT_FILENAME = 'cordis.yml'
export const PROFILE_PATCH_LABEL = 'profiles/omdsh/cordis.patch.yml'

/** Absolute path of this installation's package.json (src/ and lib/ both sit one level under apps/omdsh). */
export const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/** Shipped agent-preset root: beside this app's own config, in both source and built layouts. */
export const SHIPPED_PRESET_ROOT = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

/** The empty root entry list every Profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# omdsh profile root — an empty entry list. The tree is composed as patches:
# the @agi-fans/oh-my-dsh product bundle, then each extra name in
# package.json's dsh.profile.bundles, then cordis.patch.yml, then the home
# patch and MCP inserts. Edit cordis.patch.yml, not this file.
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
  if (!existsSync(join(dir, 'package.json'))) initProfile(dir, [PRODUCT_BUNDLE])
  ensureProductBundleFirst(dir)
  return dir
}

/**
 * Heal the shared module fallback, ensure the Profile exists, load its
 * bundles, and rewrite the empty root include.
 */
export function prepareProfile(home: string, userLayer = true): Profile {
  healProfilesModuleFallback(INSTALL_ANCHOR, home)
  ensureOmdshProfile(home)
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
}

/**
 * Restate the agent-presets row with the shipped roster root. Profile
 * `baseUrl` would otherwise resolve `./agent-presets/` inside the Profile
 * directory, which does not carry the product presets.
 */
export function agentPresetsOverlay(layerPatches: readonly PatchOptions[][]): PatchOptions | undefined {
  const row = composeEntries([...layerPatches]).find(entry => entry.id === 'agent-presets')
  if (row === undefined) return undefined
  return {
    id: 'agent-presets',
    config: {
      ...((row.config ?? {}) as Record<string, unknown>),
      roots: [{ path: SHIPPED_PRESET_ROOT, trust: 'system' }],
    },
  }
}

/**
 * Compose the live launch layers in product → user bundles → Profile patch
 * → home patch → MCP → agent-presets overlay order.
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
  const overlay = agentPresetsOverlay(layers.map(layer => layer.patches))
  if (overlay !== undefined) layers.push({ label: 'agent-presets', patches: [overlay] })
  return {
    profile,
    rootConfig: join(profile.dir, PROFILE_ROOT_FILENAME),
    layers,
    patches: layers.flatMap(layer => layer.patches),
  }
}
