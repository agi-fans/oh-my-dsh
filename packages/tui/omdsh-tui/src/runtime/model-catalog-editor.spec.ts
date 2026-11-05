import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { describe, expect, it, vi } from 'vitest'
import type { TuiPrompt } from '../definition.ts'
import { editModelCatalog, modelReasoningLevels } from './model-catalog-editor.ts'

type Answer = string | null | ((prompt: TuiPrompt) => string | null)
const levels = ['off', 'low', 'medium', 'high', 'future']
async function edit(answers: Answer[], models: Record<string, unknown>[] = [{ id: 'one' }], options: { inputField?: 'input' | 'inputModalities'; reasoningLevels?: string[]; language?: string; signal?: AbortSignal } = {}) {
  const ctx = new Context(), notice = vi.fn()
  const prompt = vi.fn(async (request: TuiPrompt) => { const answer = answers.shift(); return typeof answer === 'function' ? answer(request) : answer ?? null })
  ctx.provide('tui', { prompt, notice, prefs: () => ({ uiLanguage: options.language ?? 'en' }) } as never)
  try {
    const result = await editModelCatalog(ctx, { models, inputField: options.inputField ?? 'input', reasoningLevels: options.reasoningLevels ?? [] }, options.signal ?? new AbortController().signal)
    expect(answers).toEqual([])
    return { result, prompt, notice }
  } finally { await ctx.fiber.dispose() }
}

describe('model catalog drafts', () => {
  it('derives levels from the rehydrated adapter schema', () => {
    const schema = z.object({ providers: z.dict(z.object({ models: z.array(z.object({ reasoningEfforts: z.union([z.const(false), z.dict(z.union([z.string(), z.const(null)]), z.union(levels))]) })) })) }).toJSON()
    expect(modelReasoningLevels(schema)).toEqual(levels)
    expect(modelReasoningLevels(z.object({}).toJSON())).toEqual([])
  })

  it('inspects models without materializing the inherited catalog or reasoning fields', async () => {
    const h = await edit(['model:0', request => { expect(request.options?.some(row => row.value === 'reasoning')).toBe(false); return 'keep' }, '@keep'])
    expect(h.result).toBeUndefined()
  })

  it('validates fields and retains unknown options while editing and moving models', async () => {
    const models = [{ id: 'one', name: 'Original', contextWindow: 1000, maxTokens: 500, compat: { future: true } }, { id: 'two' }]
    const h = await edit(['model:0', 'id', 'two', request => { expect(request.detail).toContain('unique'); expect(request.initialInput).toBe('two'); return 'renamed' },
      'name', '', 'contextWindow', '1.5', request => { expect(request.detail).toContain('whole number'); return '64000' }, 'maxTokens', '', 'keep', 'down:model:0', '@keep'], models)
    expect(h.result).toEqual([{ id: 'two' }, { id: 'renamed', contextWindow: 64000, compat: { future: true } }])
    expect(models[0]?.name).toBe('Original')
  })

  it('adds, confirms deletion and cancels nested edits without leaking them', async () => {
    const h = await edit(['@add', 'three', 'model:1', 'name', 'Discarded', 'cancel', 'model:0', 'delete', 'cancel', 'delete', 'delete', '@keep'])
    expect(h.result).toEqual([{ id: 'three' }])
    expect((await edit(['model:0', 'name', 'Discarded', 'keep', '@cancel'])).result).toBeNull()
  })

  it('removes DeepSeek image constraints when selecting or restoring text-only input', async () => {
    const models = [{ id: 'one', inputModalities: ['text', 'image'], imagePixelBudget: 10000, imageMaxBytes: 20000, unknown: 42 }]
    const h = await edit(['model:0', 'input', 'choose', '', 'input', 'choose', 'text', 'keep', '@keep'], models, { inputField: 'inputModalities' })
    expect(h.notice).toHaveBeenCalledWith('Select at least one input type', { level: 'error' })
    expect(h.result).toEqual([{ id: 'one', inputModalities: ['text'], unknown: 42 }])
    const inherited = await edit(['model:0', 'input', 'inherit', 'keep', '@keep'], models, { inputField: 'inputModalities' })
    expect(inherited.result).toEqual([{ id: 'one', unknown: 42 }])
  })

  it('edits pi-ai input separately and resets optional capacities without writing defaults', async () => {
    const h = await edit(['model:0', 'input', 'choose', 'text,image', 'contextWindow', '0', '-1', '9007199254740992', '', 'keep', '@keep'], [{ id: 'one', contextWindow: 6000, maxTokens: 2000 }])
    expect(h.result).toEqual([{ id: 'one', maxTokens: 2000, input: ['text', 'image'] }])
  })

  it('preserves unknown reasoning keys and off values, and edits only thinking API values', async () => {
    const h = await edit(['model:0', 'reasoning', request => { expect(request.options?.find(row => row.value === 'level:off')?.disabled).toBe(true); return '@levels' },
      'off,high,future', 'level:high', 'custom-high', '@done', 'keep', '@keep'], [{ id: 'one', reasoningEfforts: { off: 'disabled', high: 'old-high', unknown: 'keep' } }], { reasoningLevels: levels })
    expect(h.result).toEqual([{ id: 'one', reasoningEfforts: { off: 'disabled', high: 'custom-high', future: 'future', unknown: 'keep' } }])
  })

  it('requires a thinking level and defaults blank API values to their level', async () => {
    const h = await edit(['model:0', 'reasoning', '@levels', request => { expect(request.initialValues).toEqual(['off', 'low', 'medium', 'high']); return 'off' }, '@done', request => {
      expect(request.detail).toContain('thinking level'); return '@levels'
    }, 'off,low', 'level:low', '', '@done', 'keep', '@keep'], undefined, { reasoningLevels: levels })
    expect(h.result).toEqual([{ id: 'one', reasoningEfforts: { off: null, low: 'low' } }])
  })

  it.each(['@disable', '@inherit', '@cancel'])('handles reasoning %s without affecting the original map', async action => {
    const model = { id: 'one', reasoningEfforts: { high: 'custom-high' } }
    const h = await edit(['model:0', 'reasoning', action, 'keep', '@keep'], [model], { reasoningLevels: levels })
    expect(h.result).toEqual(action === '@cancel' ? undefined : [{ id: 'one', ...(action === '@disable' ? { reasoningEfforts: false } : {}) }])
    expect(model.reasoningEfforts.high).toBe('custom-high')
  })

  it('localizes chrome while leaving model names literal', async () => {
    await edit([request => { expect(request.options?.[0]?.label).toBe('Settings'); expect(request.options?.[0]?.description).toBe('Apply'); expect(request.options?.find(row => row.value === '@add')?.label).toBe('添加模型'); return '@cancel' }], [{ id: 'Settings', name: 'Apply' }], { language: 'zh-CN' })
  })

  it('does not return an edit after interruption', async () => {
    const controller = new AbortController()
    expect((await edit([() => { controller.abort(); return '@add' }], undefined, { signal: controller.signal })).result).toBeNull()
  })
})
