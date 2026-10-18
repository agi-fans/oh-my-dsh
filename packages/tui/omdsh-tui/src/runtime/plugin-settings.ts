/** Schema-driven configuration using path edits and revision-checked writes. */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-llm'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import type { BundleInfo } from '@deepseek-ai/dsh-plugin-manager'
import z from '@deepseek-ai/schemastery'

import type { PluginSettingsEntry } from '../views/settings-list.ts'
import type { TuiService } from '../definition.ts'
import { externalAgentDiagnostic, externalAgentGuide } from '../session/external-agents.ts'
import { preferencePaths } from './settings-preferences.ts'
import { resolveStatusBarConfig } from '../chrome/status-config.ts'

interface ProductForm {
  label: string
  section: NonNullable<PluginSettingsEntry['section']>
  fields: Record<string, string>
  inline?: string
  effect?: string
}

const SHELL_FORM: ProductForm = { label: 'Shell', section: 'tools', fields: { timeoutMs: 'Default timeout', maxTimeoutMs: 'Maximum timeout', maxOutputBytes: 'Output limit', maxSpillBytes: 'Retained output limit', graceMs: 'Shutdown grace' } }

// Presentation only: values, validation, inheritance and writes belong to each live schema.
const PRODUCT_FORMS: Record<string, ProductForm> = {
  'agent-loop': { label: 'Tool parallelism', section: 'tools', fields: { maxParallelToolCalls: 'Parallel tool calls' } },
  subagent: { label: 'Subagents', section: 'agent', fields: { maxDepth: 'Delegation depth', maxActiveSubagents: 'Concurrent subagents' } },
  'subagent-model-selection-settings': { label: 'Subagent models', section: 'agent', fields: { enabled: 'Model selection', allowedModels: 'Allowed models' }, inline: 'enabled', effect: 'Applies to new sessions; existing sessions keep their routes.' },
  bash: SHELL_FORM,
  pwsh: SHELL_FORM,
  'file-recovery': { label: 'File recovery snapshots', section: 'tools', fields: { enabled: 'Snapshots' }, inline: 'enabled', effect: 'Keeps private file contents. Changes apply to the next Turn; existing snapshots remain readable.' },
  advisor: { label: 'Advisor model calls', section: 'integrations', fields: { allowModelConsultations: 'Model consultations' }, inline: 'allowModelConsultations', effect: 'Controls consult_advisor; manual /advisor remains available.' },
  'hook-settings': { label: 'Command hooks', section: 'integrations', fields: { bridge: 'Hook compatibility', configPath: 'Configuration file' }, inline: 'bridge' },
  web: { label: 'Web providers', section: 'integrations', fields: { searchProvider: 'Search provider', fetchProvider: 'Fetch provider' },
    effect: 'Leave a provider empty to auto-select the only usable one; set an id when more than one is installed.' },
  'web-search-deepseek': { label: 'Web search', section: 'integrations',
    fields: { maxTokens: 'Token limit', maxUses: 'Search limit', apiKey: 'API key', apiKeyEnv: 'API key reference', baseURL: 'Endpoint', model: 'Model', apiVersion: 'API version' },
    effect: 'Search uses its own auxiliary request and credential; /login does not configure it.' },
}

// Already represented by dedicated controls, or accepted solely for migration.
const DEDICATED_FIELDS: Record<string, readonly string[]> = {
  tui: ['theme', 'colors', 'motion', 'mathMode', 'mermaidMode', 'editor', 'terminalProgress', 'terminalTitle', 'terminalState', 'pasteProtection', 'copyOnSelect', 'mouseInteraction', 'checkUpdates', 'startupChangelog', 'notifications', 'notificationFocus', 'notificationThreshold', 'statusBar', 'foldDensity', 'expandTools', 'statusPreset'],
  'agent-behavior': ['language'],
  // A deployment without the working-directory service may still set these in
  // its profile; normal sessions always run in the Session's current directory.
  bash: ['cwd'],
  pwsh: ['cwd'],
  'subagent-codex': ['model', 'permissionMode', 'env'],
  'subagent-claude-code': ['model', 'permissionMode', 'env'],
}

