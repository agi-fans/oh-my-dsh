/**
 * `/sessions <query>` cross-session search contract: the query path must reach
 * the session-query service, map hits into one keyboard-selectable prompt, and
 * leave the bare `/sessions` library path untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSessionLibrary, sessionLibraryPath, setSessionLabel, updateSessionLibrary } from '../session/session-library.ts'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionSearchHit } from '@deepseek-ai/dsh-session-query'
import * as commandSession from './session.ts'
import type { TuiService, TuiPrompt, TuiRecentSession } from '../definition.ts'
import type { SessionRuntime } from '../session/session-controller.ts'

function hit(id: string, snippet: string, createdAt = 1_700_000_000_000): SessionSearchHit {
  return {
    header: { id: SessionId(id), createdAt, isSeeded: false },
    live: false,
    persisted: true,
    bestMatch: { snippet },
  } as unknown as SessionSearchHit
}

interface HarnessOptions {
  hits?: readonly SessionSearchHit[]
  titles?: ReadonlyMap<string, string>
  failSearch?: Error
  promptAnswer?: string | null
  omitQueryService?: boolean
  libraryRows?: readonly TuiRecentSession[]
}

async function harness(options: HarnessOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const prompt = vi.fn(async (_request: TuiPrompt): Promise<string | null> => options.promptAnswer ?? null)
  const resumeSession = vi.fn(async () => {})
  const openSessionTree = vi.fn(async () => {})
  const searchSessions = vi.fn(async () => {
    if (options.failSearch !== undefined) throw options.failSearch
    return { items: options.hits ?? [] }
  })
  const readTitleSnapshots = vi.fn(async (ids: readonly string[]) => ids.map((id) => {
    const title = options.titles?.get(id)
    return title === undefined
      ? { sessionId: id, status: 'rejected' as const, reason: new Error('no title') }
      : { sessionId: id, status: 'fulfilled' as const, value: { session: { id }, title: { title } } }
  }))
  const renameSession = vi.fn(async () => {})
  ctx.provide('omdshSession', { refreshRecent: vi.fn(), resumeSession, renameSession, openSessionTree, recentSessions: options.libraryRows ?? [], sessionLibraryPath: sessionLibraryPath() } as unknown as SessionRuntime)
  ctx.provide('tui', { prompt } as unknown as TuiService)
  if (options.omitQueryService !== true) {
    ctx.provide('sessionQuery', { searchSessions, readTitleSnapshots } as never)
  }
  if (options.libraryRows !== undefined) ctx.provide('sessionPersistence', {} as never)
  await ctx.plugin(commandSession)
  const session = ctx.sessions.create(SessionId('session-search-test'))
  const agent = {
    id: session.id,
    session,
    status: 'idle',
    inbox: { nextTurn: [], nextStep: [] },
  } as unknown as Agent
  const execute = (line: string) => ctx.commands.execute(agent, line, [], new AbortController().signal)
  return { execute, prompt, resumeSession, renameSession, openSessionTree, searchSessions, agent }
}

describe('/tree', () => {
  it('opens the same Session Tree controller as double Escape', async () => {
    const { execute, openSessionTree } = await harness()
    expect((await execute('/tree'))?.result).toMatchObject({ kind: 'success' })
    expect(openSessionTree).toHaveBeenCalledWith(expect.any(AbortSignal))
  })
  it('rejects arguments and active turns without opening a tree', async () => {
    const { execute, openSessionTree, agent } = await harness()
    expect((await execute('/tree extra'))?.result).toMatchObject({ kind: 'error', text: 'Usage: /tree' })
    Object.assign(agent, { status: 'running' })
    expect((await execute('/tree'))?.result).toMatchObject({ kind: 'error', text: expect.stringContaining('Finish or interrupt') })
    expect(openSessionTree).not.toHaveBeenCalled()
  })
})

describe('/sessions search', () => {
  it('searches session content and resumes the chosen hit', async () => {
    const titles = new Map([['session-a', 'Fix the parser'], ['session-b', 'Add export flag']])
    const { execute, prompt, resumeSession, searchSessions } = await harness({
      hits: [hit('session-a', '…needle in the parser…'), hit('session-b', '…needle in export…')],
      titles,
      promptAnswer: 'session-b',
    })

    const execution = await execute('/sessions needle')
    expect(searchSessions).toHaveBeenCalledWith({ query: 'needle', limit: 20 }, expect.objectContaining({ signal: expect.anything() }))
    expect(prompt).toHaveBeenCalledTimes(1)
    const request = prompt.mock.calls[0]?.[0] as { title: string; options: readonly { label: string; value: string; preview: string }[] }
    expect(request.title).toBe('Session Search')
    expect(request.options.map(option => [option.label, option.value, option.preview])).toEqual([
      ['Fix the parser', 'session-a', '…needle in the parser…'],
      ['Add export flag', 'session-b', '…needle in export…'],
    ])
    expect(resumeSession).toHaveBeenCalledWith(expect.anything(), 'session-b', expect.anything())
    expect(execution?.result).toMatchObject({ kind: 'success', text: 'Resumed session-b.' })
  })

  it('falls back to the snippet when a hit has no folded title', async () => {
    const { execute, prompt } = await harness({
      hits: [hit('session-a', '…only a snippet…')],
      promptAnswer: null,
    })

    await execute('/sessions needle')
    const request = prompt.mock.calls[0]?.[0] as { options: readonly { label: string }[] }
    expect(request.options[0]?.label).toBe('…only a snippet…')
  })

  it('reports a query with no matches without opening a picker', async () => {
    const { execute, prompt, searchSessions } = await harness({ hits: [] })

    const execution = await execute('/sessions nothing-here')
    expect(searchSessions).toHaveBeenCalledTimes(1)
    expect(prompt).not.toHaveBeenCalled()
    expect(execution?.result).toMatchObject({ kind: 'success' })
    expect((execution?.result as { text: string }).text).toContain('No sessions match')
  })

  it('surfaces a search backend failure instead of falling back to substring filtering', async () => {
    const { execute, prompt } = await harness({ failSearch: new Error('SESSION_QUERY_SEARCH_DISABLED') })

    const execution = await execute('/sessions needle')
    expect(prompt).not.toHaveBeenCalled()
    expect(execution?.result).toMatchObject({
      kind: 'error',
      text: expect.stringContaining('Session search failed: SESSION_QUERY_SEARCH_DISABLED'),
    })
  })

  it('reports missing search configuration as an error', async () => {
    const { execute } = await harness({ omitQueryService: true })

    const execution = await execute('/sessions needle')
    expect(execution?.result).toMatchObject({ kind: 'error', text: 'Session search is not configured.' })
  })

  it('keeps the bare library path when no query is given', async () => {
    const { execute, searchSessions } = await harness({ hits: [hit('session-a', 'snippet')] })

    const execution = await execute('/sessions')
    expect(searchSessions).not.toHaveBeenCalled()
    expect(execution?.result).toMatchObject({ kind: 'error', text: 'Session persistence is not configured.' })
  })
})


const libraryRoots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of libraryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function isolatedLibrary(): string {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-session-command-'))
  libraryRoots.push(root)
  vi.stubEnv('OMDSH_HOME', root)
  return sessionLibraryPath()
}

describe('Session Library archive actions', () => {
  const rows = [{ id: 'session-a', title: 'Fix A', createdAt: 1 }, { id: 'session-b', title: 'Fix B', createdAt: 2 }]

  it('archives and restores from the picker while preserving pins, labels, rename and direct resume', async () => {
    const path = isolatedLibrary()
    setSessionLabel(path, 'turn:session-a:1', 'Checkpoint 🐳')
    const f = await harness({ libraryRows: rows })
    f.prompt.mockResolvedValueOnce('archive:session-a').mockResolvedValueOnce('view:')
      .mockResolvedValueOnce('pin:session-a').mockResolvedValueOnce('rename:session-a')
      .mockResolvedValueOnce('Renamed A').mockResolvedValueOnce('archive:session-a')
      .mockResolvedValueOnce('view:').mockResolvedValueOnce('session-a')
    expect((await f.execute('/sessions'))?.result.kind).toBe('success')
    expect(f.prompt.mock.calls[0]![0].options?.map(row => row.value)).toEqual(['session-b', 'session-a'])
    expect(f.prompt.mock.calls[1]![0].options?.map(row => row.value)).toEqual(['session-b'])
    expect(f.prompt.mock.calls[2]![0]).toMatchObject({ title: 'Session Library · Archived', options: [{ value: 'session-a' }] })
    expect(f.prompt.mock.calls[2]![0].actions).toContainEqual({ key: 'Alt+A', label: 'restore', valuePrefix: 'archive:' })
    expect(f.renameSession).toHaveBeenCalledWith(f.agent, 'session-a', 'Renamed A', expect.any(AbortSignal))
    expect(f.resumeSession).toHaveBeenCalledWith(f.agent, 'session-a', expect.any(AbortSignal))
    expect(readSessionLibrary(path)).toEqual({ pinned: ['session-a'], archived: [], labels: { 'turn:session-a:1': 'Checkpoint 🐳' } })
    updateSessionLibrary(path, current => ({ ...current, archived: ['session-a'] }))
    f.prompt.mockClear()
    expect((await f.execute('/resume session-a'))?.result.kind).toBe('success')
    expect(f.prompt).not.toHaveBeenCalled()
    expect(readSessionLibrary(path).archived).toEqual(['session-a'])
  })

  it('keeps view switching available when every session is archived and cancellation preserves metadata', async () => {
    const path = isolatedLibrary()
    updateSessionLibrary(path, current => ({ ...current, archived: rows.map(row => row.id) }))
    const f = await harness({ libraryRows: rows })
    f.prompt.mockResolvedValueOnce('view:').mockResolvedValueOnce(null)
    await f.execute('/sessions')
    expect(f.prompt.mock.calls[0]![0]).toMatchObject({ options: [], emptyText: expect.stringContaining('Alt+V') })
    expect(f.prompt.mock.calls[0]![0].actions).toContainEqual(expect.objectContaining({ key: 'Alt+V', scope: 'list' }))
    expect(f.prompt.mock.calls[1]![0].options).toHaveLength(2)
    expect(f.resumeSession).not.toHaveBeenCalled()
    expect(readSessionLibrary(path).archived).toEqual(['session-a', 'session-b'])
  })

  it('ignores actions for missing or hidden sessions', async () => {
    const path = isolatedLibrary()
    updateSessionLibrary(path, current => ({ ...current, archived: ['session-a'] }))
    const f = await harness({ libraryRows: rows })
    f.prompt.mockResolvedValueOnce('archive:session-a').mockResolvedValueOnce('pin:missing').mockResolvedValueOnce(null)
    await f.execute('/sessions')
    expect(readSessionLibrary(path)).toEqual({ pinned: [], archived: ['session-a'], labels: {} })
  })
})
