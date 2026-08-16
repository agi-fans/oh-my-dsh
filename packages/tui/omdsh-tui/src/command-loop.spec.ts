import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TuiLoopStatus, TuiService, TuiSubmission } from './definition.ts'
import { LoopRuntime, parseLoopRequest } from './command-loop.ts'

function fakeAgent(whenIdle: () => Promise<void> = async () => undefined): Agent {
  return { id: 'loop-test', status: 'idle', whenIdle } as unknown as Agent
}

function harness(agent: Agent, delay = 0): {
  runtime: LoopRuntime
  send: ReturnType<typeof vi.fn<(input: string | TuiSubmission, agent?: Agent) => Promise<void>>>
  statuses: Array<TuiLoopStatus | undefined>
  notices: string[]
} {
  const send = vi.fn(async (_input: string | TuiSubmission, _agent?: Agent) => undefined)
  const statuses: Array<TuiLoopStatus | undefined> = []
  const notices: string[] = []
  const runtime = new LoopRuntime({
    agent,
    assertActive(candidate): void {
      if (candidate !== agent) throw new Error('inactive')
    },
    send,
  }, {
    setLoopStatus: status => { statuses.push(status) },
    notice: text => { notices.push(text) },
  } as Pick<TuiService, 'notice' | 'setLoopStatus'>, delay, 0)
  return { runtime, send, statuses, notices }
}

describe('/loop request parsing', () => {
  it('accepts waiting, inline, count-limited, and duration-limited forms', () => {
    expect(parseLoopRequest('')).toEqual({})
    expect(parseLoopRequest('keep checking the tests')).toEqual({ prompt: 'keep checking the tests' })
    expect(parseLoopRequest('5')).toEqual({ limit: { kind: 'iterations', count: 5 } })
    expect(parseLoopRequest('5 fix the next failure')).toEqual({
      limit: { kind: 'iterations', count: 5 },
      prompt: 'fix the next failure',
    })
    expect(parseLoopRequest('1h30m review the build')).toEqual({
      limit: { kind: 'duration', durationMs: 5_400_000, label: '1h30m' },
      prompt: 'review the build',
    })
    expect(parseLoopRequest('10min')).toEqual({
      limit: { kind: 'duration', durationMs: 600_000, label: '10min' },
    })
  })

  it('rejects malformed or non-positive numeric limits', () => {
    expect(() => parseLoopRequest('0')).toThrow('positive integer')
    expect(() => parseLoopRequest('10x do work')).toThrow('Invalid loop limit')
  })
})

describe('LoopRuntime', () => {
  it('runs the inline prompt once and then submits the configured repeat count', async () => {
    const agent = fakeAgent()
    const { runtime, send, statuses, notices } = harness(agent)

    await runtime.enable(agent, parseLoopRequest('2 keep going'))
    await vi.waitFor(() => { expect(send).toHaveBeenCalledTimes(3) })

    expect(send).toHaveBeenCalledTimes(3)
    expect(send.mock.calls.map(call => (call[0] as TuiSubmission).text)).toEqual([
      'keep going',
      'keep going',
      'keep going',
    ])
    expect(statuses).toContainEqual({ phase: 'running', repeats: 0, total: 2 })
    expect(statuses).toContainEqual({ phase: 'running', repeats: 2, total: 2 })
    expect(statuses).toContainEqual({ phase: 'completed', repeats: 2, total: 2 })
    expect(notices).toEqual([])
  })

  it('waits for the next prompt and lets interrupt pause without disabling the mode', async () => {
    const neverIdle = new Promise<void>(() => {})
    const agent = fakeAgent(() => neverIdle)
    const { runtime, statuses } = harness(agent)

    await runtime.enable(agent, parseLoopRequest('3'))
    expect(statuses.at(-1)).toEqual({ phase: 'waiting', repeats: 0, total: 3 })

    await runtime.submit({ text: 'inspect this', images: [] }, agent)
    expect(statuses.at(-1)).toEqual({ phase: 'running', repeats: 0, total: 3 })
    expect(runtime.pause(agent)).toBe(true)
    expect(statuses.at(-1)).toEqual({ phase: 'paused', repeats: 0, total: 3 })
    expect(runtime.isEnabled(agent)).toBe(true)

    runtime.disable(agent)
    expect(statuses.at(-1)).toBeUndefined()
  })

  it('switches from waiting to running before the human prompt enters the session queue', async () => {
    const agent = fakeAgent(() => new Promise<void>(() => {}))
    const statuses: Array<TuiLoopStatus | undefined> = []
    let releaseSend: (() => void) | undefined
    const runtime = new LoopRuntime({
      agent,
      assertActive: vi.fn(),
      send: vi.fn(() => new Promise<void>((resolve) => { releaseSend = resolve })),
    }, {
      setLoopStatus: status => { statuses.push(status) },
      notice: vi.fn(),
    } as Pick<TuiService, 'notice' | 'setLoopStatus'>, 0, 0)

    await runtime.enable(agent, parseLoopRequest('2'))
    const dispatch = runtime.submit({ text: 'inspect this', images: [] }, agent)

    expect(statuses.at(-1)).toEqual({ phase: 'running', repeats: 0, total: 2 })
    releaseSend?.()
    await dispatch
    runtime.dispose()
  })

  it('restores the waiting state when the first prompt cannot be dispatched', async () => {
    const agent = fakeAgent(() => new Promise<void>(() => {}))
    const statuses: Array<TuiLoopStatus | undefined> = []
    const runtime = new LoopRuntime({
      agent,
      assertActive: vi.fn(),
      send: vi.fn(async () => { throw new Error('queue unavailable') }),
    }, {
      setLoopStatus: status => { statuses.push(status) },
      notice: vi.fn(),
    } as Pick<TuiService, 'notice' | 'setLoopStatus'>, 0, 0)

    await runtime.enable(agent, parseLoopRequest('2'))
    await expect(runtime.submit({ text: 'inspect this', images: [] }, agent)).rejects.toThrow('queue unavailable')
    expect(statuses.at(-1)).toEqual({ phase: 'waiting', repeats: 0, total: 2 })
    runtime.dispose()
  })
})
