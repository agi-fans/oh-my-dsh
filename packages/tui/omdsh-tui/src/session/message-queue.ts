/** Pending human input uses Harness inbox mutations and terminal-owned delivery entries. */
import type { Agent, InboxTarget } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { TuiPendingInputs, TuiPrompt, TuiService, TuiSubmission } from '../definition.ts'
import { truncateToWidth } from '../chrome/width.ts'
import { blocksText } from './content-text.ts'

export interface QueuedMessage {
  key: string
  id: string
  target: InboxTarget | 'delivery'
  text: string
  value: UserMessage | TuiSubmission
}

export function queuedMessages(agent: Agent, pending: TuiPendingInputs): QueuedMessage[] {
  return [
    ...(['next-step', 'next-turn'] as const).flatMap(target =>
      (target === 'next-step' ? agent.inbox.nextStep : agent.inbox.nextTurn)
        .filter(message => message.source.kind === 'user')
        .map(message => ({ key: `${target}:${message.id}`, id: message.id, target, text: blocksText(message.content), value: message }))),
    ...pending.list().map(({ id, submission }) => ({ key: `delivery:${id}`, id, target: 'delivery' as const, text: submission.text, value: submission })),
  ]
}

/** Swap adjacent human entries atomically; internal messages remain owned by their plugins. */
export function moveQueuedMessage(agent: Agent, target: InboxTarget, id: string, direction: -1 | 1): boolean {
  const messages = target === 'next-step' ? agent.inbox.nextStep : agent.inbox.nextTurn
  const humanIndices = messages.flatMap((message, at) => message.source.kind === 'user' ? [at] : [])
  const source = messages.findIndex(message => message.id === id && message.source.kind === 'user')
  const neighbor = humanIndices[humanIndices.indexOf(source) + direction]
  if (source < 0 || neighbor === undefined || Math.abs(source - neighbor) !== 1) return false
  const start = Math.min(source, neighbor)
  const end = Math.max(source, neighbor)
  const inserted = messages.slice(start, end + 1)
  const first = inserted[0]!
  inserted[0] = inserted[inserted.length - 1]!
  inserted[inserted.length - 1] = first
  agent.inbox.splice(target, start, inserted.length, inserted)
  return true
}

export function editedQueuedMessage(message: UserMessage, text: string): UserMessage {
  const attachments = message.content.filter(block => block.type !== 'text')
  if (text.trim() === '' && attachments.length === 0) throw new Error('Enter a message, or delete the queue entry.')
  const { id: _id, role: _role, ...input } = message
  return createUserMessage({ ...input, content: [...(text === '' ? [] : [{ type: 'text' as const, text }]), ...attachments] })
}

/** Text-only editing cannot retain the old text embedded in image-placement segments. */
function editedSubmission(original: TuiSubmission, text: string): TuiSubmission {
  if (text === original.text) return original
  const { segments: _segments, ...draft } = original
  return { ...draft, text }
}

