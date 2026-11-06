import { promptBrowserState } from '../runtime/prompt-browser.ts'
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import { JobId, type JobEventListener, type JobView } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { TuiPrompt } from '../definition.ts'
import { browseJobs } from './jobs-browser.ts'

function fixture() {
  const ctx = new Context(), abort = new AbortController(), owner = SessionId('jobs-owner')
  let jobs: JobView[] = [{ id: JobId('bash-1'), kind: 'bash', label: 'pnpm test 中文', status: 'running', progress: '1/3', startedAt: Date.now(), output: { total: 7, earliest: 0 } }]
  const listeners = new Set<JobEventListener>()
  const list = vi.fn(() => jobs), get = vi.fn(() => jobs[0]!)
  const readAt = vi.fn(() => ({ chunks: [{ at: 0, text: 'stdout\n', channel: 'stdout' }], next: 7, lossy: false }))
  const kill = vi.fn(() => 'requested'), read = vi.fn()
  ctx.provide('jobs', { list, get, readAt, kill, read, events: { subscribe: (_filter: unknown, listener: JobEventListener) => { listeners.add(listener); return () => { listeners.delete(listener) } } } } as never)
  const prompt = vi.fn(async (_request: TuiPrompt): Promise<string | null> => null)
  ctx.provide('tui', { interactive: true, prompt } as never)
  const update = (patch: Partial<JobView>) => { jobs = [{ ...jobs[0]!, ...patch }]; for (const fn of listeners) fn({ type: 'progress', job: jobs[0]! }) }
  const run = (id?: string) => browseJobs(ctx, { agent: { session: { id: owner } }, signal: abort.signal } as CommandInvocation, id)
  return { ctx, abort, owner, prompt, run, update, list, readAt, kill, read, listeners }
}

it('refreshes progress and observes all output without consuming the model cursor', async () => {
  const h = fixture()
  try {
    h.prompt.mockImplementationOnce(async request => {
      expect(request.options?.[0]?.description).toContain('1/3')
      h.update({ progress: '2/3' })
      expect(request.refreshOptions?.()?.[0]?.description).toContain('2/3')
      return 'bash-1'
    }).mockImplementationOnce(async request => {
      expect(request.documentSource?.text).toContain('stdout')
      const initial = request.documentSource
      h.readAt.mockReturnValue({ chunks: [{ at: 20, text: 'stderr\n', channel: 'stderr' }], next: 27, lossy: true })
      h.update({ progress: '3/3', output: { total: 27, earliest: 20 } })
      expect(request.refreshDocumentSource?.(false)).toBe(initial)
      expect(request.refreshDocumentSource?.(true)?.text).toContain('Earlier output is no longer retained.')
      expect(request.refreshDocumentSource?.(true)?.text).toContain('stderr')
      expect(h.readAt).toHaveBeenCalledTimes(2)
      return null
    }).mockResolvedValueOnce('back').mockResolvedValueOnce(null)
    await h.run()
    expect(h.read).not.toHaveBeenCalled()
    expect(h.readAt).toHaveBeenCalledWith(JobId('bash-1'), 0, h.owner)
    expect(h.listeners.size).toBe(0)
  } finally { await h.ctx.fiber.dispose() }
})

it.each(['cancel', 'scope', 'settled', 'confirm'])('handles %s while stopping a job', async outcome => {
  const h = fixture()
  try {
    h.prompt.mockResolvedValueOnce('stop').mockImplementationOnce(async request => {
      expect(request.initialValue).toBe('cancel')
      if (outcome === 'scope') h.abort.abort()
      if (outcome === 'settled') h.update({ status: 'completed', detail: 'exit 0' })
      return outcome === 'cancel' ? null : 'accept'
    }).mockResolvedValueOnce(null)
    await h.run('bash-1')
    expect(h.kill).toHaveBeenCalledTimes(outcome === 'confirm' ? 1 : 0)
    if (outcome === 'confirm') expect(h.kill).toHaveBeenCalledWith(JobId('bash-1'), h.owner, 'stopped from /jobs')
    expect(h.listeners.size).toBe(0)
  } finally { await h.ctx.fiber.dispose() }
})

it('retains a stale roster after a read failure and allows explicit retry', async () => {
  const h = fixture()
  try {
    h.prompt.mockImplementationOnce(async request => {
      h.list.mockImplementationOnce(() => { throw new Error('registry unavailable') })
      h.update({ progress: '2/3' })
      expect(request.refreshOptions?.()?.[0]).toMatchObject({ label: 'pnpm test 中文', disabled: true })
      expect(request.refreshDocument?.()).toContain('last loaded state')
      return '__refresh__'
    }).mockImplementationOnce(async request => {
      expect(request.options?.[0]).toMatchObject({ disabled: false })
      return null
    })
    await h.run()
    expect(h.kill).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})

it('closes observation when superseded by an approval and removes subscriptions', async () => {
  const h = fixture()
  try {
    h.prompt.mockImplementationOnce(async request => {
      request.onSuperseded?.('')
      expect(request.signal?.aborted).toBe(true)
      return null
    })
    await h.run('bash-1')
    expect(h.prompt).toHaveBeenCalledTimes(1)
    expect(h.listeners.size).toBe(0)
  } finally { await h.ctx.fiber.dispose() }
})


it('preserves a paused output position across stop confirmation and explicit refresh', async () => {
  const h = fixture()
  const position = { row: 0, wrap: 0, query: '', following: false }
  try {
    h.prompt.mockImplementationOnce(async request => {
      request.onDocumentPosition?.(position)
      return 'stop'
    }).mockImplementationOnce(async () => {
      h.readAt.mockReturnValue({ chunks: [{ at: 0, text: 'updated output', channel: 'stdout' }], next: 14, lossy: false })
      h.update({ progress: '2/3' })
      return null
    }).mockImplementationOnce(async request => {
      expect(request.documentPosition).toEqual(position)
      expect(request.documentTail).toBe(true)
      expect(request.documentSource?.text).toContain('stdout')
      expect(h.readAt).toHaveBeenCalledTimes(1)
      return 'refresh'
    }).mockImplementationOnce(async request => {
      expect(request.documentPosition).toEqual(position)
      expect(request.documentTail).toBe(true)
      expect(request.documentSource?.text).toContain('updated output')
      return null
    })
    await h.run('bash-1')
    expect(h.kill).not.toHaveBeenCalled()
    expect(h.listeners.size).toBe(0)
  } finally { await h.ctx.fiber.dispose() }
})

it('keeps the job filter when returning from output', async () => {
  const h = fixture()
  h.prompt.mockImplementationOnce(async request => {
    Object.assign(promptBrowserState(request)!, { query: 'pnpm', selected: 'bash-1' })
    return 'bash-1'
  }).mockResolvedValueOnce(null)
  try {
    await h.run()
    expect(h.prompt.mock.calls[1]![0].presentation).toBe('document')
    expect(h.prompt.mock.calls[2]![0].title).toBe('Background jobs')
    expect(promptBrowserState(h.prompt.mock.calls[2]![0])).toMatchObject({ query: 'pnpm', selected: 'bash-1' })
    expect(h.listeners.size).toBe(0)
  } finally { await h.ctx.fiber.dispose() }
})
