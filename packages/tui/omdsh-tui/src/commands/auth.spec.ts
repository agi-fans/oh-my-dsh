import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CredentialInfo } from '@deepseek-ai/dsh-credentials'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as commandAuth from './auth.ts'
import type { TuiPrompt, TuiService } from '../definition.ts'

interface AuthHarness {
  ctx: Context
  agent: Agent
  prompt: ReturnType<typeof vi.fn<(request: TuiPrompt) => Promise<string | null>>>
  describe: ReturnType<typeof vi.fn<(ref: typeof commandAuth.DEEPSEEK_API_KEY) => Promise<CredentialInfo>>>
  set: ReturnType<typeof vi.fn<(ref: typeof commandAuth.DEEPSEEK_API_KEY, value: string) => Promise<void>>>
  unset: ReturnType<typeof vi.fn<(ref: typeof commandAuth.DEEPSEEK_API_KEY) => Promise<void>>>
  settingsUpdate: ReturnType<typeof vi.fn>
  settingsMutate: ReturnType<typeof vi.fn>
}

interface AuthHarnessOptions {
  answers?: readonly (string | null)[]
  fallback?: CredentialInfo
  override?: CredentialInfo
  activeCredentialRef?: string
  configurable?: readonly LlmConfigurableProvider[]
  liveProviders?: readonly string[]
  piAiSettings?: Record<string, unknown>
}

const UNCONFIGURED: CredentialInfo = { configured: false, writable: true }

const DEEPSEEK_ENTRY: LlmConfigurableProvider = {
  provider: commandAuth.DEEPSEEK_PROVIDER,
  displayName: 'DeepSeek',
  settingsNs: 'llm-deepseek',
  settingsPath: [],
}

const OPENAI_ENTRY: LlmConfigurableProvider = {
  provider: 'openai',
  displayName: 'openai',
  settingsNs: 'llm-pi-ai',
  settingsPath: ['providers', 'openai'],
  declared: false,
}

function setPath(root: Record<string, unknown>, path: readonly string[], value: unknown): Record<string, unknown> {
  if (path.length === 0) return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...value as Record<string, unknown> }
    : root
  const [head, ...rest] = path
  if (head === undefined) return root
  const next = setPath(
    typeof root[head] === 'object' && root[head] !== null && !Array.isArray(root[head])
      ? { ...root[head] as Record<string, unknown> }
      : {},
    rest,
    value,
  )
  return { ...root, [head]: next }
}

function unsetPath(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
  if (path.length === 0) return {}
  const [head, ...rest] = path
  if (head === undefined) return root
  if (rest.length === 0) {
    const next = { ...root }
    delete next[head]
    return next
  }
  const child = root[head]
  if (typeof child !== 'object' || child === null || Array.isArray(child)) return root
  return { ...root, [head]: unsetPath({ ...child as Record<string, unknown> }, rest) }
}

