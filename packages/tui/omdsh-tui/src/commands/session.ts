/** Session lifecycle and inspection commands registered through dsh-commands. */

import type { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionSearchHit } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-tool-todo'
import type {} from '../runtime/session-runtime.ts'
import { registerCommands } from './registration.ts'
import { formatRelativeAge } from '../chrome/relative-time.ts'
import { formatPermission, formatTokens } from '../chrome/status-line.ts'
import { formatAgentPreset } from '../session/session-configuration.ts'
import { readPinnedSessions, sortSessionRows, togglePinnedSession, writePinnedSessions } from '../session/session-library.ts'
import { contextDiagnosticsMarkdown } from '../session/context-diagnostics.ts'

export const name = 'omdsh-command-session'
export const inject = ['commands', 'omdshSession', 'tui']

/** Cross-session search page size shown in one Session Library prompt. */
const SESSION_SEARCH_LIMIT = 20

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
    const dshHome = process.env.OMDSH_HOME ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
    const pinsPath = join(dshHome, 'omdsh', 'session-library.json')
    let pinned = readPinnedSessions(pinsPath)
    while (id === '') {
      const recent = sortSessionRows(ctx.omdshSession.recentSessions, pinned)
      if (recent.length === 0) return { kind: 'success', text: 'No durable sessions found.' }
      const answer = await ctx.tui.prompt({
        title: 'Session Library',
        question: '',
        // Filtering can empty the list even when the library is not empty.
        emptyText: 'No sessions found.',
        options: recent.map(row => ({
          label: `${pinned.includes(row.id) ? '◆ ' : ''}${row.title}`,
          value: row.id,
          ...(row.preview === undefined ? {} : { preview: row.preview }),
          description: [
            ...(pinned.includes(row.id) ? ['pinned'] : []),
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
        actions: [
          { key: 'r', label: 'rename', valuePrefix: 'rename:' },
          { key: 'p', label: 'pin/unpin', valuePrefix: 'pin:' },
        ],
        presentation: 'fullscreen-list',
        filterable: true,
        allowCustom: false,
        signal: invocation.signal,
      })
      if (answer === null) return { kind: 'success' }
      if (answer.startsWith('pin:')) {
        pinned = togglePinnedSession(pinned, answer.slice('pin:'.length))
        writePinnedSessions(pinsPath, pinned)
        continue
      }
      if (answer.startsWith('rename:')) {
        const target = answer.slice('rename:'.length)
        const row = recent.find(item => item.id === target)
        if (row === undefined) continue
        const title = await ctx.tui.prompt({
          title: 'Rename Session',
          question: `New title for “${row.title}”`,
          allowCustom: true,
          signal: invocation.signal,
        })
        if (title !== null) await ctx.omdshSession.renameSession(invocation.agent, target, title, invocation.signal)
        continue
      }
      id = answer
    }
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

/** Search every durable session by content, then resume the chosen hit. */
async function searchSessions(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.agent.status === 'running') {
    return { kind: 'error', text: 'Finish or interrupt the active turn before resuming another session.' }
  }
  const query = invocation.rawInput.trim()
  const sessionQuery = ctx.get('sessionQuery')
  if (sessionQuery === undefined) return { kind: 'error', text: 'Session search is not configured.' }
  let hits: readonly SessionSearchHit[]
  try {
    const page = await sessionQuery.searchSessions({ query, limit: SESSION_SEARCH_LIMIT }, { signal: invocation.signal })
    hits = page.items
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Search cancelled.' }
    return { kind: 'error', text: 'Session search failed: ' + (error instanceof Error ? error.message : String(error)) }
  }
  if (hits.length === 0) return { kind: 'success', text: `No sessions match “${query}”.` }
  const titles = new Map<string, string>()
  try {
    for (const result of await sessionQuery.readTitleSnapshots(hits.map(hit => hit.header.id), invocation.signal)) {
      if (result.status === 'fulfilled' && result.value.title !== undefined) {
        titles.set(result.sessionId, result.value.title.title)
      }
    }
  } catch { /* title folding is best-effort; the snippet still identifies the hit */ }
  const answer = await ctx.tui.prompt({
    title: 'Session Search',
    question: '',
    emptyText: 'No session content matched.',
    options: hits.map(hit => ({
      label: titles.get(hit.header.id) ?? hit.bestMatch.snippet,
      value: hit.header.id,
      preview: hit.bestMatch.snippet,
      description: formatRelativeAge(hit.header.createdAt),
    })),
    presentation: 'fullscreen-list',
    filterable: false,
    allowCustom: false,
    signal: invocation.signal,
  })
  if (answer === null) return { kind: 'success' }
  if (answer === invocation.agent.id) return { kind: 'success', text: 'That session is already active.' }
  try {
    await ctx.omdshSession.resumeSession(invocation.agent, answer, invocation.signal)
    return { kind: 'success', text: `Resumed ${answer}.` }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Resume cancelled.' }
    return { kind: 'error', text: 'Resume failed: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

/** `/sessions` opens the library bare, or searches session content when given a query. */
function sessionsCommand(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  return invocation.rawInput.trim() === ''
    ? resumeSession(ctx, invocation)
    : searchSessions(ctx, invocation)
}

function showSession(ctx: Context, invocation: CommandInvocation): CommandResult {
  const stats = ctx.omdshSession.stats(invocation.agent)
  const selection = ctx.omdshSession.selection(invocation.agent)
  const reasoningEffort = ctx.omdshSession.reasoningEffort(invocation.agent)
  const controls = ctx.omdshSession.controls(invocation.agent)
  const workflow = controls.plan?.pending === true
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
      `| Agent | ${formatAgentPreset(controls.agentPreset ?? 'standard')} |`,
      `| Workflow | ${workflow} |`,
      ...(controls.permission === undefined ? [] : [`| Access | ${formatPermission(controls.permission)} |`]),
      `| Activity | ${stats.turns} turns · ${stats.steps} steps |`,
      `| Tokens | ${formatTokens(stats.inputTokens)} in · ${formatTokens(stats.outputTokens)} out |`,
      `| Queue | ${invocation.agent.inbox.nextTurn.length} follow-up · ${invocation.agent.inbox.nextStep.length} steering |`,
    ].join('\n'),
  }
}

async function retry(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /retry' }
  const log = invocation.agent.session.snapshotEvents()
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const text = humanText(log[i] as SessionEvent)
    if (text === undefined) continue
    await ctx.omdshSession.send(text, invocation.agent)
    return { kind: 'success', text: 'Re-running the most recent human prompt as a new turn.' }
  }
  return { kind: 'success', text: 'No human prompt is available to retry.' }
}

function showContext(ctx: Context, invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /context' }
  return {
    kind: 'success',
    text: contextDiagnosticsMarkdown(ctx.omdshSession.contextDiagnostics(invocation.agent)),
  }
}

function showTodo(invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /todo' }
  const event = invocation.agent.session.snapshotEvents().findLast(item => item.type === 'todo/write')
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
    { name: 'context', description: 'Inspect projection-backed context usage', handler: invocation => showContext(ctx, invocation) },
    { name: 'new', description: 'Start a new session', handler: invocation => newSession(ctx, invocation) },
    {
      name: 'resume',
      description: 'Resume a durable session',
      input: { hint: '[session-id]' },
      handler: invocation => resumeSession(ctx, invocation),
    },
    {
      name: 'sessions',
      description: 'Open the Session Library, or search session content with a query',
      input: { hint: '[query]' },
      handler: invocation => sessionsCommand(ctx, invocation),
    },
    { name: 'session', description: 'Show current session details', handler: invocation => showSession(ctx, invocation) },
    { name: 'retry', description: 'Run the most recent human prompt again', handler: invocation => retry(ctx, invocation) },
    { name: 'todo', description: 'Show the current session todo list', handler: showTodo },
  ], 'omdsh session commands')
}
