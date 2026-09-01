import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
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
  SHIPPED_PRESET_ROOT,
  writeAll,
} from './composition.ts'
import { composeLaunch } from './profile.ts'

const appRoot = fileURLToPath(new URL('..', import.meta.url))

const roots: string[] = []

function temp(name: string): string {
  const path = mkdtempSync(join(tmpdir(), name))
  roots.push(path)
  return path
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
      'agent-presets',
    ])
    expect(loadBootPatches(cwd, { OMDSH_HOME: home })).toEqual(expect.arrayContaining([
      expect.objectContaining({ insert: expect.arrayContaining([expect.objectContaining({ id: 'tui' })]) }),
      expect.objectContaining({ insert: [expect.objectContaining({ id: 'mcp-memory' })] }),
    ]))
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
      'agent-presets',
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
    expect(dump).toContain(SHIPPED_PRESET_ROOT)
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
    const result = spawnSync('pnpm', ['exec', 'tsx', 'src/bin.ts', '--dump-config'], {
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
    const result = spawnSync(join(appRoot, 'node_modules/.bin/tsx'), [join(appRoot, 'src/bin.ts'), '--dump-config'], {
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
    const result = spawnSync('pnpm', ['exec', 'tsx', 'src/bin.ts', '--dump-config'], {
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

describe('dsh 0.1.2-alpha.3 spine expansion', () => {
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

  it('skips a spine-targeted home patch silently without breaking boot', () => {
    const home = temp('omdsh-spine-patch-home-')
    writeFileSync(join(home, 'cordis.patch.yml'), '- id: spine\n  config:\n    workspaceContext:\n      maxBytes: 4096\n')
    const result = spawnSync('pnpm', ['exec', 'tsx', 'src/bin.ts'], {
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
    const result = spawnSync('pnpm', ['exec', 'tsx', 'src/bin.ts', '--dump-config'], {
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
    const minimal = readFileSync(join(appRoot, 'config', 'agent-presets', 'minimal', 'agent.cordis.yml'), 'utf8')
    const standard = readFileSync(join(appRoot, 'config', 'agent-presets', 'standard', 'agent.cordis.yml'), 'utf8')
    // Root composition owns the global `bash` tool (dsh-tool-bash); the Minimal
    // preset mounts persistent-bash inside a cordis:group. Per dsh-tools'
    // documented contract ("Scoped tools shadow globals"), the scoped
    // registration coexists and shadows the global for that agent scope.
    expect(minimal).toContain('cordis:group')
    expect(minimal).toContain('@deepseek-ai/dsh-tool-bash-persistent')
    expect(standard).not.toContain('@deepseek-ai/dsh-tool-bash-persistent')
  })
})
