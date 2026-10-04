import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { TuiPrompt, TuiService } from '../definition.ts'
import * as config from './plugin-settings.ts'

const schema = z.object({
  timeout: z.number().min(1).step(1).description('Maximum wait in seconds'),
  mode: z.union(['fast', 'slow']),
  nested: z.object({ max: z.number() }),
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref'),
  profiles: z.array(z.object({ key: z.string().role('secret') })),
  hidden: z.string().hidden(),
})

describe('plugin configuration', () => {
  it('flattens objects, hides private fields, and protects compound secrets', () => {
    const fields = config.configFields(new z(schema.toJSON()))
    expect(fields.map(field => field.path.join('.'))).toEqual(['timeout', 'mode', 'nested.max', 'apiKey', 'apiKeyEnv', 'profiles'])
    expect(fields.find(field => field.secret)?.path).toEqual(['apiKey'])
    expect(fields.find(field => field.protected)?.path).toEqual(['profiles'])
    expect(config.parseConfigValue(fields[0]!, '42')).toBe(42)
    expect(() => config.parseConfigValue(fields[0]!, '0')).toThrow()
    expect(config.parseConfigValue(fields[1]!, '"fast"')).toBe('fast')
  })

  async function harness(answers: readonly (string | null)[]) {
    const ctx = new Context()
    const prompt = vi.fn<TuiService['prompt']>()
    for (const answer of answers) prompt.mockResolvedValueOnce(answer)
    const section = { ns: 'web-search-deepseek', schema: schema.toJSON(), revision: 7,
      value: { timeout: 12, mode: 'fast' }, base: { timeout: 10 }, user: { timeout: 12 }, applies: 'live', autoGenerate: true }
    const mutate = vi.fn(async () => {})
    const set = vi.fn(async (_ref: string, _value: string) => {})
    const unset = vi.fn(async (_ref: string) => {})
    const notice = vi.fn()
    ctx.provide('settings', { describe: () => [section], writable: true, mutate } as never)
    ctx.provide('credentials', { set, unset } as never)
    ctx.provide('tui', { prompt, notice } as unknown as TuiService)
    return { ctx, prompt, notice, mutate, set, unset, section }
  }

  it('keeps stable namespaces behind readable labels and displays schema help', async () => {
    const h = await harness([null])
    expect(config.pluginSettingsEntries(h.ctx)[0]).toMatchObject({ id: 'web-search-deepseek', label: 'Web search deepseek' })
    await config.editPluginSettings(h.ctx, 'web-search-deepseek', new AbortController().signal)
    expect(h.prompt.mock.calls[0]![0].options![0]!.description).toContain('Maximum wait in seconds')
    await h.ctx.fiber.dispose()
  })

  it('uses a path reset with the read revision and leaves other fields intact', async () => {
    const h = await harness(['0', 'reset', null])
    await config.editPluginSettings(h.ctx, 'web-search-deepseek', new AbortController().signal)
    expect(h.mutate).toHaveBeenCalledWith('web-search-deepseek', [{ op: 'unset', path: ['timeout'] }], 7)
    expect(h.prompt.mock.calls[0]![0].options![0]!.description).toContain('profile override')
    await h.ctx.fiber.dispose()
  })

  it('stores API keys in credentials and writes only the reference to the profile', async () => {
    const h = await harness(['3', 'set', 'private-key', null])
    await config.editPluginSettings(h.ctx, 'web-search-deepseek', new AbortController().signal)
    const ref = h.set.mock.calls[0]![0]
    expect(h.set).toHaveBeenCalledWith(expect.stringMatching(/^OMDSH_WEB_SEARCH_DEEPSEEK_API_KEY_/u), 'private-key')
    expect(h.mutate).toHaveBeenCalledWith('web-search-deepseek', [
      { op: 'unset', path: ['apiKey'] },
      { op: 'set', path: ['apiKeyEnv'], value: ref },
    ], 7)
    expect(h.prompt.mock.calls[2]![0].secret).toBe(true)
    expect(JSON.stringify(h.notice.mock.calls)).not.toContain('private-key')
    await h.ctx.fiber.dispose()
  })

  it('shows a configured credential reference and resets both key paths without revoking storage', async () => {
    const h = await harness(['3', 'reset', null])
    Object.assign(h.section.value, { apiKeyEnv: 'SHARED_KEY' })
    Object.assign(h.section.user, { apiKeyEnv: 'SHARED_KEY' })
    await config.editPluginSettings(h.ctx, 'web-search-deepseek', new AbortController().signal)
    expect(h.prompt.mock.calls[0]![0].options![3]!.description).toBe('secret · credential reference configured · profile override')
    expect(h.mutate).toHaveBeenCalledWith('web-search-deepseek', [
      { op: 'unset', path: ['apiKey'] },
      { op: 'unset', path: ['apiKeyEnv'] },
    ], 7)
    expect(h.unset).not.toHaveBeenCalled()
    await h.ctx.fiber.dispose()
  })

  it('removes only the newly staged credential when its profile write loses a race', async () => {
    const h = await harness(['3', 'set', 'private-key', null])
    h.mutate.mockRejectedValueOnce(new Error('Configuration changed'))
    await config.editPluginSettings(h.ctx, 'web-search-deepseek', new AbortController().signal)
    expect(h.unset).toHaveBeenCalledWith(h.set.mock.calls[0]![0])
    expect(JSON.stringify(h.notice.mock.calls)).not.toContain('private-key')
    await h.ctx.fiber.dispose()
  })

  it('reports a stale write and does not retry with a newer revision', async () => {
    const h = await harness(['0', 'set', '42', null])
    h.mutate.mockRejectedValueOnce(new Error('Configuration changed'))
    await config.editPluginSettings(h.ctx, 'web-search-deepseek', new AbortController().signal)
    expect(h.mutate).toHaveBeenCalledTimes(1)
    expect(h.notice).toHaveBeenCalledWith('Configuration changed', { level: 'error' })
    await h.ctx.fiber.dispose()
  })

  it('closes the form when its owner aborts', async () => {
    const h = await harness([])
    h.prompt.mockImplementation((request: TuiPrompt) => new Promise(resolve => {
      request.signal!.addEventListener('abort', () => { resolve(null) }, { once: true })
    }))
    const closing = new AbortController()
    const operation = config.editPluginSettings(h.ctx, 'web-search-deepseek', closing.signal)
    await vi.waitFor(() => { expect(h.prompt).toHaveBeenCalled() })
    closing.abort()
    await operation
    await h.ctx.fiber.dispose()
  })
})
