/**
 * `omdsh plugin <pnpm-args...>` — Profile plugin management as a thin pnpm
 * forwarder: initialize `$OMDSH_HOME/profiles/omdsh` on first use, run
 * `pnpm` in that directory, reject a dependency whose `@deepseek-ai/*` or
 * `@agi-fans/dsh-tui` peers or nested copies disagree with the shipped
 * release, then reconcile `dsh.profile.bundles` against installed packages
 * that declare `dsh.bundle`. The product bundle is never a Profile
 * dependency and is never removed.
 * @module @agi-fans/oh-my-dsh
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  readProfileManifest,
  resolveBundleDir,
  resolveProfileDir,
  writeProfileManifest,
  type ProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import { omdshHome } from './mcp-config.ts'
import {
  ensureOmdshProfile,
  INSTALL_ANCHOR,
  NAME,
  PRODUCT_BUNDLE,
  PROFILE_NAME,
} from './profile.ts'

export const PLUGIN_USAGE = `
omdsh plugin — install DSH bundles into the omdsh Profile

Usage:
  omdsh plugin add <package>       install a bundle
  omdsh plugin remove <package>    remove a previously installed bundle
  omdsh plugin <pnpm-args...>      forward any other pnpm verb in the Profile directory

The Profile lives at $OMDSH_HOME/profiles/omdsh (else $DSH_HOME, else ~/.dsh).
Filesystem specs such as ./examples/hello are relative to the invoking
directory. A missing ./path walks parent directories for the same relative
path and fails if nothing exists. pnpm must be on PATH. Restart omdsh after
a successful add or remove.
`.trim()

export interface PluginRunOptions {
  cwd?: string
  environment?: NodeJS.ProcessEnv
  runPnpm?: (args: readonly string[], dir: string) => { status: number | null; error?: NodeJS.ErrnoException }
  write?: (text: string) => void
}

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

function writeLine(write: (text: string) => void, text: string): void {
  write(text.endsWith('\n') ? text : text + '\n')
}

function isCorePackage(name: string): boolean {
  return name.startsWith('@deepseek-ai/') || name === '@agi-fans/dsh-tui'
}

function packageDirFromAnchor(anchor: string, packageName: string): string | undefined {
  for (const searchPath of createRequire(anchor).resolve.paths(packageName) ?? []) {
    const candidate = join(searchPath, packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
}

function readJsonObject(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${NAME}: ${path} must hold a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function parseVersion(input: string): ParsedVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(input.trim())
  if (match === null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function compareIdent(left: string, right: string): number {
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && left === String(leftNumber) && right === String(rightNumber)) {
    return leftNumber - rightNumber
  }
  return left < right ? -1 : left > right ? 1 : 0
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index]
    const b = right.prerelease[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    const compared = compareIdent(a, b)
    if (compared !== 0) return compared
  }
  return 0
}

function expandCaret(version: string): string[] | undefined {
  const parsed = parseVersion(version)
  if (parsed === undefined) return undefined
  if (parsed.major > 0) return [`>=${version}`, `<${parsed.major + 1}.0.0`]
  if (parsed.minor > 0) return [`>=${version}`, `<0.${parsed.minor + 1}.0`]
  return [`>=${version}`, `<0.0.${parsed.patch + 1}`]
}

function expandTilde(version: string): string[] | undefined {
  const parsed = parseVersion(version)
  if (parsed === undefined) return undefined
  return [`>=${version}`, `<${parsed.major}.${parsed.minor + 1}.0`]
}

function comparatorAccepts(comparator: string, version: ParsedVersion): boolean {
  const match = /^(>=|<=|>|<|=)?(.+)$/u.exec(comparator)
  if (match === null) return false
  const bound = parseVersion(match[2] ?? '')
  if (bound === undefined) return false
  const compared = compareVersions(version, bound)
  switch (match[1] ?? '=') {
    case '=': return compared === 0
    case '>': return compared > 0
    case '>=': return compared >= 0
    case '<': return compared < 0
    case '<=': return compared <= 0
    default: return false
  }
}

/** Whether a dependency or peer range accepts the shipped version. */
export function rangeAccepts(range: string, version: string): boolean {
  const cleaned = range.trim().replace(/^workspace:/u, '')
  if (cleaned === '' || cleaned === '*' || cleaned === 'x' || cleaned === 'X' || cleaned === '^' || cleaned === '~') return true
  const parsed = parseVersion(version)
  if (parsed === undefined) return false
  return cleaned.split('||').some((clause) => {
    const tokens = clause.trim().split(/\s+/u).filter(token => token !== '')
    const comparators: string[] = []
    for (const token of tokens) {
      if (token.startsWith('^')) {
        const expanded = expandCaret(token.slice(1))
        if (expanded === undefined) return false
        comparators.push(...expanded)
      } else if (token.startsWith('~')) {
        const expanded = expandTilde(token.slice(1))
        if (expanded === undefined) return false
        comparators.push(...expanded)
      } else {
        comparators.push(token)
      }
    }
    return comparators.every(comparator => comparatorAccepts(comparator, parsed))
  })
}

