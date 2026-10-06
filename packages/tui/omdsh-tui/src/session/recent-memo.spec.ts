/**
 * Session Library rows are reused across processes while the revision the
 * persistence reports still holds, so a cold launch renders labels for
 * unchanged sessions without reading their stored logs again.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TuiService, TuiRecentSession } from '../definition.ts'
import { SessionRuntime } from './session-controller.ts'

const roots: string[] = []

function temp(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix))
  roots.push(path)
  return path
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

function stubTui(): TuiService {
  return {
    onInspectSubagent: () => () => {},
    onInspectClose: () => () => {},
    onInspectSubmit: () => () => {},
    setSteerHandler: () => () => {},
    setQueueHandler: () => () => {},
    setSessionSearch: () => {},
    setFileSearch: () => {},
    setImageValidator: () => {},
    setInspectedSubagent: () => {},
    setSubagents: () => {},
    restoreInput: vi.fn(),
    notice: vi.fn(),
    commandOutput: vi.fn(),
  } as unknown as TuiService
}

/** Hold a real store plus the durable backend rooted at `root` for one test. */
async function liveBackend(root: string): Promise<{ ctx: Context; persistence: unknown }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'zstd' })
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) throw new Error('the persistence backend did not activate')
  return { ctx, persistence }
}

/** Append one human message per string to session `id`, creating it when absent. */
async function writeEvents(persistence: unknown, id: string, texts: readonly string[]): Promise<void> {
  const service = persistence as {
    list(): Promise<{ header: { id: string } }[]>
    open(id: SessionId, access: 'write'): Promise<{ append(events: readonly SessionEvent[]): Promise<void>, close(): Promise<void> }>
    create(header: object): Promise<{ append(events: readonly SessionEvent[]): Promise<void>, close(): Promise<void> }>
  }
  const exists = (await service.list()).some(snapshot => snapshot.header.id === id)
  const handle = exists
    ? await service.open(SessionId(id), 'write')
    : await service.create({
      version: SESSION_FORMAT_VERSION,
      id: SessionId(id),
      createdAt: Date.now(),
      cwd: process.cwd(),
      isSeeded: false,
    })
  const start = exists ? 1 : 0
  await handle.append(texts.map((text, index) => ({
    type: 'user/message',
    seq: start + index,
    time: Date.now() + index,
    data: createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
    surfaceOp: 'append',
  }) as unknown as SessionEvent))
  await handle.close()
}

/** One cold launch over `persistence`: the rows a fresh process would publish. */
async function launch(persistence: unknown, memoPath: string): Promise<TuiRecentSession[]> {
  // Mark the corpus as already upgraded so these launches exercise the row
  // memo rather than the background format pass.
  writeFileSync(join(memoPath, 'sessions-upgraded.json'), JSON.stringify({ sessionFormat: SESSION_FORMAT_VERSION }))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  ctx.provide('sessionPersistence', persistence as never)
  const runtime = new SessionRuntime(ctx, stubTui(), { stateDir: memoPath })
  await runtime.refreshRecent()
  const rows = [...runtime.recentSessions]
  await ctx.fiber.dispose()
  return rows
}

describe('Session Library row memo', () => {
  it('publishes memoized labels without reading an unchanged log, and re-reads a changed one', async () => {
    const root = temp('omdsh-recent-')
    const memoPath = temp('omdsh-recent-memo-')
    const { ctx, persistence } = await liveBackend(root)
    await writeEvents(persistence, 'session-steady', ['Fix the renderer'])
    await writeEvents(persistence, 'session-moved', ['First revision'])

    const first = await launch(persistence, memoPath)
    expect(first.map(row => row.title).sort()).toEqual(['First revision', 'Fix the renderer'])
    const snapshots = await (persistence as { list(): Promise<unknown[]> }).list()

    // A launch that may list but must not read: the memo answers instead.
    const refused: string[] = []
    const unreadable = {
      list: async () => snapshots,
      open: async (id: string) => { refused.push(id); throw new Error('unexpected log read') },
      create: async () => { throw new Error('unexpected log write') },
    }
    const second = await launch(unreadable, memoPath)
    expect(second.map(row => row.title).sort()).toEqual(['First revision', 'Fix the renderer'])
    expect(refused).toEqual([])

    // A session that gained a message moved past its memoized revision, so the
    // launch reads it again and publishes the new preview.
    await writeEvents(persistence, 'session-moved', ['Second revision'])
    const third = await launch(persistence, memoPath)
    expect(third.find(row => row.id === 'session-moved')?.preview).toBe('Second revision')
    await ctx.fiber.dispose()
  })

  it('ignores a damaged memo document instead of publishing its labels', async () => {
    const root = temp('omdsh-recent-damaged-')
    const memoPath = temp('omdsh-recent-damaged-memo-')
    const { ctx, persistence } = await liveBackend(root)
    await writeEvents(persistence, 'session-intact', ['Intact label'])
    writeFileSync(join(memoPath, 'recent-sessions.json'), JSON.stringify({
      rows: {
        'session-intact': { revision: 'stale', row: { id: 'other', title: 'Wrong label', createdAt: 1 } },
        'session-missing': { revision: 'stale', row: { id: 'session-missing', title: 'Lost session', createdAt: 1 } },
        'session-not-json': 42,
      },
    }))

    const rows = await launch(persistence, memoPath)
    expect(rows).toEqual([expect.objectContaining({ id: 'session-intact', title: 'Intact label' })])
    await ctx.fiber.dispose()
  })
})
