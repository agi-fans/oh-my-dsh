/** Human console over the Harness owner-scoped terminal registry. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import { TerminalSessionId } from '@deepseek-ai/dsh-terminal'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { TuiDocumentPosition } from '../definition.ts'
import { copyToClipboard } from '../input/clipboard.ts'
import { TerminalReader } from '../runtime/terminal-reader.ts'
import { registerCommands } from './registration.ts'
import { currentWorkingDirectory } from '../session/working-directory.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'omdsh-terminal': { kind: 'omdsh-terminal' } & ContextFormed }
}

export const name = 'omdsh-command-terminal'
export const inject = ['commands', 'terminals', 'tui']

export function formatTerminalQuote(text: string): string {
  const maxRun = Math.max(2, ...Array.from(text.matchAll(/`+/gu), match => match[0].length))
  const fence = '`'.repeat(maxRun + 1)
  return `${fence}text\n${text}\n${fence}`
}

export function shareTerminalOutputToConversation(ctx: Context, owner: Agent, title: string, rawText: string): boolean {
  const loaded = rawText.replace(/\n$/u, '')
  if (loaded.trim() === '') return false
  const formatted = formatTerminalQuote(loaded)
  ctx.tui.commandOutput?.('terminal', `## ${title}\n\n${formatted}`, { focus: true })
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

export async function terminalConsole(ctx: Context, invocation: Pick<CommandInvocation, 'agent' | 'rawInput' | 'signal'>,
  options: { interrupt?(): void; detail?: string } = {}): Promise<CommandResult> {
  const owner = invocation.agent
  const terminals = ctx.get('terminals')
  if (terminals === undefined) return { kind: 'error', text: 'The terminal provider is not enabled.' }
  let selected = invocation.rawInput.trim()
  let superseded = false
  const onSuperseded = (): void => { superseded = true }
  const sends = new Set<Promise<unknown>>()
  const readers = new Map<string, { reader: TerminalReader; position?: TuiDocumentPosition }>()
  if (ctx.tui.interactive !== true) return { kind: 'success', text: terminals.list(owner).map(item => `${item.sessionId} · ${item.name ?? item.type} · ${item.status.kind}`).join('\n') || 'No terminals in this session.' }
  try {
    while (!invocation.signal.aborted) {
      if (selected === '') {
        const sessions = terminals.list(owner)
        const answer = await ctx.tui.prompt({ title: 'Terminals', question: 'Choose a terminal', presentation: 'fullscreen-list',
          optionLayout: 'compact', allowCustom: false, signal: invocation.signal, notify: false, onSuperseded,
          ...(options.interrupt === undefined ? {} : { interrupt: options.interrupt }),
          options: [...sessions.map(item => ({ label: item.name ?? String(item.sessionId), value: String(item.sessionId), description: `${item.type} · ${item.status.kind}` })),
            { label: 'New shell', value: 'new', description: 'Uses this session’s current sandbox and Access level' }] })
        if (answer === null) break
        selected = answer
      }
      if (selected === 'new') {
        const session = await terminals.spawn(owner, { type: 'shell', cwd: currentWorkingDirectory(ctx, owner.session) }, invocation.signal)
        selected = String(session.sessionId)
      }
      const id = TerminalSessionId(selected)
      const snapshot = terminals.list(owner).find(item => item.sessionId === id)
      if (snapshot === undefined) throw new Error(`Terminal ${selected} is not available in this session.`)
      let reading = readers.get(selected)
      if (reading === undefined) {
        reading = { reader: new TerminalReader(request => terminals.read(owner, id, request)) }
        readers.set(selected, reading)
      }
      const { reader, position } = reading
      const action = await ctx.tui.prompt({ title: `Terminal · ${snapshot.name ?? selected}`, question: `${snapshot.type} · ${snapshot.status.kind} · session sandbox`,
        ...(options.detail === undefined ? {} : { detail: options.detail }),
        ...(options.interrupt === undefined ? {} : { interrupt: options.interrupt }),
        documentSource: reader.refresh(position?.following !== false), refreshDocumentSource: following => reader.refresh(following),
        ...(position === undefined ? {} : { documentPosition: position }), onDocumentPosition: position => { reading.position = position },
        documentTail: true, presentation: 'document', allowCustom: false, signal: invocation.signal, notify: false, onSuperseded,
        options: [
          { label: 'Input', value: 'input' },
          { label: 'Interrupt', value: 'interrupt' },
          { label: 'Share to conversation', value: 'share' },
          ...(ctx.tui.insertText === undefined ? [] : [{ label: 'Quote to composer', value: 'quote' }]),
          { label: 'Copy output', value: 'copy' },
          { label: 'Terminals', value: 'list' },
          { label: 'Close terminal', value: 'close' },
          { label: 'Earlier output', value: 'earlier' },
        ],
        actions: [
          { key: 'i', label: 'input', valuePrefix: 'input' },
          { key: 'c', label: 'interrupt', valuePrefix: 'interrupt' },
          { key: 's', label: 'share', valuePrefix: 'share' },
          ...(ctx.tui.insertText === undefined ? [] : [{ key: 'q', label: 'quote', valuePrefix: 'quote' }]),
          { key: 'y', label: 'copy', valuePrefix: 'copy' },
          { key: 'l', label: 'earlier output', valuePrefix: 'earlier' },
        ] })
      if (action === null) break // Detach; the session continues to own the shell.
      if (action === 'share') {
        const loaded = reader.refresh(false).text
        if (!shareTerminalOutputToConversation(ctx, owner, `Terminal · ${snapshot.name ?? selected}`, loaded)) {
          ctx.tui.notice('No terminal output to share.')
          continue
        }
        ctx.tui.notice('Shared terminal output to conversation.')
        break
      }
      if (action === 'quote') {
        const loaded = reader.refresh(false).text.replace(/\n$/u, '')
        if (loaded.trim() === '') {
          ctx.tui.notice('No terminal output to quote.')
          continue
        }
        ctx.tui.insertText?.(formatTerminalQuote(loaded))
        ctx.tui.notice('Quoted terminal output in composer.')
        break
      }
      if (action === 'copy') {
        const loaded = reader.refresh(false).text.replace(/\n$/u, '')
        if (loaded.trim() === '') {
          ctx.tui.notice('No terminal output to copy.')
          continue
        }
        if (ctx.tui.copyText !== undefined) {
          await ctx.tui.copyText(loaded, 'terminal output')
        } else {
          try {
            await copyToClipboard(loaded)
            ctx.tui.notice('Copied terminal output')
          } catch {
            ctx.tui.notice('Copy failed', { level: 'error' })
          }
        }
        continue
      }
      if (action === 'earlier') {
        reading.position = { ...(reading.position ?? { row: 0, wrap: 0, query: '' }), following: false }
        try {
          const added = reader.loadEarlier()
          reading.position = { ...reading.position, row: reading.position.row + added }
        } catch (error) { ctx.tui.notice(error instanceof Error ? error.message : String(error), { level: 'error' }) }
        continue
      }
      if (action === 'list') { selected = ''; continue }
      if (action === 'interrupt') { await terminals.signal(owner, id, 'SIGINT'); continue }
      if (action === 'close') {
        const confirm = await ctx.tui.prompt({ title: 'Close terminal', question: 'Terminate this shell and its child processes?', allowCustom: false,
          options: [{ label: 'Keep terminal', value: 'keep' }, { label: 'Close terminal', value: 'close' }], signal: invocation.signal, notify: false, onSuperseded,
          ...(options.interrupt === undefined ? {} : { interrupt: options.interrupt }) })
        if (superseded) break
        if (confirm === 'close') { await terminals.kill(owner, id, 'closed by user'); readers.delete(selected); selected = '' }
        continue
      }
      const text = await ctx.tui.prompt({ title: 'Terminal input', question: 'Send a line to this shell', detail: 'Enter submits the line; Esc returns without sending.', allowCustom: true, signal: invocation.signal, notify: false, onSuperseded,
        ...(options.interrupt === undefined ? {} : { interrupt: options.interrupt }) })
      if (superseded) break
      if (text === null) continue
      try {
        const operation = terminals.startSend(owner, id, { text, submit: true, signal: invocation.signal })
        // The registry retains exclusive input ownership until this settles.
        // Leaving the console does not kill a running command or consume its output.
        const settled = operation.done.catch(error => { if (!invocation.signal.aborted) ctx.tui.notice(`Terminal input failed: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' }) })
        sends.add(settled)
        void settled.then(() => { sends.delete(settled) })
      } catch (error) { ctx.tui.notice(error instanceof Error ? error.message : String(error), { level: 'error' }) }
    }
    return { kind: 'success' }
  } catch (error) {
    return { kind: 'error', text: invocation.signal.aborted ? 'Terminal console cancelled.' : error instanceof Error ? error.message : String(error) }
  } finally {
    if (invocation.signal.aborted) await Promise.allSettled(sends)
  }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [{ name: 'terminal', description: 'View and control this session’s persistent shells', input: { hint: '[terminal-id]' },
    handler: invocation => terminalConsole(ctx, invocation) }], 'omdsh terminal console')
}
