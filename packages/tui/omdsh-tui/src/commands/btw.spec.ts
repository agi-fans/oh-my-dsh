import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { TuiService } from '../definition.ts'
import { sideQuestion } from './btw.ts'

function harness(question = 'Side question') {
  const parent = { id: 'parent', status: 'running' }
  const prompt = vi.fn<TuiService['prompt']>()
  const commandOutput = vi.fn()
  // The provider owns the block; the command only hands it a runner.
  const asideQuestion = vi.fn<TuiService['asideQuestion'] & ((request: never) => Promise<void>)>(async () => {})
  const consult = vi.fn(async (_parent, _question, _selection, _signal, update) => {
    update('Independent answer')
    return { topic: { sessionId: 'side', status: 'completed' }, text: 'Independent answer', usage: { totalTokens: 12 } }
  })
  const ctx = {
    tui: { interactive: true, prompt, commandOutput, asideQuestion },
    omdshSession: { assertActive: vi.fn(), selection: () => ({ provider: 'p', model: 'm' }) },
    omdshBtw: { consult },
  } as unknown as Context
  return { ctx, parent, prompt, commandOutput, asideQuestion, consult,
    invocation: { agent: parent, rawInput: question, signal: new AbortController().signal } as unknown as CommandInvocation }
}

describe('side question', () => {
  it('asks the question it was given with no picker, no prompt and no menu', async () => {
    // `/btw <question>` used to be reached through a topic library and followed by
    // a five-item menu; the question itself then waited behind a progress card.
    const h = harness('Why did the build fail?')
    expect(await sideQuestion(h.ctx, h.invocation)).toEqual({ kind: 'success' })
    // The only surface is the streaming block.
    expect(h.prompt).not.toHaveBeenCalled()
    expect(h.asideQuestion).toHaveBeenCalledOnce()
    expect(h.asideQuestion.mock.calls[0]?.[0]).toMatchObject({ question: 'Why did the build fail?' })
  })

  it('streams into that block while the consultation runs', async () => {
    const h = harness('Why did the build fail?')
    await sideQuestion(h.ctx, h.invocation)
    const request = h.asideQuestion.mock.calls[0]![0] as unknown as {
      run: (onUpdate: (text: string) => void, signal: AbortSignal) => Promise<{ text: string; detail?: string }>
    }
    const seen: string[] = []
    const result = await request.run(text => seen.push(text), new AbortController().signal)
    // The reader watches the answer arrive rather than waiting for a card to
    // close and a block to appear.
    expect(seen).toContain('Independent answer')
    expect(result.text).toContain('Independent answer')
    // The settle line keeps the session id, which is the handle `/resume` needs.
    expect(result.detail).toContain('12 tokens')
    expect(result.detail).toContain('Separate session: side')
  })

  it('says how to ask when no question was typed, instead of opening a prompt', async () => {
    // A prompt would be a second way to ask the same command; the reader would
    // have to learn both, and the bare form would still need explaining.
    const h = harness('')
    const result = await sideQuestion(h.ctx, h.invocation)
    expect(result).toMatchObject({ kind: 'error', text: 'Usage: /btw <your question>' })
    expect(h.prompt).not.toHaveBeenCalled()
    expect(h.asideQuestion).not.toHaveBeenCalled()
  })

  it('answers once, without a block, when there is no terminal to stream into', async () => {
    const h = harness('Why?')
    Object.assign(h.ctx.tui, { interactive: false, asideQuestion: undefined })
    const result = await sideQuestion(h.ctx, h.invocation)
    expect(result).toMatchObject({ kind: 'success' })
    expect(result.kind === 'success' && result.text).toContain('Independent answer')
    expect(h.asideQuestion).not.toHaveBeenCalled()
  })

  it('leaves the failure to the block, which is where the reader is looking', async () => {
    // The block is already on screen; reporting the error as a command result
    // would put it somewhere else and leave the card spinning.
    const h = harness('Broken')
    h.consult.mockRejectedValueOnce(new Error('Side consultations unavailable.'))
    expect(await sideQuestion(h.ctx, h.invocation)).toEqual({ kind: 'success' })
    const request = h.asideQuestion.mock.calls[0]![0] as unknown as {
      run: (onUpdate: (text: string) => void, signal: AbortSignal) => Promise<unknown>
    }
    await expect(request.run(() => {}, new AbortController().signal)).rejects.toThrow('unavailable')
  })
})
