import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import * as runner from './runner.ts'
import type { TuiSubmission } from '../definition.ts'

describe('runner managed children on EOF', () => {
  it('exits an interactive terminal without waiting for active parent or background children', async () => {
    const ctx = new Context()
    const pending = Promise.withResolvers<void>()
    const whenIdle = vi.fn(() => pending.promise)
    const waitForTreeWork = vi.fn(() => pending.promise)
    const exit = vi.fn()
    const off = () => () => {}
    ctx.provide('tui', { interactive: true, readInput: async () => null, onInterrupt: off, onQueueEdit: off, onRewind: off } as never)
    ctx.provide('omdshSession', { start: async () => {}, agent: { whenIdle } } as never)
    ctx.provide('omdshStartup', { afterSessionStart: async () => {} } as never)
    ctx.provide('subagents', { waitForTreeWork } as never)
    ctx.provide('appExit', exit)
    try {
      await ctx.plugin(runner)
      await vi.waitFor(() => { expect(exit).toHaveBeenCalledWith(0) })
      expect(whenIdle).not.toHaveBeenCalled()
      expect(waitForTreeWork).not.toHaveBeenCalled()
    } finally { pending.resolve(); await ctx.fiber.dispose() }
  })

  it('releases an unloaded runner while children are pending without exiting the surviving host', async () => {
    const ctx = new Context()
    const settlement = Promise.withResolvers<boolean>()
    const waitForTreeWork = vi.fn(() => settlement.promise)
    const exit = vi.fn()
    const off = () => () => {}
    ctx.provide('tui', { readInput: async () => null, onInterrupt: off, onQueueEdit: off, onRewind: off } as never)
    ctx.provide('omdshSession', { start: async () => {}, agent: { whenIdle: async () => {} } } as never)
    ctx.provide('omdshStartup', { afterSessionStart: async () => {} } as never)
    ctx.provide('subagents', { waitForTreeWork } as never)
    ctx.provide('appExit', exit)
    try {
      const fiber = await ctx.plugin(runner)
      await vi.waitFor(() => { expect(waitForTreeWork).toHaveBeenCalledOnce() })
      await fiber.dispose()
      // The runner owns no resend loop any more, so unloading only has to
      // release the reader and leave the host alive.
      await new Promise(resolve => setImmediate(resolve))
      expect(exit).not.toHaveBeenCalled()
      settlement.resolve(true)
      await new Promise(resolve => setImmediate(resolve))
      expect(exit).not.toHaveBeenCalled()
    } finally { settlement.resolve(false); await ctx.fiber.dispose() }
  })

  it('joins child settlement and rechecks the parent before disposing the host', async () => {
    const ctx = new Context()
    const order: string[] = []
    const releaseChild = Promise.withResolvers<boolean>()
    const agent = { whenIdle: async () => { order.push('idle') } }
    const waitForTreeWork = vi.fn().mockImplementationOnce(() => { order.push('children'); return releaseChild.promise }).mockResolvedValue(false)
    const exit = vi.fn()
    const off = () => () => {}
    ctx.provide('tui', { readInput: async () => null, onInterrupt: off, onQueueEdit: off, onRewind: off } as never)
    ctx.provide('omdshSession', { start: async () => {}, agent } as never)
    ctx.provide('omdshStartup', { afterSessionStart: async () => {} } as never)
    ctx.provide('omdshLoop', { disable: () => {} } as never)
    ctx.provide('subagents', { waitForTreeWork } as never)
    ctx.provide('appExit', exit)
    try {
      await ctx.plugin(runner)
      await vi.waitFor(() => { expect(waitForTreeWork).toHaveBeenCalledOnce() })
      expect(exit).not.toHaveBeenCalled()
      releaseChild.resolve(true)
      await vi.waitFor(() => { expect(exit).toHaveBeenCalledWith(0) })
      expect(order).toEqual(['idle', 'children', 'idle'])
      expect(waitForTreeWork).toHaveBeenCalledTimes(2)
    } finally { releaseChild.resolve(false); await ctx.fiber.dispose() }
  })
})

