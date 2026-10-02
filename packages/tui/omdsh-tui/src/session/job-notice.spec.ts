import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { JobId, type JobView } from '@deepseek-ai/dsh-jobs'
import { formatJobNotice, jobNoticeFor, mergeJobSettlement } from './job-notice.ts'

import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { applyEvent, initialTranscript } from '../views/event-views.ts'
import { blockLines } from '../views/transcript-render.ts'
import { createTheme } from '../chrome/theme.ts'
import { visibleWidth } from '../chrome/width.ts'
import type { Block } from '../views/transcript-types.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const owner = { id: 'owner' } as unknown as Agent
const other = { id: 'other' } as unknown as Agent

function snapshot(overrides: Partial<JobView> = {}): JobView {
  return {
    id: JobId('bash-1'),
    kind: 'bash',
    label: 'pnpm test',
    status: 'completed',
    startedAt: 0,
    output: { total: 0, earliest: 0 },
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


describe('job settlement in the originating tool row', () => {
  const job = { id: 'bash-1', label: 'pnpm test', startedAt: 20, status: 'completed' as const }
  const tool = (over: Partial<Extract<Block, { kind: 'tool' }>> = {}): Extract<Block, { kind: 'tool' }> => ({
    kind: 'tool', callId: ToolCallId('c1'), name: 'bash', status: 'running', startedAt: 10,
    args: JSON.stringify({ command: 'pnpm test', description: 'Run tests' }), output: '', ...over,
  })
  const state = (...blocks: Block[]) => ({ ...initialTranscript(), blocks })

  it('updates a single live command without appending a duplicate or mutating its old snapshot', () => {
    const before = state(tool())
    const after = mergeJobSettlement(before, job)!
    expect(after.blocks).toHaveLength(1)
    expect(after.blocks[0]).toMatchObject({ status: 'ok', job: { id: 'bash-1' } })
    expect(before.blocks[0]).toMatchObject({ status: 'running' })
  })

  it.each(['started background job bash-1', 'partial output\n[still running after 100ms; moved to background job bash-1]'])('matches the published background acknowledgement: %s', output => {
    const before = state(tool({ status: 'ok', output }), tool({ callId: ToolCallId('c2') }))
    const after = mergeJobSettlement(before, job)!
    expect(after.blocks[0]).toHaveProperty('job.id', 'bash-1')
    expect(after.blocks[1]).not.toHaveProperty('job')
  })

  it('keeps ambiguous, unrelated and older jobs as independent notices', () => {
    expect(mergeJobSettlement(state(tool(), tool({ callId: ToolCallId('c2') })), job)).toBeUndefined()
    expect(mergeJobSettlement(state(tool({ startedAt: 30 })), job)).toBeUndefined()
    expect(mergeJobSettlement(state(tool({ output: 'started background job bash-2' })), job)).toBeUndefined()
    expect(mergeJobSettlement(state(tool({ name: 'read' })), job)).toBeUndefined()
    expect(mergeJobSettlement(state(), job)).toBeUndefined()
  })

  it.each(['failed', 'killed'] as const)('preserves %s even when the launch acknowledgement arrives later', status => {
    const settled = mergeJobSettlement(state(tool()), { ...job, status, detail: 'exit code: 3' })!
    const result = { type: 'tool/result', seq: 1, time: 30, data: {
      message: { role: 'tool', toolCallId: ToolCallId('c1'), content: [{ type: 'text', text: 'started background job bash-1' }] },
    } } as unknown as SessionEvent
    const after = applyEvent(settled, result)
    expect(after.blocks[0]).toMatchObject({ status: 'error' })
    for (const expanded of [false, true]) {
      const rows = blockLines(after.blocks[0]!, createTheme(false), 90, 0, expanded).join('\n')
      expect(rows).toContain('exit code: 3')
    }
  })

  it('bounds independent notices while preserving the outcome', () => {
    const text = formatJobNotice({ ...job, status: 'failed', label: '检查 🐳 é '.repeat(40), detail: 'exit code: 3' })
    expect(visibleWidth(text)).toBeLessThanOrEqual(76)
    expect(text).toContain('exit code: 3')
    expect(text).toContain('bash-1 failed')
  })
})
