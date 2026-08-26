import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AuthorizationError, type AuthorizationEntry } from '@deepseek-ai/dsh-authorization'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { credentialKey, type CredentialInfo, type CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as commandAuth from './auth.ts'
import type { TuiPrompt, TuiService } from '../definition.ts'

interface AuthHarness {
  ctx: Context
  agent: Agent
  prompt: ReturnType<typeof vi.fn<(request: TuiPrompt) => Promise<string | null>>>
  notice: ReturnType<typeof vi.fn>
  describe: ReturnType<typeof vi.fn<(ref: typeof commandAuth.DEEPSEEK_API_KEY) => Promise<CredentialInfo>>>
  set: ReturnType<typeof vi.fn<(ref: typeof commandAuth.DEEPSEEK_API_KEY, value: string) => Promise<void>>>
  unset: ReturnType<typeof vi.fn<(ref: typeof commandAuth.DEEPSEEK_API_KEY) => Promise<void>>>
  settingsUpdate: ReturnType<typeof vi.fn>
  settingsMutate: ReturnType<typeof vi.fn>
  beginAuthorization: ReturnType<typeof vi.fn>
  describeRecord: ReturnType<typeof vi.fn>
  listRecords: ReturnType<typeof vi.fn>
  deleteRecord: ReturnType<typeof vi.fn>
}

interface AuthHarnessOptions {
  answers?: readonly (string | null)[]
  fallback?: CredentialInfo
  override?: CredentialInfo
  activeCredentialRef?: string
  configurable?: readonly LlmConfigurableProvider[]
  liveProviders?: readonly string[]
  piAiSettings?: Record<string, unknown>
  authorizationFlows?: readonly AuthorizationEntry[]
  beginAuthorization?: ReturnType<typeof vi.fn>
  records?: ReadonlyMap<CredentialKey, { kind: 'grant' | 'api-key'; writable?: boolean }>
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
  const notice = vi.fn()
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
  ctx.provide('tui', { prompt, notice } as unknown as TuiService)
  const records = new Map<string, { kind: 'grant' | 'api-key'; writable: boolean }>(
    [...(options.records ?? [])].map(([key, record]) => [key, { kind: record.kind, writable: record.writable !== false }]),
  )
  const describeRecord = vi.fn(async (key: CredentialKey) => {
    const record = records.get(key)
    return record === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: record.kind, writable: record.writable }
  })
  const listRecords = vi.fn(async () => [...records.entries()].map(([key, record]) => ({
    key: key as CredentialKey,
    kind: record.kind,
  })))
  const deleteRecord = vi.fn(async (key: CredentialKey) => { records.delete(key) })
  const beginAuthorization = options.beginAuthorization ?? vi.fn(async (request?: { key: CredentialKey }) => {
    if (request?.key !== undefined) records.set(request.key, { kind: 'grant', writable: true })
    return { status: 'authorized' as const }
  })
  if (options.authorizationFlows !== undefined) {
    const flows = [...options.authorizationFlows]
    ctx.provide('authorization', {
      list: () => flows,
      describe: (key: CredentialKey) => flows.find(flow => flow.key === key),
      begin: beginAuthorization,
      cancel: vi.fn(),
    } as never)
  }
  ctx.provide('credentials', { describe, set, unset, describeRecord, listRecords, deleteRecord } as never)
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
  return {
    ctx, agent, prompt, notice, describe, set, unset, settingsUpdate, settingsMutate,
    beginAuthorization, describeRecord, listRecords, deleteRecord,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DeepSeek auth commands', () => {
  it('describes /login and /logout as provider sign-in and sign-out', async () => {
    const harness = await authHarness()
    expect(harness.ctx.commands.list(harness.agent)).toEqual(expect.arrayContaining([
      { name: 'login', description: 'Sign in to a provider' },
      { name: 'logout', description: 'Sign out of a stored provider' },
    ]))
    await harness.ctx.fiber.dispose()
  })

  it('collects a masked key, normalizes it, validates it, and stores it through credentials', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const harness = await authHarness({ answers: [commandAuth.DEEPSEEK_PROVIDER, '  Bearer sk-live  '] })

    const execution = await harness.ctx.commands.execute(
      harness.agent,
      '/login',
      [],
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
      [],
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
      [],
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
      [],
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
      [],
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
      [],
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
      [],
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
      [],
      new AbortController().signal,
    )

    expect(harness.prompt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      title: 'Provider',
      question: 'Choose a provider to sign in or update',
      options: [
        { label: 'DeepSeek', value: commandAuth.DEEPSEEK_PROVIDER, description: 'DeepSeek API key' },
        { label: 'openai', value: 'openai', description: 'openai API key' },
        {
          label: 'Custom',
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
      answers: ['logout'],
    })
    await harness.set(ref, 'sk-openai')

    const execution = await harness.ctx.commands.execute(
      harness.agent,
      '/logout',
      [],
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
      [],
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

describe('authorization service login', () => {
  const FLOW_KEY = credentialKey('llm-pi-ai', 'openai')
  const FLOW: AuthorizationEntry = {
    key: FLOW_KEY,
    label: 'OpenAI',
    methods: [
      { id: 'oauth', label: 'Sign in with ChatGPT' },
      { id: 'api-key', label: 'API key' },
    ],
    inFlight: false,
  }

  it('lists registered flows and their methods beside the DeepSeek fallback', async () => {
    const harness = await authHarness({
      configurable: [DEEPSEEK_ENTRY, OPENAI_ENTRY],
      authorizationFlows: [FLOW],
      answers: [null],
    })
    await harness.ctx.commands.execute(harness.agent, '/login', [], new AbortController().signal)
    expect(harness.prompt).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Provider',
      options: expect.arrayContaining([
        { label: 'DeepSeek', value: commandAuth.DEEPSEEK_PROVIDER, description: 'DeepSeek API key' },
        {
          label: 'OpenAI',
          value: commandAuth.FLOW_VALUE_PREFIX + FLOW_KEY,
          description: 'Sign in with ChatGPT · API key',
        },
        {
          label: 'Custom',
          value: commandAuth.CUSTOM_PROVIDER_VALUE,
          description: 'Add a provider that is not in the catalog',
        },
      ]),
    }))
    const options = harness.prompt.mock.calls[0]?.[0]?.options ?? []
    expect(options.some(option => option.value === 'openai')).toBe(false)
    await harness.ctx.fiber.dispose()
  })

  it('runs the selected flow method and reports authorized', async () => {
    const beginAuthorization = vi.fn(async (request: {
      key: CredentialKey
      method?: string
      interaction: { notify: (notice: { message: string }) => void; prompt: (prompt: { kind: string; message: string }) => Promise<string> }
    }) => {
      request.interaction.notify({ message: 'Continue in your browser' })
      await request.interaction.prompt({ kind: 'text', message: 'Paste the code' })
      return { status: 'authorized' as const }
    })
    const harness = await authHarness({
      configurable: [DEEPSEEK_ENTRY],
      authorizationFlows: [FLOW],
      beginAuthorization,
      answers: [commandAuth.FLOW_VALUE_PREFIX + FLOW_KEY, 'oauth', 'ABCD'],
    })

    const execution = await harness.ctx.commands.execute(
      harness.agent,
      '/login',
      [],
      new AbortController().signal,
    )

    expect(harness.prompt).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Login to OpenAI',
      question: 'Choose a sign-in method',
      options: [
        { label: 'Sign in with ChatGPT', value: 'oauth' },
        { label: 'API key', value: 'api-key' },
      ],
      allowCustom: false,
    }))
    expect(beginAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      key: FLOW_KEY,
      method: 'oauth',
    }))
    expect(harness.notice).toHaveBeenCalledWith('Continue in your browser')
    expect(harness.set).not.toHaveBeenCalled()
    expect(execution?.result).toEqual({ kind: 'success', text: 'Logged in to OpenAI.' })
    await harness.ctx.fiber.dispose()
  })

  it('reports cancellation without treating it as a login failure', async () => {
    const harness = await authHarness({
      configurable: [DEEPSEEK_ENTRY],
      authorizationFlows: [{ ...FLOW, methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }] }],
      beginAuthorization: vi.fn(async () => ({ status: 'cancelled' as const })),
      answers: [commandAuth.FLOW_VALUE_PREFIX + FLOW_KEY],
    })
    const execution = await harness.ctx.commands.execute(
      harness.agent,
      '/login',
      [],
      new AbortController().signal,
    )
    expect(execution?.result).toEqual({ kind: 'success' })
    await harness.ctx.fiber.dispose()
  })

  it('reports a failed authorization without printing a secret', async () => {
    const secret = 'sk-do-not-print'
    const harness = await authHarness({
      configurable: [DEEPSEEK_ENTRY],
      authorizationFlows: [{ ...FLOW, methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }] }],
      beginAuthorization: vi.fn(async () => {
        throw new Error('provider rejected the grant')
      }),
      answers: [commandAuth.FLOW_VALUE_PREFIX + FLOW_KEY],
    })
    const execution = await harness.ctx.commands.execute(
      harness.agent,
      '/login',
      [],
      new AbortController().signal,
    )
    expect(execution?.result.kind).toBe('error')
    expect(execution?.result.text).toContain('provider rejected the grant')
    expect(execution?.result.text).not.toContain(secret)
    await harness.ctx.fiber.dispose()
  })

  it('refuses a duplicate in-flight attempt', async () => {
    const harness = await authHarness({
      configurable: [DEEPSEEK_ENTRY],
      authorizationFlows: [{
        ...FLOW,
        methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
        inFlight: true,
      }],
      answers: [commandAuth.FLOW_VALUE_PREFIX + FLOW_KEY],
    })
    const execution = await harness.ctx.commands.execute(
      harness.agent,
      '/login',
      [],
      new AbortController().signal,
    )
    expect(harness.beginAuthorization).not.toHaveBeenCalled()
    expect(execution?.result).toEqual({
      kind: 'error',
      text: 'OpenAI already has a login in progress.',
    })
    await harness.ctx.fiber.dispose()
  })

  it('maps ALREADY_IN_FLIGHT from begin onto the same duplicate error', async () => {
    const harness = await authHarness({
      configurable: [DEEPSEEK_ENTRY],
      authorizationFlows: [{ ...FLOW, methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }] }],
      beginAuthorization: vi.fn(async () => {
        throw new AuthorizationError('busy', 'ALREADY_IN_FLIGHT')
      }),
      answers: [commandAuth.FLOW_VALUE_PREFIX + FLOW_KEY],
    })
    const execution = await harness.ctx.commands.execute(
      harness.agent,
      '/login',
      [],
      new AbortController().signal,
    )
    expect(execution?.result).toEqual({
      kind: 'error',
      text: 'OpenAI already has a login in progress.',
    })
    await harness.ctx.fiber.dispose()
  })

  it('keeps the DeepSeek API-key fallback when no flow claims that route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const harness = await authHarness({
      authorizationFlows: [FLOW],
      answers: [commandAuth.DEEPSEEK_PROVIDER, 'sk-fallback'],
    })
    const execution = await harness.ctx.commands.execute(
      harness.agent,
      '/login',
      [],
      new AbortController().signal,
    )
    expect(harness.beginAuthorization).not.toHaveBeenCalled()
    expect(harness.set).toHaveBeenCalledWith(commandAuth.OMDSH_DEEPSEEK_API_KEY, 'sk-fallback')
    expect(execution?.result.kind).toBe('success')
    await harness.ctx.fiber.dispose()
  })

  it('logs out a flow record written by login even without a settings profile', async () => {
    const harness = await authHarness({
      configurable: [DEEPSEEK_ENTRY, OPENAI_ENTRY],
      authorizationFlows: [{ ...FLOW, methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }] }],
      fallback: { configured: true, source: 'env', writable: false },
      answers: [commandAuth.FLOW_VALUE_PREFIX + FLOW_KEY, 'logout'],
    })
    const login = await harness.ctx.commands.execute(
      harness.agent,
      '/login',
      [],
      new AbortController().signal,
    )
    expect(login?.result).toEqual({ kind: 'success', text: 'Logged in to OpenAI.' })
    expect(harness.listRecords).toBeDefined()
    await expect(harness.describeRecord(FLOW_KEY)).resolves.toEqual({
      configured: true, kind: 'grant', writable: true,
    })
    harness.prompt.mockClear()

    const logout = await harness.ctx.commands.execute(
      harness.agent,
      '/logout',
      [],
      new AbortController().signal,
    )
    expect(harness.prompt).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Provider' }))
    expect(harness.prompt).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Logout from OpenAI',
      question: 'Remove the stored OpenAI sign-in?',
    }))
    expect(harness.deleteRecord).toHaveBeenCalledWith(FLOW_KEY)
    expect(harness.settingsMutate).not.toHaveBeenCalled()
    expect(logout?.result).toEqual({ kind: 'success', text: 'Logged out from OpenAI.' })
    await expect(harness.describeRecord(FLOW_KEY)).resolves.toEqual({ configured: false, writable: true })
    await harness.ctx.fiber.dispose()
  })

  it('deletes a flow record without unsetting an independent catalog profile', async () => {
    const harness = await authHarness({
      configurable: [DEEPSEEK_ENTRY, OPENAI_ENTRY],
      authorizationFlows: [{ ...FLOW, methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }] }],
      records: new Map([[FLOW_KEY, { kind: 'grant' as const }]]),
      piAiSettings: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } } },
      answers: [commandAuth.FLOW_VALUE_PREFIX + FLOW_KEY, 'logout'],
    })
    const logout = await harness.ctx.commands.execute(
      harness.agent,
      '/logout',
      [],
      new AbortController().signal,
    )
    expect(harness.prompt).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Logout from OpenAI',
      question: 'Remove the stored OpenAI sign-in?',
    }))
    expect(harness.deleteRecord).toHaveBeenCalledWith(FLOW_KEY)
    expect(harness.settingsMutate).not.toHaveBeenCalled()
    expect(harness.unset).not.toHaveBeenCalled()
    expect(harness.ctx.settings.get(commandAuth.PI_AI_SETTINGS)).toEqual({
      providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } },
    })
    expect(logout?.result).toEqual({ kind: 'success', text: 'Logged out from OpenAI.' })
    await harness.ctx.fiber.dispose()
  })

  it('does not list or delete an unclaimed non-provider credential record', async () => {
    const otherKey = credentialKey('dsh-mcp-client', 'github')
    const harness = await authHarness({
      configurable: [DEEPSEEK_ENTRY, OPENAI_ENTRY],
      authorizationFlows: [{ ...FLOW, methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }] }],
      records: new Map([
        [FLOW_KEY, { kind: 'grant' as const }],
        [otherKey, { kind: 'grant' as const }],
      ]),
      answers: ['logout'],
    })
    const logout = await harness.ctx.commands.execute(
      harness.agent,
      '/logout',
      [],
      new AbortController().signal,
    )
    const listed = harness.prompt.mock.calls.flatMap(call => call[0]?.options ?? [])
    expect(listed.some(option => option.value === commandAuth.FLOW_VALUE_PREFIX + otherKey)).toBe(false)
    expect(listed.some(option => option.value === otherKey)).toBe(false)
    expect(listed.some(option => option.label === 'github')).toBe(false)
    expect(harness.deleteRecord).toHaveBeenCalledWith(FLOW_KEY)
    expect(harness.deleteRecord).not.toHaveBeenCalledWith(otherKey)
    await expect(harness.describeRecord(otherKey)).resolves.toEqual({
      configured: true, kind: 'grant', writable: true,
    })
    expect(logout?.result).toEqual({ kind: 'success', text: 'Logged out from OpenAI.' })
    await harness.ctx.fiber.dispose()
  })
})

