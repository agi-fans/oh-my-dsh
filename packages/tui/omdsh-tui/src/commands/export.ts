/** Transcript export command registered through dsh-commands. */

import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { registerCommands } from './registration.ts'
import { formatTranscriptMarkdown } from '../views/transcript-export.ts'

export const name = 'omdsh-command-export'
export const inject = ['commands']

function sessionTitle(events: readonly SessionEvent[], fallback: string): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type === 'session/title') return event.data.title
  }
  return fallback
}

async function exportTranscript(invocation: CommandInvocation): Promise<CommandResult> {
  const input = invocation.rawInput.trim()
  const unquoted = input.replace(/^(?:"(.*)"|'(.*)')$/u, '$1$2')
  const fallback = `omdsh-transcript-${invocation.agent.id}.md`
  const path = resolve(unquoted === '' ? fallback : (unquoted.startsWith('~/') ? homedir() + unquoted.slice(1) : unquoted))
  const title = sessionTitle(invocation.agent.session.events, invocation.agent.id)
  try {
    await writeFile(path, formatTranscriptMarkdown(invocation.agent.id, title, invocation.agent.session.events), { encoding: 'utf8', mode: 0o600 })
    return { kind: 'success', text: `Exported complete transcript to ${path}` }
  } catch (error: unknown) {
    return { kind: 'error', text: 'Export failed: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [{
    name: 'export',
    description: 'Export the complete transcript as Markdown',
    input: { hint: '[path]' },
    handler: exportTranscript,
  }], 'omdsh export command')
}
