import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as adapter from './session-controller.ts'

function fakeAgent(id: string): Agent {
  return { id, session: { id }, followup: vi.fn(), status: 'idle' } as unknown as Agent
}

function fakeHandle(agent: Agent): AgentHandle {
  return { agent, dispose: vi.fn(async () => undefined) } as unknown as AgentHandle
}

async function fixture(options: { live?: Agent, stored?: { formatStatus: 'current' | 'migration-required' } | undefined }) {
  const ctx = new Context()
  const resume = vi.fn(async () => fakeHandle(fakeAgent('cold-agent')))
  const agents = {
    get: vi.fn((id: SessionId) => options.live?.id === id ? options.live : undefined),
    resume,
  }
  ctx.provide('agents', agents as never)
  ctx.provide('sessions', {} as never)
  ctx.provide('sessionPersistence', {
    stat: vi.fn(async () => options.stored),
  } as never)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
  } as never)
  ctx.provide('agentPresets', {} as never)
  ctx.provide('sessionProjections', {} as never)
  await ctx.plugin(adapter)
  const controller = ctx.get('sessionController') as {
    resolveAgent(id: SessionId): Promise<{ agent: Agent } | { error: Error }>
  }
  return { ctx, controller, agents, resume }
}

describe('background session controller', () => {
  it('returns a live Agent without resuming anything', async () => {
    const live = fakeAgent('live-session')
    const f = await fixture({ live })
    try {
      const resolved = await f.controller.resolveAgent(SessionId('live-session'))
      expect(resolved).toEqual({ agent: live })
      expect(f.agents.resume).not.toHaveBeenCalled()
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it('resumes a cold Session once and reuses the resident Agent', async () => {
    const f = await fixture({ stored: { formatStatus: 'current' } })
    try {
      const first = await f.controller.resolveAgent(SessionId('cold-session'))
      const second = await f.controller.resolveAgent(SessionId('cold-session'))
      expect(first).toHaveProperty('agent')
      expect(second).toHaveProperty('agent')
      if (!('agent' in first) || !('agent' in second)) throw new Error('expected resolved agents')
      expect(second.agent).toBe(first.agent)
      expect(f.agents.resume).toHaveBeenCalledOnce()
      expect(f.agents.resume).toHaveBeenCalledWith(expect.objectContaining({
        resumeSessionId: SessionId('cold-session'),
        agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      }))
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it('reports a missing Session instead of resuming', async () => {
    const f = await fixture({ stored: undefined })
    try {
      const resolved = await f.controller.resolveAgent(SessionId('missing-session'))
      expect('error' in resolved && resolved.error.message).toMatch(/was not found/u)
      expect(f.agents.resume).not.toHaveBeenCalled()
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it('refuses a Session that still needs migration', async () => {
    const f = await fixture({ stored: { formatStatus: 'migration-required' } })
    try {
      const resolved = await f.controller.resolveAgent(SessionId('old-session'))
      expect('error' in resolved && resolved.error.message).toMatch(/requires migration/u)
    } finally {
      await f.ctx.fiber.dispose()
    }
  })
})
