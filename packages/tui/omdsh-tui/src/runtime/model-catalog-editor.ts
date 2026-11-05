/** Model drafts owned by the provider form; only its Apply action persists them. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveUiLanguage, uiText } from '../locale/index.ts'
import { askPrompt } from '../prompt-intents.ts'

type Model = Record<string, unknown>
interface CatalogOptions {
  models: readonly Model[]
  inputField: 'input' | 'inputModalities'
  reasoningLevels: readonly string[]
}
const object = (value: unknown): Model => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Model : {}
const string = (value: unknown): string => typeof value === 'string' ? value : ''
const text = (ctx: Context, source: string): string => uiText(resolveUiLanguage(ctx.tui.prefs().uiLanguage), source)
const list = { allowCustom: false, notify: false, localize: ['title', 'question', 'actions'] } as const

export function modelReasoningLevels(schema: unknown): string[] {
  const root = new z(schema as Partial<z>)
  const efforts = root.dict?.providers?.inner?.dict?.models?.inner?.dict?.reasoningEfforts
  return (efforts?.list?.find(branch => branch.type === 'dict')?.sKey?.list ?? [])
    .flatMap(level => typeof level.value === 'string' ? [level.value] : [])
}

async function field(ctx: Context, title: string, label: string, initial: unknown, parse: (raw: string) => unknown, signal: AbortSignal): Promise<{ value: unknown } | null> {
  let draft = initial === undefined ? '' : String(initial), error = ''
  while (!signal.aborted) {
    const raw = await ctx.tui.prompt(askPrompt({ localize: ['question', 'actions'], title, question: label,
      detail: text(ctx, error || (label === 'Model ID' ? 'Enter one unique model ID.' : label === 'API value' ? 'Leave empty to use the level name.' : 'Leave empty to restore inheritance.')), initialInput: draft, signal }))
    if (raw === null) return null
    draft = raw
    try { return { value: parse(raw.trim()) } }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
  }
  return null
}

function modelId(raw: string, others: readonly Model[]): string {
  if (!raw || /[\s,\p{Cc}]/u.test(raw)) throw new Error('Enter one unique model ID.')
  if (others.some(model => model.id === raw)) throw new Error('Model ids must be unique.')
  return raw
}

function capacity(raw: string): number | undefined {
  if (raw === '') return undefined
  const value = Number(raw)
  if (!/^\d+$/u.test(raw) || !Number.isSafeInteger(value) || value <= 0) throw new Error('Enter a positive whole number of tokens.')
  return value
}

/** null discards this visit; undefined means the catalog was merely inspected. */
export async function editModelCatalog(ctx: Context, options: CatalogOptions, signal: AbortSignal): Promise<Model[] | null | undefined> {
  let rows = options.models.map(row => ({ ...row })), changed = false, selected = ''
  while (!signal.aborted) {
    const choice = await ctx.tui.prompt({ ...list, title: 'Model list', question: 'Edit models, then keep the list in the provider draft',
      detail: text(ctx, 'Apply in Provider settings saves the draft. Cancel discards this list edit.'), presentation: 'card', filterable: true, initialValue: selected,
      options: [...rows.map((row, index) => ({ label: string(row.id), value: `model:${index}`, description: string(row.name) })),
        { label: text(ctx, 'Add model'), value: '@add' }, { label: text(ctx, 'Keep list'), value: '@keep' }, { label: text(ctx, 'Cancel'), value: '@cancel' }],
      actions: [{ key: 'Alt+Up', label: 'Move up', valuePrefix: 'up:' }, { key: 'Alt+Down', label: 'Move down', valuePrefix: 'down:' }], signal })
    if (choice === null || choice === '@cancel') return null
    if (choice === '@keep') return changed ? rows : undefined
    if (choice === '@add') {
      const id = await field(ctx, text(ctx, 'Add model'), 'Model ID', '', raw => modelId(raw, rows), signal)
      if (id !== null) { rows.push({ id: id.value }); changed = true; selected = `model:${rows.length - 1}` }
      continue
    }
    const match = /^(?:(up|down):)?model:(\d+)$/u.exec(choice)
    if (match === null) continue
    const index = Number(match[2]), row = rows[index]
    if (row === undefined) continue
    selected = `model:${index}`
    if (match[1] !== undefined) {
      const next = index + (match[1] === 'up' ? -1 : 1)
      if (rows[next] !== undefined) { [rows[index], rows[next]] = [rows[next]!, row]; selected = `model:${next}`; changed = true }
      continue
    }
    const edited = await editModel(ctx, row, rows.filter((_, at) => at !== index), options, signal)
    if (edited === null) continue
    if (edited === 'delete') { rows.splice(index, 1); changed = true }
    else if (JSON.stringify(edited) !== JSON.stringify(row)) { rows[index] = edited; changed = true }
  }
  return null
}

