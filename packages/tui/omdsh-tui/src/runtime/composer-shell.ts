/** Composer shortcut over the same owner-scoped Shell used by `/terminal`. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TuiSubmission } from '../definition.ts'
import { terminalConsole } from '../commands/terminal.ts'
import { currentWorkingDirectory } from '../session/working-directory.ts'

/** Only deliberate, attachment-free composer input may execute a Shell line. */
export function composerShellCommand(submission: TuiSubmission): string | undefined {
  if (submission.literal || submission.images.length > 0 || submission.files?.length) return undefined
  if (!submission.text.startsWith('!')) return undefined
  return submission.text.slice(1).trim()
}

/**
 * Send a line, then show its live terminal. Esc detaches without terminating it.
 * Shell output remains outside the model context and is retained by the live
 * terminal registry, not fabricated as a model tool call or durable checkpoint.
 */
export async function runComposerShell(ctx: Context, owner: Agent, command: string, upstream: AbortSignal): Promise<void> {
  if (!ctx.tui.interactive) throw new Error('Shell shortcuts require an interactive terminal. Use /terminal to inspect session terminals.')
  if (command === '') throw new Error('Enter a command after ! to run it in the session Shell.')
  const terminals = ctx.get('terminals')
  if (terminals === undefined) throw new Error('The terminal provider is not enabled. Enable the terminal plugins to run Shell commands.')
  const interruption = new AbortController()
  const signal = AbortSignal.any([upstream, interruption.signal])
  signal.throwIfAborted()
  // Cordis service access is context-bound; proxy identity is not a registry
  // identity. The registry already owns exact-Agent names and liveness.
  const previous = terminals.list(owner).find(item => item.name === 'Composer shell' && item.type === 'shell')
  let id = previous?.sessionId
  if (id !== undefined) {
    if (previous?.status.kind !== 'running') {
      if (previous !== undefined) await terminals.kill(owner, id, 'Composer shell exited')
      id = undefined
    }
  }
  if (id === undefined) {
    const session = await terminals.spawn(owner, { type: 'shell', name: 'Composer shell', cwd: currentWorkingDirectory(ctx, owner.session) }, signal)
    id = session.sessionId
  }
  signal.throwIfAborted()
  const operation = terminals.startSend(owner, id, { text: command, submit: true, signal })
  // Provider readiness is not a command exit code. Keep its live output in the
  // terminal reader and never report a successful command merely on readiness.
  const settled = operation.done.catch((error: unknown) => {
    if (!signal.aborted) ctx.tui.notice(`Shell input failed: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' })
  })
  ctx.tui.notice('Shell output stays outside model context. Esc returns; the shell keeps running.')
  try {
    const result = await terminalConsole(ctx, { agent: owner, rawInput: String(id), signal }, {
      interrupt: () => { interruption.abort(new Error('Shell interrupted by user')) },
      detail: 'Output stays outside model context. Esc returns; Ctrl+C interrupts the command.',
    })
    if (result.kind === 'error' && !signal.aborted) throw new Error(result.text ?? 'Could not open the Shell terminal.')
  } finally {
    // A runner interrupt/unmount waits for the provider to finish interrupting.
    // Ordinary Esc detaches and leaves provider-owned work alive for /terminal.
    if (signal.aborted) {
      if (!operation.cancel() && terminals.list(owner).some(item => item.sessionId === id && item.status.kind === 'running')) {
        await terminals.signal(owner, id, 'SIGINT')
      }
      await settled
    }
  }
}
