import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { TuiPrompt, TuiService } from '../definition.ts'
import { approvalDetail, bindHumanInteraction, parsePromptAnswer } from './interaction-adapter.ts'

describe('parsePromptAnswer', () => {
  const options = [{ label: 'Alpha' }, { label: 'Beta' }]

  it('accepts a 1-based number or a case-insensitive label', () => {
    expect(parsePromptAnswer('2', { options })).toEqual({ selected: ['Beta'] })
    expect(parsePromptAnswer('alpha', { options })).toEqual({ selected: ['Alpha'] })
  })

  it('supports multi-select and keeps custom text', () => {
    expect(parsePromptAnswer('1, Beta, something else', { options, multiSelect: true })).toEqual({
      selected: ['Alpha', 'Beta'],
      custom: 'something else',
    })
  })
})

describe('approvalDetail', () => {
  const request = (fields: Partial<ApprovalRequest>): ApprovalRequest =>
    ({ toolName: 'bash', agent: {}, ...fields }) as unknown as ApprovalRequest

  it('puts the rendered call before the asker explanation', () => {
    const tui = { toolCallContext: (callId: string) => callId === 'call-1' ? 'bash · rm -rf build' : undefined }
    expect(approvalDetail(tui as unknown as TuiService, request({ callId: 'call-1', reason: 'outside the workspace' })))
      .toEqual({ detail: 'bash · rm -rf build · outside the workspace' })
  })

  it('falls back to the reason alone when the call did not stream', () => {
    const tui = { toolCallContext: () => undefined }
    expect(approvalDetail(tui as unknown as TuiService, request({ callId: 'call-1', reason: 'needs approval' })))
      .toEqual({ detail: 'needs approval' })
  })

  it('omits the detail entirely when neither part exists', () => {
    const tui = { toolCallContext: () => undefined }
    expect(approvalDetail(tui as unknown as TuiService, request({}))).toEqual({})
  })
})

describe('bindHumanInteraction', () => {
  it('answers through the legacy user-question waterfall', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const prompt = vi.fn(async () => '1')
    const dispose = bindHumanInteraction(ctx, { prompt } as unknown as TuiService, () => undefined)

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'choice', question: 'Choose', options: [{ label: 'Alpha' }] }],
    })).resolves.toEqual({ answers: [{ id: 'choice', selected: ['Alpha'] }] })
    expect(prompt).toHaveBeenCalledOnce()

    await dispose()
    await ctx.fiber.dispose()
  })
})

const questionBatch = [{ id: 'scope', question: 'Choose the scope', options: [{ label: 'Project' }, { label: 'Global' }] }]
const callId = ToolCallId('question-1')

async function questionContext(prompt: (request: TuiPrompt) => Promise<string | null>) {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(CommandRuntime)
  const session = Session.create(SessionId('questions-test'))
  const nextStep: UserMessage[] = []
  const steer = vi.fn((message: UserMessage) => { nextStep.push(message) })
  const agent = { id: session.id, session, inbox: { nextTurn: [], nextStep }, steer } as unknown as Agent
  ctx.agents.enter(agent, undefined)
  const dispose = bindHumanInteraction(ctx, { prompt } as unknown as TuiService, () => agent)
  onTestFinished(async () => { await dispose(); await ctx.fiber.dispose(); vi.useRealTimers() })
  return { ctx, agent, steer, dispose }
}

function pendingCall(agent: Agent, ptc = false): void {
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('step/start', { turn: 1, step: 1 })
  agent.session.append('request/header', {
    header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, tools: [{
      name: 'ask_user_question', description: 'Ask',
      parameters: { type: 'object', properties: { questions: { type: 'array' }, timeout: { type: 'integer' } } },
    }] }, reason: 'initial',
  })
  if (ptc) {
    agent.session.append('tool/ptc-dispatch', {
      rootCallId: ToolCallId('program-1'), parentCallId: ToolCallId('program-1'), subCallId: callId,
      name: 'ask_user_question', arguments: { questions: questionBatch },
      isError: false, content: [{ type: 'text', text: JSON.stringify({ pending: true, callId }) }],
    })
  } else {
    agent.session.append('tool/call', {
      turn: 1, step: 1, callId, name: 'ask_user_question', arguments: JSON.stringify({ questions: questionBatch }),
    })
    agent.session.append('tool/result', {
      turn: 1, step: 1, message: createToolResultMessage({
        callId, isError: false, content: [{ type: 'text', text: JSON.stringify({ pending: true, callId }) }],
      }),
    }, { surfaceOp: 'append' })
  }
}

