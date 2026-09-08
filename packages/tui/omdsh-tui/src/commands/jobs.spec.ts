import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { JobId, type JobSnapshot } from '@deepseek-ai/dsh-jobs'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { TuiService } from '../definition.ts'
import * as commandJobs from './jobs.ts'
import { jobsText } from './jobs.ts'

function snapshot(overrides: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    id: JobId('bash-1'),
    kind: 'bash',
    label: 'pnpm test',
    status: 'running',
    startedAt: 1_000,
    reported: false,
    ...overrides,
  }
}

interface JobsHarness {
  ctx: Context
  scope: Scope
  agent: Agent
  kill: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
}

async function jobsHarness(jobs: readonly JobSnapshot[]): Promise<JobsHarness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const kill = vi.fn(() => 'requested' as const)
  const list = vi.fn(() => [...jobs])
  ctx.provide('tui', {} as unknown as TuiService)
  ctx.provide('jobs', { list, kill } as never)
  const session = ctx.sessions.create(SessionId('jobs-command-test'))
  const agent = { id: session.id, session, status: 'idle', inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => {
    scope = createScope(inner, agent)
    Object.defineProperty(scope.ctx, 'agent', { configurable: true, value: agent })
  }, { inject: ['commands'] }))
  await scope.ctx.plugin(commandJobs)
  return { ctx, scope, agent, kill, list }
}

async function run(ctx: Context, agent: Agent, line: string) {
  const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
  return execution?.result
}

describe('jobs command', () => {
  it('lists this session’s jobs with status and elapsed time', async () => {
    const { ctx, agent, list } = await jobsHarness([
      snapshot({ startedAt: 0 }),
      snapshot({
        id: JobId('bash-2'),
        label: 'pnpm build',
        status: 'completed',
        detail: 'exit code: 0',
        startedAt: 0,
        finishedAt: 42_000,
      }),
    ])
    const result = await run(ctx, agent, '/jobs')
    expect(result?.kind).toBe('success')
    expect(list).toHaveBeenCalledWith(agent)
    const text = result?.kind === 'success' ? result.text : ''
    expect(text).toContain('Jobs · 1 running · 1 finished')
    expect(text).toContain('| `bash-1` | running')
    expect(text).toContain('| `bash-2` | completed · 42s · exit code: 0 | pnpm build |')
    expect(text).toContain('`/jobs kill <id>` stops a running job.')
  })

  it('reports an empty session without a table', async () => {
    const { ctx, agent } = await jobsHarness([])
    const result = await run(ctx, agent, '/jobs')
    expect(result).toEqual({ kind: 'success', text: 'No background jobs in this session.' })
  })

  it('stops one job by id and reports an already-finished job', async () => {
    const { ctx, agent, kill } = await jobsHarness([snapshot()])
    expect(await run(ctx, agent, '/jobs kill bash-1')).toEqual({ kind: 'success', text: 'Stopping bash-1.' })
    expect(kill).toHaveBeenCalledWith(JobId('bash-1'), agent, 'stopped from /jobs')
    kill.mockReturnValueOnce('already-finished' as never)
    expect(await run(ctx, agent, '/jobs kill bash-1'))
      .toEqual({ kind: 'success', text: 'bash-1 has already finished.' })
  })

  it('rejects unknown subcommands and a missing id', async () => {
    const { ctx, agent } = await jobsHarness([snapshot()])
    expect(await run(ctx, agent, '/jobs stop')).toEqual({ kind: 'error', text: 'Usage: /jobs [kill <id>]' })
    expect(await run(ctx, agent, '/jobs kill')).toEqual({ kind: 'error', text: 'Usage: /jobs kill <id>' })
  })

  it('surfaces a registry rejection as an error result', async () => {
    const { ctx, agent, kill } = await jobsHarness([snapshot()])
    kill.mockImplementationOnce(() => { throw new Error('unknown job: bash-9') })
    expect(await run(ctx, agent, '/jobs kill bash-9'))
      .toEqual({ kind: 'error', text: 'unknown job: bash-9' })
  })
})

describe('jobsText', () => {
  it('renders a running job without a finish time against the injected clock', () => {
    const text = jobsText([snapshot({ startedAt: 0 })], 134_000)
    expect(text).toContain('| `bash-1` | running · 2m14s | pnpm test |')
  })

  it('escapes a pipe in a job label so the table stays valid', () => {
    const text = jobsText([snapshot({ label: 'grep a|b' })], 1_000)
    expect(text).toContain('grep a\\|b')
  })
})
