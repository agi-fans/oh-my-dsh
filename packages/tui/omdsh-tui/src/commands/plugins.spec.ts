import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as commandSession from './session.ts'
import * as commandSteer from './steer.ts'
import * as commandLoop from './loop.ts'
import * as commandExport from './export.ts'
import type { TuiService } from '../definition.ts'
import type { SessionRuntime } from '../session/session-controller.ts'

describe('omdsh command plugins', () => {
  it('registers transcript export without a search command', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const fiber = await ctx.plugin(commandExport)
    const session = ctx.sessions.create(SessionId('command-export-test'))
    const agent = { id: session.id, session, status: 'idle' } as unknown as Agent

    expect(ctx.commands.list(agent).map(command => command.name)).toEqual(['export'])

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('registers steering for active turns without queue-management slash commands', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const steer = vi.fn()
    const fiber = await ctx.plugin(commandSteer)
    const session = ctx.sessions.create(SessionId('command-steer-test'))
    const agent = {
      id: session.id,
      session,
      status: 'running',
      inbox: { nextTurn: [], nextStep: [] },
      steer,
    } as unknown as Agent

    expect(ctx.commands.list(agent).map(command => command.name)).toEqual(['steer'])
    await expect(ctx.commands.execute(agent, '/steer focus on tests', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'success' } })
    expect(steer).toHaveBeenCalledOnce()

    agent.status = 'idle'
    await expect(ctx.commands.execute(agent, '/steer too late', [], new AbortController().signal))
      .resolves.toMatchObject({
        result: {
          kind: 'error',
          text: expect.stringContaining('only available during an active turn'),
        },
      })
    expect(steer).toHaveBeenCalledOnce()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('registers Loop through the scoped command registry and sends inline prompts through the session runtime', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const session = ctx.sessions.create(SessionId('command-loop-test'))
    const agent = {
      id: session.id,
      session,
      status: 'idle',
      whenIdle: () => new Promise<void>(() => {}),
    } as unknown as Agent
    const send = vi.fn(async () => undefined)
    ctx.provide('omdshSession', {
      agent,
      assertActive: vi.fn(),
      send,
    } as unknown as SessionRuntime)
    ctx.provide('tui', {
      setLoopStatus: vi.fn(),
      notice: vi.fn(),
    } as unknown as TuiService)

    const fiber = await ctx.plugin(commandLoop)
    expect(ctx.commands.list(agent).map(command => command.name)).toEqual(['loop'])
    const execution = await ctx.commands.execute(agent, '/loop 2 inspect tests', [], new AbortController().signal)
    expect(execution).toMatchObject({ result: { kind: 'success' } })
    expect(execution?.result.text).toBeUndefined()
    expect(send).toHaveBeenCalledWith({ text: 'inspect tests', images: [] }, agent)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('registers session commands through dsh-commands and removes them with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const newSession = vi.fn(async () => undefined)
    const runtime = {
      newSession,
      refreshRecent: vi.fn(async () => undefined),
      recentSessions: [],
      selection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
      reasoningEffort: () => 'high',
      stats: () => ({ turns: 0, steps: 0, inputTokens: 0, outputTokens: 0 }),
      controls: () => ({
        agentPreset: 'standard',
        tools: 'native',
        plan: { active: true, pending: false },
        permission: 'workspace-write',
      }),
      send: vi.fn(),
    } as unknown as SessionRuntime
    const tui = { prompt: vi.fn() } as unknown as TuiService
    ctx.provide('omdshSession', runtime)
    ctx.provide('tui', tui)
    const fiber = await ctx.plugin(commandSession)
    const session = ctx.sessions.create(SessionId('command-plugin-test'))
    const agent = {
      id: session.id,
      session,
      status: 'idle',
      inbox: { nextTurn: [], nextStep: [] },
    } as unknown as Agent

    expect(ctx.commands.list(agent).map(command => command.name)).toEqual(['new', 'resume', 'retry', 'session', 'todo'])
    await expect(ctx.commands.execute(agent, '/new', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'success', text: 'Started a new session.' } })
    expect(newSession).toHaveBeenCalledWith(agent)
    expect(session.events.filter(event => event.type === 'command/run' || event.type === 'command/done').map(event => event.type))
      .toEqual(['command/run', 'command/done'])

    const details = await ctx.commands.execute(agent, '/session', [], new AbortController().signal)
    expect(details).toBeDefined()
    if (details === undefined) throw new Error('/session was not resolved')
    expect(details.result).toMatchObject({
      kind: 'success',
      text: expect.stringContaining('| Workflow | Plan |'),
    })
    expect(details.result).toMatchObject({ text: expect.stringContaining('| Agent | Standard |') })
    expect(details.result).toMatchObject({ text: expect.stringContaining('| Tools | Native |') })
    expect(details.result).toMatchObject({ text: expect.stringContaining('| Access | Workspace write |') })
    expect(details.result).toMatchObject({ text: expect.stringContaining('| Reasoning | `high` |') })

    await fiber.dispose()
    expect(ctx.commands.list(agent)).toEqual([])
    await ctx.fiber.dispose()
  })
})
