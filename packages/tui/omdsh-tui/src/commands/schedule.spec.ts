import { promptBrowserState } from '../runtime/prompt-browser.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ScheduleCatalogEntry, ScheduleDeliveryHistoryResult, ScheduleEditRequest, ScheduleRecord } from '@deepseek-ai/dsh-schedule'
import { ScheduleId } from '@deepseek-ai/dsh-schedule'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { TuiPrompt } from '../definition.ts'
import * as command from './schedule.ts'
import { scheduleCatalog } from './schedule-catalog.ts'

const sessionId = SessionId('schedule-test')
const record: ScheduleCatalogEntry = {
  id: ScheduleId('task-1'), kind: 'every', everySeconds: 3600, title: 'Release check', prompt: 'Current instruction',
  scheduledAt: '2099-01-01T01:00:00Z', status: 'active', updatedAt: '2026-11-05T01:00:00Z',
  target: { kind: 'session', sessionId }, involvedSessionIds: [sessionId],
}
function history(id = 'msg-1', next?: string): ScheduleDeliveryHistoryResult {
  return { id: record.id, records: [{ messageId: MessageId(id), targetSessionId: sessionId, scheduledAt: '2026-11-05T00:00:00Z', deliveredAt: '2026-11-05T00:00:02Z', prompt: `Saved ${id}` }],
    earlierRecordsUnavailable: false, earlierRecordsPruned: false, retention: { days: 30, records: 200 }, ...(next ? { nextBefore: MessageId(next) } : {}) }
}
type Answer = string | null | ((request: TuiPrompt) => string | null | Promise<string | null>)
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
async function fixture(answers: Answer[], tasks: ScheduleCatalogEntry[] = [structuredClone(record)], language: 'en' | 'zh-CN' = 'en') {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SessionStore); await ctx.plugin(CommandRuntime)
  let assertionFailure: unknown
  const prompt = vi.fn(async (request: TuiPrompt) => {
    const next = answers.shift()
    try { return typeof next === 'function' ? await next(request) : next ?? null }
    catch (error) { assertionFailure = error; throw error }
  })
  const notice = vi.fn(), abort = new AbortController()
  ctx.provide('tui', { prompt, notice, prefs: () => ({ uiLanguage: language }) } as never)
  let current = tasks
  const update = (next: ScheduleCatalogEntry[]) => { current = next; ctx.emit('schedule/changed') }
  const schedule = {
    catalog: vi.fn(async () => structuredClone(current)), history: vi.fn(async (): Promise<ScheduleDeliveryHistoryResult> => history()),
    run: vi.fn(async () => { update(current.map(task => ({ ...task, executionActive: true, deliveryFloorEndsAt: '2099-01-02T00:00:00Z' }))); return current[0]! }),
    edit: vi.fn(async (request: ScheduleEditRequest) => {
      const existing = current.find(task => task.id === request.id)
      if (!existing) return { id: request.id, code: 'schedule_not_found' as const }
      if (request.expectedUpdatedAt !== (existing.updatedAt ?? null)) return { id: request.id, code: 'schedule_conflict' as const }
      if (request.action === 'delete') { update(current.filter(task => task.id !== request.id)); return { id: request.id, deleted: true as const } }
      const next = { ...existing, ...request.patch, ...(request.patch.active === undefined ? {} : { status: request.patch.active ? 'active' as const : 'paused' as const }), updatedAt: new Date(Date.parse(existing.updatedAt!) + 1000).toISOString() }
      update(current.map(task => task.id === next.id ? next : task)); return next
    }),
  }
  ctx.provide('schedule', schedule as never); await ctx.plugin(command)
  const session = ctx.sessions.create(sessionId), agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  return { ctx, agent, prompt, notice, schedule, update, current: () => current, abort,
    run: () => ctx.commands.execute(agent, '/schedule', [], abort.signal).finally(() => { if (assertionFailure) throw assertionFailure }) }
}

