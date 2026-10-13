/** Explicit human consultation with independently attributed native advice. */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { TuiAdvisor } from '../definition.ts'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-advisor'
export const inject = ['commands', 'tui', 'advisor']

export async function requestAdvice(ctx: Context, invocation: CommandInvocation, signal = invocation.signal): Promise<CommandResult> {
  const match = /^(codex|claude)\s+([\s\S]+)$/u.exec(invocation.rawInput.trim())
  let provider: TuiAdvisor, question: string, context = ''
  if (match !== null) { provider = match[1] as TuiAdvisor; question = match[2]! }
  else {
    if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /advisor [codex|claude <question>]' }
    if (ctx.tui.interactive !== true) return { kind: 'error', text: 'Usage: /advisor codex|claude <question>' }
    const selected = await ctx.tui.prompt({ title: 'Advisor', question: 'Choose an independent advisor', options: [{ label: 'Codex', value: 'codex' }, { label: 'Claude Code', value: 'claude' }], allowCustom: false, notify: false, signal })
    if (selected !== 'codex' && selected !== 'claude') return { kind: 'success' }
    provider = selected
    const input = await ctx.tui.prompt({ title: 'Advisor', question: 'Question', allowCustom: true, notify: false, signal })
    if (input === null || signal.aborted) return { kind: 'success' }
    question = input
    const excerpt = await ctx.tui.prompt({ title: 'Advisor context', question: 'Optional code, diff, or analysis', detail: 'Only this text and your question are sent. No conversation history or automatic file reads.', options: [{ label: 'No additional context', value: 'none' }], allowCustom: true, notify: false, signal })
    if (excerpt === null || signal.aborted) return { kind: 'success' }
    context = excerpt === 'none' ? '' : excerpt
  }
  if (ctx.tui.interactive === true) {
    const consent = await ctx.tui.prompt({ title: `Consult ${provider}`, question,
      detail: `${context.length} context characters. This sends the question and context to the native provider and incurs model charges. The advisor cannot write to this workspace. Its opinion appears here for you to evaluate; it is not automatically adopted by the primary agent.`,
      options: [{ label: 'Consult', value: 'consult' }], allowCustom: false, notify: false, signal })
    if (consent !== 'consult' || signal.aborted) return { kind: 'success' }
  }
  const cancellation = new AbortController(), finished = new AbortController()
  const combined = AbortSignal.any([signal, cancellation.signal])
  const pending = ctx.tui.interactive === true ? ctx.tui.prompt({ title: `Consulting ${provider}`, question, detail: 'Enter or Esc cancels and waits for native process cleanup.', options: [{ label: 'Cancel', value: 'cancel' }], allowCustom: false, notify: false,
    signal: AbortSignal.any([signal, finished.signal]) }).then(() => { if (!finished.signal.aborted) cancellation.abort() }, () => { cancellation.abort() }) : Promise.resolve()
  try {
    const advice = await ctx.advisor.consult(invocation.agent, provider, question, context, combined)
    combined.throwIfAborted()
    ctx.tui.commandOutput('advisor', `## Independent advice · ${advice.provider}\n\n${advice.question}\n\n${advice.opinion}${advice.truncated ? '\n\n[Opinion truncated]' : ''}`, { focus: true })
    return { kind: 'success' }
  } catch (error) {
    return combined.aborted ? { kind: 'success', text: 'Advice cancelled.' } : { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  } finally { finished.abort(); await pending }
}

export function apply(ctx: Context): void {
  const closing = new AbortController()
  registerCommands(ctx, [{ name: 'advisor', description: 'Consult Codex or Claude Code for an independent opinion', handler: invocation => requestAdvice(ctx, invocation, AbortSignal.any([invocation.signal, closing.signal])) }], 'omdsh advisor command')
  ctx.effect(() => () => { closing.abort() })
}
