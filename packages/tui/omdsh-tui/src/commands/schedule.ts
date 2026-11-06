/** Human controls over the Harness-owned schedule and its delivery records. */

import { createPromptBrowser } from '../runtime/prompt-browser.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { ScheduleCatalogEntry, ScheduleRecord } from '@deepseek-ai/dsh-schedule'
import type {} from '@deepseek-ai/dsh-workspace'
import type { TuiPrompt } from '../definition.ts'
import { resolveUiLanguage, uiText, type UiLanguage } from '../locale/index.ts'
import { scheduleCatalog } from './schedule-catalog.ts'
import { openScheduleHistory } from './schedule-history.ts'
import { formatRelativeUntil } from '../chrome/relative-time.ts'
import { registerCommands } from './registration.ts'
import { askPrompt, confirmPrompt } from '../prompt-intents.ts'

export const name = 'omdsh-command-schedule'
export const inject = ['commands', 'schedule', 'tui']

/** UTC instant rendered without locale dependence. */
export function formatInstant(iso: string): string {
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? iso : `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/**
 * When a reminder fires, as a reader would ask it.
 *
 * `scheduledAt` is the committed next instant while the reminder can still fire
 * and the final one after it ends, so an ended reminder must not be described as
 * pending. A paused reminder retains its stored instant until the Host resumes it, so the
 * reading states the pause instead of hiding the instant. The absolute instant
 * stays alongside the relative one: the relative reading answers "how soon", the
 * absolute one is what a reader checks against their own clock or another zone.
 */
export function scheduleWhen(record: ScheduleRecord & { deliveryFloorEndsAt?: string }, status: 'active' | 'paused' | 'ended', now = Date.now(), language: UiLanguage = 'en'): string {
  const t = (source: string, values?: Record<string, string | number>) => uiText(language, source, values)
  const instant = record.deliveryFloorEndsAt && Date.parse(record.deliveryFloorEndsAt) > Date.parse(record.scheduledAt) ? record.deliveryFloorEndsAt : record.scheduledAt
  const at = formatInstant(status === 'ended' ? record.scheduledAt : instant)
  if (status === 'ended') return t('ended · was {time}', { time: at })
  const parsed = Date.parse(instant)
  const relative = formatRelativeUntil(parsed, now)
  const until = relative === 'due now' ? t('due now') : t('in {duration}', { duration: relative.slice(3) })
  const next = Number.isNaN(parsed) ? t('next {time}', { time: at }) : t('next {relative} · {time}', { relative: until, time: at })
  return status === 'paused' ? t('paused · {next}', { next }) : next
}

/** One-line rule summary; timing edits remain with `schedule_update`. */
export function scheduleRule(record: ScheduleRecord, language: UiLanguage = 'en'): string {
  const t = (source: string, values: Record<string, string | number>) => uiText(language, source, values)
  switch (record.kind) {
    case 'after': return t('once, {seconds}s after creation', { seconds: record.afterSeconds })
    case 'at': return t('once at {time}', { time: formatInstant(record.scheduledAt) })
    case 'every': return t('every {seconds}s', { seconds: record.everySeconds })
    case 'daily': return t('daily {time} {zone}', { time: record.time, zone: record.timeZone })
    case 'weekly': return t('weekly {days} {time} {zone}', { days: record.weekdays.join(','), time: record.time, zone: record.timeZone })
    case 'cron': return `cron ${record.expression} ${record.timeZone}`
    case 'rrule': return `rrule ${record.rrule.replace(/\r?\n/gu, ' ')}`
  }
}

const text = (ctx: Context, source: string, values?: Record<string, string | number>): string => uiText(resolveUiLanguage(ctx.tui.prefs().uiLanguage), source, values)
const list = { allowCustom: false, notify: false } as const
const failure = (error: unknown): string => error instanceof Error ? error.message : String(error)
type Catalog = ReturnType<typeof scheduleCatalog>

function blocked(ctx: Context, record: ScheduleCatalogEntry, action: string): string | undefined {
  if (record.executionActive) return 'This task is queued or running. Manage its execution in the destination conversation.'
  if (action === 'run') {
    if (record.target.kind === 'session' && ctx.get('workspaceRegistry')?.archivedSessionIds.includes(record.target.sessionId)) return 'The destination conversation is archived. Restore it before running this task.'
    if (record.deliveryFloorEndsAt && Date.parse(record.deliveryFloorEndsAt) > Date.now()) return text(ctx, 'Run now is available after {time}.', { time: formatInstant(record.deliveryFloorEndsAt) })
  }
  return undefined
}

async function manage(ctx: Context, invocation: CommandInvocation, catalog: Catalog, id: string): Promise<void> {
  const { signal } = invocation
  const t = (source: string, values?: Record<string, string | number>): string => text(ctx, source, values)
  let diagnostic = '', initialValue = 'history', rows: NonNullable<TuiPrompt['options']> = [], rowsKey = ''
  const current = () => catalog.snapshot().entries.find(entry => entry.id === id)
  const detail = (): string => {
    const snapshot = catalog.snapshot(), record = current(), language = resolveUiLanguage(ctx.tui.prefs().uiLanguage)
    return [
      ...(record ? [record.title, scheduleRule(record, language), scheduleWhen(record, record.status, Date.now(), language), record.prompt,
        ...(record.executionActive ? [t(blocked(ctx, record, 'edit')!)] : []),
        ...(!record.executionActive && record.deliveryFloorEndsAt && Date.parse(record.deliveryFloorEndsAt) > Date.now() ? [t(blocked(ctx, record, 'run')!)] : []),
      ] : [t('This reminder no longer exists.')]),
      ...(snapshot.error ? [t('Could not refresh scheduled tasks. Showing the last loaded state; refresh before making changes.')] : []), diagnostic,
    ].filter(Boolean).join('\n')
  }
  const options = (): NonNullable<TuiPrompt['options']> => {
    const record = current(), unavailable = catalog.snapshot().error || record === undefined
    const busy = unavailable || record.executionActive === true
    const runReason = record && blocked(ctx, record, 'run')
    // Retain row identity when only the countdown changes.
    const key = JSON.stringify([unavailable, busy, record?.status, runReason, resolveUiLanguage(ctx.tui.prefs().uiLanguage)])
    if (key === rowsKey) return rows
    rowsKey = key
    rows = [
      { label: t('View delivery history'), value: 'history', disabled: !record },
      { label: t(record?.status === 'active' ? 'Pause reminder' : 'Resume reminder'), value: record?.status === 'active' ? 'pause' : 'resume', disabled: busy || record?.status === 'ended' },
      { label: t('Run now'), value: 'run', disabled: busy || Boolean(record?.target.kind === 'session' && ctx.get('workspaceRegistry')?.archivedSessionIds.includes(record.target.sessionId)),
        description: runReason ? t(runReason) : t('Deliver the instruction now without moving the scheduled occurrence.') },
      { label: t('Edit name'), value: 'title', disabled: busy },
      { label: t('Edit instruction'), value: 'prompt', disabled: busy },
      { label: t('Delete reminder'), value: 'delete', disabled: busy },
      { label: t('Refresh'), value: 'refresh' }, { label: t('Back'), value: 'back' },
    ]
    return rows
  }
  while (!signal.aborted) {
    const action = await ctx.tui.prompt({ ...list, title: t('Scheduled task'), question: t('Manage this reminder'), detail: detail(), refreshDocument: detail,
      options: options(), refreshOptions: options, initialValue, signal })
    if (signal.aborted || action == null || action === 'back') return
    initialValue = action
    if (action === 'refresh') { diagnostic = ''; await catalog.refresh(); continue }
    await catalog.refresh()
    if (signal.aborted) return
    if (catalog.snapshot().error) continue
    const record = current()
    if (!record) continue
    if (action === 'history') { await openScheduleHistory(ctx, record, signal); continue }
    const reason = blocked(ctx, record, action)
    if (reason) { diagnostic = t(reason); continue }
    if (!['run', 'pause', 'resume', 'title', 'prompt', 'delete'].includes(action)) continue
    try {
      if (action === 'run') {
        const result = await ctx.schedule.run({ id: record.id }, signal)
        if (signal.aborted) return
        diagnostic = 'code' in result ? t(result.code === 'schedule_not_found' ? 'This reminder no longer exists.' : 'The task is already queued, running, or waiting for its minimum run interval.')
          : t('Instruction delivered. This does not mean model execution has completed.')
      } else {
        let patch: { active?: boolean; title?: string; prompt?: string } = {}
        if (action === 'pause' || action === 'resume') {
          if ((action === 'pause' && record.status !== 'active') || (action === 'resume' && record.status !== 'paused')) continue
          patch = { active: action === 'resume' }
        } else if (action === 'delete') {
          const confirm = await confirmPrompt(request => ctx.tui.prompt(request), { title: t('Delete reminder'), question: t('Delete “{title}” and its saved delivery records?', { title: record.title }),
            detail: t('Sessions and messages already delivered are retained.'), acceptLabel: t('Delete reminder'), cancelLabel: t('Keep reminder'), signal })
          if (!confirm || signal.aborted) continue
        } else {
          const value = await ctx.tui.prompt(askPrompt({ title: t(action === 'title' ? 'Reminder name' : 'Reminder instruction'), question: t(action === 'title' ? 'Rename this reminder' : 'What should the reminder say?'),
            initialInput: action === 'title' ? record.title : record.prompt, signal }))
          if (value === null || signal.aborted) continue
          patch = action === 'title' ? { title: value } : { prompt: value }
        }
        // A confirmation or editor can outlive the displayed state. Preserve its CAS baseline.
        await catalog.refresh()
        if (signal.aborted) return
        const latest = current()
        if (catalog.snapshot().error || !latest) continue
        if (latest.executionActive) { diagnostic = t(blocked(ctx, latest, action)!); continue }
        const result = await ctx.schedule.edit({ id: record.id, expectedUpdatedAt: record.updatedAt ?? null,
          ...(action === 'delete' ? { action: 'delete' as const } : { action: 'update' as const, patch }) }, invocation.agent.session.id, signal)
        if (signal.aborted) return
        if ('code' in result) diagnostic = t(result.code === 'schedule_not_found' ? 'This reminder no longer exists.' : 'The reminder changed elsewhere. Review its current state and retry.')
        else if ('deleted' in result) {
          ctx.tui.notice(t('Deleted reminder “{title}”.', { title: record.title }), { transient: true })
          await catalog.refresh()
          return
        } else {
          diagnostic = t(action === 'pause' ? 'Reminder paused.' : action === 'resume' ? 'Reminder resumed.' : 'Reminder updated.')
          if (action === 'pause') initialValue = 'resume'
          if (action === 'resume') initialValue = 'pause'
        }
      }
    } catch (error) {
      if (signal.aborted) return
      diagnostic = t('Could not complete the task action: {error}', { error: failure(error) })
    }
    // An acknowledged write stays successful even if this read fails.
    await catalog.refresh()
  }
}

export async function scheduleCommand(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /schedule' }
  const { signal } = invocation, catalog = scheduleCatalog(ctx, invocation.agent.session.id, signal)
  const t = (source: string): string => text(ctx, source)
  const browse = createPromptBrowser(request => ctx.tui.prompt(request))
  let rows: NonNullable<TuiPrompt['options']> = [], key = '', selected = ''
  const options = (): NonNullable<TuiPrompt['options']> => {
    const { entries, error } = catalog.snapshot(), language = resolveUiLanguage(ctx.tui.prefs().uiLanguage)
    const next = [
      ...entries.map(record => ({ label: record.title, value: record.id, description: scheduleWhen(record, record.status, Date.now(), language),
        badge: { label: t(record.executionActive ? 'Queued or running' : record.status === 'active' ? 'Active' : record.status === 'paused' ? 'Paused' : 'Ended'), tone: 'muted' as const } })),
      ...(error ? [{ label: t('Could not load scheduled tasks. Refresh to retry.'), value: '@error', disabled: true }] : []),
      { label: t('Refresh'), value: '@refresh' },
    ]
    const nextKey = JSON.stringify(next)
    if (nextKey !== key) { key = nextKey; rows = next }
    return rows
  }
  const listDetail = (): string => {
    const snapshot = catalog.snapshot()
    return snapshot.error ? t('Could not refresh scheduled tasks. Showing the last loaded state; refresh before making changes.')
      : snapshot.entries.length ? '' : t('No scheduled tasks in this session. Ask the agent to create one with `schedule_create`.')
  }
  try {
    await catalog.refresh()
    while (!signal.aborted) {
      const answer = await browse({ ...list, title: t('Scheduled tasks'), question: t('Reminders involving this session'), filterable: true,
        detail: listDetail(), refreshDocument: listDetail,
        options: options(), refreshOptions: options, ...(selected ? { initialValue: selected } : {}), signal })
      if (signal.aborted || answer == null) break
      if (answer === '@refresh') { await catalog.refresh(); continue }
      if (answer === '@error') continue
      selected = answer
      await catalog.refresh()
      if (!signal.aborted && !catalog.snapshot().error && catalog.snapshot().entries.some(record => record.id === answer)) await manage(ctx, invocation, catalog, answer)
    }
    return { kind: 'success' }
  } finally { catalog.dispose() }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [{ name: 'schedule', description: 'Manage scheduled reminders and delivery history', handler: async invocation => {
    try { return await scheduleCommand(ctx, invocation) }
    catch (error) { return { kind: 'error', text: invocation.signal.aborted ? text(ctx, 'Scheduled task action cancelled.') : failure(error) } }
  } }], 'omdsh schedule command')
}
