import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { JobId, type JobSnapshot } from '@deepseek-ai/dsh-jobs'
import { formatJobNotice, jobNoticeFor } from './job-notice.ts'

const owner = { id: 'owner' } as unknown as Agent
const other = { id: 'other' } as unknown as Agent

function snapshot(overrides: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    id: JobId('bash-1'),
    kind: 'bash',
    label: 'pnpm test',
    status: 'completed',
    startedAt: 0,
    reported: true,
    ...overrides,
  }
}

describe('formatJobNotice', () => {
  it('names the job, its outcome, label, and producer detail', () => {
    expect(formatJobNotice(snapshot({ detail: 'exit code: 0' })))
      .toBe('Background job bash-1 completed · pnpm test · exit code: 0')
    expect(formatJobNotice(snapshot({ status: 'killed' }))).toBe('Background job bash-1 stopped · pnpm test')
    expect(formatJobNotice(snapshot({ status: 'failed', label: '  ', detail: '  ' })))
      .toBe('Background job bash-1 failed')
  })
})

describe('jobNoticeFor', () => {
  it('notices the active session’s own background job', () => {
    expect(jobNoticeFor(snapshot(), owner, owner)).toContain('Background job bash-1 completed')
  })

  it('stays silent for subagent jobs and other owners', () => {
    expect(jobNoticeFor(snapshot({ kind: 'subagent' }), owner, owner)).toBeUndefined()
    expect(jobNoticeFor(snapshot(), other, owner)).toBeUndefined()
    expect(jobNoticeFor(snapshot(), undefined, owner)).toBeUndefined()
    expect(jobNoticeFor(snapshot(), owner, undefined)).toBeUndefined()
  })
})