/** A real prompt settles when its presentation signal ends. */
function awaitingPrompt(request: TuiPrompt): Promise<null> {
  return new Promise(resolve => {
    if (request.signal?.aborted) resolve(null)
    else request.signal?.addEventListener('abort', () => { resolve(null) }, { once: true })
  })
}

describe('timed TUI questions', () => {
  it('claims a foreground wait and returns pending at the local deadline', async () => {
    vi.useFakeTimers()
    const prompt = vi.fn(awaitingPrompt)
    const { ctx, agent } = await questionContext(prompt)
    const result = ctx.userQuestions.askTimed({ agent, questions: questionBatch }, callId, 2_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(prompt).toHaveBeenCalledOnce()
    expect(prompt.mock.calls[0]?.[0].wait?.deadline).toBe(Date.now() + 2_000)
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(result).resolves.toEqual({ pending: true, callId })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('holds the whole batch after editing or Take time', async () => {
    vi.useFakeTimers()
    const entered = Promise.withResolvers<string | null>()
    const prompt = vi.fn((_request: TuiPrompt) => entered.promise)
    const { ctx, agent } = await questionContext(prompt)
    const result = ctx.userQuestions.askTimed({ agent, questions: questionBatch }, callId, 2_000)
    await vi.advanceTimersByTimeAsync(0)
    const request = prompt.mock.calls[0]?.[0] as TuiPrompt | undefined
    request?.wait?.hold()
    let settled = false
    void result.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(settled).toBe(false)
    entered.resolve('2')
    await expect(result).resolves.toEqual({ answers: [{ id: 'scope', selected: ['Global'] }] })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses one deadline across questions and never submits a partial batch', async () => {
    vi.useFakeTimers()
    const prompt = vi.fn().mockImplementationOnce(async () => '1').mockImplementation(awaitingPrompt)
    const { ctx, agent } = await questionContext(prompt)
    const result = ctx.userQuestions.askTimed({ agent, questions: [...questionBatch, { id: 'why', question: 'Why?' }] }, callId, 1_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(prompt.mock.calls[0]?.[0].wait.deadline).toBe(prompt.mock.calls[1]?.[0].wait.deadline)
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(result).resolves.toEqual({ pending: true, callId })
  })

  it('treats Later as pending and only an explicit skip as an empty answer', async () => {
    const prompt = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('')
    const { ctx, agent } = await questionContext(prompt)
    await expect(ctx.userQuestions.askTimed({ agent, questions: questionBatch }, callId, 2_000))
      .resolves.toEqual({ pending: true, callId })
    await expect(ctx.userQuestions.askTimed({ agent, questions: questionBatch }, ToolCallId('question-2'), 2_000))
      .resolves.toEqual({ answers: [{ id: 'scope', selected: [] }] })
  })

  it('keeps indefinite and legacy calls blocking and dismisses them as cancellation', async () => {
    const prompt = vi.fn(async () => null)
    const { ctx, agent } = await questionContext(prompt)
    await expect(ctx.userQuestions.ask({ agent, questions: questionBatch, wait: { callId } }))
      .rejects.toMatchObject({ code: 'ASK_CANCELLED' })
    expect(prompt.mock.calls[0]?.[0].wait).toBeUndefined()
  })

  it('aborts rather than returning skipped answers when the turn ends', async () => {
    const prompt = vi.fn(awaitingPrompt)
    const { ctx, agent } = await questionContext(prompt)
    const operation = new AbortController()
    const result = ctx.userQuestions.askTimed({ agent, questions: questionBatch, signal: operation.signal }, callId, 2_000)
    const checked = expect(result).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await vi.waitFor(() => { expect(prompt).toHaveBeenCalledOnce() })
    operation.abort()
    await checked
  })

  it('releases a held prompt when the adapter unmounts', async () => {
    const prompt = vi.fn(awaitingPrompt)
    const { ctx, agent, dispose } = await questionContext(prompt)
    const result = ctx.userQuestions.askTimed({ agent, questions: questionBatch }, callId, 2_000)
    const checked = expect(result).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await vi.waitFor(() => { expect(prompt).toHaveBeenCalledOnce() })
    prompt.mock.calls[0]?.[0].wait?.hold()
    await dispose()
    await checked
    expect(ctx.commands.list(agent).some(command => command.name === 'questions')).toBe(false)
  })

  it('serializes sibling waits without claiming a question still in the UI queue', async () => {
    vi.useFakeTimers()
    const prompt = vi.fn(awaitingPrompt)
    const { ctx, agent } = await questionContext(prompt)
    const first = ctx.userQuestions.askTimed({ agent, questions: questionBatch }, callId, 2_000)
    const secondId = ToolCallId('question-2')
    const second = ctx.userQuestions.askTimed({ agent, questions: questionBatch }, secondId, 1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(second).resolves.toEqual({ pending: true, callId: secondId })
    expect(prompt).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(first).resolves.toEqual({ pending: true, callId })
    expect(prompt).toHaveBeenCalledOnce()
  })
})

describe('/questions', () => {
  it.each([false, true])('answers a continued call through the public projection (PTC=%s)', async (ptc) => {
    const prompt = vi.fn(async () => '1')
    const { ctx, agent, steer } = await questionContext(prompt)
    pendingCall(agent, ptc)
    await expect(ctx.commands.execute(agent, '/questions', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'success', text: 'Answer queued for the next model step.' } })
    expect(steer).toHaveBeenCalledOnce()
    const reply = steer.mock.calls[0]?.[0]
    expect(reply?.source).toMatchObject({ kind: 'user-question-reply', callId })
    expect(ctx.sessionProjections.snapshot(agent.session).values.userQuestions?.active).toHaveLength(1)
    // The same log can be projected after reconnect before the queued reply is admitted.
    await expect(ctx.commands.execute(agent, '/questions', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'error' } })
    expect(steer).toHaveBeenCalledOnce()
    if (reply !== undefined) agent.session.append('user/message', reply, { surfaceOp: 'append' })
    expect(ctx.sessionProjections.snapshot(agent.session).values.userQuestions?.active).toEqual([])
    expect(ctx.sessionProjections.snapshot(agent.session).values.userQuestions?.settled).toMatchObject([
      { callId, answers: [{ id: 'scope', selected: ['Project'] }] },
    ])
  })

  it('leaves a dismissed continued question answerable without steering', async () => {
    const prompt = vi.fn(async () => null)
    const { ctx, agent, steer } = await questionContext(prompt)
    pendingCall(agent)
    await expect(ctx.commands.execute(agent, '/questions', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'success' } })
    expect(steer).not.toHaveBeenCalled()
    expect(ctx.sessionProjections.snapshot(agent.session).values.userQuestions?.active).toHaveLength(1)
  })

  it('recovers unanswered questions from a restored canonical log', async () => {
    const prompt = vi.fn(async () => '1')
    const { ctx, agent, steer } = await questionContext(prompt)
    pendingCall(agent)
    const restored = Session.create(agent.session.id, JSON.parse(JSON.stringify(agent.session.snapshotEvents())), agent.session.header)
    Object.assign(agent, { session: restored })
    expect(ctx.sessionProjections.snapshot(restored).values.userQuestions?.active).toMatchObject([
      { callId, state: 'continued' },
    ])
    await expect(ctx.commands.execute(agent, '/questions', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'success', text: 'Answer queued for the next model step.' } })
    expect(steer).toHaveBeenCalledOnce()
  })

  it('interrupts a finite wait instead of claiming the deadline expired', async () => {
    const prompt = vi.fn((request: TuiPrompt) => {
      request.interrupt?.()
      return Promise.resolve(null)
    })
    const { ctx, agent } = await questionContext(prompt)
    await expect(ctx.userQuestions.askTimed({ agent, questions: questionBatch }, callId, 2_000))
      .rejects.toMatchObject({ code: 'ASK_ABORTED' })
  })

  it('ignores already settled questions and validates command input', async () => {
    const prompt = vi.fn(async () => '1')
    const { ctx, agent } = await questionContext(prompt)
    await expect(ctx.commands.execute(agent, '/questions', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'success', text: 'No pending questions in this session.' } })
    await expect(ctx.commands.execute(agent, '/questions extra', [], new AbortController().signal))
      .resolves.toMatchObject({ result: { kind: 'error', text: 'Usage: /questions' } })
    expect(prompt).not.toHaveBeenCalled()
  })
})
