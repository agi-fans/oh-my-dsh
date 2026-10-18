/**
 * Per-reply feedback over the Harness message-feedback service.
 * `/rate` lists finalized assistant messages, records a positive or negative
 * judgment with an optional category and note, and clears an existing rating.
 * Ratings are log-only Session records and never enter model context.
 * @module @agi-fans/dsh-tui/command-rate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { MessageFeedbackItem } from '@deepseek-ai/dsh-message-feedback'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { Session } from '@deepseek-ai/dsh-session'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-rate'
export const inject = ['commands', 'messageFeedback', 'tui']

type PutRequest = Parameters<Context['messageFeedback']['put']>[0]
type FeedbackCategory = NonNullable<PutRequest['category']>

/** One finalized assistant reply that can receive feedback. */
export interface RateTarget {
  readonly messageId: MessageId
  readonly turn: number
  readonly step: number
  readonly preview: string
}

/** Fixed taxonomy the Harness stores for one judgment. */
export const RATE_CATEGORIES: readonly { value: FeedbackCategory; label: string; description: string }[] = [
  { value: 'task-result', label: 'Task result', description: 'The answer or the work was wrong.' },
  { value: 'instruction-following', label: 'Instructions', description: 'The reply ignored an instruction or the plan.' },
  { value: 'product-interaction', label: 'Interaction', description: 'The terminal flow was awkward or confusing.' },
  { value: 'service-stability', label: 'Stability', description: 'The turn failed, hung, or behaved inconsistently.' },
  { value: 'resource-cost', label: 'Cost', description: 'Too much time or too many tokens were spent.' },
  { value: 'security-privacy-permission', label: 'Security', description: 'A privacy, permission, or safety concern.' },
  { value: 'other', label: 'Other', description: 'Something else worth recording.' },
]

const PREVIEW_LIMIT = 120

