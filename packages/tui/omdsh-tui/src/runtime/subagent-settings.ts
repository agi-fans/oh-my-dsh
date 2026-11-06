import { settingsDraftSummary } from './settings-draft.ts'
/** Delegation preferences remain Harness-owned; this editor only stages their fields. */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsDescriptor, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import type { TuiPrompt } from '../definition.ts'
import { askPrompt } from '../prompt-intents.ts'
import { resolveUiLanguage, uiText } from '../locale/index.ts'

const LIMITS = 'subagent', MODELS = 'subagent-model-selection-settings'
export const SUBAGENT_SETTINGS_FIELDS: Record<string, readonly string[]> = {
  [LIMITS]: ['maxDepth', 'maxActiveSubagents'], [MODELS]: ['enabled', 'allowedModels'],
}
const labels: Record<string, string> = { maxDepth: 'Delegation depth', maxActiveSubagents: 'Concurrent subagents', enabled: 'Model selection', allowedModels: 'Allowed models' }
const help: Record<string, string> = {
  maxDepth: 'Main agent: depth 0; its children: depth 1; their children: depth 2. A tool’s own depth limit takes precedence. Applies to future delegations.',
  maxActiveSubagents: 'Counts live subagents at every depth under one main agent, excluding the main agent. Lowering this limit does not stop existing children.',
  enabled: 'Applies to new sessions only. Existing sessions keep their model policy; forked children inherit the parent route. Disabling keeps the model list.',
  allowedModels: 'Choose exact provider and model routes for new sessions. Enabling model selection requires at least one route.',
}
const list = { allowCustom: false, notify: false, localize: ['title', 'question', 'actions'] } as const
const object = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (ctx: Context, source: string): string => uiText(resolveUiLanguage(ctx.tui.prefs().uiLanguage), source)
const describe = (ctx: Context, ns: string): SettingsDescriptor | undefined => ctx.settings.describe({ redactSecrets: true }).find(section => section.ns === ns)
type Route = { provider: string; model: string }
const routes = (value: unknown): Route[] => Array.isArray(value) ? value.filter((row): row is Route => typeof row?.provider === 'string' && typeof row?.model === 'string') : []
const routeKey = (route: Route): string => encodeURIComponent(JSON.stringify([route.provider, route.model]))
interface Draft { section: SettingsDescriptor; changes: Map<string, unknown>; error: string }

export function subagentSettingsEntry(ctx: Context) {
  if (![LIMITS, MODELS].some(ns => describe(ctx, ns) !== undefined)) return []
  return [{ id: 'subagents:settings', label: 'Subagents', section: 'agent' as const, fields: [], summary: 'Configure', behavior: ctx.settings.writable ? 'Profile · Apply to save' : 'Profile · Read only',
    keywords: ['Subagent models', ...Object.values(labels)], description: 'Edit delegation limits and model choices together, then Apply to save.' }]
}