const NATIVE_INTEGRATIONS = [
  { id: 'integration:codex', label: 'Codex', bundle: '@deepseek-ai/dsh-subagent-codex' },
  { id: 'integration:claude', label: 'Claude Code', bundle: '@deepseek-ai/dsh-subagent-claude-code' },
] as const

export function nativeIntegrationId(bundle: string): string | undefined {
  return NATIVE_INTEGRATIONS.find(item => item.bundle === bundle)?.id
}

/** A failed user action needs acknowledgement before its covering form reopens. */
export async function showSettingsError(tui: Pick<TuiService, 'notice' | 'prompt'>, detail: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return
  tui.notice(detail, { level: 'error' })
  await tui.prompt({ title: 'Settings', question: 'Could not change configuration', detail,
    options: [{ label: 'Return to settings' }], allowCustom: false, notify: false,
    ...(signal === undefined ? {} : { signal }) })
}

/** Keep diagnostics on a reading surface until dismissed, including when opened from /plugins. */
export async function showIntegrationStatus(ctx: Context, bundle: string, signal: AbortSignal): Promise<void> {
  const manager = ctx.get('pluginManager')
  if (manager === undefined || signal.aborted) return
  const row = (await manager.listBundles()).find(row => row.name === bundle)
  const text = row === undefined ? 'This integration is no longer registered in this profile.'
    : externalAgentDiagnostic(row, await manager.listPlugins())
  if (signal.aborted) return
  await ctx.tui.prompt({ title: `${NATIVE_INTEGRATIONS.find(item => item.bundle === bundle)?.label ?? bundle} · Status`,
    question: 'Package and profile registration', presentation: 'document', documentSource: { text, language: 'text' },
    options: [{ label: 'Back', value: 'back' }], allowCustom: false, notify: false, signal })
}

export interface ConfigField {
  path: string[]
  schema: z
  secret: boolean
  /** Compound values containing secrets must be edited through their owner's form. */
  protected: boolean
}

function containsSecret(schema: z, seen = new Set<z>()): boolean {
  if (seen.has(schema)) return false
  seen.add(schema)
  return schema.meta.role === 'secret' || [schema.inner, ...schema.list ?? [], ...Object.values(schema.dict ?? {})]
    .some(child => child !== undefined && containsSecret(child, seen))
}

/** Flatten ordinary objects while retaining arrays and unions as atomic fields. */
export function configFields(schema: z, path: string[] = []): ConfigField[] {
  if (schema.meta.hidden || schema.meta.disabled || schema.meta.badges?.some(badge => badge.text === 'deprecated')) return []
  if (schema.type === 'object') return Object.entries(schema.dict ?? {}).flatMap(([key, child]) => configFields(child, [...path, key]))
  if (schema.type === 'intersect') return (schema.list ?? []).flatMap(child => configFields(child, path))
  if (path.length === 0) return []
  const secret = schema.meta.role === 'secret'
  return [{ path, schema, secret, protected: !secret && containsSecret(schema) }]
}

