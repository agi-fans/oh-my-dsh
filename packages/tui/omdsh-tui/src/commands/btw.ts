/** Side-question reader over the consultation service; the main session stays active. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import type {} from '../runtime/session-runtime.ts'
import type {} from '../runtime/btw.ts'
import { registerCommands } from './registration.ts'
import { cancellable } from '../runtime/cancellable.ts'
import { formatTokens } from '../chrome/status-line.ts'
import { askPrompt, choosePrompt } from '../prompt-intents.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'omdsh-btw': { kind: 'omdsh-btw' } & ContextFormed }
}

export const name = 'omdsh-command-btw'
export const inject = ['commands', 'tui', 'omdshSession', 'omdshBtw']

export async function sideQuestion(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const parent = invocation.agent
  ctx.omdshSession.assertActive(parent)
  let question = invocation.rawInput.trim(), topicId: string | undefined
  let detail = '', lastQuestion = question, lastReplyText = ''
  if (ctx.tui.interactive !== true && question === '') return { kind: 'error', text: 'Usage: /btw <question>' }
  try {
    for (;;) {
      if (question === '') {
        const topics = ctx.omdshBtw.list(parent)
        const selected = await ctx.tui.prompt({ title: 'Side questions', question: 'Choose a saved topic or ask a new question',
          presentation: 'fullscreen-list', filterable: true, allowCustom: false, notify: false, signal: invocation.signal, onSuperseded: () => {},
          options: [{ label: 'New side question', value: 'new', description: 'Use a fresh snapshot of this conversation' },
            ...topics.map(topic => ({ label: topic.question, value: topic.sessionId, description: topic.status }))] })
        if (selected === null) return { kind: 'success' }
        topicId = selected === 'new' ? undefined : selected
        if (topicId !== undefined) {
          lastQuestion = topics.find(topic => topic.sessionId === topicId)?.question ?? ''
          detail = await ctx.omdshBtw.read(parent, topicId, invocation.signal)
          lastReplyText = detail
          ctx.tui.commandOutput('btw', `${lastQuestion}\n\n${detail}`, { focus: true })
        } else {
          const answer = await ctx.tui.prompt({ title: 'Side question', question: 'What would you like to ask?',
            detail: 'Uses a committed conversation snapshot and the current model. No tools; billed separately.', allowCustom: true, notify: false, signal: invocation.signal, onSuperseded: () => {} })
          if (answer === null) return { kind: 'success' }
          question = answer
        }
      }
      if (question !== '') {
        lastQuestion = question
        /**
         * The answer is a transcript block, not a document that takes the screen.
         *
         * A side question is read *beside* the conversation it was asked from —
         * that is the whole point of asking it here rather than in the main turn.
         * Opening a full-screen reader for the wait and then a second one for the
         * answer moved the reader out of the interface they were using, twice, for
         * something that is not a different place but another row.
         *
         * The wait is the compact progress card the composer already shows for
         * long operations; the answer lands above the composer as a command
         * block, whose first line is the question.
         */
        const outcome = await cancellable(ctx.tui, {
          title: 'Side question',
          question,
          detail: 'Answering from the captured conversation. No tools; output stays outside the main context.',
          presentation: 'progress',
          surface: ctx.tui.interactive === true,
        }, invocation.signal, signal => ctx.omdshBtw.consult(
          parent, question, ctx.omdshSession.selection(parent), signal,
          text => { detail = text }, topicId,
        ))
        // Cancelled or superseded: the answer never completed, so nothing is
        // recorded and the loop returns to the reading surface it came from.
        if (outcome === undefined || outcome.reason !== undefined) return { kind: 'success' }
        const reply = outcome.value
        topicId = reply.topic.sessionId
        lastReplyText = `${reply.text}${reply.error === undefined ? '' : '\n\n' + reply.error}`.trim()
        detail = `${reply.text}${reply.error === undefined ? '' : '\n\n' + reply.error}`
          + `\n\n${reply.topic.status} · ${reply.usage === undefined ? 'Usage unavailable' : formatTokens(reply.usage.totalTokens) + ' tokens'} · Separate session: ${topicId}`
        if (ctx.tui.interactive !== true) return { kind: reply.error === undefined ? 'success' : 'error', text: detail }
        ctx.tui.commandOutput('btw', `${lastQuestion}\n\n${detail}`, { focus: true })
        question = ''
      }
      const action = await ctx.tui.prompt(choosePrompt({
        title: 'Side question',
        question: lastQuestion === '' ? 'What next?' : lastQuestion,
        options: [
          { label: 'Follow-up', value: 'followup' },
          { label: 'Share to conversation', value: 'share' },
          ...(ctx.tui.insertText === undefined ? [] : [{ label: 'Quote to composer', value: 'quote' }]),
          { label: 'Topics', value: 'topics' },
          { label: 'Back to conversation', value: 'back' },
        ],
        signal: invocation.signal,
      }))
      if (action === null || action === 'back') return { kind: 'success' }
      if (action === 'share') {
        const body = (lastReplyText || detail).trim()
        if (body !== '') {
          // Rendered from the injection below, so a resumed session still shows
          // the note the model was told about.
          try {
            parent.inject?.(createUserMessage({
              source: { kind: 'omdsh-btw', form: 'notice', summary: 'Side question note.' },
              content: [{
                type: 'text',
                text: `The user shared a side-question note${lastQuestion === '' ? '' : ` (${lastQuestion})`}:\n\n${body}`,
              }],
            }))
          } catch { /* ignore when session does not support injection */ }
          ctx.tui.notice?.('Shared side answer to conversation.')
        }
        return { kind: 'success' }
      }
      if (action === 'quote') {
        const body = (lastReplyText || detail).trim()
        if (body !== '') {
          ctx.tui.insertText?.(body)
          ctx.tui.notice?.('Quoted side answer in composer.')
        }
        return { kind: 'success' }
      }
      if (action === 'topics') { topicId = undefined; continue }
      const answer = await ctx.tui.prompt(askPrompt({
        title: 'Follow-up',
        question: 'Continue this topic’s fixed snapshot',
        signal: invocation.signal,
      }))
      if (answer === null) return { kind: 'success' }
      question = answer
    }
  } catch (error) {
    return invocation.signal.aborted ? { kind: 'success' } : { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

export function apply(ctx: Context): void {
  const closing = new AbortController()
  registerCommands(ctx, [{ name: 'btw', description: 'Ask a separate question from a fixed conversation snapshot', input: { hint: '[question]' },
    handler: invocation => sideQuestion(ctx, { ...invocation, signal: AbortSignal.any([invocation.signal, closing.signal]) }) }], 'side-question command')
  ctx.effect(() => () => { closing.abort() })
}