function stringRecord(value: unknown): Record<string, string> {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const record: Record<string, string> = {}
  for (const [name, range] of Object.entries(value)) {
    if (typeof range === 'string') record[name] = range
  }
  return record
}

function optionalPeerNames(value: unknown): Set<string> {
  const names = new Set<string>()
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return names
  for (const [name, meta] of Object.entries(value)) {
    if (typeof meta === 'object' && meta !== null && !Array.isArray(meta) && (meta as { optional?: unknown }).optional === true) {
      names.add(name)
    }
  }
  return names
}

function shippedVersions(installAnchor: string): Map<string, string> {
  const manifest = readJsonObject(installAnchor)
  const versions = new Map<string, string>()
  for (const [name, range] of Object.entries({
    ...stringRecord(manifest.dependencies),
    ...stringRecord(manifest.peerDependencies),
  })) {
    if (!isCorePackage(name)) continue
    if (range.startsWith('workspace:') || range.startsWith('file:') || range.startsWith('link:')) {
      const dir = packageDirFromAnchor(installAnchor, name)
      if (dir === undefined) continue
      const version = readJsonObject(join(dir, 'package.json')).version
      if (typeof version === 'string') versions.set(name, version)
      continue
    }
    const parsed = parseVersion(range.replace(/^[<>=^~]+/u, ''))
    versions.set(name, parsed === undefined ? range : `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease.length > 0 ? '-' + parsed.prerelease.join('.') : ''}`)
  }
  return versions
}

function resolveInstalledDir(packageName: string, profileDir: string): string | undefined {
  try {
    return resolveBundleDir(NAME, packageName, INSTALL_ANCHOR, profileDir)
  } catch {
    return packageDirFromAnchor(join(profileDir, 'package.json'), packageName)
  }
}

/**
 * Reject a Profile dependency whose core peers miss the shipped release, or
 * that nests a second copy of those packages.
 */
export function incompatiblePeerMessage(profileDir: string, installAnchor: string = INSTALL_ANCHOR): string | undefined {
  const shipped = shippedVersions(installAnchor)
  const manifest = readProfileManifest(NAME, profileDir)
  for (const packageName of Object.keys(manifest.dependencies ?? {})) {
    const dir = resolveInstalledDir(packageName, profileDir)
    if (dir === undefined) continue
    const installed = readJsonObject(join(dir, 'package.json'))
    const peers = stringRecord(installed.peerDependencies)
    const optional = optionalPeerNames(installed.peerDependenciesMeta)
    for (const [peer, range] of Object.entries(peers)) {
      if (!isCorePackage(peer)) continue
      const version = shipped.get(peer)
      if (version === undefined) continue
      if (!rangeAccepts(range, version) && !optional.has(peer)) {
        return `${NAME}: ${packageName} peer ${peer}@${range} is incompatible with shipped ${version}`
      }
    }
    for (const [dependency, range] of Object.entries(stringRecord(installed.dependencies))) {
      if (!isCorePackage(dependency)) continue
      const version = shipped.get(dependency)
      if (version === undefined) continue
      if (!rangeAccepts(range, version)) {
        return `${NAME}: ${packageName} depends on ${dependency}@${range}, which would nest a copy beside shipped ${version}`
      }
    }
  }
}

