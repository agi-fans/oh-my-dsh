import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as commandModel from './command-model.ts'
import type { TuiService } from './definition.ts'
import type { SessionRuntime } from './session-controller.ts'

describe('model command', () => {
  it('skips a sole provider and uses a compact searchable model page', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const prompt = vi.fn()
      .mockResolvedValueOnce('deepseek-v4-flash')
    const tui = { prompt } as unknown as TuiService
    const runtime = {
      selection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
      changeSelection: vi.fn(async () => undefined),
    } as unknown as SessionRuntime
    const llm = {
      listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
      listModels: async () => [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }],
      resolveModelInfo: async () => ({}),
    }
    ctx.provide('tui', tui)
    ctx.provide('omdshSession', runtime)
    ctx.provide('llm', llm as never)
    await ctx.plugin(commandModel)
    const session = ctx.sessions.create(SessionId('model-command-test'))
    const agent = {
      id: session.id,
      session,
      status: 'idle',
      inbox: { nextTurn: [], nextStep: [] },
    } as unknown as Agent

    await ctx.commands.execute(agent, '/model', new AbortController().signal)

    expect(prompt).toHaveBeenCalledTimes(1)
    for (const [request] of prompt.mock.calls) {
      expect(request).toMatchObject({
        presentation: 'fullscreen-list',
        optionLayout: 'compact',
        filterable: true,
        allowCustom: false,
        initialValue: 'deepseek-v4-flash',
      })
    }
    await ctx.fiber.dispose()
  })
})
