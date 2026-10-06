/**
 * Stored-session upgrade: the first launch of a new session format publishes a
 * current-format generation for every stored log an earlier release wrote, so
 * later listings and searches stop decoding the historical corpus. The
 * checked-in alpha.3 fixtures are the historical input; they stay untouched.
 */
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
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

/** Poll until the runtime's background pass publishes its marker. */
async function settled(markerPath: string): Promise<boolean> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (existsSync(markerPath)) return true
    await sleep(25)
  }
  return false
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
  it('publishes a current-format generation once, leaving the source untouched', async () => {
    const root = temp('omdsh-upgrade-')
    cpSync(join(fixtureRoot, 'zstd'), root, { recursive: true })
    const source = join(root, WS_DIR, PARENT_ID, 'session.jsonl.zstd')
    const before = readFileSync(source)
    const stateDir = temp('omdsh-upgrade-state-')
    const marker = join(stateDir, 'sessions-upgraded.json')

    const notices: string[] = []
    const { ctx } = await runtimeOver(root, stateDir, notices)
    expect(await settled(marker)).toBe(true)

    expect(generations(root, PARENT_ID).sort()).toEqual([
      'session.jsonl.zstd',
      'session.lock',
      `session.v${SESSION_FORMAT_VERSION}.jsonl.zstd`,
    ].sort())
    expect(readFileSync(source)).toEqual(before)
    expect(notices).toEqual([`Upgraded 1 stored session to the current format.`])
    expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual({ sessionFormat: SESSION_FORMAT_VERSION })
    await ctx.fiber.dispose()

    // The marker makes the next launch skip the pass entirely.
    const secondNotices: string[] = []
    const next = await runtimeOver(root, stateDir, secondNotices)
    await sleep(200)
    expect(secondNotices).toEqual([])
    await next.ctx.fiber.dispose()
  })

  it('finishes past a log it cannot upgrade', async () => {
    const root = temp('omdsh-upgrade-damaged-')
    cpSync(join(fixtureRoot, 'zstd'), root, { recursive: true })
    const source = join(root, WS_DIR, PARENT_ID, 'session.jsonl.zstd')
    // A torn tail is what a killed writer can leave: the pass must skip that
    // session, finish, and still record that the corpus was visited.
    appendFileSync(source, Buffer.from([0x00, 0x01, 0x02, 0xff]))
    const stateDir = temp('omdsh-upgrade-damaged-state-')
    const marker = join(stateDir, 'sessions-upgraded.json')

    const notices: string[] = []
    const { ctx } = await runtimeOver(root, stateDir, notices)
    expect(await settled(marker)).toBe(true)
    expect(notices).toEqual([])
    expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual({ sessionFormat: SESSION_FORMAT_VERSION })
    await ctx.fiber.dispose()
  })
})
