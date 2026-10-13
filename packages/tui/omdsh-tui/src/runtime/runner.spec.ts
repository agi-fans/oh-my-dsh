import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import * as runner from './runner.ts'

describe('runner managed children on EOF', () => {
  it('releases an unloaded runner while children are pending without exiting the surviving host', async () => {
    const ctx = new Context()
    const settlement = Promise.withResolvers<boolean>()
    const waitForChildren = vi.fn(() => settlement.promise)
    const disable = vi.fn(), exit = vi.fn()
    const off = () => () => {}
    ctx.provide('tui', { readInput: async () => null, onInterrupt: off, onQueueEdit: off, onRewind: off } as never)
    ctx.provide('omdshSession', { start: async () => {}, agent: { whenIdle: async () => {} } } as never)
    ctx.provide('omdshStartup', { afterSessionStart: async () => {} } as never)
    ctx.provide('omdshLoop', { disable } as never)
    ctx.provide('subagents', { waitForChildren } as never)
    ctx.provide('appExit', exit)
    try {
      const fiber = await ctx.plugin(runner)
      await vi.waitFor(() => { expect(waitForChildren).toHaveBeenCalledOnce() })
      await fiber.dispose()
      await vi.waitFor(() => { expect(disable).toHaveBeenCalledOnce() })
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
    const waitForChildren = vi.fn().mockImplementationOnce(() => { order.push('children'); return releaseChild.promise }).mockResolvedValue(false)
    const exit = vi.fn()
    const off = () => () => {}
    ctx.provide('tui', { readInput: async () => null, onInterrupt: off, onQueueEdit: off, onRewind: off } as never)
    ctx.provide('omdshSession', { start: async () => {}, agent } as never)
    ctx.provide('omdshStartup', { afterSessionStart: async () => {} } as never)
    ctx.provide('omdshLoop', { disable: () => {} } as never)
    ctx.provide('subagents', { waitForChildren } as never)
    ctx.provide('appExit', exit)
    try {
      await ctx.plugin(runner)
      await vi.waitFor(() => { expect(waitForChildren).toHaveBeenCalledOnce() })
      expect(exit).not.toHaveBeenCalled()
      releaseChild.resolve(true)
      await vi.waitFor(() => { expect(exit).toHaveBeenCalledWith(0) })
      expect(order).toEqual(['idle', 'children', 'idle'])
      expect(waitForChildren).toHaveBeenCalledTimes(2)
    } finally { releaseChild.resolve(false); await ctx.fiber.dispose() }
  })
})
