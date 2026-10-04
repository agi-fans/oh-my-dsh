/** Schema-driven configuration using path edits and revision-checked writes. */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

import type { PluginSettingsEntry } from '../views/settings-list.ts'

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
  if (schema.meta.hidden || schema.meta.disabled) return []
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

function fieldDescription(section: SettingsDescriptor, field: ConfigField, fields: ConfigField[]): string {
  const refPath = credentialPath(field, fields)
  const reference = refPath === undefined ? undefined : configValue(section.value, refPath)
  const inline = section.secrets?.find(secret => secret.path.join('.') === field.path.join('.'))?.set
  const value = field.secret ? `secret · ${inline ? 'configured' : typeof reference === 'string' && reference !== '' ? 'credential reference configured' : 'not set'}`
    : field.protected ? 'protected · use /auth or the owner configuration' : display(configValue(section.value, field.path))
  const override = hasOverride(section.user, field.path) || refPath !== undefined && hasOverride(section.user, refPath)
  const help = field.schema.meta.description
  return `${value} · ${override ? 'profile override' : 'inherited'}${typeof help === 'string' && help !== '' ? ` · ${help}` : ''}`
}

export function parseConfigValue(field: ConfigField, text: string): unknown {
  const value: unknown = field.schema.type === 'string' ? text : JSON.parse(text)
  field.schema(value)
  return value
}

const list = { presentation: 'fullscreen-list' as const, optionLayout: 'compact' as const, filterable: true, allowCustom: false }

export function pluginSettingsEntries(ctx: Context): PluginSettingsEntry[] {
  return ctx.settings.describe({ redactSecrets: true }).flatMap(section => {
    const fields = configFields(new z(section.schema as Partial<z>))
    const label = String(section.ns).replace(/[-_]+/gu, ' ').replace(/^./u, first => first.toUpperCase())
    return fields.length === 0 ? [] : [{ id: String(section.ns), label,
      description: `${section.ns} · ${fields.length} fields · ${ctx.settings.writable ? 'Edits apply live to this profile; Esc returns to Settings.' : 'This profile is read-only.'}` }]
  })
}

export async function editPluginSettings(ctx: Context, ns: string, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    // Re-read after every write; never carry a stale editor into another field.
    const section = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === ns)
    if (section === undefined) { ctx.tui.notice(`No editable configuration for ${ns}.`, { level: 'error' }); return }
    const fields = configFields(new z(section.schema as Partial<z>))
    const selected = await ctx.tui.prompt({ ...list, title: String(section.ns), question: 'Choose a field',
      options: fields.map((field, index) => ({ label: field.path.join('.'), value: String(index),
        description: fieldDescription(section, field, fields) })), signal })
    if (selected === null) break
    const field = fields[Number(selected)]
    if (field === undefined || field.protected) continue
    if (!ctx.settings.writable) { ctx.tui.notice('This profile is read-only.'); continue }
    const action = await ctx.tui.prompt({ title: field.path.join('.'), question: 'Set a value or restore inheritance',
      detail: field.secret ? 'Secret values are never shown. Reset removes the profile value and its paired credential reference; inherited credentials may still apply.' : `Current: ${display(configValue(section.value, field.path))}\nInherited: ${display(configValue(section.base, field.path))}`,
      options: [{ label: 'Set value', value: 'set' }, { label: 'Reset to inherited', value: 'reset' }], allowCustom: false, signal })
    if (action === null || signal.aborted) continue
    try {
      if (action === 'reset') {
        validateModelSelection(section, field, configValue(section.base, field.path))
        const refPath = credentialPath(field, fields)
        await ctx.settings.mutate(ns, [{ op: 'unset', path: field.path }, ...(refPath === undefined ? [] : [{ op: 'unset' as const, path: refPath }])], section.revision)
      }
      else {
        const constants = field.schema.type === 'boolean' ? [true, false] : field.schema.type === 'union'
          && field.schema.list?.every(child => child.type === 'const') ? field.schema.list.map(child => child.value) : undefined
        const text = await ctx.tui.prompt({ title: field.path.join('.'), question: field.schema.type === 'string' ? 'Enter a value' : 'Enter a JSON value',
          ...(field.secret ? {} : { detail: field.schema.toString() }), secret: field.secret,
          ...(constants === undefined ? { allowCustom: true } : { allowCustom: false, options: constants.map(value => ({ label: display(value), value: JSON.stringify(value) })) }), signal })
        if (text === null || signal.aborted) continue
        const value = parseConfigValue(field, text)
        await saveValue(ctx, section, field, value)
      }
      ctx.tui.notice(`${ns}.${field.path.join('.')}: ${action === 'reset' ? 'inherited value restored' : 'saved'}.`)
    } catch (error) {
      // Secret validation messages may echo their input.
      ctx.tui.notice(field.secret ? 'Could not save the secret. Refresh the field and check its format or credential storage.' : error instanceof Error ? error.message : String(error), { level: 'error' })
    }
  }
}

function validateModelSelection(section: SettingsDescriptor, field: ConfigField, value: unknown): void {
  if (section.ns === 'subagent-model-selection-settings') {
    const enabled = field.path[0] === 'enabled' ? value : configValue(section.value, ['enabled'])
    const models = field.path[0] === 'allowedModels' ? value : configValue(section.value, ['allowedModels'])
    if (enabled === true && (!Array.isArray(models) || models.length === 0)) throw new Error('Set at least one allowedModels route before enabling subagent model selection.')
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
