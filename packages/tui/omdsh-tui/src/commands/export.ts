/** Transcript export command registered through dsh-commands. */

import { open, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { registerCommands } from './registration.ts'
import { formatTranscriptHtml, formatTranscriptMarkdown } from '../views/transcript-export.ts'
import { sessionArchive } from '../runtime/session-archive.ts'

export const name = 'omdsh-command-export'
export const inject = ['commands']

function sessionTitle(events: readonly SessionEvent[], fallback: string): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type === 'session/title') return event.data.title
  }
  return fallback
}

async function exportTranscript(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const input = invocation.rawInput.trim()
  if (input === 'archive' || input.startsWith('archive ')) {
    const pathInput = input.slice('archive'.length).trim().replace(/^(?:"(.*)"|'(.*)')$/u, '$1$2')
    const path = resolve(pathInput === '' ? `omdsh-session-${invocation.agent.id}.zip` : pathInput.startsWith('~/') ? homedir() + pathInput.slice(1) : pathInput)
    try {
      const data = await sessionArchive(ctx, invocation.agent, invocation.signal)
      const handle = await open(path, 'wx', 0o600)
      let complete = false
      try { await handle.writeFile(data, { signal: invocation.signal }); complete = true }
      finally { await handle.close(); if (!complete) await unlink(path) }
      return { kind: 'success', text: `Archived session logs, descendants, and attachments to ${path}` }
    } catch (error) { return { kind: 'error', text: 'Archive failed: ' + (error instanceof Error ? error.message : String(error)) } }
  }
  const html = input === 'html' || input.startsWith('html ')
  const pathInput = html ? input.slice('html'.length).trim() : input.replace(/^markdown\s+/u, '')
  const unquoted = pathInput.replace(/^(?:"(.*)"|'(.*)')$/u, '$1$2')
  const fallback = `omdsh-transcript-${invocation.agent.id}.${html ? 'html' : 'md'}`
  const path = resolve(unquoted === '' ? fallback : (unquoted.startsWith('~/') ? homedir() + unquoted.slice(1) : unquoted))
  const title = sessionTitle(invocation.agent.session.snapshotEvents(), invocation.agent.id)
  try {
    const contents = html
      ? formatTranscriptHtml(invocation.agent.id, title, invocation.agent.session.snapshotEvents())
      : formatTranscriptMarkdown(invocation.agent.id, title, invocation.agent.session.snapshotEvents())
    await writeFile(path, contents, { encoding: 'utf8', mode: 0o600 })
    return { kind: 'success', text: `Exported complete transcript to ${path}` }
  } catch (error: unknown) {
    return { kind: 'error', text: 'Export failed: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [{
    name: 'export',
    description: 'Export a transcript or archive session logs and attachments',
    input: { hint: '[html|markdown|archive] [path]' },
    handler: invocation => exportTranscript(ctx, invocation),
  }], 'omdsh export command')
}
