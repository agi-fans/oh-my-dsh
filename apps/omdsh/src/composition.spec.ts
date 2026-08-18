import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  dumpErrorMessage,
  dumpOmdshConfig,
  homePatchPath,
  loadBootPatches,
  loadUserPatchLayers,
  prepareLaunchEnvironment,
  writeAll,
} from './composition.ts'

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
    const layers = loadUserPatchLayers(cwd, { OMDSH_HOME: home })
    expect(layers.map(layer => layer.label)).toEqual(['mcp.json'])
    expect(loadBootPatches(cwd, { OMDSH_HOME: home })).toEqual([
      expect.objectContaining({ insert: [expect.objectContaining({ id: 'mcp-memory' })] }),
    ])
  })

  it('applies a home cordis.patch.yml before MCP inserts', () => {
    const cwd = temp('omdsh-compose-project-')
    const home = temp('omdsh-compose-home-')
    writeFileSync(join(home, 'cordis.patch.yml'), '- id: tui\n  disabled: true\n')
    mkdirSync(join(cwd, '.dsh'), { recursive: true })
    writeFileSync(join(cwd, '.dsh', 'mcp.json'), JSON.stringify({
      mcpServers: { memory: { command: 'memory-server' } },
    }))
    expect(loadBootPatches(cwd, { OMDSH_HOME: home })).toEqual([
      { id: 'tui', disabled: true },
      expect.objectContaining({ insert: [expect.objectContaining({ id: 'mcp-memory' })] }),
    ])
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
    expect(dump).toContain('cordis.patch.yml')
    expect(dump).toContain('id: tui')
    expect(dump).toMatch(/disabled:\s*true/u)
    expect(dump).toContain('name: \'@agi-fans/dsh-tui\'')
    expect(dump).not.toContain('mcp.json')
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
      expect(patches[0]).toEqual({ id: 'tui', disabled: true })
      expect(patches[1]).toEqual(expect.objectContaining({
        insert: [expect.objectContaining({
          config: expect.objectContaining({ headers: { Authorization: 'Bearer from-env' } }),
        })],
      }))
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
