/** Session lifecycle and inspection commands registered through dsh-commands. */

import { createPromptBrowser } from '../runtime/prompt-browser.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { TuiRecentSession, TuiService } from '../definition.ts'
import type { SessionSearchHit, SessionSearchCursor } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-tool-todo'
import type {} from '../runtime/session-runtime.ts'
import { registerCommands } from './registration.ts'
import { askPrompt, confirmPrompt } from '../prompt-intents.ts'
import { formatRelativeAge } from '../chrome/relative-time.ts'
import { formatPermission } from '../chrome/status-line.ts'
import { formatAgentPreset } from '../session/session-configuration.ts'
import { readSessionLibrary, sortSessionRows, togglePinnedSession, updateSessionLibrary } from '../session/session-library.ts'
import { contextOverviewDetails, type ContextOverview } from '../session/context-diagnostics.ts'
import { readReference } from '../runtime/reference-reader.ts'
import { currentWorkingDirectory } from '../session/working-directory.ts'

export const name = 'omdsh-command-session'
export const inject = ['commands', 'omdshSession', 'tui']

/** Cross-session search page size shown in one Session Library prompt. */
const SESSION_SEARCH_LIMIT = 20

async function newSession(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /new' }
  if (invocation.agent.status === 'running') {
    return { kind: 'error', text: 'Finish or interrupt the active turn before starting a new session.' }
  }
  await ctx.omdshSession.newSession(invocation.agent)
  return { kind: 'success', text: 'Started a new session.' }
}

async function resumeSession(ctx: Context, invocation: CommandInvocation, search?: { query: string; rows: readonly TuiRecentSession[]; nextCursor?: SessionSearchCursor }): Promise<CommandResult> {
  if (ctx.get('sessionPersistence') === undefined) return { kind: 'error', text: 'Session persistence is not configured.' }
  if (invocation.agent.status === 'running') {
    return { kind: 'error', text: 'Finish or interrupt the active turn before resuming another session.' }
  }
  const abort = new AbortController()
  invocation = { ...invocation, signal: AbortSignal.any([invocation.signal, abort.signal]) }
  const prompt: TuiService['prompt'] = request => ctx.tui.prompt({ ...request, signal: invocation.signal, onSuperseded: () => abort.abort() })
  await ctx.omdshSession.refreshRecent()
  const id = search === undefined ? invocation.rawInput.trim() : ''
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
    const browse = createPromptBrowser(prompt)
    let archivedView = false
    let searchDiagnostic = ''
    let selectedId: string | undefined
    while (!invocation.signal.aborted) {
      const library = readSessionLibrary(libraryPath)
      const inventory = new Map(ctx.omdshSession.recentSessions.map(row => [row.id, row]))
      const source = search === undefined ? ctx.omdshSession.recentSessions : search.rows.map(row => ({ ...row, ...inventory.get(row.id), ...(row.preview === undefined ? {} : { preview: row.preview }) }))
      const recent = sortSessionRows(source.filter(row => library.archived.includes(row.id) === archivedView), library.pinned)
      if ((search?.rows ?? ctx.omdshSession.recentSessions).length === 0) return { kind: 'success', text: 'No durable sessions found.' }
      const answer = await browse({ localize: ['title', 'question', 'actions'],
        title: `Session Library${search === undefined ? '' : ' · Search'}${archivedView ? ' · Archived' : ''}`,
        detail: [searchDiagnostic, search === undefined ? '' : `Content search: ${search.query} · ${search.rows.length} matches loaded`].filter(Boolean).join('\n'),
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
          ...(search?.nextCursor === undefined ? [] : [{ key: 'Alt+N', label: 'load more', valuePrefix: 'more:', scope: 'list' as const }]),
          ...(search === undefined ? [] : [{ key: 'Alt+L', label: 'all sessions', valuePrefix: 'library:', scope: 'list' as const }]),
          ...(ctx.get('sessionQuery') === undefined ? [] : [{ key: 'Alt+S', label: 'search content', valuePrefix: 'search:', scope: 'list' as const }]),
          { key: 'Alt+R', label: 'rename', valuePrefix: 'rename:' },
          { key: 'Alt+P', label: 'pin/unpin', valuePrefix: 'pin:' },
          { key: 'Alt+A', label: archivedView ? 'restore' : 'archive', valuePrefix: 'archive:' },
          { key: 'Alt+V', label: archivedView ? 'active sessions' : 'archived sessions', valuePrefix: 'view:', scope: 'list' },
        ],
        presentation: 'card',
        filterable: true,
        allowCustom: false,
        signal: invocation.signal,
      }, JSON.stringify([search?.query, archivedView]))
      if (answer === null || invocation.signal.aborted) return { kind: 'success' }
      invocation.signal.throwIfAborted()
      if (answer === 'more:' && search?.nextCursor !== undefined) {
        const page = await findSessions(ctx, { ...invocation, rawInput: search.query }, search.nextCursor)
        if (page.kind === 'rows') {
          search = { ...page, rows: [...new Map([...search.rows, ...page.rows].map(row => [row.id, row])).values()] }
          searchDiagnostic = ''
        } else searchDiagnostic = page.text ?? ''
        continue
      }
      if (answer === 'library:') { searchDiagnostic = ''; search = undefined; archivedView = false; selectedId = undefined; continue }
      if (answer === 'search:') {
        const query = await prompt(askPrompt({ localize: ['title', 'question', 'actions'], title: 'Search session content', question: 'Enter search text', initialInput: search?.query ?? '', signal: invocation.signal }))
        if (query === null || query.trim() === '') continue
        const result = await findSessions(ctx, { ...invocation, rawInput: query })
        if (result.kind === 'rows') { searchDiagnostic = ''; search = result; archivedView = false; selectedId = undefined; continue }
        if (result.text !== undefined) {
          searchDiagnostic = result.text
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
        const title = await prompt(askPrompt({ localize: ['title', 'question', 'actions'],
          title: 'Rename Session',
          question: `New title for “${row.title}”`,
          initialInput: row.title,
          signal: invocation.signal,
        }))
        if (title !== null && !invocation.signal.aborted) {
          try { await ctx.omdshSession.renameSession(invocation.agent, target, title, invocation.signal); searchDiagnostic = '' }
          catch (error) { searchDiagnostic = error instanceof Error ? error.message : String(error) }
        }
        continue
      }
      selectedId = answer
      if (answer === invocation.agent.id) { searchDiagnostic = 'That session is already active.'; continue }
      const resumed = await resumeStoredSession(ctx, invocation, answer, prompt, search?.query)
      if (resumed.opened) return resumed.result
      searchDiagnostic = resumed.result.text ?? ''
    }
    return { kind: 'success' }
  }
  if (id === invocation.agent.id) return { kind: 'success', text: 'That session is already active.' }
  return (await resumeStoredSession(ctx, invocation, id, prompt)).result
}

