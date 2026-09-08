/**
 * Human-facing background-job surface over the Harness job registry.
 * `/jobs` lists this session's jobs; `/jobs kill <id>` requests cancellation.
 * Output stays with the model: the registry's read cursor is consuming, so a
 * human read would steal the model's next `job_output`.
 * @module @agi-fans/dsh-tui/command-jobs
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { JobId, type JobSnapshot } from '@deepseek-ai/dsh-jobs'
import { formatDuration } from '../chrome/status-line.ts'
import { JOB_STATUS_WORD } from '../session/job-notice.ts'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-jobs'
export const inject = ['commands', 'jobs']

function elapsed(snapshot: JobSnapshot, now: number): string {
  const end = snapshot.finishedAt ?? now
  return formatDuration(Math.max(0, end - snapshot.startedAt))
}

function statusCell(snapshot: JobSnapshot, now: number): string {
  const parts = [JOB_STATUS_WORD[snapshot.status], elapsed(snapshot, now)]
  if (snapshot.detail !== undefined && snapshot.detail.trim() !== '') parts.push(snapshot.detail.trim())
  return parts.join(' · ')
}

/** Markdown panel for `/jobs`; `now` is injected so the rendering stays pure. */
export function jobsText(jobs: readonly JobSnapshot[], now: number): string {
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
    '`/jobs kill <id>` stops a running job.',
  ].join('\n')
}

function killJob(ctx: Context, invocation: CommandInvocation): CommandResult {
  const id = invocation.rawInput.trim()
  if (id === '') return { kind: 'error', text: 'Usage: /jobs kill <id>' }
  try {
    const outcome = ctx.jobs.kill(JobId(id), invocation.agent, 'stopped from /jobs')
    return {
      kind: 'success',
      text: outcome === 'requested' ? `Stopping ${id}.` : `${id} has already finished.`,
    }
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

function showJobs(ctx: Context, invocation: CommandInvocation): CommandResult {
  const raw = invocation.rawInput.trim()
  if (raw === '') {
    return { kind: 'success', text: jobsText(ctx.jobs.list(invocation.agent), Date.now()) }
  }
  const [verb, ...rest] = raw.split(/\s+/u)
  if (verb === 'kill') {
    const id = rest[0]
    if (id === undefined || rest.length > 1) return { kind: 'error', text: 'Usage: /jobs kill <id>' }
    return killJob(ctx, { ...invocation, rawInput: id })
  }
  return { kind: 'error', text: 'Usage: /jobs [kill <id>]' }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [
    {
      name: 'jobs',
      description: 'List background jobs or stop one',
      input: { hint: '[kill <id>]' },
      handler: invocation => showJobs(ctx, invocation),
    },
  ], 'omdsh jobs command')
}