describe('/schedule command', () => {
  it('keeps an empty list refreshable and excludes tasks belonging to other sessions', async () => {
    const f = await fixture([null], [{ ...record, involvedSessionIds: [SessionId('other')] }])
    expect((await f.run())?.result.kind).toBe('success')
    const request = f.prompt.mock.calls[0]![0]
    expect(request.detail).toContain('No scheduled tasks in this session')
    expect(request.options?.map(row => row.value)).toEqual(['@refresh'])
    expect(f.schedule.run).not.toHaveBeenCalled()
  })

  it('pauses and resumes through the service with the observed revision and invocation signal', async () => {
    const f = await fixture(['task-1', 'pause', request => {
      expect(request.detail).toContain('Reminder paused.')
      expect(request.initialValue).toBe('resume'); return 'resume'
    }, request => { expect(request.detail).toContain('Reminder resumed.'); return null }, null])
    await f.run()
    expect(f.schedule.edit).toHaveBeenNthCalledWith(1, { id: record.id, action: 'update', patch: { active: false }, expectedUpdatedAt: record.updatedAt }, sessionId, f.abort.signal)
    expect(f.schedule.edit.mock.calls[1]?.[0]).toMatchObject({ patch: { active: true }, expectedUpdatedAt: '2026-11-05T01:00:01.000Z' })
  })

  it('reports manual delivery without claiming execution completed or changing timing', async () => {
    const f = await fixture(['task-1', 'run', request => {
      expect(request.detail?.match(/This task is queued or running/gu)).toHaveLength(1)
      expect(request.detail).toContain('Instruction delivered.')
      expect(request.options?.find(row => row.value === 'run')?.disabled).toBe(true)
      expect(request.options?.find(row => row.value === 'delete')?.disabled).toBe(true)
      return null
    }, null])
    await f.run()
    expect(f.schedule.run).toHaveBeenCalledWith({ id: record.id }, f.abort.signal)
    expect(f.schedule.edit).not.toHaveBeenCalled()
    expect(f.current()[0]?.scheduledAt).toBe(record.scheduledAt)
  })

  it('treats the service pending result as a status and retains the task', async () => {
    const f = await fixture(['task-1', 'run', request => { expect(request.detail).toContain('already queued, running'); return null }, null])
    f.schedule.run.mockResolvedValue({ id: record.id, code: 'schedule_execution_pending' } as never)
    await f.run(); expect(f.current()).toHaveLength(1)
  })

  it.each(['run', 'pause', 'title', 'delete'])('rejects stale %s actions when a delivery starts while the menu is open', async action => {
    const f = await fixture(['task-1', () => { f.update([{ ...record, executionActive: true }]); return action }, null, null])
    await f.run(); expect(f.schedule.run).not.toHaveBeenCalled(); expect(f.schedule.edit).not.toHaveBeenCalled()
  })

  it('honors the minimum interval while allowing pause and deletion', async () => {
    const task = { ...record, deliveryFloorEndsAt: '2099-01-02T00:00:00Z' }
    const f = await fixture(['task-1', request => {
      expect(request.detail).toContain('2099-01-02 00:00 UTC')
      expect(request.options?.find(row => row.value === 'run')?.disabled).toBe(false)
      expect(request.options?.find(row => row.value === 'pause')?.disabled).toBe(false)
      return 'run'
    }, 'pause', null, null], [task])
    await f.run(); expect(f.schedule.run).not.toHaveBeenCalled(); expect(f.schedule.edit).toHaveBeenCalledTimes(1)
  })

  it('does not run into an archived destination', async () => {
    const f = await fixture(['task-1', 'run', null, null])
    f.ctx.provide('workspaceRegistry', { archivedSessionIds: [sessionId] } as never)
    await f.run(); expect(f.schedule.run).not.toHaveBeenCalled()
  })

  it('requires a separate delete confirmation with Keep selected', async () => {
    const f = await fixture(['task-1', 'delete', request => { expect(request.initialValue).toBe('cancel'); return 'cancel' }, 'delete', 'accept', null])
    await f.run()
    expect(f.schedule.edit).toHaveBeenCalledTimes(1)
    expect(f.schedule.edit).toHaveBeenCalledWith({ id: record.id, action: 'delete', expectedUpdatedAt: record.updatedAt }, sessionId, f.abort.signal)
    expect(f.notice).toHaveBeenCalledWith('Deleted reminder “Release check”.', { transient: true })
  })

  it('retains the editor revision when a reminder changes elsewhere', async () => {
    const f = await fixture(['task-1', 'title', () => { f.update([{ ...record, title: 'Remote', updatedAt: '2026-11-05T02:00:00Z' }]); return 'Local' }, request => {
      expect(request.detail).toContain('changed elsewhere'); expect(request.detail).toContain('Remote'); return null
    }, null])
    await f.run(); expect(f.current()[0]?.title).toBe('Remote')
    expect(f.schedule.edit.mock.calls[0]?.[0].expectedUpdatedAt).toBe(record.updatedAt)
  })

  it('discards cancellation before mutation', async () => {
    const f = await fixture(['task-1', 'title', () => { f.abort.abort(); return 'Later' }])
    await expect(f.run()).rejects.toMatchObject({ name: 'AbortError' }); expect(f.schedule.edit).not.toHaveBeenCalled()
  })

  it('refreshes an open list on events and keeps rows stable without changes', async () => {
    const f = await fixture([async request => {
      const first = request.refreshOptions!()
      expect(request.refreshOptions!()).toBe(first)
      f.update([{ ...record, status: 'paused' }]); request.refreshOptions!(); await flush()
      expect(request.refreshOptions!().find(row => row.value === record.id)?.badge?.label).toBe('Paused')
      return null
    }])
    await f.run(); const count = f.schedule.catalog.mock.calls.length
    f.ctx.emit('schedule/changed'); await flush(); expect(f.schedule.catalog).toHaveBeenCalledTimes(count)
  })

  it('retains the prior catalog on failure and disables writes until refresh succeeds', async () => {
    const f = await fixture(['task-1', async request => {
      f.schedule.catalog.mockRejectedValueOnce(new Error('offline')); f.ctx.emit('schedule/changed')
      request.refreshOptions!(); await flush()
      expect(request.refreshDocument!()).toContain('last loaded state')
      expect(request.refreshOptions!().find(row => row.value === 'pause')?.disabled).toBe(true)
      return 'refresh'
    }, request => { expect(request.refreshOptions!().find(row => row.value === 'pause')?.disabled).toBe(false); return null }, null])
    await f.run()
  })

  it('keeps an acknowledged write successful if the subsequent refresh fails', async () => {
    const f = await fixture(['task-1', 'pause', request => {
      expect(request.detail).toContain('Reminder paused.'); expect(request.detail).toContain('last loaded state'); return null
    }, null])
    const edit = f.schedule.edit.getMockImplementation()!
    f.schedule.edit.mockImplementation(async (...args) => { const result = await edit(...args); f.schedule.catalog.mockRejectedValueOnce(new Error('offline')); return result })
    await f.run(); expect(f.schedule.edit).toHaveBeenCalledTimes(1)
  })

  it.each(['en', 'zh-CN'] as const)('localizes controls without translating task content (%s)', async language => {
    const f = await fixture(['task-1', request => {
      expect(request.detail).toContain('Current instruction')
      expect(request.options?.find(row => row.value === 'pause')?.label).toBe(language === 'en' ? 'Pause reminder' : '暂停提醒'); return null
    }, null], [structuredClone(record)], language)
    await f.run()
  })
})

