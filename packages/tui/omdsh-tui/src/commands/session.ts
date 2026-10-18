/** Session lifecycle and inspection commands registered through dsh-commands. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { TuiRecentSession } from '../definition.ts'
import type { SessionSearchHit } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-tool-todo'
import type {} from '../runtime/session-runtime.ts'
import { registerCommands } from './registration.ts'
import { formatRelativeAge } from '../chrome/relative-time.ts'
import { formatPermission, formatTokens } from '../chrome/status-line.ts'
import { formatAgentPreset } from '../session/session-configuration.ts'
import { readSessionLibrary, sortSessionRows, togglePinnedSession, updateSessionLibrary } from '../session/session-library.ts'
import { contextDiagnosticsMarkdown } from '../session/context-diagnostics.ts'
import { blocksText } from '../session/content-text.ts'

export const name = 'omdsh-command-session'
export const inject = ['commands', 'omdshSession', 'tui']

/** Cross-session search page size shown in one Session Library prompt. */
const SESSION_SEARCH_LIMIT = 20

function humanText(event: SessionEvent): string | undefined {
  if (event.type !== 'user/message' || event.data.source.kind !== 'user') return undefined
  const text = blocksText(event.data.content)
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

async function resumeSession(ctx: Context, invocation: CommandInvocation, search?: { query: string; rows: readonly TuiRecentSession[] }): Promise<CommandResult> {
  if (ctx.get('sessionPersistence') === undefined) return { kind: 'error', text: 'Session persistence is not configured.' }
  if (invocation.agent.status === 'running') {
    return { kind: 'error', text: 'Finish or interrupt the active turn before resuming another session.' }
  }
  await ctx.omdshSession.refreshRecent()
  let id = search === undefined ? invocation.rawInput.trim() : ''
  if (id !== '' && search === undefined) {
    const stored = await ctx.get('sessionPersistence')?.stat(SessionId(id))
    if (stored === undefined) {
      // A non-session argument is a content query; the merged command opens
      // the same searchable library instead of failing an ID lookup.
      if (/^session-[0-9a-z-]+$/u.test(id)) return { kind: 'error', text: `Session ${id} was not found.` }
      const result = await findSessions(ctx, invocation)
      return result.kind === 'rows' ? resumeSession(ctx, invocation, result) : result
    }
  }
  if (id === '') {
    const libraryPath = ctx.omdshSession.sessionLibraryPath
    let archivedView = false
    let selectedId: string | undefined
    while (id === '') {
      const library = readSessionLibrary(libraryPath)
      const inventory = new Map(ctx.omdshSession.recentSessions.map(row => [row.id, row]))
      const source = search === undefined ? ctx.omdshSession.recentSessions : search.rows.map(row => ({ ...row, ...inventory.get(row.id), ...(row.preview === undefined ? {} : { preview: row.preview }) }))
      const recent = sortSessionRows(source.filter(row => library.archived.includes(row.id) === archivedView), library.pinned)
      if ((search?.rows ?? ctx.omdshSession.recentSessions).length === 0) return { kind: 'success', text: 'No durable sessions found.' }
      const answer = await ctx.tui.prompt({
        title: `Session Library${search === undefined ? '' : ' · Search'}${archivedView ? ' · Archived' : ''}`,
        ...(search === undefined ? {} : { detail: `Content search: ${search.query} · up to ${SESSION_SEARCH_LIMIT} matches` }),
        notify: false,
        ...(selectedId === undefined ? {} : { initialValue: selectedId }),
        question: '',
        // Filtering can empty the list even when the library is not empty.
        emptyText: archivedView ? 'No archived sessions. Alt+V returns to active sessions.' : 'No active sessions. Alt+V shows archived sessions.',
        options: recent.map(row => ({
          label: `${library.pinned.includes(row.id) ? '◆ ' : ''}${row.title}`,
          value: row.id,
          ...(row.preview === undefined ? {} : { preview: row.preview }),
          description: [
            ...(library.pinned.includes(row.id) ? ['pinned'] : []),
            formatRelativeAge(row.updatedAt ?? row.createdAt),
            ...(row.eventCount === undefined ? [] : [`${row.eventCount} events`]),
            ...(row.formatStatus === 'migration-required' ? ['migration required'] : []),
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
          ...(search === undefined ? [] : [{ key: 'Alt+L', label: 'all sessions', valuePrefix: 'library:', scope: 'list' as const }]),
          ...(ctx.get('sessionQuery') === undefined ? [] : [{ key: 'Alt+S', label: 'search content', valuePrefix: 'search:', scope: 'list' as const }]),
          { key: 'r', label: 'rename', valuePrefix: 'rename:' },
          { key: 'p', label: 'pin/unpin', valuePrefix: 'pin:' },
          { key: 'Alt+A', label: archivedView ? 'restore' : 'archive', valuePrefix: 'archive:' },
          { key: 'Alt+V', label: archivedView ? 'active sessions' : 'archived sessions', valuePrefix: 'view:', scope: 'list' },
        ],
        presentation: 'fullscreen-list',
        filterable: true,
        allowCustom: false,
        signal: invocation.signal,
      })
      if (answer === null) return { kind: 'success' }
      invocation.signal.throwIfAborted()
      if (answer === 'library:') { search = undefined; archivedView = false; selectedId = undefined; continue }
      if (answer === 'search:') {
        const query = await ctx.tui.prompt({ title: 'Search session content', question: 'Enter search text', allowCustom: true, notify: false, signal: invocation.signal })
        if (query === null || query.trim() === '') continue
        const result = await findSessions(ctx, { ...invocation, rawInput: query })
        if (result.kind === 'rows') { search = result; archivedView = false; selectedId = undefined; continue }
        if (result.text !== undefined) {
          await ctx.tui.prompt({ title: 'Session search', question: '', presentation: 'document', documentSource: { text: result.text, language: 'text' }, options: [{ label: 'Back to library', value: 'back' }], allowCustom: false, notify: false, signal: invocation.signal })
          continue
        }
        continue
      }
      if (answer === 'view:') { archivedView = !archivedView; continue }
      if (answer.startsWith('pin:') || answer.startsWith('archive:')) {
        const [action, ...parts] = answer.split(':')
        const target = parts.join(':')
        if (!recent.some(row => row.id === target)) continue
        selectedId = target
        updateSessionLibrary(libraryPath, current => action === 'pin'
          ? { ...current, pinned: togglePinnedSession(current.pinned, target) }
          : { ...current, archived: archivedView ? current.archived.filter(id => id !== target) : [...new Set([...current.archived, target])] })
        if (action === 'archive') await ctx.omdshSession.refreshRecent()
        continue
      }
      if (answer.startsWith('rename:')) {
        const target = answer.slice('rename:'.length)
        const row = recent.find(item => item.id === target)
        if (row === undefined) continue
        selectedId = target
        const title = await ctx.tui.prompt({
          title: 'Rename Session',
          question: `New title for “${row.title}”`,
          initialInput: row.title,
          allowCustom: true,
          notify: false,
          signal: invocation.signal,
        })
        if (title !== null) await ctx.omdshSession.renameSession(invocation.agent, target, title, invocation.signal)
        continue
      }
      id = answer
    }
  }
  if (id === invocation.agent.id) return { kind: 'success', text: 'That session is already active.' }
  return resumeStoredSession(ctx, invocation, id)
}

async function resumeStoredSession(ctx: Context, invocation: CommandInvocation, id: string): Promise<CommandResult> {
  try {
    const stored = await ctx.get('sessionPersistence')?.stat(SessionId(id))
    if (stored?.formatStatus === 'migration-required' && ctx.tui.interactive === true) {
      const answer = await ctx.tui.prompt({ title: 'Migrate session', question: ctx.omdshSession.recentSessions.find(row => row.id === id)?.title ?? id,
        detail: 'Opening this session writes a current-format generation and retains the historical source. Browsing the Session Library does not migrate it.',
        options: [{ label: 'Migrate and resume', value: 'resume' }], allowCustom: false, signal: invocation.signal, notify: false })
      if (answer !== 'resume' || invocation.signal.aborted) return { kind: 'success' }
    }
    await ctx.omdshSession.resumeSession(invocation.agent, id, invocation.signal)
    return { kind: 'success', text: `Resumed ${id}.` }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Resume cancelled.' }
    return { kind: 'error', text: 'Resume failed: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

type SessionSearchResult = CommandResult | { kind: 'rows'; query: string; rows: readonly TuiRecentSession[] }

/** Read session content without replacing the active conversation. */
async function findSessions(ctx: Context, invocation: CommandInvocation): Promise<SessionSearchResult> {
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
  return { kind: 'rows', query, rows: hits.map(hit => ({
    id: hit.header.id,
    title: titles.get(hit.header.id) ?? hit.bestMatch.snippet,
    preview: hit.bestMatch.snippet,
    createdAt: hit.header.createdAt,
  })) }
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
    { name: 'queue', description: 'Review, edit, delete, and reorder pending messages', handler: async invocation => {
      if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /queue' }
      await ctx.omdshSession.openQueue(invocation.signal, invocation.agent)
      return { kind: 'success' }
    } },

    { name: 'context', description: 'Inspect projection-backed context usage', handler: invocation => showContext(ctx, invocation) },
    { name: 'new', description: 'Start a new session', handler: invocation => newSession(ctx, invocation) },
    {
      name: 'resume',
      description: 'Open the Session Library, search session content, or resume by ID',
      input: { hint: '[session-id|query]' },
      handler: invocation => resumeSession(ctx, invocation),
    },
    { name: 'tree', description: 'Browse conversation turns and branches', handler: async invocation => {
      if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /tree' }
      if (invocation.agent.status !== 'idle') return { kind: 'error', text: 'Finish or interrupt the active turn before opening the Session Tree.' }
      await ctx.omdshSession.openSessionTree(invocation.signal)
      return { kind: 'success' }
    } },
    { name: 'session', description: 'Show current session details', handler: invocation => showSession(ctx, invocation) },
    { name: 'retry', description: 'Run the most recent human prompt again', handler: invocation => retry(ctx, invocation) },
    { name: 'todo', description: 'Show the current session todo list', handler: showTodo },
  ], 'omdsh session commands')
}
