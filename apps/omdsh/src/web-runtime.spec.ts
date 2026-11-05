import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import OmdshWebRuntime from './web-runtime.ts'

const search = (id: string) => ({ id, available: () => true, search: vi.fn(async () => ({ sources: [], truncated: false })) })

describe('published web registration projection', () => {
  it('tracks plugin scope registration, explicit removal and re-registration without replacing execution', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(OmdshWebRuntime, { searchProvider: 'extra' })
      const provider = search('extra')
      let remove: (() => void) | undefined
      const scope = ctx.plugin({ inject: ['web'], apply(ctx: Context) { remove = ctx.web.registerSearchProvider(provider) } })
      await scope
      expect(ctx.omdshWebProviders.list().search).toEqual([{ id: 'extra', available: true }])
      await ctx.web.search({ query: 'local fixture' })
      expect(provider.search).toHaveBeenCalledOnce()
      remove!()
      expect(ctx.omdshWebProviders.list().search).toEqual([])
      await scope.dispose()
      const replacement = ctx.plugin({ inject: ['web'], apply(ctx: Context) { ctx.web.registerSearchProvider(search('extra')) } })
      await replacement
      expect(ctx.omdshWebProviders.list().search).toHaveLength(1)
      await replacement.dispose()
      expect(ctx.omdshWebProviders.list().search).toEqual([])
      await expect(ctx.web.search({ query: 'gone' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
    } finally { await ctx.fiber.dispose() }
  })

  it('contains availability and observer errors, preserves duplicate rejection and clears fetch registrations', async () => {
    const ctx = new Context(), changed = vi.fn()
    try {
      await ctx.plugin(OmdshWebRuntime, {})
      ctx.on('omdsh/web-providers-changed', changed)
      ctx.on('omdsh/web-providers-changed', () => { throw new Error('observer failed') })
      const provider = { id: 'http', available: () => { throw new Error('unavailable') }, fetch: vi.fn() }
      const scope = ctx.plugin({ inject: ['web'], apply(ctx: Context) { ctx.web.registerFetchProvider(provider) } })
      await scope
      expect(ctx.omdshWebProviders.list()).toEqual({ search: [], fetch: [{ id: 'http', available: false }] })
      expect(() => ctx.web.registerFetchProvider(provider)).toThrow()
      expect(ctx.omdshWebProviders.list().fetch).toHaveLength(1)
      await scope.dispose()
      expect(ctx.omdshWebProviders.list().fetch).toEqual([])
      expect(changed).toHaveBeenCalledTimes(2)
    } finally { await ctx.fiber.dispose() }
  })
})
