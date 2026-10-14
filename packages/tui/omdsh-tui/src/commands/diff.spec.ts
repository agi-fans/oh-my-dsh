import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as commandDiff from './diff.ts'
import { formatChangeSummary, parseNumstat, untrackedFromStatus } from './diff.ts'

describe('parseNumstat', () => {
  it('parses added/removed counts and skips blank lines', () => {
    expect(parseNumstat('12\t3\tsrc/a.ts\n\n0\t7\tsrc/b.ts\n')).toEqual([
      { path: 'src/a.ts', added: 12, removed: 3, binary: false },
      { path: 'src/b.ts', added: 0, removed: 7, binary: false },
    ])
  })

  it('marks binary rows and keeps rename paths intact', () => {
    expect(parseNumstat('-\t-\tlogo.png\n1\t1\tsrc/{old => new}.ts\n')).toEqual([
      { path: 'logo.png', added: 0, removed: 0, binary: true },
      { path: 'src/{old => new}.ts', added: 1, removed: 1, binary: false },
    ])
  })

  it('ignores rows without a path', () => {
    expect(parseNumstat('\t\t\n')).toEqual([])
  })
})

describe('untrackedFromStatus', () => {
  it('collects only untracked rows', () => {
    const status = [
      ' M src/a.ts',
      '?? src/new.ts',
      'A  src/staged.ts',
      '?? docs/plan.md',
    ].join('\n')
    expect(untrackedFromStatus(status)).toEqual(['src/new.ts', 'docs/plan.md'])
  })
})

describe('formatChangeSummary', () => {
  it('reports a clean workspace', () => {
    expect(formatChangeSummary([], [])).toBe('No workspace changes.')
  })

  it('renders a table plus untracked list', () => {
    const text = formatChangeSummary(
      [{ path: 'src/a.ts', added: 12, removed: 3, binary: false }],
      ['docs/plan.md'],
    )
    expect(text).toContain('Workspace changes · 1 tracked · 1 untracked · +12 −3')
    expect(text).toContain('| `src/a.ts` | 12 | 3 |')
    expect(text).toContain('- `docs/plan.md`')
  })

  it('shows a dash for binary counts and truncates long lists', () => {
    const changes = [
      { path: 'logo.png', added: 0, removed: 0, binary: true },
      ...Array.from({ length: 25 }, (_, i) => ({ path: `f${i}.ts`, added: 1, removed: 1, binary: false })),
    ]
    const text = formatChangeSummary(changes, [])
    expect(text).toContain('| `logo.png` | — | — |')
    expect(text).toContain('more tracked files.')
    expect(text).not.toContain('f24.ts')
  })
})

describe('collect-only diff command', () => {
  it('registers /diff without touching commit or staging', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const fiber = await ctx.plugin(commandDiff)
    const session = ctx.sessions.create(SessionId('command-diff-test'))
    const agent = { id: session.id, session, status: 'idle' } as unknown as Agent

    expect(ctx.commands.list(agent).map(command => command.name)).toEqual(['diff', 'review'])
    expect(session.snapshotEvents().filter(event => event.type === 'command/run')).toEqual([])

    await fiber.dispose()
    expect(ctx.commands.list(agent)).toEqual([])
    await ctx.fiber.dispose()
  })
})

describe('interactive turn comparison', () => {
  it('uses the retained turn snapshot, not the current working tree', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const session = ctx.sessions.create(SessionId('turn-diff'))
    session.append('workspace/changes', { turn: 4, cwd: '/snapshot', files: [] } as never)
    const retained = session.snapshotEvents().at(-1)!
    const requests: import('../definition.ts').TuiPrompt[] = []
    const answers = ['0', null, null]
    ctx.provide('tui', { interactive: true, notice: () => {}, prompt: async (request: import('../definition.ts').TuiPrompt) => { requests.push(request); return answers.shift() ?? null } } as never)
    const calls: unknown[][] = []
    ctx.provide('workspaceChanges', {
      summary: () => ({ turn: 4, cwd: '/snapshot', files: [{ path: 'removed.txt', display: 'removed.txt', added: 0, deleted: 1 }] }),
      diff: async (...args: unknown[]) => { calls.push(args); return { kind: 'text', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 0, lines: ['-original'] }] } },
    } as never)
    await ctx.plugin(commandDiff)
    try {
      const result = await ctx.commands.execute({ id: session.id, session, status: 'idle' } as unknown as Agent, '/diff turn 4', [], new AbortController().signal)
      expect(result?.result).toEqual({ kind: 'success' })
      expect(requests[1]!.documentSource).toMatchObject({ diff: true, text: expect.stringContaining('-original') })
      expect(calls[0]!.slice(0, 3)).toEqual([session.id, retained.seq, 0])
    } finally { await ctx.fiber.dispose() }
  })
})

