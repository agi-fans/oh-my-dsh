import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Commands from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as command from './integrations.ts'

describe('/mcp', () => {
  it.each([true, false])('shows failed and disabled registrations without inferring transport health (interactive=%s)', async interactive => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(Commands)
    const prompt = vi.fn(async () => null)
    ctx.provide('tui', { prompt, interactive } as never)
    ctx.provide('pluginManager', { listPlugins: async () => [
      { entryId: 'mcp-failed', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: true, fiberPhase: 'failed' },
      { entryId: 'mcp-disabled', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: false },
      { entryId: 'bash', moduleName: '@deepseek-ai/dsh-bash', enabled: true },
    ] } as never)
    await ctx.plugin(command)
    const session = ctx.sessions.create(SessionId('mcp-diagnostics'))
    try {
      const result = (await ctx.commands.execute({ id: session.id, session } as Agent, '/mcp', [], new AbortController().signal))?.result
      expect(result?.kind).toBe('success')
      if (!interactive) {
        expect(prompt).not.toHaveBeenCalled()
        expect(result?.text).toContain('mcp-failed · failed')
        return
      }
      const request = prompt.mock.calls[0]?.[0] as unknown as import('../definition.ts').TuiPrompt
      expect(request).toMatchObject({ presentation: 'document', notify: false })
      expect(request.documentSource?.text).toContain('mcp-failed · failed')
      expect(request.documentSource?.text).toContain('mcp-disabled · disabled')
      expect(request.documentSource?.text).not.toContain('bash')
      expect(request.documentSource?.text).toContain('do not verify transport health or authentication')
      expect(request.documentSource?.text).not.toContain('0 connected')
    } finally { await ctx.fiber.dispose() }
  })
})
