import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ScheduleDeliveryHistoryResult, ScheduleRecord } from '@deepseek-ai/dsh-schedule'
import { ScheduleId } from '@deepseek-ai/dsh-schedule'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { TuiService } from '../definition.ts'
import * as command from './schedule.ts'

const record: ScheduleRecord = {
  id: ScheduleId('task-1'),
  kind: 'at',
  title: 'Release check',
  prompt: 'Check the release',
  scheduledAt: '2099-01-01T01:00:00Z',
}

function history(): ScheduleDeliveryHistoryResult {
  return {
    id: record.id,
    records: [{
      messageId: MessageId('msg-1'),
      scheduledAt: '2099-01-01T01:00:00Z',
      deliveredAt: '2099-01-01T01:00:02Z',
      prompt: 'Check the release',
    }],
    earlierRecordsUnavailable: false,
    earlierRecordsPruned: false,
    retention: { days: 30, records: 200 },
  }
}

async function fixture(tasks: ScheduleRecord[], prompts: (string | null)[]) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const prompt = vi.fn(async () => prompts.shift() ?? null)
  ctx.provide('tui', { prompt } as unknown as TuiService)
  let currentSessionId: SessionId | undefined
  const schedule = {
    list: vi.fn(async () => tasks),
    // The command reads the catalog: it is the only read that reports whether a
    // reminder can still fire. The session is bound below, so this reads it late.
    catalog: vi.fn(async () => tasks.map(task => ({ ...task, sessionId: currentSessionId, status: 'active' as const }))),
    history: vi.fn(async () => history()),
    update: vi.fn(async (request: { title?: string; prompt?: string }) => ({
      id: record.id,
      updated: true,
      record: { ...record, ...(request.title === undefined ? {} : { title: request.title }), ...(request.prompt === undefined ? {} : { prompt: request.prompt }) },
    })),
    delete: vi.fn(async () => ({ id: record.id, deleted: true })),
  }
  ctx.provide('schedule', schedule as never)
  await ctx.plugin(command)
  const session = ctx.sessions.create(SessionId(`schedule-${Math.random().toString(16).slice(2)}`))
  currentSessionId = session.id
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  return { ctx, agent, prompt, schedule }
}

describe('/schedule command', () => {
  it('reports an empty task list without opening a picker', async () => {
    const f = await fixture([], [])
    try {
      const execution = await f.ctx.commands.execute(f.agent, '/schedule', [], new AbortController().signal)
      expect(execution?.result).toMatchObject({
        kind: 'success',
        text: 'No scheduled tasks in this session. Ask the agent to create one with `schedule_create`.',
      })
      expect(f.prompt).not.toHaveBeenCalled()
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it('deletes a reminder after confirmation', async () => {
    const f = await fixture([record], ['task-1', 'delete', 'delete'])
    try {
      const execution = await f.ctx.commands.execute(f.agent, '/schedule', [], new AbortController().signal)
      expect(execution?.result).toMatchObject({ kind: 'success', text: 'Deleted reminder "Release check".' })
      expect(f.schedule.delete).toHaveBeenCalledWith({ sessionId: f.agent.session.id, id: record.id })
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it('renames a reminder with its observed record', async () => {
    const f = await fixture([record], ['task-1', 'title', 'Release verification'])
    try {
      const execution = await f.ctx.commands.execute(f.agent, '/schedule', [], new AbortController().signal)
      expect(execution?.result).toMatchObject({ kind: 'success', text: 'Updated name for "Release verification".' })
      expect(f.schedule.update).toHaveBeenCalledWith(expect.objectContaining({
        id: record.id,
        expected: record,
        title: 'Release verification',
      }))
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it('opens retained delivery records and returns to the action list', async () => {
    const f = await fixture([record], ['task-1', 'history', 'back', null])
    try {
      const execution = await f.ctx.commands.execute(f.agent, '/schedule', [], new AbortController().signal)
      expect(execution?.result).toMatchObject({ kind: 'success' })
      expect(f.schedule.history).toHaveBeenCalledWith({ sessionId: f.agent.session.id, id: record.id, limit: 20 })
      const historyPrompt = f.prompt.mock.calls[2]?.[0] as { detail?: string } | undefined
      expect(historyPrompt?.detail).toContain('Deliveries · newest first')
      expect(historyPrompt?.detail).toContain('Check the release')
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it('renders rule and instant text deterministically', () => {
    expect(command.scheduleRule(record)).toBe('once at 2099-01-01 01:00 UTC')
    expect(command.formatInstant('2099-01-01T01:00:00Z')).toBe('2099-01-01 01:00 UTC')
    expect(command.scheduleRule({ ...record, kind: 'every', everySeconds: 300 } as ScheduleRecord)).toBe('every 300s')
  })
})

describe('reminder timing as a reader asks it', () => {
  const record = { id: 'task-1', kind: 'every' as const, title: 'Check', prompt: 'Check', everySeconds: 3600, scheduledAt: '2026-10-27T13:00:00Z' }
  const now = Date.parse('2026-10-27T12:48:00Z')

  it('answers how soon, and still shows the instant to check against', () => {
    // "next 2026-10-27 13:00 UTC" made the reader subtract; the surface knows.
    expect(command.scheduleWhen(record, 'active', now)).toBe('next in 12m · 2026-10-27 13:00 UTC')
  })

  it('never describes a stopped reminder as pending', () => {
    // A reminder that can no longer fire is not "next"; its instant is the last
    // one it had.
    expect(command.scheduleWhen(record, 'inactive', now)).toBe('ended · was 2026-10-27 13:00 UTC')
  })

  it('calls an overdue active reminder due rather than showing a negative wait', () => {
    expect(command.scheduleWhen(record, 'active', Date.parse('2026-10-27T13:05:00Z'))).toBe('next due now · 2026-10-27 13:00 UTC')
  })
})