describe('interactive workspace comparison from a subdirectory', () => {
  const cases = ['unstaged', 'staged', 'untracked', 'unborn'].flatMap(state =>
    ['CHANGELOG.md', 'apps/omdsh/local.txt'].map(path => ({ state, path, target: '' })))
  cases.push({ state: 'unstaged', path: 'CHANGELOG.md', target: '../../CHANGELOG.md' },
    { state: 'unstaged', path: 'apps/omdsh/local.txt', target: 'local.txt' })
  it.each(cases)('previews and edits $state file $path (target "$target") at its actual location', async ({ state, path, target }) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'omdsh-diff-')))
    const cwd = join(root, 'apps', 'omdsh')
    const ctx = new Context()
    try {
      await mkdir(cwd, { recursive: true })
      execFileSync('git', ['init', '--quiet'], { cwd: root })
      if (state !== 'unborn') {
        if (state !== 'untracked') {
          await writeFile(join(root, 'CHANGELOG.md'), 'Before\n')
          await writeFile(join(cwd, 'local.txt'), 'Before\n')
          execFileSync('git', ['add', '.'], { cwd: root })
        }
        execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: root })
      }
      await writeFile(join(root, 'CHANGELOG.md'), 'Root changelog contents')
      await writeFile(join(cwd, 'local.txt'), 'Nested file contents')
      if (state === 'staged' || state === 'unborn') execFileSync('git', ['add', '.'], { cwd: root })
      await ctx.plugin(SessionStore)
      await ctx.plugin(CommandRuntime)
      const session = ctx.sessions.create(SessionId('nested-diff'), { meta: { cwd } })
      const requests: import('../definition.ts').TuiPrompt[] = []
      const openFileInEditor = vi.fn()
      const expected = path === 'CHANGELOG.md' ? 'Root changelog contents' : 'Nested file contents'
      ctx.provide('tui', { interactive: true, notice: () => {}, openFileInEditor,
        prompt: async (request: import('../definition.ts').TuiPrompt) => {
          requests.push(request)
          const documentStart = target === '' ? 2 : 1
          if (target === '' && requests.length === 1) return request.options?.find(option => option.label === path)?.value ?? null
          if (requests.length === documentStart) return 'preview'
          if (requests.length === documentStart + 1) return 'editor'
          return null
        },
      } as never)
      await ctx.plugin(commandDiff)
      const result = await ctx.commands.execute({ id: session.id, session, status: 'idle' } as unknown as Agent, `/diff ${target}`, [], new AbortController().signal)
      expect(result?.result).toEqual({ kind: 'success' })
      const documentStart = target === '' ? 1 : 0
      expect(requests[documentStart]?.documentSource?.text).toContain(expected)
      expect(requests[documentStart + 1]?.documentSource?.text).toContain(expected)
      expect(openFileInEditor).toHaveBeenCalledWith(join(root, path))
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('/review target selection', () => {
  async function reviewHarness(answers: (string | null)[]) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'omdsh-review-')))
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    await writeFile(join(root, 'hello.ts'), 'before\n')
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base'], { cwd: root })
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    await writeFile(join(root, 'hello.ts'), 'after\n')
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'change'], { cwd: root })
    await writeFile(join(root, 'untracked.txt'), 'keep me\n')
    const before = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const session = ctx.sessions.create(SessionId('review-target'), { meta: { cwd: root } })
    const steer = vi.fn()
    const prompt = vi.fn(async (_request: import('../definition.ts').TuiPrompt) => answers.shift() ?? null)
    ctx.provide('tui', { prompt, interactive: true } as never)
    await ctx.plugin(commandDiff)
    const agent = { id: session.id, session, status: 'idle', steer } as unknown as Agent
    return { root, ctx, base, before, steer, prompt, agent,
      execute: () => ctx.commands.execute(agent, '/review', [], new AbortController().signal),
      dispose: async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) } }
  }

  it.each(['changes', 'base', 'commit'])('queues an explicitly confirmed %s review with a verified Git target and preserves the worktree', async target => {
    const h = await reviewHarness(target === 'changes' ? [target, 'start'] : [target, 'HEAD~1', 'start'])
    try {
      expect((await h.execute())?.result.kind).toBe('success')
      expect(h.steer).toHaveBeenCalledTimes(1)
      const text = h.steer.mock.calls[0]![0].content[0].text
      expect(text).toContain(`Working directory: ${h.root}`)
      expect(text).toContain('Do not edit files')
      if (target === 'changes') expect(text).toContain('staged, unstaged and untracked')
      else expect(text).toContain(h.base)
      if (target === 'base') expect(text).toContain('Exclude staged, unstaged and untracked changes')
      if (target === 'commit') expect(text).toContain('only changes introduced by commit')
      expect(execFileSync('git', ['status', '--porcelain'], { cwd: h.root, encoding: 'utf8' })).toBe(h.before)
    } finally { await h.dispose() }
  })

  it.each([[null], ['changes', null], ['base', '--help'], ['commit', 'missing-revision']])('does not start a cancelled or invalid review (%j)', async (...answers) => {
    const h = await reviewHarness(answers as (string | null)[])
    try { await h.execute(); expect(h.steer).not.toHaveBeenCalled() } finally { await h.dispose() }
  })

  it('rejects review selection while a turn is running', async () => {
    const h = await reviewHarness([])
    try {
      Object.assign(h.agent, { status: 'running' })
      expect((await h.execute())?.result.kind).toBe('error')
      expect(h.prompt).not.toHaveBeenCalled()
      expect(h.steer).not.toHaveBeenCalled()
    } finally { await h.dispose() }
  })

  it.each(['/review changes', '/review base HEAD~1', '/review commit HEAD~1', '/review HEAD~1'])('starts %s directly without modal prompts', async commandLine => {
    const h = await reviewHarness([])
    try {
      const outcome = await h.ctx.commands.execute(h.agent, commandLine, [], new AbortController().signal)
      expect(outcome?.result.kind).toBe('success')
      expect(h.prompt).not.toHaveBeenCalled()
      expect(h.steer).toHaveBeenCalledTimes(1)
    } finally { await h.dispose() }
  })
})
