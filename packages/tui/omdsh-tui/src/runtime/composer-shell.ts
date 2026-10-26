/** Composer shortcut over the same owner-scoped Shell used by `/terminal`. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TuiSubmission } from '../definition.ts'
import type {} from '@deepseek-ai/dsh-terminal'
import { shareTerminalOutputToConversation } from '../commands/terminal.ts'
import { currentWorkingDirectory } from '../session/working-directory.ts'

/** Only deliberate, attachment-free composer input may execute a Shell line. */
export function composerShellCommand(submission: TuiSubmission): string | undefined {
  if (submission.literal || submission.images.length > 0 || submission.files?.length) return undefined
  if (!submission.text.startsWith('!')) return undefined
  return submission.text.replace(/^!{1,2}/u, '').trim()
}

/** `!!<command>` runs in the session Shell and shares its output to the conversation. */
export function composerShellShare(submission: TuiSubmission): boolean {
  if (submission.literal || submission.images.length > 0 || submission.files?.length) return false
  return submission.text.startsWith('!!')
}

/**
 * Run one Shell line in the session Shell, streaming its output to a live card.
 *
 * The card is the surface. There is no reader to enter and leave: the command
 * streams into the transcript where the reader asked for it, and finishes when
 * the command finishes. `!` keeps the output outside the model's context; `!!`
 * shares it once the command settles.
 */
export async function runComposerShell(
  ctx: Context,
  owner: Agent,
  command: string,
  upstream: AbortSignal,
  options: { share?: boolean } = {},
): Promise<void> {
  if (ctx.tui.interactive !== true) throw new Error('Shell shortcuts require an interactive terminal.')
  if (command === '') throw new Error('Enter a command after ! to run it in the session Shell.')
  const terminals = ctx.get('terminals')
  if (terminals === undefined) throw new Error('The terminal provider is not enabled. Enable the terminal plugins to run Shell commands.')
  if (ctx.tui.shellCommand === undefined) throw new Error('This deployment cannot run Shell lines from the composer.')
  const interruption = new AbortController()
  const signal = AbortSignal.any([upstream, interruption.signal])
  signal.throwIfAborted()
  // Cordis service access is context-bound; proxy identity is not a registry
  // identity. The registry already owns exact-Agent names and liveness.
  const previous = terminals.list(owner).find(item => item.name === 'Composer shell' && item.type === 'shell')
  let id = previous?.sessionId
  if (id !== undefined && previous?.status.kind !== 'running') {
    await terminals.kill(owner, id, 'Composer shell exited')
    id = undefined
  }
  if (id === undefined) {
    const session = await terminals.spawn(owner, { type: 'shell', name: 'Composer shell', cwd: currentWorkingDirectory(ctx, owner.session) }, signal)
    id = session.sessionId
  }
  signal.throwIfAborted()
  const sessionId = id
  let produced = ''
  await ctx.tui.shellCommand({
    command,
    signal,
    abort: () => { interruption.abort(new Error('Shell interrupted by user')) },
    ...(options.share === true ? { share: true } : {}),
    run: async (onOutput, runSignal) => {
      // The Shell is persistent, so its scrollback holds everything typed into it
      // across earlier `!` lines — and the shell's own prompt echoes each line.
      // Reading the whole snapshot into the card would repeat the command under
      // our own `$ command` header and replay history from before this line ran.
      // The line count is the boundary: everything above it belongs to an
      // earlier line, everything below it is this command's output.
      const baseline = terminals.read(owner, sessionId).totalLines
      const operation = terminals.startSend(owner, sessionId, { text: command, submit: true, signal: runSignal })
      const since = (): string => {
        const fresh = terminals.read(owner, sessionId).totalLines - baseline
        if (fresh <= 0) return ''
        return terminals.read(owner, sessionId, { offset: 0, count: fresh }).text
      }
      let done = false
      const pump = (): void => {
        if (done) return
        onOutput(since())
      }
      const tick = setInterval(pump, SHELL_STREAM_TICK_MS)
      tick.unref?.()
      // Race the send against the abort. A provider is not obliged to settle
      // `done` when a signal fires, and waiting on it would leave the card
      // running after the reader already asked it to stop.
      const aborted = new Promise<'aborted'>((resolve) => {
        if (runSignal.aborted) resolve('aborted')
        else runSignal.addEventListener('abort', () => { resolve('aborted') }, { once: true })
      })
      try {
        const settled = await Promise.race([operation.done.then(() => 'done' as const).catch(() => 'failed' as const), aborted])
        // A settled send means the line was delivered, not that the command
        // exited; the card reports the delivery rather than inventing an exit
        // code the Shell never gave us.
        if (settled === 'done') {
          // Publish the settled delta to the card as well: the tick that would
          // have shown it may never fire, and the card must not stop on a frame
          // older than the command.
          produced = since()
          if (produced !== '') onOutput(produced)
          return { output: produced }
        }
        // An interrupted line still needs the send cancelled and the shell
        // signalled, or the command keeps running in the background while the
        // card claims it stopped.
        if (!operation.cancel() && terminals.list(owner).some(item => item.sessionId === sessionId && item.status.kind === 'running')) {
          await terminals.signal(owner, sessionId, 'SIGINT')
        }
        return { output: since(), interrupted: true }
      } finally {
        done = true
        clearInterval(tick)
      }
    },
  })
  if (options.share === true && !signal.aborted) {
    // Share what this line produced, for the same reason the card shows that.
    shareTerminalOutputToConversation(owner, `Shell · \`${command}\``, produced)
  }
}

/**
 * Close the composer Shell when it is not running anything.
 *
 * The Shell is reused across `!` lines so a directory change or an environment
 * variable survives, which is the whole point of it. That reuse also pins the
 * session to the Access level it was created in: the Harness refuses to change
 * sandbox mode while a persistent terminal is open, and a reader driving `!`
 * cards would otherwise be stuck on one level forever with no way out. A Shell
 * with a command still running is left alone — closing it would kill work.
 */
export async function closeIdleComposerShell(ctx: Context, owner: Agent): Promise<boolean> {
  const terminals = ctx.get('terminals')
  if (terminals === undefined) return false
  // A persistent shell reports `running` for as long as it is alive, whether or
  // not a command is in it, so "idle" cannot be read from that status. The
  // composer Shell is closed unconditionally: it exists only to serve the last
  // `!` line, and the reader is asking to change Access rather than to keep a
  // session pinned to the old one.
  const shells = terminals.list(owner).filter(item => item.name === 'Composer shell' && item.type === 'shell')
  for (const item of shells) await terminals.kill(owner, item.sessionId, 'Composer shell closed for an Access change')
  return shells.length > 0
}

/** How often the live card re-reads the terminal while a command writes. */
const SHELL_STREAM_TICK_MS = 120
