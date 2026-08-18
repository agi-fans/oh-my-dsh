/** Package identity shared by terminal chrome and startup release services. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const APP_NAME = 'omdsh'
export const PACKAGE_NAME = '@agi-fans/oh-my-dsh'

function readPackageVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

export const APP_VERSION = readPackageVersion()
