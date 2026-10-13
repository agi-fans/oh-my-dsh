import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'
import { listWorktrees, parseWorktrees } from './worktrees.ts'

describe('Git worktree registry', () => {
  it('preserves NUL-delimited Unicode, spaces and newlines and marks detached, locked and prunable entries', () => {
    expect(parseWorktrees('worktree /repo/中文\n🐳\0HEAD abc\0branch refs/heads/feature/a\0locked reason\0\0worktree /repo/other space\0HEAD def\0detached\0prunable missing\0\0')).toEqual([
      { path: '/repo/中文\n🐳', branch: 'feature/a', locked: true }, { path: '/repo/other space', detached: true, prunable: true },
    ])
  })

  it.each(['success', 'failure', 'lossy'])('uses the Agent policy and current directory and waits for process cleanup on %s', async outcome => {
    const ctx = new Context()
    const agent = { session: { header: { cwd: '/original' } } } as unknown as Agent
    const policy = { mode: 'workspace-write', workspaceRoot: '/original' }
    const confine = vi.fn(async () => ({ argv: ['sandbox', 'git'] }))
    const child = { done: Promise.resolve({ exitCode: outcome === 'failure' ? 1 : 0 }), terminate: vi.fn(), waitForExit: vi.fn(async () => {}),
      collected: { stdout: { readFrom: () => ({ text: 'worktree /current\0branch refs/heads/main\0\0', lossy: outcome === 'lossy' }) }, stderr: { readFrom: () => ({ text: 'not a git repository' }) } } }
    const spawn = vi.fn(() => child)
    const resolve = vi.fn(() => policy)
    ctx.provide('workingDirectory', { get: () => '/current' } as never)
    ctx.provide('subprocess', { resolveExecutable: async () => 'git', spawn } as never)
    ctx.provide('sandbox', { confine } as never)
    ctx.provide('sandboxPolicy', { resolve } as never)
    try {
      const read = listWorktrees(ctx, agent, new AbortController().signal)
      if (outcome === 'success') expect(await read).toEqual([{ path: '/current', branch: 'main' }])
      else await expect(read).rejects.toThrow(outcome === 'failure' ? 'not a git repository' : 'output limit')
      expect(resolve).toHaveBeenCalledWith({ session: agent.session })
      expect(confine).toHaveBeenCalledWith(expect.arrayContaining(['worktree', 'list', '--porcelain', '-z']), policy, expect.any(AbortSignal))
      expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/current', argv: ['sandbox', 'git'], env: expect.objectContaining({ GIT_DIR: undefined, GIT_CONFIG_COUNT: '0' }) }))
      expect(child.terminate).toHaveBeenCalledOnce()
      expect(child.waitForExit).toHaveBeenCalledOnce()
    } finally { await ctx.fiber.dispose() }
  })
})