function exportsPatch(packageName: string, profileDir: string): boolean {
  const dir = resolveInstalledDir(packageName, profileDir)
  if (dir === undefined) return false
  try {
    return readProfileManifest(NAME, dir).dsh?.bundle?.patch !== undefined
  } catch {
    return false
  }
}

/**
 * Reconcile `dsh.profile.bundles` against installed dependencies. Product
 * and other non-dependency template bundles stay on the list.
 */
export function reconcilePlugins(before: ProfileManifest, profileDir: string): void {
  const after = readProfileManifest(NAME, profileDir)
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}))
  const dependencies = Object.keys(after.dependencies ?? {})
  const plugins = [...(after.dsh?.profile?.bundles ?? [])]
  let changed = false
  for (const packageName of dependencies) {
    const isBundle = exportsPatch(packageName, profileDir)
    if (isBundle && !plugins.includes(packageName)) {
      plugins.push(packageName)
      changed = true
    }
  }
  const dependencySet = new Set(dependencies)
  for (const packageName of [...plugins]) {
    if (packageName === PRODUCT_BUNDLE) continue
    const wasDependency = beforeDeps.has(packageName) || dependencySet.has(packageName)
    const stillBundle = dependencySet.has(packageName) && exportsPatch(packageName, profileDir)
    if (wasDependency && !stillBundle) {
      plugins.splice(plugins.indexOf(packageName), 1)
      changed = true
    }
  }
  if (plugins[0] !== PRODUCT_BUNDLE) {
    const rest = plugins.filter(name => name !== PRODUCT_BUNDLE)
    plugins.splice(0, plugins.length, PRODUCT_BUNDLE, ...rest)
    changed = true
  }
  if (!changed) return
  after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles: plugins } }
  writeProfileManifest(profileDir, after)
}

/** Newly added bundle-less dependencies get one orientation warning. */
export function bundlelessWarnings(before: ProfileManifest, profileDir: string): string[] {
  const after = readProfileManifest(NAME, profileDir)
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}))
  const warnings: string[] = []
  for (const packageName of Object.keys(after.dependencies ?? {})) {
    if (beforeDeps.has(packageName) || exportsPatch(packageName, profileDir)) continue
    warnings.push(
      `${NAME}: warning: ${packageName} declares no dsh.bundle — installed as a plain dependency, not a profile layer `
      + '(a later update that gains one activates it automatically)',
    )
  }
  return warnings
}

const FILE_SPEC = /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/u

/** One resolved `omdsh plugin` argument after filesystem-spec rewriting. */
export interface ResolvedPluginArgument {
  /** Argument forwarded to pnpm. */
  argument: string
  /** Absolute path when this argument is a filesystem spec. */
  resolved?: string
  /** Absolute path that was requested but does not exist. */
  missing?: string
  /** Invoking-directory miss that was satisfied by a parent directory. */
  relocated?: { from: string; to: string }
}