export function configValue(value: unknown, path: readonly string[]): unknown {
  for (const key of path) {
    if (value === null || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

function hasOverride(value: unknown, path: readonly string[]): boolean {
  for (const key of path) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return false
    value = (value as Record<string, unknown>)[key]
  }
  return true
}

function display(value: unknown): string {
  return value === undefined ? 'not set' : typeof value === 'string' ? value : JSON.stringify(value)
}

function credentialPath(field: ConfigField, fields: ConfigField[]): string[] | undefined {
  const path = [...field.path.slice(0, -1), 'apiKeyEnv']
  return field.secret && field.path.at(-1) === 'apiKey' && fields.some(item => item.path.join('.') === path.join('.')) ? path : undefined
}

function fieldDescription(section: SettingsDescriptor, field: ConfigField, fields: ConfigField[], human = false): string {
  const refPath = credentialPath(field, fields)
  const reference = refPath === undefined ? undefined : configValue(section.value, refPath)
  const inline = section.secrets?.find(secret => secret.path.join('.') === field.path.join('.'))?.set
  const value = field.secret ? `secret · ${inline ? 'configured' : typeof reference === 'string' && reference !== '' ? 'credential reference configured' : 'not set'}`
    : field.protected ? 'protected · use /login or the owner configuration' : human ? fieldDisplay(field, configValue(section.value, field.path)) : display(configValue(section.value, field.path))
  const override = hasOverride(section.user, field.path) || refPath !== undefined && hasOverride(section.user, refPath)
  const help = field.schema.meta.description
  return `${value} · ${override ? 'profile override' : 'inherited'}${typeof help === 'string' && help !== '' ? ` · ${help}` : ''}`
}

export function parseConfigValue(field: ConfigField, text: string): unknown {
  const value: unknown = field.schema.type === 'string' ? text : JSON.parse(text)
  field.schema(value)
  return value
}

const list = { presentation: 'fullscreen-list' as const, optionLayout: 'compact' as const, filterable: true, allowCustom: false, notify: false }

function constantValues(field: ConfigField): unknown[] | undefined {
  return field.schema.type === 'boolean' ? [true, false] : field.schema.type === 'union'
    && field.schema.list?.every(child => child.type === 'const') ? field.schema.list.map(child => child.value) : undefined
}

function choiceLabel(value: unknown): string {
  return typeof value === 'boolean' ? value ? 'On' : 'Off' : display(value)
}

/** Human units are presentation only; owner schemas still validate the stored numbers. */
export function fieldDisplay(field: ConfigField, value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'boolean') return choiceLabel(value)
  if (typeof value !== 'number') return display(value)
  const name = field.path.at(-1) ?? ''
  if (name.endsWith('Ms')) return value !== 0 && value % 60_000 === 0 ? `${value / 60_000}m` : value !== 0 && value % 1000 === 0 ? `${value / 1000}s` : `${value}ms`
  if (name.endsWith('Bytes')) {
    for (const [unit, factor] of [['GiB', 1024 ** 3], ['MiB', 1024 ** 2], ['KiB', 1024]] as const) if (value !== 0 && value % factor === 0) return `${value / factor} ${unit}`
    return `${value} B`
  }
  return display(value)
}

function parseProductValue(field: ConfigField, text: string): unknown {
  if (field.schema.type === 'number') {
    const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*$/iu.exec(text)
    const factors: Record<string, number> = (field.path.at(-1) ?? '').endsWith('Ms') ? { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }
      : (field.path.at(-1) ?? '').endsWith('Bytes') ? { b: 1, kb: 1000, mb: 1000 ** 2, gb: 1000 ** 3, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3 } : {}
    const factor = match === null ? undefined : factors[match[2]!.toLowerCase()]
    if (match !== null && factor !== undefined) { const value = Number(match[1]) * factor; field.schema(value); return value }
  }
  return parseConfigValue(field, text)
}

export function pluginSettingsEntries(ctx: Context, bundles?: readonly BundleInfo[]): PluginSettingsEntry[] {
  const entries: PluginSettingsEntry[] = ctx.settings.describe({ redactSecrets: true }).flatMap(section => {
    const fields = configFields(new z(section.schema as Partial<z>))
    const ns = String(section.ns), form = Object.hasOwn(PRODUCT_FORMS, ns) ? PRODUCT_FORMS[ns] : undefined
    const paths = fields.map(field => field.path.join('.'))
    const claimed = [...(Object.hasOwn(DEDICATED_FIELDS, ns) ? DEDICATED_FIELDS[ns] ?? [] : []), ...Object.keys(form?.fields ?? {})]
    const owned = paths.filter(path => Object.hasOwn(form?.fields ?? {}, path))
    const advanced = section.autoGenerate === false ? [] : paths.filter(path => !claimed.includes(path))
    const writable = ctx.settings.writable ? 'Edits apply live to this profile.' : 'This profile is read-only.'
    const summary = fields.filter(field => owned.includes(field.path.join('.')) && !field.secret && !field.protected
      && configValue(section.value, field.path) !== undefined).slice(0, 2)
      .map(field => `${form?.fields[field.path.join('.')]}: ${Array.isArray(configValue(section.value, field.path)) ? `${(configValue(section.value, field.path) as unknown[]).length} selected` : fieldDisplay(field, configValue(section.value, field.path))}`).join(' · ')
    const field = fields.find(field => field.path.join('.') === form?.inline)
    const values = field === undefined || field.secret || field.protected ? undefined : constantValues(field)
    const inline = field === undefined || values === undefined || values.length === 0 ? undefined : {
      path: field.path, revision: section.revision, value: choiceLabel(configValue(section.value, field.path)),
      choices: ctx.settings.writable ? values.map(value => ({ label: choiceLabel(value), value: JSON.stringify(value) })) : [],
    }
    return [
      ...(form === undefined || owned.length === 0 ? [] : [{ id: ns, namespace: ns, label: form.label, section: form.section, fields: owned,
        ...(inline === undefined ? {} : { inline }), summary, keywords: [...owned, ...Object.values(form.fields)],
        description: `${form.effect === undefined ? '' : `${form.effect} `}${field === undefined ? '' : `${fieldDescription(section, field, fields)} · `}${writable}` }]),
      ...(advanced.length === 0 ? [] : [{ id: `advanced:${ns}`, namespace: ns,
        label: String(section.ns).replace(/[-_]+/gu, ' ').replace(/^./u, first => first.toUpperCase()), section: 'advanced' as const, fields: advanced,
        summary: `${advanced.length} fields`, keywords: advanced, description: `${ns} · ${advanced.length} fields · ${writable}` }]),
    ]
  })
  if (ctx.get('pluginManager') !== undefined) entries.push(...NATIVE_INTEGRATIONS.map(item => {
    const bundle = bundles?.find(bundle => bundle.name === item.bundle)
    return { id: item.id, label: item.label, section: 'integrations' as const, fields: [],
      summary: bundles === undefined ? 'Details' : bundle === undefined || bundle.availability === 'missing' ? 'Unavailable' : bundle.error !== undefined ? 'Load error' : bundle.enabled ? 'Enabled' : 'Disabled',
      description: 'Provider model, permissions and profile enablement. Native login has not been checked; Installation status reports registration.' }
  }))
  return entries
}

/** Write the displayed snapshot's revision; a concurrent change must never be silently overwritten. */
export async function setSettingsEntry(ctx: Context, entry: PluginSettingsEntry, choice: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const inline = entry.inline
  if (!ctx.settings.writable) throw new Error('This profile is read-only.')
  if (entry.namespace === undefined || inline === undefined || !inline.choices.some(item => item.value === choice)) throw new Error('This setting is no longer editable. Refresh and retry.')
  const section = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === entry.namespace)
  if (section === undefined || section.revision !== inline.revision) throw new Error('Configuration changed. Refresh and retry.')
  const form = Object.hasOwn(PRODUCT_FORMS, entry.namespace) ? PRODUCT_FORMS[entry.namespace] : undefined
  const field = configFields(new z(section.schema as Partial<z>)).find(field => field.path.join('.') === inline.path.join('.') && field.path.join('.') === form?.inline)
  if (field === undefined || field.secret || field.protected) throw new Error('This setting is no longer editable. Refresh and retry.')
  await saveValue(ctx, section, field, parseConfigValue(field, choice))
  ctx.tui.notice(`${form?.fields[field.path.join('.')] ?? entry.label}: saved.`)
}

