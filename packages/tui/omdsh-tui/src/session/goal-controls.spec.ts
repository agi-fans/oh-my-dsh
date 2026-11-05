import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import GoalService from '@deepseek-ai/dsh-goal'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import type { TuiPrompt, TuiService } from '../definition.ts'
import { openGoalControls } from './goal-controls.ts'

async function fixture() {
  const ctx = new Context()
  await ctx.plugin(SessionStore); await ctx.plugin(SessionProjections); await ctx.plugin(AgentRegistry); await ctx.plugin(GoalService)
  const session = ctx.sessions.create(SessionId('goal-controls'))
  const agent = { id: session.id, session, status: 'idle', steer: vi.fn(), inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent
  ctx.agents.enter(agent, undefined)
  ctx.goals.create(agent, { objective: 'Original\n第二行 🐳', maxGoalRounds: 3 })
  const prompt = vi.fn(async (_request: TuiPrompt): Promise<string | null> => null)
  const abort = new AbortController()
  const run = () => openGoalControls(ctx, { prompt } as unknown as TuiService, agent, abort.signal)
  return { ctx, agent, prompt, abort, run }
}

it('reads live activation and pauses, resumes and edits through the published goal service', async () => {
  const h = await fixture()
  try {
    h.ctx.goals.disarm(h.agent)
    h.prompt.mockImplementationOnce(async request => {
      expect(request.detail).toContain('Waiting for your instruction')
      expect(request.options?.[0]?.value).toBe('resume')
      return 'resume'
    }).mockResolvedValueOnce('pause').mockResolvedValueOnce('edit').mockImplementationOnce(async request => {
      expect(request.initialInput).toBe('Original\n第二行 🐳')
      return 'Edited\n第三行'
    }).mockResolvedValueOnce(null)
    await h.run()
    expect(h.ctx.goals.get(h.agent), JSON.stringify(h.prompt.mock.calls.map(([request]) => request.detail))).toMatchObject({ phase: 'paused', activation: 'disarmed', objective: 'Edited\n第三行' })
  } finally { await h.ctx.fiber.dispose() }
})

it('preserves an edit draft after a concurrent change without overwriting the new revision', async () => {
  const h = await fixture()
  try {
    h.prompt.mockResolvedValueOnce('edit').mockImplementationOnce(async () => {
      h.ctx.goals.edit(h.agent, h.ctx.goals.get(h.agent)!, { objective: 'Changed elsewhere' })
      return 'My unfinished edit'
    }).mockImplementationOnce(async request => {
      expect(request.detail).toContain('Changed elsewhere')
      expect(h.ctx.goals.get(h.agent)?.objective).toBe('Changed elsewhere')
      return 'edit'
    }).mockImplementationOnce(async request => {
      expect(request.initialInput).toBe('My unfinished edit')
      return null
    })
    await h.run()
    expect(h.ctx.goals.get(h.agent)?.objective).toBe('Changed elsewhere')
  } finally { await h.ctx.fiber.dispose() }
})

it.each(['edit', 'clear', 'resume'])('rejects a late %s after the session scope is cancelled', async action => {
  const h = await fixture()
  try {
    h.ctx.goals.disarm(h.agent)
    const before = h.ctx.goals.get(h.agent)
    h.prompt.mockImplementationOnce(async () => {
      if (action === 'resume') h.abort.abort()
      return action
    }).mockImplementationOnce(async request => { h.abort.abort(); return action === 'edit' ? 'Late edit' : request.options?.[0]?.value ?? null })
    await h.run()
    expect(h.ctx.goals.get(h.agent)).toEqual(before)
  } finally { await h.ctx.fiber.dispose() }
})

it('requires confirmation before clearing and uses the displayed revision', async () => {
  const h = await fixture()
  try {
    h.prompt.mockResolvedValueOnce('clear').mockImplementationOnce(async request => {
      expect(request.initialValue).toBe('cancel')
      h.ctx.goals.edit(h.agent, h.ctx.goals.get(h.agent)!, { objective: 'Replacement' })
      return 'accept'
    }).mockResolvedValueOnce(null)
    await h.run()
    expect(h.ctx.goals.get(h.agent)?.objective).toBe('Replacement')
  } finally { await h.ctx.fiber.dispose() }
})

it('disables resume when all admitted rounds have been used', async () => {
  const h = await fixture()
  try {
    const goal = h.ctx.goals.get(h.agent)!
    // The exhausted live view is a service boundary; no TUI round counter is maintained.
    vi.spyOn(h.ctx.goals, 'get').mockReturnValue({ ...goal, phase: 'blocked', activation: 'disarmed', roundsStarted: 3 })
    h.prompt.mockImplementationOnce(async request => {
      expect(request.detail).toContain('round limit is reached')
      expect(request.options?.[0]).toMatchObject({ value: 'resume', disabled: true })
      return null
    })
    await h.run()
  } finally { await h.ctx.fiber.dispose() }
})

it('does not carry an unsaved objective into a replacement goal', async () => {
  const h = await fixture()
  try {
    h.prompt.mockResolvedValueOnce('edit').mockImplementationOnce(async () => {
      h.ctx.goals.clear(h.agent, h.ctx.goals.get(h.agent)!)
      h.ctx.goals.create(h.agent, { objective: 'New goal', maxGoalRounds: 3 })
      return 'Old goal draft'
    }).mockResolvedValueOnce('edit').mockImplementationOnce(async request => {
      expect(request.initialInput).toBe('New goal')
      return null
    })
    await h.run()
    expect(h.ctx.goals.get(h.agent)?.objective).toBe('New goal')
  } finally { await h.ctx.fiber.dispose() }
})
