import type { Context } from '@deepseek-ai/cordis'
import type { McpManagedServerStatus, McpManagedServerView } from '@deepseek-ai/dsh-mcp-manager'
import { describe, expect, it, vi } from 'vitest'
import type { TuiPrompt } from '../definition.ts'
import {
  MCP_MANAGER_NS,
  MCP_SETTINGS_ID,
  formatMcpProbeResult,
  formatMcpStatus,
  manageMcpServer,
  mcpSettingsEntry,
  parseMcpArgs,
  parseMcpKeyValues,
  promptAddMcpServer,
} from './mcp-settings.ts'

describe('MCP status, probe, and input formatting', () => {
  it('formats all managed and client status states without inventing connection facts', () => {
    const cases: Array<[McpManagedServerStatus | undefined, string]> = [
      [undefined, 'not mounted'],
      [{ state: 'connected', toolCount: 4, connectedAt: 1_000 }, 'connected · 4 tools'],
      [{ state: 'connecting', attempt: 0 }, 'connecting'],
      [{ state: 'connecting', attempt: 2 }, 'connecting (attempt 3)'],
      [{ state: 'waiting-credentials', lastError: 'Missing MCP_TOKEN' }, 'waiting for credentials · Missing MCP_TOKEN'],
      [{ state: 'reconnecting', attempt: 1, maxAttempts: 5, nextRetryAtMs: 2_000, lastError: 'ECONNREFUSED' }, 'reconnecting (1/5) · ECONNREFUSED'],
      [{ state: 'disabled' }, 'disabled'],
      [{ state: 'closed', result: { closeConfirmed: true } }, 'closed'],
      [{ state: 'failed', reason: 'gave-up', lastError: 'Timed out' }, 'failed (gave-up) · Timed out'],
      [{ state: 'failed', reason: 'cleanup', result: { closeConfirmed: false, cleanupError: 'hung child' } }, 'failed (cleanup) · hung child'],
    ]
    for (const [status, expected] of cases) {
      expect(formatMcpStatus(status)).toBe(expected)
    }
  })

  it('formats successful and failed probe results including cleanup warnings', () => {
    expect(formatMcpProbeResult('docs', {
      ok: true,
      serverInfo: { name: 'docs-mcp', version: '1.2.0' },
      toolNames: ['search', 'read'],
      truncated: false,
      durationMs: 42.3,
      closeConfirmed: true,
    })).toBe('Probe succeeded (42ms) · docs-mcp 1.2.0 · Tools: 2\n`search`, `read`')

    expect(formatMcpProbeResult('docs', {
      ok: false,
      stage: 'connect',
      message: '401 Unauthorized',
      durationMs: 18,
      closeConfirmed: false,
    })).toContain('Probe failed during connect (18ms): 401 Unauthorized\nProbe cleanup warning: transport closure was not confirmed')
  })

  it('parses command arguments and key-value pairs cleanly', () => {
    expect(parseMcpArgs('')).toEqual([])
    expect(parseMcpArgs('-y "@modelcontextprotocol/server-filesystem" /tmp/work')).toEqual([
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '/tmp/work',
    ])
    expect(parseMcpArgs('["--port", "8080"]')).toEqual(['--port', '8080'])
    expect(() => parseMcpArgs('"unterminated')).toThrow(/Unterminated/u)

    expect(parseMcpKeyValues('API_KEY=${credential:MY_KEY}\nMODE=prod', 'env')).toEqual({
      API_KEY: '${credential:MY_KEY}',
      MODE: 'prod',
    })
    expect(parseMcpKeyValues('Authorization: Bearer ${credential:TOKEN}; X-Env=staging', 'headers')).toEqual({
      Authorization: 'Bearer ${credential:TOKEN}',
      'X-Env': 'staging',
    })
  })
})

