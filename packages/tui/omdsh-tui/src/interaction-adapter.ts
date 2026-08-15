/**
 * Harness human-interaction adapters for the terminal presentation seam.
 *
 * Domain services keep ownership of audit, cancellation, and validation;
 * this module only translates their fixed vocabularies to one Tui prompt.
 * @module @agi-fans/dsh-tui/interaction-adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import type { TuiService } from './definition.ts'

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

async function askQuestions(tui: TuiService, request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
  const answers: AskUserQuestionAnswer['answers'] = []
  for (const question of request.questions) {
    const raw = await tui.prompt({
      title: question.intent?.kind === 'plan-review' ? 'Plan review' : (question.header ?? 'Question'),
      question: question.question,
      ...(question.detail === undefined ? {} : { detail: question.detail }),
      ...(question.options === undefined ? {} : { options: question.options }),
      ...(question.multiSelect === undefined ? {} : { multiSelect: question.multiSelect }),
      ...(question.intent?.kind === 'plan-review'
        ? { presentation: 'plan-review' as const, approveValue: question.intent.approve }
        : {}),
      allowCustom: true,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (raw === null) {
      answers.push({ id: question.id, selected: [] })
      continue
    }
    const parsed = parsePromptAnswer(raw, question)
    answers.push({ id: question.id, ...parsed })
  }
  return { answers }
}

async function askApproval(tui: TuiService, request: ApprovalRequest): Promise<ApprovalOutcome> {
  const raw = await tui.prompt({
    title: 'Approval required',
    question: `Allow ${request.toolName} once?`,
    ...(request.reason === undefined ? {} : { detail: request.reason }),
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
): () => void {
  const disposers: Array<() => void> = []
  const questions = ctx.get('userQuestions')
  if (questions !== undefined) {
    disposers.push(questions.registerProvider({
      ask: request => askQuestions(tui, request),
    }))
  }
  if (ctx.get('approval') !== undefined) {
    disposers.push(ctx.on('approval/request', async (request, next) => {
      if (request.agent !== activeAgent()) return next()
      return askApproval(tui, request)
    }))
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
