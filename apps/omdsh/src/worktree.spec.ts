/** Opt-in Worktree bundle through the real CLI and a local Git repository. */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bootTuiTurn, requestToolNames } from './test-support/tui-boot.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function temp(prefix: string): string { const root = mkdtempSync(join(tmpdir(), prefix)); roots.push(root); return root }
function fixture() {
  const cwd = temp('omdsh-worktree-repo-'), home = temp('omdsh-worktree-home-')
  const git = (...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
  execFileSync('git', ['init', '-q', cwd])
  writeFileSync(join(cwd, 'hello.txt'), 'committed\n')
  git('add', 'hello.txt')
  git('-c', 'user.name=omdsh test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Fixture')
  writeFileSync(join(cwd, 'hello.txt'), 'uncommitted\n')
  writeFileSync(join(cwd, 'untracked.txt'), 'stay here\n')
  const dir = join(home, 'profiles', 'omdsh')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-omdsh', private: true,
    dsh: { profile: { bundles: ['@agi-fans/oh-my-dsh', '@deepseek-ai/dsh-experimental-tool-worktree'] } } }))
  return { cwd, home, git }
}

describe('shipped Worktree integration', () => {
  it('creates from committed HEAD, keeps source changes and sends the new directory context', async () => {
    const { cwd, home, git } = fixture()
    const commit = git('rev-parse', 'HEAD')
    const turn = await bootTuiTurn({ cwd, home, preset: 'standard', toolCall: { name: 'create_worktree', arguments: JSON.stringify({ name: 'feature', from: 'HEAD' }) } })
    expect(turn.status, turn.output.slice(-2500)).toBe(0)
    expect(requestToolNames(turn.bodies[0])).toContain('create_worktree')
    const checkout = join(cwd, '.agents', 'worktrees', 'feature')
    expect(existsSync(checkout), JSON.stringify(turn.bodies.at(-1))).toBe(true)
    expect(readFileSync(join(checkout, 'hello.txt'), 'utf8')).toBe('committed\n')
    expect(existsSync(join(checkout, 'untracked.txt'))).toBe(false)
    expect(readFileSync(join(cwd, 'hello.txt'), 'utf8')).toBe('uncommitted\n')
    const request = JSON.stringify(turn.bodies.at(-1))
    expect(request).toContain('The working directory changed')
    expect(request).toContain(commit)
    expect(git('worktree', 'list', '--porcelain')).toContain('refs/heads/feature')
  }, 180_000)

  it('honors read-only Access without creating a checkout or branch', async () => {
    const { cwd, home, git } = fixture()
    const turn = await bootTuiTurn({ cwd, home, preset: 'standard', extraEnv: { OMDSH_PERMISSION_MODE: 'read-only' },
      toolCall: { name: 'create_worktree', arguments: JSON.stringify({ name: 'refused' }) } })
    expect(turn.status, turn.output.slice(-2500)).toBe(0)
    expect(existsSync(join(cwd, '.agents', 'worktrees', 'refused'))).toBe(false)
    expect(git('branch', '--list', 'refused')).toBe('')
    expect(JSON.stringify(turn.bodies.at(-1))).not.toContain('The working directory changed')
  }, 180_000)
})