async function resumeStoredSession(ctx: Context, invocation: CommandInvocation, id: string, prompt: TuiService['prompt'], query?: string): Promise<{ result: CommandResult; opened: boolean }> {
  try {
    const stored = await ctx.get('sessionPersistence')?.stat(SessionId(id))
    if (stored?.formatStatus === 'migration-required' && ctx.tui.interactive === true) {
      const migrate = await confirmPrompt(prompt, { localize: ['title', 'options', 'actions'],
        title: 'Migrate session',
        question: ctx.omdshSession.recentSessions.find(row => row.id === id)?.title ?? id,
        detail: 'Opening this session writes a current-format generation and retains the historical source. Browsing the Session Library does not migrate it.',
        acceptLabel: 'Migrate and resume',
        cancelLabel: null,
        signal: invocation.signal,
      })
      if (!migrate || invocation.signal.aborted) return { result: { kind: 'success' }, opened: false }
    }
    await ctx.omdshSession.resumeSession(invocation.agent, id, invocation.signal)
    if (query !== undefined && ctx.tui.interactive === true && ctx.tui.searchTranscript !== undefined) {
      ctx.tui.searchTranscript(query)
      return { result: { kind: 'success' }, opened: true }
    }
    return { result: { kind: 'success', text: `Resumed ${id}.` }, opened: true }
  } catch (error: unknown) {
    if (ctx.omdshSession.agent?.id === id) {
      const text = `Resumed ${id}. Session Library refresh failed: ${error instanceof Error ? error.message : String(error)}`
      if (query !== undefined && ctx.tui.interactive === true && ctx.tui.searchTranscript !== undefined) {
        ctx.tui.notice(text, { level: 'error' })
        ctx.tui.searchTranscript(query)
        return { result: { kind: 'success' }, opened: true }
      }
      return { result: { kind: 'success', text }, opened: true }
    }
    if (invocation.signal.aborted) return { result: { kind: 'error', text: 'Resume cancelled.' }, opened: false }
    return { result: { kind: 'error', text: 'Resume failed: ' + (error instanceof Error ? error.message : String(error)) }, opened: false }
  }
}

type SessionSearchResult = CommandResult | { kind: 'rows'; query: string; rows: readonly TuiRecentSession[]; nextCursor?: SessionSearchCursor }

