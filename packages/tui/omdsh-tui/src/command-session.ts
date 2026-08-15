/** Session lifecycle and inspection commands registered through dsh-commands. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from './session-runtime.ts'
import { registerCommands } from './command-registration.ts'
import { formatRelativeAge } from './relative-time.ts'

export const name = 'omdsh-command-session'
export const inject = ['commands', 'omdshSession', 'tui']

function humanText(event: SessionEvent): string | undefined {
  if (event.type !== 'user/message' || event.data.source.kind !== 'user') return undefined
  const text = event.data.content
    .filter((block): block is Extract<(typeof event.data.content)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  return text === '' ? undefined : text
}

async function newSession(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /new' }
  if (invocation.agent.status === 'running') {
    return { kind: 'error', text: 'Finish or interrupt the active turn before starting a new session.' }
  }
  await ctx.omdshSession.newSession(invocation.agent)
  return { kind: 'success', text: 'Started a new session.' }
}

async function resumeSession(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (ctx.get('sessionPersistence') === undefined) return { kind: 'error', text: 'Session persistence is not configured.' }
  if (invocation.agent.status === 'running') {
    return { kind: 'error', text: 'Finish or interrupt the active turn before resuming another session.' }
  }
  await ctx.omdshSession.refreshRecent()
  let id = invocation.rawInput.trim()
  if (id === '') {
    const recent = ctx.omdshSession.recentSessions
    if (recent.length === 0) return { kind: 'success', text: 'No durable sessions found.' }
    const answer = await ctx.tui.prompt({
      title: 'Resume Session',
      question: '',
      options: recent.map(row => ({
        label: row.title,
        value: row.id,
        ...(row.preview === undefined ? {} : { preview: row.preview }),
        description: [
          formatRelativeAge(row.updatedAt ?? row.createdAt),
          ...(row.eventCount === undefined ? [] : [`${row.eventCount} events`]),
        ].join(' · '),
        ...(row.status === undefined
          ? {}
          : {
              badge: {
                label: row.status,
                tone: row.status === 'done'
                  ? 'success' as const
                  : row.status === 'failed'
                    ? 'error' as const
                    : 'warning' as const,
              },
            }),
      })),
      presentation: 'fullscreen-list',
      filterable: true,
      allowCustom: false,
      signal: invocation.signal,
    })
    if (answer === null) return { kind: 'success' }
    const index = /^\d+$/u.test(answer) ? Number(answer) - 1 : -1
    id = index >= 0 ? (recent[index]?.id ?? answer) : answer
  }
  if (id === invocation.agent.id) return { kind: 'success', text: 'That session is already active.' }
  try {
    await ctx.omdshSession.resumeSession(invocation.agent, id, invocation.signal)
    return { kind: 'success', text: `Resumed ${id}.` }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Resume cancelled.' }
    return { kind: 'error', text: 'Resume failed: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

function showSession(ctx: Context, invocation: CommandInvocation): CommandResult {
  const stats = ctx.omdshSession.stats(invocation.agent)
  const selection = ctx.omdshSession.selection(invocation.agent)
  const reasoningEffort = ctx.omdshSession.reasoningEffort(invocation.agent)
  const controls = ctx.omdshSession.controls(invocation.agent)
  const mode = controls.plan?.pending === true
    ? controls.plan.active ? 'Plan → Default (pending)' : 'Plan (pending)'
    : controls.plan?.active === true ? 'Plan' : 'Default'
  return {
    kind: 'success',
    text: [
      'Session Details',
      '',
      '| Field | Value |',
      '|---|---|',
      `| Session | \`${invocation.agent.id}\` |`,
      `| Model | \`${selection.provider}/${selection.model}\` |`,
      `| Reasoning | \`${reasoningEffort ?? 'not available'}\` |`,
      `| Mode | ${mode} |`,
      ...(controls.permission === undefined ? [] : [`| Access mode | \`${controls.permission}\` |`]),
      `| Activity | ${stats.turns} turns · ${stats.steps} steps |`,
      `| Tokens | ${stats.inputTokens} in · ${stats.outputTokens} out |`,
      `| Queue | ${invocation.agent.inbox.nextTurn.length} follow-up · ${invocation.agent.inbox.nextStep.length} steering |`,
    ].join('\n'),
  }
}

async function retry(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /retry' }
  for (let i = invocation.agent.session.events.length - 1; i >= 0; i -= 1) {
    const text = humanText(invocation.agent.session.events[i] as SessionEvent)
    if (text === undefined) continue
    await ctx.omdshSession.send(text, invocation.agent)
    return { kind: 'success', text: 'Re-running the most recent human prompt as a new turn.' }
  }
  return { kind: 'success', text: 'No human prompt is available to retry.' }
}

function showTodo(invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /todo' }
  const event = invocation.agent.session.events.findLast(item => item.type === 'todo/write')
  if (event === undefined) return { kind: 'success', text: 'No todo list has been recorded.' }
  return {
    kind: 'success',
    text: [
      `Todo · ${event.data.todos.length} item${event.data.todos.length === 1 ? '' : 's'}`,
      '',
      ...event.data.todos.map((todo) => todo.status === 'completed'
        ? `- [x] ${todo.content}`
        : todo.status === 'in_progress'
          ? `- [ ] **In progress** · ${todo.content}`
          : `- [ ] ${todo.content}`),
    ].join('\n'),
  }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [
    { name: 'new', description: 'Start a new session', handler: invocation => newSession(ctx, invocation) },
    {
      name: 'resume',
      description: 'Resume a durable session',
      input: { hint: '[session-id]' },
      handler: invocation => resumeSession(ctx, invocation),
    },
    { name: 'session', description: 'Show current session details', handler: invocation => showSession(ctx, invocation) },
    { name: 'retry', description: 'Run the most recent human prompt again', handler: invocation => retry(ctx, invocation) },
    { name: 'todo', description: 'Show the current session todo list', handler: showTodo },
  ], 'omdsh session commands')
}