function findByWalkingParents(cwd: string, relative: string): string | undefined {
  let current = cwd
  for (;;) {
    const candidate = resolve(current, relative)
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * Rewrite relative filesystem specs against the invoking directory. A
 * missing `./path` also walks parent directories so `omdsh plugin add
 * ./examples/hello` still works when the process cwd is `apps/omdsh`.
 * `..` specs stay cwd-relative and never walk. pnpm then runs with cwd =
 * the Profile directory, so a bare `.` must already be absolute.
 */
export function resolveFilesystemSpec(argument: string, cwd: string): ResolvedPluginArgument {
  const match = FILE_SPEC.exec(argument)
  if (match?.groups?.path === undefined) return { argument }
  const prefix = match.groups.prefix ?? ''
  const relative = match.groups.path
  const fromCwd = resolve(cwd, relative)
  if (existsSync(fromCwd)) return { argument: `${prefix}${fromCwd}`, resolved: fromCwd }
  const nested = /^\.[/\\]/u.test(relative) ? relative.replace(/^\.[/\\]/u, '') : undefined
  const walked = nested !== undefined && nested !== '' ? findByWalkingParents(dirname(cwd), nested) : undefined
  if (walked !== undefined) {
    return { argument: `${prefix}${walked}`, resolved: walked, relocated: { from: fromCwd, to: walked } }
  }
  return { argument: `${prefix}${fromCwd}`, missing: fromCwd }
}

/** Rewrite one relative filesystem spec against the invoking directory. */
export function anchorPathSpec(argument: string, cwd: string): string {
  return resolveFilesystemSpec(argument, cwd).argument
}

function firstVerb(args: readonly string[]): string | undefined {
  return args.find(argument => argument !== '' && !argument.startsWith('-'))
}

function spawnPnpm(args: readonly string[], dir: string): { status: number | null; error?: NodeJS.ErrnoException } {
  const result = spawnSync('pnpm', [...args], {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) return { status: result.status, error: result.error }
  return { status: result.status }
}

/**
 * Run one `omdsh plugin` invocation: init if needed, forward to pnpm, check
 * peers, reconcile.
 */
export function runPlugin(args: readonly string[], options: PluginRunOptions = {}): number {
  const write = options.write ?? ((text: string) => { process.stderr.write(text) })
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    writeLine(write, PLUGIN_USAGE)
    return 0
  }
  const cwd = options.cwd ?? process.cwd()
  const environment = options.environment ?? process.env
  const resolved = args.map(argument => resolveFilesystemSpec(argument, cwd))
  const missing = resolved.find(item => item.missing !== undefined)
  if (missing?.missing !== undefined) {
    writeLine(write,
      `${NAME}: ${missing.missing} does not exist — filesystem specs are relative to the invoking directory (${cwd})`,
    )
    return 2
  }
  for (const item of resolved) {
    if (item.relocated !== undefined) {
      writeLine(write, `${NAME}: ${item.relocated.from} is missing; using ${item.relocated.to}`)
    }
  }
  const home = omdshHome(environment)
  const dir = resolveProfileDir(PROFILE_NAME, home)
  const created = !existsSync(join(dir, 'package.json'))
  ensureOmdshProfile(home)
  if (created) writeLine(write, `${NAME}: initialized profile ${PROFILE_NAME} at ${dir}`)
  const before = readProfileManifest(NAME, dir)
  const forwarded = resolved.map(item => item.argument)
  const runPnpm = options.runPnpm ?? spawnPnpm
  const result = runPnpm(forwarded, dir)
  if (result.error !== undefined) {
    if (result.error.code === 'ENOENT') {
      writeLine(write, `${NAME}: pnpm not found on PATH — install pnpm to manage profile plugins`)
      return 127
    }
    throw result.error
  }
  const exitCode = result.status ?? 1
  if (exitCode !== 0) {
    writeLine(write, `${NAME}: pnpm failed in profile directory ${dir}`)
    if (args.some(argument => /^git\+|^github:|\.git(?:#|$)/u.test(argument))) {
      writeLine(write,
        `${NAME}: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed — `
        + `add the exact key pnpm printed above under allowBuilds in ${join(dir, 'pnpm-workspace.yaml')}, then re-run`,
      )
    }
    return exitCode
  }
  const incompatible = incompatiblePeerMessage(dir)
  if (incompatible !== undefined) {
    writeLine(write, incompatible)
    const verb = firstVerb(args)
    const added = Object.keys(readProfileManifest(NAME, dir).dependencies ?? {})
      .filter(name => !(before.dependencies ?? {})[name])
    if (verb === 'add' && added.length > 0) {
      const rollback = runPnpm(['remove', ...added], dir)
      if ((rollback.status ?? 1) !== 0) {
        writeLine(write, `${NAME}: failed to roll back incompatible packages: ${added.join(', ')}`)
      } else {
        writeLine(write, `${NAME}: removed incompatible packages: ${added.join(', ')}`)
      }
    }
    return 1
  }
  for (const warning of bundlelessWarnings(before, dir)) writeLine(write, warning)
  reconcilePlugins(before, dir)
  return 0
}
