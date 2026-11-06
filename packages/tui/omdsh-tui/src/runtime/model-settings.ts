/** Staged provider configuration over Harness settings, catalogs and write-only credentials. */
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { LlmConfigurableProvider, LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import type { SettingsDescriptor, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { TuiPrompt } from '../definition.ts'
import { resolveUiLanguage, uiText } from '../locale/index.ts'
import { askPrompt } from '../prompt-intents.ts'
import { managedProviderCredentialRef, parseBaseURL, parseModelIds, parseProviderId } from '../commands/auth-input.ts'
import { walkPath } from '../commands/auth-providers.ts'
import { rebaseSettingsDraft, settingsDraftSummary } from './settings-draft.ts'
import { openAccountSettings } from './account-settings.ts'
import { editModelCatalog, modelReasoningLevels } from './model-catalog-editor.ts'

const NAMESPACES = ['llm-deepseek', 'llm-pi-ai']
const MODEL_SETTINGS = 'models:providers'
const text = (ctx: Context, source: string, values?: Record<string, string | number>): string => uiText(resolveUiLanguage(ctx.tui.prefs().uiLanguage), source, values)
const list = { localize: true, allowCustom: false, notify: false } as const
const object = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
const string = (value: unknown): string => typeof value === 'string' ? value : ''
const models = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(object) : []
const describe = (ctx: Context, ns: string): SettingsDescriptor | undefined => ctx.settings.describe({ redactSecrets: true }).find(section => section.ns === ns)
const profile = (section: SettingsDescriptor, entry: LlmConfigurableProvider): Record<string, unknown> => object(walkPath(section.value, entry.settingsPath))
const custom = (entry: LlmConfigurableProvider): boolean => entry.settingsNs === 'llm-pi-ai' && entry.declared === true
function llm(ctx: Context) {
  const service = ctx.get('llm')
  if (service === undefined) throw new Error('Model providers are no longer available.')
  return service
}
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)

export function modelSettingsEntry(ctx: Context) {
  if (ctx.get('llm') === undefined || !ctx.settings.describe({ redactSecrets: true }).some(section => NAMESPACES.includes(section.ns))) return []
  return [{ id: MODEL_SETTINGS, label: 'Model providers', section: 'models' as const, fields: [], behavior: ctx.settings.writable ? 'Profile · Apply to save' : 'Profile · Read only',
    description: 'Manage provider credentials, endpoints and model lists. Keeps the selected model.', summary: 'Configure' }]
}

/** Choices come from the mounted adapter schema, including protocols added by later releases. */
function protocols(section: SettingsDescriptor): string[] {
  const root = new z(section.schema as Partial<z>)
  return (root.dict?.providers?.inner?.dict?.api?.list ?? []).flatMap(item => typeof item.value === 'string' ? [item.value] : [])
}

function deletable(section: SettingsDescriptor, entry: LlmConfigurableProvider): boolean {
  return entry.settingsPath.length > 0 && walkPath(section.user, entry.settingsPath) !== undefined && walkPath(section.base, entry.settingsPath) === undefined
}

function assertRevision(ctx: Context, section: SettingsDescriptor): void {
  if (!ctx.settings.writable) throw new Error('This profile is read-only.')
  if (describe(ctx, section.ns)?.revision !== section.revision) throw new Error('Configuration changed. Load the latest settings to continue with your draft.')
}

/** Never materialize redacted secret slots when replacing a compound catalog value. */
function assertCatalogWritable(section: SettingsDescriptor, path: readonly string[]): void {
  if (section.secrets?.some(secret => secret.path.slice(0, path.length).join('.') === path.join('.'))) {
    throw new Error('This model list contains protected fields. Edit it in the profile configuration.')
  }
}

function normalizeKey(raw: string): string {
  const value = raw.trim()
  if (!/^[\x21-\x7e]+$/u.test(value) || /^\w+=/u.test(value) || /^(".*"|'.*')$/u.test(value)) throw new Error('Paste only the API key, without quotes or an environment assignment.')
  return value
}

async function authentication(ctx: Context, entry: LlmConfigurableProvider, value: Record<string, unknown>): Promise<string> {
  const refs = [...new Set([...(string(value.apiKeyEnv) ? [string(value.apiKeyEnv)] : []), ...(entry.settingsNs === 'llm-deepseek' ? ['DEEPSEEK_API_KEY'] : entry.nativeAuth?.env ?? [])])]
  for (const ref of refs) {
    const info = await ctx.credentials.describe(credentialRef(ref))
    if (info.configured) return info.source === 'file' ? 'Key stored locally' : 'Environment credential'
  }
  return refs.length > 0 ? 'Key not configured' : 'Provider-managed authentication'
}

async function providerRows(ctx: Context): Promise<NonNullable<TuiPrompt['options']>> {
  const active = new Set(llm(ctx).listProviders().map(entry => entry.id))
  const sections = new Map(ctx.settings.describe({ redactSecrets: true }).map(section => [String(section.ns), section]))
  const entries = llm(ctx).listConfigurableProviders().filter(entry => NAMESPACES.includes(entry.settingsNs) && sections.has(entry.settingsNs))
  const rows = await Promise.all(entries.filter(entry => entry.settingsPath.length === 0 || walkPath(sections.get(entry.settingsNs)?.value, entry.settingsPath) !== undefined).map(async entry => {
    const section = sections.get(entry.settingsNs)!
    let detail = '', error = entry.error
    try {
      detail = text(ctx, await authentication(ctx, entry, profile(section, entry)))
      const count = active.has(entry.provider) ? (await llm(ctx).listModels(entry.provider)).length : models(profile(section, entry).models).length
      detail += ' · ' + text(ctx, '{count} models', { count })
    } catch (cause) { error = errorText(cause) }
    return { label: entry.displayName, value: entry.provider, description: entry.provider,
      preview: error ?? detail, badge: { label: error === undefined ? detail : 'Load error', tone: error === undefined ? 'muted' as const : 'warning' as const } }
  }))
  rows.sort((a, b) => Number(b.value === 'deepseek-official') - Number(a.value === 'deepseek-official'))
  if (active.has('deepseek-account')) {
    try {
      const count = (await llm(ctx).listModels('deepseek-account')).length
      if (count > 0) rows.unshift({ label: text(ctx, 'DeepSeek Account'), value: 'deepseek-account', description: 'deepseek-account', preview: text(ctx, 'Manage account sign-in, profile and balances.'), badge: { label: text(ctx, '{count} models', { count }), tone: 'muted' } })
    } catch { /* The account owns its unavailable catalog and sign-in diagnostics. */ }
  }
  return rows
}

export async function openModelSettings(ctx: Context, signal: AbortSignal): Promise<void> {
  let rows: NonNullable<TuiPrompt['options']> = [], dirty = true, loading = false, closed = false, generation = 0
  const invalidate = (): void => { dirty = true }
  const off = [ctx.on('settings/document-updated', invalidate), ctx.on('credentials/reference-updated', invalidate), ctx.on('llm/adapters-updated', invalidate)]
  const reload = async (): Promise<void> => {
    const version = ++generation
    dirty = false; loading = true
    try {
      const next = await providerRows(ctx)
      if (version === generation && !closed && !signal.aborted) {
        const adapter = describe(ctx, 'llm-pi-ai')
        const add = ctx.settings.writable && adapter !== undefined && (protocols(adapter).length > 0 || llm(ctx).listConfigurableProviders().some(entry => entry.settingsNs === adapter.ns && entry.declared !== true && walkPath(adapter.value, entry.settingsPath) === undefined))
        rows = [...next, ...(add ? [{ label: text(ctx, 'Add model provider'), value: '@add' }] : []), { label: text(ctx, 'Refresh'), value: '@refresh' }]
      }
    } catch (error) {
      if (version === generation && !closed && !signal.aborted) rows = [
        { label: text(ctx, 'Load error'), value: '@error', description: errorText(error), disabled: true },
        { label: text(ctx, 'Refresh'), value: '@refresh' },
      ]
    } finally { if (version === generation) loading = false }
  }
  const options = (): NonNullable<TuiPrompt['options']> => {
    if (dirty && !loading) void reload()
    return rows
  }
  try {
    while (!signal.aborted) {
      await reload()
      if (signal.aborted) return
      const answer = await ctx.tui.prompt({ ...list, localize: ['title', 'question', 'actions'], title: 'Model providers', question: 'Choose a provider to configure', filterable: true,
        options: options(), refreshOptions: options, signal })
      if (answer === null) return
      if (answer === '@refresh') continue
      if (answer === 'deepseek-account') {
        await openAccountSettings(ctx, signal)
        continue
      }
      if (answer === '@add') { await addProvider(ctx, signal); continue }
      const entry = llm(ctx).listConfigurableProviders().find(entry => entry.provider === answer)
      if (entry !== undefined) await editProvider(ctx, entry, signal)
    }
  } finally { closed = true; for (const dispose of off) dispose() }
}

async function addProvider(ctx: Context, signal: AbortSignal): Promise<void> {
  const section = describe(ctx, 'llm-pi-ai')
  if (section === undefined || !ctx.settings.writable) return
  const dormant = llm(ctx).listConfigurableProviders().filter(entry => entry.settingsNs === section.ns && entry.declared !== true && walkPath(section.value, entry.settingsPath) === undefined)
  const choice = await ctx.tui.prompt({ ...list, localize: ['title', 'question', 'actions'], title: 'Add model provider', question: 'Choose a catalog provider or a custom API', filterable: true,
    options: [...dormant.map(entry => ({ label: entry.displayName, value: entry.provider })), ...(protocols(section).length === 0 ? [] : [{ label: text(ctx, 'Custom model API'), value: '@custom' }])], signal })
  if (choice === null) return
  const entry = dormant.find(entry => entry.provider === choice)
  if (entry !== undefined) { await editProvider(ctx, entry, signal, true); return }
  if (choice !== '@custom') return
  let id = ''
  while (!signal.aborted) {
    const raw = await ctx.tui.prompt(askPrompt({ localize: true, title: 'Custom model API', question: 'Provider id', initialInput: id, signal }))
    if (raw === null) return
    id = raw
    try {
      id = parseProviderId(raw)
      if (llm(ctx).listConfigurableProviders().some(entry => entry.provider === id) || llm(ctx).listProviders().some(entry => entry.id === id) || walkPath(describe(ctx, section.ns)?.value, ['providers', id]) !== undefined) throw new Error('This provider id already exists.')
      await editProvider(ctx, { provider: id, displayName: id, settingsNs: section.ns, settingsPath: ['providers', id], declared: true }, signal, true)
      return
    } catch (error) { if (!signal.aborted) ctx.tui.notice(errorText(error), { level: 'error' }) }
  }
}

async function editProvider(ctx: Context, entry: LlmConfigurableProvider, signal: AbortSignal, creating = false): Promise<void> {
  const initial = describe(ctx, entry.settingsNs)
  if (initial === undefined) return
  let section: SettingsDescriptor = initial
  let saved = profile(section, entry)
  const changes = new Map<string, unknown>()
  let key = '', diagnostic = entry.error ?? ''
  const value = (field: string): unknown => changes.has(field) ? changes.get(field) : saved[field]
  while (!signal.aborted) {
    const canWrite = ctx.settings.writable
    const auth = text(ctx, await authentication(ctx, entry, saved).catch(errorText))
    if (signal.aborted) return
    const choice = await ctx.tui.prompt({ ...list, localize: ['title', 'question', 'actions'], title: 'Provider settings', question: 'Edit the draft, then Apply to save', detail: [settingsDraftSummary(ctx, changes.size + (key ? 1 : 0) + (creating ? 1 : 0)), entry.displayName, entry.provider, text(ctx, diagnostic)].filter(Boolean).join('\n'),
      options: [
        { label: 'API key', value: 'key', description: key === '' ? auth : text(ctx, 'New key ready to save'), disabled: !canWrite },
        { label: 'Base URL', value: 'baseURL', description: string(value('baseURL')) || entry.defaultBaseURL || text(ctx, 'Inherited'), disabled: !canWrite },
        ...(custom(entry) ? [{ label: 'Display name', value: 'displayName', description: string(value('displayName')) || entry.provider, disabled: !canWrite },
          { label: 'API protocol', value: 'api', description: string(value('api')) || text(ctx, 'Choose'), disabled: !canWrite }] : []),
        { label: 'Model list', value: 'models', description: models(value('models')).map(model => string(model.id)).join(', ') || text(ctx, 'Inherited'), disabled: !canWrite },
        { label: 'Fetch available models', value: 'fetch', disabled: !canWrite },
        ...(!custom(entry) ? [{ label: 'Restore default models', value: 'reset', disabled: !canWrite }] : []),
        ...(describe(ctx, section.ns)?.revision !== section.revision ? [{ label: 'Load latest and keep draft', value: 'reload' }] : []),
        { label: 'Apply', value: 'apply', disabled: !canWrite },
        ...(deletable(section, entry) && !creating ? [{ label: 'Delete provider', value: 'delete', disabled: !canWrite }] : []),
        { label: 'Cancel', value: 'cancel' },
      ].map(option => ({ ...option, label: text(ctx, option.label) })), signal })
    if (choice === null || choice === 'cancel') return
    if (!canWrite) continue
    try {
      if (choice === 'reload') {
        const latest = describe(ctx, section.ns)
        if (latest === undefined) throw new Error('Provider configuration is no longer available.')
        const result = await rebaseSettingsDraft(ctx, section, latest, changes, [...changes.keys()].map(field => ({
          key: field, label: ({ baseURL: 'Base URL', api: 'API protocol', displayName: 'Display name', models: 'Model list' } as Record<string, string>)[field] ?? field,
          defaultValue: undefined, format: (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value) ?? text(ctx, 'Inherited'),
        })), signal, entry.settingsPath)
        if (result === undefined) continue
        const nextSaved = profile(result.section, entry)
        const credentialChanged = saved.apiKeyEnv !== nextSaved.apiKeyEnv
        section = result.section; saved = nextSaved
        changes.clear()
        for (const [field, value] of result.changes) changes.set(field, value)
        diagnostic = 'Latest settings loaded. Your remaining changes are ready to apply.'
        if (key && credentialChanged) { key = ''; diagnostic = 'The credential reference changed. Enter the key again for the current reference.' }
        continue
      }
      if (choice === 'apply') {
        signal.throwIfAborted()
        assertRevision(ctx, section)
        if (custom(entry) && (!string(value('api')) || !string(value('baseURL')) || models(value('models')).length === 0)) throw new Error('Custom APIs require a URL, a protocol and at least one model.')
        const ref = string(saved.apiKeyEnv) || (entry.settingsNs === 'llm-deepseek' ? 'DEEPSEEK_API_KEY' : String(managedProviderCredentialRef(entry.provider)))
        if (key !== '') {
          const info = await ctx.credentials.describe(credentialRef(ref))
          if (!info.writable) throw new Error('This credential is managed externally. Update its source before replacing it.')
        }
        signal.throwIfAborted()
        const ops: SettingsPathOp[] = [...changes].map(([field, fieldValue]) => fieldValue === undefined ? { op: 'unset', path: [...entry.settingsPath, field] } : { op: 'set', path: [...entry.settingsPath, field], value: fieldValue })
        if (key !== '' && saved.apiKeyEnv !== ref) ops.push({ op: 'set', path: [...entry.settingsPath, 'apiKeyEnv'], value: ref })
        if (creating && ops.length === 0) ops.push({ op: 'set', path: [...entry.settingsPath], value: {} })
        if (ops.length > 0) {
          await ctx.settings.mutate(section.ns, ops, section.revision)
          const next = describe(ctx, entry.settingsNs)
          if (next === undefined) throw new Error('Provider configuration is no longer available.')
          section = next
          saved = profile(section, entry)
          changes.clear(); creating = false
        }
        if (key !== '') {
          signal.throwIfAborted()
          assertRevision(ctx, section)
          try { await ctx.credentials.set(credentialRef(ref), key) }
          catch { throw new Error('Configuration saved, but the key could not be stored. Your key draft is kept; Apply retries saving it.') }
          key = ''
        }
        ctx.tui.notice('Provider saved. The selected model is unchanged.')
        return
      }
      if (choice === 'delete') {
        const confirm = await ctx.tui.prompt({ ...list, title: 'Delete provider', question: 'Remove this provider from the profile?', detail: entry.displayName + '\n' + entry.provider,
          options: [{ label: 'Cancel', value: 'cancel' }, { label: 'Delete provider', value: 'delete' }], initialValue: 'cancel', signal })
        if (confirm !== 'delete') continue
        signal.throwIfAborted(); assertRevision(ctx, section)
        if (!deletable(section, entry)) throw new Error('This provider is supplied by the deployment and cannot be deleted here.')
        const ref = string(saved.apiKeyEnv)
        if (ref === String(managedProviderCredentialRef(entry.provider))) {
          const info = await ctx.credentials.describe(credentialRef(ref))
          signal.throwIfAborted(); assertRevision(ctx, section)
          if (info.configured && info.writable && info.source === 'file') await ctx.credentials.unset(credentialRef(ref))
        }
        signal.throwIfAborted()
        await ctx.settings.mutate(section.ns, [{ op: 'unset', path: entry.settingsPath }], section.revision)
        ctx.tui.notice('Provider removed. The selected model is unchanged.')
        return
      }
      if (choice === 'reset') { changes.set('models', undefined); diagnostic = ''; continue }
      if (choice === 'fetch') {
        const found = await llm(ctx).discoverModels(entry.settingsNs, { ...(creating && custom(entry) ? {} : { provider: entry.provider }),
          ...(string(value('baseURL')) ? { baseURL: parseBaseURL(string(value('baseURL'))) } : {}), ...(string(value('api')) ? { api: string(value('api')) } : {}), ...(key === '' ? {} : { apiKey: key }) }, signal)
        if (signal.aborted) return
        const candidates = [...new Map(found.filter(row => row.id).map(row => [row.id, row])).values()]
        if (candidates.length === 0) throw new Error('No models were returned. Enter model ids manually.')
        const current = models(value('models'))
        const picked = await ctx.tui.prompt({ ...list, localize: ['title', 'question', 'actions'], title: 'Model list', question: 'Choose models to enable', multiSelect: true, filterable: true,
          initialValues: current.length === 0 ? candidates.map(row => row.id) : current.map(row => string(row.id)),
          options: candidates.map(row => ({ label: row.id, value: row.id, description: row.name ?? row.id })), signal })
        if (picked === null) continue
        const selected = new Set(parseModelIds(picked))
        assertCatalogWritable(section, [...entry.settingsPath, 'models'])
        const keep = current.filter(row => !candidates.some(candidate => candidate.id === row.id) || selected.has(string(row.id)))
        changes.set('models', [...keep, ...candidates.filter(row => selected.has(row.id) && !keep.some(existing => existing.id === row.id)).map(row => discoveredModel(entry, row))])
        diagnostic = ''; continue
      }
      if (choice === 'models') {
        assertCatalogWritable(section, [...entry.settingsPath, 'models'])
        if (changes.has('models') && value('models') === undefined) throw new Error('Apply the restored catalog before editing its models.')
        const inherited = !creating && value('models') === undefined
        const overrides = object(value('modelOverrides'))
        if (inherited && Object.keys(overrides).length) assertCatalogWritable(section, [...entry.settingsPath, 'modelOverrides'])
        const current = inherited
          ? (await llm(ctx).listModels(entry.provider)).map(row => ({ id: row.id, ...object(overrides[row.id]) }))
          : models(value('models'))
        const edited = await editModelCatalog(ctx, { models: current, inputField: entry.settingsNs === 'llm-deepseek' ? 'inputModalities' : 'input',
          reasoningLevels: custom(entry) ? modelReasoningLevels(section.schema) : [] }, signal)
        if (edited !== null && edited !== undefined) {
          changes.set('models', edited)
          if (inherited && Object.keys(overrides).length) changes.set('modelOverrides', undefined)
        }
        diagnostic = ''; continue
      }
      if (choice === 'api') {
        const api = await ctx.tui.prompt({ ...list, title: 'API protocol', question: 'Choose a protocol', initialValue: string(value('api')), options: protocols(section).map(api => ({ label: ({ 'openai-completions': 'OpenAI Chat Completions', 'openai-responses': 'OpenAI Responses', 'anthropic-messages': 'Anthropic Messages' } as Record<string, string>)[api] ?? api, value: api })), signal })
        if (api !== null) changes.set('api', api)
        continue
      }
      if (!['key', 'baseURL', 'displayName'].includes(choice)) continue
      let draft = choice === 'key' ? key : string(value(choice))
      let fieldError = ''
      while (!signal.aborted) {
        const raw = await ctx.tui.prompt(askPrompt({ localize: ['title', 'question', 'actions', 'detail'], title: 'Provider settings', question: ({ key: 'API key', baseURL: 'Base URL', displayName: 'Display name' } as Record<string, string>)[choice]!,
          detail: fieldError || (choice === 'key' ? 'Leave empty to keep the saved credential. Stored keys are never displayed.' : 'Leave empty to restore inheritance.'), initialInput: draft, secret: choice === 'key', signal }))
        if (raw === null) break
        draft = raw
        try {
          if (choice === 'key') key = raw.trim() === '' ? '' : normalizeKey(raw)
          else changes.set(choice, raw.trim() === '' ? undefined : choice === 'baseURL' ? parseBaseURL(raw) : raw.trim())
          diagnostic = ''; break
        } catch (error) { fieldError = errorText(error) }
      }
    } catch (error) {
      if (signal.aborted) return
      diagnostic = errorText(error)
      ctx.tui.notice(diagnostic, { level: 'error' })
    }
  }
}

function discoveredModel(entry: LlmConfigurableProvider, model: LlmDiscoveredModel): Record<string, unknown> {
  const { inputModalities, ...rest } = model
  return { ...rest, ...(inputModalities === undefined ? {} : { [entry.settingsNs === 'llm-deepseek' ? 'inputModalities' : 'input']: inputModalities }) }
}