describe('retained delivery browsing', () => {
  it('loads older pages by cursor and shows immutable historical instructions', async () => {
    const f = await fixture(['task-1', 'history', 'older', request => {
      expect(request.options?.map(row => row.description)).toEqual(expect.arrayContaining(['Saved msg-1', 'Saved msg-2']))
      return 'record:1'
    }, request => { expect(request.documentSource?.text).toContain('Saved msg-2'); expect(request.documentSource?.text).not.toContain('Current instruction'); return null }, 'back', null, null])
    f.schedule.history.mockResolvedValueOnce(history('msg-1', 'msg-1')).mockResolvedValueOnce(history('msg-2'))
    await f.run()
    expect(f.schedule.history).toHaveBeenNthCalledWith(2, { id: record.id, limit: 20, before: MessageId('msg-1') })
  })

  it('keeps loaded records and retries the same cursor after a page failure', async () => {
    const f = await fixture(['task-1', 'history', 'older', request => {
      expect(request.options?.[0]?.description).toBe('Saved msg-1')
      expect(request.options?.find(row => row.value === 'older')?.label).toBe('Retry older records'); return 'older'
    }, 'back', null, null])
    f.schedule.history.mockResolvedValueOnce(history('msg-1', 'msg-1')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(history('msg-2'))
    await f.run(); expect(f.schedule.history.mock.calls[1]).toEqual(f.schedule.history.mock.calls[2])
  })

  it('announces pruning only after the last saved page and does not invent missing prompts', async () => {
    const last = history('old'); if ('code' in last) throw new Error('fixture')
    delete last.records[0]!.prompt
    const first = history('new', 'new'); if ('code' in first) throw new Error('fixture')
    const f = await fixture(['task-1', 'history', request => { expect(request.detail).not.toContain('removed by retention'); return 'older' }, request => {
      expect(request.detail).toContain('removed by retention'); expect(request.options?.[1]?.description).toBe('Historical instruction unavailable'); return 'back'
    }, null, null])
    f.schedule.history.mockResolvedValueOnce({ ...first, earlierRecordsPruned: true }).mockResolvedValueOnce({ ...last, earlierRecordsPruned: true })
    await f.run()
  })

  it('retains records after a missing cursor and offers Refresh rather than a doomed retry', async () => {
    const f = await fixture(['task-1', 'history', 'older', request => {
      expect(request.detail).toContain('Delivery history changed')
      expect(request.options?.some(row => row.value === 'older')).toBe(false)
      expect(request.options?.[0]?.description).toBe('Saved msg-1'); return 'back'
    }, null, null])
    f.schedule.history.mockResolvedValueOnce(history('msg-1', 'msg-1')).mockResolvedValueOnce({ id: record.id, code: 'delivery_cursor_not_found' })
    await f.run()
  })

  it('does not reopen a page after an aborted history request returns', async () => {
    const pending = deferred<ScheduleDeliveryHistoryResult>()
    const f = await fixture(['task-1', 'history']); f.schedule.history.mockReturnValueOnce(pending.promise)
    const run = f.run(); await flush(); expect(f.schedule.history).toHaveBeenCalledTimes(1)
    f.abort.abort(); pending.resolve(history()); await expect(run).rejects.toMatchObject({ name: 'AbortError' }); expect(f.prompt).toHaveBeenCalledTimes(2)
  })
})

describe('catalog request ordering', () => {
  it('discards an invalidated response and reads the newer catalog before permitting actions', async () => {
    const f = await fixture([]), pending = deferred<ScheduleCatalogEntry[]>()
    f.schedule.catalog.mockReturnValueOnce(pending.promise)
    const catalog = scheduleCatalog(f.ctx, sessionId, f.abort.signal)
    const load = catalog.refresh(); f.update([{ ...record, status: 'paused' }]); pending.resolve([record]); await load
    expect(catalog.snapshot().entries[0]?.status).toBe('paused'); catalog.dispose()
  })

  it('ignores late catalog results after disposal', async () => {
    const f = await fixture([]), pending = deferred<ScheduleCatalogEntry[]>()
    f.schedule.catalog.mockReturnValueOnce(pending.promise)
    const catalog = scheduleCatalog(f.ctx, sessionId, f.abort.signal), load = catalog.refresh()
    catalog.dispose(); pending.resolve([record]); await load
    expect(catalog.snapshot().entries).toEqual([])
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
    expect(command.scheduleWhen(record, 'ended', now)).toBe('ended · was 2026-10-27 13:00 UTC')
  })

  it('keeps a paused reminder readable as paused', () => {
    // Pausing keeps the committed target; hiding it would read as "no reminder".
    expect(command.scheduleWhen(record, 'paused', now)).toBe('paused · next in 12m · 2026-10-27 13:00 UTC')
  })

  it('calls an overdue active reminder due rather than showing a negative wait', () => {
    expect(command.scheduleWhen(record, 'active', Date.parse('2026-10-27T13:05:00Z'))).toBe('next due now · 2026-10-27 13:00 UTC')
  })
})

it('keeps the task filter through editing and returning to the list', async () => {
  const h = await fixture([request => {
    Object.assign(promptBrowserState(request)!, { query: 'Release', selected: 'task-1' })
    return 'task-1'
  }, 'pause', null, null])
  await h.run()
  expect(h.prompt.mock.calls[3]![0].title).toBe('Scheduled tasks')
  expect(promptBrowserState(h.prompt.mock.calls[3]![0])).toMatchObject({ query: 'Release', selected: 'task-1' })
  expect(h.prompt.mock.calls[3]![0].options?.[0]?.badge?.label).toBe('Paused')
})
