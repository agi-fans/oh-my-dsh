import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { TuiService } from '../definition.ts'
import { sideQuestion } from './btw.ts'

function harness(question = 'Side question') {
  const parent = { id: 'parent', status: 'running' }
  // The progress card stays open until the work settles; that is what makes the
  // cancel path reachable, so the default prompt mirrors it.
  const prompt = vi.fn<TuiService['prompt']>(async request => new Promise(resolve => {
    request.signal?.addEventListener('abort', () => resolve(null), { once: true })
  }))
  const commandOutput = vi.fn()
  const consult = vi.fn(async (_parent, _question, _selection, _signal, update) => {
    update('Independent answer')
    return { topic: { sessionId: 'side', status: 'completed' }, text: 'Independent answer', usage: { totalTokens: 12 } }
  })
  const ctx = {
    tui: { interactive: true, prompt, commandOutput },
    omdshSession: { assertActive: vi.fn(), selection: () => ({ provider: 'p', model: 'm' }) },
    omdshBtw: { consult },
  } as unknown as Context
  return { ctx, parent, prompt, commandOutput, consult,
    invocation: { agent: parent, rawInput: question, signal: new AbortController().signal } as unknown as CommandInvocation }
}

describe('side question', () => {
  it('asks the question it was given without a picker, a menu, or a reader', async () => {
    // `/btw <question>` used to be reached through a topic library and followed by
    // a five-item menu. Both are surfaces around one act.
    const h = harness('Why did the build fail?')
    expect(await sideQuestion(h.ctx, h.invocation)).toEqual({ kind: 'success' })
    // No picker and no menu: the only prompt is the progress card.
    expect(h.prompt).toHaveBeenCalledOnce()
    expect(h.prompt.mock.calls[0]?.[0]).toMatchObject({ presentation: 'progress' })
    expect(h.consult).toHaveBeenCalledWith(h.parent, 'Why did the build fail?',
      { provider: 'p', model: 'm' }, expect.any(AbortSignal), expect.any(Function))
  })

  it('asks in the composer when no question was typed', async () => {
    const h = harness('')
    h.prompt.mockResolvedValueOnce('What changed?')
    expect(await sideQuestion(h.ctx, h.invocation)).toEqual({ kind: 'success' })
    // The composer collects the question; the second prompt is the progress card.
    expect(h.prompt).toHaveBeenCalledTimes(2)
    expect(h.prompt.mock.calls[0]?.[0]).toMatchObject({ title: 'Side question', allowCustom: true })
    expect(h.prompt.mock.calls[1]?.[0]).toMatchObject({ presentation: 'progress' })
    expect(h.consult).toHaveBeenCalledWith(h.parent, 'What changed?',
      { provider: 'p', model: 'm' }, expect.any(AbortSignal), expect.any(Function))
  })

  it('waits behind the compact progress card, not a document', async () => {
    const h = harness()
    await sideQuestion(h.ctx, h.invocation)
    // The question was supplied, so the only surface is the progress card.
    expect(h.prompt).toHaveBeenCalledOnce()
    expect(h.prompt.mock.calls[0]?.[0]).toMatchObject({ title: 'Side question', presentation: 'progress' })
    expect(h.prompt.mock.calls[0]?.[0].refreshDocument).toBeUndefined()
  })

  it('lands the answer as a tinted aside whose first line is the question', async () => {
    const h = harness('Why did the build fail?')
    await sideQuestion(h.ctx, h.invocation)
    const [command, body] = h.commandOutput.mock.calls[0] as [string, string]
    expect(command).toBe('btw')
    expect(body.startsWith('Why did the build fail?')).toBe(true)
    expect(body).toContain('Independent answer')
    expect(body).toContain('12 tokens')
  })

  it('writes nothing when the reader cancels the wait', async () => {
    const h = harness()
    h.consult.mockImplementationOnce(async (_parent, _question, _selection, signal) => {
      expect(signal.aborted).toBe(true)
      return { topic: { sessionId: 'side', status: 'cancelled' }, text: '' } as never
    })
    h.prompt.mockImplementationOnce(async request => {
      expect(request.interrupt!()).toBe(true)
      return null
    })
    expect(await sideQuestion(h.ctx, h.invocation)).toEqual({ kind: 'success' })
    expect(h.commandOutput).not.toHaveBeenCalled()
  })

  it('reports a failure as an error result instead of a block', async () => {
    const h = harness('Broken')
    h.consult.mockRejectedValueOnce(new Error('Side consultations unavailable.'))
    expect(await sideQuestion(h.ctx, h.invocation)).toMatchObject({ kind: 'error' })
    expect(h.commandOutput).not.toHaveBeenCalled()
  })
})
