/**
 * omdsh end-to-end smoke: boots the full harness composition, renders a
 * human prompt, surfaces the failed turn's error notice (fake API key —
 * keyless by construction), and exits 0 on stdin EOF.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../..', import.meta.url))

function findSessionIds(home: string): string[] {
  const sessions = join(home, 'sessions')
  if (!existsSync(sessions)) return []
  const ids: string[] = []
  for (const workspace of readdirSync(sessions, { withFileTypes: true })) {
    if (!workspace.isDirectory()) continue
    for (const entry of readdirSync(join(sessions, workspace.name), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('session-')) ids.push(entry.name)
    }
  }
  return ids
}

describe('omdsh smoke', () => {
  it('boots, renders a prompt, reports the turn failure, exits on EOF', () => {
    const omdshHome = mkdtempSync(join(tmpdir(), 'omdsh-app-smoke-'))
    const result = spawnSync(
      'pnpm',
      ['omdsh'],
      {
        cwd: root,
        input: 'hi\n',
        encoding: 'utf8',
        timeout: 180_000,
        env: { ...process.env, OMDSH_HOME: omdshHome, DEEPSEEK_API_KEY: 'sk-invalid-key-for-smoke' },
      },
    )
    rmSync(omdshHome, { recursive: true, force: true })
    const out = (result.stdout ?? '') + (result.stderr ?? '')
    expect(result.status).toBe(0)
    expect(out).toContain('hi')
    expect(out).toContain('error:')
    expect(out).not.toContain('Current runtime context')
    expect(out).not.toContain('Unsupported platform')
  }, 200_000)

  it('resumes a session that recorded tool presentation', () => {
    const omdshHome = mkdtempSync(join(tmpdir(), 'omdsh-resume-tools-'))
    const env = { ...process.env, OMDSH_HOME: omdshHome, DEEPSEEK_API_KEY: 'sk-invalid-key-for-smoke' }
    const created = spawnSync('pnpm', ['omdsh'], {
      cwd: root,
      input: 'hi\n',
      encoding: 'utf8',
      timeout: 180_000,
      env,
    })
    const ids = findSessionIds(omdshHome)
    const sessionId = ids[0]
    const resumed = sessionId === undefined
      ? undefined
      : spawnSync('pnpm', ['omdsh', '--resume', sessionId], {
        cwd: root,
        input: '',
        encoding: 'utf8',
        timeout: 180_000,
        env,
      })
    rmSync(omdshHome, { recursive: true, force: true })
    const createdOut = (created.stdout ?? '') + (created.stderr ?? '')
    const resumedOut = resumed === undefined ? '' : (resumed.stdout ?? '') + (resumed.stderr ?? '')
    expect(created.status).toBe(0)
    expect(createdOut).toContain('error:')
    expect(sessionId).toEqual(expect.stringMatching(/^session-/u))
    expect(resumed?.status).toBe(0)
    expect(resumedOut).toContain(`Resumed ${sessionId}.`)
    expect(resumedOut).not.toContain('unknown to this harness')
    expect(resumedOut).not.toContain('omdsh/tools-selected')
  }, 200_000)

  it('routes --resume through the durable session controller', () => {
    const omdshHome = mkdtempSync(join(tmpdir(), 'omdsh-resume-smoke-'))
    const missing = 'session-does-not-exist'
    const result = spawnSync(
      'pnpm',
      ['omdsh', '--resume', missing],
      {
        cwd: root,
        input: '',
        encoding: 'utf8',
        timeout: 180_000,
        env: { ...process.env, OMDSH_HOME: omdshHome, DEEPSEEK_API_KEY: 'sk-invalid-key-for-smoke' },
      },
    )
    rmSync(omdshHome, { recursive: true, force: true })
    const out = (result.stdout ?? '') + (result.stderr ?? '')
    expect(result.status).toBe(0)
    expect(out).toContain('Resume failed:')
    expect(out).toContain(missing)
    expect(out).not.toContain('Unsupported platform')
  }, 200_000)

  it('mounts the interactive permission selector in the active agent scope', () => {
    const omdshHome = mkdtempSync(join(tmpdir(), 'omdsh-permission-smoke-'))
    const result = spawnSync(
      'pnpm',
      ['omdsh'],
      {
        cwd: root,
        input: '/permission\n1\n',
        encoding: 'utf8',
        timeout: 180_000,
        env: { ...process.env, OMDSH_HOME: omdshHome, DEEPSEEK_API_KEY: 'sk-invalid-key-for-smoke' },
      },
    )
    rmSync(omdshHome, { recursive: true, force: true })
    const out = (result.stdout ?? '') + (result.stderr ?? '')
    expect(result.status).toBe(0)
    expect(out).toContain('Choose how omdsh may access your workspace')
    expect(out).not.toContain('Usage: /permission')
  }, 200_000)
})
