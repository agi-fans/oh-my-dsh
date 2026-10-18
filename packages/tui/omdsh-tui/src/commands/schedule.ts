/**
 * Human console over persisted scheduled reminders.
 * `/schedule` lists this Session's active tasks, edits a name or instruction,
 * opens retained delivery records, and deletes a task. Timing changes stay
 * with the model-facing `schedule_update` tool, whose selectors are richer
 * than a terminal form should collect.
 * @module @agi-fans/dsh-tui/command-schedule
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {
  ScheduleDeliveryHistoryResult,
  ScheduleDeliveryRecord,
  ScheduleRecord,
  ScheduleUpdateResult,
} from '@deepseek-ai/dsh-schedule'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-schedule'
export const inject = ['commands', 'schedule', 'tui']

/** UTC instant rendered without locale dependence. */
export function formatInstant(iso: string): string {
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? iso : `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** One-line rule summary; timing edits remain with `schedule_update`. */
export function scheduleRule(record: ScheduleRecord): string {
  switch (record.kind) {
    case 'after': return `once, ${record.afterSeconds}s after creation`
    case 'at': return `once at ${formatInstant(record.scheduledAt)}`
    case 'every': return `every ${record.everySeconds}s`
    case 'daily': return `daily ${record.time} ${record.timeZone}`
    case 'weekly': return `weekly ${record.weekdays.join(',')} ${record.time} ${record.timeZone}`
    case 'cron': return `cron ${record.expression} ${record.timeZone}`
  }
}

function historyText(result: ScheduleDeliveryHistoryResult): string {
  if ('code' in result) {
    return result.code === 'schedule_not_found'
      ? 'This reminder no longer exists.'
      : 'These delivery records are no longer addressable.'
  }
  if (result.records.length === 0) {
    return 'No deliveries have been recorded yet.\n\nA reminder is recorded after its message reaches this Session\'s durable log.'
  }
  const rows = result.records.map((record: ScheduleDeliveryRecord) =>
    `| ${formatInstant(record.deliveredAt)} | ${formatInstant(record.scheduledAt)} | ${(record.prompt ?? '—').replace(/\|/gu, '\\|')} |`)
  return [
    `Deliveries · newest first · retention ${result.retention.days} days / ${result.retention.records} records`,
    '',
    '| Delivered | Scheduled | Prompt |',
    '|---|---|---|',
    ...rows,
    '',
    ...(result.earlierRecordsUnavailable || result.earlierRecordsPruned
      ? ['Earlier records are unavailable; they are never reconstructed from the Session log.']
      : []),
  ].join('\n')
}

function missText(result: ScheduleUpdateResult): string | undefined {
  if (!('updated' in result) || result.updated) return undefined
  if (!('code' in result)) return 'The reminder was not updated.'
  switch (result.code) {
    case 'schedule_not_found': return 'This reminder no longer exists.'
    case 'schedule_ended': return 'This reminder has already ended.'
    case 'schedule_conflict': return 'The reminder changed elsewhere; reopen /schedule and try again.'
  }
}

async function edit(ctx: Context, invocation: CommandInvocation, record: ScheduleRecord, field: 'title' | 'prompt'): Promise<CommandResult> {
  const value = await ctx.tui.prompt({
    title: field === 'title' ? 'Reminder name' : 'Reminder instruction',
    question: field === 'title' ? 'Rename this reminder' : 'What should the reminder say?',
    detail: field === 'title'
      ? 'The name appears in the task list and reminder catalog.'
      : 'The instruction is delivered to this Session when the reminder fires.',
    initialInput: field === 'title' ? record.title : record.prompt,
    allowCustom: true,
    notify: false,
    signal: invocation.signal,
  })
  invocation.signal.throwIfAborted()
  if (value === null) return { kind: 'success' }
  const result = await ctx.schedule.update({
    sessionId: invocation.agent.session.id,
    id: record.id,
    expected: record,
    ...(field === 'title' ? { title: value } : { prompt: value }),
  })
  if ('code' in result && 'message' in result) return { kind: 'error', text: result.message }
  const miss = missText(result)
  if (miss !== undefined) return { kind: 'error', text: miss }
  if (!('updated' in result) || !result.updated) return { kind: 'error', text: 'The reminder was not updated.' }
  return {
    kind: 'success',
    text: `Updated ${field === 'title' ? 'name' : 'instruction'} for "${result.record.title}".`,
  }
}

async function manage(ctx: Context, invocation: CommandInvocation, record: ScheduleRecord): Promise<CommandResult> {
  for (;;) {
    invocation.signal.throwIfAborted()
    const action = await ctx.tui.prompt({
      title: `Scheduled · ${record.title}`,
      question: `${scheduleRule(record)} · next ${formatInstant(record.scheduledAt)}`,
      detail: record.prompt,
      options: [
        { label: 'View delivery history', value: 'history', description: 'Open the retained delivery records for this reminder.' },
        { label: 'Edit name', value: 'title', description: 'Rename the reminder without changing its timing.' },
        { label: 'Edit instruction', value: 'prompt', description: 'Change what is delivered when it fires.' },
        { label: 'Delete reminder', value: 'delete', description: 'Stop future delivery and remove saved records.' },
      ],
      allowCustom: false,
      notify: false,
      signal: invocation.signal,
    })
    invocation.signal.throwIfAborted()
    if (action === null) return { kind: 'success' }
    if (action === 'history') {
      const history = await ctx.schedule.history({ sessionId: invocation.agent.session.id, id: record.id, limit: 20 })
      await ctx.tui.prompt({
        title: `Deliveries · ${record.title}`,
        question: scheduleRule(record),
        detail: historyText(history),
        options: [{ label: 'Back', value: 'back' }],
        allowCustom: false,
        notify: false,
        signal: invocation.signal,
      })
      continue
    }
    if (action === 'delete') {
      const confirm = await ctx.tui.prompt({
        title: 'Delete reminder',
        question: `Stop "${record.title}" and remove its saved delivery records?`,
        options: [{ label: 'Keep reminder', value: 'keep' }, { label: 'Delete reminder', value: 'delete' }],
        allowCustom: false,
        notify: false,
        signal: invocation.signal,
      })
      invocation.signal.throwIfAborted()
      if (confirm !== 'delete') continue
      const result = await ctx.schedule.delete({ sessionId: invocation.agent.session.id, id: record.id })
      if (!result.deleted) return { kind: 'error', text: 'That reminder is no longer available.' }
      return { kind: 'success', text: `Deleted reminder "${record.title}".` }
    }
    return edit(ctx, invocation, record, action === 'title' ? 'title' : 'prompt')
  }
}

export async function scheduleCommand(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /schedule' }
  const tasks = await ctx.schedule.list({ sessionId: invocation.agent.session.id })
  if (tasks.length === 0) {
    return {
      kind: 'success',
      text: 'No scheduled tasks in this session. Ask the agent to create one with `schedule_create`.',
    }
  }
  const selected = await ctx.tui.prompt({
    title: 'Scheduled tasks',
    question: tasks.length === 1 ? 'Choose the reminder' : `Choose one of ${tasks.length} reminders`,
    presentation: 'fullscreen-list',
    filterable: true,
    allowCustom: false,
    notify: false,
    signal: invocation.signal,
    options: tasks.map((record: ScheduleRecord) => ({
      label: record.title,
      value: String(record.id),
      description: `${scheduleRule(record)} · next ${formatInstant(record.scheduledAt)}`,
    })),
  })
  invocation.signal.throwIfAborted()
  if (selected === null) return { kind: 'success' }
  const record = tasks.find((task: ScheduleRecord) => String(task.id) === selected)
  if (record === undefined) return { kind: 'error', text: 'That reminder is no longer available.' }
  return manage(ctx, invocation, record)
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [
    {
      name: 'schedule',
      description: 'Inspect, edit, or delete scheduled reminders',
      handler: async invocation => {
        try {
          return await scheduleCommand(ctx, invocation)
        } catch (error) {
          if (invocation.signal.aborted) return { kind: 'error', text: 'Scheduled task action cancelled.' }
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
        }
      },
    },
  ], 'omdsh schedule command')
}
