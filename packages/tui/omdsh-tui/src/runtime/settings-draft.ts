/** A single Harness namespace edited through a staged, revision-fenced form. */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsDescriptor, SettingsPathOp } from '@deepseek-ai/dsh-settings'
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

/** Cancel drops only this form's draft. Apply writes all changed fields in one mutation. */
export async function editSettingsDraft(ctx: Context, section: SettingsDescriptor, title: string, fields: readonly DraftField[], signal: AbortSignal, resetOnly = false): Promise<void> {
  if (!fields.length || signal.aborted) return
  const baseline = structuredClone(section)
  const changes = new Map<string, unknown>()
  const text = (source: string): string => uiText(resolveUiLanguage(ctx.tui.prefs().uiLanguage), source)
  const inherited = (field: DraftField): unknown => object(baseline.base)[field.key] ?? field.defaultValue
  const effective = (field: DraftField): unknown => changes.has(field.key) ? changes.get(field.key) ?? inherited(field) : object(baseline.value)[field.key] ?? field.defaultValue
  const summary = (field: DraftField): string => field.format(effective(field)) + ' · ' + text(changes.has(field.key) ? 'Draft' : Object.hasOwn(object(baseline.user), field.key) ? 'Profile override' : 'Inherited')
  let diagnostic = '', focused = fields[0]!.key
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
    const choice = await ctx.tui.prompt({ ...list, title, question: 'Edit the draft, then Apply to save', detail: text(diagnostic), initialValue: focused,
      options: [...fields.map(field => ({ label: text(field.label), value: field.key, description: summary(field), preview: text(field.help), disabled: !writable })),
        { label: text('Restore inherited setting…'), value: '@restore', disabled: !writable },
        { label: text('Apply'), value: '@apply', disabled: !writable || !changes.size }, { label: text('Cancel'), value: '@cancel' }], signal })
    if (choice === null || choice === '@cancel' || signal.aborted) return
    if (!ctx.settings.writable) continue
    const field = fields.find(field => field.key === choice)
    if (field !== undefined) { focused = field.key; await edit(field); continue }
    if (choice === '@restore') { await restore(); continue }
    if (choice !== '@apply' || !changes.size) continue
    try {
      signal.throwIfAborted()
      const current = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === baseline.ns)
      if (current === undefined) throw new Error('These settings are no longer available. Cancel and reopen Settings.')
      if (current.revision !== baseline.revision) throw new Error('Configuration changed. Your draft is kept. Cancel and reopen to load the latest settings.')
      for (const field of fields) if (changes.has(field.key) && effective(field) !== undefined) field.validate(effective(field))
      const ops: SettingsPathOp[] = [...changes].map(([key, value]) => value === undefined ? { op: 'unset', path: [key] } : { op: 'set', path: [key], value })
      await ctx.settings.mutate(baseline.ns, ops, baseline.revision)
      if (!signal.aborted) ctx.tui.notice(`${text(title)}: ${text('Settings saved.')}`)
      return
    } catch (cause) {
      if (signal.aborted) return
      diagnostic = cause instanceof Error ? cause.message : String(cause)
    }
  }
}
