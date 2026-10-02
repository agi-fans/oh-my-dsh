/**
 * Human-facing job wording shared by the `/jobs` panel and the completion
 * notice, so one job reads the same in both surfaces.
 * @module @agi-fans/dsh-tui/job-notice
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobStatus, JobView } from '@deepseek-ai/dsh-jobs'
import type { TuiNoticeOptions } from '../definition.ts'
import type { TranscriptState } from '../views/transcript-types.ts'
import { toolArgsObject } from '../chrome/tool-args.ts'
import { truncateToWidth, visibleWidth } from '../chrome/width.ts'

/** Merge only an identified job or an unambiguous command still awaiting its result. */
export function mergeJobSettlement(state: TranscriptState, job: NonNullable<TuiNoticeOptions['job']>): TranscriptState | undefined {
  const identified: number[] = []
  const pending: number[] = []
  state.blocks.forEach((block, index) => {
    if (block.kind !== 'tool') return
    if (!/^(bash|shell|pwsh|exec)$/u.test(block.name) && block.presentation?.call?.card !== 'terminal') return
    const explicitId = /^started background job (\S+)\s*$/u.exec(block.output)?.[1]
      ?? /\[still running after \d+ms; moved to background job ([^\s\]]+)\]/u.exec(block.output)?.[1]
    const id = block.job?.id ?? explicitId
    if (id !== undefined) {
      if (id === job.id) identified.push(index)
      return
    }
    const args = toolArgsObject(block.args)
    if (block.status === 'running' && block.startedAt !== undefined && block.startedAt <= job.startedAt
      && typeof args?.['command'] === 'string' && args['command'] === job.label) pending.push(index)
  })
  const matches = identified.length > 0 ? identified : pending
  if (matches.length !== 1) return undefined
  const index = matches[0]!
  const block = state.blocks[index]!
  if (block.kind !== 'tool') return undefined
  const blocks = [...state.blocks]
  blocks[index] = {
    ...block,
    status: job.status === 'completed' && block.status !== 'error' ? 'ok' : 'error',
    job: { id: job.id, status: job.status, detail: job.detail?.trim() || JOB_STATUS_WORD[job.status] },
  }
  return { ...state, blocks }
}

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
  const head = `Background job ${snapshot.id} ${JOB_STATUS_WORD[snapshot.status]}`
  const detail = truncateToWidth(snapshot.detail?.trim().split('\n')[0] ?? '', 28)
  const room = Math.max(0, 76 - visibleWidth(head) - (detail === '' ? 0 : visibleWidth(detail) + 3) - 3)
  const label = room < 8 ? '' : truncateToWidth(snapshot.label.trim().split('\n')[0] ?? '', room)
  return head
    + (label === '' ? '' : ` · ${label}`)
    + (detail === '' ? '' : ` · ${detail}`)
}

/**
 * Completion notice for one settlement, or `undefined` when it must stay
 * silent: subagent work is already reported by the live roster, and a job
 * owned by another session is not this terminal's business.
 */
export function jobNoticeFor(
  snapshot: { readonly kind: JobView['kind']; readonly id: string; readonly label: string; readonly status: JobStatus; readonly detail?: string },
  owner: Agent | undefined,
  active: Agent | undefined,
): string | undefined {
  if (snapshot.kind === 'subagent') return undefined
  if (owner === undefined || owner !== active) return undefined
  return formatJobNotice(snapshot)
}
