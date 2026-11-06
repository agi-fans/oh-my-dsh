import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { commandPermission } from './permission.ts'
import type { TuiService } from '../definition.ts'

interface PermissionHarness {
  ctx: Context
  scope: Scope
  agent: Agent
  prompt: ReturnType<typeof vi.fn>
  switched: ReturnType<typeof vi.fn>
}

async function permissionHarness(answers: readonly (string | null)[]): Promise<PermissionHarness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const prompt = vi.fn().mockResolvedValue(null)
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
  }, { inject: ['commands'] }))
  await scope.ctx.plugin(commandPermission(agent))
  return { ctx, scope, agent, prompt, switched }
}

describe('permission command', () => {
  it('previews and revokes a rule through Access without registering another command', async () => {
    const h = await permissionHarness(['rules', 'rule-1', 'revoke'])
    const rule = { id: 'rule-1', tool: 'probe', arguments: '{"command":"echo hello"}', cwd: '/workspace', workspace: '/workspace',
      sandbox: 'workspace-write', reason: 'Wider access', scope: 'session', decision: 'allow' }
    let entries = [rule]
    const revoke = vi.fn(() => { entries = [] }), notice = vi.fn()
    h.ctx.provide('omdshApprovalRules', { list: () => entries, revoke } as never)
    Object.assign(h.ctx.tui, { notice })
    const result = await h.ctx.commands.execute(h.agent, '/permission', [], new AbortController().signal)
    expect(result?.result).toEqual({ kind: 'success' })
    expect(h.prompt.mock.calls[3]?.[0]).toMatchObject({ title: 'Approval rules', options: [], detail: 'Approval rule revoked.', emptyText: 'No approval rules for this session or workspace.' })
    expect(h.prompt.mock.calls[4]?.[0].title).toBe('Access')
    // The rule reads as the card's detail; the choice stays on the card.
    expect(h.prompt.mock.calls[2]?.[0].detail).toContain('echo hello')
    expect(h.prompt.mock.calls[2]?.[0].detail).toContain('Wider access')
    expect(revoke).toHaveBeenCalledWith(h.agent, 'rule-1')
    expect(notice).not.toHaveBeenCalled()
    expect(h.switched).not.toHaveBeenCalled()
    expect(h.ctx.commands.list(h.agent).map(command => command.name)).toEqual(['permission'])
    await h.scope.dispose(); await h.ctx.fiber.dispose()
  })
  it('shadows the raw command with a fixed-choice picker', async () => {
    const { ctx, scope, agent, prompt, switched } = await permissionHarness(['read-only'])
    const listed = ctx.commands.list(agent).find(command => command.name === 'permission')
    expect(listed).toEqual({ name: 'permission', description: 'Choose the session access level' })
    expect(ctx.commands.list(agent).some(command => command.name === 'access')).toBe(false)

    const execution = await ctx.commands.execute(agent, '/permission', [], new AbortController().signal)
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

    const invalid = await ctx.commands.execute(agent, '/permission read-only', [], new AbortController().signal)
    expect(invalid?.result).toEqual({ kind: 'error', text: 'Usage: /permission' })
    expect(prompt).toHaveBeenCalledOnce()
    await scope.dispose()
    await ctx.fiber.dispose()
  })

  it('requires a fixed-choice confirmation before full access', async () => {
    const { ctx, scope, agent, prompt, switched } = await permissionHarness(['danger-full-access', 'cancel'])
    const execution = await ctx.commands.execute(agent, '/permission', [], new AbortController().signal)

    expect(prompt).toHaveBeenCalledTimes(3)
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

it.each([
  { answers: ['rules'], changes: false },
  { answers: ['danger-full-access', 'cancel'], changes: false },
  { answers: ['workspace-write'], changes: false },
  { answers: ['danger-full-access', 'accept'], changes: true },
  { answers: ['read-only'], changes: true },
])('closes the composer Shell only for a confirmed Access change ($answers)', async ({ answers, changes }) => {
  const h = await permissionHarness(answers)
  const kill = vi.fn(async () => {})
  h.ctx.provide('terminals', { list: () => [{ name: 'Composer shell', type: 'shell', sessionId: 'shell-1' }], kill } as never)
  h.ctx.provide('omdshApprovalRules', { list: () => [] } as never)
  try {
    await h.ctx.commands.execute(h.agent, '/permission', [], new AbortController().signal)
    expect(kill).toHaveBeenCalledTimes(changes ? 1 : 0)
    expect(h.switched).toHaveBeenCalledTimes(changes ? 1 : 0)
    if (changes) expect(kill.mock.invocationCallOrder[0]).toBeLessThan(h.switched.mock.invocationCallOrder[0]!)
  } finally { await h.scope.dispose(); await h.ctx.fiber.dispose() }
})

it.each([null, 'back'])('returns from rule detail with %s and retains the list filter', async back => {
  const h = await permissionHarness(['rules'])
  const { promptBrowserState } = await import('../runtime/prompt-browser.ts')
  const rule = { id: 'rule-1', tool: 'probe', arguments: '{}', cwd: '/workspace', workspace: '/workspace',
    sandbox: 'workspace-write', reason: 'Wider access', scope: 'session', decision: 'allow' }
  h.ctx.provide('omdshApprovalRules', { list: () => [rule] } as never)
  h.prompt.mockImplementationOnce(async request => {
    Object.assign(promptBrowserState(request)!, { query: 'probe', selected: rule.id })
    return rule.id
  }).mockResolvedValueOnce(back)
  try {
    await h.ctx.commands.execute(h.agent, '/permission', [], new AbortController().signal)
    expect(h.prompt.mock.calls[3]![0]).toMatchObject({ title: 'Approval rules', dismissLabel: 'Back' })
    expect(promptBrowserState(h.prompt.mock.calls[3]![0])).toEqual({ query: 'probe', selected: rule.id })
    expect(h.prompt.mock.calls[4]![0].title).toBe('Access')
    expect(h.switched).not.toHaveBeenCalled()
  } finally { await h.scope.dispose(); await h.ctx.fiber.dispose() }
})

it('does not reopen Access when the rule list is superseded', async () => {
  const h = await permissionHarness(['rules'])
  h.ctx.provide('omdshApprovalRules', { list: () => [] } as never)
  h.prompt.mockImplementationOnce(async request => { request.onSuperseded?.(''); return null })
  try {
    await h.ctx.commands.execute(h.agent, '/permission', [], new AbortController().signal)
    expect(h.prompt).toHaveBeenCalledTimes(2)
    expect(h.switched).not.toHaveBeenCalled()
  } finally { await h.scope.dispose(); await h.ctx.fiber.dispose() }
})
