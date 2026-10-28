/**
 * `/resume` owns both session paths: a bare call opens the Session Library, a
 * content query searches every durable session, and an explicit id resumes it.
 * The retired `/sessions` entry point must not reappear.
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
  migration?: boolean
  interactive?: boolean
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
  ctx.provide('tui', { prompt, notice: vi.fn(), interactive: options.interactive ?? true } as unknown as TuiService)
  if (options.omitQueryService !== true) {
    ctx.provide('sessionQuery', { searchSessions, readTitleSnapshots } as never)
  }
  if (options.libraryRows !== undefined || options.hits !== undefined || options.migration) {
    const known = new Set([...(options.libraryRows ?? []).map(row => row.id), ...(options.migration ? ['old'] : [])])
    ctx.provide('sessionPersistence', {
      stat: async (id: unknown) => known.has(String(id))
        ? { formatStatus: options.migration && String(id) === 'old' ? 'migration-required' : 'current' }
        : undefined,
    } as never)
  }
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

describe('/resume library and search', () => {
  it('searches session content and resumes the chosen hit', async () => {
    const titles = new Map([['session-a', 'Fix the parser'], ['session-b', 'Add export flag']])
    const { execute, prompt, resumeSession, searchSessions } = await harness({
      hits: [hit('session-a', '…needle in the parser…'), hit('session-b', '…needle in export…')],
      titles,
      promptAnswer: 'session-b',
    })

    const execution = await execute('/resume needle')
    expect(searchSessions).toHaveBeenCalledWith({ query: 'needle', limit: 20 }, expect.objectContaining({ signal: expect.anything() }))
    expect(prompt).toHaveBeenCalledTimes(1)
    const request = prompt.mock.calls[0]?.[0] as { title: string; options: readonly { label: string; value: string; preview: string }[] }
    expect(request.title).toBe('Session Library · Search')
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

    await execute('/resume needle')
    const request = prompt.mock.calls[0]?.[0] as { options: readonly { label: string }[] }
    expect(request.options[0]?.label).toBe('…only a snippet…')
  })

  it('reports a query with no matches without opening a picker', async () => {
    const { execute, prompt, searchSessions } = await harness({ hits: [] })

    const execution = await execute('/resume nothing-here')
    expect(searchSessions).toHaveBeenCalledTimes(1)
    expect(prompt).not.toHaveBeenCalled()
    expect(execution?.result).toMatchObject({ kind: 'success' })
    expect((execution?.result as { text: string }).text).toContain('No sessions match')
  })

  it('surfaces a search backend failure instead of falling back to substring filtering', async () => {
    const { execute, prompt } = await harness({ failSearch: new Error('SESSION_QUERY_SEARCH_DISABLED'), libraryRows: [] })

    const execution = await execute('/resume needle')
    expect(prompt).not.toHaveBeenCalled()
    expect(execution?.result).toMatchObject({
      kind: 'error',
      text: expect.stringContaining('Session search failed: SESSION_QUERY_SEARCH_DISABLED'),
    })
  })

  it('reports missing search configuration as an error', async () => {
    const { execute } = await harness({ omitQueryService: true, libraryRows: [] })

    const execution = await execute('/resume needle')
    expect(execution?.result).toMatchObject({ kind: 'error', text: 'Session search is not configured.' })
  })

  it('keeps the bare library path when no argument is given', async () => {
    const { execute, searchSessions } = await harness({})

    const execution = await execute('/resume')
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
    expect((await f.execute('/resume'))?.result.kind).toBe('success')
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
    await f.execute('/resume')
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
    await f.execute('/resume')
    expect(readSessionLibrary(path)).toEqual({ pinned: [], archived: ['session-a'], labels: {} })
  })
})

describe('stored session migration', () => {
  it('keeps explicit line-input resume compatible without an interactive confirmation', async () => {
    const h = await harness({ migration: true, interactive: false })
    expect((await h.execute('/resume old'))?.result.kind).toBe('success')
    expect(h.prompt).not.toHaveBeenCalled()
    expect(h.resumeSession).toHaveBeenCalledWith(h.agent, 'old', expect.any(AbortSignal))
  })
  it('labels migration-required rows and cancel leaves the session unopened', async () => {
    isolatedLibrary()
    const h = await harness({ migration: true, libraryRows: [{ id: 'old', title: 'Old session', createdAt: 1, formatStatus: 'migration-required' }] })
    h.prompt.mockResolvedValueOnce('old').mockResolvedValueOnce(null)
    await h.execute('/resume')
    expect(h.prompt.mock.calls[0]![0].options![0]!.description).toContain('migration required')
    expect(h.prompt.mock.calls[1]![0]).toMatchObject({ title: 'Migrate session', options: [{ value: 'accept' }] })
    expect(h.resumeSession).not.toHaveBeenCalled()
  })

  it.each(['/resume old', '/resume needle'])('confirms migration before %s', async line => {
    const h = await harness({ migration: true, hits: [hit('old', 'needle')], libraryRows: [] })
    if (line.endsWith('needle')) h.prompt.mockResolvedValueOnce('old')
    // The migrate row is a one-way door, so it answers `accept`.
    h.prompt.mockResolvedValueOnce('accept')
    expect((await h.execute(line))?.result.kind).toBe('success')
    expect(h.resumeSession).toHaveBeenCalledWith(h.agent, 'old', expect.any(AbortSignal))
  })
})


describe('Session Library content search', () => {
  it('searches from the library, keeps management actions, and returns to all sessions', async () => {
    isolatedLibrary()
    const h = await harness({ libraryRows: [{ id: 'session-a', title: 'A', createdAt: 1 }], hits: [hit('session-a', 'needle')] })
    h.prompt.mockResolvedValueOnce('search:').mockResolvedValueOnce('needle').mockResolvedValueOnce('pin:session-a').mockResolvedValueOnce('library:').mockResolvedValueOnce(null)
    await h.execute('/resume')
    expect(h.searchSessions).toHaveBeenCalledWith({ query: 'needle', limit: 20 }, expect.anything())
    expect(h.prompt.mock.calls[2]![0]).toMatchObject({ title: 'Session Library · Search', actions: expect.arrayContaining([expect.objectContaining({ valuePrefix: 'archive:' }), expect.objectContaining({ valuePrefix: 'library:' })]) })
    expect(h.prompt.mock.calls[4]![0].title).toBe('Session Library')
    expect(h.resumeSession).not.toHaveBeenCalled()
    expect(readSessionLibrary(sessionLibraryPath()).pinned).toEqual(['session-a'])
  })
})


it('returns immediately after resuming a hit selected from library search', async () => {
  isolatedLibrary()
  const h = await harness({ libraryRows: [{ id: 'session-a', title: 'A', createdAt: 1 }], hits: [hit('session-a', 'needle')] })
  h.prompt.mockResolvedValueOnce('search:').mockResolvedValueOnce('needle').mockResolvedValueOnce('session-a')
  expect((await h.execute('/resume'))?.result).toMatchObject({ kind: 'success', text: 'Resumed session-a.' })
  expect(h.prompt).toHaveBeenCalledTimes(3)
  expect(h.resumeSession).toHaveBeenCalledTimes(1)
})

it('keeps an empty-search notice visible until acknowledged and returns to the library', async () => {
  isolatedLibrary()
  const h = await harness({ libraryRows: [{ id: 'session-a', title: 'A', createdAt: 1 }], hits: [] })
  h.prompt.mockResolvedValueOnce('search:').mockResolvedValueOnce('needle').mockResolvedValueOnce('back').mockResolvedValueOnce(null)
  await h.execute('/resume')
  expect(h.prompt.mock.calls[2]![0]).toMatchObject({ presentation: 'document', documentSource: { text: expect.stringContaining('No sessions match') } })
  expect(h.prompt.mock.calls[3]![0].title).toBe('Session Library')
  expect(h.resumeSession).not.toHaveBeenCalled()
})


it('refreshes renamed search hits from the session inventory without losing the matching snippet', async () => {
  isolatedLibrary()
  const rows = [{ id: 'session-a', title: 'Before', createdAt: 1 }]
  const h = await harness({ libraryRows: rows, hits: [hit('session-a', 'needle')] })
  h.renameSession.mockImplementation(async () => { rows[0]!.title = 'After' })
  h.prompt.mockResolvedValueOnce('rename:session-a').mockResolvedValueOnce('After').mockResolvedValueOnce(null)
  await h.execute('/resume needle')
  expect(h.prompt.mock.calls[2]![0].options).toContainEqual(expect.objectContaining({ label: 'After', preview: 'needle' }))
})