describe('runner Composer Shell dispatch', () => {
  it.each([false, true])('routes deliberate ! to the terminal and literal ! to the Agent (literal=%s)', async literal => {
    const ctx = new Context()
    const input: TuiSubmission[] = [{ text: '!echo hello', images: [], ...(literal ? { literal: true } : {}) }]
    const send = vi.fn(), execute = vi.fn(), exit = vi.fn(), prompt = vi.fn(async () => null), notice = vi.fn(), restoreInput = vi.fn()
    const agent = { session: { header: { cwd: '/workspace' } }, whenIdle: async () => {} }
    const spawn = vi.fn(async () => ({ sessionId: 'owned' })), startSend = vi.fn(() => ({ done: Promise.resolve(), cancel: vi.fn() }))
    const off = () => () => {}
    // The card surface a `!` line runs through; the runner only has to hand it
    // the request, so the reduce form is enough here.
    const shellCommand = vi.fn(async (request: { run: (onOutput: (output: string) => void, signal: AbortSignal) => Promise<unknown>; signal: AbortSignal }) => request.run(() => {}, request.signal))
    ctx.provide('tui', { interactive: true, readInput: async () => input.shift() ?? null, notice, restoreInput,
      prompt, shellCommand, onInterrupt: off, onQueueEdit: off, onRewind: off } as never)
    ctx.provide('omdshSession', { start: async () => {}, agent, send, execute } as never)
    ctx.provide('omdshStartup', { afterSessionStart: async () => {} } as never)
    ctx.provide('omdshLoop', { disable: () => {}, syncAgent: () => {}, submit: async () => false } as never)
    ctx.provide('terminals', { spawn, startSend, list: () => [{ sessionId: 'owned', type: 'shell', status: { kind: 'running' } }],
      read: () => ({ text: '', lineBegin: 0, lineEnd: 0, totalLines: 0, truncated: false }) } as never)
    ctx.provide('appExit', exit)
    try {
      await ctx.plugin(runner)
      await vi.waitFor(() => { expect(exit).toHaveBeenCalledWith(0) })
      expect(execute).not.toHaveBeenCalled()
      expect(restoreInput).not.toHaveBeenCalled()
      if (literal) {
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ text: '!echo hello', literal: true }), expect.any(Object))
        expect(startSend).not.toHaveBeenCalled()
      } else {
        expect(send).not.toHaveBeenCalled()
        // A `!` line now runs into a transcript card, so no reader prompt opens.
        expect(prompt).not.toHaveBeenCalled()
        expect(shellCommand).toHaveBeenCalledOnce()
        expect(startSend).toHaveBeenCalledWith(agent, 'owned', expect.objectContaining({ text: 'echo hello', submit: true }))
      }
    } finally { await ctx.fiber.dispose() }
  })
})


