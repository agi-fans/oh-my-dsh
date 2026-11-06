/** Staged search/fetch preferences over Harness namespaces and credentials. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SettingsDescriptor, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { rebaseSettingsDraft, settingsDraftSummary } from './settings-draft.ts'
import z from '@deepseek-ai/schemastery'
import type { TuiPrompt, WebSettingsProvider } from '../definition.ts'
import { askPrompt } from '../prompt-intents.ts'
import { resolveUiLanguage, uiText } from '../locale/index.ts'
import { parseBaseURL } from '../commands/auth-input.ts'

const ID = 'web:settings'
const namespaces = ['web', 'web-deepseek-api', 'web-search-deepseek']
const list = { allowCustom: false, notify: false, localize: ['title', 'question', 'actions'] } as const
const object = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
const string = (value: unknown): string => typeof value === 'string' ? value : ''
const text = (ctx: Context, source: string): string => uiText(resolveUiLanguage(ctx.tui.prefs().uiLanguage), source)
const describe = (ctx: Context, ns: string): SettingsDescriptor | undefined => ctx.settings.describe({ redactSecrets: true }).find(section => section.ns === ns)
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)
const metadata: Record<string, { label: string; description: string }> = {
  'deepseek-search-api': { label: 'DeepSeek Search API', description: 'Uses the conversation’s DeepSeek account or the configured API key. Calls the hosted Search API without an auxiliary model turn; service charges may apply.' },
  'deepseek-official': { label: 'DeepSeek (legacy)', description: 'Uses the conversation’s DeepSeek account or the configured API key. Runs an auxiliary Messages model turn with web search; model charges apply.' },
  http: { label: 'Direct fetch', description: 'Fetches from this computer without a model or DeepSeek credential. Local DNS and network access apply; private addresses are blocked and content is bounded.' },
  'deepseek-fetch-api': { label: 'DeepSeek Fetch API', description: 'Uses the conversation’s DeepSeek account or the configured API key. Fetches through DeepSeek without an auxiliary model turn or local DNS lookup; service charges and content limits apply.' },
}

/** Only fields served by the combined editor leave their generic forms. */
export const WEB_SETTINGS_FIELDS: Record<string, readonly string[]> = {
  web: ['searchProvider', 'fetchProvider'],
  'web-deepseek-api': ['count'],
  'web-search-deepseek': ['maxUses', 'baseURL', 'apiKey'],
}

export function webSettingsEntry(ctx: Context) {
  if (ctx.get('omdshWebProviders') === undefined || describe(ctx, 'web') === undefined) return []
  return [{ id: ID, label: 'Web search and fetch', section: 'integrations' as const, fields: [], behavior: ctx.settings.writable ? 'Profile · Apply to save' : 'Profile · Read only', summary: 'Configure',
    description: 'Choose search and fetch providers, edit their settings, then Apply to save.' }]
}

interface Draft {
  section: SettingsDescriptor
  changes: Map<string, unknown>
}

