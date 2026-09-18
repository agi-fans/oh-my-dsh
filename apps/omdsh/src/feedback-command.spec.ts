import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { readColdSessionLog } from '@deepseek-ai/dsh-session-query'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

const roots: string[] = []

function temp(name: string): string {
  const path = mkdtempSync(join(tmpdir(), name))
  roots.push(path)
  return path
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('/feedback command', () => {
  it('records a log-only feedback event and acknowledges the session', async () => {
    const home = temp('omdsh-feedback-home-')
    writeFileSync(join(home, 'settings.yaml'), 'agent-presets:\n  default: standard\n')
    const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm'
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'pnpm', '--dir', 'apps/omdsh', 'omdsh']
      : ['--dir', 'apps/omdsh', 'omdsh']
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, OMDSH_HOME: home, NO_COLOR: '1' },
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    child.stdin.end('/feedback probe remark\n')

    const status = await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(null) }, 120_000)
      child.on('close', (code) => { clearTimeout(timer); resolve(code) })
    })
    const clean = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, '')
    expect(status, clean.slice(-2000)).toBe(0)
    // The command acknowledges the receiving session and the anonymous user.
    expect(clean).toContain('Feedback recorded for session')
    expect(clean).toContain('Anonymous user:')
    // Recording is log-only: the durable event carries the remark, and no model
    // request may have started.
    const id = /Feedback recorded for session (session-[0-9a-f-]+)/u.exec(clean)?.[1]
    expect(id, clean.slice(-2000)).toBeTruthy()
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(JsonlSessionPersistence, { root: join(home, 'sessions') })
      const log = await readColdSessionLog(ctx.sessionPersistence, SessionId(id!))
      const record = log.events.find(
        (event): event is Extract<SessionEvent, { type: 'feedback/record' }> => event.type === 'feedback/record',
      )
      expect(record?.data.text).toBe('probe remark')
      expect(log.events.some(event => event.type === 'request/header' || event.type === 'turn/start')).toBe(false)
    } finally {
      await ctx.fiber.dispose()
    }
  }, 180_000)
})
