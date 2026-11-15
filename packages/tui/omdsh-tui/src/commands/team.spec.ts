import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TeamTaskId, type TeamTaskView } from '@deepseek-ai/dsh-agent-team'
import Commands from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import type { TuiPrompt } from '../definition.ts'
import * as teamCommand from './team.ts'

async function fixture(interactive = true) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(Commands)
  let enabled = false
  const tasks: TeamTaskView[] = [
    {
      id: TeamTaskId('1'),
      revision: 2,
      subject: 'Implement parser',
      description: 'Parse config tokens cleanly.',
      status: 'in_progress',
      blockedBy: [],
      writeScopes: ['src/parser.ts'],
      ownerId: SessionId('worker-1'),
      ownerName: 'parser-worker',
      ready: true,
      writeScopeWarnings: ['Overlaps with task #2 on src/parser.ts'],
    },
  ]
  const setEnabled = vi.fn(async (_agent: Agent, next: boolean) => { enabled = next })
  const prompt = vi.fn(async (_request: TuiPrompt): Promise<string | null> => null)
  const notice = vi.fn()
  ctx.provide('tui', { prompt, notice, interactive, prefs: () => ({ uiLanguage: 'en' }) } as never)
  ctx.provide('agentTeams', {
    isEnabled: () => enabled,
    setEnabled,
    listTasks: () => tasks,
  } as never)
  await ctx.plugin(teamCommand)
  const session = ctx.sessions.create(SessionId('team-root'))
  const root = { id: session.id, session } as Agent
  const abort = new AbortController()
  const execute = (line = '/team', agent: Agent = root) => ctx.commands.execute(agent, line, [], abort.signal)
  return { ctx, prompt, notice, setEnabled, root, abort, execute, getEnabled: () => enabled }
}

describe('/team command', () => {
  it('supports /team on, /team off, and /team status directly and resolves the root agent when inspecting a child', async () => {
    const h = await fixture(true)
    const child = { id: SessionId('child-1'), session: h.root.session } as Agent
    h.ctx.provide('subagents', { rootOf: () => h.root } as never)
    try {
      const onResult = (await h.execute('/team on', child))?.result
      expect(onResult?.kind).toBe('success')
      expect(h.setEnabled).toHaveBeenCalledWith(h.root, true, expect.any(AbortSignal))
      expect(h.getEnabled()).toBe(true)

      const statusResult = (await h.execute('/team status'))?.result
      expect(statusResult?.kind).toBe('success')
      expect(statusResult?.text).toContain('Mode: **Enabled**')
      expect(statusResult?.text).toContain('#1 | in progress | parser-worker | Implement parser | src/parser.ts')
      expect(statusResult?.text).toContain('Overlaps with task #2 on src/parser.ts')

      const offResult = (await h.execute('/team off'))?.result
      expect(offResult?.kind).toBe('success')
      expect(h.getEnabled()).toBe(false)

      const badResult = (await h.execute('/team invalid'))?.result
      expect(badResult).toEqual({ kind: 'error', text: 'Usage: /team [on|off|status]' })
    } finally {
      await h.ctx.fiber.dispose()
    }
  })

  it('toggles Team mode and inspects task details interactively', async () => {
    const h = await fixture(true)
    h.prompt
      .mockResolvedValueOnce('toggle')
      .mockResolvedValueOnce('task:1')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    try {
      await h.execute('/team')
      expect(h.setEnabled).toHaveBeenCalledWith(h.root, true, expect.any(AbortSignal))
      expect(h.notice).toHaveBeenCalledWith('Agent Teams enabled for this session.', { transient: true })
      const detailPrompt = h.prompt.mock.calls[2]![0]
      expect(detailPrompt.presentation).toBe('document')
      expect(detailPrompt.detail).toContain('## #1 · Implement parser')
      expect(detailPrompt.detail).toContain('Parse config tokens cleanly.')
      expect(detailPrompt.detail).toContain('Overlaps with task #2 on src/parser.ts')
    } finally {
      await h.ctx.fiber.dispose()
    }
  })
})