/** Route a product row to its original owner; installation remains in /plugins. */
export async function editSettingsEntry(ctx: Context, id: string, signal: AbortSignal, resetOnly = false): Promise<void> {
  const native = NATIVE_INTEGRATIONS.find(item => item.id === id)
  if (native !== undefined) {
    const manager = ctx.get('pluginManager')
    if (manager === undefined) return
    while (!signal.aborted) {
      const row = (await manager.listBundles()).find(row => row.name === native.bundle)
      if (row === undefined || row.availability === 'missing') { await showSettingsError(ctx.tui, `${native.label} is unavailable. Open /plugins → Bundles to install or repair its package.`, signal); return }
      const ns = row.rows.find(item => item.moduleName === row.name)?.rowId
      const configurable = ns !== undefined && ctx.get('settings')?.describe({ redactSecrets: true }).some(section => section.ns === ns)
      const action = await ctx.tui.prompt({ ...list, title: native.label, question: row.enabled ? 'Enabled' : 'Disabled',
        detail: [row.error === undefined ? undefined : `Load error: ${row.error.diagnostic ?? row.error.code}`, externalAgentGuide(row.name)].filter(Boolean).join('\n\n'), options: [{ label: row.enabled ? 'Disable integration' : 'Enable integration', value: 'toggle' },
          ...(configurable ? [{ label: 'Model', value: 'field:model' }, { label: 'Permissions', value: 'field:permissionMode' }] : []), ...(configurable ? [{ label: 'Restore inherited model or permissions…', value: 'restore' }] : []), { label: 'Installation status', value: 'check' }], notify: false, signal })
      if (action === null || signal.aborted) return
      if (action === 'toggle') {
        const result = await manager.setBundleEnabled(row.name, !row.enabled)
        if (result.error !== undefined || result.application === 'failed') await showSettingsError(ctx.tui, result.error?.diagnostic ?? result.error?.code ?? 'Could not change integration.', signal)
        else ctx.tui.notice(`${native.label}: ${result.application}${result.enabled === undefined ? '' : result.enabled ? ' · enabled' : ' · disabled'}.`)
      }
      if (action.startsWith('field:') && configurable && ns !== undefined) await editPluginSettings(ctx, ns, signal, [action.slice(6)], { label: native.label, fields: { model: 'Model', permissionMode: 'Permissions' } })
      if (action === 'restore' && configurable && ns !== undefined) await editPluginSettings(ctx, ns, signal, ['model', 'permissionMode'], { label: native.label, fields: { model: 'Model', permissionMode: 'Permissions' } }, true)
      if (action === 'check') await showIntegrationStatus(ctx, row.name, signal)
    }
    return
  }
  const entry = pluginSettingsEntries(ctx).find(entry => entry.id === id)
  if (entry?.namespace === undefined) return
  await editPluginSettings(ctx, entry.namespace, signal, entry.fields, entry.section === 'advanced' ? undefined : PRODUCT_FORMS[entry.namespace], resetOnly)
}