function queueOptions(rows: readonly QueuedMessage[]): NonNullable<TuiPrompt['options']> {
  const ordinals = new Map<QueuedMessage['target'], number>()
  return rows.map(row => {
    const ordinal = (ordinals.get(row.target) ?? 0) + 1
    ordinals.set(row.target, ordinal)
    const label = row.target === 'next-step' ? 'Steer · next step' : row.target === 'next-turn' ? 'Queue · next turn' : 'Sending · not yet accepted'
    const submission = row.target === 'delivery' ? row.value as TuiSubmission : undefined
    const message = row.target === 'delivery' ? undefined : row.value as UserMessage
    const images = submission?.images.length ?? message?.content.filter(block => block.type === 'image').length ?? 0
    const files = submission?.files?.length ?? message?.content.filter(block => block.type === 'file').length ?? 0
    const attachments = [images > 0 ? `${images} image${images === 1 ? '' : 's'}` : '', files > 0 ? `${files} file${files === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
    return { badge: { label, tone: 'muted' }, label: `${ordinal} · ${truncateToWidth(row.text.replace(/\s+/gu, ' ').trim(), 120) || attachments || 'Empty message'}`, value: row.key,
      preview: row.text.length > 8192 ? row.text.slice(0, 8192) + '\n…' : row.text,
      description: attachments, submitLabel: 'edit' }
  })
}

export async function openMessageQueue(options: {
  agent: Agent
  tui: Pick<TuiService, 'prompt' | 'notice' | 'restoreInput' | 'pendingInputs'>
  signal: AbortSignal
  ownerLabel?: string
  assertActive(): void
  restore(message: UserMessage): Promise<TuiSubmission>
}): Promise<void> {
  const { agent, tui, signal, assertActive, restore } = options
  const check = (): void => { signal.throwIfAborted(); assertActive() }
  let selected: string | undefined
  let superseded = false
  while (!signal.aborted) {
    check()
    let rows: QueuedMessage[] = []
    let choices: NonNullable<TuiPrompt['options']> = []
    const refresh = (): NonNullable<TuiPrompt['options']> => {
      check()
      const next = queuedMessages(agent, tui.pendingInputs)
      if (next.length !== rows.length || next.some((row, at) => row.key !== rows[at]?.key || row.value !== rows[at]?.value)) {
        rows = next; choices = queueOptions(rows)
      }
      return choices
    }
    const answer = await tui.prompt({ title: 'Message Queue',
      ...(options.ownerLabel === undefined ? {} : { detail: options.ownerLabel }), question: 'Steer: next step · Queue: next turn · Sending: not yet accepted.',
      localize: ['title', 'question', 'actions'],
      notify: false, onSuperseded: () => { superseded = true }, options: refresh(), refreshOptions: refresh, presentation: 'card', filterable: true, allowCustom: false,
      ...(selected === undefined ? {} : { initialValue: selected }), emptyText: 'No pending messages.', submitLabel: 'edit', signal,
      actions: [{ key: 'Alt+S', label: 'steer next step', valuePrefix: 'steer:' }, { key: 'Alt+D', label: 'withdraw', valuePrefix: 'delete:' }, { key: 'Alt+Up', label: 'move earlier', valuePrefix: 'up:' }, { key: 'Alt+Down', label: 'move later', valuePrefix: 'down:' }] })
    if (answer === null) return
    check()
    const action = /^(steer|delete|up|down):/u.exec(answer)?.[1]
    const key = action === undefined ? answer : answer.slice(action.length + 1)
    const row = queuedMessages(agent, tui.pendingInputs).find(item => item.key === key)
    if (row === undefined) { tui.notice('That message is no longer pending.'); continue }
    selected = key
    let editDraft: TuiSubmission | undefined
    try {
      if (action === 'steer') {
        if (row.target !== 'next-turn') {
          tui.notice('Select an accepted Queue message to steer.')
          continue
        }
        if (agent.status !== 'running') {
          tui.notice('Steering needs an active turn. The message stays queued.')
          continue
        }
        const message = row.value as UserMessage
        // Rehydrate before withdrawing so even a failed rollback can retain the complete input.
        const draft = { ...await restore(message), literal: true }
        check()
        const index = agent.inbox.nextTurn.findIndex(item => item.id === message.id && item === message)
        if (index < 0) { tui.notice('That message is no longer pending.'); continue }
        if (agent.status !== 'running') {
          tui.notice('Steering needs an active turn. The message stays queued.')
          continue
        }
        const offset = agent.session.snapshotEvents().length
        try {
          if (!agent.inbox.remove(message.id)) { tui.notice('That message is no longer pending.'); continue }
          check()
          if (agent.status !== 'running') throw new Error('Steering needs an active turn. The message stays queued.')
          agent.steer(message)
        } catch (error) {
          // A subscriber can throw after the append committed. Never queue an accepted message twice.
          const accepted = agent.session.snapshotEvents().slice(offset).some(event =>
            event.type === 'agent/inbox/spliced' && event.data.inserted.some(item => item.id === message.id))
          const pending = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(item => item.id === message.id)
          if (!accepted && !pending) {
            try { agent.inbox.splice('next-turn', index, 0, [message]) }
            catch {
              if (!agent.inbox.nextTurn.some(item => item.id === message.id)) {
                tui.restoreInput(draft)
                tui.notice('Could not steer or restore the queue entry. The message and attachments are now an unsent draft.', { level: 'error' })
                return
              }
            }
          }
          throw error
        }
        selected = `next-step:${message.id}`
        continue
      }
      if (action === 'up' || action === 'down') {
        const direction = action === 'up' ? -1 : 1
        if (row.target === 'delivery') tui.pendingInputs.update(row.id, { kind: 'move', direction })
        else if (!moveQueuedMessage(agent, row.target, row.id, direction)) {
          const group = queuedMessages(agent, tui.pendingInputs).filter(item => item.target === row.target)
          const at = group.findIndex(item => item.key === row.key)
          if (at >= 0 && group[at + direction] !== undefined) tui.notice('These entries cannot move across a system-owned queue message.')
        }
        continue
      }
      if (action === 'delete') {
        const removed = row.target === 'delivery' ? tui.pendingInputs.update(row.id, { kind: 'remove' }) : agent.inbox.remove((row.value as UserMessage).id)
        if (!removed) tui.notice('That message is no longer pending.')
        continue
      }
      // Rehydrate first so a raced edit can return intact to the composer; never withdraw an item while reading images.
      const original = row.target === 'delivery' ? row.value as TuiSubmission : { ...await restore(row.value as UserMessage), literal: true }
      check()
      if (!queuedMessages(agent, tui.pendingInputs).some(item => item.key === row.key && item.value === row.value)) { tui.notice('That message is no longer pending.'); continue }
      const text = await tui.prompt({ title: 'Edit Queued Message', localize: ['title', 'question'],
        ...(options.ownerLabel === undefined ? {} : { detail: options.ownerLabel }), question: 'Enter saves · Alt+Enter inserts a line · Esc cancels. Images and files are kept.',
        notify: false, initialInput: row.text, preserveWhitespace: true, allowCustom: true, signal,
        onCancelDraft: input => {
          // Session replacement aborts before changing draft scope. Rescue into the old session only.
          if (signal.aborted && input !== row.text) tui.restoreInput(editedSubmission(original, input))
        },
        onSuperseded: input => {
          superseded = true
          if (input !== row.text) {
            tui.restoreInput(editedSubmission(original, input))
            tui.notice('Queue closed for a request for input. Your edit is an unsent draft; the queued message is unchanged.')
          }
        } })
      if (text === null) { if (superseded) return; continue }
      const draft = editedSubmission(original, text)
      editDraft = draft
      check()
      let replaced: boolean
      if (row.target === 'delivery') {
        if (text.trim() === '' && draft.images.length === 0 && !draft.files?.length) throw new Error('Enter a message, or delete the queue entry.')
        replaced = tui.pendingInputs.update(row.id, { kind: 'replace', submission: draft })
      } else {
        const replacement = editedQueuedMessage(row.value as UserMessage, text)
        replaced = agent.inbox.replace((row.value as UserMessage).id, replacement)
        if (replaced) selected = `${row.target}:${replacement.id}`
      }
      if (!replaced) {
        tui.restoreInput(draft)
        tui.notice('The message was already taken. Your edit is restored as an unsent draft.')
        return
      }
    } catch (error) {
      if (editDraft !== undefined) {
        tui.restoreInput(editDraft)
        if (!signal.aborted) tui.notice(`Could not save the queue edit; it is restored as an unsent draft. ${error instanceof Error ? error.message : String(error)}`, { level: 'error' })
        return
      }
      if (signal.aborted) throw error
      assertActive()
      tui.notice(error instanceof Error ? error.message : String(error), { level: 'error' })
    }
  }
}