describe('runner pending-input safety', () => {
  it('stops the active turn without clearing either accepted inbox', async () => {
    const ctx = new Context()
    const pending = Promise.withResolvers<null>()
    let interrupt: (() => void) | undefined
    const cancel = vi.fn()
    const off = () => () => {}
    ctx.provide('tui', { readInput: () => pending.promise, onInterrupt: (listener: () => void) => { interrupt = listener; return () => {} }, onQueueEdit: off, onRewind: off } as never)
    ctx.provide('omdshSession', { start: async () => {}, interruptVisible: () => false, agent: { cancel, whenIdle: async () => {} } } as never)
    ctx.provide('omdshStartup', { afterSessionStart: async () => {} } as never)
    ctx.provide('appExit', vi.fn())
    try {
      await ctx.plugin(runner)
      await vi.waitFor(() => { expect(interrupt).toBeDefined() })
      interrupt!()
      expect(cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    } finally { pending.resolve(null); await ctx.fiber.dispose() }
  })

  it.each(['queue', 'steer'] as const)('restores a failed mixed %s submission exactly once without retrying', async delivery => {
    const ctx = new Context()
    const submission: TuiSubmission = { text: '/literal', images: [{ data: new Uint8Array([1]), mediaType: 'image/png' }], literal: true, delivery }
    const inputs = [submission]
    const send = vi.fn(async () => { throw new Error('attachment save failed') })
    const restoreInput = vi.fn(), exit = vi.fn(), off = () => () => {}
    ctx.provide('tui', { readInput: async () => inputs.shift() ?? null, onInterrupt: off, onQueueEdit: off, onRewind: off, restoreInput, notice: vi.fn() } as never)
    ctx.provide('omdshSession', { start: async () => {}, send, agent: { whenIdle: async () => {} } } as never)
    ctx.provide('omdshStartup', { afterSessionStart: async () => {} } as never)
    ctx.provide('appExit', exit)
    try {
      await ctx.plugin(runner)
      await vi.waitFor(() => { expect(exit).toHaveBeenCalledWith(0) })
      expect(send).toHaveBeenCalledOnce()
      expect(send).toHaveBeenCalledWith(submission, expect.any(Object))
      expect(restoreInput).toHaveBeenCalledOnce()
      expect(restoreInput).toHaveBeenCalledWith(submission, undefined)
    } finally { await ctx.fiber.dispose() }
  })
})

describe('runner attachment command dispatch', () => {
  it.each(['command', 'literal', 'unknown', 'throw', 'cancel'] as const)('keeps the complete draft and command intent (%s)', async mode => {
    const ctx = new Context()
    const submission: TuiSubmission = { text: '/plan task', images: [], files: [{ attachmentId: 'file:test' as never, name: 'task.txt', bytes: 5 }],
      segments: [{ kind: 'file', index: 0 }, { kind: 'text', text: '/plan task' }], ...(mode === 'literal' ? { literal: true } : {}) }
    const inputs = [submission], send = vi.fn(), restoreInput = vi.fn(), exit = vi.fn(), notice = vi.fn(), off = () => () => {}
    let interrupt: (() => void) | undefined
    const execute = vi.fn(async (_draft, signal: AbortSignal) => {
      if (mode === 'cancel') { interrupt!(); signal.throwIfAborted() }
      if (mode === 'throw') throw new Error('admission failed')
      return mode !== 'unknown'
    })
    ctx.provide('tui', { interactive: true, readInput: async () => inputs.shift() ?? null, onInterrupt: listener => { interrupt = listener; return () => {} },
      onQueueEdit: off, onRewind: off, restoreInput, notice } as never)
    ctx.provide('omdshSession', { start: async () => {}, send, execute, interruptVisible: () => false,
      agent: { session: { id: 'origin' }, cancel: vi.fn(), whenIdle: async () => {} } } as never)
    ctx.provide('omdshStartup', { afterSessionStart: async () => {} } as never)
    ctx.provide('appExit', exit)
    try {
      await ctx.plugin(runner)
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
      if (mode === 'literal') { expect(send).toHaveBeenCalledWith(submission, expect.any(Object)); expect(execute).not.toHaveBeenCalled() }
      else { expect(execute).toHaveBeenCalledWith(submission, expect.any(AbortSignal)); expect(send).not.toHaveBeenCalled() }
      if (['unknown', 'throw', 'cancel'].includes(mode)) {
        expect(restoreInput).toHaveBeenCalledOnce()
        expect(restoreInput).toHaveBeenCalledWith(submission, 'origin')
      } else expect(restoreInput).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })
})

it.each(['before-dispatch', 'upload-failure'] as const)('restores to the originating session after %s switch', async mode => {
  const ctx = new Context()
  const a = { id: 'a', session: { id: 'a' } }, b = { id: 'b', session: { id: 'b' } }
  let agent = a
  const submission: TuiSubmission = { text: 'for A', images: [] }
  const inputs = [submission]
  const restoreInput = vi.fn(), acknowledge = vi.fn(), exit = vi.fn(), off = () => () => {}
  const send = vi.fn(async () => { agent = b; throw new Error('upload failed') })
  ctx.provide('tui', { interactive: true, readInput: async () => {
    const value = inputs.shift() ?? null
    if (mode === 'before-dispatch') agent = b
    return value
  }, onInterrupt: off, onQueueEdit: off, onRewind: off, restoreInput, notice: vi.fn(),
  pendingInputs: { receipt: () => ({ id: 'receipt', sessionId: 'a' }), acknowledge } } as never)
  ctx.provide('omdshSession', { start: async () => {}, get agent() { return agent }, send } as never)
  ctx.provide('omdshStartup', { afterSessionStart: async () => {} } as never)
  ctx.provide('appExit', exit)
  try {
    await ctx.plugin(runner)
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    expect(restoreInput).toHaveBeenCalledOnce()
    expect(restoreInput).toHaveBeenCalledWith(submission, 'a')
    if (mode === 'before-dispatch') expect(send).not.toHaveBeenCalled()
    else expect(send).toHaveBeenCalledWith(submission, a)
    expect(acknowledge).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose() }
})


it.each(['unknown', 'error'])('restores a plain command after %s without executing it again', async outcome => {
  const ctx = new Context(), submission = { text: '/example draft', images: [] }, inputs = [submission]
  const restoreInput = vi.fn(), acknowledge = vi.fn(), exit = vi.fn(), off = () => () => {}
  const execute = vi.fn(async () => { if (outcome === 'error') throw new Error('unavailable'); return false })
  ctx.provide('tui', { interactive: true, readInput: async () => inputs.shift() ?? null, onInterrupt: off, onQueueEdit: off, onRewind: off,
    restoreInput, pendingInputs: { acknowledge }, notice: vi.fn() } as never)
  ctx.provide('omdshSession', { start: async () => {}, execute, agent: { session: { id: 'origin' } } } as never)
  ctx.provide('omdshStartup', { afterSessionStart: async () => {} } as never)
  ctx.provide('appExit', exit)
  try {
    await ctx.plugin(runner)
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    expect(restoreInput).toHaveBeenCalledWith(submission, 'origin')
    expect(acknowledge).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledOnce()
  } finally { await ctx.fiber.dispose() }
})