/** Read session content without replacing the active conversation. */
async function findSessions(ctx: Context, invocation: CommandInvocation, cursor?: SessionSearchCursor): Promise<SessionSearchResult> {
  if (invocation.agent.status === 'running') {
    return { kind: 'error', text: 'Finish or interrupt the active turn before resuming another session.' }
  }
  const query = invocation.rawInput.trim()
  const sessionQuery = ctx.get('sessionQuery')
  if (sessionQuery === undefined) return { kind: 'error', text: 'Session search is not configured.' }
  let hits: readonly SessionSearchHit[]
  let nextCursor: SessionSearchCursor | undefined
  try {
    const page = await sessionQuery.searchSessions({
      query, limit: SESSION_SEARCH_LIMIT,
      sessionFilters: [{ kind: 'cwd', values: [currentWorkingDirectory(ctx, invocation.agent.session)] }],
      ...(cursor === undefined ? {} : { cursor }),
    }, { signal: invocation.signal })
    hits = page.items
    nextCursor = page.nextCursor
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Search cancelled.' }
    return { kind: 'error', text: 'Session search failed: ' + (error instanceof Error ? error.message : String(error)) }
  }
  if (hits.length === 0 && cursor === undefined) return { kind: 'success', text: `No sessions match “${query}”.` }
  const titles = new Map<string, string>()
  try {
    for (const result of await sessionQuery.readTitleSnapshots(hits.map(hit => hit.header.id), invocation.signal)) {
      if (result.status === 'fulfilled' && result.value.title !== undefined) {
        titles.set(result.sessionId, result.value.title.title)
      }
    }
  } catch { /* title folding is best-effort; the snippet still identifies the hit */ }
  return { kind: 'rows', query, ...(nextCursor === undefined ? {} : { nextCursor }), rows: hits.map(hit => ({
    id: hit.header.id,
    title: titles.get(hit.header.id) ?? hit.bestMatch.snippet,
    preview: hit.bestMatch.snippet,
    createdAt: hit.header.createdAt,
  })) }
}

function contextSnapshot(ctx: Context, invocation: CommandInvocation): ContextOverview {
  const stats = ctx.omdshSession.stats(invocation.agent)
  const selection = ctx.omdshSession.selection(invocation.agent)
  const reasoning = ctx.omdshSession.reasoningEffort(invocation.agent)
  const controls = ctx.omdshSession.controls(invocation.agent)
  const workflow = controls.plan?.pending === true
    ? controls.plan.active ? 'Plan → Default (pending)' : 'Plan (pending)'
    : controls.plan?.active === true ? 'Plan' : 'Default'
  return {
    ...ctx.omdshSession.contextDiagnostics(invocation.agent),
    sessionId: invocation.agent.id, model: `${selection.provider}/${selection.model}`,
    ...(reasoning === undefined ? {} : { reasoning }),
    agent: formatAgentPreset(controls.agentPreset ?? 'standard'), workflow,
    ...(controls.permission === undefined ? {} : { access: formatPermission(controls.permission) }),
    turns: stats.turns, steps: stats.steps, inputTokens: stats.inputTokens, outputTokens: stats.outputTokens,
    followUp: invocation.agent.inbox.nextTurn.length, steering: invocation.agent.inbox.nextStep.length,
  }
}

async function retry(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /retry' }
  const resent = await ctx.omdshSession.retryLastPrompt(invocation.agent, invocation.signal)
  return { kind: 'success', text: resent ? 'Re-sent the last human prompt with its attachments as a new turn.' : 'No human prompt is available to retry.' }
}

async function showContext(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /context' }
  const read = (): ContextOverview => contextSnapshot(ctx, invocation)
  if (ctx.tui.interactive !== true || ctx.tui.openContext === undefined) {
    return { kind: 'success', text: contextOverviewDetails(read()) }
  }
  const abort = new AbortController()
  const signal = AbortSignal.any([invocation.signal, abort.signal])
  const onSuperseded = (): void => { abort.abort() }
  while (!signal.aborted) {
    const action = await ctx.tui.openContext({ read, signal, onSuperseded,
      canCompact: ctx.commands.list(invocation.agent).some(command => command.name === 'compact') })
    if (signal.aborted || action === null) break
    if (action === 'details') {
      await readReference({ prompt: request => ctx.tui.prompt({ ...request, onSuperseded }),
        ...(ctx.tui.copyText === undefined ? {} : { copyText: (text, label) => ctx.tui.copyText!(text, label) }),
      }, 'Context · Details', contextOverviewDetails(read()), signal)
    } else if (action === 'copy') {
      await ctx.tui.copyText?.(invocation.agent.id, 'Session ID')
    } else if (action === 'compact') {
      const result = await ctx.commands.execute(invocation.agent, '/compact', [], signal)
      return result?.result ?? { kind: 'error', text: 'Context compaction is unavailable.' }
    } else break
  }
  return { kind: 'success' }
}



export function apply(ctx: Context): void {
  registerCommands(ctx, [
    { name: 'queue', description: 'Review, edit, delete, and reorder pending messages', handler: async invocation => {
      if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /queue' }
      await ctx.omdshSession.openQueue(invocation.signal, invocation.agent)
      return { kind: 'success' }
    } },

    { name: 'context', description: 'Inspect context usage and session details', handler: invocation => showContext(ctx, invocation) },
    { name: 'new', description: 'Start a new session', handler: invocation => newSession(ctx, invocation) },
    {
      name: 'resume',
      description: 'Open the Session Library, search session content, or resume by ID',
      input: { hint: '[session-id|query]' },
      handler: invocation => resumeSession(ctx, invocation),
    },
    { name: 'continue', description: 'Continue an eligible failed generation without resending the prompt', handler: async invocation => {
      if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /continue' }
      await ctx.omdshSession.continueGeneration(invocation.agent, undefined, invocation.signal)
      return { kind: 'success' }
    } },
    { name: 'retry', description: 'Resend the last human prompt with its attachments', handler: invocation => retry(ctx, invocation) },
  ], 'omdsh session commands')
}
