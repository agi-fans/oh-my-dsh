/** Transcript export and session archives registered through dsh-commands. */
import { open, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TuiPrompt } from '../definition.ts'
import { registerCommands } from './registration.ts'
import { formatTranscriptHtml, formatTranscriptMarkdown } from '../views/transcript-export.ts'
import { sessionArchive } from '../runtime/session-archive.ts'
import { askPrompt, choosePrompt } from '../prompt-intents.ts'
import { openSystemFile } from '../runtime/file-review.ts'
import { resolveUiLanguage, uiText } from '../locale/index.ts'

export const name = 'omdsh-command-export'
export const inject = ['commands']

type ExportFormat = 'markdown' | 'html' | 'archive'

function sessionTitle(events: readonly SessionEvent[], fallback: string): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type === 'session/title') return event.data.title
  }
  return fallback
}

async function exportTranscript(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const abort = new AbortController()
  const signal = AbortSignal.any([invocation.signal, abort.signal])
  const input = invocation.rawInput.trim()
  const match = /^(html|markdown|archive)(?:\s+|$)/u.exec(input)
  let format = (match?.[1] ?? 'markdown') as ExportFormat
  let pathInput = match === null ? input : input.slice(match[0].length).trim()
  const tui = ctx.get('tui')
  const prompt = (request: TuiPrompt) => tui!.prompt({ ...request, signal, onSuperseded: () => abort.abort() })
  const interactive = input === '' && tui?.interactive === true
  if (interactive) {
    const answer = await prompt(choosePrompt({ localize: true, title: 'Export', question: 'Choose a format', signal,
      options: [
        { label: 'Markdown', value: 'markdown', description: 'Conversation as editable text' },
        { label: 'HTML', value: 'html', description: 'Conversation for viewing in a browser' },
        { label: 'Session archive', value: 'archive', description: 'Session logs, descendants and original attachments' },
      ] }))
    if (answer === null || signal.aborted) return { kind: 'success' }
    format = answer as ExportFormat
  }
  const fallback = format === 'archive' ? `omdsh-session-${invocation.agent.id}.zip`
    : `omdsh-transcript-${invocation.agent.id}.${format === 'html' ? 'html' : 'md'}`
  const t = (text: string) => uiText(resolveUiLanguage(tui?.prefs?.().uiLanguage), text)
  let diagnostic = '', path = ''
  let contents: string | Uint8Array | undefined
  while (!signal.aborted) {
    if (interactive) {
      const answer = await prompt(askPrompt({ localize: ['title', 'question'], title: 'Export', question: 'Save to file',
        initialInput: pathInput || fallback, ...(diagnostic === '' ? {} : { detail: diagnostic }), signal }))
      if (answer === null || signal.aborted) return { kind: 'success' }
      pathInput = answer.trim()
    }
    const unquoted = pathInput.replace(/^(?:"(.*)"|'(.*)')$/u, '$1$2')
    path = resolve(unquoted === '' ? fallback : unquoted.startsWith('~/') ? homedir() + unquoted.slice(1) : unquoted)
    if (contents === undefined) {
      try {
        signal.throwIfAborted()
        const events = invocation.agent.session.snapshotEvents()
        const title = sessionTitle(events, invocation.agent.id)
        contents = format === 'archive' ? await sessionArchive(ctx, invocation.agent, signal)
          : format === 'html' ? formatTranscriptHtml(invocation.agent.id, title, events)
          : formatTranscriptMarkdown(invocation.agent.id, title, events)
      } catch (error) {
        if (signal.aborted) return { kind: 'success' }
        return { kind: 'error', text: 'Export failed: ' + (error instanceof Error ? error.message : String(error)) }
      }
    }
    try {
      signal.throwIfAborted()
      const handle = await open(path, 'wx', 0o600)
      let complete = false
      try { await handle.writeFile(contents, { signal }); complete = true }
      finally { await handle.close(); if (!complete) await unlink(path) }
      break
    } catch (error) {
      if (signal.aborted) return { kind: 'success' }
      diagnostic = error instanceof Error && 'code' in error && error.code === 'EEXIST'
        ? `${t('File already exists. Choose another export path.')}\n${path}`
        : `${t('Could not save the file. Check the destination and try again.')}\n${error instanceof Error ? error.message : String(error)}`
      if (!interactive) return { kind: 'error', text: diagnostic }
    }
  }
  if (signal.aborted) return { kind: 'success' }
  if (interactive && !signal.aborted) {
    const action = await prompt(choosePrompt({ localize: ['title', 'question', 'options'], title: 'Export complete', question: path, signal,
      options: [{ label: 'Done', value: 'done' }, { label: 'Open file', value: 'open' },
        ...(tui.copyText === undefined ? [] : [{ label: 'Copy path', value: 'copy' }])] }))
    if (!signal.aborted) {
      try {
        if (action === 'open') await openSystemFile(path)
        else if (action === 'copy') await tui.copyText?.(path, 'Export path')
      } catch (error) { tui.notice(error instanceof Error ? error.message : String(error), { level: 'error' }) }
    }
  }
  return { kind: 'success', text: format === 'archive' ? `Archived session logs, descendants, and attachments to ${path}` : `Exported complete transcript to ${path}` }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [{ name: 'export', description: 'Export a transcript or archive session logs and attachments',
    input: { hint: '[html|markdown|archive] [path]' }, handler: invocation => exportTranscript(ctx, invocation) }], 'omdsh export command')
}
