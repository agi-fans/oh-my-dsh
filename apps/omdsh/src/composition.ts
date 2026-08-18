/**
 * Boot patch assembly: shipped cordis.yml plus optional home and MCP layers.
 * Profile bundles are a later layer; this module only composes what boot
 * already knows how to mount.
 * @module @agi-fans/oh-my-dsh
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadLayeredEnv,
  loadOptionalPatches,
  PROFILE_PATCH_FILENAME,
  renderConfigDump,
  type ConfigDumpLayer,
} from '@deepseek-ai/dsh-app-boot'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { loadMcpPatches, omdshHome } from './mcp-config.ts'

export const NAME = 'omdsh'

/** Absolute path of the shipped composition (source and built layouts both sit one directory under apps/omdsh). */
export const CONFIG_PATH = fileURLToPath(new URL('../config/cordis.yml', import.meta.url))

/**
 * Materialize the same inherited > project `.env` > home `.env` snapshot
 * that live boot uses, so dump and mount see one process environment.
 */
export function prepareLaunchEnvironment(
  cwd: string = process.cwd(),
  warn?: (line: string) => void,
): LaunchEnvironmentSnapshot {
  return loadLayeredEnv(NAME, cwd, warn)
}

/** Absolute path of the machine-local user patch layer. */
export function homePatchPath(environment: NodeJS.ProcessEnv = process.env): string {
  return join(omdshHome(environment), PROFILE_PATCH_FILENAME)
}

/** User layers applied over the shipped composition, in boot order. */
export function loadUserPatchLayers(
  cwd: string = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): ConfigDumpLayer[] {
  const layers: ConfigDumpLayer[] = []
  const home = loadOptionalPatches(NAME, homePatchPath(environment))
  if (home !== undefined) layers.push({ label: PROFILE_PATCH_FILENAME, patches: home })
  const mcp = loadMcpPatches(cwd, environment)
  if (mcp.length > 0) layers.push({ label: 'mcp.json', patches: mcp })
  return layers
}

/** Flattened overlay patches passed to `boot()`. */
export function loadBootPatches(
  cwd: string = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): ConfigDumpLayer['patches'] {
  return loadUserPatchLayers(cwd, environment).flatMap(layer => layer.patches)
}

/** Compose the shipped config and user layers the same way `boot()` will mount them. */
export function dumpOmdshConfig(
  cwd: string = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return renderConfigDump(NAME, CONFIG_PATH, loadUserPatchLayers(cwd, environment))
}

/** One labelled stderr line for a failed `--dump-config` run. */
export function dumpErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.startsWith(NAME + ':') ? message : NAME + ': ' + message
}

/** Write `text` and wait for backpressure so a piped dump is not truncated. */
export async function writeAll(
  stream: Pick<NodeJS.WritableStream, 'write' | 'once' | 'off'>,
  text: string,
): Promise<void> {
  if (text === '') return
  if (stream.write(text)) return
  await new Promise<void>((resolve, reject) => {
    const onDrain = (): void => {
      stream.off('error', onError)
      resolve()
    }
    const onError = (error: Error): void => {
      stream.off('drain', onDrain)
      reject(error)
    }
    stream.once('drain', onDrain)
    stream.once('error', onError)
  })
}