/** Restore only the chosen owner fields, fenced to the configuration shown by the confirmation. */
export async function resetSettingsControl(ctx: Context, id: string, entry: PluginSettingsEntry | undefined, signal: AbortSignal, label = entry?.label ?? id): Promise<void> {
  if (entry !== undefined && entry.inline === undefined) { await editSettingsEntry(ctx, entry.id, signal, true); return }
  const ns = entry?.namespace ?? (id === 'agentLanguage' ? 'agent-behavior' : 'tui')
  const paths = entry?.inline === undefined ? id === 'agentLanguage' ? [['language']] : preferencePaths(id) : [[...entry.inline.path]]
  if (paths === undefined || !ctx.settings.writable) throw new Error('This setting cannot be restored in this profile.')
  const section = ctx.settings.describe({ redactSecrets: true }).find(section => section.ns === ns)
  if (section === undefined || entry?.inline !== undefined && section.revision !== entry.inline.revision) throw new Error('Configuration changed. Refresh and retry.')
  const revision = section.revision
  const fields = configFields(new z(section.schema as Partial<z>))
  const status = resolveStatusBarConfig(configValue(section.base, ['statusBar']) as never, configValue(section.base, ['statusPreset']) as never)
  const inherited = id === 'statusReset' ? `Context: ${status.contextStyle}\nTelemetry: ${status.groups.length} items\nHeader: ${status.meta.length} items` : paths.map(path => {
    let value = configValue(section.base, path)
    if (path[0] === 'statusBar') value = configValue(status, path.slice(1))
    const field = fields.find(field => field.path.join('.') === path.join('.'))
    if (value === undefined) value = field?.schema.meta.default
    return `${path[0] === 'statusBar' && path.length === 1 ? 'Layout' : label}: ${display(value)}`
  }).join('\n')
  const choice = await ctx.tui.prompt({ title: 'Restore inherited setting', question: id.startsWith('statusItem:') ? `${label} color` : label,
    detail: `${inherited}\nOnly these Profile overrides will be removed.`, options: [{ label: 'Restore inherited value', value: 'restore' }], allowCustom: false, notify: false, signal })
  if (choice !== 'restore' || signal.aborted) return
  if (entry?.inline !== undefined) {
    const field = configFields(new z(section.schema as Partial<z>)).find(field => field.path.join('.') === entry.inline!.path.join('.'))
    if (field === undefined || field.secret || field.protected) throw new Error('This setting is no longer editable.')
    validateModelSelection(section, field, configValue(section.base, field.path))
  }
  await ctx.settings.mutate(ns, paths.map(path => ({ op: 'unset' as const, path })), revision)
  ctx.tui.notice('Inherited setting restored.')
}

