/** Sharing helpers over the Harness owner-scoped terminal registry. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'omdsh-terminal': { kind: 'omdsh-terminal' } & ContextFormed }
}

export const name = 'omdsh-command-terminal'
export const inject = ['terminals', 'tui']

export function formatTerminalQuote(text: string): string {
  const maxRun = Math.max(2, ...Array.from(text.matchAll(/`+/gu), match => match[0].length))
  const fence = '`'.repeat(maxRun + 1)
  return `${fence}text\n${text}\n${fence}`
}

export function shareTerminalOutputToConversation(owner: Agent, title: string, rawText: string): boolean {
  const loaded = rawText.replace(/\n$/u, '')
  if (loaded.trim() === '') return false
  const formatted = formatTerminalQuote(loaded)
  // The transcript row comes from this injection, not from a parallel local
  // write: the model can refer to what was injected, so a row that only the
  // live TUI knows about would vanish on resume and leave the model citing
  // content the reader cannot see.
  try {
    owner.inject?.(createUserMessage({
      source: { kind: 'omdsh-terminal', form: 'notice', summary: `Shared output from ${title}.` },
      content: [{
        type: 'text',
        text: `The user shared terminal output from ${title}:\n\n${formatted}`,
      }],
    }))
  } catch { /* ignore when session does not support injection */ }
  return true
}

/**
 * No command surface: a Shell line is a `!` in the composer, which streams into
 * the transcript as a card.
 *
 * There used to be a `/terminal` console that took the whole screen to show a
 * shell and forward keystrokes to it. A live TUI inside a TUI is a poor fit —
 * a reader who genuinely wants to sit and watch a long process has their own
 * terminal for that — and the console was the reason a `!` line cost an exit
 * gesture. This module now owns only the two helpers that let a finished Shell
 * card share its output.
 */
export function apply(_ctx: Context): void {}
