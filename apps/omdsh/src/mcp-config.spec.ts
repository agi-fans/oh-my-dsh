import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadMcpPatches } from './mcp-config.ts'

const roots: string[] = []

function temp(name: string): string {
  const path = mkdtempSync(join(tmpdir(), name))
  roots.push(path)
  return path
}

function writeConfig(path: string, value: unknown): void {
  mkdirSync(join(path, '.dsh'), { recursive: true })
  writeFileSync(join(path, '.dsh', 'mcp.json'), JSON.stringify(value))
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('native MCP config', () => {
  it('maps stdio and HTTP servers to Harness plugin rows', () => {
    const cwd = temp('omdsh-mcp-project-')
    writeConfig(cwd, { mcpServers: {
      memory: { command: 'memory-server', args: ['--stdio'], env: { TOKEN: 'x' } },
      web: { url: 'https://example.test/mcp', headers: { Authorization: 'Bearer x' } },
      off: { command: 'ignored', enabled: false },
    } })
    expect(loadMcpPatches(cwd, { OMDSH_HOME: temp('omdsh-mcp-home-') })).toEqual([{ insert: [
      {
        id: 'mcp-memory',
        name: '@deepseek-ai/dsh-mcp-client',
        config: {
          serverName: 'memory', transport: 'stdio', command: 'memory-server',
          args: ['--stdio'], env: { TOKEN: 'x' },
        },
      },
      {
        id: 'mcp-web',
        name: '@deepseek-ai/dsh-mcp-client',
        config: {
          serverName: 'web', transport: 'streamable-http', url: 'https://example.test/mcp',
          headers: { Authorization: 'Bearer x' },
        },
      },
    ] }])
  })

  it('lets project definitions override user definitions', () => {
    const cwd = temp('omdsh-mcp-project-')
    const home = temp('omdsh-mcp-home-')
    mkdirSync(join(cwd, '.git'))
    writeFileSync(join(home, 'mcp.json'), JSON.stringify({ mcpServers: {
      shared: { command: 'user-server' },
      user: { command: 'user-only' },
    } }))
    writeConfig(cwd, { mcpServers: { shared: { command: 'project-server' } } })
    const rows = loadMcpPatches(join(cwd, 'nested'), { OMDSH_HOME: home })[0]?.insert ?? []
    expect(rows.map(row => [row.config.serverName, row.config.command])).toEqual([
      ['shared', 'project-server'], ['user', 'user-only'],
    ])
  })

  it('fails loud on malformed definitions', () => {
    const cwd = temp('omdsh-mcp-project-')
    writeConfig(cwd, { mcpServers: { broken: { args: ['missing-command'] } } })
    expect(() => loadMcpPatches(cwd, { OMDSH_HOME: temp('omdsh-mcp-home-') }))
      .toThrow('requires either a non-empty "command" or "url"')
  })

  it('expands environment placeholders and defaults', () => {
    const cwd = temp('omdsh-mcp-project-')
    writeConfig(cwd, { mcpServers: { web: {
      url: 'https://${MCP_HOST:-example.test}/mcp',
      headers: { Authorization: 'Bearer ${MCP_TOKEN}' },
    } } })
    const config = loadMcpPatches(cwd, {
      OMDSH_HOME: temp('omdsh-mcp-home-'), MCP_TOKEN: 'secret',
    })[0]?.insert[0]?.config
    expect(config).toMatchObject({
      url: 'https://example.test/mcp', headers: { Authorization: 'Bearer secret' },
    })
  })
})
