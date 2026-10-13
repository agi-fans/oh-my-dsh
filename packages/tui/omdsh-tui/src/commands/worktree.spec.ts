import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Commands from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TuiPrompt } from '../definition.ts'
import { describe, expect, it, vi } from 'vitest'
import * as command from './worktree.ts'

async function harness(enabled = false) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(Commands)
  let cwd = '/repo'
  const set = vi.fn(async (_agent, path: string) => { cwd = path; return path })
  const answers: (string | null)[] = []
  const prompt = vi.fn(async (request: TuiPrompt): Promise<string | null> => {
    if (request.title === 'Creating worktree') return new Promise(resolve => { request.signal?.addEventListener('abort', () => { resolve(null) }, { once: true }) })
    return answers.shift() ?? null
  })
  const notice = vi.fn()
  const create = vi.fn(async () => { cwd = '/repo/.agents/worktrees/feature'; return { path: cwd, branch: 'feature', baseCommit: 'abc', repositoryRoot: '/repo' } })
  ctx.provide('tui', { interactive: true, prompt, notice } as never)
  ctx.provide('workingDirectory', { get: () => cwd, set, defaultDirectory: '/repo' } as never)
  ctx.provide('subprocess', { resolveExecutable: async () => 'git', spawn: () => ({ done: Promise.resolve({ exitCode: 0 }), terminate: () => {}, waitForExit: async () => {},
    collected: { stdout: { readFrom: () => ({ text: 'worktree /repo\0branch refs/heads/main\0\0worktree /repo/.agents/worktrees/feature\0branch refs/heads/feature\0\0' }) } } }) } as never)
  ctx.provide('sandbox', {} as never)
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'danger-full-access' }) } as never)
  if (enabled) ctx.provide('worktrees', { create } as never)
  await ctx.plugin(command)
  const session = ctx.sessions.create(SessionId('worktree-test'), { meta: { cwd: '/repo' } })
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  return { ctx, set, answers, prompt, notice, create, agent, execute: (text = '/worktree') => ctx.commands.execute(agent, text, [], new AbortController().signal) }
}

describe('/worktree', () => {
  it('offers explicit enablement when creation is off and never creates a checkout', async () => {
    const h = await harness()
    try {
      h.answers.push('enable')
      expect((await h.execute())?.result.kind).toBe('error')
      expect(h.prompt.mock.calls[0]![0].options).toContainEqual(expect.objectContaining({ value: 'enable' }))
      expect(h.create).not.toHaveBeenCalled()
      expect(h.notice).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('switches registered checkouts and returns to the immutable original directory', async () => {
    const h = await harness()
    try {
      h.answers.push('enter:1', 'return', null)
      await h.execute()
      expect(h.set.mock.calls.map(call => call[1])).toEqual(['/repo/.agents/worktrees/feature', '/repo'])
      expect(h.agent.session.header.cwd).toBe('/repo')
      expect(h.prompt.mock.calls[1]![0].options).toContainEqual(expect.objectContaining({ value: 'return' }))
      expect((await h.execute('/worktree return'))?.result).toMatchObject({ kind: 'success', text: expect.stringContaining('retained') })
    } finally { await h.ctx.fiber.dispose() }
  })

  it('creates only after confirmation using the published owner-scoped service', async () => {
    const h = await harness(true)
    try {
      h.answers.push('create', 'feature', 'HEAD', 'create', null)
      await h.execute()
      expect(h.create).toHaveBeenCalledWith(h.agent, { name: 'feature', from: 'HEAD' }, expect.any(AbortSignal))
      expect(h.prompt.mock.calls[3]![0].detail).toContain('Uncommitted files stay here')
      expect(h.notice).toHaveBeenCalledWith(expect.stringContaining('Entered feature'))
      expect(h.agent.session.header.cwd).toBe('/repo')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('cancels creation and awaits its cleanup before returning', async () => {
    const h = await harness(true)
    let cleaned = false
    try {
      h.answers.push('create', 'feature', 'HEAD', 'create')
      h.prompt.mockImplementation(async request => request.title === 'Creating worktree' ? 'cancel' : h.answers.shift() ?? null)
      h.create.mockImplementation((...args: unknown[]) => new Promise((_, reject) => {
        const signal = args[2] as AbortSignal
        const finish = () => { cleaned = true; reject(new Error('cancelled after cleanup')) }
        if (signal.aborted) finish()
        else signal.addEventListener('abort', finish, { once: true })
      }))
      expect((await h.execute())?.result.kind).toBe('error')
      expect(cleaned).toBe(true)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('does not create on dismissed confirmation or switch while a turn is active', async () => {
    const h = await harness(true)
    try {
      h.answers.push('create', 'feature', 'HEAD', null, null)
      await h.execute()
      expect(h.create).not.toHaveBeenCalled()
      Object.assign(h.agent, { status: 'running' })
      expect((await h.execute('/worktree return'))?.result.kind).toBe('error')
      expect(h.set).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })
})


it('enables creation in place through the existing Plugin Manager without creating a checkout', async () => {
  const h = await harness()
  const setBundleEnabled = vi.fn(async () => {
    h.ctx.provide('worktrees', { create: h.create } as never)
    return { application: 'applied' }
  })
  h.ctx.provide('pluginManager', { setBundleEnabled } as never)
  try {
    h.answers.push('enable', null)
    expect((await h.execute())?.result.kind).toBe('success')
    expect(setBundleEnabled).toHaveBeenCalledWith('@deepseek-ai/dsh-experimental-tool-worktree', true)
    expect(h.prompt.mock.calls[1]![0].options).toContainEqual(expect.objectContaining({ value: 'create' }))
    expect(h.create).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})
