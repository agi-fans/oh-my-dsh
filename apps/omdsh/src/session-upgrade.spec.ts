/**
 * Browsing historical sessions is read-only; an explicitly opened writer
 * publishes the current generation while retaining its historical source.
 */
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionRuntime } from '@agi-fans/dsh-tui/session-runtime'
import type { TuiService } from '@agi-fans/dsh-tui'

const fixtureRoot = fileURLToPath(new URL('./fixtures/dsh-alpha3-sessions', import.meta.url))
const PARENT_ID = 'session-cfe4e182-7653-4a25-8926-f00d1a447f22'
const WS_DIR = '--Users-dy-Workspace-dsh-tui-apps-omdsh--'

const roots: string[] = []

function temp(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix))
  roots.push(path)
  return path
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

/** The stored generations of session `id` under `root`. */
function generations(root: string, id: string): string[] {
  return readdirSync(join(root, WS_DIR, id)).sort()
}

function stubTui(notices: string[]): TuiService {
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
    notice: (text: string) => { notices.push(text) },
    commandOutput: vi.fn(),
  } as unknown as TuiService
}

/** Mount one runtime over a copied store; `notices` collects what it reports. */
async function runtimeOver(root: string, stateDir: string, notices: string[]): Promise<{ ctx: Context, runtime: SessionRuntime }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'zstd' })
  const runtime = new SessionRuntime(ctx, stubTui(notices), { stateDir })
  return { ctx, runtime }
}

describe('stored session upgrade', () => {
  it('lists migration status without writing, then migrates on explicit activation and retains the source', async () => {
    const root = temp('omdsh-upgrade-')
    cpSync(join(fixtureRoot, 'zstd'), root, { recursive: true })
    const source = join(root, WS_DIR, PARENT_ID, 'session.jsonl.zstd')
    const before = readFileSync(source)
    const stateDir = temp('omdsh-upgrade-state-')
    const marker = join(stateDir, 'sessions-upgraded.json')

    const notices: string[] = []
    const { ctx, runtime } = await runtimeOver(root, stateDir, notices)
    await runtime.refreshRecent()
    expect(runtime.recentSessions.find(row => row.id === PARENT_ID)?.formatStatus).toBe('migration-required')
    expect(generations(root, PARENT_ID)).toEqual(['session.jsonl.zstd'])
    expect(existsSync(marker)).toBe(false)
    expect(notices).toEqual([])
    const handle = await ctx.sessionPersistence.open(SessionId(PARENT_ID), 'write')
    await handle.close()

    expect(generations(root, PARENT_ID).sort()).toEqual([
      'session.jsonl.zstd',
      'session.lock',
      `session.v${SESSION_FORMAT_VERSION}.jsonl.zstd`,
    ].sort())
    expect(readFileSync(source)).toEqual(before)
    expect((await ctx.sessionPersistence.stat(SessionId(PARENT_ID)))?.formatStatus).toBe('current')
    await runtime.refreshRecent()
    expect(runtime.recentSessions.find(row => row.id === PARENT_ID)?.formatStatus).not.toBe('migration-required')
    await ctx.fiber.dispose()

    // A second launch reads the current generation without another upgrade.
    const secondNotices: string[] = []
    const next = await runtimeOver(root, stateDir, secondNotices)
    await next.runtime.refreshRecent()
    expect(secondNotices).toEqual([])
    await next.ctx.fiber.dispose()
  })

  it('lists a damaged historical header without migrating it and refuses explicit activation', async () => {
    const root = temp('omdsh-upgrade-damaged-')
    cpSync(join(fixtureRoot, 'zstd'), root, { recursive: true })
    const source = join(root, WS_DIR, PARENT_ID, 'session.jsonl.zstd')
    // Header-only browsing cannot validate a torn event tail.
    appendFileSync(source, Buffer.from([0x00, 0x01, 0x02, 0xff]))
    const stateDir = temp('omdsh-upgrade-damaged-state-')
    const marker = join(stateDir, 'sessions-upgraded.json')

    const notices: string[] = []
    const { ctx, runtime } = await runtimeOver(root, stateDir, notices)
    await runtime.refreshRecent()
    expect(runtime.recentSessions.find(row => row.id === PARENT_ID)?.formatStatus).toBe('migration-required')
    await expect(ctx.sessionPersistence.open(SessionId(PARENT_ID), 'write')).rejects.toThrow()
    expect(notices).toEqual([])
    expect(existsSync(marker)).toBe(false)
    await ctx.fiber.dispose()
  })
})
