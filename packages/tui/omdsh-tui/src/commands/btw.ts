/** Side-question reader over the consultation service; the main session stays active. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type {} from '../runtime/session-runtime.ts'
import type {} from '../runtime/btw.ts'
import { registerCommands } from './registration.ts'
import { formatTokens } from '../chrome/status-line.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'omdsh-btw': { kind: 'omdsh-btw' } & ContextFormed }
}

export const name = 'omdsh-command-btw'
export const inject = ['commands', 'tui', 'omdshSession', 'omdshBtw']

/**
 * A side question: type it after the command, press Enter, read the answer.
 *
 * Everything else this command used to do was a surface around that sentence — a
 * topic library to choose from, a text prompt to collect the question, a progress
 * card to wait behind, and a five-item menu to dismiss afterwards. Those are not
 * steps of asking a question; they are places to leave the conversation.
 *
 * The answer streams into its own transcript block while the consultation runs,
 * so the reader watches it arrive where it will stay. Esc interrupts it the same
 * way it interrupts a turn.
 */
export async function sideQuestion(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const parent = invocation.agent
  ctx.omdshSession.assertActive(parent)
  const question = invocation.rawInput.trim()
  // Nothing to ask yet, so say how: a prompt here would be a second way to ask
  // the same command, and the reader would have to learn both.
  if (question === '') return { kind: 'error', text: 'Usage: /btw <your question>' }
  const consult = (onUpdate: (text: string) => void, signal: AbortSignal) => ctx.omdshBtw.consult(
    parent, question, ctx.omdshSession.selection(parent), signal, onUpdate,
  ).then(reply => {
    // The settled reply usually carries everything; when it does not, the streamed
    // text is what the reader already watched arrive.
    const body = reply.text.trim()
    return {
      text: `${body}${reply.error === undefined ? '' : (body === '' ? '' : '\n\n') + reply.error}`,
      detail: `${reply.topic.status} · ${reply.usage === undefined ? 'Usage unavailable' : formatTokens(reply.usage.totalTokens) + ' tokens'}`
        // The id is the reader's only handle on the aside: `/resume` opens it.
        + ` · Separate session: ${reply.topic.sessionId}`,
      failed: reply.error !== undefined,
    }
  })
  try {
    if (ctx.tui.interactive === true && ctx.tui.asideQuestion !== undefined) {
      await ctx.tui.asideQuestion({ question, run: consult, signal: invocation.signal })
      return { kind: 'success' }
    }
    // A pipe has no block to stream into, so it answers once.
    let streamed = ''
    const reply = await consult(text => { streamed = text }, invocation.signal)
    const text = `${question}\n\n${reply.text === '' ? streamed : reply.text}${reply.detail === '' ? '' : '\n\n' + reply.detail}`
    return { kind: reply.failed === true ? 'error' : 'success', text }
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
