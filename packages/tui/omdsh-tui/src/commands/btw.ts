/** Side-question reader over the consultation service; the main session stays active. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type {} from '../runtime/session-runtime.ts'
import type {} from '../runtime/btw.ts'
import { registerCommands } from './registration.ts'
import { cancellable } from '../runtime/cancellable.ts'
import { formatTokens } from '../chrome/status-line.ts'
import { askPrompt } from '../prompt-intents.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'omdsh-btw': { kind: 'omdsh-btw' } & ContextFormed }
}

export const name = 'omdsh-command-btw'
export const inject = ['commands', 'tui', 'omdshSession', 'omdshBtw']

/**
 * A side question: ask without leaving the conversation.
 *
 * There used to be a topic library, a continuation loop, and a five-item menu
 * after every answer — three surfaces around one act that other agents express
 * with a changed composer border and a tinted row. Each of them was a place the
 * reader had to leave the conversation to look at something that belonged in it.
 *
 * What is left: the question, the wait, the answer. The answer is a tinted
 * transcript block, so it reads as an aside at a glance and needs no menu to
 * explain itself. Sharing it back to the model is an ordinary action the reader
 * already has — quoting it into the composer — rather than a fourth surface.
 */
export async function sideQuestion(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const parent = invocation.agent
  ctx.omdshSession.assertActive(parent)
  let question = invocation.rawInput.trim()
  if (question === '') {
    if (ctx.tui.interactive !== true) return { kind: 'error', text: 'Usage: /btw <question>' }
    const answer = await ctx.tui.prompt(askPrompt({
      title: 'Side question',
      question: 'What would you like to ask?',
      detail: 'Uses a committed conversation snapshot and the current model. No tools; billed separately.',
      signal: invocation.signal,
    }))
    if (answer === null || answer.trim() === '' || invocation.signal.aborted) return { kind: 'success' }
    question = answer.trim()
  }
  try {
    let detail = ''
    const outcome = await cancellable(ctx.tui, {
      title: 'Side question',
      question,
      detail: 'Answering from the captured conversation. No tools; output stays outside the main context.',
      presentation: 'progress',
      surface: ctx.tui.interactive === true,
    }, invocation.signal, signal => ctx.omdshBtw.consult(
      parent, question, ctx.omdshSession.selection(parent), signal,
      text => { detail = text },
    ))
    if (outcome === undefined || outcome.reason !== undefined) return { kind: 'success' }
    const reply = outcome.value
    // The settled reply normally carries everything; if it does not, the streamed
    // text is what the reader already saw arrive.
    const body = reply.text.trim() === '' ? detail.trim() : reply.text
    const text = `${body}${reply.error === undefined ? '' : '\n\n' + reply.error}`.trim()
      + `\n\n${reply.topic.status} · ${reply.usage === undefined ? 'Usage unavailable' : formatTokens(reply.usage.totalTokens) + ' tokens'}`
      // The id is the reader's only handle on the aside: `/resume` opens it.
      + ` · Separate session: ${reply.topic.sessionId}`
    if (ctx.tui.interactive !== true) return { kind: reply.error === undefined ? 'success' : 'error', text }
    // Question first, so the block names itself and needs no heading the reader
    // has to parse.
    ctx.tui.commandOutput('btw', `${question}\n\n${text}`, { focus: true, surface: 'aside' })
    return { kind: 'success' }
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
