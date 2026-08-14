#!/usr/bin/env node
/**
 * omdsh — command-line entry. Parses flags, applies model/provider
 * overrides to the environment the cordis.yml composition reads, and
 * boots the tree; the mounted runner owns process lifetime after that.
 * @module @omdsh/app
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseOmdshArgs } from './args.ts'

/** This app's version, read from its checked-in package.json. */
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

const invocation = parseOmdshArgs(process.argv.slice(2), readVersion())

// CLI flags outrank every layered environment source; the cordis.yml
// rows read these overrides at entry-mount time.
if (invocation.model !== undefined) process.env.OMDSH_MODEL = invocation.model
if (invocation.provider !== undefined) process.env.OMDSH_PROVIDER = invocation.provider

const { runOmdsh } = await import('./boot.ts')
await runOmdsh(invocation.prompt, invocation.resume)
