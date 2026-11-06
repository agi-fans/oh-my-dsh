/** Session-owned job navigation and non-consuming output observation. */
import { createPromptBrowser } from '../runtime/prompt-browser.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { JobView } from '@deepseek-ai/dsh-jobs'
import type { TuiDocumentPosition, TuiDocumentSource, TuiPrompt } from '../definition.ts'
import { confirmPrompt, readPrompt } from '../prompt-intents.ts'
import { resolveUiLanguage, uiText } from '../locale/index.ts'
import { formatDuration } from '../chrome/status-line.ts'
import { JOB_STATUS_WORD } from '../session/job-notice.ts'

const live = (job: JobView) => job.status === 'running' || job.status === 'stopping'
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

export async function browseJobs(ctx: Context, invocation: CommandInvocation, initialId?: string, stop = false): Promise<void> {
  const lifetime = new AbortController()
  const signal = AbortSignal.any([invocation.signal, lifetime.signal])
  const owner = invocation.agent.session.id
  const t = (source: string) => uiText(resolveUiLanguage(ctx.tui.prefs?.().uiLanguage), source)
  const prompt = (request: TuiPrompt) => ctx.tui.prompt({ ...request, signal, notify: false, onSuperseded: () => lifetime.abort() })
  const browse = createPromptBrowser(prompt)
  let rows: JobView[] = [], diagnostic = '', failed = false, dirty = true
  const off = ctx.jobs.events.subscribe({ owner }, event => { if (event.type !== 'output') dirty = true })
  const refresh = (force = false): void => {
    if (signal.aborted || (!force && !dirty)) return
    dirty = false
    try { rows = ctx.jobs.list(owner); failed = false; diagnostic = '' }
    catch (error) { failed = true; diagnostic = t('Could not refresh jobs. Showing the last loaded state.') + '\n' + errorText(error) }
  }
  const current = (id: string) => { refresh(); return rows.find(row => row.id === id) }
  const status = (job: JobView) => [t(JOB_STATUS_WORD[job.status]), formatDuration(Math.max(0, (job.finishedAt ?? Date.now()) - job.startedAt)), live(job) ? job.progress : job.detail].filter(Boolean).join(' · ')
  const cancel = async (id: string): Promise<void> => {
    refresh(true)
    const job = current(id)
    if (failed || !job || job.status !== 'running' || signal.aborted) return
    if (!await confirmPrompt(prompt, { title: t('Stop job'), question: t('Stop this background job?'), detail: `${job.label || job.kind}\n${job.id}`,
      acceptLabel: t('Stop job'), cancelLabel: t('Keep running'), signal }) || signal.aborted) return
    refresh(true)
    const latest = current(id)
    if (failed || !latest || latest.status !== 'running') return
    try { ctx.jobs.kill(latest.id, owner, 'stopped from /jobs'); dirty = true; refresh() }
    catch (error) { diagnostic = errorText(error) }
  }
  const output = async (id: string): Promise<void> => {
    const job = current(id)
    if (!job || failed) return
    let changed = true, source: TuiDocumentSource = { text: '' }
    const unwatch = ctx.jobs.events.subscribe({ owner }, event => {
      if ((event.type === 'output' ? event.id : event.job.id) === id) changed = true
    })
    const read = (following: boolean): TuiDocumentSource => {
      if (signal.aborted || !following || !changed) return source
      changed = false
      try {
        const state = ctx.jobs.get(job.id, owner)
        const retained = ctx.jobs.readAt(job.id, 0, owner)
        const text = retained.chunks.map(chunk => (chunk.gapBefore ? '\n…\n' : '') + chunk.text).join('')
        // The host owns retention. The reader bounds its own snapshot and reports clipping.
        const tail = text.slice(-262_144).split('\n').slice(-10_000).join('\n')
        const clipped = tail.length !== text.length
        source = { text: [status(state), retained.lossy ? t('Earlier output is no longer retained.') : '',
          clipped ? t('Showing the latest output; earlier text is omitted from this view.') : '',
          tail || t('No retained output for this job.')].filter(Boolean).join('\n\n') }
      } catch (error) {
        source = { text: source.text + '\n\n' + t('Output observation stopped:') + ' ' + errorText(error) }
      }
      return source
    }
    let position: TuiDocumentPosition | undefined
    const options = (): NonNullable<TuiPrompt['options']> => [
      { label: t('Back'), value: 'back' },
      { label: t('Stop job'), value: 'stop', disabled: failed || current(id)?.status !== 'running' },
      { label: t('Refresh'), value: 'refresh' },
    ]
    try {
      while (!signal.aborted) {
        const action = await prompt({ ...readPrompt({ title: t('Job output'), question: job.label || job.kind, source: read(position?.following !== false),
          tail: true, ...(position === undefined ? {} : { position }), onPosition: value => { position = value }, signal }),
          options: options(), refreshOptions: options, refreshDocumentSource: read })
        if (signal.aborted || action === null || action === 'back') return
        if (action === 'stop') await cancel(id)
        else if (action === 'refresh') { refresh(true); changed = true; read(true) }
      }
    } finally { unwatch() }
  }
  try {
    refresh(true)
    if (initialId !== undefined) {
      if (!failed && !current(initialId)) throw new Error(t('This job is no longer available.'))
      if (stop) await cancel(initialId)
      else await output(initialId)
      return
    }
    let selected: string | undefined, key = '', cached: NonNullable<TuiPrompt['options']> = []
    const options = (): NonNullable<TuiPrompt['options']> => {
      refresh()
      const next = [...rows.filter(live), ...rows.filter(job => !live(job))].map(job => ({ label: job.label || job.kind, value: job.id as string,
        description: status(job), preview: `${job.id}\n${job.kind}`, disabled: failed }))
      next.push({ label: t('Refresh'), value: '__refresh__', description: '', preview: '', disabled: false })
      const nextKey = JSON.stringify(next)
      if (key !== nextKey) { cached = next; key = nextKey }
      return cached
    }
    const overview = () => { refresh(); return diagnostic || (rows.length ? t('Select a job to inspect output or stop it.') : t('No background jobs in this session.')) }
    while (!signal.aborted) {
      const answer = await browse({ title: t('Background jobs'), question: '', detail: overview(), refreshDocument: overview, options: options(), refreshOptions: options,
        ...(selected === undefined ? {} : { initialValue: selected }), filterable: true, allowCustom: false })
      if (signal.aborted || answer === null) return
      selected = answer
      refresh(true)
      if (answer !== '__refresh__' && !failed) await output(answer)
    }
  } finally { lifetime.abort(); off() }
}
