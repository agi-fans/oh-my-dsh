import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { describe, expect, it, vi } from 'vitest'
import type { SettingsDescriptor, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { TuiPrompt } from '../definition.ts'
import { openSubagentSettings } from './subagent-settings.ts'
import { editSettingsEntry, pluginSettingsEntries } from './plugin-settings.ts'

type Answer = string | null | ((request: TuiPrompt) => string | null | Promise<string | null>)
const MODELS = 'subagent-model-selection-settings'
const key = (provider: string, model: string) => encodeURIComponent(JSON.stringify([provider, model]))
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function harness(answers: Answer[], language = 'en') {
  const ctx = new Context(), abort = new AbortController()
  const make = (ns: string, schema: z, value: object): SettingsDescriptor => ({ ns: ns as SettingsDescriptor['ns'], schema: schema.toJSON(), value: structuredClone(value), base: value, user: {}, revision: 1, autoGenerate: false, applies: 'live' })
  const sections = [
    make('subagent', z.object({ maxDepth: z.number().min(0).step(1).default(1), maxActiveSubagents: z.number().min(1).step(1).default(8), extra: z.string() }), { maxDepth: 1, maxActiveSubagents: 8 }),
    make(MODELS, z.object({ enabled: z.boolean().default(false), allowedModels: z.array(z.object({ provider: z.string(), model: z.string() })).default([]) }), { enabled: false, allowedModels: [] }),
  ]
  const mutate = vi.fn(async (ns: string, ops: readonly SettingsPathOp[], revision?: number) => {
    const section = sections.find(section => section.ns === ns)!
    expect(revision).toBe(section.revision)
    for (const op of ops) {
      const user = section.user as Record<string, unknown>, value = section.value as Record<string, unknown>
      if (op.op === 'unset') { delete user[op.path[0]!]; value[op.path[0]!] = (section.base as Record<string, unknown>)[op.path[0]!] }
      else { user[op.path[0]!] = op.value; value[op.path[0]!] = op.value }
    }
    section.revision++; ctx.emit('settings/document-updated')
  })
  const listProviders = vi.fn(() => [{ id: 'official' }])
  const listModels = vi.fn(async (_id: string): Promise<{ id: string; name?: string }[]> => [{ id: 'flash', name: 'Flash' }])
  const notice = vi.fn()
  const prompt = vi.fn(async (request: TuiPrompt) => { const answer = answers.shift(); return typeof answer === 'function' ? await answer(request) : answer ?? null })
  ctx.provide('settings', { writable: true, describe: () => structuredClone(sections), mutate } as never)
  ctx.provide('llm', { listProviders, listModels } as never)
  ctx.provide('tui', { prompt, notice, prefs: () => ({ uiLanguage: language }) } as never)
  return { ctx, sections, mutate, prompt, notice, listModels, listProviders, abort, signal: abort.signal }
}

describe('combined subagent settings', () => {
  it('replaces both entries, retains advanced fields, and only reads when opened', async () => {
    const h = harness([])
    try {
      const entries = pluginSettingsEntries(h.ctx)
      expect(entries.map(row => row.id)).toEqual(['advanced:subagent', 'subagents:settings'])
      expect(entries[0]?.fields).toEqual(['extra'])
      await editSettingsEntry(h.ctx, 'subagents:settings', h.signal)
      expect(h.mutate).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each(['subagent', MODELS])('supports a host with only %s settings', async ns => {
    const h = harness(['cancel']); h.sections.splice(ns === 'subagent' ? 1 : 0, 1)
    try {
      await openSubagentSettings(h.ctx, h.signal)
      const options = h.prompt.mock.calls[0]![0].options!
      expect(options.some(row => row.value === 'maxDepth')).toBe(ns === 'subagent')
      expect(options.some(row => row.value === 'enabled')).toBe(ns === MODELS)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('cancels number, policy and model drafts without any write', async () => {
    const h = harness(['maxDepth', '3', 'enabled', 'on', 'allowedModels', async request => {
      await tick(); request.refreshOptions!(); return key('official', 'flash')
    }, 'cancel'])
    try { await openSubagentSettings(h.ctx, h.signal); expect(h.mutate).not.toHaveBeenCalled() }
    finally { await h.ctx.fiber.dispose() }
  })

  it('validates whole-number bounds, keeps invalid input and saves the two policy fields together', async () => {
    const h = harness(['maxDepth', '-1', request => { expect(request.initialInput).toBe('-1'); expect(request.detail).toContain('non-negative'); return '1.5' }, '0',
      'maxActiveSubagents', '0', request => { expect(request.detail).toContain('positive'); return '4' }, 'enabled', 'on', 'apply', request => {
        expect(request.detail).toContain('at least one'); expect(h.mutate).not.toHaveBeenCalled(); return 'allowedModels'
      }, async request => { await tick(); request.refreshOptions!(); return key('official', 'flash') }, 'apply'])
    try {
      await openSubagentSettings(h.ctx, h.signal)
      expect(h.mutate.mock.calls).toEqual([
        ['subagent', [{ op: 'set', path: ['maxDepth'], value: 0 }, { op: 'set', path: ['maxActiveSubagents'], value: 4 }], 1],
        [MODELS, [{ op: 'set', path: ['enabled'], value: true }, { op: 'set', path: ['allowedModels'], value: [{ provider: 'official', model: 'flash' }] }], 1],
      ])
    } finally { await h.ctx.fiber.dispose() }
  })

  it('disables selection without clearing routes and restores inheritance only on Apply', async () => {
    const h = harness(['enabled', 'off', 'maxDepth', '', 'apply'])
    h.sections[1]!.value = { enabled: true, allowedModels: [{ provider: 'saved', model: 'unlisted' }] }
    try {
      await openSubagentSettings(h.ctx, h.signal)
      expect(h.mutate.mock.calls).toEqual([
        ['subagent', [{ op: 'unset', path: ['maxDepth'] }], 1],
        [MODELS, [{ op: 'set', path: ['enabled'], value: false }], 1],
      ])
      expect((h.sections[1]!.value as { allowedModels: unknown[] }).allowedModels).toHaveLength(1)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('routes Ctrl+R into a staged field reset, and cancellation preserves the profile', async () => {
    const h = harness(['allowedModels', 'cancel'])
    try {
      await editSettingsEntry(h.ctx, 'subagents:settings', h.signal, true)
      expect(h.prompt.mock.calls[0]![0].question).toBe('Choose a setting to restore')
      expect(h.prompt.mock.calls[1]![0].options?.find(row => row.value === 'allowedModels')?.description).toContain('Draft')
      expect(h.mutate).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('retains failed drafts after partial success and retries only the failed namespace', async () => {
    const h = harness(['maxDepth', '2', 'enabled', 'off', 'apply', request => { expect(request.detail).toContain('disk full'); return 'apply' }])
    const actual = h.mutate.getMockImplementation()!
    let fail = true
    h.mutate.mockImplementation(async (ns, ops, revision) => { if (ns === MODELS && fail) { fail = false; throw new Error('disk full') }; await actual(ns, ops, revision) })
    try {
      await openSubagentSettings(h.ctx, h.signal)
      expect(h.mutate.mock.calls.map(call => call[0])).toEqual(['subagent', MODELS, MODELS])
      expect(h.notice).toHaveBeenCalledWith('Subagent settings saved.')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('preserves dirty revisions through external refresh and saves the other independent section', async () => {
    const h = harness(['enabled', 'off', () => { h.sections[1]!.revision++; h.ctx.emit('settings/document-updated'); return 'maxDepth' }, '2', 'apply', request => {
      expect(request.detail).toContain('Configuration changed'); return 'cancel'
    }])
    try {
      await openSubagentSettings(h.ctx, h.signal)
      expect(h.mutate.mock.calls.map(call => call[0])).toEqual(['subagent'])
      expect(h.notice).not.toHaveBeenCalledWith('Subagent settings saved.')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('retains missing saved routes and successful providers, with a retry for failed providers', async () => {
    const h = harness(['allowedModels', async request => {
      await tick(); const options = request.refreshOptions!()
      expect(options.find(row => row.value === key('offline', 'custom'))?.badge?.label).toBe('Currently unavailable')
      expect(options.some(row => row.value === key('official', 'flash'))).toBe(true)
      expect(options.some(row => row.label.includes('could not be loaded'))).toBe(true)
      expect(request.initialValues).toEqual([key('offline', 'custom')]); return null
    }, 'refresh', 'allowedModels', async request => {
      await tick(); expect(request.refreshOptions!().some(row => row.value === key('broken', 'recovered'))).toBe(true)
      return ''
    }, 'apply'])
    h.sections[1]!.value = { enabled: false, allowedModels: [{ provider: 'offline', model: 'custom' }] }
    h.listProviders.mockReturnValue([{ id: 'official' }, { id: 'broken' }])
    let brokenCalls = 0
    h.listModels.mockImplementation(async id => { if (id === 'broken' && ++brokenCalls === 1) throw new Error('network'); return [{ id: id === 'broken' ? 'recovered' : 'flash' }] })
    try {
      await openSubagentSettings(h.ctx, h.signal)
      expect(h.mutate).toHaveBeenCalledWith(MODELS, [{ op: 'set', path: ['allowedModels'], value: [] }], 1)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('discards stale catalog responses and keeps displayed routes selectable during refresh', async () => {
    const old = deferred<{ id: string }[]>(), fresh = deferred<{ id: string }[]>()
    const h = harness(['allowedModels', async request => {
      await tick(); h.ctx.emit('llm/adapters-updated'); await tick()
      fresh.resolve([{ id: 'new' }]); await tick()
      expect(request.refreshOptions!().some(row => row.value === key('official', 'new'))).toBe(true)
      old.resolve([{ id: 'stale' }]); await tick()
      expect(request.refreshOptions!().some(row => row.value === key('official', 'stale'))).toBe(false)
      h.listProviders.mockReturnValue([]); h.ctx.emit('llm/adapters-updated'); await tick()
      expect(request.refreshOptions!().find(row => row.value === key('official', 'new'))?.badge?.label).toBe('Currently unavailable')
      return key('official', 'new')
    }, 'apply'])
    h.listModels.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise)
    try {
      await openSubagentSettings(h.ctx, h.signal)
      expect(h.mutate).toHaveBeenCalledWith(MODELS, [{ op: 'set', path: ['allowedModels'], value: [{ provider: 'official', model: 'new' }] }], 1)
      const count = h.listProviders.mock.calls.length
      h.ctx.emit('llm/adapters-updated'); expect(h.listProviders).toHaveBeenCalledTimes(count)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('closes without waiting for a catalog and ignores its late completion', async () => {
    const pending = deferred<{ id: string }[]>()
    let picker!: TuiPrompt
    const h = harness(['allowedModels', request => { picker = request; return null }, 'cancel'])
    h.listModels.mockImplementation(() => pending.promise)
    try {
      await openSubagentSettings(h.ctx, h.signal)
      const previous = picker.refreshOptions!()
      pending.resolve([{ id: 'late' }]); await tick()
      expect(picker.refreshOptions!()).toBe(previous)
      expect(h.mutate).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('updates root loading feedback when a manual refresh settles', async () => {
    const pending = deferred<{ id: string }[]>()
    const h = harness(['refresh', async request => {
      expect(request.detail).toContain('Loading models')
      pending.resolve([{ id: 'flash' }]); await tick()
      expect(request.refreshDocument!()).not.toContain('Loading models')
      return 'cancel'
    }])
    h.listModels.mockImplementation(() => pending.promise)
    try { await openSubagentSettings(h.ctx, h.signal); expect(h.mutate).not.toHaveBeenCalled() }
    finally { await h.ctx.fiber.dispose() }
  })

  it('handles a top-level catalog failure, supports cancellation and keeps IDs literal in Chinese', async () => {
    const h = harness(['allowedModels', async request => {
      await tick(); const options = request.refreshOptions!()
      expect(options[0]?.label).toBe('原样模型 · provider-id')
      expect(options[0]?.badge?.label).toBe('当前不可用')
      expect(options.some(row => row.label.includes('加载失败'))).toBe(true)
      return null
    }, 'cancel'], 'zh-CN')
    h.sections[1]!.value = { enabled: false, allowedModels: [{ provider: 'provider-id', model: '原样模型' }] }
    h.listProviders.mockImplementation(() => { throw new Error('unavailable') })
    try { await openSubagentSettings(h.ctx, h.signal); expect(h.mutate).not.toHaveBeenCalled() }
    finally { await h.ctx.fiber.dispose() }
  })

  it.each(['readonly', 'abort'] as const)('does not write after %s takes effect', async mode => {
    const h = harness(['maxDepth', '2', () => { if (mode === 'readonly') h.ctx.settings.writable = false; else h.abort.abort(); return 'apply' }, 'cancel'])
    try { await openSubagentSettings(h.ctx, h.signal); expect(h.mutate).not.toHaveBeenCalled() }
    finally { await h.ctx.fiber.dispose() }
  })
})
