import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { migrateLegacyDeepSeekCredential } from './credential-migration.ts'

const LEGACY = 'OMDSH_DEEPSEEK_API_KEY'
const UPSTREAM = 'DEEPSEEK_API_KEY'

function harness(options: { legacy?: boolean, upstream?: boolean } = {}) {
  const ctx = new Context()
  const configured = new Map([[LEGACY, options.legacy ?? true], [UPSTREAM, options.upstream ?? false]])
  const set = vi.fn(async () => { configured.set(UPSTREAM, true) })
  const unset = vi.fn(async () => { configured.set(LEGACY, false) })
  const mutate = vi.fn(async () => {})
  ctx.provide('credentials', {
    describe: async (ref: unknown) => ({ configured: configured.get(String(ref)) ?? false, writable: true }),
    resolve: async (ref: unknown) => configured.get(String(ref)) === true ? { value: 'sk-legacy', source: 'file' } : undefined,
    set,
    unset,
  } as never)
  ctx.provide('settings', {
    describe: () => [{ ns: 'llm-deepseek', value: { apiKeyEnv: LEGACY } }],
    mutate,
  } as never)
  return { ctx, set, unset, mutate }
}

describe('legacy DeepSeek credential migration', () => {
  it('imports the product-era key and resets the provider reference', async () => {
    const h = harness()
    await expect(migrateLegacyDeepSeekCredential(h.ctx)).resolves.toBe(true)
    expect(h.set).toHaveBeenCalledWith(expect.anything(), 'sk-legacy')
    expect(h.mutate).toHaveBeenCalledWith('llm-deepseek', [{ op: 'unset', path: ['apiKeyEnv'] }])
    expect(h.unset).toHaveBeenCalledWith(expect.anything())
  })

  it('does not overwrite an upstream key that already exists', async () => {
    const h = harness({ upstream: true })
    await expect(migrateLegacyDeepSeekCredential(h.ctx)).resolves.toBe(true)
    expect(h.set).not.toHaveBeenCalled()
    expect(h.unset).toHaveBeenCalled()
  })

  it('is a no-op without a legacy reference', async () => {
    const h = harness({ legacy: false })
    await expect(migrateLegacyDeepSeekCredential(h.ctx)).resolves.toBe(false)
    expect(h.set).not.toHaveBeenCalled()
    expect(h.unset).not.toHaveBeenCalled()
    expect(h.mutate).not.toHaveBeenCalled()
  })
})
