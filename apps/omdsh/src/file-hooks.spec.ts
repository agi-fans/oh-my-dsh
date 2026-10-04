import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { readColdSessionLog } from '@deepseek-ai/dsh-session-query'
import { bootTuiTurn } from './test-support/tui-boot.ts'

async function logs(home: string): Promise<string> {
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root: join(home, 'sessions') })
    const sessions = await ctx.sessionPersistence.list()
    const events = []
    for (const session of sessions) events.push(...(await readColdSessionLog(ctx.sessionPersistence, session.header.id)).events)
    return JSON.stringify(events)
  } finally { await ctx.fiber.dispose() }
}

describe('file archive and hooks through the shipped CLI', () => {
  it('exports a ZIP through the public persistence service alongside a real mock turn', async () => {
    const home = mkdtempSync(join(tmpdir(), 'omdsh-archive-')), path = join(home, 'backup.zip')
    try {
      const turn = await bootTuiTurn({ preset: 'standard', home, input: `ping\n/export archive "${path}"\n` })
      expect(turn.status, turn.output.slice(-2500)).toBe(0)
      expect(turn.output).toContain('Archived session logs')
      expect(readFileSync(path).subarray(0, 2).toString()).toBe('PK')
    } finally { rmSync(home, { recursive: true, force: true }) }
  }, 180_000)

  it.each(['codex', 'claude-code'])('loads an opt-in %s hook before the first user turn', async bridge => {
    const home = mkdtempSync(join(tmpdir(), 'omdsh-hook-')), path = join(home, 'hooks.json')
    writeFileSync(path, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node --version' }] }] } }))
    try {
      const turn = await bootTuiTurn({ preset: 'standard', home,
        patch: `- id: hook-settings\n  config:\n    configPath: ${JSON.stringify(path)}\n    bridge: ${bridge}\n` })
      expect(turn.status, turn.output.slice(-2500)).toBe(0)
      expect(turn.output).toContain(`${bridge} command hooks enabled`)
      expect(await logs(home)).toContain('hook/result')
      expect(await logs(home)).toContain('UserPromptSubmit')
    } finally { rmSync(home, { recursive: true, force: true }) }
  }, 180_000)
})
