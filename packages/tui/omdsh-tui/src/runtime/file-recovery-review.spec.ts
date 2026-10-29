import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TuiService } from '../definition.ts'
import { reviewFileRecovery } from './file-recovery-review.ts'

function harness() {
  const agent = { id: 'active', status: 'idle' } as Agent
  const operation = { path: '中文, file.ts', status: 'ready', before: { kind: 'missing' }, after: { kind: 'link', target: Buffer.from('target').toString('base64') } }
  const provider = { checkpoint: vi.fn(async () => ({ status: 'ready', before: 'before', after: 'after' })),
    savedReports: vi.fn(async () => []),
    store: { plan: vi.fn(async () => ({ root: '/workspace', operations: [operation] })) },
    restore: vi.fn(async () => ({ id: 'restore-proof', root: '/workspace', entries: [{ path: operation.path, status: 'restored', backup: '' }] })) }
  const prompt = vi.fn<TuiService['prompt']>(), notice = vi.fn(), assertActive = vi.fn(), commandOutput = vi.fn()
  const ctx = { get: () => provider, tui: { prompt, notice, commandOutput } } as unknown as Context
  const signal = new AbortController().signal
  return { ctx, agent, provider, prompt, notice, commandOutput, assertActive, signal }
}

describe('file recovery review', () => {
  it('exposes saved unconfirmed operations even when no files remain safely restorable', async () => {
    const h = harness()
    h.provider.store.plan.mockResolvedValueOnce({ root: '/workspace', operations: [{ path: 'changed.ts', status: 'conflict', reason: 'Later user edit' }] } as never)
    h.provider.savedReports.mockResolvedValueOnce([{ id: 'restore-pending', root: '/workspace', entries: [{ path: 'changed.ts', status: 'planned', backup: 'retained.backup' }] }] as never)
    await reviewFileRecovery(h.ctx, h.agent, 'source', 2, h.signal, h.assertActive)
    // Nothing to answer, so nothing opens: the result is printed.
    expect(h.prompt).not.toHaveBeenCalled()
    const report = h.commandOutput.mock.calls[0]![1] as string
    expect(report).toContain('Completion unconfirmed')
    expect(report).toContain('retained.backup')
    expect(h.provider.restore).not.toHaveBeenCalled()
  })
  it('selects delimiter-bearing paths with opaque values, previews snapshots and requires confirmation', async () => {
    const h = harness()
    h.prompt.mockResolvedValueOnce('file-0').mockResolvedValueOnce('review').mockImplementationOnce(async request => {
      expect(request.initialValue).toBe('cancel')
      expect(request.detail).toContain('中文, file.ts')
      expect(request.detail).toContain('other processes')
      return 'restore'
    }).mockImplementationOnce(async request => new Promise(resolve => request.signal!.addEventListener('abort', () => resolve(null), { once: true })))
    await reviewFileRecovery(h.ctx, h.agent, 'source', 2, h.signal, h.assertActive)
    expect(h.provider.checkpoint).toHaveBeenCalledWith('source', 2)
    expect(h.prompt.mock.calls[1]![0].detail).toContain('Before Turn')
    expect(h.provider.restore).toHaveBeenCalledWith(h.agent, 'before', 'after', ['中文, file.ts'], expect.any(AbortSignal))
    expect(h.commandOutput).toHaveBeenCalledWith('File recovery report', expect.stringContaining('restored'))
  })
  it('saves nothing and mutates nothing when confirmation is cancelled', async () => {
    const h = harness(); h.prompt.mockResolvedValueOnce('file-0').mockResolvedValueOnce('review').mockResolvedValueOnce('cancel')
    await reviewFileRecovery(h.ctx, h.agent, 'source', 2, h.signal, h.assertActive)
    expect(h.provider.restore).not.toHaveBeenCalled()
  })
  it('reports missing snapshots without treating the transcript diff as a checkpoint', async () => {
    const h = harness(); h.provider.checkpoint.mockResolvedValueOnce(undefined as never)
    await reviewFileRecovery(h.ctx, h.agent, 'source', 2, h.signal, h.assertActive)
    expect(h.provider.store.plan).not.toHaveBeenCalled()
    expect(h.notice).toHaveBeenCalledWith(expect.stringContaining('Settings → Tools'))
  })
  it.each(['interrupt', 'superseded'])('cancels only recovery on %s and handles partial results', async mode => {
    const h = harness(); let progress: Parameters<TuiService['prompt']>[0]
    h.prompt.mockResolvedValueOnce('file-0').mockResolvedValueOnce('review').mockResolvedValueOnce('restore')
      .mockImplementationOnce(async request => { progress = request; return new Promise(resolve => request.signal!.addEventListener('abort', () => resolve(null), { once: true })) })
    h.provider.restore.mockImplementationOnce(async (_agent, _before, _after, _paths, signal) => {
      if (mode === 'interrupt') expect(progress.interrupt!()).toBe(true)
      else progress.onSuperseded!('')
      expect(signal.aborted).toBe(true)
      return { id: 'partial', root: '/workspace', entries: [{ path: '中文, file.ts', status: 'uncertain', backup: '.omdsh-recovery-proof.backup' }] }
    })
    await reviewFileRecovery(h.ctx, h.agent, 'source', 2, h.signal, h.assertActive)
    expect(h.signal.aborted).toBe(false)
    expect(h.prompt).toHaveBeenCalledTimes(4)
    // A superseded restore had its surface taken away, so its receipt is not
    // printed either; a reader who cancelled keeps the report.
    expect(h.commandOutput).toHaveBeenCalledTimes(mode === 'superseded' ? 0 : 1)
    if (mode === 'interrupt') expect(h.commandOutput.mock.calls[0]![1]).toContain('unconfirmed')
  })
})