async function authHarness(options: AuthHarnessOptions = {}): Promise<AuthHarness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const prompt = vi.fn<(request: TuiPrompt) => Promise<string | null>>()
  for (const answer of options.answers ?? []) prompt.mockResolvedValueOnce(answer)
  const credentials = new Map<string, CredentialInfo>([
    [String(commandAuth.DEEPSEEK_API_KEY), options.fallback ?? UNCONFIGURED],
    [String(commandAuth.OMDSH_DEEPSEEK_API_KEY), options.override ?? UNCONFIGURED],
  ])
  const describe = vi.fn(async (ref: typeof commandAuth.DEEPSEEK_API_KEY) => credentials.get(String(ref)) ?? UNCONFIGURED)
  const set = vi.fn(async (ref: typeof commandAuth.DEEPSEEK_API_KEY) => {
    credentials.set(String(ref), { configured: true, source: 'file', writable: true })
  })
  const unset = vi.fn(async (ref: typeof commandAuth.DEEPSEEK_API_KEY) => {
    credentials.set(String(ref), UNCONFIGURED)
  })
  const sections = new Map<string, Record<string, unknown>>([
    [String(commandAuth.DEEPSEEK_SETTINGS), {
      apiKeyEnv: options.activeCredentialRef ?? String(commandAuth.DEEPSEEK_API_KEY),
    }],
    [String(commandAuth.PI_AI_SETTINGS), options.piAiSettings ?? {}],
  ])
  const settingsUpdate = vi.fn(async (namespace: unknown, patch: Record<string, unknown>) => {
    sections.set(String(namespace), { ...sections.get(String(namespace)), ...patch })
  })
  const settingsMutate = vi.fn(async (
    namespace: unknown,
    operations: readonly { op: string, path: readonly string[], value?: unknown }[],
  ) => {
    let current = { ...sections.get(String(namespace)) }
    for (const operation of operations) {
      if (operation.op === 'set') current = setPath(current, operation.path, operation.value)
      if (operation.op === 'unset') current = unsetPath(current, operation.path)
    }
    sections.set(String(namespace), current)
  })
  ctx.provide('tui', { prompt } as unknown as TuiService)
  ctx.provide('credentials', { describe, set, unset } as never)
  ctx.provide('settings', {
    get: (namespace: unknown) => sections.get(String(namespace)),
    update: settingsUpdate,
    mutate: settingsMutate,
  } as never)
  ctx.provide('llm', {
    listConfigurableProviders: () => options.configurable ?? [DEEPSEEK_ENTRY],
    listProviders: () => (options.liveProviders ?? [commandAuth.DEEPSEEK_PROVIDER])
      .map(id => ({ id, name: id })),
  } as never)
  await ctx.plugin(commandAuth, { openDashboard: false })
  const session = ctx.sessions.create(SessionId('auth-command-test'))
  const agent = {
    id: session.id,
    session,
    status: 'idle',
    inbox: { nextTurn: [], nextStep: [] },
  } as unknown as Agent
  return { ctx, agent, prompt, describe, set, unset, settingsUpdate, settingsMutate }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DeepSeek auth commands', () => {
  it('collects a masked key, normalizes it, validates it, and stores it through credentials', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const harness = await authHarness({ answers: [commandAuth.DEEPSEEK_PROVIDER, '  Bearer sk-live  '] })

    const execution = await harness.ctx.commands.execute(
      harness.agent,
      '/login',
      new AbortController().signal,
    )

    expect(harness.prompt).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Login to DeepSeek',
      allowCustom: true,
      secret: true,
      submitLabel: 'validate',
    }))
    expect(fetchMock).toHaveBeenCalledWith(
      commandAuth.DEEPSEEK_MODELS_URL,
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer sk-live' }) }),
    )
    expect(harness.set).toHaveBeenCalledWith(commandAuth.OMDSH_DEEPSEEK_API_KEY, 'sk-live')
    expect(harness.settingsUpdate).toHaveBeenCalledWith(commandAuth.DEEPSEEK_SETTINGS, {
      apiKeyEnv: String(commandAuth.OMDSH_DEEPSEEK_API_KEY),
    })
    expect(execution?.result).toEqual({
      kind: 'success',
      text: 'Logged in to DeepSeek. Your omdsh credential takes priority on the next model request.',
    })
    await harness.ctx.fiber.dispose()
  })

  it('does not store a key rejected by DeepSeek or expose it in the result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    const secret = 'sk-do-not-print'
    const harness = await authHarness({ answers: [commandAuth.DEEPSEEK_PROVIDER, secret] })

    const execution = await harness.ctx.commands.execute(
      harness.agent,
      '/login',
      new AbortController().signal,
    )

    expect(harness.set).not.toHaveBeenCalled()
    expect(execution?.result.kind).toBe('error')
    expect(execution?.result.text).toContain('rejected')
    expect(execution?.result.text).not.toContain(secret)
    await harness.ctx.fiber.dispose()
  })

  it('confirms and removes a credential owned by the Harness store', async () => {
    const harness = await authHarness({
      activeCredentialRef: String(commandAuth.OMDSH_DEEPSEEK_API_KEY),
      override: { configured: true, source: 'file', writable: true },
      answers: ['logout'],
    })

    const execution = await harness.ctx.commands.execute(
      harness.agent,
      '/logout',
      new AbortController().signal,
    )

    expect(harness.prompt).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Logout from DeepSeek',
      initialValue: 'cancel',
      allowCustom: false,
    }))
    expect(harness.settingsMutate).toHaveBeenCalledWith(commandAuth.DEEPSEEK_SETTINGS, [
      { op: 'unset', path: ['apiKeyEnv'] },
    ])
    expect(harness.unset).toHaveBeenCalledWith(commandAuth.OMDSH_DEEPSEEK_API_KEY)
    expect(execution?.result).toEqual({ kind: 'success', text: 'Logged out from DeepSeek.' })
    await harness.ctx.fiber.dispose()
  })

  it('falls back to an inherited environment credential after logging out', async () => {
    const harness = await authHarness({
      activeCredentialRef: String(commandAuth.OMDSH_DEEPSEEK_API_KEY),
      override: { configured: true, source: 'file', writable: true },
      fallback: { configured: true, source: 'env', writable: false },
      answers: ['logout'],
    })

    const execution = await harness.ctx.commands.execute(
      harness.agent,
      '/logout',
      new AbortController().signal,
    )

    expect(execution?.result).toEqual({
      kind: 'success',
      text: 'Logged out from the omdsh-managed DeepSeek credential. Falling back to DEEPSEEK_API_KEY from the current process environment.',
    })
    await harness.ctx.fiber.dispose()
  })

  it('lets an interactive login override an inherited environment credential', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const loginHarness = await authHarness({
      fallback: { configured: true, source: 'env', writable: false },
      answers: [commandAuth.DEEPSEEK_PROVIDER, 'sk-user-choice'],
    })
    const login = await loginHarness.ctx.commands.execute(
      loginHarness.agent,
      '/login',
      new AbortController().signal,
    )
    expect(login?.result).toEqual(expect.objectContaining({ kind: 'success' }))
    expect(loginHarness.prompt).toHaveBeenCalledWith(expect.objectContaining({ secret: true }))
    expect(loginHarness.set).toHaveBeenCalledWith(commandAuth.OMDSH_DEEPSEEK_API_KEY, 'sk-user-choice')
    expect(loginHarness.settingsUpdate).toHaveBeenCalledWith(commandAuth.DEEPSEEK_SETTINGS, {
      apiKeyEnv: String(commandAuth.OMDSH_DEEPSEEK_API_KEY),
    })
    await loginHarness.ctx.fiber.dispose()
  })

  it('does not claim logout can remove credentials supplied by an external source', async () => {
    const logoutHarness = await authHarness({
      fallback: { configured: true, source: 'project-env', writable: true },
    })
    const logout = await logoutHarness.ctx.commands.execute(
      logoutHarness.agent,
      '/logout',
      new AbortController().signal,
    )
    expect(logout?.result).toEqual(expect.objectContaining({ kind: 'success', text: expect.stringContaining('project .env file') }))
    expect(logoutHarness.prompt).not.toHaveBeenCalled()
    expect(logoutHarness.unset).not.toHaveBeenCalled()
    await logoutHarness.ctx.fiber.dispose()
  })

  it('rejects inline arguments so an API key cannot enter command history', async () => {
    const harness = await authHarness()
    const execution = await harness.ctx.commands.execute(
      harness.agent,
      '/login sk-must-not-be-accepted',
      new AbortController().signal,
    )

    expect(execution?.result).toEqual({
      kind: 'error',
      text: 'Usage: /login (paste the key only into the protected prompt)',
    })
    expect(harness.prompt).not.toHaveBeenCalled()
    expect(harness.set).not.toHaveBeenCalled()
    await harness.ctx.fiber.dispose()
  })
})

