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
  const commandOutput = vi.fn()
  const ctx = { tui: { interactive: true, prompt, commandOutput }, omdshSession: { assertActive: vi.fn(), selection: () => ({ provider: 'p', model: 'm' }) },
    omdshBtw: { consult, list: vi.fn(() => []), read: vi.fn(async () => 'Saved question and answer') } } as unknown as Context
  return { ctx, parent, prompt, consult, commandOutput, invocation: { agent: parent, rawInput: question, signal: new AbortController().signal } as unknown as CommandInvocation }
}

describe('side-question reader', () => {
  it('answers inline instead of opening a document, and keeps the reader in the conversation', async () => {
    const h = harness()
    h.prompt.mockImplementationOnce(async request => new Promise(resolve => {
      // The wait is the compact progress card, not a full-screen reader.
      expect(request.presentation).toBe('progress')
      expect(request.refreshDocument).toBeUndefined()
      request.signal!.addEventListener('abort', () => resolve(null), { once: true })
    })).mockResolvedValueOnce('back')
    expect(await sideQuestion(h.ctx, h.invocation)).toEqual({ kind: 'success' })
    // The answer lands as a transcript block whose title is the question asked.
    expect(h.commandOutput).toHaveBeenCalledWith('btw',
      expect.stringContaining('Side question'), { focus: true })
    const [, body] = h.commandOutput.mock.calls[0]!
    expect(body).toContain('Independent answer')
    expect(body).toContain('12 tokens')
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
    // Nothing was answered, so nothing was written into the transcript.
    expect(h.commandOutput).not.toHaveBeenCalled()
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
  it('supports sharing the side answer to the main conversation or quoting it in the composer', async () => {
    const shared = harness('Why did the build fail?')
    const notice = vi.fn(), inject = vi.fn(), insertText = vi.fn()
    Object.assign(shared.ctx.tui, { notice, insertText })
    Object.assign(shared.parent, { inject })
    shared.prompt
      .mockImplementationOnce(async request => new Promise(resolve => { request.signal!.addEventListener('abort', () => resolve(null), { once: true }) }))
      .mockResolvedValueOnce('share')
    expect(await sideQuestion(shared.ctx, shared.invocation)).toEqual({ kind: 'success' })
    // Rendered from the injection, which is what survives a resume.
    expect(inject).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({ kind: 'omdsh-btw', form: 'notice' }),
    }))
    // The inline block is not durable, so sharing is still what outlives a resume.
    expect(shared.commandOutput).toHaveBeenCalledTimes(1)

    const quoted = harness('Summarize the API')
    Object.assign(quoted.ctx.tui, { insertText, notice })
    quoted.prompt
      .mockImplementationOnce(async request => new Promise(resolve => { request.signal!.addEventListener('abort', () => resolve(null), { once: true }) }))
      .mockResolvedValueOnce('quote')
    expect(await sideQuestion(quoted.ctx, quoted.invocation)).toEqual({ kind: 'success' })
    expect(insertText).toHaveBeenCalledWith('Independent answer')
  })
})
