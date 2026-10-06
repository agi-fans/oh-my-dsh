import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as controls from './session.ts'

it('registers /queue through session controls and releases it on unload', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const openQueue = vi.fn(async () => {})
  ctx.provide('omdshSession', { openQueue } as never)
  ctx.provide('tui', {} as never)
  const fiber = await ctx.plugin(controls)
  const agent = { id: SessionId('queue-command'), session: ctx.sessions.create(SessionId('queue-command')), status: 'running' } as unknown as Agent
  try {
    expect(ctx.commands.list(agent).filter(command => command.name === 'queue')).toHaveLength(1)
    const signal = new AbortController().signal
    const invalid = await ctx.commands.execute(agent, '/queue unused', [], signal)
    expect(invalid?.result).toEqual({ kind: 'error', text: 'Usage: /queue' })
    expect(openQueue).not.toHaveBeenCalled()
    const result = await ctx.commands.execute(agent, '/queue', [], signal)
    expect(result?.result).toEqual({ kind: 'success' })
    expect(openQueue).toHaveBeenCalledOnce()
    expect(openQueue.mock.calls[0]?.[1]).toBe(agent)
    await fiber.dispose()
    expect(ctx.commands.list(agent)).toEqual([])
  } finally { await ctx.fiber.dispose() }
})
