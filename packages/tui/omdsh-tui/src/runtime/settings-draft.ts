/** A single Harness namespace edited through a staged, revision-fenced form. */
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsDescriptor, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { walkPath } from '../commands/auth-providers.ts'
import { askPrompt } from '../prompt-intents.ts'
import { resolveUiLanguage, uiText } from '../locale/index.ts'

interface DraftField {
  key: string
  label: string
  help: string
  defaultValue: unknown
  parse(raw: string): unknown
  format(value: unknown): string
  validate(value: unknown): void
}
const object = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
const list = { allowCustom: false, notify: false, localize: ['title', 'question', 'actions'] } as const

/** Shared status line for staged settings; the count includes pending field writes. */
export function settingsDraftSummary(ctx: Context, count: number): string {
  const language = resolveUiLanguage(ctx.tui.prefs().uiLanguage)
  if (!ctx.settings.writable) return uiText(language, 'Profile · Read only')
  if (count === 1) return uiText(language, 'Profile · 1 pending change · Apply to save')
  return count === 0 ? uiText(language, 'Profile · No pending changes')
    : uiText(language, 'Profile · {count} pending changes · Apply to save', { count })
}

/** Resolve changed fields against a fresh revision without mutating the caller's draft. */
export async function rebaseSettingsDraft(
  ctx: Context, baseline: SettingsDescriptor, latest: SettingsDescriptor, changes: ReadonlyMap<string, unknown>,
  fields: readonly Pick<DraftField, 'key' | 'label' | 'defaultValue' | 'format'>[], signal: AbortSignal, prefix: readonly string[] = [],
): Promise<{ section: SettingsDescriptor; changes: Map<string, unknown> } | undefined> {
  const text = (source: string): string => uiText(resolveUiLanguage(ctx.tui.prefs().uiLanguage), source)
  const next = structuredClone(latest), rebased = new Map(changes)
  for (const field of fields) {
    if (!changes.has(field.key)) continue
    const path = [...prefix, field.key]
    const read = (value: unknown): unknown => walkPath(value, path)
    const owns = (value: unknown): boolean => Object.hasOwn(object(walkPath(value, prefix)), field.key)
    const desired = changes.get(field.key)
    const state = (section: SettingsDescriptor) => [read(section.value), read(section.base), owns(section.user), read(section.user),
      section.secrets?.filter(secret => secret.path.slice(0, path.length).join('.') === path.join('.'))]
    const alreadyApplied = desired === undefined ? !owns(next.user) : owns(next.user) && isDeepStrictEqual(read(next.user), desired)
    if (alreadyApplied) { rebased.delete(field.key); continue }
    if (isDeepStrictEqual(state(baseline), state(next))) continue
    const protectedField = [baseline, next].some(section => section.secrets?.some(secret =>
      path.slice(0, secret.path.length).join('.') === secret.path.join('.') || secret.path.slice(0, path.length).join('.') === path.join('.')))
    const format = (value: unknown): string => protectedField ? text('Protected value') : field.format(value)
    const answer = await ctx.tui.prompt({ ...list, title: 'Setting changed elsewhere', question: field.label, dismissLabel: 'Back',
      detail: text('Choose which value to keep in the draft. Apply saves the result.'),
      options: [
        { label: text('Keep my change'), value: 'mine', description: format(desired ?? read(next.base) ?? field.defaultValue) + (desired === undefined ? ' · ' + text('Inherited') : '') },
        { label: text('Use latest value'), value: 'latest', description: format(read(next.value) ?? field.defaultValue) },
      ], signal })
    if (answer === null || signal.aborted) return undefined
    if (answer === 'latest') rebased.delete(field.key)
  }
  return signal.aborted ? undefined : { section: next, changes: rebased }
}

