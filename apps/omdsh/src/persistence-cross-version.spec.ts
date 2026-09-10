/**
 * Cross-version persistence contract: sessions produced by the DSH
 * `0.1.2-alpha.3` runtime must survive the `0.1.2-rc.1` → `0.1.5-alpha.2`
 * cohort upgrade through the released v0→v3 migration chain. Reads publish a
 * version-named successor (`session.v3.jsonl[.zstd]`); the checked-in v0
 * fixtures stay byte-identical. Provenance of the fixtures under
 * `src/fixtures/dsh-alpha3-sessions/`:
 *
 * - `zstd/…/session-cfe4e182-…/session.jsonl.zstd` is the untouched zstd
 *   artifact a real alpha.3 `omdsh` binary wrote for one failed turn
 *   (invalid API key).
 * - `none/…/session-alpha3-seeded-child-0001/session.jsonl` is a seeded fork
 *   child in the same physical v0 format: the header line carries the numeric
 *   `seedLength` cut alpha.3 wrote for seeded children, and the seventeen
 *   inherited event lines are the parent artifact's complete log through its
 *   ended turn — the completed-turn prefix alpha.3's `seedDescriptorTurn`
 *   accepts — so the child's own turn numbers continue at 2. The final event
 *   line carries a legacy `coordinator` relay source frame, and the turn is
 *   deliberately left unterminated, like a child interrupted mid-turn. The
 *   shape matches what a real alpha.3 fork of this parent would write, but the
 *   file itself is hand-built: no real seeded-child artifact was available.
 *
 * The checked-in fixtures are immutable inputs: loading may append repair
 * records, so every load below runs against a throwaway copy and the test
 * asserts the source files were not modified.
 */
import { spawnPnpm } from './test-support/pnpm.ts'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { readColdSessionLog, type ColdSessionLog } from '@deepseek-ai/dsh-session-query'
import { describe, expect, it } from 'vitest'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const fixtureRoot = fileURLToPath(new URL('./fixtures/dsh-alpha3-sessions', import.meta.url))
const PARENT_ID = 'session-cfe4e182-7653-4a25-8926-f00d1a447f22'
const CHILD_ID = 'session-alpha3-seeded-child-0001'
const WS_DIR = '--Users-dy-Workspace-dsh-tui-apps-omdsh--'

function fixturePath(compression: 'zstd' | 'none', id: string): string {
  return join(fixtureRoot, compression, WS_DIR, id, `session.jsonl${compression === 'zstd' ? '.zstd' : ''}`)
}

/** Copy one fixture subtree into a throwaway root and read the migrated log from the copy. */
async function loadCopy(
  compression: 'zstd' | 'none',
  id: string,
): Promise<{ log: ColdSessionLog, source: string }> {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-cross-version-'))
  cpSync(join(fixtureRoot, compression), root, { recursive: true })
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root, compression })
    const log = await readColdSessionLog(ctx.sessionPersistence, SessionId(id))
    return { log, source: readFileSync(fixturePath(compression, id), 'utf8') }
  } finally {
    await ctx.fiber.dispose()
    rmSync(root, { recursive: true, force: true })
  }
}

describe('alpha.3 persisted-session compatibility', () => {
  it('migrates the alpha.3 zstd root artifact with an unseeded header', async () => {
    const { log, source } = await loadCopy('zstd', PARENT_ID)
    expect(log.header.isSeeded).toBe(false)
    expect(log.inheritedEventCount).toBe(0)
    expect(JSON.stringify(log.events)).toContain('Cross-version resume fixture prompt.')
    expect(source).toBe(readFileSync(fixturePath('zstd', PARENT_ID), 'utf8'))
  })

  it('derives the seeded lineage from the physical seedLength cut, keeps legacy relay frames, and repairs only the copy', async () => {
    const before = readFileSync(fixturePath('none', CHILD_ID), 'utf8')
    const { log, source } = await loadCopy('none', CHILD_ID)
    expect(source).toBe(before)
    expect(source.trimEnd().endsWith('turn/end')).toBe(false)

    expect(log.header.isSeeded).toBe(true)
    expect(log.header.parentSession).toBe(PARENT_ID)
    expect(log.header.origin).toBe('subagent')
    // The v2→v3 edge promotes both system heads into `system/message` events,
    // so the 17 inherited lines become 19 and every later index shifts by two.
    expect(log.inheritedEventCount).toBe(19)
    expect(log.events[19]?.type).toBe('session/end-seed')
    const relay = log.events[22]
    expect(relay?.type).toBe('user/message')
    if (relay?.type === 'user/message') {
      expect(relay.data.source?.kind).toBe('coordinator')
    }
    // The unterminated fixture turn gains exactly one synthetic interrupted closer.
    expect(log.events).toHaveLength(24)
    const closer = log.events[23]
    expect(closer?.type).toBe('turn/end')
    if (closer?.type === 'turn/end') {
      expect(closer.data.reason?.kind).toBe('interrupted')
    }
  })

  it('resumes the alpha.3 root session through the installed CLI', () => {
    const home = mkdtempSync(join(tmpdir(), 'omdsh-cross-version-'))
    cpSync(join(fixtureRoot, 'zstd'), join(home, 'sessions'), { recursive: true })
    try {
      const result = spawnPnpm(['--dir', appRoot, 'omdsh', '--resume', PARENT_ID], {
        cwd: appRoot,
        input: '',
        encoding: 'utf8',
        timeout: 180_000,
        env: { ...process.env, OMDSH_HOME: home, DEEPSEEK_API_KEY: 'sk-invalid-key-for-smoke' },
      })
      const out = (result.stdout ?? '') + (result.stderr ?? '')
      expect(result.status, out).toBe(0)
      expect(out).toContain(`Resumed ${PARENT_ID}.`)
      expect(out).not.toContain('unknown to this harness')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 200_000)
})
