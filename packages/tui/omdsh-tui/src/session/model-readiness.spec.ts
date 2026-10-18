import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { modelRouteReady } from './model-readiness.ts'

function context(options: {
  configured?: (ref: string) => boolean
  settings?: readonly { ns: string; value: unknown }[]
}): Context {
  const ctx = new Context()
  if (options.configured !== undefined) {
    ctx.provide('credentials', {
      describe: async (ref: string) => ({ configured: options.configured!(ref), writable: true }),
    } as never)
  }
  if (options.settings !== undefined) {
    ctx.provide('settings', { describe: () => options.settings } as never)
  }
  return ctx
}

describe('first-run model readiness', () => {
  it('treats either DeepSeek credential reference as connected', async () => {
    expect(await modelRouteReady(context({ configured: ref => ref === 'DEEPSEEK_API_KEY', settings: [] }))).toBe(true)
    expect(await modelRouteReady(context({ configured: ref => ref === 'OMDSH_DEEPSEEK_API_KEY', settings: [] }))).toBe(true)
  })

  it('counts a configured pi-ai provider profile', async () => {
    const ready = await modelRouteReady(context({
      configured: () => false,
      settings: [{ ns: 'llm-pi-ai', value: { providers: { openrouter: { model: 'x' } } } }],
    }))
    expect(ready).toBe(true)
  })

  it('honors a custom DeepSeek key reference', async () => {
    const ready = await modelRouteReady(context({
      configured: ref => ref === 'MY_DEEPSEEK_KEY',
      settings: [{ ns: 'llm-deepseek', value: { apiKeyEnv: 'MY_DEEPSEEK_KEY' } }],
    }))
    expect(ready).toBe(true)
  })

  it('reports not connected only when both seams answered empty', async () => {
    const ready = await modelRouteReady(context({ configured: () => false, settings: [] }))
    expect(ready).toBe(false)
  })

  it('stays optimistic when a seam is unavailable', async () => {
    expect(await modelRouteReady(context({ configured: () => false }))).toBe(true)
    expect(await modelRouteReady(context({ settings: [] }))).toBe(true)
    expect(await modelRouteReady(new Context())).toBe(true)
  })
})
