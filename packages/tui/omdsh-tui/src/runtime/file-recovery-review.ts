/** Human-only recovery review; uses existing list and document surfaces. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from './file-recovery-local.ts'
import type { RecoveryReceipt } from './file-recovery-local.ts'
import type { RecoveryOperation } from './file-recovery-store.ts'
import { fileDocument, codeDocument } from './file-review.ts'

function pathLabel(path: string): string { return /[\u0000-\u001f\u007f]/u.test(path) ? JSON.stringify(path) : path }

function reportText(report: RecoveryReceipt): string {
  return `### ${report.id}${report.completedAt === undefined ? ' · Completion unconfirmed' : ''}\n\n`
    + report.entries.map(entry => `${pathLabel(entry.path)} · ${entry.status}${entry.reason === undefined ? '' : '\n' + entry.reason}`
      + (entry.backup === '' ? '' : `\nReserved backup path: ${pathLabel(entry.backup)} (present only if a file was displaced; inspect if completion is unconfirmed)`)).join('\n\n')
    + `\n\nDirectory: ${JSON.stringify(report.root)}`
}

async function preview(ctx: Context, operation: RecoveryOperation, signal: AbortSignal): Promise<string> {
  const provider = ctx.get('omdshFileRecovery')!
  const side = async (state: RecoveryOperation['before']): Promise<string> => {
    if (state.kind === 'missing') return 'Absent'
    if (state.kind === 'link') return 'Symbolic link → ' + JSON.stringify(Buffer.from(state.target, 'base64').toString('utf8'))
    const source = await fileDocument(provider.store.blobPath(state.hash), signal, 128 * 1024, operation.path)
    return source.binary ? `Binary · ${state.size} bytes · ${state.hash}` : codeDocument(source.text, source.language ?? '')
      + (source.truncated ? '\n\nPreview truncated; complete bytes are retained.' : '')
  }
  return `## ${pathLabel(operation.path)}\n\n### Before Turn\n\n${await side(operation.before)}\n\n### After Turn\n\n${await side(operation.after)}`
}

export async function reviewFileRecovery(ctx: Context, agent: Agent, sessionId: string, turn: number, upstream: AbortSignal,
  assertActive: () => void): Promise<void> {
  const provider = ctx.get('omdshFileRecovery')
  if (provider === undefined) { ctx.tui.notice('File recovery is not available in this profile.'); return }
  const record = await provider.checkpoint(sessionId, turn)
  if (record?.status !== 'ready' || record.before === undefined || record.after === undefined) {
    ctx.tui.notice(record?.error ?? (record?.status === 'capturing' ? 'Checkpoint completion is unconfirmed. No files will be restored.'
      : 'No complete snapshot for this Turn. Enable File recovery snapshots in Settings → Tools before starting new Turns.'))
    return
  }
  const plan = await provider.store.plan(record.before, record.after, upstream)
  const ready = plan.operations.filter(operation => operation.status === 'ready')
  const protectedPaths = plan.operations.filter(operation => operation.status === 'conflict')
  let history = ''
  try { history = (await provider.savedReports(record.before, record.after, upstream)).map(reportText).join('\n\n') }
  catch (error) { ctx.tui.notice('Saved recovery reports could not be read: ' + (error instanceof Error ? error.message : String(error)), { level: 'error' }) }
  if (ready.length === 0) {
    await ctx.tui.prompt({ title: 'File recovery', question: 'No files can be restored', presentation: 'document',
      detail: (protectedPaths.length === 0 ? 'Files are unchanged or already match the original snapshot.'
        : protectedPaths.map(operation => `${pathLabel(operation.path)} · ${operation.reason}`).join('\n')) + (history === '' ? '' : '\n\n## Saved reports\n\n' + history),
      options: [{ label: 'Back', value: 'back' }], allowCustom: false, notify: false, signal: upstream, onSuperseded: () => {} })
    return
  }
  const options = ready.map((operation, index) => ({ label: pathLabel(operation.path), value: 'file-' + index,
    description: operation.before.kind === 'missing' ? 'Remove created file' : operation.after.kind === 'missing' ? 'Recreate deleted file' : 'Restore original contents and mode' }))
  assertActive()
  let answer: string | null
  for (;;) {
    answer = await ctx.tui.prompt({ title: `Restore Turn ${turn} files`, question: plan.root, presentation: 'fullscreen-list',
    options, multiSelect: true, initialValues: options.map(option => option.value), allowCustom: false, filterable: true, notify: false,
    detail: `${protectedPaths.length} conflicts will be preserved. Select files; Enter reviews the restoration.`,
    actions: history === '' ? [] : [{ key: 'Alt+H', label: 'saved reports', valuePrefix: 'reports:', scope: 'list' }], signal: upstream, onSuperseded: () => {} })
    if (answer !== 'reports:') break
    await ctx.tui.prompt({ title: 'Saved recovery reports', question: 'Pending operations do not establish completion', presentation: 'document', detail: history,
      options: [{ label: 'Back', value: 'back' }], allowCustom: false, notify: false, signal: upstream, onSuperseded: () => {} })
    assertActive(); upstream.throwIfAborted()
  }
  if (answer === null || answer === '') return
  const values = answer.split(', ').map(value => options.findIndex(option => option.value === value))
  if (values.some(index => index < 0)) throw new Error('The file recovery selection is no longer valid.')
  const paths = [...new Set(values.map(index => ready[index]!.path))]
  let index = 0
  for (;;) {
    assertActive(); upstream.throwIfAborted()
    const selected = ready.find(operation => operation.path === paths[index])!
    const action = await ctx.tui.prompt({ title: 'File snapshots', question: `${index + 1}/${paths.length} · ${pathLabel(selected.path)}`, presentation: 'document',
      detail: await preview(ctx, selected, upstream),
      options: [...(index > 0 ? [{ label: 'Previous', value: 'previous' }] : []), ...(index + 1 < paths.length ? [{ label: 'Next', value: 'next' }] : []),
        { label: 'Review restoration', value: 'review' }, { label: 'Cancel', value: 'cancel' }],
      allowCustom: false, notify: false, signal: upstream, onSuperseded: () => {} })
    if (action === null || action === 'cancel') return
    if (action === 'previous') { index = Math.max(0, index - 1); continue }
    if (action === 'next') { index = Math.min(paths.length - 1, index + 1); continue }
    if (action === 'review') break
  }
  assertActive(); upstream.throwIfAborted()
  const confirmed = await ctx.tui.prompt({ title: 'Confirm file recovery', question: `Restore ${paths.length} files from before Turn ${turn}?`,
    presentation: 'document', detail: `Directory: ${JSON.stringify(plan.root)}\n\n${paths.map(pathLabel).join('\n')}\n\nFiles changed after the retained snapshot are skipped. The snapshot may include changes from other processes during the Turn. Messages and the Git index stay unchanged. Displaced files are retained as backups in this directory.`,
    options: [{ label: 'Cancel', value: 'cancel' }, { label: 'Restore selected files', value: 'restore' }], initialValue: 'cancel',
    allowCustom: false, notify: false, signal: upstream, onSuperseded: () => {} })
  if (confirmed !== 'restore') return
  assertActive(); upstream.throwIfAborted()
  const cancel = new AbortController(), finished = new AbortController()
  let superseded = false
  const progress = ctx.tui.prompt({ title: 'Restoring files', question: `${paths.length} selected files`, presentation: 'progress',
    detail: 'Cancellation may leave a partial restoration. Completed operations and backups are retained in the report.',
    signal: AbortSignal.any([upstream, finished.signal]), notify: false,
    interrupt: () => { cancel.abort(); return true }, onSuperseded: () => { superseded = true; cancel.abort() } })
    .then(() => { if (!finished.signal.aborted) cancel.abort() }, error => { cancel.abort(error) })
  let report
  try { report = await provider.restore(agent, record.before, record.after, paths, AbortSignal.any([upstream, cancel.signal])) }
  finally { finished.abort(); await progress }
  assertActive()
  if (superseded || upstream.aborted) return
  const restored = report.entries.filter(entry => entry.status === 'restored').length
  ctx.tui.notice(`File recovery: ${restored} restored · ${report.entries.length - restored} skipped or incomplete. Report: ${report.id}`)
  await ctx.tui.prompt({ title: 'File recovery report', question: 'Per-file results', presentation: 'document',
    detail: reportText(report),
    options: [{ label: 'Back to Session Tree', value: 'back' }], allowCustom: false, notify: false, signal: upstream, onSuperseded: () => {} })
}
