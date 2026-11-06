import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { describe, expect, it, vi } from 'vitest'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type { SettingsDescriptor, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { TuiPrompt } from '../definition.ts'
import { modelSettingsEntry, openModelSettings } from './model-settings.ts'
import { pluginSettingsEntries, editSettingsEntry } from './plugin-settings.ts'

const schema = z.object({ providers: z.dict(z.object({ api: z.union(['openai-completions', 'anthropic-messages', 'future-protocol']), baseURL: z.string(), models: z.array(z.object({ id: z.string() })) })) }).toJSON()
const route: LlmConfigurableProvider = { provider: 'relay', displayName: 'My relay', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'relay'], declared: true }
const initialProfile = { api: 'openai-completions', baseURL: 'https://relay.example/v1', apiKeyEnv: 'OMDSH_RELAY_API_KEY', headers: { 'x-keep': 'value' },
  models: [{ id: 'one', name: 'Original', contextWindow: 120000, reasoningEfforts: { high: 'high' } }, { id: 'two', maxTokens: 8000 }] }
type Answer = string | null | ((prompt: TuiPrompt) => string | null)
function harness(answers: Answer[], options: { base?: unknown; user?: unknown; writable?: boolean; entries?: LlmConfigurableProvider[] } = {}) {
  const ctx = new Context()
  let section: SettingsDescriptor = { ns: 'llm-pi-ai' as SettingsDescriptor['ns'], autoGenerate: false, applies: 'live', schema, revision: 7,
    value: { providers: { relay: structuredClone(initialProfile) } }, base: options.base ?? { providers: {} }, user: options.user ?? { providers: { relay: structuredClone(initialProfile) } } }
  const mutate = vi.fn(async (_ns: string, ops: readonly SettingsPathOp[], revision?: number) => {
    if (revision !== section.revision) throw new Error('Revision conflict')
    const apply = (target: unknown) => {
      const next = structuredClone(target) as Record<string, unknown>
      for (const op of ops) {
        let parent = next
        for (const part of op.path.slice(0, -1)) parent = (parent[part] ??= {}) as Record<string, unknown>
        const key = op.path.at(-1)!
        if (op.op === 'unset') delete parent[key]
        else parent[key] = structuredClone(op.value)
      }
      return next
    }
    section = { ...section, value: apply(section.value), user: apply(section.user), revision: section.revision + 1 }
  })
  const prompt = vi.fn(async (request: TuiPrompt) => { const next = answers.shift(); return typeof next === 'function' ? next(request) : next ?? null })
  const notice = vi.fn(), set = vi.fn(async () => {}), unset = vi.fn(async () => {})
  const describeCredential = vi.fn(async () => ({ configured: true, writable: true, source: 'file' as const }))
  const directory = options.entries ?? [route]
  const discoverModels = vi.fn(async () => [{ id: 'one', name: 'Remote name' }, { id: 'three', name: 'New', contextWindow: 60000, inputModalities: ['text', 'image'] }])
  const describeSettings = vi.fn(() => [section])
  ctx.provide('settings', { writable: options.writable ?? true, describe: describeSettings, mutate } as never)
  ctx.provide('credentials', { describe: describeCredential, set, unset } as never)
  ctx.provide('llm', { listConfigurableProviders: () => directory, listProviders: () => [{ id: 'relay' }], listModels: async () => [{ id: 'one' }, { id: 'two' }], discoverModels } as never)
  ctx.provide('tui', { prompt, notice, prefs: () => ({ uiLanguage: 'en' }) } as never)
  return { ctx, prompt, notice, mutate, set, unset, describeCredential, describeSettings, discoverModels, section: () => section,
    replace: (change: Partial<SettingsDescriptor>) => { section = { ...section, ...change } }, signal: new AbortController().signal }
}

