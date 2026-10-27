/** Package identity shared by terminal chrome and startup release services. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The command a reader types, and the name a process reports about itself. */
export const APP_NAME = 'omdsh'
/**
 * The product name, shown once in the startup header. It is not `APP_NAME`: the
 * header is naming what this is, while a `--resume` hint or an overlay title has
 * to stay the command that actually runs. Using the long name for both would
 * hand the reader a command line their shell cannot find.
 */
export const APP_DISPLAY_NAME = 'Oh-My-DSH'
export const PACKAGE_NAME = '@agi-fans/oh-my-dsh'

function readPackageVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

export const APP_VERSION = readPackageVersion()