function previewOf(parts: readonly { type: string; text?: string }[]): string {
  const text = parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 1).trimEnd()}…` : text
}

/** Collect append-origin assistant replies, newest first, skipping empty placeholders. */
export function rateTargets(session: Session): RateTarget[] {
  const targets: RateTarget[] = []
  for (const event of session.snapshotEvents()) {
    if (event.type !== 'assistant/message' || event.surfaceOp !== 'append') continue
    // Messages appended without an explicit id receive a derived identity; the
    // feedback service addresses exactly that derived id.
    const message = session.deriveEventMessage(event)
    if (message === null || message.role !== 'assistant' || typeof message.id !== 'string' || message.id === '') continue
    const preview = previewOf(message.content)
    if (preview === '') continue
    targets.push({ messageId: message.id, turn: event.data.turn, step: event.data.step, preview })
  }
  return targets.reverse()
}

function targetLabel(target: RateTarget): string {
  return `Turn ${target.turn} · Step ${target.step}`
}

function ratingWord(rating: MessageFeedbackItem['rating']): string {
  return rating === 'positive' ? 'Positive' : 'Negative'
}

function failureText(error: { code: string; maxBytes?: number }): string {
  switch (error.code) {
    case 'session-not-found': return 'This session is not persisted yet; reply feedback needs a saved session.'
    case 'target-not-found': return 'That reply cannot take feedback; only finalized assistant messages can.'
    case 'note-blank': return 'The note is blank; leave it empty to skip it.'
    case 'note-too-large': return `The note is too long (at most ${error.maxBytes ?? 0} bytes).`
    case 'version-conflict': return 'Feedback changed elsewhere in the meantime; run /rate again.'
    default: return `Feedback was not recorded (${error.code}).`
  }
}

async function existingItems(ctx: Context, invocation: CommandInvocation): Promise<Map<string, MessageFeedbackItem>> {
  const listed = await ctx.messageFeedback.list({ sessionId: invocation.agent.session.id })
  if (!listed.ok) throw new Error(failureText(listed.error))
  return new Map(listed.value.items.map(item => [String(item.messageId), item]))
}

async function record(ctx: Context, invocation: CommandInvocation, target: RateTarget): Promise<CommandResult> {
  const existing = (await existingItems(ctx, invocation)).get(String(target.messageId))
  const action = await ctx.tui.prompt({
    title: 'Reply feedback',
    question: `${targetLabel(target)} · ${existing === undefined ? 'not rated' : existing.rating}`,
    detail: target.preview,
    options: [
      { label: 'Positive', value: 'positive', description: 'This reply worked.' },
      { label: 'Negative', value: 'negative', description: 'Something about this reply needs attention.' },
      ...(existing === undefined ? [] : [{ label: 'Clear feedback', value: 'clear', description: 'Remove the stored rating.' }]),
    ],
    ...(existing === undefined ? {} : { initialValue: existing.rating }),
    allowCustom: false,
    notify: false,
    signal: invocation.signal,
  })
  invocation.signal.throwIfAborted()
  if (action === null) return { kind: 'success' }

  if (action === 'clear') {
    if (existing === undefined) return { kind: 'success', text: 'No feedback was stored for that reply.' }
    let deleted = await ctx.messageFeedback.delete({
      sessionId: invocation.agent.session.id,
      messageId: target.messageId,
      ifVersion: existing.version,
    })
    if (!deleted.ok && deleted.error.code === 'version-conflict') {
      deleted = await ctx.messageFeedback.delete({
        sessionId: invocation.agent.session.id,
        messageId: target.messageId,
        ifVersion: deleted.error.current?.version ?? existing.version,
      })
    }
    if (!deleted.ok) return { kind: 'error', text: failureText(deleted.error) }
    return { kind: 'success', text: `Feedback cleared for ${targetLabel(target)}.` }
  }

  const rating = action === 'negative' ? 'negative' : 'positive'
  let category: FeedbackCategory | undefined
  if (rating === 'negative') {
    const chosen = await ctx.tui.prompt({
      title: 'Reply feedback',
      question: 'What went wrong?',
      options: [
        ...RATE_CATEGORIES.map(item => ({ label: item.label, value: item.value, description: item.description })),
        { label: 'No category', value: '', description: 'Record the judgment without a category.' },
      ],
      ...(existing?.category === undefined ? {} : { initialValue: existing.category }),
      allowCustom: false,
      notify: false,
      signal: invocation.signal,
    })
    invocation.signal.throwIfAborted()
    if (chosen === null) return { kind: 'success' }
    category = chosen === '' ? undefined : chosen as FeedbackCategory
  }

  const note = await ctx.tui.prompt({
    title: 'Reply feedback',
    question: 'Add an optional note',
    detail: 'Enter submits; empty omits the note. The note is stored locally and never sent to the model.',
    ...(existing?.note === undefined ? {} : { initialInput: existing.note }),
    allowCustom: true,
    notify: false,
    signal: invocation.signal,
  })
  invocation.signal.throwIfAborted()
  if (note === null) return { kind: 'success' }
  const trimmed = note.trim() === '' ? undefined : note

  const request: PutRequest = {
    sessionId: invocation.agent.session.id,
    messageId: target.messageId,
    rating,
    ...(trimmed === undefined ? {} : { note: trimmed }),
    ...(category === undefined ? {} : { category }),
    ifVersion: existing?.version ?? null,
  }
  let result = await ctx.messageFeedback.put(request)
  if (!result.ok && result.error.code === 'version-conflict') {
    result = await ctx.messageFeedback.put({ ...request, ifVersion: result.error.current?.version ?? null })
  }
  if (!result.ok) return { kind: 'error', text: failureText(result.error) }
  const detail = [
    ratingWord(result.value.rating).toLowerCase(),
    result.value.category,
  ].filter(part => part !== undefined).join(' · ')
  return { kind: 'success', text: `Feedback recorded for ${targetLabel(target)}: ${detail}.` }
}

export async function rateCommand(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /rate' }
  const targets = rateTargets(invocation.agent.session)
  if (targets.length === 0) return { kind: 'success', text: 'No finalized assistant replies in this session yet.' }
  const ratings = await existingItems(ctx, invocation)
  const selected = await ctx.tui.prompt({
    title: 'Rate a reply',
    question: targets.length === 1 ? 'Choose the assistant reply' : `Choose one of ${targets.length} assistant replies`,
    presentation: 'fullscreen-list',
    filterable: true,
    allowCustom: false,
    notify: false,
    signal: invocation.signal,
    options: targets.map(target => {
      const item = ratings.get(String(target.messageId))
      return {
        label: targetLabel(target),
        value: String(target.messageId),
        description: `${item === undefined ? '' : `${ratingWord(item.rating)} · `}${target.preview}`,
      }
    }),
  })
  invocation.signal.throwIfAborted()
  if (selected === null) return { kind: 'success' }
  const target = targets.find(candidate => String(candidate.messageId) === selected)
  if (target === undefined) return { kind: 'error', text: 'That reply is no longer available.' }
  return record(ctx, invocation, target)
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [
    {
      name: 'rate',
      description: 'Rate a finalized assistant reply',
      handler: async invocation => {
        try {
          return await rateCommand(ctx, invocation)
        } catch (error) {
          if (invocation.signal.aborted) return { kind: 'error', text: 'Feedback cancelled.' }
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
        }
      },
    },
  ], 'omdsh rate command')
}
