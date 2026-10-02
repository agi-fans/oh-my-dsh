import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { spawnPnpm } from './test-support/pnpm.ts'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  dumpErrorMessage,
  dumpOmdshConfig,
  homePatchPath,
  loadBootPatches,
  prepareLaunchEnvironment,
  PRODUCT_BUNDLE,
  PROFILE_PATCH_LABEL,
  writeAll,
} from './composition.ts'
import { composeLaunch } from './profile.ts'
import { interpolate } from '@deepseek-ai/cordis-plugin-loader'

const appRoot = fileURLToPath(new URL('..', import.meta.url))

const roots: string[] = []

function temp(name: string): string {
  const path = mkdtempSync(join(tmpdir(), name))
  roots.push(path)
  return path
}

interface PresetPluginRow {
  id?: string
  name?: string
  group?: boolean
  isolate?: Record<string, unknown>
  disabled?: unknown
  /** A plain row keeps its options here; a `cordis:group` keeps its children here. */
  config?: Record<string, unknown> | PresetPluginRow[]
}

/** The shipped `<id>` preset's top-level plugin rows, as the composition mounts them. */
function presetPlugins(id: string): PresetPluginRow[] {
  const patches = loadBootPatches(temp('omdsh-preset-cwd-'), { OMDSH_HOME: temp('omdsh-preset-home-') })
  const rows = patches.flatMap(patch => (patch as { insert?: PresetPluginRow[] }).insert ?? [])
  const declared = rows.filter(row => row.name === '@deepseek-ai/dsh-agent-preset')
  const preset = declared.find(row => (row.config as { id?: string })?.id === id)
  expect(preset, `shipped ${id} preset row`).toBeDefined()
  const plugins = (preset?.config as { plugins?: PresetPluginRow[] } | undefined)?.plugins
  expect(Array.isArray(plugins), `shipped ${id} preset plugins`).toBe(true)
  return plugins ?? []
}

/** Every row of a preset, including the children nested in a `cordis:group`. */
function pluginTree(plugins: PresetPluginRow[]): PresetPluginRow[] {
  const all: PresetPluginRow[] = []
  for (const plugin of plugins) {
    all.push(plugin)
    if (Array.isArray(plugin.config)) all.push(...pluginTree(plugin.config))
  }
  return all
}

