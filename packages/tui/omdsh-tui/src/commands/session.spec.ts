/**
 * `/sessions <query>` cross-session search contract: the query path must reach
 * the session-query service, map hits into one keyboard-selectable prompt, and
 * leave the bare `/sessions` library path untouched.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionSearchHit } from '@deepseek-ai/dsh-session-query'
import * as commandSession from './session.ts'
import type { TuiService } from '../definition.ts'
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
}

async function harness(options: HarnessOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const prompt = vi.fn(async () => options.promptAnswer ?? null)
  const resumeSession = vi.fn(async () => {})
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
  ctx.provide('omdshSession', { refreshRecent: vi.fn(), resumeSession } as unknown as SessionRuntime)
  ctx.provide('tui', { prompt } as unknown as TuiService)
  if (options.omitQueryService !== true) {
    ctx.provide('sessionQuery', { searchSessions, readTitleSnapshots } as never)
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
  return { execute, prompt, resumeSession, searchSessions, agent }
}

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
