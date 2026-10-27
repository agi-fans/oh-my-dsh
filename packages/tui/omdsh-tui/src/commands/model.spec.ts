import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as commandModel from './model.ts'
import { resolveModelQuery } from './model.ts'
import type { TuiService } from '../definition.ts'
import type { SessionRuntime } from '../session/session-controller.ts'
import { writeModelFavorites } from '../session/model-favorites.ts'

describe('model command', () => {
  it('asks for a model in one searchable list instead of provider then model', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const prompt = vi.fn()
      .mockResolvedValueOnce('deepseek-official/deepseek-v4-flash')
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

    await ctx.commands.execute(agent, '/model', [], new AbortController().signal)

    // One prompt, not three: the provider is a column of the row, not a question.
    expect(prompt).toHaveBeenCalledTimes(1)
    const [request] = prompt.mock.calls[0] as [Record<string, unknown>]
    expect(request).toMatchObject({
      presentation: 'fullscreen-list',
      filterable: true,
      optionLayout: 'compact',
      allowCustom: false,
      initialValue: 'deepseek-official/deepseek-v4-flash',
    })
    expect(request.options).toEqual([
      expect.objectContaining({ label: 'deepseek-official/deepseek-v4-flash', badge: { label: 'current', tone: 'success' } }),
    ])
    await ctx.fiber.dispose()
  })

  it('does not ask for a reasoning effort the new model also offers', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const prompt = vi.fn().mockResolvedValueOnce('provider-a/model-a')
    const changeSelection = vi.fn(async () => undefined)
    ctx.provide('tui', { prompt } as unknown as TuiService)
    ctx.provide('omdshSession', {
      // The reader already sits on `high`, and the new model offers it too.
      selection: () => ({ provider: 'provider-b', model: 'model-b', reasoningEffort: 'high' }),
      changeSelection,
    } as unknown as SessionRuntime)
    ctx.provide('llm', {
      listProviders: () => [{ id: 'provider-a' }],
      listModels: async () => [{ id: 'model-a' }],
      resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }),
    } as never)
    await ctx.plugin(commandModel)
    const session = ctx.sessions.create(SessionId('model-effort-inherit-test'))
    const agent = { id: session.id, session, status: 'idle', inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent

    await ctx.commands.execute(agent, '/model', [], new AbortController().signal)

    // One prompt: the effort question had an answer already.
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(changeSelection).toHaveBeenCalledWith(agent,
      expect.objectContaining({ provider: 'provider-a', model: 'model-a', reasoningEffort: 'high' }),
      expect.anything(), { persist: true })
    await ctx.fiber.dispose()
  })

  it('asks for an effort only when the new model does not offer the current one', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const prompt = vi.fn()
      .mockResolvedValueOnce('provider-a/model-a')
      .mockResolvedValueOnce('low')
    ctx.provide('tui', { prompt } as unknown as TuiService)
    ctx.provide('omdshSession', {
      selection: () => ({ provider: 'provider-b', model: 'model-b', reasoningEffort: 'high' }),
      changeSelection: vi.fn(async () => undefined),
    } as unknown as SessionRuntime)
    ctx.provide('llm', {
      listProviders: () => [{ id: 'provider-a' }],
      listModels: async () => [{ id: 'model-a' }],
      // `high` is not in this model's vocabulary, so the question is real.
      resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }, { id: 'medium' }] } }),
    } as never)
    await ctx.plugin(commandModel)
    const session = ctx.sessions.create(SessionId('model-effort-ask-test'))
    const agent = { id: session.id, session, status: 'idle', inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent

    await ctx.commands.execute(agent, '/model', [], new AbortController().signal)

    expect(prompt).toHaveBeenCalledTimes(2)
    expect(prompt.mock.calls[1]?.[0]).toMatchObject({ title: 'Reasoning effort' })
    await ctx.fiber.dispose()
  })

  it('lists every provider together so search spans them', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const prompt = vi.fn().mockResolvedValueOnce('provider-b/model-b')
    ctx.provide('tui', { prompt } as unknown as TuiService)
    ctx.provide('omdshSession', {
      selection: () => ({ provider: 'provider-a', model: 'model-a' }),
      changeSelection: vi.fn(async () => undefined),
    } as unknown as SessionRuntime)
    ctx.provide('llm', {
      listProviders: () => [{ id: 'provider-a' }, { id: 'provider-b' }],
      listModels: async (provider: string) => [{ id: provider.replace('provider', 'model') }],
      resolveModelInfo: async () => ({}),
    } as never)
    await ctx.plugin(commandModel)
    const session = ctx.sessions.create(SessionId('model-flat-list-test'))
    const agent = { id: session.id, session, status: 'idle', inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent

    await ctx.commands.execute(agent, '/model', [], new AbortController().signal)

    // A reader who knows the model never has to answer "which provider first".
    expect(prompt).toHaveBeenCalledTimes(1)
    const [request] = prompt.mock.calls[0] as [{ options: { value: string }[] }]
    expect(request.options.map(option => option.value)).toEqual(['provider-a/model-a', 'provider-b/model-b'])
    await ctx.fiber.dispose()
  })

  it('switches only this session from the list without knowing the model id first', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    // The action returns its prefix before the selected value.
    const prompt = vi.fn().mockResolvedValueOnce('\u0000session:provider-a/model-a')
    const changeSelection = vi.fn(async () => undefined)
    ctx.provide('tui', { prompt } as unknown as TuiService)
    ctx.provide('omdshSession', {
      selection: () => ({ provider: 'other', model: 'other-model' }),
      changeSelection,
    } as unknown as SessionRuntime)
    ctx.provide('llm', {
      listProviders: () => [{ id: 'provider-a' }],
      listModels: async () => [{ id: 'model-a' }],
      resolveModelInfo: async () => ({}),
    } as never)
    await ctx.plugin(commandModel)
    const session = ctx.sessions.create(SessionId('model-session-action-test'))
    const agent = { id: session.id, session, status: 'idle', inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent

    const result = await ctx.commands.execute(agent, '/model', [], new AbortController().signal)

    expect(result).toMatchObject({ result: { kind: 'success', text: expect.stringContaining('Session model: provider-a/model-a') } })
    // `persist: false` is what keeps the saved default untouched.
    expect(changeSelection).toHaveBeenCalledWith(agent, expect.objectContaining({ provider: 'provider-a' }), expect.anything(), { persist: false })
    await ctx.fiber.dispose()
  })

  it('uses a searchable full-screen page for a long model list', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const prompt = vi.fn().mockResolvedValueOnce('model-1')
    ctx.provide('tui', { prompt } as unknown as TuiService)
    ctx.provide('omdshSession', {
      selection: () => ({ provider: 'deepseek-official', model: 'model-1' }),
      changeSelection: vi.fn(async () => undefined),
    } as unknown as SessionRuntime)
    ctx.provide('llm', {
      listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
      listModels: async () => Array.from({ length: 9 }, (_, index) => ({
        id: `model-${index + 1}`,
        name: `Model ${index + 1}`,
      })),
      resolveModelInfo: async () => ({}),
    } as never)
    await ctx.plugin(commandModel)
    const session = ctx.sessions.create(SessionId('model-command-long-test'))
    const agent = {
      id: session.id,
      session,
      status: 'idle',
      inbox: { nextTurn: [], nextStep: [] },
    } as unknown as Agent

    await ctx.commands.execute(agent, '/model', [], new AbortController().signal)

    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      presentation: 'fullscreen-list',
      filterable: true,
      optionLayout: 'compact',
    }))
    await ctx.fiber.dispose()
  })

  it('cycles persisted favorites and the selected model reasoning effort', async () => {
    const home = mkdtempSync(join(tmpdir(), 'omdsh-model-command-'))
    const previousHome = process.env.OMDSH_HOME
    process.env.OMDSH_HOME = home
    writeModelFavorites(join(home, 'omdsh', 'model-favorites.json'), [
      { provider: 'provider-a', model: 'model-a' },
      { provider: 'provider-b', model: 'model-b' },
    ])
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(CommandRuntime)
      let current = { provider: 'provider-a', model: 'model-a', reasoningEffort: undefined as string | undefined }
      const changeSelection = vi.fn(async (_agent: Agent, selection: typeof current) => { current = selection })
      ctx.provide('tui', { prompt: vi.fn() } as unknown as TuiService)
      ctx.provide('omdshSession', {
        selection: () => current,
        changeSelection,
      } as unknown as SessionRuntime)
      ctx.provide('llm', {
        listProviders: () => [{ id: 'provider-a' }, { id: 'provider-b' }],
        listModels: async (provider: string) => [{ id: provider === 'provider-a' ? 'model-a' : 'model-b' }],
        resolveModelInfo: async (_provider: string, model: string) => model === 'model-b'
          ? { reasoning: { defaultEffort: 'low', efforts: [{ id: 'low' }, { id: 'high' }] } }
          : {},
      } as never)
      await ctx.plugin(commandModel)
      const session = ctx.sessions.create(SessionId('model-cycle-test'))
      const agent = {
        id: session.id,
        session,
        status: 'idle',
        inbox: { nextTurn: [], nextStep: [] },
      } as unknown as Agent

      await ctx.commands.execute(agent, '/model next', [], new AbortController().signal)
      expect(current).toMatchObject({ provider: 'provider-b', model: 'model-b' })
      await ctx.commands.execute(agent, '/model reasoning', [], new AbortController().signal)
      expect(current).toMatchObject({ provider: 'provider-b', model: 'model-b', reasoningEffort: 'high' })
      expect(changeSelection).toHaveBeenCalledTimes(2)
    } finally {
      await ctx.fiber.dispose()
      if (previousHome === undefined) delete process.env.OMDSH_HOME
      else process.env.OMDSH_HOME = previousHome
    }
  })
})

