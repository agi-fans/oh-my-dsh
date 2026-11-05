import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsDescriptor, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { describe, expect, it, vi } from 'vitest'
import type { TuiPrompt } from '../definition.ts'
import { editSettingsEntry, pluginSettingsEntries, resetSettingsControl } from './plugin-settings.ts'

type Answer = string | null | ((request: TuiPrompt) => string | null)
function harness(answers: Answer[], ns = 'bash', language = 'en') {
  const ctx = new Context(), abort = new AbortController()
  const shell = z.object({ timeoutMs: z.number().default(120000), maxTimeoutMs: z.number().default(600000), maxOutputBytes: z.number().default(64000), maxSpillBytes: z.number().default(67108864), graceMs: z.number().default(3000), executable: z.string() })
  const section: SettingsDescriptor = { ns: ns as SettingsDescriptor['ns'], schema: (ns === 'agent-loop' ? z.object({ maxParallelToolCalls: z.number().step(1).min(1).default(10) }) : shell).toJSON(),
    value: ns === 'agent-loop' ? { maxParallelToolCalls: 10 } : { timeoutMs: 120000, maxTimeoutMs: 600000, maxOutputBytes: 64000, maxSpillBytes: 67108864, graceMs: 3000 },
    base: {}, user: {}, revision: 7, applies: 'live', autoGenerate: true }
  const sections = [section]
  const mutate = vi.fn(async (_ns: string, _ops: readonly SettingsPathOp[], _revision?: number) => {})
  const prompt = vi.fn(async (request: TuiPrompt) => { const answer = answers.shift(); return typeof answer === 'function' ? answer(request) : answer ?? null })
  const notice = vi.fn()
  ctx.provide('settings', { writable: true, describe: () => structuredClone(sections), mutate } as never)
  ctx.provide('tui', { prompt, notice, prefs: () => ({ uiLanguage: language }) } as never)
  return { ctx, section, sections, mutate, prompt, notice, abort, signal: abort.signal, run: () => editSettingsEntry(ctx, ns, abort.signal) }
}

