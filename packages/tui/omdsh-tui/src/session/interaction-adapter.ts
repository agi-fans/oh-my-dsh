/**
 * Harness human-interaction adapters for the terminal presentation seam.
 *
 * Domain services keep ownership of audit, cancellation, and validation;
 * this module only translates their fixed vocabularies to one Tui prompt.
 * @module @agi-fans/dsh-tui/interaction-adapter
 */

import { resolveUiLanguage, uiText } from '../locale/index.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  UserQuestionError,
  type UserQuestionService,
  type AskUserQuestionAnswer,
  type AskUserQuestionItem,
  type AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import type { TuiService } from '../definition.ts'
import type {} from '../runtime/approval-rules.ts'
import { approvalActionDetail } from '../views/approval-rule.ts'

const QUESTION_BACK_VALUE = '__back__'

/** Keep the review decision separate from free text, even feedback such as "Approve". */
async function reviewPlan(tui: TuiService, question: AskUserQuestionItem, signal: AbortSignal, notify: boolean, interrupt: () => void): Promise<AskUserQuestionAnswer['answers'][number]> {
  const intent = question.intent
  if (intent?.kind !== 'plan-review') throw new Error('Expected a plan review')
  const t = (source: string): string => uiText(resolveUiLanguage(tui.prefs?.().uiLanguage), source)
  let draft = '', selected = intent.approve
  while (true) {
    signal.throwIfAborted()
    const decision = await tui.prompt({ title: t('Plan review'), question: question.question,
      ...(question.detail === undefined ? {} : { detail: question.detail }),
      ...(question.options === undefined ? {} : { options: question.options }), presentation: 'plan-review', approveValue: intent.approve,
      initialValue: selected, allowCustom: false, localize: ['question', 'options'], notify, signal, interrupt })
    notify = false
    signal.throwIfAborted()
    if (decision === null) {
      if (draft.trim() !== '') tui.insertText?.(draft)
      throw new UserQuestionError('The user dismissed the plan review.', 'ASK_CANCELLED')
    }
    if (!question.options?.some(option => option.label === decision)) continue
    if (decision === intent.approve) return { id: question.id, selected: [intent.approve] }
    selected = decision
    const feedback = await tui.prompt({ title: t('Revision feedback · optional'), question: t('What should the revised plan change?'),
      options: [{ label: t('Continue without feedback'), value: '' }], initialInput: draft, allowCustom: true, notify: false, signal, interrupt,
      onCancelDraft: value => { draft = value } })
    signal.throwIfAborted()
    if (feedback === null) continue
    return { id: question.id, selected: [decision], ...(feedback.trim() === '' ? {} : { custom: feedback.trim() }) }
  }
}

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
  notify = true,
): Promise<AskUserQuestionAnswer> {
  const t = (source: string): string => uiText(resolveUiLanguage(tui.prefs?.().uiLanguage), source)
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
    const rawAnswers = new Map<number, string>()
    let index = 0
    let shouldNotify = notify
    while (index < request.questions.length) {
      const question = request.questions[index]!
      signal.throwIfAborted()
      if (question.intent?.kind === 'plan-review') {
        answers[index] = await reviewPlan(tui, question, signal, shouldNotify,
          () => { lifetime.abort(new UserQuestionError('The user interrupted the question.', 'ASK_ABORTED')) })
        shouldNotify = false
        index += 1
        continue
      }
      const previousRaw = rawAnswers.get(index)
      const previousParsed = previousRaw === undefined ? undefined : parsePromptAnswer(previousRaw, question)
      const restoredAnswer = previousParsed === undefined
        ? {}
        : question.multiSelect === true
          ? {
              ...(previousParsed.selected.length === 0 ? {} : { initialValues: previousParsed.selected }),
              ...(previousParsed.selected.length === 0 && previousParsed.custom !== undefined ? { initialInput: previousParsed.custom } : {}),
            }
          : previousParsed.custom !== undefined
            ? { initialInput: previousParsed.custom }
            : previousParsed.selected[0] !== undefined
              ? { initialValue: previousParsed.selected[0] }
              : {}
      const promptNotify = shouldNotify
      shouldNotify = false
      const raw = await tui.prompt({
        title: question.header ?? t('Question'),
        question: question.question,
        ...(question.detail === undefined ? {} : { detail: question.detail }),
        ...(question.options === undefined ? {} : { options: question.options }),
        ...(question.multiSelect === undefined ? {} : { multiSelect: question.multiSelect }),
        ...(request.questions.length > 1 ? { title: `${question.header ?? t('Question')} · ${index + 1}/${request.questions.length}` } : {}),
        ...(index > 0 ? { actions: [{ key: 'alt+left', label: t('previous question'), valuePrefix: QUESTION_BACK_VALUE, scope: 'list' as const }] } : {}),
        ...restoredAnswer,
        ...(tui.insertText === undefined ? {} : {
          onCancelDraft: (draft: string) => {
            if (draft.trim() !== '') tui.insertText?.(draft)
          },
        }),
        ...(wait === undefined ? {} : { wait }),
        ...(request.wait?.timed === true ? { dismissLabel: t('Later') } : {}),
        ...(promptNotify ? {} : { notify: false }),
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
      if (raw === QUESTION_BACK_VALUE && index > 0) {
        index -= 1
        continue
      }
      rawAnswers.set(index, raw)
      answers[index] = { id: question.id, ...parsePromptAnswer(raw, question) }
      index += 1
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
    presentation: 'card',
    filterable: true,
    allowCustom: false,
    notify: false,
    signal,
  })
  if (id === null || id === undefined || signal.aborted) return undefined
  const question = read().find(item => item.callId === id && item.state === 'continued')
  if (question === undefined) return 'This question has already been answered.'
  let answer: AskUserQuestionAnswer
  try {
    answer = await askQuestions(tui, { agent, questions: [...question.questions], signal }, undefined, false)
  } catch (error) {
    if (signal.aborted || (error instanceof UserQuestionError && error.code === 'ASK_CANCELLED')) return undefined
    throw error
  }
  signal.throwIfAborted()
  const accepted = ctx.userQuestions.answer(agent, question.callId, answer)
  return accepted ? 'Answer queued for the next model step.' : 'This question has already been answered.'
}

/** Preserve the full action and reason for the scrollable approval reader. */
export function approvalDetail(tui: TuiService, request: ApprovalRequest, descendant = false): { detail?: string } {
  const call = descendant && request.callId !== undefined ? request.agent.session.ownEvents().findLast(event => event.type === 'tool/call' && event.data.callId === request.callId) : undefined
  const context = descendant
    ? call?.type === 'tool/call' ? `${call.data.name} ${call.data.arguments}` : undefined
    : request.callId === undefined ? undefined : tui.toolCallContext(request.callId)
  const parts = [context, request.reason].filter(
    (part): part is string => part !== undefined && part !== '',
  )
  return parts.length === 0 ? {} : { detail: parts.join('\n\n') }
}

async function askApproval(ctx: Context, tui: TuiService, request: ApprovalRequest, agentLabel?: string): Promise<ApprovalOutcome> {
  const t = (source: string, values?: Record<string, string>) => uiText(resolveUiLanguage(tui.prefs?.().uiLanguage), source, values)
  const rules = ctx.get('omdshApprovalRules')
  const action = rules?.describe(request)
  // The action and its reason are the detail of a decision, so they belong on
  // the card that carries the decision rather than on a page of their own.
  const raw = await tui.prompt({
    localize: true, title: agentLabel === undefined ? 'Approval required' : `${agentLabel} · ${t('Approval required')}`,
    question: t('Allow {tool} once?', { tool: request.toolName }),
    armMs: 500,
    detail: approvalDetail(tui, request, agentLabel !== undefined).detail ?? request.toolName,
    options: [
      { label: 'Allow once', description: 'Run only this requested action.' },
      { label: 'Reject', description: 'Deny this action.' },
      { label: 'Reject with note', value: 'reject-note', description: 'Deny this action and guide the next step.' },
      ...(action === undefined ? [] : [
        { label: 'Remember allow', value: 'remember-allow', description: 'Preview an exact invocation rule and choose its scope.' },
        { label: 'Remember reject', value: 'remember-reject', description: 'Reject matching approval requests until revoked.' },
      ]),
    ],
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  if (request.signal?.aborted || raw === null) return 'cancelled'
  if (raw === 'reject-note') {
    const note = await tui.prompt({
      localize: true, title: agentLabel === undefined ? 'Reject with note' : `${agentLabel} · ${t('Reject with note')}`,
      question: t('Why reject {tool}, or what should the agent do instead?', { tool: request.toolName }),
      allowCustom: true,
      notify: false,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (request.signal?.aborted || note === null) return 'cancelled'
    const trimmed = note.trim()
    if (trimmed !== '') {
      if (typeof request.agent?.steer === 'function') {
        request.agent.steer(createUserMessage({ content: [{ type: 'text', text: trimmed }], source: { kind: 'user' } }))
      } else {
        tui.insertText?.(trimmed)
      }
    }
    return 'rejected'
  }
  if ((raw === 'remember-allow' || raw === 'remember-reject') && action !== undefined && rules !== undefined) {
    const decision = raw === 'remember-allow' ? 'allow' : 'reject'
    const scope = await tui.prompt({ localize: true, title: agentLabel === undefined ? 'Remember approval decision' : `${agentLabel} · ${t('Remember approval decision')}`, question: decision === 'allow' ? 'Where should this exact invocation be allowed?' : 'Where should this exact invocation be rejected?',
      detail: approvalActionDetail(action)
        + '\n\n' + t('Matches the complete arguments, directory, Access and approval reason. Other sandbox and tool protections still apply.'),
      options: [{ label: 'This session', value: 'session', description: 'Retained on resume; not inherited by forks or children.' },
        { label: 'This workspace', value: 'workspace', description: 'Applies to sessions with this same workspace boundary.' },
        { label: 'Cancel', value: 'cancel', description: 'Save nothing and cancel this request.' }],
      initialValue: 'cancel', allowCustom: false, notify: false, ...(request.signal === undefined ? {} : { signal: request.signal }) })
    if (request.signal?.aborted || scope !== 'session' && scope !== 'workspace') return 'cancelled'
    rules.remember(request, scope, decision)
    return decision === 'allow' ? 'allowed-once' : 'rejected'
  }
  const normalized = raw.trim().toLowerCase()
  return normalized === '1' || normalized === 'allow' || normalized === 'allow once'
    || normalized === 'y' || normalized === 'yes'
    ? 'allowed-once'
    : 'rejected'
}

/** Bind the global question provider and route approvals to the active root and authorized live descendants. */
export function bindHumanInteraction(
  ctx: Context,
  tui: TuiService,
  activeAgent: () => Agent | undefined,
  beginDescendantApproval?: (agent: Agent) => { label: string; signal: AbortSignal; finish(): void } | undefined,
  activeSignal?: () => AbortSignal,
): () => Promise<void> {
  const disposers: Array<() => void> = []
  const lifetime = new AbortController()
  const scopeSignal = (signal?: AbortSignal): AbortSignal => AbortSignal.any([lifetime.signal,
    ...(activeSignal === undefined ? [] : [activeSignal()]), ...(signal === undefined ? [] : [signal])])
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
      const signal = scopeSignal(request.signal)
      return enqueue(signal, () => {
        if (request.agent !== undefined && request.agent !== activeAgent()) throw new UserQuestionError('The question belongs to a previous session.', 'ASK_ABORTED')
        return askQuestions(tui, { ...request, signal }, questions)
      })
    }))
  }
  const commands = ctx.get('commands')
  if (questions !== undefined && commands !== undefined) {
    disposers.push(commands.register({
      name: 'questions',
      description: 'Answer questions left pending in this session',
      handler: invocation => {
        const ownedSignal = scopeSignal(invocation.signal)
        return enqueue(ownedSignal, async () => {
          if (invocation.rawInput.trim() !== '') return { kind: 'error' as const, text: 'Usage: /questions' }
          if (invocation.agent !== activeAgent()) return { kind: 'error' as const, text: 'Questions belong to the active session.' }
          const operation = new AbortController()
          const off = ctx.on('session/disposed', (session) => {
            if (session === invocation.agent.session) operation.abort()
          })
          try {
            const signal = AbortSignal.any([ownedSignal, operation.signal])
            const text = await answerPendingQuestions(ctx, tui, invocation.agent, signal)
            return { kind: 'success' as const, ...(text === undefined ? {} : { text }) }
          } catch (error) {
            if (operation.signal.aborted || ownedSignal.aborted) return { kind: 'success' as const }
            return { kind: 'error' as const, text: error instanceof Error ? error.message : String(error) }
          } finally {
            off()
          }
        })
      },
    }))
  }
  if (ctx.get('approval') !== undefined) {
    disposers.push(ctx.on('approval/request', async (request, next) => {
      const root = activeAgent()
      const child = request.agent === root ? undefined : beginDescendantApproval?.(request.agent)
      if (request.agent !== activeAgent() && child === undefined) return next()
      const signal = scopeSignal(request.signal)
      const scopedSignal = child === undefined ? signal : AbortSignal.any([signal, child.signal])
      return enqueue(scopedSignal, () => root !== activeAgent() ? Promise.resolve('cancelled' as const)
        : askApproval(ctx, tui, { ...request, signal: scopedSignal }, child?.label))
        .catch(error => { if (scopedSignal.aborted) return 'cancelled' as const; throw error })
        .finally(() => child?.finish())
    }))
  }
  return async () => {
    lifetime.abort(new UserQuestionError('The question interface was unloaded.', 'ASK_ABORTED'))
    for (const dispose of disposers.splice(0).reverse()) dispose()
    await queue
  }
}