describe('catalog provider auth', () => {
  it('stores a catalog key and activates the pi-ai route', async () => {
    const harness = await authHarness({
      configurable: [
        DEEPSEEK_ENTRY,
        {
          provider: 'deepseek',
          displayName: 'deepseek',
          settingsNs: 'llm-pi-ai',
          settingsPath: ['providers', 'deepseek'],
          declared: false,
        },
        OPENAI_ENTRY,
      ],
      answers: ['openai', '  Bearer sk-openai  '],
    })
    const ref = commandAuth.managedProviderCredentialRef('openai')

    const execution = await harness.ctx.commands.execute(
      harness.agent,
      '/login',
      new AbortController().signal,
    )

    expect(harness.prompt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      title: 'Provider',
      question: 'Choose a provider to configure',
      options: [
        { label: 'deepseek', value: commandAuth.DEEPSEEK_PROVIDER, description: 'configured' },
        { label: 'openai', value: 'openai', description: 'not configured' },
        {
          label: 'custom',
          value: commandAuth.CUSTOM_PROVIDER_VALUE,
          description: 'Add a provider that is not in the catalog',
        },
      ],
    }))
    expect(harness.prompt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      title: 'Login to openai',
      secret: true,
      submitLabel: 'save',
    }))
    expect(harness.set).toHaveBeenCalledWith(ref, 'sk-openai')
    expect(harness.settingsMutate).toHaveBeenCalledWith(commandAuth.PI_AI_SETTINGS, [
      { op: 'set', path: ['providers', 'openai', 'apiKeyEnv'], value: String(ref) },
    ])
    expect(execution?.result).toEqual({
      kind: 'success',
      text: 'Logged in to openai. Use /model to choose a model from openai.',
    })
    await harness.ctx.fiber.dispose()
  })

  it('drops a catalog route and the managed key on logout', async () => {
    const ref = commandAuth.managedProviderCredentialRef('openai')
    const harness = await authHarness({
      configurable: [DEEPSEEK_ENTRY, OPENAI_ENTRY],
      liveProviders: [commandAuth.DEEPSEEK_PROVIDER, 'openai'],
      piAiSettings: { providers: { openai: { apiKeyEnv: String(ref) } } },
      answers: ['openai', 'logout'],
    })
    await harness.set(ref, 'sk-openai')

    const execution = await harness.ctx.commands.execute(
      harness.agent,
      '/logout',
      new AbortController().signal,
    )

    expect(harness.settingsMutate).toHaveBeenCalledWith(commandAuth.PI_AI_SETTINGS, [
      { op: 'unset', path: ['providers', 'openai'] },
    ])
    expect(harness.unset).toHaveBeenCalledWith(ref)
    expect(execution?.result).toEqual({ kind: 'success', text: 'Logged out from openai.' })
    await harness.ctx.fiber.dispose()
  })

  it('writes a custom provider profile from typed id, URL, protocol, and models', async () => {
    const harness = await authHarness({
      configurable: [DEEPSEEK_ENTRY],
      answers: [
        'custom',
        'my-gateway',
        'http://127.0.0.1:11434/v1/',
        'openai-completions',
        'sk-local',
        'enter',
        'llama3, qwen2.5',
      ],
    })
    const ref = commandAuth.managedProviderCredentialRef('my-gateway')

    const execution = await harness.ctx.commands.execute(
      harness.agent,
      '/login',
      new AbortController().signal,
    )

    expect(harness.set).toHaveBeenCalledWith(ref, 'sk-local')
    expect(harness.settingsMutate).toHaveBeenCalledWith(commandAuth.PI_AI_SETTINGS, [{
      op: 'set',
      path: ['providers', 'my-gateway'],
      value: {
        api: 'openai-completions',
        baseURL: 'http://127.0.0.1:11434/v1',
        models: [{ id: 'llama3' }, { id: 'qwen2.5' }],
        apiKeyEnv: String(ref),
      },
    }])
    expect(execution?.result).toEqual({
      kind: 'success',
      text: 'Added my-gateway with 2 models. Use /model to choose it.',
    })
    await harness.ctx.fiber.dispose()
  })
})

describe('custom provider parsing', () => {
  it('accepts kebab-case ids, http(s) URLs, and model lists', () => {
    expect(commandAuth.parseProviderId(' My-Gateway ')).toBe('my-gateway')
    expect(commandAuth.parseBaseURL('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434/v1')
    expect(commandAuth.parseModelIds('llama3, qwen2.5  llama3')).toEqual(['llama3', 'qwen2.5'])
  })

  it('rejects reserved or malformed custom fields', () => {
    expect(() => commandAuth.parseProviderId('custom')).toThrow(/different provider id/u)
    expect(() => commandAuth.parseProviderId('1gateway')).toThrow(/lowercase/u)
    expect(() => commandAuth.parseBaseURL('127.0.0.1:11434')).toThrow(/absolute/u)
    expect(() => commandAuth.parseModelIds('  ,  ')).toThrow(/at least one/u)
  })
})
