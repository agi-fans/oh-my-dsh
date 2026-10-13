import { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { TuiPrompt } from '../definition.ts'
import { describe, expect, it, vi } from 'vitest'
import { apply, requestAdvice } from './advisor.ts'

function harness(answers: (string | null)[], interactive = true) {
  const ctx = new Context()
  const prompt = vi.fn(async (request: TuiPrompt): Promise<string | null> => request.title.startsWith('Consulting ')
    ? new Promise(resolve => { request.signal!.addEventListener('abort', () => resolve(null), { once: true }) }) : answers.shift() ?? null)
  const commandOutput = vi.fn(), consult = vi.fn(async (_agent, provider, question, _context, _signal) => ({ provider, question, opinion: 'Independent view', truncated: false }))
  ctx.provide('tui', { interactive, prompt, commandOutput } as never)
  ctx.provide('advisor', { consult })
  const invocation = { rawInput: '', agent: { session: { id: 'parent' } }, signal: new AbortController().signal } as unknown as CommandInvocation
  return { ctx, prompt, commandOutput, consult, invocation }
}

describe('/advisor', () => {
  it('registers the canonical advisor command and routes it to the consultation service', async () => {
    const h = harness([], false)
    const register = vi.fn((_definition: CommandDefinition) => () => {})
    h.ctx.provide('commands', { register } as never)
    try {
      apply(h.ctx)
      expect(register.mock.calls).toHaveLength(1)
      const command = register.mock.calls[0]![0]
      expect(command.name).toBe('advisor')
      h.invocation.rawInput = 'codex Review cancellation'
      expect(await command.handler(h.invocation)).toEqual({ kind: 'success' })
      expect(h.consult).toHaveBeenCalledWith(h.invocation.agent, 'codex', 'Review cancellation', '', expect.any(AbortSignal))
    } finally { await h.ctx.fiber.dispose() }
  })
  it('asks for provider, question, explicit context and consent, then labels the result', async () => {
    const h = harness(['claude', 'Review this code', 'CODE', 'consult'])
    try {
      expect(await requestAdvice(h.ctx, h.invocation)).toEqual({ kind: 'success' })
      expect(h.consult).toHaveBeenCalledWith(h.invocation.agent, 'claude', 'Review this code', 'CODE', expect.any(AbortSignal))
      expect(h.commandOutput).toHaveBeenCalledWith('advisor', expect.stringContaining('Independent advice · claude'), { focus: true })
      expect(h.prompt.mock.calls.find(([request]) => request.title === 'Consult claude')![0].detail).toContain('model charges')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('does not consult after dismissal and accepts a question-only line command without a dialog', async () => {
    const h = harness([null])
    try {
      h.invocation.rawInput = 'codex question'
      await requestAdvice(h.ctx, h.invocation)
      expect(h.consult).not.toHaveBeenCalled()
      const line = harness([], false)
      try {
        line.invocation.rawInput = 'codex question'
        await requestAdvice(line.ctx, line.invocation)
        expect(line.consult.mock.calls[0]!.slice(1, 4)).toEqual(['codex', 'question', ''])
        expect(line.prompt).not.toHaveBeenCalled()
      } finally { await line.ctx.fiber.dispose() }
    } finally { await h.ctx.fiber.dispose() }
  })

  it('returns usage for invalid providers and preserves provider failures without fallback', async () => {
    const h = harness(['consult'])
    try {
      h.invocation.rawInput = 'unknown question'
      expect(await requestAdvice(h.ctx, h.invocation)).toEqual({ kind: 'error', text: 'Usage: /advisor [codex|claude <question>]' })
      h.invocation.rawInput = 'claude question'
      h.consult.mockRejectedValueOnce(new Error('Full confinement unavailable'))
      expect(await requestAdvice(h.ctx, h.invocation)).toEqual({ kind: 'error', text: 'Full confinement unavailable' })
      expect(h.consult).toHaveBeenCalledTimes(1)
      expect(h.commandOutput).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('cancels and suppresses late output only after the consultation settles', async () => {
    const h = harness(['consult'])
    let cleaned = false
    h.invocation.rawInput = 'codex question'
    h.prompt.mockImplementation(async request => request.title.startsWith('Consulting ') ? 'cancel' : 'consult')
    h.consult.mockImplementation((...args) => new Promise((_, reject) => {
      const signal = args[4]
      const finish = () => { cleaned = true; reject(new Error('cancelled after cleanup')) }
      if (signal.aborted) finish()
      else signal.addEventListener('abort', finish, { once: true })
    }))
    try {
      expect(await requestAdvice(h.ctx, h.invocation)).toEqual({ kind: 'success', text: 'Advice cancelled.' })
      expect(cleaned).toBe(true)
      expect(h.commandOutput).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })
})
