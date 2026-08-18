import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as commandPermission from './permission.ts'
import type { TuiService } from '../definition.ts'

interface PermissionHarness {
  ctx: Context
  scope: Scope
  agent: Agent
  prompt: ReturnType<typeof vi.fn>
  switched: ReturnType<typeof vi.fn>
}

async function permissionHarness(answers: readonly string[]): Promise<PermissionHarness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const prompt = vi.fn()
  for (const answer of answers) prompt.mockResolvedValueOnce(answer)
  const permissions = [
    { value: 'read-only', name: 'Read only', description: 'Inspect without writing.' },
    { value: 'workspace-write', name: 'Workspace write', description: 'Write inside the workspace.' },
    { value: 'danger-full-access', name: 'Full access', description: 'No sandbox or approval prompts.' },
  ]
  ctx.provide('tui', { prompt } as unknown as TuiService)
  ctx.provide('permissionPresets', {
    names: permissions.map(permission => permission.value),
    current: () => 'workspace-write',
    optionOf: (value: string) => permissions.find(permission => permission.value === value),
  } as never)
  const switched = vi.fn(({ rawInput }: { rawInput: string }) => ({ kind: 'success' as const, text: `preset ${rawInput.trim()}` }))
  ctx.commands.register({
    name: 'permission',
    description: 'Internal permission write path',
    input: { hint: '<preset>' },
    handler: switched,
  })
  const session = ctx.sessions.create(SessionId('permission-command-test'))
  const agent = {
    id: session.id,
    session,
    status: 'idle',
    inbox: { nextTurn: [], nextStep: [] },
  } as unknown as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => {
    scope = createScope(inner, agent)
    Object.defineProperty(scope.ctx, 'agent', { configurable: true, value: agent })
  }, { inject: ['commands'] }))
  await scope.ctx.plugin(commandPermission)
  return { ctx, scope, agent, prompt, switched }
}

describe('permission command', () => {
  it('shadows the raw command with a fixed-choice picker', async () => {
    const { ctx, scope, agent, prompt, switched } = await permissionHarness(['read-only'])
    const listed = ctx.commands.list(agent).find(command => command.name === 'permission')
    expect(listed).toEqual({ name: 'permission', description: 'Choose the session access level' })
    expect(ctx.commands.list(agent)).toContainEqual({
      name: 'access',
      description: 'Choose Read only, Workspace write, or Full access',
    })

    const execution = await ctx.commands.execute(agent, '/permission', new AbortController().signal)
    expect(prompt).toHaveBeenCalledOnce()
    expect(prompt.mock.calls[0]?.[0]).toMatchObject({
      title: 'Access',
      initialValue: 'workspace-write',
      allowCustom: false,
      options: [
        { label: 'Read only', value: 'read-only' },
        { label: 'Workspace write', value: 'workspace-write', description: expect.stringContaining('Current') },
        { label: 'Full access', value: 'danger-full-access' },
      ],
    })
    expect(switched).toHaveBeenCalledWith(expect.objectContaining({ rawInput: ' read-only' }))
    expect(execution?.result).toEqual({ kind: 'success', text: 'Access: Read only' })

    const invalid = await ctx.commands.execute(agent, '/permission read-only', new AbortController().signal)
    expect(invalid?.result).toEqual({ kind: 'error', text: 'Usage: /access or /permission' })
    expect(prompt).toHaveBeenCalledOnce()
    await scope.dispose()
    await ctx.fiber.dispose()
  })

  it('requires a fixed-choice confirmation before full access', async () => {
    const { ctx, scope, agent, prompt, switched } = await permissionHarness(['danger-full-access', 'cancel'])
    const execution = await ctx.commands.execute(agent, '/permission', new AbortController().signal)

    expect(prompt).toHaveBeenCalledTimes(2)
    expect(prompt.mock.calls[1]?.[0]).toMatchObject({
      title: 'Full access',
      initialValue: 'cancel',
      allowCustom: false,
    })
    expect(switched).not.toHaveBeenCalled()
    expect(execution?.result).toEqual({ kind: 'success' })
    await scope.dispose()
    await ctx.fiber.dispose()
  })
})
