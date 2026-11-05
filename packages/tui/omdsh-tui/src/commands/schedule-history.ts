/** Browse immutable delivery receipts, without equating inbox delivery with execution. */
import type { Context } from '@deepseek-ai/cordis'
import type { ScheduleCatalogEntry, ScheduleDeliveryHistoryPage, ScheduleDeliveryRecord } from '@deepseek-ai/dsh-schedule'
import { resolveUiLanguage, uiText } from '../locale/index.ts'
import { choosePrompt, readPrompt } from '../prompt-intents.ts'

export async function openScheduleHistory(ctx: Context, task: ScheduleCatalogEntry, signal: AbortSignal): Promise<void> {
  const t = (source: string, values?: Record<string, string | number>): string => uiText(resolveUiLanguage(ctx.tui.prefs().uiLanguage), source, values)
  let page: ScheduleDeliveryHistoryPage | undefined, records: ScheduleDeliveryRecord[] = [], error = '', stale = false
  const load = async (reset: boolean): Promise<void> => {
    try {
      const result = await ctx.schedule.history({ id: task.id, limit: 20, ...(!reset && page?.nextBefore ? { before: page.nextBefore } : {}) })
      if (signal.aborted) return
      if ('code' in result) {
        stale = true
        error = t(result.code === 'schedule_not_found' ? 'This reminder no longer exists.' : 'Delivery history changed. Refresh to load the newest records.')
        return
      }
      const previous = reset ? [] : records
      const seen = new Set(previous.map(record => record.messageId))
      records = [...previous, ...result.records.filter(record => !seen.has(record.messageId))]
      page = result; error = ''; stale = false
    } catch {
      if (!signal.aborted) error = t('Could not load delivery records. The loaded records are kept; retry or refresh.')
    }
  }
  await load(true)
  while (!signal.aborted) {
    const detail = [
      t('These records confirm inbox delivery, not successful model execution.'),
      ...(page ? [t('Retention: {days} days / {records} records', { days: page.retention.days, records: page.retention.records })] : []),
      ...(page && records.length === 0 ? [t('No deliveries have been recorded yet.')] : []),
      ...(page?.nextBefore === undefined && page?.earlierRecordsPruned ? [t('Earlier delivery records were removed by retention limits.')] : []),
      ...(page?.nextBefore === undefined && page?.earlierRecordsUnavailable && !page.earlierRecordsPruned ? [t('Earlier delivery records are unavailable.')] : []),
      error,
    ].filter(Boolean).join('\n')
    const answer = await ctx.tui.prompt(choosePrompt({ title: t('Delivery history'), question: task.title, detail, signal,
      options: [
        ...records.map((record, index) => ({ label: record.deliveredAt, value: `record:${index}`, description: record.prompt ?? t('Historical instruction unavailable'),
          preview: `${t('Scheduled')}: ${record.scheduledAt}\n${t('Destination session')}: ${record.targetSessionId}` })),
        ...(page?.nextBefore && !stale ? [{ label: t(error ? 'Retry older records' : 'Load older records'), value: 'older' }] : []),
        { label: t('Refresh'), value: 'refresh' }, { label: t('Back'), value: 'back' },
      ] }))
    if (signal.aborted || answer === null || answer === 'back') return
    if (answer === 'refresh') { await load(true); continue }
    if (answer === 'older' && page?.nextBefore && !stale) { await load(false); continue }
    const record = records[Number(answer?.replace(/^record:/u, ''))]
    if (!answer?.startsWith('record:') || !record) continue
    await ctx.tui.prompt(readPrompt({ title: t('Delivery record'), question: record.deliveredAt,
      cancelLabel: t('Back'), text: `${t('Scheduled')}: ${record.scheduledAt}\n${t('Destination session')}: ${record.targetSessionId}\n\n${record.prompt ?? t('Historical instruction unavailable')}`, signal }))
  }
}