async function editModel(ctx: Context, original: Model, others: readonly Model[], options: CatalogOptions, signal: AbortSignal): Promise<Model | 'delete' | null> {
  const draft = { ...original }
  const write = (key: string, value: unknown): void => { if (value === undefined) delete draft[key]; else draft[key] = value }
  const fields: [string, string][] = [['id', 'Model ID'], ['name', 'Display name'], ['contextWindow', 'Context window'], ['maxTokens', 'Maximum output tokens']]
  while (!signal.aborted) {
    const choice = await ctx.tui.prompt({ ...list, title: 'Model settings', question: 'Edit this model', detail: string(draft.id),
      options: [...fields.map(([key, label]) => ({ label: text(ctx, label), value: key, description: draft[key] === undefined ? text(ctx, 'Inherited') : String(draft[key]) })),
        { label: text(ctx, 'Input types'), value: 'input', description: Array.isArray(draft[options.inputField]) ? (draft[options.inputField] as string[]).join(', ') : text(ctx, 'Inherited') },
        ...(options.reasoningLevels.length ? [{ label: text(ctx, 'Reasoning levels'), value: 'reasoning', description: draft.reasoningEfforts === false ? text(ctx, 'Disabled') : Object.keys(object(draft.reasoningEfforts)).join(', ') || text(ctx, 'Inherited') }] : []),
        { label: text(ctx, 'Keep model'), value: 'keep' }, { label: text(ctx, 'Delete model'), value: 'delete' }, { label: text(ctx, 'Cancel'), value: 'cancel' }], signal })
    if (choice === null || choice === 'cancel') return null
    if (choice === 'keep') return draft
    if (choice === 'delete') {
      const confirm = await ctx.tui.prompt({ ...list, title: 'Delete model', question: 'Remove this model from the draft?', detail: string(draft.id), initialValue: 'cancel',
        options: [{ label: text(ctx, 'Cancel'), value: 'cancel' }, { label: text(ctx, 'Delete model'), value: 'delete' }], signal })
      if (confirm === 'delete') return 'delete'
      continue
    }
    if (choice === 'input') {
      const mode = await ctx.tui.prompt({ ...list, title: 'Input types', question: 'Choose input types or restore inheritance',
        options: [{ label: text(ctx, 'Choose'), value: 'choose' }, { label: text(ctx, 'Restore inheritance'), value: 'inherit' }], signal })
      if (mode === 'inherit') {
        delete draft[options.inputField]
        // DeepSeek defaults an omitted input declaration to text only.
        if (options.inputField === 'inputModalities') { delete draft.imagePixelBudget; delete draft.imageMaxBytes }
        continue
      }
      if (mode !== 'choose') continue
      const picked = await ctx.tui.prompt({ ...list, title: 'Input types', question: 'Select at least one input type', multiSelect: true,
        initialValues: Array.isArray(draft[options.inputField]) ? draft[options.inputField] as string[] : ['text'],
        options: [{ label: text(ctx, 'Text'), value: 'text' }, { label: text(ctx, 'Image'), value: 'image' }], signal })
      if (picked === null) continue
      const values = picked.split(',').filter(value => value === 'text' || value === 'image')
      if (!values.length) { ctx.tui.notice('Select at least one input type', { level: 'error' }); continue }
      draft[options.inputField] = values
      if (options.inputField === 'inputModalities' && !values.includes('image')) { delete draft.imagePixelBudget; delete draft.imageMaxBytes }
      continue
    }
    if (choice === 'reasoning' && options.reasoningLevels.length) {
      const result = await editReasoning(ctx, draft.reasoningEfforts, options.reasoningLevels, signal)
      if (result !== null) write('reasoningEfforts', result.value)
      continue
    }
    const label = fields.find(([key]) => key === choice)?.[1]
    if (label === undefined) continue
    const result = await field(ctx, string(draft.id), label, draft[choice], raw => choice === 'id' ? modelId(raw, others) : choice === 'name' ? raw || undefined : capacity(raw), signal)
    if (result !== null) write(choice, result.value)
  }
  return null
}

async function editReasoning(ctx: Context, initial: unknown, levels: readonly string[], signal: AbortSignal): Promise<{ value: unknown } | null> {
  let value = initial, error = ''
  while (!signal.aborted) {
    const entries = object(value)
    const choice = await ctx.tui.prompt({ ...list, title: 'Reasoning levels', question: 'Configure levels and API values', detail: text(ctx, error),
      options: [{ label: text(ctx, 'Choose levels'), value: '@levels' },
        ...Object.entries(entries).map(([level, wire]) => ({ label: level, value: `level:${level}`, description: level === 'off' ? text(ctx, 'Disables reasoning') : String(wire), disabled: level === 'off' })),
        { label: text(ctx, 'Disable reasoning'), value: '@disable' }, { label: text(ctx, 'Restore inheritance'), value: '@inherit' },
        { label: text(ctx, 'Done'), value: '@done' }, { label: text(ctx, 'Cancel'), value: '@cancel' }], signal })
    if (choice === null || choice === '@cancel') return null
    if (choice === '@disable') return { value: false }
    if (choice === '@inherit') return { value: undefined }
    if (choice === '@done') {
      if (value !== undefined && value !== false && (!Object.keys(entries).some(level => level !== 'off') || Object.entries(entries).some(([level, wire]) => !(typeof wire === 'string' && wire.trim() || level === 'off' && wire === null)))) {
        error = 'Reasoning needs a thinking level and a nonempty API value for each level.'; continue
      }
      return { value }
    }
    if (choice === '@levels') {
      const picked = await ctx.tui.prompt({ ...list, title: 'Reasoning levels', question: 'Choose levels', multiSelect: true,
        initialValues: value === undefined || value === false ? levels.filter(level => ['off', 'low', 'medium', 'high'].includes(level)) : Object.keys(entries).filter(level => levels.includes(level)),
        options: levels.map(level => ({ label: level, value: level })), signal })
      if (picked === null) continue
      const selected = new Set(picked.split(','))
      value = { ...Object.fromEntries(Object.entries(entries).filter(([level]) => !levels.includes(level))),
        ...Object.fromEntries(levels.filter(level => selected.has(level)).map(level => [level, Object.hasOwn(entries, level) ? entries[level] : level === 'off' ? null : level])) }
      error = ''; continue
    }
    if (choice.startsWith('level:')) {
      const level = choice.slice(6)
      if (level === 'off' || !Object.hasOwn(entries, level)) continue
      const result = await field(ctx, level, 'API value', entries[level], raw => raw || level, signal)
      if (result !== null) { value = { ...entries, [level]: result.value }; error = '' }
    }
  }
  return null
}
