import { describe, expect, it } from 'vitest'
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

    expect(ctx.commands.list(agent).map(command => command.name)).toEqual(['diff'])
    expect(session.snapshotEvents().filter(event => event.type === 'command/run')).toEqual([])

    await fiber.dispose()
    expect(ctx.commands.list(agent)).toEqual([])
    await ctx.fiber.dispose()
  })
})
