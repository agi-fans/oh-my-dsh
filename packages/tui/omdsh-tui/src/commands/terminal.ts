/** Human console over the Harness owner-scoped terminal registry. */

import type { Context } from '@deepseek-ai/cordis'
import { TerminalSessionId } from '@deepseek-ai/dsh-terminal'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { TuiDocumentPosition } from '../definition.ts'
import { TerminalReader } from '../runtime/terminal-reader.ts'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-terminal'
export const inject = ['commands', 'terminals', 'tui']

export async function terminalConsole(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const owner = invocation.agent
  let selected = invocation.rawInput.trim()
  const readers = new Map<string, { reader: TerminalReader; position?: TuiDocumentPosition }>()
  if (ctx.tui.interactive !== true) return { kind: 'success', text: ctx.terminals.list(owner).map(item => `${item.sessionId} · ${item.name ?? item.type} · ${item.status.kind}`).join('\n') || 'No terminals in this session.' }
  try {
    while (!invocation.signal.aborted) {
      if (selected === '') {
        const sessions = ctx.terminals.list(owner)
        const answer = await ctx.tui.prompt({ title: 'Terminals', question: 'Choose a terminal', presentation: 'fullscreen-list',
          optionLayout: 'compact', allowCustom: false, signal: invocation.signal, notify: false, onSuperseded: () => {},
          options: [...sessions.map(item => ({ label: item.name ?? String(item.sessionId), value: String(item.sessionId), description: `${item.type} · ${item.status.kind}` })),
            { label: 'New shell', value: 'new', description: 'Uses this session’s current sandbox and Access level' }] })
        if (answer === null) break
        selected = answer
      }
      if (selected === 'new') {
        const session = await ctx.terminals.spawn(owner, { type: 'shell', ...(owner.session.header.cwd === undefined ? {} : { cwd: owner.session.header.cwd }) }, invocation.signal)
        selected = String(session.sessionId)
      }
      const id = TerminalSessionId(selected)
      const snapshot = ctx.terminals.list(owner).find(item => item.sessionId === id)
      if (snapshot === undefined) throw new Error(`Terminal ${selected} is not available in this session.`)
      let reading = readers.get(selected)
      if (reading === undefined) {
        reading = { reader: new TerminalReader(request => ctx.terminals.read(owner, id, request)) }
        readers.set(selected, reading)
      }
      const { reader, position } = reading
      const action = await ctx.tui.prompt({ title: `Terminal · ${snapshot.name ?? selected}`, question: `${snapshot.type} · ${snapshot.status.kind} · session sandbox`,
        documentSource: reader.refresh(position?.following !== false), refreshDocumentSource: following => reader.refresh(following),
        ...(position === undefined ? {} : { documentPosition: position }), onDocumentPosition: position => { reading.position = position },
        documentTail: true, presentation: 'document', allowCustom: false, signal: invocation.signal, notify: false, onSuperseded: () => {},
        options: [{ label: 'Input', value: 'input' }, { label: 'Interrupt', value: 'interrupt' }, { label: 'Terminals', value: 'list' }, { label: 'Close terminal', value: 'close' }, { label: 'Earlier output', value: 'earlier' }],
        actions: [{ key: 'i', label: 'input', valuePrefix: 'input' }, { key: 'c', label: 'interrupt', valuePrefix: 'interrupt' }, { key: 'l', label: 'earlier output', valuePrefix: 'earlier' }] })
      if (action === null) break // Detach; the session continues to own the shell.
      if (action === 'earlier') {
        reading.position = { ...(reading.position ?? { row: 0, wrap: 0, query: '' }), following: false }
        try {
          const added = reader.loadEarlier()
          reading.position = { ...reading.position, row: reading.position.row + added }
        } catch (error) { ctx.tui.notice(error instanceof Error ? error.message : String(error), { level: 'error' }) }
        continue
      }
      if (action === 'list') { selected = ''; continue }
      if (action === 'interrupt') { await ctx.terminals.signal(owner, id, 'SIGINT'); continue }
      if (action === 'close') {
        const confirm = await ctx.tui.prompt({ title: 'Close terminal', question: 'Terminate this shell and its child processes?', allowCustom: false,
          options: [{ label: 'Keep terminal', value: 'keep' }, { label: 'Close terminal', value: 'close' }], signal: invocation.signal, notify: false })
        if (confirm === 'close') { await ctx.terminals.kill(owner, id, 'closed by user'); readers.delete(selected); selected = '' }
        continue
      }
      const text = await ctx.tui.prompt({ title: 'Terminal input', question: 'Send a line to this shell', detail: 'Enter submits the line; Esc returns without sending.', allowCustom: true, signal: invocation.signal, notify: false })
      if (text === null) continue
      try {
        const operation = ctx.terminals.startSend(owner, id, { text, submit: true, signal: invocation.signal })
        // The registry retains exclusive input ownership until this settles.
        // Leaving the console does not kill a running command or consume its output.
        void operation.done.catch(error => { ctx.logger.warn(error) })
      } catch (error) { ctx.tui.notice(error instanceof Error ? error.message : String(error), { level: 'error' }) }
    }
    return { kind: 'success' }
  } catch (error) {
    return { kind: 'error', text: invocation.signal.aborted ? 'Terminal console cancelled.' : error instanceof Error ? error.message : String(error) }
  }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [{ name: 'terminal', description: 'View and control this session’s persistent shells', input: { hint: '[terminal-id]' },
    handler: invocation => terminalConsole(ctx, invocation) }], 'omdsh terminal console')
}
