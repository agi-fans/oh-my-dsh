/**
 * Human-facing background-job surface over the Harness job registry.
 * `/jobs` lists this session's jobs, `/jobs <id>` replays one run's observer-only
 * narration, and `/jobs kill <id>` requests cancellation.
 *
 * Reading `stdout` and `stderr` stays with the model: those channels feed the
 * registry's consuming cursor, so a human read would steal the model's next
 * `job_output`. The `log` channel is the opposite — the Harness marks it as
 * producer narration that only observers see, which is why a workflow's phase
 * lines can be replayed here without taking anything from the model.
 *
 * @module @agi-fans/dsh-tui/command-jobs
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { JobId, type JobOutputRead, type JobView } from '@deepseek-ai/dsh-jobs'
import { formatDuration } from '../chrome/status-line.ts'
import { JOB_STATUS_WORD } from '../session/job-notice.ts'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-jobs'
export const inject = ['commands', 'jobs']

function elapsed(snapshot: JobView, now: number): string {
  const end = snapshot.finishedAt ?? now
  return formatDuration(Math.max(0, end - snapshot.startedAt))
}

function statusCell(snapshot: JobView, now: number): string {
  const parts = [JOB_STATUS_WORD[snapshot.status], elapsed(snapshot, now)]
  if (snapshot.detail !== undefined && snapshot.detail.trim() !== '') parts.push(snapshot.detail.trim())
  return parts.join(' · ')
}

/** Markdown panel for `/jobs`; `now` is injected so the rendering stays pure. */
export function jobsText(jobs: readonly JobView[], now: number): string {
  if (jobs.length === 0) return 'No background jobs in this session.'
  const running = jobs.filter(job => job.status === 'running' || job.status === 'stopping').length
  const settled = jobs.length - running
  const summary = [running === 0 ? '' : `${running} running`, settled === 0 ? '' : `${settled} finished`]
    .filter(part => part !== '')
    .join(' · ')
  return [
    `Jobs · ${summary}`,
    '',
    '| Job | Status | Description |',
    '|---|---|---|',
    ...jobs.map(job => `| \`${job.id}\` | ${statusCell(job, now)} | ${(job.label || '—').replace(/\|/gu, '\\|')} |`),
    '',
    '`/jobs <id>` replays a run\'s narration. `/jobs kill <id>` stops a running job.',
  ].join('\n')
}

function killJob(ctx: Context, invocation: CommandInvocation): CommandResult {
  const id = invocation.rawInput.trim()
  if (id === '') return { kind: 'error', text: 'Usage: /jobs kill <id>' }
  try {
    const outcome = ctx.jobs.kill(JobId(id), invocation.agent.session.id, 'stopped from /jobs')
    return {
      kind: 'success',
      text: outcome === 'requested' ? `Stopping ${id}.` : `${id} has already finished.`,
    }
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The observer-only narration of one run, newest last.
 *
 * `readAt` from zero reads retained bytes at absolute offsets without moving the
 * model's cursor; only `log` chunks are printed, because `stdout` and `stderr`
 * belong to the model's own read. A lossy read says so rather than pretending the
 * run started where retention begins.
 */
export function runText(snapshot: JobView, read: JobOutputRead, now: number): string {
  const narration = read.chunks.filter(chunk => chunk.channel === 'log')
  const header = `${snapshot.label || snapshot.kind} · ${statusCell(snapshot, now)}`
  if (narration.length === 0) {
    return [header, '', read.chunks.length === 0
      ? 'This run has not narrated anything yet.'
      : 'This run only wrote model-facing output, which stays with the model.'].join('\n')
  }
  return [
    header,
    '',
    ...(read.lossy ? ['Earlier narration is no longer retained.', ''] : []),
    ...narration.map(chunk => (chunk.gapBefore === true ? '…\n' : '') + chunk.text.replace(/\n$/u, '')),
  ].join('\n')
}

function showRun(ctx: Context, invocation: CommandInvocation, id: string): CommandResult {
  const sessionId = invocation.agent.session.id
  const snapshot = ctx.jobs.list(sessionId).find(job => String(job.id) === id)
  if (snapshot === undefined) return { kind: 'error', text: `No job ${id} in this session.` }
  try {
    return { kind: 'success', text: runText(snapshot, ctx.jobs.readAt(JobId(id), 0, sessionId), Date.now()) }
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

function showJobs(ctx: Context, invocation: CommandInvocation): CommandResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') {
    return { kind: 'success', text: jobsText(ctx.jobs.list(invocation.agent.session.id), Date.now()) }
  }
  const [verb, ...rest] = raw.split(/\s+/u)
  if (verb === 'kill') {
    const id = rest[0]
    if (id === undefined || rest.length > 1) return { kind: 'error', text: 'Usage: /jobs kill <id>' }
    return killJob(ctx, { ...invocation, rawInput: id })
  }
  if (rest.length === 0) return showRun(ctx, invocation, verb!)
  return { kind: 'error', text: 'Usage: /jobs [<id>|kill <id>]' }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [
    {
      name: 'jobs',
      description: 'List background jobs, replay one run, or stop one',
      input: { hint: '[<id>|kill <id>]' },
      handler: invocation => showJobs(ctx, invocation),
    },
  ], 'omdsh jobs command')
}
