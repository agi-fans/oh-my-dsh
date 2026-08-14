/** Transcript search/export commands registered through dsh-commands. */

import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { registerCommands } from './command-registration.ts'
import { formatTranscriptMarkdown } from './transcript-export.ts'

export const name = 'omdsh-command-transcript'
export const inject = ['commands']

function tableCell(value: string): string {
  return value.replace(/\|/gu, '\\|').replace(/\s+/gu, ' ').trim()
}

function sessionTitle(events: readonly SessionEvent[], fallback: string): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type === 'session/title') return event.data.title
  }
  return fallback
}

async function search(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const input = invocation.rawInput.trim()
  const all = input === '--all' || input.startsWith('--all ')
  const query = (all ? input.slice('--all'.length) : input).trim()
  if (query === '') return { kind: 'error', text: 'Usage: /search [--all] <query>' }
  const service = ctx.get('sessionQuery')
  if (service === undefined) return { kind: 'error', text: 'Session search is not configured.' }
  try {
    if (all) {
      const page = await service.searchSessions({ query, limit: 20 }, { signal: invocation.signal })
      const lines = page.items.map((hit) =>
        `| \`${tableCell(hit.header.id)}\` · #${hit.bestMatch.seq} ${tableCell(hit.bestMatch.type)} | ${tableCell(hit.bestMatch.snippet)} |`)
      return {
        kind: 'success',
        text: lines.length === 0
          ? `No sessions match “${query}”.`
          : [`Session Matches · ${lines.length} · “${query}”`, '', '| Session / Event | Snippet |', '|---|---|', ...lines].join('\n'),
      }
    }
    const page = await service.searchEvents({ sessionId: invocation.agent.session.id, query, limit: 30 }, { signal: invocation.signal })
    const lines = page.items.map((hit) => `| #${hit.seq} ${tableCell(hit.type)} | ${tableCell(hit.snippet)} |`)
    return {
      kind: 'success',
      text: lines.length === 0
        ? `No transcript matches “${query}”.`
        : [`Transcript Matches · ${lines.length} · “${query}”`, '', '| Event | Snippet |', '|---|---|', ...lines].join('\n'),
    }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Search cancelled.' }
    return { kind: 'error', text: 'Search failed: ' + (error instanceof Error ? error.message : String(error)) }
  }
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
  registerCommands(ctx, [
    {
      name: 'search',
      description: 'Search this transcript, or all sessions with --all',
      input: { hint: '[--all] <query>' },
      handler: invocation => search(ctx, invocation),
    },
    {
      name: 'export',
      description: 'Export the complete transcript as Markdown',
      input: { hint: '[path]' },
      handler: exportTranscript,
    },
  ], 'omdsh transcript commands')
}
