/**
 * Harness human-interaction adapters for the terminal presentation seam.
 *
 * Domain services keep ownership of audit, cancellation, and validation;
 * this module only translates their fixed vocabularies to one Tui prompt.
 * @module @agi-fans/dsh-tui/interaction-adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import {
  UserQuestionError,
  type UserQuestionService,
  type AskUserQuestionAnswer,
  type AskUserQuestionItem,
  type AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import type { TuiService } from '../definition.ts'

/** Resolve a label/number list while preserving unmatched input as custom text. */
export function parsePromptAnswer(
  input: string,
  question: Pick<AskUserQuestionItem, 'options' | 'multiSelect'>,
): { selected: string[]; custom?: string } {
  const options = question.options ?? []
  const tokens = question.multiSelect === true ? input.split(',').map(token => token.trim()) : [input.trim()]
  const selected: string[] = []
  const custom: string[] = []
  for (const token of tokens.filter(Boolean)) {
    const numeric = /^\d+$/u.test(token) ? Number(token) - 1 : -1
    const match = numeric >= 0
      ? options[numeric]
      : options.find(option => option.label.toLowerCase() === token.toLowerCase())
    if (match === undefined) custom.push(token)
    else if (!selected.includes(match.label)) selected.push(match.label)
  }
  return {
    selected,
    ...(custom.length === 0 ? {} : { custom: custom.join(question.multiSelect === true ? ', ' : '') }),
  }
}

/** Collect a complete batch under one Harness wait, including PTC sub-calls. */
async function askQuestions(
  tui: TuiService,
  request: AskUserQuestionRequest,
  service?: UserQuestionService,
): Promise<AskUserQuestionAnswer> {
  const lifetime = new AbortController()
  const signal = request.signal === undefined ? lifetime.signal : AbortSignal.any([lifetime.signal, request.signal])
  let timer: ReturnType<typeof setTimeout> | undefined
  let claim: AsyncIterator<{ remainingMs: number }> | undefined
  let claimEnded: Promise<IteratorResult<{ remainingMs: number }>> | undefined
  let wait: { deadline: number; hold(): void } | undefined
  const timedOut = (): UserQuestionError => new UserQuestionError('The question is still awaiting an answer.', 'ASK_TIMED_OUT')
  try {
    signal.throwIfAborted()
    if (request.wait?.timed === true) {
      if (service === undefined || request.agent === undefined) throw timedOut()
      claim = service.attachWait(request.agent, request.wait.callId, signal)[Symbol.asyncIterator]()
      const first = await claim.next()
      signal.throwIfAborted()
      if (first.done) throw timedOut()
      claimEnded = claim.next()
      // A remote/business stream can also fail independently of its parent.
      void claimEnded.catch(error => { lifetime.abort(error) })
      wait = {
        deadline: Date.now() + first.value.remainingMs,
        hold: () => { clearTimeout(timer); timer = undefined; wait = undefined },
      }
      timer = setTimeout(() => { lifetime.abort(timedOut()) }, first.value.remainingMs)
    }
    const answers: AskUserQuestionAnswer['answers'] = []
    for (const [index, question] of request.questions.entries()) {
      signal.throwIfAborted()
      const raw = await tui.prompt({
        title: question.intent?.kind === 'plan-review' ? 'Plan review' : (question.header ?? 'Question'),
        question: question.question,
        ...(question.detail === undefined ? {} : { detail: question.detail }),
        ...(question.options === undefined ? {} : { options: question.options }),
        ...(question.multiSelect === undefined ? {} : { multiSelect: question.multiSelect }),
        ...(question.intent?.kind === 'plan-review'
          ? { presentation: 'plan-review' as const, approveValue: question.intent.approve }
          : {}),
        ...(request.questions.length > 1 ? { title: `${question.header ?? 'Question'} · ${index + 1}/${request.questions.length}` } : {}),
        ...(wait === undefined ? {} : { wait }),
        ...(request.wait?.timed === true ? { dismissLabel: 'Later' } : {}),
        skippable: question.intent === undefined,
        allowCustom: true,
        interrupt: () => { lifetime.abort(new UserQuestionError('The user interrupted the question.', 'ASK_ABORTED')) },
        signal,
      })
      signal.throwIfAborted()
      if (raw === null) {
        if (request.wait?.timed === true) throw timedOut()
        throw new UserQuestionError('The user dismissed the question.', 'ASK_CANCELLED')
      }
      answers.push({ id: question.id, ...parsePromptAnswer(raw, question) })
    }
    return { answers }
  } finally {
    clearTimeout(timer)
    lifetime.abort()
    if (claimEnded !== undefined) await claimEnded.catch(() => {})
    await claim?.return?.()
  }
}

