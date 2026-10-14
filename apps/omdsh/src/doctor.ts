/** Read-only launch diagnostics. Parsing never evaluates config or imports configured plugins. */

import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  bundlePatchPaths, composeEntries, createRuntimeResolution, evaluatePluginCompatibility,
  loadLayeredEnv, loadOptionalPatches, loadOverlayPatches, readProfileCompatibility, readProfileManifest,
  resolveBundleDir, resolvePluginResource, resolveProfileDir, PROFILE_PATCH_FILENAME,
  type Profile, type ProfileLayer,
} from '@deepseek-ai/dsh-app-boot'
import { CREDENTIALS_FILENAME, parseCredentialsDocument } from '@deepseek-ai/dsh-credentials-local'
import { omdshHome } from './config-paths.ts'
import { INSTALL_ANCHOR, NAME, PRODUCT_BUNDLE, PROFILE_NAME } from './profile.ts'
import { loadLspPatches } from './lsp-config.ts'
import { loadMcpPatches } from './mcp-config.ts'

export type DoctorStatus = 'ok' | 'failed' | 'not-checked' | 'not-configured'
export interface DoctorCheck {
  id: string
  status: DoctorStatus
  summary: string
  remedy?: string
}
export interface DoctorReport {
  schemaVersion: 1
  version: string
  checks: DoctorCheck[]
}
export interface DoctorOptions {
  version: string
  cwd?: string
  environment?: NodeJS.ProcessEnv
  nodeVersion?: string
  platform?: NodeJS.Platform
  tty?: boolean
  installAnchor?: string
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function literal(value: unknown): value is string {
  return typeof value === 'string' && !value.includes('${') && !/[\u0000-\u001f\u007f]/u.test(value)
}

/** Resolve a binary without invoking it, including Windows PATHEXT and relative server commands. */
export function executableAvailable(command: string, cwd: string, environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  const hasPath = /[/\\]/u.test(command)
  const bases = hasPath ? [resolve(cwd, command)] : (environment.PATH ?? environment.Path ?? '').split(platform === 'win32' ? ';' : delimiter)
    .filter(Boolean).map(directory => resolve(cwd, directory, command))
  const extensions = platform === 'win32' && !/\.[^/\\]+$/u.test(command)
    ? ['', ...(environment.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map(extension => extension.toLowerCase())]
    : ['']
  return bases.some(base => extensions.some(extension => {
    try {
      const path = base + extension
      if (!statSync(path).isFile()) return false
      accessSync(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
      return true
    } catch { return false }
  }))
}

function nodeSupported(version: string): boolean {
  const [major, minor] = version.replace(/^v/u, '').split('.').map(Number)
  return major !== undefined && (major >= 24 || major === 22 && minor !== undefined && minor >= 19)
}

/** Reports only local facts. A successful check never implies model, MCP or LSP connectivity. */
export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const environment = options.environment ?? process.env
  const platform = options.platform ?? process.platform
  const home = omdshHome(environment)
  const anchor = options.installAnchor ?? INSTALL_ANCHOR
  const checks: DoctorCheck[] = []
  const add = (id: string, status: DoctorStatus, summary: string, remedy?: string): void => {
    checks.push({ id, status, summary, ...(remedy === undefined ? {} : { remedy }) })
  }
  if (options.environment === undefined) {
    try {
      let warnings = false
      loadLayeredEnv(NAME, cwd, () => { warnings = true })
      add('environment', warnings ? 'failed' : 'ok', warnings ? 'An environment layer reported a configuration problem.' : 'Launch environment layers were read. Values are never reported.', 'Repair project or Harness-home .env; bootstrap-only variables belong in the launching environment.')
    } catch { add('environment', 'failed', 'Launch environment layers could not be loaded.', 'Repair project or Harness-home .env; bootstrap-only variables belong in the launching environment.') }
  }
  const nodeVersion = options.nodeVersion ?? process.versions.node
  add('node', nodeSupported(nodeVersion) ? 'ok' : 'failed', `Node.js ${nodeVersion}`, 'Use Node.js 22.19+ on the 22.x line, or 24+.')
  try {
    if (!statSync(cwd).isDirectory()) throw new Error('not a directory')
    accessSync(cwd, constants.R_OK)
    add('workspace', 'ok', 'Working directory is readable.')
  } catch { add('workspace', 'failed', 'Working directory is unavailable.', 'Launch omdsh from a readable directory.') }
  const shell = platform === 'win32' ? 'pwsh' : 'bash'
  add('shell', executableAvailable(shell, cwd, environment, platform) ? 'ok' : 'failed',
    `${shell} executable lookup. No shell was started.`, `Install ${shell} and add it to PATH.`)

  const dir = resolveProfileDir(PROFILE_NAME, home)
  const profile: Profile = { name: PROFILE_NAME, dir, layers: [], patchPath: join(dir, PROFILE_PATCH_FILENAME), patches: [], skippedBundles: [] }
  let bundles: string[] = []
  let profileReadable = true
  if (!existsSync(join(dir, 'package.json'))) {
    add('profile', 'not-configured', 'Profile is not initialized; shipped defaults are inspected.', 'Start omdsh to initialize the Profile.')
  } else {
    try {
      const manifest = readProfileManifest(NAME, dir)
      const selected: unknown = manifest.dsh?.profile?.bundles ?? []
      if (!Array.isArray(selected) || selected.some(name => !literal(name) || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu.test(name))) throw new Error('invalid bundles')
      bundles = selected as string[]
      add('profile', 'ok', 'Profile manifest is readable. No files were modified.')
    } catch {
      profileReadable = false
      add('profile', 'failed', 'Profile manifest cannot be read or has an invalid bundle list.', 'Repair profiles/omdsh/package.json in the Harness home.')
    }
  }
  // Live boot restores the product bundle first. Compute that order without its write-back.
  bundles = [PRODUCT_BUNDLE, ...bundles.filter(name => name !== PRODUCT_BUNDLE)]
  const compatibility = readProfileCompatibility(dir)
  add('compatibility', compatibility.rewritable ? 'ok' : 'failed', compatibility.rewritable
    ? 'Profile compatibility records are valid.' : 'Profile compatibility records contain rejected entries.',
  'Repair profiles/omdsh/compatibility.json; doctor never grants exemptions.')
  for (const [index, packageName] of bundles.entries()) {
    try {
      const packageDir = resolveBundleDir(NAME, packageName, anchor, dir)
      const manifest = readProfileManifest(NAME, packageDir)
      const bundle = manifest.dsh?.bundle
      if (bundle === undefined) throw new Error('no bundle')
      const issue = evaluatePluginCompatibility(manifest, compatibility.exemptions)
      if (issue !== undefined && !issue.exempted) throw new Error('incompatible bundle')
      const patchPaths = bundlePatchPaths(packageDir, bundle)
      const layer: ProfileLayer = { packageName, packageDir, patchPaths, patches: patchPaths.flatMap(path => loadOverlayPatches(NAME, path)) }
      profile.layers.push(layer)
      add(`bundle:${index}`, 'ok', `${packageName}: bundle patches are readable${issue?.exempted === true ? ' with an explicit compatibility exemption' : ''}.`)
    } catch {
      profile.skippedBundles.push({ packageName, reason: 'Bundle resolution, compatibility or patch parsing failed.' })
      add(`bundle:${index}`, 'failed', `${packageName}: bundle cannot be loaded.`, 'Repair its installation, patch files or DSH version compatibility in /settings → Integrations.')
    }
  }
  const layers = profile.layers.map(layer => layer.patches)
  for (const [id, path] of [['profile-patch', profile.patchPath], ['home-patch', join(home, PROFILE_PATCH_FILENAME)]] as const) {
    try {
      const patches = loadOptionalPatches(NAME, path)
      if (patches !== undefined) layers.push(patches)
      if (id === 'profile-patch') profile.patches = patches ?? []
      add(id, patches === undefined ? 'not-configured' : 'ok', patches === undefined ? 'No user patch layer.' : 'Patch syntax is valid; expressions were not evaluated.')
    } catch { add(id, 'failed', 'Patch layer cannot be read or parsed.', `Repair ${id === 'profile-patch' ? 'profiles/omdsh/' : ''}cordis.patch.yml in the Harness home.`) }
  }
  try {
    const patches = loadMcpPatches(cwd, environment)
    layers.push(patches)
    add('mcp-config', patches.length === 0 ? 'not-configured' : 'ok', patches.length === 0 ? 'No enabled native MCP servers.' : 'Native MCP configuration is valid.')
  } catch { add('mcp-config', 'failed', 'Native MCP configuration cannot be read or parsed.', 'Repair mcp.json in the Harness home or project .dsh directory.') }
  try {
    const patches = loadLspPatches(cwd, environment)
    layers.push(patches)
    add('lsp-config', patches.length === 0 ? 'not-configured' : 'ok', patches.length === 0 ? 'No enabled native language servers.' : 'Native LSP configuration is valid.')
  } catch { add('lsp-config', 'failed', 'Native LSP configuration cannot be read or parsed.', 'Repair lsp.json in the Harness home or project .dsh directory.') }

  let entries: ReturnType<typeof composeEntries> = []
  try {
    let warnings = false
    entries = composeEntries(layers, () => { warnings = true })
    add('composition', warnings ? 'failed' : 'ok', warnings ? 'Some patches were rejected.' : 'Plugin rows composed. Config schemas and dynamic expressions were not checked.', 'Inspect omdsh --dump-config and repair rejected patch targets.')
  } catch { add('composition', 'failed', 'Plugin rows could not be composed.', 'Repair the bundle or user patch layers.') }
  if (!profileReadable || checks.some(check => check.status === 'failed' && /^(?:bundle:|.*-patch|mcp-config|lsp-config)$/u.test(check.id))) {
    add('composition-coverage', 'not-checked', 'Only readable layers were inspected; this is not the complete launch composition.')
  }
  let pluginIndex = 0
  try {
    const resolution = await createRuntimeResolution({ installAnchor: anchor, home, ...(profileReadable && existsSync(join(dir, 'package.json')) ? { profile } : {}) })
    const packages = new Map(resolution.entries.map(entry => [entry.name, entry.packageDir]))
    for (const name of resolution.localPackageNames) {
      if (!packages.has(name)) packages.set(name, resolveBundleDir(NAME, name, anchor, dir))
    }
    for (const root of resolution.linkedRoots) if (!packages.has(root.name)) packages.set(root.name, root.realPath)
    const visit = (rows: typeof entries): void => {
      for (const entry of rows) {
        if (entry.disabled === true) continue
        if (Array.isArray(entry.group)) visit(entry.group)
        if (typeof entry.name !== 'string') continue
        const root = entry.name.match(/^((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(?:\/.*)?$/iu)?.[1]
        const packageDir = root === undefined ? undefined : packages.get(root)
        const id = `plugin:${pluginIndex++}`
        if (packageDir === undefined) {
          add(id, root === undefined ? 'not-checked' : 'failed', root === undefined ? 'A relative or dynamic plugin path requires live Loader resolution.' : `${root}: package is unavailable.`, 'Check the plugin installation in /settings → Integrations.')
          continue
        }
        try {
          const path = resolvePluginResource(entry.name, pathToFileURL(join(packageDir, 'package.json')).href)
          if (!statSync(path).isFile()) throw new Error('missing module')
          const manifest = readProfileManifest(NAME, packageDir)
          const issue = evaluatePluginCompatibility(manifest, compatibility.exemptions)
          add(id, issue !== undefined && !issue.exempted ? 'failed' : 'ok', `${root}: entry file and DSH peer compatibility checked; plugin was not started.`,
            'Check the installed package exports and DSH peer requirements.')
        } catch { add(id, 'failed', `${root}: entry file or DSH peer compatibility check failed.`, 'Repair the plugin installation or version in /settings → Integrations.') }
        const config = object(entry.config) ? entry.config : {}
        if (root === '@deepseek-ai/dsh-mcp-client') checkServer(config, `mcp:${pluginIndex}`, cwd)
        if (root === '@deepseek-ai/dsh-lsp-stdio' && object(config.servers)) {
          for (const server of Object.values(config.servers)) if (object(server)) checkServer(server, `lsp:${pluginIndex++}`, cwd)
        }
      }
    }
    visit(entries)
  } catch { add('plugins', 'failed', 'The package resolution inventory could not be read.', 'Repair the installation or Profile package manifest.') }

  function checkServer(config: Record<string, unknown>, id: string, defaultCwd: string): void {
    const envIsLiteral = config.env === undefined || object(config.env) && Object.values(config.env).every(literal)
    if (typeof config.command === 'string' && literal(config.command) && (config.cwd === undefined || literal(config.cwd)) && envIsLiteral) {
      const serverEnv = { ...environment, ...(object(config.env) ? config.env as Record<string, string> : {}) }
      const serverCwd = typeof config.cwd === 'string' ? resolve(defaultCwd, config.cwd) : defaultCwd
      add(`${id}:executable`, executableAvailable(config.command, serverCwd, serverEnv, platform) ? 'ok' : 'failed', 'Server executable lookup; no process was started.', 'Install the configured server command and check its cwd and PATH.')
    } else add(`${id}:executable`, 'not-checked', 'Remote transport or dynamic command requires live runtime checks.')
    add(`${id}:connection`, 'not-checked', 'Server connectivity and protocol initialization were not checked.')
  }

  const credentials = entries.find(entry => entry.id === 'credentials' && entry.disabled !== true)
  const config = object(credentials?.config) ? credentials.config : {}
  if (credentials === undefined) {
    add('credentials', 'not-configured', 'The default managed credentials provider is not active. Its store was not read.')
  } else if (credentials.name !== '@deepseek-ai/dsh-credentials-local') {
    add('credentials', 'not-checked', 'A different credentials provider requires its own runtime checks.')
  } else if (config.path !== undefined && !literal(config.path) || config.dshHome !== undefined && !literal(config.dshHome)) {
    add('credentials', 'not-checked', 'Dynamic credential store location requires live runtime resolution.')
    checkCredentialStore(join(home, CREDENTIALS_FILENAME), 'default-credentials', 'Default managed credentials document')
  } else {
    const store = typeof config.path === 'string' ? resolve(cwd, config.path) : join(typeof config.dshHome === 'string' ? resolve(cwd, config.dshHome) : home, CREDENTIALS_FILENAME)
    checkCredentialStore(store, 'credentials', 'Managed credentials document')
  }
  function checkCredentialStore(store: string, id: string, label: string): void {
    try {
      if (!existsSync(store)) add(id, 'not-configured', `${label} is absent.`)
      else {
        if (platform !== 'win32' && (statSync(store).mode & 0o077) !== 0) throw new Error('permissions')
        const document = parseCredentialsDocument(readFileSync(store, 'utf8'), store)
        add(id, 'ok', `${label} is valid (${document.refs.size} references, ${document.records.size} records). Values are never reported.`)
      }
    } catch { add(id, 'failed', `${label} is unreadable, invalid or has unsafe permissions.`, 'Repair the credentials document; on POSIX restrict it to the owner (chmod 600).') }
  }
  add('deepseek-env', environment.DEEPSEEK_API_KEY?.trim() ? 'ok' : 'not-configured', environment.DEEPSEEK_API_KEY?.trim()
    ? 'DEEPSEEK_API_KEY is present in the launch environment. It was not authenticated.'
    : 'No DEEPSEEK_API_KEY in the launch environment. A configured credential store or another provider may supply authentication.')
  add('model-auth', 'not-checked', 'No model request or native-agent login check was performed. Configure and verify the selected provider in /model or /auth.')
  add('terminal', (options.tty ?? (process.stdin.isTTY === true && process.stdout.isTTY === true)) ? 'ok' : 'not-checked',
    (options.tty ?? (process.stdin.isTTY === true && process.stdout.isTTY === true)) ? 'Interactive stdin and stdout are attached.' : 'No interactive terminal attached.')
  add('terminal-capabilities', 'not-checked', 'Program status, images and clipboard require interactive terminal checks. No terminal probes were sent.')
  return { schemaVersion: 1, version: options.version, checks }
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [`omdsh ${report.version} · doctor`, 'Read-only checks; no plugins, servers or model requests were started.', '']
  const healthyPlugins = report.checks.filter(check => check.id.startsWith('plugin:') && check.status === 'ok').length
  for (const check of report.checks) {
    if (check.id.startsWith('plugin:') && check.status === 'ok') continue
    lines.push(`[${check.status}] ${check.id}: ${check.summary}`)
    if (check.status === 'failed' && check.remedy !== undefined) lines.push(`  Fix: ${check.remedy}`)
  }
  if (healthyPlugins > 0) lines.push(`[ok] plugins: ${healthyPlugins} plugin entry files and DSH peer requirements checked; none started.`)
  const failures = report.checks.filter(check => check.status === 'failed').length
  lines.push('', `${failures} failed checks. Unchecked capabilities are not proof of working connections.`, '')
  return lines.join('\n')
}
