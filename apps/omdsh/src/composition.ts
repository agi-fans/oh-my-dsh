/**
 * Launch environment, config dump, and the flattened patch list boot mounts.
 * Profile discovery and layer order live in `profile.ts`.
 * @module @agi-fans/oh-my-dsh
 */

import {
  loadLayeredEnv,
  renderConfigDump,
  type ConfigDumpLayer,
} from '@deepseek-ai/dsh-app-boot'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { composeLaunch, NAME } from './profile.ts'

export {
  homePatchPath,
  INSTALL_ANCHOR,
  NAME,
  PRODUCT_BUNDLE,
  PROFILE_NAME,
  PROFILE_PATCH_LABEL,
  SHIPPED_PRESET_ROOT,
} from './profile.ts'

/**
 * Materialize the same inherited > project `.env` > home `.env` snapshot
 * that live boot uses, so dump, plugin, and mount see one process environment.
 */
export function prepareLaunchEnvironment(
  cwd: string = process.cwd(),
  warn?: (line: string) => void,
): LaunchEnvironmentSnapshot {
  return loadLayeredEnv(NAME, cwd, warn)
}

/** Flattened overlay patches passed to `boot()`. */
export function loadBootPatches(
  cwd: string = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): ConfigDumpLayer['patches'] {
  return composeLaunch(cwd, environment).patches
}

/** Compose the Profile tree the same way `boot()` will mount it. */
export function dumpOmdshConfig(
  cwd: string = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const composed = composeLaunch(cwd, environment)
  return renderConfigDump(NAME, composed.rootConfig, composed.layers)
}

/** One labelled stderr line for a failed `--dump-config` or plugin run. */
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
