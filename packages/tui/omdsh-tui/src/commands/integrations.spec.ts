import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Commands from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TuiPrompt } from '../definition.ts'
import * as command from './integrations.ts'

async function fixture(interactive = true, uiLanguage: 'en' | 'zh-CN' = 'en') {
  const ctx = new Context(); await ctx.plugin(SessionStore); await ctx.plugin(Commands)
  const prompt = vi.fn(async (_request: TuiPrompt): Promise<string | null> => null)
  const listPlugins = vi.fn(async () => [
    { entryId: 'mcp-failed', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: true, fiberPhase: 'failed', diagnostic: 'Server executable could not start' },
    { entryId: 'mcp-disabled', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: false },
    { entryId: 'bash', moduleName: '@deepseek-ai/dsh-bash', enabled: true },
  ])
  const schemas = vi.fn(() => [{ name: 'mcp__docs__search', description: 'Search documents' }])
  ctx.provide('tui', { prompt, interactive, prefs: () => ({ uiLanguage }) } as never)
  ctx.provide('pluginManager', { listPlugins } as never)
  ctx.provide('tools', { schemas } as never)
  await ctx.plugin(command)
  const session = ctx.sessions.create(SessionId('mcp-diagnostics'))
  const abort = new AbortController()
  const execute = (line = '/mcp') => ctx.commands.execute({ id: session.id, session } as Agent, line, [], abort.signal)
  return { ctx, prompt, listPlugins, schemas, session, abort, execute }
}

describe('/mcp diagnostics', () => {
  it('prints a truthful snapshot for line mode, including startup failure details', async () => {
    const h = await fixture(false)
    try {
      const result = (await h.execute())?.result
      expect(result?.kind).toBe('success'); expect(h.prompt).not.toHaveBeenCalled()
      expect(result?.text).toContain('mcp-failed · failed')
      expect(result?.text).toContain('mcp-disabled · disabled')
      expect(result?.text).toContain('Server executable could not start')
      expect(result?.text).toContain('do not verify transport health or authentication')
      expect(result?.text).not.toContain('0 connected')
      expect(result?.text).not.toContain('bash')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('offers keyboard navigation, reads details and refreshes without restarting servers', async () => {
    const h = await fixture()
    h.prompt.mockResolvedValueOnce('entry:0').mockResolvedValueOnce(null).mockResolvedValueOnce('tools').mockResolvedValueOnce(null)
      .mockResolvedValueOnce('refresh').mockResolvedValueOnce(null)
    try {
      await h.execute()
      expect(h.prompt.mock.calls[0]![0].options).toContainEqual(expect.objectContaining({ label: 'mcp-failed', description: 'failed' }))
      expect(h.prompt.mock.calls[1]![0].documentSource?.text).toContain('Server executable could not start')
      expect(h.prompt.mock.calls[3]![0].documentSource?.text).toContain('Search documents')
      expect(h.listPlugins).toHaveBeenCalledTimes(2)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('translates diagnostic chrome while retaining tool and server content', async () => {
    const h = await fixture(true, 'zh-CN')
    h.prompt.mockResolvedValueOnce('tools').mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    try {
      await h.execute()
      expect(h.prompt.mock.calls[0]![0].title).toBe('MCP 诊断')
      expect(h.prompt.mock.calls[0]![0].options).toContainEqual(expect.objectContaining({ label: 'mcp-failed', description: '失败' }))
      const text = h.prompt.mock.calls[1]![0].documentSource?.text
      expect(text).toContain('MCP 工具 · 服务器：1 · 工具：1')
      expect(text).toContain('| 工具 | 说明 |')
      expect(text).toContain('Search documents')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('retains the previous snapshot on refresh failure and recovers on the next refresh', async () => {
    const h = await fixture()
    h.listPlugins.mockRejectedValueOnce(new Error('temporary failure'))
    h.prompt.mockImplementationOnce(async request => {
      expect(request.detail).toContain('Could not load')
      return 'refresh'
    }).mockImplementationOnce(async request => {
      expect(request.options?.some(option => option.label === 'mcp-failed')).toBe(true)
      h.listPlugins.mockRejectedValueOnce(new Error('offline'))
      return 'refresh'
    }).mockImplementationOnce(async request => {
      expect(request.detail).toContain('last loaded state')
      expect(request.options?.some(option => option.label === 'mcp-failed')).toBe(true)
      return null
    })
    try { await h.execute() } finally { await h.ctx.fiber.dispose() }
  })

  it('does not open a stale page when cancellation lands during loading', async () => {
    const h = await fixture()
    h.listPlugins.mockImplementationOnce(async () => { h.abort.abort(); return [] })
    try {
      await expect(h.execute()).rejects.toMatchObject({ name: 'AbortError' })
      expect(h.prompt).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })
})

it('correlates native and PTC MCP results without treating missing results as successful', () => {
  const events = [
    { type: 'tool/call', seq: 1, data: { callId: 'a', name: 'mcp__docs__read' } },
    { type: 'tool/result', seq: 2, data: { message: { toolCallId: 'a', isError: true, content: [{ type: 'text', text: 'Permission denied by server' }] } } },
    { type: 'tool/ptc-dispatch-start', seq: 3, data: { subCallId: 'b', name: 'mcp__docs__list' } },
    { type: 'tool/ptc-dispatch', seq: 4, data: { subCallId: 'b', name: 'mcp__docs__list', isError: false, content: [] } },
    { type: 'tool/call', seq: 5, data: { callId: 'c', name: 'mcp__docs__search' } },
    { type: 'tool/call', seq: 6, data: { callId: 'd', name: 'bash' } },
  ] as unknown as SessionEvent[]
  expect(command.recentMcpCalls(events)).toEqual([
    { id: 'c', name: 'mcp__docs__search', seq: 5, outcome: 'No result recorded', detail: '' },
    { id: 'b', name: 'mcp__docs__list', seq: 3, outcome: 'Completed', detail: '' },
    { id: 'a', name: 'mcp__docs__read', seq: 1, outcome: 'Returned an error', detail: 'Permission denied by server' },
  ])
  expect(command.recentMcpCalls(JSON.parse(JSON.stringify(events)))).toEqual(command.recentMcpCalls(events))
})