export async function editPluginSettings(ctx: Context, ns: string, signal: AbortSignal, allowedFields?: readonly string[], presentation?: Pick<ProductForm, 'label' | 'fields'>, resetOnly = false): Promise<void> {
  let focusedPath: string | undefined
  const directField = presentation !== undefined && allowedFields?.length === 1 && ['subagent-codex', 'subagent-claude-code'].includes(ns)
  while (!signal.aborted) {
    // Re-read after every write; never carry a stale editor into another field.
    const descriptor = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === ns)
    if (descriptor === undefined) { await showSettingsError(ctx.tui, `No editable configuration for ${ns}.`, signal); return }
    const section = { ...descriptor }
    const fields = configFields(new z(section.schema as Partial<z>)).filter(field => allowedFields === undefined || allowedFields.includes(field.path.join('.')))
    const currentIndex = fields.findIndex(field => field.path.join('.') === focusedPath)
    let selected = directField && !resetOnly ? '0' : await ctx.tui.prompt({ ...list, ...(currentIndex < 0 ? {} : { initialValue: String(currentIndex) }), title: presentation?.label ?? String(section.ns), question: resetOnly ? 'Choose a setting to restore' : 'Choose a setting',
      options: fields.map((field, index) => ({ label: presentation?.fields[field.path.join('.')] ?? field.path.join('.'), value: String(index),
        description: fieldDescription(section, field, fields, presentation !== undefined) })).concat(presentation !== undefined && !resetOnly ? [{ label: 'Restore inherited setting…', value: 'restore', description: 'Remove a selected Profile override.' }] : []), signal })
    if (selected === null) break
    const restore = resetOnly || selected === 'restore'
    if (selected === 'restore') selected = await ctx.tui.prompt({ ...list, title: presentation?.label ?? ns, question: 'Choose a setting to restore',
      options: fields.map((field, index) => ({ label: presentation?.fields[field.path.join('.')] ?? field.path.join('.'), value: String(index), description: fieldDescription(section, field, fields, presentation !== undefined) })), signal })
    if (selected === null || signal.aborted) continue
    const field = fields[Number(selected)]
    if (field === undefined || field.protected) continue
    focusedPath = field.path.join('.')
    if (!ctx.settings.writable) { await showSettingsError(ctx.tui, 'This profile is read-only.', signal); continue }
    const label = presentation?.fields[field.path.join('.')] ?? field.path.join('.')
    const action = presentation !== undefined && !restore ? 'set' : await ctx.tui.prompt({ title: label, question: restore ? 'Restore inherited value?' : 'Set a value or restore inheritance',
      detail: field.secret ? 'Secret values are never shown. Reset removes the profile value and its paired credential reference; inherited credentials may still apply.' : `Current: ${presentation === undefined ? display(configValue(section.value, field.path)) : fieldDisplay(field, configValue(section.value, field.path))}\nInherited: ${presentation === undefined ? display(configValue(section.base, field.path)) : fieldDisplay(field, configValue(section.base, field.path))}`,
      options: [...(restore ? [] : [{ label: 'Set value', value: 'set' }]), { label: 'Reset to inherited', value: 'reset' }], allowCustom: false, notify: false, signal })
    if (action === null || signal.aborted) continue
    try {
      if (action === 'reset') {
        validateModelSelection(section, field, configValue(section.base, field.path))
        const refPath = credentialPath(field, fields)
        await ctx.settings.mutate(ns, [{ op: 'unset', path: field.path }, ...(refPath === undefined ? [] : [{ op: 'unset' as const, path: refPath }])], section.revision)
      }
      else if (section.ns === 'subagent-model-selection-settings' && field.path.join('.') === 'allowedModels') {
        const routes = await chooseSubagentModels(ctx, configValue(section.value, field.path), signal)
        if (routes === null) continue
        field.schema(routes)
        await saveValue(ctx, section, field, routes)
      }
      else {
        const constants = constantValues(field)
        const current = configValue(section.value, field.path)
        const unitHelp = field.schema.type !== 'number' ? '' : (field.path.at(-1) ?? '').endsWith('Ms') ? 'Use milliseconds, or units such as 30s and 2m.'
          : (field.path.at(-1) ?? '').endsWith('Bytes') ? 'Use bytes, or units such as 512 KiB and 2 MiB.' : ''
        const text = await ctx.tui.prompt({ title: label, question: field.schema.type === 'string' || presentation !== undefined && field.schema.type === 'number' ? 'Enter a value' : constants === undefined ? 'Enter a JSON value' : 'Choose a value',
          ...(field.secret ? {} : { detail: presentation === undefined ? field.schema.toString() : [`Current: ${fieldDisplay(field, current)}`, field.schema.meta.description, unitHelp].filter(Boolean).join('\n') }), secret: field.secret,
          ...(field.secret ? {} : constants === undefined ? { initialInput: current === undefined ? '' : presentation !== undefined && field.schema.type === 'number' ? fieldDisplay(field, current) : field.schema.type === 'string' ? String(current) : JSON.stringify(current) }
            : { initialValue: JSON.stringify(current) }),
          ...(constants === undefined ? { allowCustom: true } : { allowCustom: false, options: constants.map(value => ({ label: presentation !== undefined && typeof value === 'boolean' ? value ? 'On' : 'Off' : display(value), value: JSON.stringify(value) })) }), notify: false, signal })
        if (text === null || signal.aborted) { if (directField) return; continue }
        const value = presentation === undefined ? parseConfigValue(field, text) : parseProductValue(field, text)
        await saveValue(ctx, section, field, value)
      }
      ctx.tui.notice(`${presentation === undefined ? `${ns}.${field.path.join('.')}` : label}: ${action === 'reset' ? 'inherited value restored' : 'saved'}.`)
      if (directField && !resetOnly) return
    } catch (error) {
      // Secret validation messages may echo their input.
      await showSettingsError(ctx.tui, field.secret ? 'Could not save the secret. Refresh the field and check its format or credential storage.' : error instanceof Error ? error.message : String(error), signal)
    }
  }
}