export async function openSubagentSettings(ctx: Context, signal: AbortSignal, resetOnly = false): Promise<void> {
  const drafts = new Map<string, Draft>()
  const sync = (): void => {
    for (const ns of [LIMITS, MODELS]) {
      const section = describe(ctx, ns), draft = drafts.get(ns)
      if (draft?.changes.size) continue
      if (section === undefined) drafts.delete(ns)
      else drafts.set(ns, { section, changes: new Map(), error: '' })
    }
  }
  sync()
  if (!drafts.size || signal.aborted) return
  const schema = (draft: Draft, field: string): z | undefined => new z(draft.section.schema as Partial<z>).dict?.[field]
  const fields = (): { ns: string; field: string; draft: Draft }[] => [...drafts].flatMap(([ns, draft]) => (SUBAGENT_SETTINGS_FIELDS[ns] ?? [])
    .filter(field => { const item = schema(draft, field); return item !== undefined && !item.meta.hidden && !item.meta.disabled })
    .map(field => ({ ns, field, draft })))
  const inherited = (draft: Draft, field: string): unknown => object(draft.section.base)[field] ?? schema(draft, field)?.meta.default
  const value = (ns: string, field: string): unknown => {
    const draft = drafts.get(ns)
    if (draft === undefined) return undefined
    return draft.changes.has(field) ? draft.changes.get(field) ?? inherited(draft, field) : object(draft.section.value)[field] ?? schema(draft, field)?.meta.default
  }
  const summary = (ns: string, field: string, draft: Draft): string => {
    const current = value(ns, field)
    const shown = field === 'enabled' ? text(ctx, current ? 'Enabled' : 'Disabled') : field === 'allowedModels' ? String(routes(current).length) : String(current ?? '')
    return shown + ' · ' + text(ctx, draft.changes.has(field) ? 'Draft' : Object.hasOwn(object(draft.section.user), field) ? 'Profile override' : 'Inherited')
  }

  // Generation fences prevent late catalog responses from replacing a newer refresh
  // or retaining this editor after dismissal. Providers settle independently.
  let active = true, generation = 0, catalogRevision = 0, loaded = false, pending = 0
  let catalogError = ''
  const catalogs = new Map<string, { route: Route; label: string }[]>(), failures = new Set<string>()
  const reload = (): void => {
    const epoch = ++generation
    if (!active || signal.aborted) return
    loaded = true; pending = 0; catalogError = ''; failures.clear(); catalogRevision++
    try {
      const llm = ctx.get('llm')
      if (llm === undefined) throw new Error('Model catalog unavailable')
      const providers = llm.listProviders()
      for (const id of catalogs.keys()) if (!providers.some(provider => provider.id === id)) catalogs.delete(id)
      pending = providers.length
      for (const provider of providers) {
        void Promise.resolve().then(() => llm.listModels(provider.id)).then(models => {
          if (!active || signal.aborted || epoch !== generation) return
          catalogs.set(provider.id, models.map(model => ({ route: { provider: provider.id, model: model.id }, label: `${model.name ?? model.id} · ${provider.id}` })))
        }, () => {
          if (active && !signal.aborted && epoch === generation) failures.add(provider.id)
        }).finally(() => {
          if (active && !signal.aborted && epoch === generation) { pending--; catalogRevision++ }
        })
      }
    } catch { catalogError = 'Model catalog could not be loaded. Use Refresh models to retry.' }
  }
  const catalogChanged = (): void => { if (loaded) reload() }
  const off = [ctx.on('llm/adapters-updated', catalogChanged), ctx.on('settings/document-updated', catalogChanged)]
  const catalogStatus = (): string => [
    ...(pending ? [text(ctx, 'Loading models…')] : []), ...(catalogError ? [text(ctx, catalogError)] : []),
    ...(failures.size ? [text(ctx, 'Some model providers could not be loaded. Use Refresh models to retry.') + ' ' + [...failures].join(', ')] : []),
  ].join('\n')
  const pickModels = async (): Promise<void> => {
    if (!loaded) reload()
    const seen = new Map<string, { route: Route; label: string }>()
    const current = routes(value(MODELS, 'allowedModels'))
    for (const route of current) seen.set(routeKey(route), { route, label: `${route.model} · ${route.provider}` })
    let revision = -1, rows: NonNullable<TuiPrompt['options']> = []
    const options = (): NonNullable<TuiPrompt['options']> => {
      if (revision === catalogRevision) return rows
      revision = catalogRevision
      const available = new Set<string>()
      for (const [provider, entries] of catalogs) for (const entry of entries) {
        const key = routeKey(entry.route)
        seen.set(key, entry)
        if (!catalogError && !failures.has(provider)) available.add(key)
      }
      // Keep every displayed route until this picker closes, so a refresh cannot
      // silently drop a checkbox that the user has already toggled.
      rows = [...seen].map(([key, entry]) => ({ label: entry.label, value: key, description: entry.route.model,
        ...(!available.has(key) ? { badge: { label: text(ctx, 'Currently unavailable'), tone: 'muted' as const } } : {}) }))
      const status = catalogStatus()
      if (status) rows = [...rows, { label: status, value: '@catalog-status', disabled: true }]
      return rows
    }
    const answer = await ctx.tui.prompt({ ...list, title: 'Allowed subagent models', question: 'Choose models for the draft',
      detail: text(ctx, 'Space toggles a model; Enter keeps the selection in the draft. Return to Subagents and use Refresh models to retry a failed catalog.'),
      filterable: true, multiSelect: true, allowEmptySelection: true, initialValues: current.map(routeKey),
      emptyText: text(ctx, 'No models are available. Configure a provider or use Refresh models.'), options: options(), refreshOptions: options, signal })
    if (answer === null || signal.aborted) return
    const selected = answer === '' ? [] : answer.split(', ').map(key => {
      const entry = seen.get(key)
      if (entry === undefined) throw new Error('Model selection changed. Refresh and retry.')
      return { ...entry.route }
    })
    drafts.get(MODELS)!.changes.set('allowedModels', selected)
  }
  const editNumber = async (ns: string, field: string): Promise<void> => {
    const draft = drafts.get(ns)!
    let input = String(value(ns, field) ?? ''), error = ''
    while (!signal.aborted) {
      const raw = await ctx.tui.prompt(askPrompt({ ...list, title: 'Subagents', question: labels[field]!,
        detail: [text(ctx, help[field]!), text(ctx, error || 'Leave empty to restore inheritance.')].join('\n'), initialInput: input, signal }))
      if (raw === null) return
      input = raw
      try {
        let parsed: number | undefined
        if (raw.trim()) {
          parsed = Number(raw.trim())
          if (!/^\d+$/u.test(raw.trim()) || !Number.isSafeInteger(parsed) || parsed < (field === 'maxDepth' ? 0 : 1)) throw new Error(field === 'maxDepth' ? 'Enter a non-negative whole number.' : 'Enter a positive whole number.')
          schema(draft, field)?.(parsed)
        }
        draft.changes.set(field, parsed); draft.error = ''; return
      } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    }
  }
  const restore = async (): Promise<void> => {
    const entries = fields()
    const selected = await ctx.tui.prompt({ ...list, title: 'Subagents', question: 'Choose a setting to restore',
      detail: text(ctx, 'Restoring inheritance changes the draft. Apply saves it.'),
      options: entries.map(({ ns, field, draft }) => ({ label: text(ctx, labels[field]!), value: field, description: summary(ns, field, draft) })), signal })
    const entry = entries.find(entry => entry.field === selected)
    if (entry !== undefined && !signal.aborted) { entry.draft.changes.set(entry.field, undefined); entry.draft.error = '' }
  }
  const save = async (): Promise<boolean> => {
    // Validate the combined model policy before writing either section.
    const modelDraft = drafts.get(MODELS)
    if (modelDraft?.changes.size && value(MODELS, 'enabled') === true && !routes(value(MODELS, 'allowedModels')).length) {
      modelDraft.error = 'Choose at least one allowed model before enabling subagent model selection.'
      return false
    }
    let ok = true
    for (const [ns, draft] of drafts) {
      if (!draft.changes.size) continue
      try {
        signal.throwIfAborted()
        if (!ctx.settings.writable) throw new Error('This profile is read-only.')
        if (describe(ctx, ns)?.revision !== draft.section.revision) throw new Error('Configuration changed. Your draft is kept. Cancel and reopen to load the latest settings.')
        for (const field of draft.changes.keys()) schema(draft, field)?.(value(ns, field))
        const ops: SettingsPathOp[] = [...draft.changes].map(([field, next]) => next === undefined ? { op: 'unset', path: [field] } : { op: 'set', path: [field], value: next })
        await ctx.settings.mutate(ns, ops, draft.section.revision)
        draft.changes.clear(); draft.error = ''
        const next = describe(ctx, ns)
        if (next === undefined) drafts.delete(ns)
        else draft.section = next
      } catch (cause) {
        if (signal.aborted) return false
        ok = false; draft.error = cause instanceof Error ? cause.message : String(cause)
      }
    }
    return ok
  }
  const detail = (): string => [settingsDraftSummary(ctx, [...drafts.values()].reduce((count, draft) => count + draft.changes.size, 0)), ...[...drafts.values()].filter(draft => draft.error)
    .map(draft => text(ctx, draft.section.ns === LIMITS ? 'Delegation limits' : 'Subagent models') + ': ' + text(ctx, draft.error))
    .concat(catalogStatus())].filter(Boolean).join('\n')
  try {
    if (resetOnly && ctx.settings.writable) await restore()
    while (!signal.aborted) {
      sync()
      const writable = ctx.settings.writable
      const answer = await ctx.tui.prompt({ ...list, title: 'Subagents', question: 'Edit the draft, then Apply to save',
        detail: detail(), refreshDocument: detail,
        options: [...fields().map(({ ns, field, draft }) => ({ label: text(ctx, labels[field]!), value: field, description: summary(ns, field, draft), preview: text(ctx, help[field]!), disabled: !writable })),
          { label: text(ctx, 'Restore inherited setting…'), value: 'restore', disabled: !writable },
          ...(drafts.has(MODELS) ? [{ label: text(ctx, 'Refresh models'), value: 'refresh' }] : []),
          { label: text(ctx, 'Apply'), value: 'apply', disabled: !writable || !drafts.size }, { label: text(ctx, 'Cancel'), value: 'cancel' }], signal })
      if (answer === null || answer === 'cancel' || signal.aborted) return
      if (answer === 'refresh') { reload(); continue }
      if (!ctx.settings.writable) continue
      try {
        const entry = fields().find(entry => entry.field === answer)
        if (answer === 'restore') await restore()
        else if (answer === 'apply') {
          if (await save()) { ctx.tui.notice('Subagent settings saved.'); return }
        } else if (entry !== undefined) {
          if (answer === 'allowedModels') await pickModels()
          else if (answer === 'enabled') {
            const choice = await ctx.tui.prompt({ ...list, title: 'Subagents', question: 'Model selection', detail: text(ctx, help.enabled!),
              initialValue: value(MODELS, 'enabled') ? 'on' : 'off', options: [{ label: text(ctx, 'Enabled'), value: 'on' }, { label: text(ctx, 'Disabled'), value: 'off' }], signal })
            if (choice !== null && !signal.aborted) entry.draft.changes.set('enabled', choice === 'on')
          } else await editNumber(entry.ns, answer)
        }
      } catch (cause) {
        if (signal.aborted) return
        ctx.tui.notice(cause instanceof Error ? text(ctx, cause.message) : String(cause), { level: 'error' })
      }
    }
  } finally { active = false; generation++; for (const dispose of off) dispose() }
}