describe('provider picker labeling', () => {
  const PI_AI_DEEPSEEK_FLOW: AuthorizationEntry = {
    key: credentialKey('llm-pi-ai', 'deepseek'),
    label: 'DeepSeek',
    methods: [{ id: 'api-key', label: 'DeepSeek API key' }],
    inFlight: false,
  }

  it('keeps the official DeepSeek route and hides the dormant pi-ai DeepSeek flow', async () => {
    const harness = await authHarness({
      authorizationFlows: [PI_AI_DEEPSEEK_FLOW],
      fallback: { configured: true, source: 'env', writable: false },
      records: new Map([[PI_AI_DEEPSEEK_FLOW.key, { kind: 'api-key' as const }]]),
      answers: [null, 'logout'],
    })

    await harness.ctx.commands.execute(harness.agent, '/login', [], new AbortController().signal)

    expect(harness.prompt).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.arrayContaining([
        expect.objectContaining({
          label: 'DeepSeek',
          value: commandAuth.DEEPSEEK_PROVIDER,
          description: 'DeepSeek API key',
          badge: { label: 'environment', tone: 'muted' },
        }),
        expect.objectContaining({ label: 'Custom', value: commandAuth.CUSTOM_PROVIDER_VALUE }),
      ]),
    }))
    const request = harness.prompt.mock.calls[0]?.[0] as { options?: readonly { value: string }[] }
    expect(request.options?.some(option => option.value.startsWith(commandAuth.FLOW_VALUE_PREFIX))).toBe(false)

    const logout = await harness.ctx.commands.execute(harness.agent, '/logout', [], new AbortController().signal)
    expect(harness.prompt).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Logout from DeepSeek (pi-ai compatibility)',
      question: 'Remove the stored DeepSeek (pi-ai compatibility) sign-in?',
    }))
    expect(harness.deleteRecord).toHaveBeenCalledWith(PI_AI_DEEPSEEK_FLOW.key)
    expect(logout?.result).toEqual({
      kind: 'success',
      text: 'Logged out from DeepSeek (pi-ai compatibility).',
    })
    await harness.ctx.fiber.dispose()
  })

  it('labels an explicitly configured pi-ai DeepSeek flow as a compatibility route', async () => {
    const harness = await authHarness({
      authorizationFlows: [PI_AI_DEEPSEEK_FLOW],
      piAiSettings: { providers: { deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY' } } },
      records: new Map([[PI_AI_DEEPSEEK_FLOW.key, { kind: 'api-key' as const }]]),
      answers: [null],
    })

    await harness.ctx.commands.execute(harness.agent, '/login', [], new AbortController().signal)

    expect(harness.prompt).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.arrayContaining([
        expect.objectContaining({
          label: 'DeepSeek (pi-ai compatibility)',
          value: commandAuth.FLOW_VALUE_PREFIX + PI_AI_DEEPSEEK_FLOW.key,
          badge: { label: 'signed in', tone: 'success' },
        }),
      ]),
    }))
    await harness.ctx.fiber.dispose()
  })
})