async function chooseSubagentModels(ctx: Context, current: unknown, signal: AbortSignal): Promise<{ provider: string; model: string }[] | null> {
  const routes: { provider: string; model: string; label: string; description?: string }[] = []
  const key = (route: { provider: string; model: string }): string => JSON.stringify([route.provider, route.model])
  const existing = Array.isArray(current) ? current.filter((route): route is { provider: string; model: string } => route !== null && typeof route === 'object' && typeof route.provider === 'string' && typeof route.model === 'string') : []
  const llm = ctx.get('llm')
  const unavailable: string[] = []
  if (llm !== undefined) {
    const providers = llm.listProviders()
    const catalogs = await Promise.allSettled(providers.map(provider => llm.listModels(provider.id)))
    signal.throwIfAborted()
    catalogs.forEach((catalog, index) => {
      const provider = providers[index]!
      if (catalog.status === 'rejected') { unavailable.push(provider.id); return }
      for (const model of catalog.value) routes.push({ provider: provider.id, model: model.id, label: `${model.name ?? model.id} · ${provider.id}`, description: model.description ?? model.id })
    })
  }
  for (const route of existing) if (!routes.some(item => key(item) === key(route))) routes.push({ ...route, label: `${route.model} · ${route.provider}`, description: 'Configured route · currently outside the model catalog' })
  const unique = routes.filter((route, index) => routes.findIndex(item => key(item) === key(route)) === index)
  const answer = await ctx.tui.prompt({ ...list, title: 'Allowed subagent models', question: 'Choose models for new sessions', detail: `Space toggles a model. Enter saves the selection. Existing sessions keep their routes.${unavailable.length === 0 ? '' : ` Catalog unavailable: ${unavailable.join(', ')}; configured routes are retained.`}`,
    emptyText: 'No models are available. Configure a provider through /login or cancel to keep the current setting.',
    multiSelect: true, allowEmptySelection: true, initialValues: unique.flatMap((route, index) => existing.some(item => key(item) === key(route)) ? [String(index)] : []),
    options: unique.map((route, index) => ({ label: route.label, ...(route.description === undefined ? {} : { description: route.description }), value: String(index) })), signal, notify: false })
  if (answer === null) return null
  if (answer === '') return []
  return answer.split(', ').map(value => {
    const route = unique[Number(value)]
    if (route === undefined || !/^\d+$/u.test(value)) throw new Error('Model selection changed. Refresh and retry.')
    return { provider: route.provider, model: route.model }
  })
}