/** Reopen continued questions from the public projection; the original tool stays settled. */
async function answerPendingQuestions(
  ctx: Context,
  tui: TuiService,
  agent: Agent,
  signal: AbortSignal,
): Promise<string | undefined> {
  const read = () => ctx.get('sessionProjections')?.snapshot(agent.session).values.userQuestions?.active ?? []
  const continued = read().filter(question => question.state === 'continued')
  if (continued.length === 0) return 'No pending questions in this session.'
  const id = continued.length === 1 ? continued[0]?.callId : await tui.prompt({
    title: 'Pending questions',
    question: 'Choose a question to answer.',
    options: continued.map(question => ({
      label: question.questions.map(item => item.header ?? item.question).join(' · '),
      value: question.callId,
      preview: question.questions.map(item => item.question).join(' / '),
    })),
    presentation: 'fullscreen-list',
    filterable: true,
    allowCustom: false,
    signal,
  })
  if (id === null || id === undefined || signal.aborted) return undefined
  const question = read().find(item => item.callId === id && item.state === 'continued')
  if (question === undefined) return 'This question has already been answered.'
  let answer: AskUserQuestionAnswer
  try {
    answer = await askQuestions(tui, { agent, questions: [...question.questions], signal })
  } catch (error) {
    if (signal.aborted || (error instanceof UserQuestionError && error.code === 'ASK_CANCELLED')) return undefined
    throw error
  }
  signal.throwIfAborted()
  const accepted = ctx.userQuestions.answer(agent, question.callId, answer)
  return accepted ? 'Answer queued for the next model step.' : 'This question has already been answered.'
}

/**
 * Body of the approval prompt: what the call is, then why it is being asked.
 * The interface already rendered this call, so it is read back instead of
 * restating the tool name. The detail renders on one line, so both parts are
 * joined with a separator, and the action comes before the asker's explanation.
 */
export function approvalDetail(tui: TuiService, request: ApprovalRequest): { detail?: string } {
  const context = request.callId === undefined ? undefined : tui.toolCallContext(request.callId)
  const parts = [context, request.reason].filter(
    (part): part is string => part !== undefined && part !== '',
  )
  return parts.length === 0 ? {} : { detail: parts.join(' · ') }
}

async function askApproval(tui: TuiService, request: ApprovalRequest): Promise<ApprovalOutcome> {
  const raw = await tui.prompt({
    title: 'Approval required',
    question: `Allow ${request.toolName} once?`,
    ...approvalDetail(tui, request),
    options: [
      { label: 'Allow once', description: 'Run only this requested action.' },
      { label: 'Reject', description: 'Deny this action.' },
    ],
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  if (raw === null) return 'cancelled'
  const normalized = raw.trim().toLowerCase()
  return normalized === '1' || normalized === 'allow' || normalized === 'allow once'
    || normalized === 'y' || normalized === 'yes'
    ? 'allowed-once'
    : 'rejected'
}

/** Bind the global question provider and route approvals to the active root agent only. */
export function bindHumanInteraction(
  ctx: Context,
  tui: TuiService,
  activeAgent: () => Agent | undefined,
): () => Promise<void> {
  const disposers: Array<() => void> = []
  const lifetime = new AbortController()
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> => {
    const pending = queue.then(() => { signal.throwIfAborted(); return operation() })
    queue = pending.catch(() => {})
    // An unattended queued wait must settle at its Host deadline, even while
    // an earlier prompt is held. Its eventual queue slot cannot open a stale UI.
    return new Promise((resolve, reject) => {
      const abort = (): void => { reject(signal.reason) }
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
      void pending.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
    })
  }
  const questions = ctx.get('userQuestions')
  if (questions !== undefined) {
    disposers.push(ctx.on('user-questions/request', (request, next) => {
      if (request.agent !== undefined && request.agent !== activeAgent()) return next()
      const signal = request.signal === undefined ? lifetime.signal : AbortSignal.any([lifetime.signal, request.signal])
      return enqueue(signal, () => askQuestions(tui, { ...request, signal }, questions))
    }))
  }
  const commands = ctx.get('commands')
  if (questions !== undefined && commands !== undefined) {
    disposers.push(commands.register({
      name: 'questions',
      description: 'Answer questions left pending in this session',
      handler: invocation => enqueue(AbortSignal.any([invocation.signal, lifetime.signal]), async () => {
        if (invocation.rawInput.trim() !== '') return { kind: 'error' as const, text: 'Usage: /questions' }
        if (invocation.agent !== activeAgent()) return { kind: 'error' as const, text: 'Questions belong to the active session.' }
        const operation = new AbortController()
        const off = ctx.on('session/disposed', (session) => {
          if (session === invocation.agent.session) operation.abort()
        })
        try {
          const signal = AbortSignal.any([invocation.signal, lifetime.signal, operation.signal])
          const text = await answerPendingQuestions(ctx, tui, invocation.agent, signal)
          return { kind: 'success' as const, ...(text === undefined ? {} : { text }) }
        } catch (error) {
          if (operation.signal.aborted || invocation.signal.aborted || lifetime.signal.aborted) return { kind: 'success' as const }
          return { kind: 'error' as const, text: error instanceof Error ? error.message : String(error) }
        } finally {
          off()
        }
      }),
    }))
  }
  if (ctx.get('approval') !== undefined) {
    disposers.push(ctx.on('approval/request', async (request, next) => {
      if (request.agent !== activeAgent()) return next()
      const signal = request.signal === undefined ? lifetime.signal : AbortSignal.any([lifetime.signal, request.signal])
      return enqueue(signal, () => askApproval(tui, { ...request, signal }))
    }))
  }
  return async () => {
    lifetime.abort(new UserQuestionError('The question interface was unloaded.', 'ASK_ABORTED'))
    for (const dispose of disposers.splice(0).reverse()) dispose()
    await queue
  }
}