/** Cancel drops only this form's draft. Apply writes all changed fields in one mutation. */
export async function editSettingsDraft(ctx: Context, section: SettingsDescriptor, title: string, fields: readonly DraftField[], signal: AbortSignal, resetOnly = false): Promise<void> {
  if (!fields.length || signal.aborted) return
  let baseline = structuredClone(section)
  const changes = new Map<string, unknown>()
  const text = (source: string): string => uiText(resolveUiLanguage(ctx.tui.prefs().uiLanguage), source)
  const inherited = (field: DraftField): unknown => object(baseline.base)[field.key] ?? field.defaultValue
  const effective = (field: DraftField): unknown => changes.has(field.key) ? changes.get(field.key) ?? inherited(field) : object(baseline.value)[field.key] ?? field.defaultValue
  const summary = (field: DraftField): string => field.format(effective(field)) + ' · ' + text(changes.has(field.key) ? 'Draft' : Object.hasOwn(object(baseline.user), field.key) ? 'Profile override' : 'Inherited')
  let diagnostic = '', focused = fields[0]!.key, stale = false
  const reload = async (): Promise<void> => {
    const latest = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === baseline.ns)
    if (latest === undefined) { diagnostic = 'These settings are no longer available. Cancel and reopen Settings.'; return }
    const result = await rebaseSettingsDraft(ctx, baseline, latest, changes, fields, signal)
    if (result === undefined) return
    baseline = result.section
    changes.clear()
    for (const [key, value] of result.changes) changes.set(key, value)
    stale = false
    diagnostic = 'Latest settings loaded. Your remaining changes are ready to apply.'
  }
  const restore = async (): Promise<void> => {
    const choice = await ctx.tui.prompt({ ...list, title, question: 'Choose a setting to restore', detail: text('Restoring inheritance changes the draft. Apply saves it.'), initialValue: focused,
      options: fields.map(field => ({ label: text(field.label), value: field.key, description: summary(field), preview: text(field.help) })), signal })
    const field = fields.find(field => field.key === choice)
    if (field !== undefined && !signal.aborted) { changes.set(field.key, undefined); focused = field.key; diagnostic = '' }
  }
  const edit = async (field: DraftField): Promise<void> => {
    let input = effective(field) === undefined ? '' : field.format(effective(field)), error = ''
    while (!signal.aborted) {
      const raw = await ctx.tui.prompt(askPrompt({ localize: ['title', 'question', 'actions'], title, question: field.label, initialInput: input,
        detail: [text(field.help), text(error || 'Leave empty to restore inheritance.')].join('\n'), signal }))
      if (raw === null) return
      input = raw
      try {
        const value = raw.trim() ? field.parse(raw) : undefined
        if (value !== undefined) field.validate(value)
        changes.set(field.key, value); diagnostic = ''; return
      } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    }
  }
  if (resetOnly && ctx.settings.writable) await restore()
  while (!signal.aborted) {
    const writable = ctx.settings.writable
    const choice = await ctx.tui.prompt({ ...list, title, question: 'Edit the draft, then Apply to save', detail: [settingsDraftSummary(ctx, changes.size), text(diagnostic)].filter(Boolean).join('\n'), initialValue: focused,
      options: [...fields.map(field => ({ label: text(field.label), value: field.key, description: summary(field), preview: text(field.help), disabled: !writable })),
        { label: text('Restore inherited setting…'), value: '@restore', disabled: !writable },
        ...(stale ? [{ label: text('Load latest and keep draft'), value: '@reload' }] : []),
        { label: text('Apply'), value: '@apply', disabled: !writable || !changes.size }, { label: text('Cancel'), value: '@cancel' }], signal })
    if (choice === null || choice === '@cancel' || signal.aborted) return
    if (!ctx.settings.writable) continue
    const field = fields.find(field => field.key === choice)
    if (field !== undefined) { focused = field.key; await edit(field); continue }
    if (choice === '@reload') { await reload(); continue }
    if (choice === '@restore') { await restore(); continue }
    if (choice !== '@apply' || !changes.size) continue
    try {
      signal.throwIfAborted()
      const current = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === baseline.ns)
      if (current === undefined) throw new Error('These settings are no longer available. Cancel and reopen Settings.')
      if (current.revision !== baseline.revision) {
        stale = true
        throw new Error('Configuration changed. Load the latest settings to continue with your draft.')
      }
      for (const field of fields) if (changes.has(field.key) && effective(field) !== undefined) field.validate(effective(field))
      const ops: SettingsPathOp[] = [...changes].map(([key, value]) => value === undefined ? { op: 'unset', path: [key] } : { op: 'set', path: [key], value })
      await ctx.settings.mutate(baseline.ns, ops, baseline.revision)
      if (!signal.aborted) ctx.tui.notice(`${text(title)}: ${text('Settings saved.')}`)
      return
    } catch (cause) {
      if (signal.aborted) return
      stale = ctx.settings.describe({ redactSecrets: true }).some(item => item.ns === baseline.ns && item.revision !== baseline.revision)
      diagnostic = cause instanceof Error ? cause.message : String(cause)
    }
  }
}