function validateModelSelection(section: SettingsDescriptor, field: ConfigField, value: unknown): void {
  if (section.ns === 'subagent-model-selection-settings') {
    const enabled = field.path[0] === 'enabled' ? value : configValue(section.value, ['enabled'])
    const models = field.path[0] === 'allowedModels' ? value : configValue(section.value, ['allowedModels'])
    if (enabled === true && (!Array.isArray(models) || models.length === 0)) throw new Error('Choose at least one allowed model before enabling subagent model selection.')
  }
}

async function saveValue(ctx: Context, section: SettingsDescriptor, field: ConfigField, value: unknown): Promise<void> {
  validateModelSelection(section, field, value)
  const fields = configFields(new z(section.schema as Partial<z>))
  const envPath = credentialPath(field, fields)
  if (envPath !== undefined) {
    // Persist the key through Harness credentials; the profile holds only the
    // reference. A fresh slot avoids changing an existing key if the fenced
    // profile write loses a race after credential storage finishes.
    if (ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === section.ns)?.revision !== section.revision) throw new Error('Configuration changed. Refresh and retry.')
    const ref = credentialRef(`OMDSH_${[section.ns, ...field.path.slice(0, -1)].join('_').toUpperCase().replace(/[^A-Z0-9]+/gu, '_')}_API_KEY_${randomUUID().replace(/-/gu, '').toUpperCase()}`)
    await ctx.credentials.set(ref, String(value))
    try {
      await ctx.settings.mutate(section.ns, [{ op: 'unset', path: field.path }, { op: 'set', path: envPath, value: String(ref) }], section.revision)
    } catch (error) { await ctx.credentials.unset(ref); throw error }
  } else await ctx.settings.mutate(section.ns, [{ op: 'set', path: field.path, value }], section.revision)
}
