import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { TuiService } from '../definition.ts'
import { sideQuestion } from './btw.ts'

function harness(question = 'Side question') {
  const parent = { id: 'parent', status: 'running' }
  const prompt = vi.fn<TuiService['prompt']>()
  const consult = vi.fn(async (_parent, _question, _selection, _signal, update) => {
    update('Independent answer')
    return { topic: { sessionId: 'side', status: 'completed' }, text: 'Independent answer', usage: { totalTokens: 12 } }
  })
  const ctx = { tui: { interactive: true, prompt }, omdshSession: { assertActive: vi.fn(), selection: () => ({ provider: 'p', model: 'm' }) },
    omdshBtw: { consult, list: vi.fn(() => []), read: vi.fn(async () => 'Saved question and answer') } } as unknown as Context
  return { ctx, parent, prompt, consult, invocation: { agent: parent, rawInput: question, signal: new AbortController().signal } as unknown as CommandInvocation }
}

describe('side-question reader', () => {
  it('streams advice separately, cancels the progress reader on completion and returns to the parent', async () => {
    const h = harness()
    let document: string | undefined
    h.prompt.mockImplementationOnce(async request => new Promise(resolve => {
      document = request.refreshDocument!()
      request.signal!.addEventListener('abort', () => resolve(null), { once: true })
    })).mockImplementationOnce(async request => {
      expect(request.detail).toContain('Independent answer')
      expect(request.detail).toContain('12 tokens')
      return 'back'
    })
    expect(await sideQuestion(h.ctx, h.invocation)).toEqual({ kind: 'success' })
    expect(document).toContain('outside the main context')
    expect(h.consult).toHaveBeenCalledWith(h.parent, 'Side question', { provider: 'p', model: 'm' }, expect.any(AbortSignal), expect.any(Function), undefined)
  })
  it.each(['interrupt', 'superseded'])('cancels only its own request when %s', async kind => {
    const h = harness()
    let signal: AbortSignal | undefined
    h.consult.mockImplementationOnce(async (_parent, _question, _selection, requestSignal) => {
      signal = requestSignal
      expect(signal.aborted).toBe(true)
      return { topic: { sessionId: 'side', status: 'cancelled' }, text: '' } as never
    })
    h.prompt.mockImplementationOnce(async request => {
      if (kind === 'interrupt') expect(request.interrupt!()).toBe(true)
      else request.onSuperseded!('')
      return null
    })
    expect(await sideQuestion(h.ctx, h.invocation)).toEqual({ kind: 'success' })
    expect(h.prompt).toHaveBeenCalledOnce()
    expect(signal!.aborted).toBe(true)
    expect(h.invocation.signal.aborted).toBe(false)
  })
  it('continues a saved topic without replacing the active session', async () => {
    const h = harness('')
    h.prompt.mockResolvedValueOnce('saved-side').mockResolvedValueOnce('followup').mockResolvedValueOnce('More detail')
      .mockImplementationOnce(async request => new Promise(resolve => { request.signal!.addEventListener('abort', () => resolve(null), { once: true }) }))
      .mockResolvedValueOnce('back')
    expect(await sideQuestion(h.ctx, h.invocation)).toEqual({ kind: 'success' })
    expect(h.ctx.omdshBtw.read).toHaveBeenCalledWith(h.parent, 'saved-side', h.invocation.signal)
    expect(h.consult.mock.calls[0]![5]).toBe('saved-side')
    expect(h.ctx.omdshSession.assertActive).toHaveBeenCalledWith(h.parent)
  })
})