export async function openWebSettings(ctx: Context, signal: AbortSignal): Promise<void> {
  if (ctx.get('omdshWebProviders') === undefined) return
  const drafts = new Map<string, Draft>()
  for (const ns of namespaces) {
    const section = describe(ctx, ns)
    if (section !== undefined) drafts.set(ns, { section, changes: new Map() })
  }
  if (!drafts.has('web')) return
  let catalog: { search: readonly WebSettingsProvider[]; fetch: readonly WebSettingsProvider[] } = { search: [], fetch: [] }
  let dirty = true, loadError = '', diagnostic = '', key = '', keyRef = ''
  const effective = (ns: string, field: string): unknown => {
    const draft = drafts.get(ns)
    if (draft === undefined) return undefined
    const root = new z(draft.section.schema as Partial<z>)
    const base = object(draft.section.base)[field] ?? root.dict?.[field]?.meta.default
    return draft.changes.has(field) ? draft.changes.get(field) ?? base : object(draft.section.value)[field] ?? root.dict?.[field]?.meta.default
  }
  const selected = (kind: 'search' | 'fetch'): string => string(effective('web', kind + 'Provider'))
  const legacyRef = (): string => string(object(describe(ctx, 'web-search-deepseek')?.value).apiKeyEnv) || 'DEEPSEEK_API_KEY'
  const invalidate = (): void => { dirty = true }
  const off = [ctx.on('omdsh/web-providers-changed', invalidate), ctx.on('settings/document-updated', invalidate), ctx.on('credentials/reference-updated', invalidate)]
  const refresh = (): void => {
    if (!dirty) return
    dirty = false
    try {
      const directory = ctx.get('omdshWebProviders')
      if (directory === undefined) throw new Error('Web provider directory unavailable')
      catalog = directory.list(); loadError = ''
    } catch { loadError = 'Provider list could not be loaded. The last known list is shown; retry to refresh it.' }
    if (key && keyRef !== legacyRef()) { key = ''; keyRef = ''; diagnostic = 'The credential reference changed. Enter the key again for the current reference.' }
    // Clean sections can follow external edits. Dirty sections retain their revision fence.
    for (const [ns, draft] of drafts) {
      if (draft.changes.size || ns === 'web-search-deepseek' && key) continue
      const next = describe(ctx, ns)
      if (next !== undefined) draft.section = next
    }
    for (const ns of namespaces) {
      const next = describe(ctx, ns)
      if (next !== undefined && !drafts.has(ns)) drafts.set(ns, { section: next, changes: new Map() })
    }
  }
  const providerLabel = (id: string): string => id === '' ? text(ctx, 'Automatic') : !Object.hasOwn(metadata, id) ? id : text(ctx, metadata[id]!.label)
  const providerDescription = (id: string): string => id === '' ? text(ctx, 'Use the deployment or environment selection; multiple usable providers can be ambiguous.') : !Object.hasOwn(metadata, id) ? text(ctx, 'Configure this provider in its plugin settings.') : text(ctx, metadata[id]!.description)
  const fieldSummary = (ns: string, field: string): string => {
    const draft = drafts.get(ns)!
    const origin = draft.changes.has(field) ? 'Draft' : Object.hasOwn(object(draft.section.user), field) ? 'Profile override' : 'Inherited'
    return String(effective(ns, field) ?? text(ctx, 'Inherited')) + ' · ' + text(ctx, origin)
  }
  const selectionSummary = (kind: 'search' | 'fetch'): string => {
    const id = selected(kind), provider = catalog[kind].find(row => row.id === id)
    const state = id === '' ? '' : provider === undefined ? 'Not loaded' : !provider.available ? 'Unavailable' : ''
    return providerLabel(id) + (state ? ' · ' + text(ctx, state) : '')
  }
  const check = (draft: Draft): void => {
    signal.throwIfAborted()
    if (!ctx.settings.writable) throw new Error('This profile is read-only.')
    if (describe(ctx, draft.section.ns)?.revision !== draft.section.revision) throw new Error('Configuration changed. Load the latest settings to continue with your draft.')
  }
  const commit = async (ns: string): Promise<void> => {
    const draft = drafts.get(ns)
    if (draft === undefined || draft.changes.size === 0) return
    check(draft)
    const ops: SettingsPathOp[] = [...draft.changes].map(([field, value]) => value === undefined ? { op: 'unset', path: [field] } : { op: 'set', path: [field], value })
    await ctx.settings.mutate(ns, ops, draft.section.revision)
    draft.changes.clear()
    const next = describe(ctx, ns)
    if (next === undefined) throw new Error('Web settings are no longer available.')
    draft.section = next
  }
  const chooseProvider = async (kind: 'search' | 'fetch'): Promise<void> => {
    const draft = drafts.get('web')!, field = kind + 'Provider'
    let rows: NonNullable<TuiPrompt['options']> = []
    const options = (): NonNullable<TuiPrompt['options']> => {
      const update = dirty || rows.length === 0
      refresh()
      if (!update) return rows
      const priority = kind === 'search' ? ['deepseek-search-api', 'deepseek-official'] : ['http', 'deepseek-fetch-api']
      const rank = (id: string): number => priority.includes(id) ? priority.indexOf(id) : priority.length
      const providers = [...catalog[kind]].sort((a, b) => rank(a.id) - rank(b.id))
      const current = selected(kind), base = string(object(draft.section.base)[field])
      const ids = [...new Set([...providers.map(provider => provider.id), ...[current, base].filter(Boolean)])]
      rows = [...(base === '' ? [{ label: text(ctx, 'Automatic'), value: '@automatic', description: text(ctx, 'Use the deployment or environment selection; multiple usable providers can be ambiguous.') }] : []),
        ...ids.map(id => {
          const provider = providers.find(item => item.id === id)
          return { label: providerLabel(id), value: 'provider:' + id, description: id, preview: providerDescription(id),
            badge: { label: provider === undefined ? text(ctx, 'Not loaded') : !provider.available ? text(ctx, 'Unavailable') : id === base ? text(ctx, 'Deployment default') : '', tone: 'muted' as const } }
        }), { label: text(ctx, 'Refresh'), value: '@refresh' }]
      if (loadError) rows = [{ label: text(ctx, 'Load error'), value: '@error', description: text(ctx, loadError), disabled: true }, ...rows]
      return rows
    }
    while (!signal.aborted) {
      const answer = await ctx.tui.prompt({ ...list, title: kind === 'search' ? 'Search provider' : 'Fetch provider', question: 'Choose a provider', filterable: true,
        initialValue: selected(kind) ? 'provider:' + selected(kind) : '@automatic', options: options(), refreshOptions: options, signal })
      if (answer === null) return
      if (answer === '@refresh') { dirty = true; continue }
      if (answer !== '@automatic' && !answer.startsWith('provider:')) continue
      const id = answer === '@automatic' ? '' : answer.slice(9)
      const base = string(object(draft.section.base)[field])
      draft.changes.set(field, id === '' || id === base ? undefined : id)
      if (kind === 'search' && id !== 'deepseek-official') { key = ''; keyRef = '' }
      return
    }
  }
  const editField = async (ns: string, field: string, label: string): Promise<void> => {
    const draft = drafts.get(ns)
    if (draft === undefined) return
    let input = String(effective(ns, field) ?? ''), error = ''
    while (!signal.aborted) {
      const raw = await ctx.tui.prompt(askPrompt({ localize: ['title', 'question', 'actions'], title: 'Web search and fetch', question: label,
        detail: text(ctx, error || 'Leave empty to restore inheritance.'), initialInput: input, signal }))
      if (raw === null) return
      input = raw
      try {
        let value: unknown = undefined
        if (raw.trim()) {
          if (field === 'baseURL') value = parseBaseURL(raw)
          else {
            const number = Number(raw.trim())
            if (!/^\d+$/u.test(raw.trim()) || !Number.isSafeInteger(number) || number < 1 || field === 'count' && number > 50) throw new Error(field === 'count' ? 'Enter a whole number from 1 to 50.' : 'Enter a positive whole number.')
            value = number
          }
          new z(draft.section.schema as Partial<z>).dict?.[field]?.(value)
        }
        draft.changes.set(field, value)
        return
      } catch (cause) { error = errorText(cause) }
    }
  }
  try {
    while (!signal.aborted) {
      refresh()
      const writable = ctx.settings.writable
      const legacy = selected('search') === 'deepseek-official' && describe(ctx, 'web-search-deepseek') !== undefined
      const api = selected('search') === 'deepseek-search-api' && describe(ctx, 'web-deepseek-api') !== undefined
      let credential = ''
      if (legacy) {
        try {
          const info = await ctx.credentials.describe(credentialRef(legacyRef()))
          credential = info.configured ? info.source === 'file' ? 'Key stored locally' : 'Environment credential' : 'Key not configured'
        } catch { credential = 'Credential status unavailable' }
      }
      if (signal.aborted) return
      const answer = await ctx.tui.prompt({ ...list, title: 'Web search and fetch', question: 'Edit the draft, then Apply to save',
        detail: [settingsDraftSummary(ctx, [...drafts.values()].reduce((count, draft) => count + draft.changes.size, key ? 1 : 0)), ...[diagnostic, loadError].filter(Boolean).map(message => text(ctx, message))].join('\n'),
        options: [
          { label: text(ctx, 'Search provider'), value: 'search', description: selectionSummary('search'), preview: providerDescription(selected('search')), disabled: !writable || !!diagnostic },
          { label: text(ctx, 'Fetch provider'), value: 'fetch', description: selectionSummary('fetch'), preview: providerDescription(selected('fetch')), disabled: !writable || !!diagnostic },
          ...(api ? [{ label: text(ctx, 'Results per search'), value: 'count', description: fieldSummary('web-deepseek-api', 'count'), disabled: !writable }] : []),
          ...(legacy ? [
            { label: text(ctx, 'API key'), value: 'key', description: text(ctx, key ? 'New key ready to save' : credential), disabled: !writable },
            { label: text(ctx, 'Base URL'), value: 'baseURL', description: fieldSummary('web-search-deepseek', 'baseURL'), disabled: !writable },
            { label: text(ctx, 'Maximum searches per request'), value: 'maxUses', description: fieldSummary('web-search-deepseek', 'maxUses'), disabled: !writable },
          ] : []),
          ...([...drafts.values()].some(draft => describe(ctx, draft.section.ns)?.revision !== draft.section.revision) ? [{ label: text(ctx, 'Load latest and keep draft'), value: 'reload' }] : []),
          { label: text(ctx, 'Refresh'), value: 'refresh' }, { label: text(ctx, 'Apply'), value: 'apply', disabled: !writable }, { label: text(ctx, 'Cancel'), value: 'cancel' },
        ], signal })
      if (answer === null || answer === 'cancel') return
      if (answer === 'refresh') { dirty = true; continue }
      if (!writable) continue
      try {
        if (answer === 'reload') {
          const rebased = new Map<string, Draft>()
          for (const [ns, draft] of drafts) {
            const latest = describe(ctx, ns)
            if (latest === undefined) throw new Error('These settings are no longer available. Cancel and reopen Settings.')
            const result = await rebaseSettingsDraft(ctx, draft.section, latest, draft.changes, [...draft.changes.keys()].map(field => ({
              key: field, label: ({ count: 'Results per search', maxUses: 'Maximum searches per request', baseURL: 'Base URL', searchProvider: 'Search provider', fetchProvider: 'Fetch provider' } as Record<string, string>)[field] ?? field,
              defaultValue: new z(latest.schema as Partial<z>).dict?.[field]?.meta.default,
              format: (value: unknown) => String(value ?? text(ctx, 'Inherited')),
            })), signal)
            if (result === undefined) break
            rebased.set(ns, result)
          }
          if (rebased.size !== drafts.size || signal.aborted) continue
          for (const [ns, draft] of rebased) drafts.set(ns, draft)
          diagnostic = ''
          dirty = true
          continue
        }
        if (answer === 'search' || answer === 'fetch') { if (!diagnostic) await chooseProvider(answer); continue }
        if (answer === 'count' && api) { await editField('web-deepseek-api', 'count', 'Results per search'); diagnostic = ''; continue }
        if ((answer === 'baseURL' || answer === 'maxUses') && legacy) {
          await editField('web-search-deepseek', answer, answer === 'baseURL' ? 'Base URL' : 'Maximum searches per request'); diagnostic = ''; continue
        }
        if (answer === 'key' && legacy) {
          const raw = await ctx.tui.prompt(askPrompt({ localize: true, title: 'Web search and fetch', question: 'API key', detail: 'Leave empty to keep the saved credential. Stored keys are never displayed.', initialInput: key, secret: true, signal }))
          if (raw !== null) {
            const value = raw.trim()
            if (value && (!/^[\x21-\x7e]+$/u.test(value) || /^\w+=/u.test(value) || /^(".*"|'.*')$/u.test(value))) throw new Error('Paste only the API key, without quotes or an environment assignment.')
            key = value; keyRef = legacyRef(); diagnostic = ''
          }
          continue
        }
        if (answer !== 'apply') continue
        for (const [ns, draft] of drafts) if (draft.changes.size || ns === 'web-search-deepseek' && key) check(draft)
        if (key) {
          if (keyRef !== legacyRef()) { key = ''; keyRef = ''; throw new Error('The credential reference changed. Enter the key again for the current reference.') }
          if (!(await ctx.credentials.describe(credentialRef(keyRef))).writable) throw new Error('This credential is managed externally. Update its source before replacing it.')
          const draft = drafts.get('web-search-deepseek')!
          if (draft.section.secrets?.some(secret => secret.path.join('.') === 'apiKey' && secret.set)) draft.changes.set('apiKey', undefined)
        }
        await commit('web-deepseek-api')
        await commit('web-search-deepseek')
        if (key) {
          if (drafts.get('web-search-deepseek')!.section.secrets?.some(secret => secret.path.join('.') === 'apiKey' && secret.set)) throw new Error('A deployment API key still takes precedence. Update its source before replacing the referenced key.')
          check(drafts.get('web-search-deepseek')!)
          try { await ctx.credentials.set(credentialRef(keyRef), key) }
          catch { throw new Error('Provider settings saved, but the key could not be stored. Apply retries the key before changing providers.') }
          key = ''; keyRef = ''
        }
        await commit('web')
        ctx.tui.notice('Web search and fetch settings saved.')
        return
      } catch (error) {
        if (signal.aborted) return
        diagnostic = errorText(error)
        ctx.tui.notice(text(ctx, diagnostic), { level: 'error' })
      }
    }
  } finally { for (const dispose of off) dispose() }
}