describe('Models provider management', () => {
  it('uses the existing settings entry and keeps a cancelled draft out of settings and credentials', async () => {
    const h = harness(['relay', 'baseURL', 'https://new.example/v1', 'key', 'sk-draft', 'cancel', null])
    try {
      expect(pluginSettingsEntries(h.ctx).find(row => row.id === 'models:providers')?.section).toBe('models')
      await editSettingsEntry(h.ctx, 'models:providers', h.signal)
      expect(h.mutate).not.toHaveBeenCalled(); expect(h.set).not.toHaveBeenCalled()
      expect(h.describeSettings).toHaveBeenCalledWith({ redactSecrets: true })
      expect(h.prompt.mock.calls.find(([request]) => request.secret)?.[0]).toMatchObject({ initialInput: '', secret: true })
    } finally { await h.ctx.fiber.dispose() }
  })

  it('saves only changed paths and preserves existing model metadata and ordering', async () => {
    const h = harness(['relay', 'models', 'up:model:1', '@add', 'three', '@keep', 'baseURL', 'https://new.example/v1', 'apply', null])
    try {
      await openModelSettings(h.ctx, h.signal)
      expect(h.mutate).toHaveBeenCalledWith('llm-pi-ai', [
        { op: 'set', path: ['providers', 'relay', 'models'], value: [initialProfile.models[1], initialProfile.models[0], { id: 'three' }] },
        { op: 'set', path: ['providers', 'relay', 'baseURL'], value: 'https://new.example/v1' },
      ], 7)
      expect(h.set).not.toHaveBeenCalled()
      expect((h.section().value as { providers: { relay: typeof initialProfile } }).providers.relay.headers).toEqual(initialProfile.headers)
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each(['@keep', '@cancel'])('does not write an inherited catalog after %s without edits', async exit => {
    const h = harness(['relay', 'models', 'model:0', 'keep', exit, 'apply', null], { entries: [{ ...route, declared: false }] })
    h.replace({ value: { providers: { relay: { baseURL: initialProfile.baseURL } } } })
    try { await openModelSettings(h.ctx, h.signal); expect(h.mutate).not.toHaveBeenCalled() }
    finally { await h.ctx.fiber.dispose() }
  })

  it('materializes inherited catalog overrides only on an accepted edit and retains unknown fields', async () => {
    const h = harness(['relay', 'models', 'model:0', 'name', 'Edited', 'keep', '@keep', 'apply', null], { entries: [{ ...route, declared: false }] })
    h.replace({ value: { providers: { relay: { modelOverrides: { one: { maxTokens: 2048, compat: { future: true } } } } } } })
    try {
      await openModelSettings(h.ctx, h.signal)
      expect(h.mutate.mock.calls[0]?.[1]).toEqual([
        { op: 'set', path: ['providers', 'relay', 'models'], value: [{ id: 'one', name: 'Edited', maxTokens: 2048, compat: { future: true } }, { id: 'two' }] },
        { op: 'unset', path: ['providers', 'relay', 'modelOverrides'] },
      ])
    } finally { await h.ctx.fiber.dispose() }
  })

  it('keeps model edits in the provider draft until Apply and discards them on cancellation', async () => {
    const h = harness(['relay', 'models', 'model:0', 'contextWindow', '64000', 'keep', '@keep', request => {
      expect(h.mutate).not.toHaveBeenCalled(); expect(request.title).toBe('Provider settings'); return 'cancel'
    }, null])
    try { await openModelSettings(h.ctx, h.signal); expect(h.mutate).not.toHaveBeenCalled() }
    finally { await h.ctx.fiber.dispose() }
  })

  it('keeps a failed key draft and retries only the credential stage after settings commit', async () => {
    const h = harness(['relay', 'baseURL', 'https://new.example/v1', 'key', 'sk-test', 'apply', request => {
      expect(request.detail).toContain('Configuration saved, but the key could not be stored')
      return 'apply'
    }, null])
    h.set.mockRejectedValueOnce(new Error('disk unavailable'))
    try {
      await openModelSettings(h.ctx, h.signal)
      expect(h.mutate).toHaveBeenCalledTimes(1)
      expect(h.set).toHaveBeenCalledTimes(2)
      expect(h.set).toHaveBeenLastCalledWith('OMDSH_RELAY_API_KEY', 'sk-test')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('refuses a stale draft without overwriting an external edit or its credential', async () => {
    const h = harness(['relay', 'key', 'sk-test', () => { h.replace({ revision: 8 }); return 'apply' }, request => {
      expect(request.detail).toContain('Load the latest settings')
      expect(request.options?.find(row => row.value === 'key')?.description).toBe('New key ready to save')
      return 'cancel'
    }, null])
    try {
      await openModelSettings(h.ctx, h.signal)
      expect(h.mutate).not.toHaveBeenCalled(); expect(h.set).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('keeps invalid input editable and never offers the stored key', async () => {
    const h = harness(['relay', 'key', 'KEY=secret', request => {
      expect(request.initialInput).toBe('KEY=secret'); expect(request.detail).toContain('without quotes')
      return 'sk-valid'
    }, 'models', '@add', 'one', request => { expect(request.initialInput).toBe('one'); expect(request.detail).toContain('unique'); return null }, '@cancel', 'cancel', null])
    try { await openModelSettings(h.ctx, h.signal); expect(h.mutate).not.toHaveBeenCalled() }
    finally { await h.ctx.fiber.dispose() }
  })

  it('discovery preselects the configured models and preserves options and unlisted models', async () => {
    const h = harness(['relay', 'fetch', request => { expect(request.initialValues).toEqual(['one', 'two']); return 'one,three' }, 'apply', null])
    try {
      await openModelSettings(h.ctx, h.signal)
      expect(h.discoverModels).toHaveBeenCalledWith('llm-pi-ai', { provider: 'relay', baseURL: initialProfile.baseURL, api: initialProfile.api }, h.signal)
      expect(h.mutate.mock.calls[0]?.[1]).toEqual([{ op: 'set', path: ['providers', 'relay', 'models'], value: [
        ...initialProfile.models, { id: 'three', name: 'New', contextWindow: 60000, input: ['text', 'image'] },
      ] }])
    } finally { await h.ctx.fiber.dispose() }
  })

  it('only removes the owned stored key when deleting a user-only provider', async () => {
    const h = harness(['relay', 'delete', request => { expect(request.initialValue).toBe('cancel'); expect(request.detail).toContain('My relay'); return 'delete' }, null])
    try {
      await openModelSettings(h.ctx, h.signal)
      expect(h.unset).toHaveBeenCalledWith('OMDSH_RELAY_API_KEY')
      expect(h.mutate).toHaveBeenCalledWith('llm-pi-ai', [{ op: 'unset', path: ['providers', 'relay'] }], 7)
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each(['shared', 'environment'])('preserves %s credentials on removal', async kind => {
    const h = harness(['relay', 'delete', 'delete', null])
    if (kind === 'environment') h.describeCredential.mockResolvedValue({ configured: true, writable: false, source: 'env' } as never)
    else h.replace({ value: { providers: { relay: { ...initialProfile, apiKeyEnv: 'SHARED_KEY' } } } })
    try { await openModelSettings(h.ctx, h.signal); expect(h.unset).not.toHaveBeenCalled(); expect(h.mutate).toHaveBeenCalledOnce() }
    finally { await h.ctx.fiber.dispose() }
  })

  it('keeps broken and inherited providers visible but protects deployment-owned rows', async () => {
    const h = harness([request => { expect(request.options?.[0]?.badge?.label).toBe('Load error'); return 'relay' }, request => {
      expect(request.detail).toContain('bad catalog'); expect(request.options?.some(row => row.value === 'delete')).toBe(false); return 'cancel'
    }, null], { entries: [{ ...route, error: 'bad catalog' }], base: { providers: { relay: initialProfile } } })
    try { await openModelSettings(h.ctx, h.signal) } finally { await h.ctx.fiber.dispose() }
  })

  it('offers custom protocols from the mounted schema and creates a reference-free provider', async () => {
    const h = harness(['@add', '@custom', 'local', 'baseURL', 'http://localhost:8080/v1', 'api', request => {
      expect(request.options?.some(row => row.value === 'future-protocol')).toBe(true); return 'future-protocol'
    }, 'models', '@add', 'new-model', '@keep', 'apply', null])
    try {
      await openModelSettings(h.ctx, h.signal)
      expect(h.mutate).toHaveBeenCalledWith('llm-pi-ai', [
        { op: 'set', path: ['providers', 'local', 'baseURL'], value: 'http://localhost:8080/v1' },
        { op: 'set', path: ['providers', 'local', 'api'], value: 'future-protocol' },
        { op: 'set', path: ['providers', 'local', 'models'], value: [{ id: 'new-model' }] },
      ], 7)
      expect(h.set).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('hides add and disables writes for a read-only profile', async () => {
    const h = harness([request => { expect(request.options?.some(row => row.value === '@add')).toBe(false); return 'relay' }, request => {
      expect(request.options?.filter(row => row.value !== 'cancel').every(row => row.disabled)).toBe(true); return 'cancel'
    }, null], { writable: false })
    try { await openModelSettings(h.ctx, h.signal); expect(h.mutate).not.toHaveBeenCalled() }
    finally { await h.ctx.fiber.dispose() }
  })

  it('retains all edits after a rejected settings save and stores the key only after a successful retry', async () => {
    const h = harness(['relay', 'baseURL', 'https://changed.example/v1', 'key', 'sk-test', 'apply', request => {
      expect(request.detail).toContain('Host rejected the configuration')
      expect(request.options?.find(row => row.value === 'baseURL')?.description).toBe('https://changed.example/v1')
      expect(h.set).not.toHaveBeenCalled()
      return 'apply'
    }, null])
    h.mutate.mockRejectedValueOnce(new Error('Host rejected the configuration'))
    try {
      await openModelSettings(h.ctx, h.signal)
      expect(h.mutate).toHaveBeenCalledTimes(2); expect(h.set).toHaveBeenCalledOnce()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('refreshes an open list from owner events and releases listeners on close', async () => {
    const h = harness([])
    const answer = Promise.withResolvers<null>()
    h.prompt.mockImplementationOnce(async () => answer.promise)
    const task = openModelSettings(h.ctx, h.signal)
    try {
      await vi.waitFor(() => { expect(h.prompt).toHaveBeenCalledOnce() })
      const request = h.prompt.mock.calls[0]![0]
      const first = request.refreshOptions!()
      expect(request.refreshOptions!()).toBe(first)
      h.describeCredential.mockResolvedValue({ configured: false, writable: true } as never)
      h.ctx.emit('llm/adapters-updated')
      request.refreshOptions!()
      await vi.waitFor(() => { expect(request.refreshOptions!()[0]?.badge?.label).toContain('Key not configured') })
      answer.resolve(null)
      await task
      const count = h.describeCredential.mock.calls.length
      h.ctx.emit('llm/adapters-updated')
      request.refreshOptions!()
      await new Promise(resolve => setImmediate(resolve))
      expect(h.describeCredential).toHaveBeenCalledTimes(count)
    } finally { answer.resolve(null); await task; await h.ctx.fiber.dispose() }
  })

  it('writes the whole-section DeepSeek catalog without dropping its unedited options', async () => {
    const deepseek = { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }
    const h = harness(['deepseek-official', 'models', '@add', 'new-model', '@keep', 'apply', null], { entries: [deepseek] })
    h.replace({ ns: 'llm-deepseek' as SettingsDescriptor['ns'], value: { models: [{ id: 'deepseek-flash', contextWindow: 1000000, inputModalities: ['text','image'] }] }, user: {}, base: {} })
    try {
      await openModelSettings(h.ctx, h.signal)
      expect(h.mutate).toHaveBeenCalledWith('llm-deepseek', [{ op: 'set', path: ['models'], value: [{ id: 'deepseek-flash', contextWindow: 1000000, inputModalities: ['text','image'] }, { id: 'new-model' }] }], 7)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('restores a catalog override with unset and adopts a dormant provider without inventing credentials', async () => {
    const h = harness(['relay', 'reset', 'apply', '@add', 'catalog', 'apply', null], { entries: [{ ...route, declared: false }, { provider: 'catalog', displayName: 'Catalog', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'catalog'], declared: false }] })
    try {
      await openModelSettings(h.ctx, h.signal)
      expect(h.mutate.mock.calls[0]).toEqual(['llm-pi-ai', [{ op: 'unset', path: ['providers', 'relay', 'models'] }], 7])
      expect(h.mutate.mock.calls[1]).toEqual(['llm-pi-ai', [{ op: 'set', path: ['providers', 'catalog'], value: {} }], 8])
      expect(h.set).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('opens from a settings consumer without a required llm dependency', async () => {
    const h = harness(['relay', 'cancel', null])
    let task: Promise<void> | undefined
    try {
      await h.ctx.plugin({ inject: ['settings', 'credentials', 'tui'], apply: (ctx: Context) => { task = openModelSettings(ctx, h.signal) } })
      await task
      expect(h.prompt.mock.calls[0]?.[0].options?.some(row => row.value === 'relay')).toBe(true)
      expect(h.notice).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('does not publish an entry when the owning adapter settings are absent', async () => {
    const h = harness([])
    h.describeSettings.mockReturnValue([])
    try { expect(modelSettingsEntry(h.ctx)).toEqual([]) } finally { await h.ctx.fiber.dispose() }
  })
})


it.each(['mine', 'latest'])('rebases provider drafts and resolves a changed field using %s', async decision => {
  const h = harness(['relay', 'baseURL', 'https://mine.example/v1', 'displayName', 'My name', () => {
    const updated = { ...initialProfile, baseURL: 'https://latest.example/v1' }
    h.replace({ revision: 8, value: { providers: { relay: updated } }, user: { providers: { relay: updated } } })
    return 'apply'
  }, request => {
    expect(request.options?.some(row => row.value === 'reload')).toBe(true)
    return 'reload'
  }, request => { expect(request.question).toBe('Base URL'); return decision }, 'apply', null])
  try {
    await openModelSettings(h.ctx, h.signal)
    expect(h.mutate).toHaveBeenCalledOnce()
    expect(h.mutate.mock.calls[0]?.[2]).toBe(8)
    const ops = h.mutate.mock.calls[0]?.[1]
    expect(ops).toContainEqual({ op: 'set', path: ['providers', 'relay', 'displayName'], value: 'My name' })
    expect(ops?.some(op => op.path.at(-1) === 'baseURL')).toBe(decision === 'mine')
  } finally { await h.ctx.fiber.dispose() }
})

it('keeps a credential draft when rebasing unrelated provider changes', async () => {
  const h = harness(['relay', 'key', 'sk-draft', () => { h.replace({ revision: 8 }); return 'apply' }, 'reload', 'apply', null])
  try {
    await openModelSettings(h.ctx, h.signal)
    expect(h.set).toHaveBeenCalledWith('OMDSH_RELAY_API_KEY', 'sk-draft')
  } finally { await h.ctx.fiber.dispose() }
})


it('requires a new credential draft after its reference changes during rebase', async () => {
  const h = harness(['relay', 'key', 'sk-draft', () => {
    const updated = { ...initialProfile, apiKeyEnv: 'OTHER_KEY' }
    h.replace({ revision: 8, value: { providers: { relay: updated } }, user: { providers: { relay: updated } } })
    return 'apply'
  }, 'reload', request => {
    expect(request.detail).toContain('credential reference changed')
    expect(request.options?.find(row => row.value === 'key')?.description).not.toBe('New key ready to save')
    return 'cancel'
  }, null])
  try { await openModelSettings(h.ctx, h.signal); expect(h.set).not.toHaveBeenCalled() }
  finally { await h.ctx.fiber.dispose() }
})


it('counts staged provider fields and credentials without displaying the key', async () => {
  const h = harness(['relay', 'baseURL', 'https://new.example/v1', 'key', 'sk-secret', request => {
    expect(request.detail).toContain('2 pending changes')
    expect(request.detail).not.toContain('sk-secret')
    return 'cancel'
  }, null])
  try { await openModelSettings(h.ctx, h.signal); expect(h.mutate).not.toHaveBeenCalled() }
  finally { await h.ctx.fiber.dispose() }
})
