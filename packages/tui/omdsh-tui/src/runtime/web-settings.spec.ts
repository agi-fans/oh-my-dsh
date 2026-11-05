import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { describe, expect, it, vi } from 'vitest'
import type { SettingsDescriptor, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { TuiPrompt } from '../definition.ts'
import { openWebSettings, webSettingsEntry } from './web-settings.ts'
import { editSettingsEntry, pluginSettingsEntries } from './plugin-settings.ts'

type Answer = string | null | ((request: TuiPrompt) => string | null)
function harness(answers: Answer[], language = 'en') {
  const ctx = new Context()
  const make = (ns: string, schema: z, value: object): SettingsDescriptor => ({ ns: ns as SettingsDescriptor['ns'], schema: schema.toJSON(), value, base: value, user: {}, revision: 1, autoGenerate: true, applies: 'live' })
  const sections = [
    make('web', z.object({ searchProvider: z.string(), fetchProvider: z.string() }), { searchProvider: 'deepseek-search-api', fetchProvider: 'deepseek-fetch-api' }),
    make('web-deepseek-api', z.object({ count: z.number().min(1).max(50).default(10), baseURL: z.string() }), { count: 10, baseURL: 'https://api.example' }),
    make('web-search-deepseek', z.object({ maxUses: z.number().min(1).default(5), baseURL: z.string(), apiKeyEnv: z.string(), apiKey: z.string().role('secret') }), { maxUses: 5, baseURL: 'https://legacy.example', apiKeyEnv: 'SHARED_KEY' }),
  ]
  const mutate = vi.fn(async (ns: string, ops: readonly SettingsPathOp[], revision?: number) => {
    const section = sections.find(section => section.ns === ns)!
    expect(revision).toBe(section.revision)
    for (const op of ops) {
      const user = section.user as Record<string, unknown>, value = section.value as Record<string, unknown>
      if (op.op === 'unset' && op.path[0] === 'apiKey') section.secrets = []
      if (op.op === 'unset') { delete user[op.path[0]!]; value[op.path[0]!] = (section.base as Record<string, unknown>)[op.path[0]!] }
      else { user[op.path[0]!] = op.value; value[op.path[0]!] = op.value }
    }
    section.revision++
    ctx.emit('settings/document-updated')
  })
  for (const section of sections) section.value = structuredClone(section.value)
  const describeSettings = vi.fn(() => structuredClone(sections))
  const list = vi.fn(() => ({ search: [{ id: 'plugin-search', available: true }, { id: 'deepseek-official', available: true }, { id: 'deepseek-search-api', available: true }], fetch: [{ id: 'deepseek-fetch-api', available: true }, { id: 'http', available: true }] }))
  const set = vi.fn(async () => {}), describeCredential = vi.fn(async () => ({ configured: true, writable: true, source: 'file' })), notice = vi.fn()
  const prompt = vi.fn(async (request: TuiPrompt) => { const answer = answers.shift(); return typeof answer === 'function' ? answer(request) : answer ?? null })
  ctx.provide('settings', { writable: true, describe: describeSettings, mutate } as never)
  ctx.provide('omdshWebProviders', { list })
  ctx.provide('credentials', { describe: describeCredential, set } as never)
  ctx.provide('tui', { prompt, notice, prefs: () => ({ uiLanguage: language }) } as never)
  return { ctx, sections, list, mutate, prompt, notice, set, describeCredential, describeSettings, signal: new AbortController().signal }
}

describe('Web search and fetch settings', () => {
  it('replaces common generic fields with one entry and retains extra configuration under Advanced', async () => {
    const h = harness([])
    try {
      const rows = pluginSettingsEntries(h.ctx)
      expect(rows.filter(row => row.section === 'integrations').map(row => row.id)).toEqual(['web:settings'])
      expect(rows.find(row => row.id === 'advanced:web-deepseek-api')?.fields).toEqual(['baseURL'])
      expect(rows.find(row => row.id === 'advanced:web-search-deepseek')?.fields).toEqual(['apiKeyEnv'])
      expect(h.describeSettings).toHaveBeenCalledWith({ redactSecrets: true })
      await editSettingsEntry(h.ctx, 'web:settings', h.signal)
      expect(h.prompt).toHaveBeenCalledOnce()
      expect(h.mutate).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('cancels provider and numeric drafts without writing', async () => {
    const h = harness(['count', '20', 'fetch', 'provider:http', 'cancel'])
    try { await openWebSettings(h.ctx, h.signal); expect(h.mutate).not.toHaveBeenCalled(); expect(h.set).not.toHaveBeenCalled() }
    finally { await h.ctx.fiber.dispose() }
  })

  it('validates counts, preserves input and saves provider parameters before selection', async () => {
    const h = harness(['count', '51', request => { expect(request.initialInput).toBe('51'); expect(request.detail).toContain('1 to 50'); return '1.5' }, '20', 'fetch', request => {
      expect(request.options?.slice(0, 2).map(row => row.value)).toEqual(['provider:http', 'provider:deepseek-fetch-api']); return 'provider:http'
    }, 'apply'])
    try {
      await openWebSettings(h.ctx, h.signal)
      expect(h.mutate.mock.calls).toEqual([
        ['web-deepseek-api', [{ op: 'set', path: ['count'], value: 20 }], 1],
        ['web', [{ op: 'set', path: ['fetchProvider'], value: 'http' }], 1],
      ])
    } finally { await h.ctx.fiber.dispose() }
  })

  it('restores the composed provider with unset and offers Automatic only without a composed value', async () => {
    const h = harness(['search', request => { expect(request.options?.some(row => row.value === '@automatic')).toBe(false); return 'provider:deepseek-search-api' }, 'fetch', '@automatic', 'apply'])
    h.sections[0]!.base = { searchProvider: 'deepseek-search-api' }
    h.sections[0]!.value = { searchProvider: 'plugin-search', fetchProvider: 'http' }
    try {
      await openWebSettings(h.ctx, h.signal)
      expect(h.mutate).toHaveBeenCalledWith('web', [{ op: 'unset', path: ['searchProvider'] }, { op: 'unset', path: ['fetchProvider'] }], 1)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('keeps selected missing providers and a failed catalog, retries and disposes event listeners', async () => {
    const h = harness(['fetch', request => {
      expect(request.options?.find(row => row.value === 'provider:missing')?.badge?.label).toBe('Not loaded')
      const first = request.refreshOptions!()
      expect(request.refreshOptions!()).toBe(first)
      h.list.mockImplementationOnce(() => { throw new Error('offline') }); h.ctx.emit('omdsh/web-providers-changed')
      const failed = request.refreshOptions!()
      expect(failed[0]?.label).toBe('Load error'); expect(failed.some(row => row.value === 'provider:http')).toBe(true)
      return '@refresh'
    }, request => { expect(request.options?.some(row => row.value === '@error')).toBe(false); return null }, 'cancel'])
    h.sections[0]!.value = { searchProvider: 'deepseek-search-api', fetchProvider: 'missing' }
    try {
      await openWebSettings(h.ctx, h.signal)
      const count = h.list.mock.calls.length
      h.ctx.emit('omdsh/web-providers-changed')
      const picker = h.prompt.mock.calls.find(([request]) => request.refreshOptions)?.[0]
      picker?.refreshOptions?.()
      expect(h.list).toHaveBeenCalledTimes(count)
      expect(h.mutate).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('retains hidden parameter drafts but discards a key when switching away from legacy search', async () => {
    const h = harness(['search', 'provider:deepseek-official', 'baseURL', 'https://updated.example', 'key', 'sk-discard', 'search', 'provider:deepseek-search-api', 'apply'])
    try {
      await openWebSettings(h.ctx, h.signal)
      expect(h.mutate.mock.calls[0]?.slice(0, 2)).toEqual(['web-search-deepseek', [{ op: 'set', path: ['baseURL'], value: 'https://updated.example' }]])
      expect(h.set).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('keeps partially saved drafts and retries only failed writes before selecting providers', async () => {
    const h = harness(['count', '20', 'search', 'provider:deepseek-official', 'maxUses', '7', 'key', 'sk-retry', 'apply', request => {
      expect(request.detail).toContain('key could not be stored'); expect(request.options?.find(row => row.value === 'search')?.disabled).toBe(true)
      expect(h.mutate.mock.calls.map(call => call[0])).toEqual(['web-deepseek-api', 'web-search-deepseek'])
      return 'apply'
    }])
    h.set.mockRejectedValueOnce(new Error('disk full'))
    try {
      await openWebSettings(h.ctx, h.signal)
      expect(h.mutate.mock.calls.map(call => call[0])).toEqual(['web-deepseek-api', 'web-search-deepseek', 'web'])
      expect(h.set).toHaveBeenCalledTimes(2); expect(h.set).toHaveBeenLastCalledWith('SHARED_KEY', 'sk-retry')
      expect(h.prompt.mock.calls.find(([request]) => request.secret)?.[0].initialInput).toBe('')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('rejects stale drafts before any settings or credential write', async () => {
    const h = harness(['count', '20', () => { h.sections[1]!.revision++; return 'apply' }, request => { expect(request.detail).toContain('Configuration changed'); return 'cancel' }])
    try { await openWebSettings(h.ctx, h.signal); expect(h.mutate).not.toHaveBeenCalled(); expect(h.set).not.toHaveBeenCalled() }
    finally { await h.ctx.fiber.dispose() }
  })

  it('drops a key when the credential reference changes while editing', async () => {
    const h = harness(['search', 'provider:deepseek-official', 'key', 'sk-old-ref', () => {
      h.sections[2]!.value = { ...(h.sections[2]!.value as object), apiKeyEnv: 'NEW_REF' }; h.sections[2]!.revision++; h.ctx.emit('settings/document-updated'); return 'refresh'
    }, request => { expect(request.detail).toContain('reference changed'); return 'cancel' }])
    try { await openWebSettings(h.ctx, h.signal); expect(h.set).not.toHaveBeenCalled() }
    finally { await h.ctx.fiber.dispose() }
  })

  it('removes a literal-key override before writing the reference and honors externally managed credentials', async () => {
    const h = harness(['search', 'provider:deepseek-official', 'key', 'sk-new', 'apply'])
    h.sections[2]!.secrets = [{ path: ['apiKey'], set: true }]
    try {
      await openWebSettings(h.ctx, h.signal)
      expect(h.mutate.mock.calls[0]?.[1]).toEqual([{ op: 'unset', path: ['apiKey'] }])
      expect(h.set).toHaveBeenCalledWith('SHARED_KEY', 'sk-new')
    } finally { await h.ctx.fiber.dispose() }
    const external = harness(['search', 'provider:deepseek-official', 'key', 'sk-new', 'apply', 'cancel'])
    external.describeCredential.mockResolvedValue({ configured: true, writable: false, source: 'env' })
    try { await openWebSettings(external.ctx, external.signal); expect(external.mutate).not.toHaveBeenCalled(); expect(external.set).not.toHaveBeenCalled() }
    finally { await external.ctx.fiber.dispose() }
  })

  it('does not write a referenced key while an inherited literal key still takes precedence', async () => {
    const h = harness(['search', 'provider:deepseek-official', 'key', 'sk-new', 'apply', request => {
      expect(request.detail).toContain('deployment API key still takes precedence'); return 'cancel'
    }])
    const inheritedSecret = [{ path: ['apiKey'], set: true }]
    h.sections[2]!.secrets = inheritedSecret
    const mutate = h.mutate.getMockImplementation()!
    h.mutate.mockImplementationOnce(async (...args) => { await mutate(...args); h.sections[2]!.secrets = inheritedSecret })
    try {
      await openWebSettings(h.ctx, h.signal)
      expect(h.set).not.toHaveBeenCalled()
      expect(h.mutate).toHaveBeenCalledTimes(1)
      expect(h.mutate.mock.calls[0]?.[0]).toBe('web-search-deepseek')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('follows provider registrations without translating plugin IDs and blocks read-only edits', async () => {
    const h = harness(['search', request => {
      expect(request.options?.[0]?.label).toBe('DeepSeek Search API')
      expect(request.options?.find(row => row.value === 'provider:plugin-search')?.label).toBe('plugin-search')
      return null
    }, 'cancel'], 'zh-CN')
    try { await openWebSettings(h.ctx, h.signal); expect(h.mutate).not.toHaveBeenCalled() }
    finally { await h.ctx.fiber.dispose() }
    const readonly = harness([request => { expect(request.options?.filter(row => ['search', 'fetch', 'apply'].includes(row.value!)).every(row => row.disabled)).toBe(true); return 'cancel' }])
    Object.assign(readonly.ctx.settings, { writable: false })
    try { await openWebSettings(readonly.ctx, readonly.signal); expect(readonly.mutate).not.toHaveBeenCalled() }
    finally { await readonly.ctx.fiber.dispose() }
  })

  it('works inside a settings consumer and disappears without its host directory', async () => {
    const h = harness(['cancel'])
    let task: Promise<void> | undefined
    try {
      await h.ctx.plugin({ inject: ['settings', 'credentials', 'tui'], apply(ctx: Context) { task = openWebSettings(ctx, h.signal) } })
      await task
      expect(h.prompt).toHaveBeenCalledOnce()
      h.describeSettings.mockReturnValue([])
      expect(webSettingsEntry(h.ctx)).toEqual([])
    } finally { await h.ctx.fiber.dispose() }
  })
})
