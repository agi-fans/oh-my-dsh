import { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { TuiAdvisor, TuiPrompt, TuiSubagentActivity } from '../definition.ts'
import { describe, expect, it, vi } from 'vitest'
import { advisorTrace, apply, requestAdvice } from './advisor.ts'

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
  // A configured advisor, which is the state every consultation test runs in;
  // the unconfigured path has its own test.
  const mode = vi.fn<'off' | TuiAdvisor>(() => 'codex')
  ctx.provide('advisor', { consult, mode })
  const invocation = { rawInput: '', agent: { status: 'idle', session: { id: 'parent' }, inject }, signal: new AbortController().signal } as unknown as CommandInvocation
  return { ctx, prompt, event, notice, setStatus, commandOutput, inject, consult, mode, invocation }
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
    // The configured advisor answers the provider question, so only the question
    // itself is asked. A reader who chose Claude is not asked to choose again.
    const h = harness(['Review this code'])
    h.mode.mockReturnValue('claude')
    try {
      expect(await requestAdvice(h.ctx, h.invocation)).toEqual({ kind: 'success' })
      expect(h.prompt).toHaveBeenCalledTimes(1)
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
      // The card carries the trace, so the result carries no text: printing the
      // same trace in both is how one consultation appeared twice.
      expect(h.event).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'tool/result',
        data: expect.objectContaining({
          message: expect.objectContaining({ toolName: 'consult_advisor', isError: false, content: [] }),
        }),
      }))
      // The settled card says what the run was, so it does not keep claiming to
      // be in progress after the answer arrived.
      const settled = h.event.mock.calls.filter(([event]) => (event as { type?: string }).type === 'tool/call')
        .at(-1)?.[1] as { call?: { content?: { text?: string }[] } } | undefined
      expect(settled?.call?.content?.[0]?.text).toContain('Completed · 1 step')
      expect(h.setStatus).toHaveBeenNthCalledWith(1, 'running')
      expect(h.setStatus).toHaveBeenNthCalledWith(2, 'idle', { outcome: 'completed' })
      expect(h.consult).toHaveBeenCalledWith(h.invocation.agent, 'claude', 'Review this code', '', expect.any(AbortSignal), expect.any(Function))
      // The notice-shaped injection is what the transcript renders, so the
      // advice survives a resume instead of living only in the live TUI.
      expect(h.inject).toHaveBeenCalledWith(expect.objectContaining({
        source: expect.objectContaining({ kind: 'omdsh-advisor', form: 'notice' }),
        // The reader at the terminal gets an attributed opinion, not the brief
        // the model works from.
        content: [{ type: 'text', text: expect.stringMatching(/^Advisor · Claude Code · independent opinion/) }],
      }))
      const injected = (h.inject.mock.calls[0]?.[0] as { content: { text: string }[] }).content[0]!.text
      expect(injected).not.toContain('The user consulted external advisor')
      // The caution survives, because it is what stops the model adopting an
      // outside opinion that the workspace disagrees with.
      expect(injected).toContain('Unverified external advice')
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
    // Question-first: the configured advisor supplies the provider silently.
    const questionFirst = harness([])
    try {
      questionFirst.invocation.rawInput = '看看我们工程在项目结构上是否有值得优化的内容'
      expect(await requestAdvice(questionFirst.ctx, questionFirst.invocation)).toEqual({ kind: 'success' })
      expect(questionFirst.prompt).not.toHaveBeenCalled()
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
      expect(await requestAdvice(nonInteractive.ctx, nonInteractive.invocation)).toEqual({ kind: 'error', text: 'Usage: /advisor [codex|claude] <question>' })
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

describe('/advisor without a configured advisor', () => {
  it('points at the setting instead of charging another vendor', async () => {
    // A consultation is a paid request to someone else's model. Asking here would
    // make the first charge a surprise, so the unconfigured path explains where
    // the switch is and consults nothing.
    const h = harness([])
    h.mode.mockReturnValue('off')
    try {
      const result = await requestAdvice(h.ctx, h.invocation)
      expect(result).toMatchObject({ kind: 'error' })
      expect(result.kind === 'error' ? result.text : '').toContain('/settings')
      expect(h.consult).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('still honours an advisor named on the line', async () => {
    // Typing the provider is a decision the reader made, not the agent's.
    const h = harness([])
    h.mode.mockReturnValue('off')
    h.invocation.rawInput = 'claude Explain this stack trace'
    try {
      expect(await requestAdvice(h.ctx, h.invocation)).toEqual({ kind: 'success' })
      expect(h.consult).toHaveBeenCalledWith(h.invocation.agent, 'claude', 'Explain this stack trace', '', expect.any(AbortSignal), expect.any(Function))
    } finally { await h.ctx.fiber.dispose() }
  })
})

describe('the consultation trace', () => {
  const steps: TuiSubagentActivity[] = [
    { text: '$ rg -n "ALTER TABLE" src', status: 'ok', at: 0 },
    { text: 'Read src/migrations.ts', status: 'ok', at: 3_100 },
    { text: 'considering the rollback path', status: 'thinking', at: 3_500 },
  ]

  it('leads with what the run was and what it cost', () => {
    const trace = advisorTrace(steps, 'completed', 63_500)
    expect(trace.split('\n')[0]).toBe('Completed · 3 steps · 1m 03s')
    // Running and finished read from the same builder, so the card does not
    // change shape when the answer arrives.
    expect(advisorTrace(steps, 'running', 4_000)).toContain('In progress · 3 steps')
  })

  it('puts each step on one line with the time it held', () => {
    const rows = advisorTrace(steps, 'completed', 63_500).split('\n').filter(line => line.startsWith('✓') || line.startsWith('·'))
    expect(rows).toHaveLength(3)
    // A step's span is the distance to the next one: that is all an external
    // agent reports, so the number is honest without claiming to be its own.
    expect(rows[0]).toContain('3.1s')
    expect(rows[1]).toContain('400ms')
    // The last span runs to the end of the consultation rather than to nothing.
    expect(rows[2]).toContain('1m 00s')
  })

  it('folds the head rather than dropping it when a run has many steps', () => {
    const many: TuiSubagentActivity[] = Array.from({ length: 20 }, (_, at) => ({ text: `step ${at + 1}`, status: 'ok' as const, at: at * 1_000 }))
    const trace = advisorTrace(many, 'completed', 20_000)
    expect(trace).toContain('Completed · 20 steps')
    expect(trace).toContain('… 12 earlier steps')
    expect(trace).toContain('step 20')
    expect(trace).not.toContain('step 11')
  })
})

  it('pads in display cells, so a CJK step keeps its duration on the same line', () => {
    // Padding by string length wrapped the duration onto its own line: one CJK
    // character is one code unit and two terminal cells.
    const trace = advisorTrace([
      { text: '我会只读查看项目说明', status: 'ok', at: 0 },
      { text: 'Read src/auth.ts', status: 'ok', at: 2_000 },
    ], 'completed', 5_000)
    const rows = trace.split('\n').filter(line => line.startsWith('✓'))
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row).toMatch(/[0-9.]+m?s$/u)
  })