describe('resolveModelQuery', () => {
  const catalog = [
    { provider: 'deepseek-official', model: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: 'flagship' },
    { provider: 'deepseek-official', model: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', description: 'fast' },
    { provider: 'mock-provider', model: 'deepseek-v4-pro', name: 'Mirror Pro', description: 'external' },
  ]

  it('resolves an exact provider:model qualifier', () => {
    const result = resolveModelQuery('deepseek-official:deepseek-v4-pro', catalog)
    expect(result).toMatchObject({ kind: 'exact', matches: [{ provider: 'deepseek-official' }] })
  })

  it('falls back to fuzzy within the qualified provider only', () => {
    const qualified = resolveModelQuery('mock-provider:v4', catalog)
    expect(qualified).toMatchObject({ kind: 'fuzzy', matches: [{ provider: 'mock-provider' }] })
    const elsewhere = resolveModelQuery('missing-provider:anything', catalog)
    expect(elsewhere).toEqual({ kind: 'unknown-provider', provider: 'missing-provider' })
  })

  it('returns every exact candidate with a case-folded collision', () => {
    const result = resolveModelQuery('deepseek-v4-pro', catalog)
    if (result.kind !== 'exact') throw new Error('expected exact resolution')
    expect(result.matches).toHaveLength(2)
  })

  it('finds fuzzy matches and reports the closest three on none', () => {
    const fuzzy = resolveModelQuery('flash', catalog)
    expect(fuzzy).toMatchObject({ kind: 'fuzzy' })
    const none = resolveModelQuery('zzz', catalog)
    expect(none.kind).toBe('none')
    if (none.kind === 'none') expect(none.closest.length).toBeLessThanOrEqual(3)
  })
})

describe('model query command', () => {
  async function queryEnv(rawInput: string, prompt = vi.fn()): Promise<{
    result: Awaited<ReturnType<CommandRuntime['execute']>>,
    selection: ReturnType<typeof vi.fn>,
    prompt: ReturnType<typeof vi.fn>,
    dispose: () => Promise<void>,
  }> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const tui = { prompt } as unknown as TuiService
        const selection = vi.fn(async (_agent: unknown, _selection: unknown, _info?: unknown, _options?: { persist?: boolean }) => undefined)
    const runtime = {
      selection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
      changeSelection: selection,
    } as unknown as SessionRuntime
    const llm = {
      listProviders: () => [
        { id: 'deepseek-official', name: 'DeepSeek' },
        { id: 'mock-provider', name: 'Mirror' },
      ],
      listModels: async (provider: string) => provider === 'deepseek-official'
        ? [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }, { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }]
        : [{ id: 'deepseek-v4-pro', name: 'Mirror Pro' }, { id: 'mirror-pro', name: 'Mirror Pro' }],
      resolveModelInfo: async () => ({}),
    }
    ctx.provide('tui', tui)
    ctx.provide('omdshSession', runtime)
    ctx.provide('llm', llm as never)
    await ctx.plugin(commandModel)
    const session = ctx.sessions.create(SessionId('model-query-command'))
    const agent = { id: session.id, session, status: 'idle', inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent
    const result = await ctx.commands.execute(agent, rawInput, [], new AbortController().signal)
    return { result, selection, prompt, dispose: async () => { await ctx.fiber.dispose() } }
  }

  it('switches a unique match and persists the default', async () => {
    const env = await queryEnv('/model mirror-pro')
    expect(env.selection).toHaveBeenCalledTimes(1)
    const call = env.selection.mock.calls[0] as unknown[]
    expect(call[3]).toEqual({ persist: true })
    expect(env.result.result).toMatchObject({ kind: 'success', text: 'Default model: mock-provider/mirror-pro' })
    await env.dispose()
  })

  it('switches a unique match without persisting the default for --session', async () => {
    const env = await queryEnv('/model --session mirror-pro')
    expect(env.selection).toHaveBeenCalledTimes(1)
    const call = env.selection.mock.calls[0] as unknown[]
    expect(call[3]).toEqual({ persist: false })
    expect(env.result.result).toMatchObject({ kind: 'success', text: 'Session model: mock-provider/mirror-pro' })
    await env.dispose()
  })

  it('prompts on ambiguity and reports the nearest matches on zero hits', async () => {
    const env = await queryEnv('/model deepseek-v4-pro', vi.fn().mockResolvedValueOnce('mock-provider/deepseek-v4-pro'))
    expect(env.prompt).toHaveBeenCalledTimes(1)
    const call = env.selection.mock.calls[0] as unknown[]
    expect(call[1]).toMatchObject({ provider: 'mock-provider', model: 'deepseek-v4-pro' })
    await env.dispose()

    const miss = await queryEnv('/model zzz-not-a-model')
    expect(miss.result.result.kind).toBe('error')
    if (miss.result.result.kind === 'error') expect(miss.result.result.text).toContain('No model matches')
    await miss.dispose()
  })

  it('opens the same list for a bare --session instead of demanding a query', async () => {
    // `--session` used to require a model id because the scope had no picker.
    // The list makes the scope reachable on its own, so the flag is now a noun
    // the reader can browse rather than a syntax they have to spell.
    const prompt = vi.fn().mockResolvedValueOnce(null)
    const env = await queryEnv('/model --session', prompt)
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(prompt.mock.calls[0]?.[0]).toMatchObject({
      presentation: 'fullscreen-list',
      filterable: true,
      title: 'Model · this session',
    })
    // Cancelling the list is not an error.
    expect(env.result?.result).toMatchObject({ kind: 'success' })
    expect(env.selection).not.toHaveBeenCalled()
    await env.dispose()
  })
})