describe('runtime MCP server CRUD and actions', () => {
  function fixture() {
    let revision = 1
    const userServers: Record<string, Record<string, unknown>> = {}
    const baseServers: Record<string, Record<string, unknown>> = {
      inherited: { transport: 'stdio', command: 'echo', enabled: true },
    }
    const views = new Map<string, McpManagedServerView>([
      ['inherited', { name: 'inherited', configured: true, status: { state: 'connected', toolCount: 2, connectedAt: 100 } }],
    ])

    const describeSettings = () => [{
      ns: MCP_MANAGER_NS,
      autoGenerate: true,
      schema: {},
      revision,
      base: { servers: structuredClone(baseServers) },
      user: { servers: structuredClone(userServers) },
      value: { servers: { ...structuredClone(baseServers), ...structuredClone(userServers) } },
      applies: 'live' as const,
    }]

    const update = vi.fn(async (_ns: string, patch: { servers?: Record<string, Record<string, unknown>> }, expectedRevision?: number) => {
      expect(expectedRevision).toBe(revision)
      revision++
      for (const [name, partial] of Object.entries(patch.servers ?? {})) {
        userServers[name] = { ...(baseServers[name] ?? {}), ...(userServers[name] ?? {}), ...partial }
        const enabled = userServers[name]!.enabled !== false
        views.set(name, {
          name,
          configured: true,
          status: enabled ? { state: 'connecting', attempt: 0 } : { state: 'disabled' },
        })
      }
    })

    const mutate = vi.fn(async (_ns: string, ops: readonly { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }[], expectedRevision?: number) => {
      expect(expectedRevision).toBe(revision)
      revision++
      for (const op of ops) {
        const name = op.path[1]!
        if (op.op === 'set') {
          userServers[name] = op.value as Record<string, unknown>
          views.set(name, { name, configured: true, status: { state: 'connecting', attempt: 0 } })
        } else {
          delete userServers[name]
          if (!Object.hasOwn(baseServers, name)) views.delete(name)
          else views.set(name, { name, configured: true, status: { state: 'connected', toolCount: 2, connectedAt: 100 } })
        }
      }
    })

    const probe = vi.fn(async (name: string) => ({
      ok: true as const,
      serverInfo: { name, version: '1.0.0' },
      toolNames: ['ping'],
      truncated: false,
      durationMs: 12,
      closeConfirmed: true,
    }))
    const restart = vi.fn(async (_name: string) => {})
    const prompt = vi.fn(async (_req: TuiPrompt): Promise<string | null> => null)
    const notice = vi.fn()

    const ctx = {
      get: (service: string) => {
        if (service === 'mcpManager') return { list: () => [...views.values()], probe, restart, watch: async function* () { yield [...views.values()] } }
        if (service === 'settings') return { writable: true, describe: describeSettings, update, mutate }
        if (service === 'tui') return { prefs: () => ({ uiLanguage: 'en' }), prompt, notice }
        return undefined
      },
      settings: { writable: true, describe: describeSettings, update, mutate },
      tui: { prefs: () => ({ uiLanguage: 'en' }), prompt, notice },
    } as unknown as Context

    return { ctx, prompt, notice, update, mutate, probe, restart }
  }

  it('adds a Streamable HTTP server with template validation and manages probe, toggle, restart, and removal', async () => {
    const h = fixture()
    const abort = new AbortController()

    expect(mcpSettingsEntry(h.ctx)).toEqual([
      expect.objectContaining({ id: MCP_SETTINGS_ID, summary: '1/1 connected' }),
    ])

    h.prompt
      .mockResolvedValueOnce('remote_docs')
      .mockResolvedValueOnce('streamable-http')
      .mockResolvedValueOnce('https://mcp.example.com/sse')
      .mockResolvedValueOnce('Authorization=Bearer ${credential:MCP_DOCS_TOKEN}')

    const added = await promptAddMcpServer(h.ctx, h.ctx.tui, abort.signal)
    expect(added).toBe('remote_docs')
    expect(h.mutate).toHaveBeenCalledWith(
      MCP_MANAGER_NS,
      [{
        op: 'set',
        path: ['servers', 'remote_docs'],
        value: {
          transport: 'streamable-http',
          url: 'https://mcp.example.com/sse',
          headers: { Authorization: 'Bearer ${credential:MCP_DOCS_TOKEN}' },
          enabled: true,
        },
      }],
      1,
    )

    h.prompt
      .mockResolvedValueOnce('probe')
      .mockResolvedValueOnce('toggle')
      .mockResolvedValueOnce('restart')
      .mockResolvedValueOnce('unset')
      .mockResolvedValueOnce('accept')

    await manageMcpServer(h.ctx, h.ctx.tui, 'remote_docs', abort.signal)
    expect(h.probe).toHaveBeenCalledWith('remote_docs', { signal: abort.signal })
    expect(h.update).toHaveBeenCalledWith(MCP_MANAGER_NS, { servers: { remote_docs: { enabled: false } } }, 2)
    expect(h.restart).toHaveBeenCalledWith('remote_docs')
    expect(h.mutate).toHaveBeenLastCalledWith(MCP_MANAGER_NS, [{ op: 'unset', path: ['servers', 'remote_docs'] }], 3)
  })
})
