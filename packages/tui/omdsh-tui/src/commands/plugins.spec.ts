import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as commandSession from './session.ts'
import * as commandExport from './export.ts'
import * as commandTrajectory from './trajectory.ts'
import type { ChangeResult } from '@deepseek-ai/dsh-plugin-manager'
import type { TuiService } from '../definition.ts'
import type { SessionRuntime } from '../session/session-controller.ts'
import { changeText } from './plugins.ts'

describe('plugin change text', () => {
  it('reports why a change waits for a restart', () => {
    expect(changeText({
      changed: true, application: 'restart-required', restartReason: 'host-module',
      stage: 'enable', target: '@scope/plugin', enabled: true,
    } satisfies ChangeResult)).toBe('@scope/plugin: restart-required · enabled · restart required (host-module)')
  })

  it('names the unmet requirement of a rejected package', () => {
    expect(changeText({
      changed: false, application: 'failed', stage: 'install', target: '@scope/plugin',
      error: {
        code: 'incompatible-version',
        incompatible: [{ name: '@scope/plugin', version: '1.0.0', runtimeVersion: '0.2.1-rc.2', requirements: { 'engines.dsh': '>=9' } }],
      },
    } satisfies ChangeResult)).toContain('DSH 0.2.1-rc.2 rejects {"engines.dsh":">=9"}')
  })
})

describe('omdsh command plugins', () => {
  it('registers transcript export without a search command', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const fiber = await ctx.plugin(commandExport)
    const session = ctx.sessions.create(SessionId('command-export-test'))
    const agent = { id: session.id, session, status: 'idle' } as unknown as Agent

    // Import is `omdsh import` on the CLI: a session archive is restored before
    // a TUI exists, not from inside one.
    expect(ctx.commands.list(agent).map(command => command.name)).toEqual(['export'])

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('opens the current session trajectory through the TUI service', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const openTrajectory = vi.fn(() => true)
    ctx.provide('tui', { openTrajectory } as unknown as TuiService)
    const fiber = await ctx.plugin(commandTrajectory)
    const session = ctx.sessions.create(SessionId('command-trajectory-test'))
    const agent = { id: session.id, session, status: 'idle' } as unknown as Agent

    await expect(ctx.commands.execute(agent, '/trajectory', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'success' } })
    expect(openTrajectory).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ type: 'command/run' }),
    ]))

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
        plan: { active: true, pending: false },
        permission: 'workspace-write',
      }),
      contextDiagnostics: () => ({
        pressure: { contextWindow: 100_000, projectedTokens: 25_000, pressureTokens: 20_000 },
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

    expect(ctx.commands.list(agent).map(command => command.name)).toEqual(['context', 'new', 'queue', 'resume', 'retry', 'session'])
    await expect(ctx.commands.execute(agent, '/new', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'success', text: 'Started a new session.' } })
    expect(newSession).toHaveBeenCalledWith(agent)
    expect(session.snapshotEvents().filter(event => event.type === 'command/run' || event.type === 'command/done').map(event => event.type))
      .toEqual(['command/run', 'command/done'])

    const details = await ctx.commands.execute(agent, '/session', [], new AbortController().signal)
    expect(details).toBeDefined()
    if (details === undefined) throw new Error('/session was not resolved')
    expect(details.result).toMatchObject({
      kind: 'success',
      text: expect.stringContaining('| Workflow | Plan |'),
    })
    expect(details.result).toMatchObject({ text: expect.stringContaining('| Agent | Standard |') })
    expect(details.result).toMatchObject({ text: expect.not.stringContaining('| Tools |') })
    expect(details.result).toMatchObject({ text: expect.stringContaining('| Access | Workspace write |') })
    expect(details.result).toMatchObject({ text: expect.stringContaining('| Reasoning | `high` |') })

    const context = await ctx.commands.execute(agent, '/context', [], new AbortController().signal)
    expect(context).toBeDefined()
    if (context === undefined) throw new Error('/context was not resolved')
    expect(context.result).toMatchObject({
      kind: 'success',
      text: expect.stringContaining('Context Details\n\n## Occupancy'),
    })
    expect(context.result).toMatchObject({ text: expect.stringContaining('| Pressure | 25.0% |') })
    expect(tui.prompt).not.toHaveBeenCalled()

    await fiber.dispose()
    expect(ctx.commands.list(agent)).toEqual([])
    await ctx.fiber.dispose()
  })
})