describe('staged Shell and tool parallelism settings', () => {
  it.each(['bash', 'pwsh', 'agent-loop'])('opens %s without writes and keeps Advanced separate', async ns => {
    const h = harness(['@cancel'], ns)
    try {
      const entry = pluginSettingsEntries(h.ctx).find(entry => entry.id === ns)!
      expect(entry.description).toContain('Apply')
      if (ns !== 'agent-loop') expect(pluginSettingsEntries(h.ctx).find(entry => entry.id === `advanced:${ns}`)?.fields).toEqual(['executable'])
      await h.run()
      expect(h.prompt.mock.calls[0]![0].options?.find(row => row.value === '@apply')?.disabled).toBe(true)
      expect(h.mutate).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each(['bash', 'pwsh'])('saves %s fields with converted units in one owner mutation', async ns => {
    const h = harness(['timeoutMs', '30s', 'maxOutputBytes', '2 MiB', request => {
      expect(request.initialValue).toBe('maxOutputBytes')
      expect(request.options?.find(row => row.value === 'timeoutMs')?.description).toBe('30s · Draft')
      expect(h.mutate).not.toHaveBeenCalled(); return '@apply'
    }], ns)
    try {
      await h.run()
      expect(h.mutate.mock.calls).toEqual([[ns, [{ op: 'set', path: ['timeoutMs'], value: 30000 }, { op: 'set', path: ['maxOutputBytes'], value: 2097152 }], 7]])
    } finally { await h.ctx.fiber.dispose() }
  })

  it('cancels edited and restored fields without saving', async () => {
    const h = harness(['timeoutMs', '40s', '@restore', 'graceMs', '@cancel'])
    try { await h.run(); expect(h.mutate).not.toHaveBeenCalled() }
    finally { await h.ctx.fiber.dispose() }
  })

  it('uses unset for empty inputs and Ctrl+R, showing composed defaults without pinning them', async () => {
    const h = harness(['timeoutMs', 'maxOutputBytes', '', request => {
      expect(request.options?.find(row => row.value === 'timeoutMs')?.description).toBe('45s · Draft')
      return '@apply'
    }])
    h.section.base = { timeoutMs: 45000 }; h.section.user = { timeoutMs: 120000 }
    try {
      const entry = pluginSettingsEntries(h.ctx).find(entry => entry.id === 'bash')!
      await resetSettingsControl(h.ctx, 'bash', entry, h.signal)
      expect(h.prompt.mock.calls[0]![0].question).toBe('Choose a setting to restore')
      expect(h.mutate.mock.calls).toEqual([['bash', [{ op: 'unset', path: ['timeoutMs'] }, { op: 'unset', path: ['maxOutputBytes'] }], 7]])
    } finally { await h.ctx.fiber.dispose() }
  })

  it('rejects unusable Shell values before saving and retains invalid input for correction', async () => {
    const h = harness(['timeoutMs', '0', request => { expect(request.initialInput).toBe('0'); expect(request.detail).toContain('positive finite'); return '-1' }, '1e400', '30s',
      'graceMs', '2147483648', request => { expect(request.detail).toContain('must not exceed'); return '2s' }, '@apply'])
    try {
      await h.run()
      expect(h.mutate).toHaveBeenCalledOnce()
      expect(h.mutate.mock.calls[0]![1]).toEqual([{ op: 'set', path: ['timeoutMs'], value: 30000 }, { op: 'set', path: ['graceMs'], value: 2000 }])
    } finally { await h.ctx.fiber.dispose() }
  })

  it('leaves default timeout clamping to the executor instead of inventing a cross-field constraint', async () => {
    const h = harness(['timeoutMs', '20m', 'maxTimeoutMs', '1m', '@apply'])
    try {
      await h.run()
      expect(h.mutate).toHaveBeenCalledWith('bash', [{ op: 'set', path: ['timeoutMs'], value: 1200000 }, { op: 'set', path: ['maxTimeoutMs'], value: 60000 }], 7)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('validates parallelism through its owning schema', async () => {
    const h = harness(['maxParallelToolCalls', '0', request => { expect(request.initialInput).toBe('0'); return '1.5' }, '3', '@apply'], 'agent-loop')
    try {
      await h.run()
      expect(h.mutate.mock.calls).toEqual([['agent-loop', [{ op: 'set', path: ['maxParallelToolCalls'], value: 3 }], 7]])
    } finally { await h.ctx.fiber.dispose() }
  })

  it('retains the draft on a save error and retries with the original revision', async () => {
    const h = harness(['timeoutMs', '20s', '@apply', request => {
      expect(request.detail).toBe('disk full')
      expect(request.options?.find(row => row.value === 'timeoutMs')?.description).toContain('20s · Draft')
      return '@apply'
    }])
    h.mutate.mockRejectedValueOnce(new Error('disk full'))
    try {
      await h.run(); expect(h.mutate).toHaveBeenCalledTimes(2)
      expect(h.mutate.mock.calls[1]).toEqual(h.mutate.mock.calls[0])
    } finally { await h.ctx.fiber.dispose() }
  })

  it('does not rebase a draft over a concurrent edit', async () => {
    const h = harness(['timeoutMs', '20s', () => { h.section.revision++; return '@apply' }, request => {
      expect(request.detail).toContain('Configuration changed'); return '@cancel'
    }])
    try { await h.run(); expect(h.mutate).not.toHaveBeenCalled() }
    finally { await h.ctx.fiber.dispose() }
  })

  it('does not announce an accepted save after the form has been aborted', async () => {
    const h = harness(['timeoutMs', '20s', '@apply'])
    h.mutate.mockImplementationOnce(async () => { h.abort.abort() })
    try { await h.run(); expect(h.mutate).toHaveBeenCalledOnce(); expect(h.notice).not.toHaveBeenCalled() }
    finally { await h.ctx.fiber.dispose() }
  })

  it.each(['readonly', 'removed', 'aborted'] as const)('refuses writes after the owner becomes %s', async state => {
    const h = harness(['timeoutMs', '20s', () => {
      if (state === 'readonly') h.ctx.settings.writable = false
      if (state === 'removed') h.sections.length = 0
      if (state === 'aborted') h.abort.abort()
      return '@apply'
    }, request => { if (state === 'removed') expect(request.detail).toContain('no longer available'); return '@cancel' }])
    try { await h.run(); expect(h.mutate).not.toHaveBeenCalled() }
    finally { await h.ctx.fiber.dispose() }
  })

  it('localizes labels, field explanations and save confirmation', async () => {
    const h = harness([request => {
      expect(request.options?.find(row => row.value === 'timeoutMs')?.label).toBe('默认超时')
      expect(request.options?.find(row => row.value === 'timeoutMs')?.preview).toContain('作用于新命令')
      return 'timeoutMs'
    }, '30s', '@apply'], 'bash', 'zh-CN')
    try { await h.run(); expect(h.notice).toHaveBeenCalledWith('Shell: 设置已保存。') }
    finally { await h.ctx.fiber.dispose() }
  })
})