/** Row-level `disabled` is a `!!js` expression the loader evaluates at activation. */
function active(row: PresetPluginRow | undefined): boolean {
  return row?.disabled === undefined || interpolate({} as Context, row.disabled) !== true
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('boot patch assembly', () => {
  it('skips a missing home patch and still includes MCP inserts', () => {
    const cwd = temp('omdsh-compose-project-')
    const home = temp('omdsh-compose-home-')
    mkdirSync(join(cwd, '.dsh'), { recursive: true })
    writeFileSync(join(cwd, '.dsh', 'mcp.json'), JSON.stringify({
      mcpServers: { memory: { command: 'memory-server' } },
    }))
    const layers = composeLaunch(cwd, { OMDSH_HOME: home }).layers
    expect(layers.map(layer => layer.label)).toEqual([
      PRODUCT_BUNDLE,
      PROFILE_PATCH_LABEL,
      'mcp.json',
    ])
    expect(loadBootPatches(cwd, { OMDSH_HOME: home })).toEqual(expect.arrayContaining([
      expect.objectContaining({ insert: expect.arrayContaining([expect.objectContaining({ id: 'tui' })]) }),
      expect.objectContaining({ insert: [expect.objectContaining({ id: 'mcp-memory' })] }),
    ]))
  })

  it('mounts exactly one shell stack for the running platform', () => {
    const patches = loadBootPatches(temp('omdsh-shell-cwd-'), { OMDSH_HOME: temp('omdsh-shell-home-') })
    const rows = patches.flatMap((patch) => {
      const inserted = (patch as { insert?: Array<{ id?: string; disabled?: unknown }> }).insert
      return Array.isArray(inserted) ? inserted : [patch as { id?: string; disabled?: unknown }]
    })
    // Row-level `disabled` is a `!!js` expression node the loader evaluates at
    // activation; evaluating it here pins the same decision per platform.
    const active = (id: string): boolean => {
      const row = rows.find(candidate => candidate.id === id)
      if (row === undefined) return false
      const disabled = row.disabled
      return disabled === undefined || interpolate({} as Context, disabled) !== true
    }
    expect(active('bash')).not.toBe(active('pwsh'))
    expect(active('tool-bash')).not.toBe(active('tool-pwsh'))
    if (process.platform === 'win32') {
      expect(active('pwsh')).toBe(true)
      expect(active('tool-pwsh')).toBe(true)
    } else {
      expect(active('bash')).toBe(true)
      expect(active('tool-bash')).toBe(true)
    }
  })

  it('inserts the language-server trio after MCP inserts', () => {
    const cwd = temp('omdsh-compose-project-')
    const home = temp('omdsh-compose-home-')
    mkdirSync(join(cwd, '.dsh'), { recursive: true })
    writeFileSync(join(cwd, '.dsh', 'mcp.json'), JSON.stringify({
      mcpServers: { memory: { command: 'memory-server' } },
    }))
    writeFileSync(join(cwd, '.dsh', 'lsp.json'), JSON.stringify({
      servers: {
        typescript: {
          command: 'typescript-language-server',
          args: ['--stdio'],
          extensionToLanguage: { '.ts': 'typescript' },
        },
      },
    }))
    expect(composeLaunch(cwd, { OMDSH_HOME: home }).layers.map(layer => layer.label)).toEqual([
      PRODUCT_BUNDLE,
      PROFILE_PATCH_LABEL,
      'mcp.json',
      'lsp.json',
    ])
    const lsp = loadBootPatches(cwd, { OMDSH_HOME: home })
      .flatMap(patch => (patch as { insert?: { id?: string }[] }).insert ?? [])
    expect(lsp.map(row => row.id)).toEqual(expect.arrayContaining(['lsp', 'lsp-stdio', 'tool-lsp']))
  })

  it('applies a home cordis.patch.yml before MCP inserts', () => {
    const cwd = temp('omdsh-compose-project-')
    const home = temp('omdsh-compose-home-')
    writeFileSync(join(home, 'cordis.patch.yml'), '- id: tui\n  disabled: true\n')
    mkdirSync(join(cwd, '.dsh'), { recursive: true })
    writeFileSync(join(cwd, '.dsh', 'mcp.json'), JSON.stringify({
      mcpServers: { memory: { command: 'memory-server' } },
    }))
    expect(composeLaunch(cwd, { OMDSH_HOME: home }).layers.map(layer => layer.label)).toEqual([
      PRODUCT_BUNDLE,
      PROFILE_PATCH_LABEL,
      'cordis.patch.yml',
      'mcp.json',
    ])
    const patches = loadBootPatches(cwd, { OMDSH_HOME: home })
    const homeIndex = patches.findIndex(patch => !('insert' in patch) && (patch as { id?: string }).id === 'tui')
    const mcpIndex = patches.findIndex(patch => 'insert' in patch
      && Array.isArray((patch as { insert?: { id?: string }[] }).insert)
      && (patch as { insert: { id?: string }[] }).insert.some(row => row.id === 'mcp-memory'))
    expect(homeIndex).toBeGreaterThan(0)
    expect(mcpIndex).toBeGreaterThan(homeIndex)
  })

  it('fails loud when the home patch file is present but not a list', () => {
    const home = temp('omdsh-compose-bad-')
    writeFileSync(join(home, 'cordis.patch.yml'), '')
    expect(() => loadBootPatches(temp('omdsh-compose-cwd-'), { OMDSH_HOME: home })).toThrow(/omdsh:/u)
    expect(() => dumpOmdshConfig(temp('omdsh-compose-dump-bad-'), { OMDSH_HOME: home })).toThrow(/omdsh:/u)
  })

  it('fails loud when the home patch parses but is not an array', () => {
    const home = temp('omdsh-compose-map-')
    writeFileSync(join(home, 'cordis.patch.yml'), 'foo: bar\n')
    expect(() => loadBootPatches(temp('omdsh-compose-map-cwd-'), { OMDSH_HOME: home })).toThrow(/top-level YAML array/u)
  })

  it('fails loud when the home patch is syntactically invalid YAML', () => {
    const home = temp('omdsh-compose-yaml-')
    writeFileSync(join(home, 'cordis.patch.yml'), ':\n  - [')
    expect(() => loadBootPatches(temp('omdsh-compose-yaml-cwd-'), { OMDSH_HOME: home })).toThrow(/omdsh:/u)
  })

  it('prefers OMDSH_HOME over DSH_HOME for the home patch path', () => {
    expect(homePatchPath({ OMDSH_HOME: '/tmp/omdsh-home', DSH_HOME: '/tmp/dsh-home' }))
      .toBe(join('/tmp/omdsh-home', 'cordis.patch.yml'))
    expect(homePatchPath({ DSH_HOME: '/tmp/dsh-home' })).toBe(join('/tmp/dsh-home', 'cordis.patch.yml'))
  })

  it('labels dump failures without a stack prefix', () => {
    expect(dumpErrorMessage(new Error('omdsh: must be a top-level YAML array of loader patch entries')))
      .toBe('omdsh: must be a top-level YAML array of loader patch entries')
    expect(dumpErrorMessage('broken')).toBe('omdsh: broken')
  })

  it('dumps the shipped tree with labeled user layers', () => {
    const home = temp('omdsh-compose-dump-')
    writeFileSync(join(home, 'cordis.patch.yml'), '- id: tui\n  disabled: true\n')
    const dump = dumpOmdshConfig(temp('omdsh-compose-dump-cwd-'), { OMDSH_HOME: home })
    expect(dump).toContain(PRODUCT_BUNDLE)
    expect(dump).toContain('cordis.patch.yml')
    expect(dump).toContain('id: tui')
    expect(dump).toMatch(/disabled:\s*true/u)
    expect(dump).toContain('name: \'@agi-fans/dsh-tui\'')
    expect(dump).toContain("name: '@agi-fans/oh-my-dsh/agent-behavior'")
    // Presets ship as product-bundle patch rows, so the dump prints each one.
    for (const preset of ['standard', 'code', 'minimal', 'cordis']) {
      expect(dump, preset).toContain(`id: preset-${preset}`)
    }
    expect(dump).not.toContain('mcp.json')
  })

  it('updates the provider output fallback without replacing its model catalog', () => {
    const patches = loadBootPatches(temp('omdsh-model-limits-cwd-'), {
      OMDSH_HOME: temp('omdsh-model-limits-home-'),
    })
    const product = patches[0] as { insert?: Array<{ id?: string; config?: unknown }> }
    const deepseek = product.insert?.find(entry => entry.id === 'llm-deepseek')

    expect(deepseek?.config).toEqual({ maxTokens: 384_000 })
    expect(deepseek?.config).not.toHaveProperty('models')
  })

  it('labels both home and MCP layers in the dump', () => {
    const cwd = temp('omdsh-compose-both-')
    const home = temp('omdsh-compose-both-home-')
    writeFileSync(join(home, 'cordis.patch.yml'), '- id: tui\n  disabled: true\n')
    mkdirSync(join(cwd, '.dsh'), { recursive: true })
    writeFileSync(join(cwd, '.dsh', 'mcp.json'), JSON.stringify({
      mcpServers: { memory: { command: 'memory-server' } },
    }))
    const dump = dumpOmdshConfig(cwd, { OMDSH_HOME: home })
    expect(dump).toContain(PRODUCT_BUNDLE)
    expect(dump).toContain('cordis.patch.yml')
    expect(dump).toContain('mcp.json')
    expect(dump).toContain('mcp-memory')
  })

  it('uses the same layered .env for dump and boot patches', () => {
    const cwd = temp('omdsh-env-cwd-')
    const home = temp('omdsh-env-home-')
    writeFileSync(join(home, 'cordis.patch.yml'), '- id: tui\n  disabled: true\n')
    mkdirSync(join(cwd, '.dsh'), { recursive: true })
    writeFileSync(join(cwd, '.dsh', 'mcp.json'), JSON.stringify({
      mcpServers: {
        web: { url: 'https://example.test/mcp', headers: { Authorization: 'Bearer ${MCP_TOKEN}' } },
      },
    }))
    writeFileSync(join(cwd, '.env'), `OMDSH_HOME=${home}\nMCP_TOKEN=from-env\n`)
    const previousHome = process.env.OMDSH_HOME
    const previousToken = process.env.MCP_TOKEN
    delete process.env.OMDSH_HOME
    delete process.env.MCP_TOKEN
    try {
      prepareLaunchEnvironment(cwd)
      const patches = loadBootPatches(cwd)
      const dump = dumpOmdshConfig(cwd)
      expect(patches).toEqual(expect.arrayContaining([
        { id: 'tui', disabled: true },
        expect.objectContaining({
          insert: [expect.objectContaining({
            config: expect.objectContaining({ headers: { Authorization: 'Bearer from-env' } }),
          })],
        }),
      ]))
      expect(dump).toContain(PRODUCT_BUNDLE)
      expect(dump).toContain('cordis.patch.yml')
      expect(dump).toContain('mcp.json')
      expect(dump).toMatch(/disabled:\s*true/u)
    } finally {
      if (previousHome === undefined) delete process.env.OMDSH_HOME
      else process.env.OMDSH_HOME = previousHome
      if (previousToken === undefined) delete process.env.MCP_TOKEN
      else process.env.MCP_TOKEN = previousToken
    }
  })

  it('waits for drain before finishing a backed-up write', async () => {
    const stream = new EventEmitter() as EventEmitter & { write: (text: string) => boolean }
    let drained = false
    stream.write = () => {
      queueMicrotask(() => {
        drained = true
        stream.emit('drain')
      })
      return false
    }
    await writeAll(stream, 'hello')
    expect(drained).toBe(true)
  })

  it('prints the composed tree from the bin and exits 0 without booting a session', () => {
    const home = temp('omdsh-dump-bin-')
    const result = spawnPnpm(['exec', 'tsx', 'src/bin.ts', '--dump-config'], {
      cwd: appRoot,
      encoding: 'utf8',
      env: { ...process.env, OMDSH_HOME: home },
      timeout: 30_000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(PRODUCT_BUNDLE)
    expect(result.stdout).toContain('@agi-fans/dsh-tui')
    expect(result.stdout).not.toContain('Into the Unknown')
  })

  it('lets a project .env choose the home used by --dump-config', () => {
    const cwd = temp('omdsh-dump-env-cwd-')
    const home = temp('omdsh-dump-env-home-')
    writeFileSync(join(home, 'cordis.patch.yml'), '- id: tui\n  disabled: true\n')
    writeFileSync(join(cwd, '.env'), `OMDSH_HOME=${home}\n`)
    const env = { ...process.env }
    delete env.OMDSH_HOME
    delete env.DSH_HOME
    const result = spawnSync(process.execPath, [join(appRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(appRoot, 'src/bin.ts'), '--dump-config'], {
      cwd,
      encoding: 'utf8',
      env,
      timeout: 30_000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('cordis.patch.yml')
    expect(result.stdout).toMatch(/disabled:\s*true/u)
  })

  it('exits 1 with one labelled line when the home patch is invalid', () => {
    const home = temp('omdsh-dump-bin-bad-')
    writeFileSync(join(home, 'cordis.patch.yml'), '')
    const result = spawnPnpm(['exec', 'tsx', 'src/bin.ts', '--dump-config'], {
      cwd: appRoot,
      encoding: 'utf8',
      env: { ...process.env, OMDSH_HOME: home },
      timeout: 30_000,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/^omdsh: /u)
    expect(result.stderr).not.toContain('at dumpOmdshConfig')
  })
})

describe('dsh spine expansion', () => {
  const EXPANDED_IDS = [
    'system-prompt', 'tools', 'skill', 'skill-filesystem', 'llm-retry', 'goal', 'tool-goal',
    'goal-round-driver', 'jobs', 'invariants', 'session-invariant', 'agent-invariant',
    'scope-invariant', 'agent-loop-invariant', 'shell-env', 'tool-bash', 'agent-instructions',
    'tool-skill', 'tool-jobs', 'agent-loop',
  ]
  const FOUNDATION_IDS = ['timer', 'llm', 'session', 'session-projection', 'session-title', 'agent']

  function productRows(): Array<{ id?: string; name?: string; config?: unknown }> {
    const patches = loadBootPatches(temp('omdsh-spine-cwd-'), { OMDSH_HOME: temp('omdsh-spine-home-') })
    const product = patches[0] as { insert?: Array<{ id?: string; name?: string; config?: unknown }> }
    return product.insert ?? []
  }

  it('replaces the spine row with exactly the explicit expansion rows', () => {
    const rows = productRows()
    expect(rows.some(row => row.id === 'spine')).toBe(false)
    expect(rows.some(row => row.name === '@deepseek-ai/dsh-agent-spine-demo')).toBe(false)
    const ids = rows.map(row => row.id)
    for (const id of [...FOUNDATION_IDS, ...EXPANDED_IDS]) expect(ids).toContain(id)
    const expanded = rows.filter(row => EXPANDED_IDS.includes(row.id ?? ''))
    expect(expanded).toHaveLength(EXPANDED_IDS.length)
    expect(new Set(expanded.map(row => row.id))).toHaveLength(EXPANDED_IDS.length)
    for (const row of expanded) expect(row.name, `row ${row.id}`).toBeTruthy()
  })

  it('mounts the per-turn changed-file summarizer next to the workspace row', () => {
    const row = productRows().find(entry => entry.id === 'workspace-changes')
    expect(row?.name).toBe('@deepseek-ai/dsh-workspace-changes')
    // The plugin observes turns through the `subprocess` service it injects.
    // Row order is irrelevant: Cordis defers a row's activation until its
    // injects are satisfied, so this only asserts the dependency is mounted.
    expect(productRows().some(entry => entry.id === 'subprocess')).toBe(true)
  })

  it('keeps user questions blocking until the TUI supports timed replies', () => {
    const row = productRows().find(entry => entry.id === 'tool-ask-user')
    expect(row?.config).toEqual({ mode: 'legacy' })
  })

  it('maps each expansion row id to its owning package', () => {
    const rows = productRows()
    const row = (id: string) => rows.find(entry => entry.id === id)
    const expected: Record<string, string> = {
      'system-prompt': '@deepseek-ai/dsh-system-prompt',
      'tools': '@deepseek-ai/dsh-tools',
      'skill': '@deepseek-ai/dsh-skill',
      'skill-filesystem': '@deepseek-ai/dsh-skill-filesystem',
      'llm-retry': '@deepseek-ai/dsh-llm-retry',
      'goal': '@deepseek-ai/dsh-goal',
      'tool-goal': '@deepseek-ai/dsh-tool-goal',
      'goal-round-driver': '@deepseek-ai/dsh-goal-round-driver',
      'jobs': '@deepseek-ai/dsh-jobs-local',
      'invariants': '@deepseek-ai/dsh-invariants',
      'session-invariant': '@deepseek-ai/dsh-session/invariant',
      'agent-invariant': '@deepseek-ai/dsh-agent/invariant',
      'scope-invariant': '@deepseek-ai/dsh-scope/invariant',
      'agent-loop-invariant': '@deepseek-ai/dsh-agent-loop/invariant',
      'shell-env': '@deepseek-ai/dsh-shell-env',
      'tool-bash': '@deepseek-ai/dsh-tool-bash',
      'agent-instructions': '@deepseek-ai/dsh-agent-instructions',
      'tool-skill': '@deepseek-ai/dsh-tool-skill',
      'tool-jobs': '@deepseek-ai/dsh-tool-jobs',
      'agent-loop': '@deepseek-ai/dsh-agent-loop',
    }
    for (const [id, name] of Object.entries(expected)) expect(row(id)?.name, id).toBe(name)
  })

  it('keeps the spine registration order (agent-instructions before tool-skill)', () => {
    const rows = productRows()
    const index = (id: string) => rows.findIndex(row => row.id === id)
    expect(index('agent-instructions')).toBeGreaterThanOrEqual(0)
    expect(index('agent-instructions')).toBeLessThan(index('tool-skill'))
  })

  it('preserves the forwarded spine configuration on the owning rows', () => {
    const rows = productRows()
    const row = (id: string) => rows.find(entry => entry.id === id)
    expect(row('tools')?.config).toEqual({ mode: 'native' })
    expect(row('agent-instructions')?.config).toEqual({ maxBytes: 65536 })
    expect(row('agent-loop')?.config).toEqual({ agents: [] })
    expect(row('skill-filesystem')?.config).toHaveProperty('dshHome')
    expect(row('shell-env')?.config).toHaveProperty('dshHome')
  })

  it('mounts the LLM title provider and the workspace storage chain', () => {
    const rows = productRows()
    const row = (id: string) => rows.find(entry => entry.id === id)
    // The first-prompt provider is what turns the fallback label into a
    // summarized title on the recent-session list and the harness web.
    expect(row('session-title-llm')?.name).toBe('@deepseek-ai/dsh-session-title-first-prompt-llm')
    // The registry's injects resolve through this exact mount chain; the
    // order matters (backend before domain, domain before its consumers).
    const chain = ['session-persistence', 'storage', 'storage-json', 'storage-domain', 'session-projection-cache', 'workspace']
    const positions = chain.map(id => rows.findIndex(entry => entry.id === id))
    for (const [i, id] of chain.entries()) {
      expect(positions[i], `row ${id} mounted`).toBeGreaterThanOrEqual(0)
      if (i > 0) expect(positions[i], `${id} mounts after ${chain[i - 1]}`).toBeGreaterThan(positions[i - 1]!)
    }
    expect(row('storage-json')?.config).toHaveProperty('root')
    expect(row('storage-domain')?.config).toEqual({ backend: 'json' })
  })

  it('skips a spine-targeted home patch silently without breaking boot', () => {
    const home = temp('omdsh-spine-patch-home-')
    writeFileSync(join(home, 'cordis.patch.yml'), '- id: spine\n  config:\n    workspaceContext:\n      maxBytes: 4096\n')
    const result = spawnPnpm(['exec', 'tsx', 'src/bin.ts'], {
      cwd: appRoot,
      input: 'hi\n',
      encoding: 'utf8',
      timeout: 180_000,
      env: { ...process.env, OMDSH_HOME: home, DEEPSEEK_API_KEY: 'sk-invalid-key-for-smoke' },
    })
    const out = (result.stdout ?? '') + (result.stderr ?? '')
    expect(result.status, out).toBe(0)
    expect(out).toContain('hi')
    expect(out).not.toContain('spine')
    expect(out).not.toContain('agent-spine-demo')
  }, 200_000)

  it('applies the migrated row id to a home patch (spine knob moved to agent-instructions)', () => {
    const home = temp('omdsh-spine-migrated-home-')
    writeFileSync(join(home, 'cordis.patch.yml'),
      '- id: agent-instructions\n  config:\n    maxBytes: 12345\n')
    const result = spawnPnpm(['exec', 'tsx', 'src/bin.ts', '--dump-config'], {
      cwd: appRoot,
      encoding: 'utf8',
      env: { ...process.env, OMDSH_HOME: home },
      timeout: 30_000,
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('cordis.patch.yml')
    expect(result.stdout).toContain('maxBytes: 12345')
  })

  it('keeps the minimal preset persistent bash inside its own cordis group', () => {
    const minimal = presetPlugins('minimal')
    const plugin = (id: string): PresetPluginRow | undefined => minimal.find(entry => entry.id === id)
    // Root composition owns the global `bash` tool (dsh-tool-bash); the Minimal
    // preset mounts persistent-bash inside a cordis:group. Per dsh-tools'
    // documented contract ("Scoped tools shadow globals"), the scoped
    // registration coexists and shadows the global for that agent scope.
    const group = plugin('persistent-shell')
    expect(group?.name).toBe('cordis:group')
    expect(group?.isolate).toEqual({ terminals: true })
    const scoped = Array.isArray(group?.config) ? group.config : []
    const scopedRow = (id: string): PresetPluginRow | undefined => scoped.find(entry => entry.id === id)
    expect(scopedRow('persistent-bash')?.name).toBe('@deepseek-ai/dsh-tool-bash-persistent')
    expect(scopedRow('persistent-pwsh')?.name).toBe('@deepseek-ai/dsh-tool-pwsh-persistent')
    expect(active(scopedRow('persistent-bash'))).toBe(process.platform !== 'win32')
    expect(active(scopedRow('terminal-bash'))).toBe(process.platform !== 'win32')
    expect(active(scopedRow('persistent-pwsh'))).toBe(process.platform === 'win32')
    expect(active(scopedRow('terminal-pwsh'))).toBe(process.platform === 'win32')
    // The Minimal shape is exactly two tools: the persistent shell and the editor.
    expect(plugin('profile')?.config).toEqual({ tools: { allow: ['shell', 'str_replace_editor'] } })
    const standard = pluginTree(presetPlugins('standard'))
    expect(standard.some(entry => entry.name === '@deepseek-ai/dsh-tool-bash-persistent')).toBe(false)
    expect(standard.some(entry => entry.name === '@deepseek-ai/dsh-tool-pwsh-persistent')).toBe(false)
  })
})

describe('upstream capability adaptation rows', () => {
  function productRows(): Array<{ id?: string; name?: string; config?: Record<string, unknown> }> {
    const patches = loadBootPatches(temp('omdsh-adapt-cwd-'), { OMDSH_HOME: temp('omdsh-adapt-home-') })
    const product = patches[0] as { insert?: Array<{ id?: string; name?: string; config?: Record<string, unknown> }> }
    return product.insert ?? []
  }

  it('mounts both subagent providers with distinct tool names', () => {
    const rows = productRows()
    const row = (id: string) => rows.find(entry => entry.id === id)
    expect(row('subagent-fork')?.name).toBe('@deepseek-ai/dsh-subagent-fork-in-process')
    expect(row('subagent-fork')?.config).toMatchObject({ providerName: 'fork' })
    expect(row('tool-subagent')?.config).toMatchObject({ provider: 'spawn', toolName: 'subagent' })
    expect(row('tool-subagent-fork')?.config).toMatchObject({ provider: 'fork', toolName: 'subagent_fork' })
    expect(row('tool-subagent-fork')?.name).toBe(row('tool-subagent')?.name)
  })

  it('spills oversized tool results before the compaction pruner runs', () => {
    const rows = productRows()
    const index = (id: string) => rows.findIndex(entry => entry.id === id)
    expect(rows[index('spill-local')]?.name).toBe('@deepseek-ai/dsh-spill-local')
    expect(rows[index('spill-policy')]?.name).toBe('@deepseek-ai/dsh-spill-policy')
    expect(rows[index('spill-policy')]?.config).toMatchObject({ maxInlineTokens: 50000 })
    expect(index('spill-policy')).toBeLessThan(index('tool-result-pruner'))
  })

  it('mounts anonymous web fetch and the DeepSeek search provider', () => {
    const rows = productRows()
    const index = (id: string) => rows.findIndex(entry => entry.id === id)
    expect(rows[index('web')]?.name).toBe('@deepseek-ai/dsh-web')
    expect(rows[index('web-search-deepseek')]?.name).toBe('@deepseek-ai/dsh-web-search-deepseek')
    expect(rows[index('web-fetch-http')]?.name).toBe('@deepseek-ai/dsh-web-fetch-http')
    expect(rows[index('tool-web')]?.name).toBe('@deepseek-ai/dsh-tool-web')
    expect(rows[index('tool-web')]?.config).toMatchObject({ search: true, fetch: true, searchTimeoutMs: 60000 })
    expect(index('web')).toBeLessThan(index('web-search-deepseek'))
    expect(index('web-search-deepseek')).toBeLessThan(index('web-fetch-http'))
    expect(index('web-fetch-http')).toBeLessThan(index('tool-web'))
  })

  it('opens session full-text search lazily instead of disabling it', () => {
    const rows = productRows()
    const row = rows.find(entry => entry.id === 'session-query')
    expect(row?.name).toBe('@deepseek-ai/dsh-session-query-sqlite')
    // first-search keeps startup free of experimental node:sqlite while still
    // allowing the Session Library to search session content.
    expect(row?.config).toMatchObject({ openAt: 'first-search' })
  })

  it('mounts the persistent terminal stack after the jobs service', () => {
    const rows = productRows()
    const index = (id: string) => rows.findIndex(entry => entry.id === id)
    expect(rows[index('terminal')]?.name).toBe('@deepseek-ai/dsh-terminal')
    expect(rows[index('terminal-bash')]?.name).toBe('@deepseek-ai/dsh-terminal-bash')
    expect(rows[index('tool-terminal')]?.name).toBe('@deepseek-ai/dsh-tool-terminal')
    // Background sends need the jobs service, so tool-terminal follows it.
    expect(index('tool-jobs')).toBeLessThan(index('terminal'))
    expect(index('terminal')).toBeLessThan(index('terminal-bash'))
    expect(index('terminal-bash')).toBeLessThan(index('tool-terminal'))
  })

  it('mounts the present delivery tool beside the workspace file tools', () => {
    const rows = productRows()
    const index = (id: string) => rows.findIndex(entry => entry.id === id)
    expect(rows[index('tool-present')]?.name).toBe('@deepseek-ai/dsh-tool-present')
    // present resolves paths through the Session filesystem and appends
    // deliverables to the Session log, so those services mount first.
    expect(index('fs')).toBeLessThan(index('tool-present'))
    expect(index('tools')).toBeLessThan(index('tool-present'))
  })

  it('mounts MCP resource tools after the web tools', () => {
    const rows = productRows()
    const index = (id: string) => rows.findIndex(entry => entry.id === id)
    expect(rows[index('mcp-resources')]?.name).toBe('@deepseek-ai/dsh-mcp-resources')
    expect(index('tool-web')).toBeLessThan(index('mcp-resources'))
  })

  it('mounts /feedback beside the command runtime', () => {
    const rows = productRows()
    const index = (id: string) => rows.findIndex(entry => entry.id === id)
    expect(rows[index('command-feedback')]?.name).toBe('@deepseek-ai/dsh-command-feedback')
    expect(index('commands')).toBeLessThan(index('command-feedback'))
  })

  it('declares PTC presentation in the code preset and keeps the native default', () => {
    const rows = productRows()
    expect(rows.find(entry => entry.id === 'tools')?.config).toMatchObject({ mode: 'native' })
    const code = presetPlugins('code')
    const presentation = code.find(entry => entry.id === 'tool-presentation')
    expect(presentation?.name).toBe('@deepseek-ai/dsh-agent-tool-presentation')
    expect(presentation?.config).toEqual({ mode: 'ptc' })
    // PTC presents the registry as an SDK over run_code; a second model-authored
    // orchestration surface would sit beside it. Only registered global names
    // may be denied, and `ralph` ships disabled deployment-wide.
    const profile = code.find(entry => entry.id === 'profile')
    expect(profile?.name).toBe('@agi-fans/dsh-tui/agent-profile')
    expect(profile?.config).toEqual({ tools: { deny: ['workflow_run'] } })
    for (const preset of ['standard', 'minimal', 'cordis']) {
      const names = pluginTree(presetPlugins(preset)).map(entry => entry.name)
      expect(names, preset).not.toContain('@deepseek-ai/dsh-agent-tool-presentation')
    }
  })
})
