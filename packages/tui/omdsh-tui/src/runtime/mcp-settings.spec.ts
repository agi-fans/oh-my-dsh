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
      [{ state: 'waiting-authorization', reason: 'missing', lastError: 'Sign in required' }, 'waiting for authorization · Sign in required'],
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
      .mockResolvedValueOnce('bad server name')
      .mockResolvedValueOnce('remote_docs')
      .mockResolvedValueOnce('streamable-http')
      .mockResolvedValueOnce('https://mcp.example.com/sse')
      .mockResolvedValueOnce('Authorization')
      .mockResolvedValueOnce('Authorization=Bearer ${credential:MCP_DOCS_TOKEN}')

    const added = await promptAddMcpServer(h.ctx, h.ctx.tui, abort.signal)
    expect(added).toBe('remote_docs')
    expect(h.prompt.mock.calls[1]?.[0]).toMatchObject({ initialInput: 'bad server name', detail: expect.stringContaining('Server name must match') })
    expect(h.prompt.mock.calls[5]?.[0]).toMatchObject({ initialInput: 'Authorization', detail: expect.stringContaining('Header=Value') })
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

  it('runs browser OAuth authorization, cancellation, and sign-out for managed servers awaiting authorization', async () => {
    const abort = new AbortController()
    let currentView: McpManagedServerView = {
      name: 'oauth_docs',
      configured: true,
      status: { state: 'waiting-authorization', reason: 'missing', lastError: 'Sign in required' },
    }
    const watchers: Array<(views: McpManagedServerView[]) => void> = []
    const startAuthorization = vi.fn(async () => {
      const attempt = {
        id: 'attempt-1' as never,
        phase: 'waiting-browser' as const,
        authorizationUrl: 'https://auth.example.com/authorize?state=1',
      }
      currentView = { ...currentView, authorization: attempt }
      return attempt
    })
    const cancelAuthorization = vi.fn(async () => {
      currentView = {
        ...currentView,
        authorization: { id: 'attempt-1' as never, phase: 'cancelled' },
      }
    })
    const signOut = vi.fn(async () => {
      currentView = {
        name: 'oauth_docs',
        configured: true,
        status: { state: 'waiting-authorization', reason: 'missing' },
      }
    })
    const describeSettings = () => [{
      ns: MCP_MANAGER_NS,
      autoGenerate: true,
      schema: {},
      revision: 1,
      base: { servers: {} },
      user: { servers: { oauth_docs: { transport: 'streamable-http', url: 'https://mcp.example.com', oauth: {}, enabled: true } } },
      value: { servers: { oauth_docs: { transport: 'streamable-http', url: 'https://mcp.example.com', oauth: {}, enabled: true } } },
      applies: 'live' as const,
    }]
    const prompt = vi.fn(async (req: TuiPrompt): Promise<string | null> => {
      if (req.question === 'Complete authorization in your browser, then return here.') {
        expect(req.detail).toBe('https://auth.example.com/authorize?state=1')
        return 'cancel'
      }
      return null
    })
    const ctx = {
      get: (service: string) => {
        if (service === 'mcpManager') {
          return {
            list: () => [currentView],
            probe: vi.fn(),
            restart: vi.fn(),
            startAuthorization,
            cancelAuthorization,
            signOut,
            watch: async function* (signal?: AbortSignal) {
              while (!signal?.aborted) {
                const next = await new Promise<McpManagedServerView[] | null>((resolve) => {
                  const onAbort = () => resolve(null)
                  signal?.addEventListener('abort', onAbort, { once: true })
                  watchers.push((views) => { signal?.removeEventListener('abort', onAbort); resolve(views) })
                })
                if (next === null) break
                yield next
              }
            },
          }
        }
        if (service === 'settings') return { writable: true, describe: describeSettings, update: vi.fn(), mutate: vi.fn() }
        if (service === 'tui') return { prefs: () => ({ uiLanguage: 'en' }), prompt, notice: vi.fn() }
        return undefined
      },
      settings: { writable: true, describe: describeSettings, update: vi.fn(), mutate: vi.fn() },
      tui: { prefs: () => ({ uiLanguage: 'en' }), prompt, notice: vi.fn() },
    } as unknown as Context

    // 1. Cancel during waiting-browser invokes cancelAuthorization.
    prompt
      .mockResolvedValueOnce('authorize')
      .mockImplementationOnce(async (req) => {
        expect(req.detail).toBe('https://auth.example.com/authorize?state=1')
        return 'cancel'
      })
      .mockResolvedValueOnce('back')
    await manageMcpServer(ctx, ctx.tui, 'oauth_docs', abort.signal, undefined, { openBrowser: false })
    expect(startAuthorization).toHaveBeenCalledWith('oauth_docs')
    expect(cancelAuthorization).toHaveBeenCalledWith('oauth_docs', 'attempt-1')
    expect(prompt.mock.calls[0]?.[0].options).toContainEqual(expect.objectContaining({ value: 'authorize', label: 'Authorize in browser' }))
    expect(prompt.mock.calls[2]?.[0].detail).toContain('Authorization cancelled.')

    // 2. Completing browser auth via watch settles cleanly, then Sign out invokes signOut.
    prompt.mockReset()
    prompt
      .mockResolvedValueOnce('authorize')
      .mockImplementationOnce(async (req) => {
        currentView = {
          name: 'oauth_docs',
          configured: true,
          status: { state: 'connected', toolCount: 2, connectedAt: 999 },
          authorization: { id: 'attempt-1' as never, phase: 'authorized' },
        }
        for (const notify of watchers.splice(0)) notify([currentView])
        await new Promise<void>(resolve => req.signal?.addEventListener('abort', () => resolve(), { once: true }))
        return null
      })
      .mockResolvedValueOnce('sign-out')
      .mockResolvedValueOnce('accept')
      .mockResolvedValueOnce('back')
    await manageMcpServer(ctx, ctx.tui, 'oauth_docs', abort.signal, undefined, { openBrowser: false })
    expect(prompt.mock.calls[2]?.[0].detail).toContain('Authorized MCP server "oauth_docs".')
    expect(prompt.mock.calls[2]?.[0].options).toContainEqual(expect.objectContaining({ value: 'sign-out', label: 'Sign out' }))
    expect(signOut).toHaveBeenCalledWith('oauth_docs')
  })

  it('does not cancel slow OAuth discovery past 4 seconds and reports real cancellation failures or admitted commits', async () => {
    vi.useFakeTimers()
    try {
      const abort = new AbortController()
      let currentView: McpManagedServerView = {
        name: 'oauth_slow',
        configured: true,
        status: { state: 'waiting-authorization', reason: 'missing' },
      }
      const watchers: Array<(views: McpManagedServerView[]) => void> = []
      const notifyWatchers = () => { for (const notify of watchers.splice(0)) notify([currentView]) }
      const startAuthorization = vi.fn(async () => {
        const attempt = { id: 'attempt-slow' as never, phase: 'starting' as const }
        currentView = { ...currentView, authorization: attempt }
        return attempt
      })
      const cancelAuthorization = vi.fn(async () => {
        currentView = { ...currentView, authorization: { id: 'attempt-slow' as never, phase: 'cancelled' } }
      })
      const describeSettings = () => [{
        ns: MCP_MANAGER_NS,
        autoGenerate: true,
        schema: {},
        revision: 1,
        base: { servers: {} },
        user: { servers: { oauth_slow: { transport: 'streamable-http', url: 'https://mcp.example.com', oauth: {}, enabled: true } } },
        value: { servers: { oauth_slow: { transport: 'streamable-http', url: 'https://mcp.example.com', oauth: {}, enabled: true } } },
        applies: 'live' as const,
      }]
      const prompt = vi.fn(async (_req: TuiPrompt): Promise<string | null> => null)
      const ctx = {
        get: (service: string) => {
          if (service === 'mcpManager') {
            return {
              list: () => [currentView],
              probe: vi.fn(),
              restart: vi.fn(),
              startAuthorization,
              cancelAuthorization,
              watch: async function* (signal?: AbortSignal) {
                while (!signal?.aborted) {
                  const next = await new Promise<McpManagedServerView[] | null>((resolve) => {
                    const onAbort = () => resolve(null)
                    signal?.addEventListener('abort', onAbort, { once: true })
                    watchers.push((views) => { signal?.removeEventListener('abort', onAbort); resolve(views) })
                  })
                  if (next === null) break
                  yield next
                }
              },
            }
          }
          if (service === 'settings') return { writable: true, describe: describeSettings, update: vi.fn(), mutate: vi.fn() }
          if (service === 'tui') return { prefs: () => ({ uiLanguage: 'en' }), prompt, notice: vi.fn() }
          return undefined
        },
        settings: { writable: true, describe: describeSettings, update: vi.fn(), mutate: vi.fn() },
        tui: { prefs: () => ({ uiLanguage: 'en' }), prompt, notice: vi.fn() },
      } as unknown as Context

      // 1. Slow discovery (>4s) stays alive until watch emits waiting-browser, then completes.
      let discoveryStarted!: () => void
      const discoveryReady = new Promise<void>(resolve => { discoveryStarted = resolve })
      prompt
        .mockResolvedValueOnce('authorize')
        .mockImplementationOnce(async (req) => {
          expect(req.question).toBe('Discovering OAuth authorization server...')
          discoveryStarted()
          await new Promise<void>(resolve => req.signal?.addEventListener('abort', () => resolve(), { once: true }))
          return null
        })
        .mockImplementationOnce(async (req) => {
          expect(req.question).toBe('Complete authorization in your browser, then return here.')
          expect(req.detail).toBe('https://auth.example.com/slow?a=1&b=2')
          currentView = {
            name: 'oauth_slow',
            configured: true,
            status: { state: 'connected', toolCount: 1, connectedAt: 2000 },
            authorization: { id: 'attempt-slow' as never, phase: 'authorized' },
          }
          notifyWatchers()
          await new Promise<void>(resolve => req.signal?.addEventListener('abort', () => resolve(), { once: true }))
          return null
        })
        .mockResolvedValueOnce('back')

      const slowFlow = manageMcpServer(ctx, ctx.tui, 'oauth_slow', abort.signal, undefined, { openBrowser: false })
      await discoveryReady
      await vi.advanceTimersByTimeAsync(6_500)
      expect(cancelAuthorization).not.toHaveBeenCalled()
      currentView = {
        ...currentView,
        authorization: { id: 'attempt-slow' as never, phase: 'waiting-browser', authorizationUrl: 'https://auth.example.com/slow?a=1&b=2' },
      }
      notifyWatchers()
      await slowFlow
      expect(cancelAuthorization).not.toHaveBeenCalled()
      expect(prompt.mock.calls[3]?.[0].detail).toContain('Authorized MCP server "oauth_slow".')

      // 2. Failed cancelAuthorization surfaces the real error instead of claiming cancellation succeeded.
      prompt.mockReset()
      cancelAuthorization.mockRejectedValueOnce(new Error('MCP OAuth cleanup did not settle'))
      currentView = {
        name: 'oauth_slow',
        configured: true,
        status: { state: 'waiting-authorization', reason: 'missing' },
        authorization: { id: 'attempt-fail-cancel' as never, phase: 'waiting-browser', authorizationUrl: 'https://auth.example.com/x' },
      }
      prompt.mockResolvedValueOnce('cancel-auth').mockResolvedValueOnce('back')
      await manageMcpServer(ctx, ctx.tui, 'oauth_slow', abort.signal, undefined, { openBrowser: false })
      expect(prompt.mock.calls[1]?.[0].detail).toContain('Failed to cancel authorization: MCP OAuth cleanup did not settle')
      expect(prompt.mock.calls[1]?.[0].detail).not.toContain('Authorization cancelled.')

      // 3. Cancellation racing an already-admitted commit reports the actual authorized outcome.
      prompt.mockReset()
      cancelAuthorization.mockImplementationOnce(async () => {
        currentView = {
          name: 'oauth_slow',
          configured: true,
          status: { state: 'connected', toolCount: 1, connectedAt: 3000 },
          authorization: { id: 'attempt-admitted' as never, phase: 'authorized' },
        }
      })
      currentView = {
        name: 'oauth_slow',
        configured: true,
        status: { state: 'waiting-authorization', reason: 'missing' },
        authorization: { id: 'attempt-admitted' as never, phase: 'committing' },
      }
      prompt.mockResolvedValueOnce('cancel-auth').mockResolvedValueOnce('back')
      await manageMcpServer(ctx, ctx.tui, 'oauth_slow', abort.signal, undefined, { openBrowser: false })
      expect(prompt.mock.calls[1]?.[0].detail).toContain('Authorized MCP server "oauth_slow".')
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to polling when watch() throws during OAuth discovery so authorization still progresses', async () => {
    vi.useFakeTimers()
    try {
      const abort = new AbortController()
      let currentView: McpManagedServerView = {
        name: 'oauth_fallback',
        configured: true,
        status: { state: 'waiting-authorization', reason: 'missing' },
      }
      const startAuthorization = vi.fn(async () => {
        const attempt = { id: 'attempt-fallback' as never, phase: 'starting' as const }
        currentView = { ...currentView, authorization: attempt }
        return attempt
      })
      const describeSettings = () => [{
        ns: MCP_MANAGER_NS,
        autoGenerate: true,
        schema: {},
        revision: 1,
        base: { servers: {} },
        user: { servers: { oauth_fallback: { transport: 'streamable-http', url: 'https://mcp.example.com', oauth: {}, enabled: true } } },
        value: { servers: { oauth_fallback: { transport: 'streamable-http', url: 'https://mcp.example.com', oauth: {}, enabled: true } } },
        applies: 'live' as const,
      }]
      let discoveryStarted!: () => void
      const discoveryReady = new Promise<void>(resolve => { discoveryStarted = resolve })
      const prompt = vi.fn(async (_req: TuiPrompt): Promise<string | null> => null)
      prompt
        .mockResolvedValueOnce('authorize')
        .mockImplementationOnce(async (req) => {
          expect(req.question).toBe('Discovering OAuth authorization server...')
          discoveryStarted()
          await new Promise<void>(resolve => req.signal?.addEventListener('abort', () => resolve(), { once: true }))
          return null
        })
        .mockImplementationOnce(async (req) => {
          expect(req.question).toBe('Complete authorization in your browser, then return here.')
          expect(req.detail).toBe('https://auth.example.com/fallback')
          currentView = {
            name: 'oauth_fallback',
            configured: true,
            status: { state: 'connected', toolCount: 1, connectedAt: 4000 },
            authorization: { id: 'attempt-fallback' as never, phase: 'authorized' },
          }
          await new Promise<void>(resolve => req.signal?.addEventListener('abort', () => resolve(), { once: true }))
          return null
        })
        .mockResolvedValueOnce('back')
      const ctx = {
        get: (service: string) => {
          if (service === 'mcpManager') {
            return {
              list: () => [currentView],
              probe: vi.fn(),
              restart: vi.fn(),
              startAuthorization,
              cancelAuthorization: vi.fn(),
              watch: async function* () {
                throw new Error('watch stream disconnected')
              },
            }
          }
          if (service === 'settings') return { writable: true, describe: describeSettings, update: vi.fn(), mutate: vi.fn() }
          if (service === 'tui') return { prefs: () => ({ uiLanguage: 'en' }), prompt, notice: vi.fn() }
          return undefined
        },
        settings: { writable: true, describe: describeSettings, update: vi.fn(), mutate: vi.fn() },
        tui: { prefs: () => ({ uiLanguage: 'en' }), prompt, notice: vi.fn() },
      } as unknown as Context

      const flow = manageMcpServer(ctx, ctx.tui, 'oauth_fallback', abort.signal, undefined, { openBrowser: false })
      await discoveryReady
      currentView = {
        ...currentView,
        authorization: { id: 'attempt-fallback' as never, phase: 'waiting-browser', authorizationUrl: 'https://auth.example.com/fallback' },
      }
      await vi.advanceTimersByTimeAsync(600)
      await flow
      expect(prompt.mock.calls[3]?.[0].detail).toContain('Authorized MCP server "oauth_fallback".')
    } finally {
      vi.useRealTimers()
    }
  })
})
