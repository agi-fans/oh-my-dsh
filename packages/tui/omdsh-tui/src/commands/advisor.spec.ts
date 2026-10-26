import { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { TuiPrompt, TuiSubagentActivity } from '../definition.ts'
import { describe, expect, it, vi } from 'vitest'
import { apply, requestAdvice } from './advisor.ts'

function harness(answers: (string | null)[], interactive = true) {
  const ctx = new Context()
  const prompt = vi.fn(async (_request: TuiPrompt): Promise<string | null> => answers.shift() ?? null)
  const event = vi.fn(), notice = vi.fn(), setStatus = vi.fn(), commandOutput = vi.fn(), inject = vi.fn()
  const consult = vi.fn(async (
    _agent,
    provider,
    question,
    _context,
    _signal,
    onProgress?: (activity: TuiSubagentActivity) => void,
  ) => {
    onProgress?.({ text: '$ rg --files', status: 'running' })
    onProgress?.({ text: '$ rg --files', status: 'ok' })
    return { provider, question, opinion: 'Independent view', truncated: false }
  })
  ctx.provide('tui', { interactive, prompt, event, notice, setStatus, commandOutput } as never)
  ctx.provide('advisor', { consult })
  const invocation = { rawInput: '', agent: { status: 'idle', session: { id: 'parent' }, inject }, signal: new AbortController().signal } as unknown as CommandInvocation
  return { ctx, prompt, event, notice, setStatus, commandOutput, inject, consult, invocation }
}

describe('/advisor', () => {
  it('registers the canonical advisor command and routes it directly to the consultation service', async () => {
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
      expect(h.consult).toHaveBeenCalledWith(h.invocation.agent, 'codex', 'Review cancellation', '', expect.any(AbortSignal), expect.any(Function))
    } finally { await h.ctx.fiber.dispose() }
  })

  it('renders a live subagent card in the main TUI transcript, streams inspection steps, and injects the opinion into the session context', async () => {
    const h = harness(['claude', 'Review this code'])
    try {
      expect(await requestAdvice(h.ctx, h.invocation)).toEqual({ kind: 'success' })
      expect(h.prompt).toHaveBeenCalledTimes(2)
      expect(h.event).toHaveBeenCalledWith(expect.objectContaining({
        type: 'tool/call',
        data: expect.objectContaining({ name: 'consult_advisor', arguments: JSON.stringify({ provider: 'claude', question: 'Review this code' }) }),
      }))
      expect(h.event).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'tool/call' }),
        expect.objectContaining({
          call: expect.objectContaining({
            card: 'generic',
            title: 'Advisor · Claude Code',
            content: [{ type: 'text', text: expect.stringContaining('✓ $ rg --files') }],
          }),
        }),
      )
      expect(h.event).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'tool/result',
        data: expect.objectContaining({
          message: expect.objectContaining({
            toolName: 'consult_advisor',
            isError: false,
            content: [{ type: 'text', text: '✓ $ rg --files' }],
          }),
        }),
      }))
      expect(h.setStatus).toHaveBeenNthCalledWith(1, 'running')
      expect(h.setStatus).toHaveBeenNthCalledWith(2, 'idle', { outcome: 'completed' })
      expect(h.consult).toHaveBeenCalledWith(h.invocation.agent, 'claude', 'Review this code', '', expect.any(AbortSignal), expect.any(Function))
      // The notice-shaped injection is what the transcript renders, so the
      // advice survives a resume instead of living only in the live TUI.
      expect(h.inject).toHaveBeenCalledWith(expect.objectContaining({
        source: expect.objectContaining({ kind: 'omdsh-advisor', form: 'notice' }),
      }))
      expect(h.commandOutput).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('runs /advisor codex|claude <question> directly in interactive mode without opening any modal prompt', async () => {
    const h = harness([])
    try {
      h.invocation.rawInput = 'codex 看看我们工程在项目结构上是否有值得优化的内容'
      expect(await requestAdvice(h.ctx, h.invocation)).toEqual({ kind: 'success' })
      expect(h.prompt).not.toHaveBeenCalled()
      expect(h.event).toHaveBeenCalledWith(expect.objectContaining({
        type: 'tool/call',
        data: expect.objectContaining({
          name: 'consult_advisor',
          arguments: JSON.stringify({ provider: 'codex', question: '看看我们工程在项目结构上是否有值得优化的内容' }),
        }),
      }))
      expect(h.consult).toHaveBeenCalledWith(h.invocation.agent, 'codex', '看看我们工程在项目结构上是否有值得优化的内容', '', expect.any(AbortSignal), expect.any(Function))
      // The transcript renders the injection, so nothing is written locally.
      expect(h.inject).toHaveBeenCalled()
      expect(h.commandOutput).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('accepts question-first and provider-only interactive invocations and requires explicit provider in non-interactive mode', async () => {
    const questionFirst = harness(['codex'])
    try {
      questionFirst.invocation.rawInput = '看看我们工程在项目结构上是否有值得优化的内容'
      expect(await requestAdvice(questionFirst.ctx, questionFirst.invocation)).toEqual({ kind: 'success' })
      expect(questionFirst.prompt).toHaveBeenCalledTimes(1)
      expect(questionFirst.consult).toHaveBeenCalledWith(questionFirst.invocation.agent, 'codex', '看看我们工程在项目结构上是否有值得优化的内容', '', expect.any(AbortSignal), expect.any(Function))
    } finally { await questionFirst.ctx.fiber.dispose() }

    const providerOnly = harness(['Review architecture'])
    try {
      providerOnly.invocation.rawInput = 'codex'
      expect(await requestAdvice(providerOnly.ctx, providerOnly.invocation)).toEqual({ kind: 'success' })
      expect(providerOnly.prompt).toHaveBeenCalledTimes(1)
      expect(providerOnly.consult).toHaveBeenCalledWith(providerOnly.invocation.agent, 'codex', 'Review architecture', '', expect.any(AbortSignal), expect.any(Function))
    } finally { await providerOnly.ctx.fiber.dispose() }

    const nonInteractive = harness([], false)
    try {
      nonInteractive.invocation.rawInput = 'unknown question'
      expect(await requestAdvice(nonInteractive.ctx, nonInteractive.invocation)).toEqual({ kind: 'error', text: 'Usage: /advisor codex|claude <question>' })
    } finally { await nonInteractive.ctx.fiber.dispose() }

    const h = harness([])
    try {
      h.invocation.rawInput = 'claude question'
      h.consult.mockRejectedValueOnce(new Error('Full confinement unavailable'))
      expect(await requestAdvice(h.ctx, h.invocation)).toEqual({ kind: 'error', text: 'Full confinement unavailable' })
      expect(h.consult).toHaveBeenCalledTimes(1)
      expect(h.commandOutput).not.toHaveBeenCalled()
      expect(h.event).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'tool/result',
        data: expect.objectContaining({
          message: expect.objectContaining({ isError: true, content: [{ type: 'text', text: 'Full confinement unavailable' }] }),
        }),
      }))
      expect(h.setStatus).toHaveBeenLastCalledWith('idle', { outcome: 'failed' })
    } finally { await h.ctx.fiber.dispose() }
  })

  it('settles cleanly when the consultation signal is cancelled', async () => {
    const h = harness([])
    const controller = new AbortController()
    h.invocation.rawInput = 'codex question'
    h.consult.mockImplementation(async (_agent, _provider, _question, _context, signal: AbortSignal) => {
      controller.abort()
      signal.throwIfAborted()
      throw new Error('unreachable')
    })
    try {
      expect(await requestAdvice(h.ctx, h.invocation, controller.signal)).toEqual({ kind: 'success', text: 'Advice cancelled.' })
      expect(h.commandOutput).not.toHaveBeenCalled()
      expect(h.event).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'tool/result',
        data: expect.objectContaining({
          message: expect.objectContaining({ isError: false, content: [{ type: 'text', text: 'Advice cancelled.' }] }),
        }),
      }))
      expect(h.setStatus).toHaveBeenLastCalledWith('idle', { outcome: 'interrupted' })
    } finally { await h.ctx.fiber.dispose() }
  })

  it('offers one-step interactive bundle enablement when the advisor bundle is disabled in the profile', async () => {
    const h = harness(['enable'])
    const setBundleEnabled = vi.fn(async () => ({ target: '@deepseek-ai/dsh-subagent-codex', application: 'applied', enabled: true }))
    h.ctx.provide('pluginManager', { setBundleEnabled } as never)
    h.consult.mockRejectedValueOnce(new Error('Enable @deepseek-ai/dsh-subagent-codex in /plugins → Bundles before consulting this advisor.'))
    try {
      h.invocation.rawInput = 'codex Review project structure'
      expect(await requestAdvice(h.ctx, h.invocation)).toEqual({ kind: 'success' })
      expect(h.prompt).toHaveBeenCalledOnce()
      expect(setBundleEnabled).toHaveBeenCalledWith('@deepseek-ai/dsh-subagent-codex', true)
      expect(h.consult).toHaveBeenCalledTimes(2)
      expect(h.inject).toHaveBeenCalled()
      expect(h.commandOutput).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })
})
