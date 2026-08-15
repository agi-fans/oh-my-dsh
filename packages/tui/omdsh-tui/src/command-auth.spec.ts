import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CredentialInfo } from '@deepseek-ai/dsh-credentials'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as commandAuth from './command-auth.ts'
import type { TuiPrompt, TuiService } from './definition.ts'

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
}

const UNCONFIGURED: CredentialInfo = { configured: false, writable: true }

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
  let settingsValue: Record<string, unknown> = {
    apiKeyEnv: options.activeCredentialRef ?? String(commandAuth.DEEPSEEK_API_KEY),
  }
  const settingsUpdate = vi.fn(async (_namespace: unknown, patch: Record<string, unknown>) => {
    settingsValue = { ...settingsValue, ...patch }
  })
  const settingsMutate = vi.fn(async (_namespace: unknown, operations: readonly { op: string, path: readonly string[] }[]) => {
    for (const operation of operations) {
      if (operation.op === 'unset' && operation.path.join('.') === 'apiKeyEnv') {
        settingsValue = { ...settingsValue }
        delete settingsValue['apiKeyEnv']
      }
    }
  })
  ctx.provide('tui', { prompt } as unknown as TuiService)
  ctx.provide('credentials', { describe, set, unset } as never)
  ctx.provide('settings', {
    get: () => settingsValue,
    update: settingsUpdate,
    mutate: settingsMutate,
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
    const harness = await authHarness({ answers: ['  Bearer sk-live  '] })

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
    const harness = await authHarness({ answers: [secret] })

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
      answers: ['sk-user-choice'],
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
