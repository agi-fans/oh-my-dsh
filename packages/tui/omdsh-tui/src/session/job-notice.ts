/**
 * Human-facing job wording shared by the `/jobs` panel and the completion
 * notice, so one job reads the same in both surfaces.
 * @module @agi-fans/dsh-tui/job-notice
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobKind, JobStatus } from '@deepseek-ai/dsh-jobs'

/** Past- or present-tense word for one lifecycle status. */
export const JOB_STATUS_WORD: Record<JobStatus, string> = {
  running: 'running',
  stopping: 'stopping',
  completed: 'completed',
  killed: 'stopped',
  failed: 'failed',
}

/** One human-facing completion line for a background job. */
export function formatJobNotice(snapshot: {
  readonly id: string
  readonly label: string
  readonly status: JobStatus
  readonly detail?: string
}): string {
  const label = snapshot.label.trim()
  const detail = snapshot.detail === undefined ? '' : snapshot.detail.trim()
  return `Background job ${snapshot.id} ${JOB_STATUS_WORD[snapshot.status]}`
    + (label === '' ? '' : ` · ${label}`)
    + (detail === '' ? '' : ` · ${detail}`)
}

/**
 * Completion notice for one settlement, or `undefined` when it must stay
 * silent: subagent work is already reported by the live roster, and a job
 * owned by another session is not this terminal's business.
 */
export function jobNoticeFor(
  snapshot: { readonly kind: JobKind; readonly id: string; readonly label: string; readonly status: JobStatus; readonly detail?: string },
  owner: Agent | undefined,
  active: Agent | undefined,
): string | undefined {
  if (snapshot.kind === 'subagent') return undefined
  if (owner === undefined || owner !== active) return undefined
  return formatJobNotice(snapshot)
}
