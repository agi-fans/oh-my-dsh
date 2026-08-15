/**
 * Interactive runner: reads submitted terminal input and delegates session
 * lifecycle and slash-command dispatch to the mounted session runtime.
 * @module @agi-fans/dsh-tui/runner
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-tools'
import type { TuiService } from './definition.ts'
import type {} from './session-runtime.ts'

export const name = 'omdsh-runner'
export const inject = ['tui', 'omdshSession']

function fail(error: unknown, exit: (code: number) => void): void {
  console.error('omdsh: ' + (error instanceof Error ? error.message : String(error)))
  exit(1)
}

async function run(ctx: Context, tui: TuiService): Promise<void> {
  await ctx.get('loader')?.await()
  const controller = ctx.get('omdshSession')
  if (controller === undefined) return

  await controller.start()
  let operation: AbortController | undefined
  const offInterrupt = tui.onInterrupt(() => {
    operation?.abort(new Error('cancelled by user'))
    controller.agent?.cancel({ kind: 'user' })
  })
  try {
    const args = ctx.get('cmdlineArgs')?.get() ?? []
    if (args[0] === '--resume' && args[1] !== undefined) {
      operation = new AbortController()
      try {
        await controller.execute(`/resume ${args[1]}`, operation.signal)
      } catch (error: unknown) {
        if (!operation.signal.aborted) tui.notice(error instanceof Error ? error.message : String(error), 'error')
      } finally {
        operation = undefined
      }
    } else if (args.length > 0) {
      await controller.send(args.join(' '))
    }
    for (;;) {
      const submission = await tui.readInput()
      if (submission === null) break
      if (submission.text.trim() === '' && submission.images.length === 0) continue
      if (submission.images.length === 0 && submission.text.trimStart().startsWith('/')) {
        operation = new AbortController()
        try {
          const handled = await controller.execute(submission.text, operation.signal)
          if (!handled) {
            tui.notice(`Unknown command: ${submission.text.trim().split(/\s/u, 1)[0] ?? submission.text}`, 'error')
          }
        } catch (error: unknown) {
          if (!operation.signal.aborted) {
            tui.notice(error instanceof Error ? error.message : String(error), 'error')
          }
        } finally {
          operation = undefined
        }
      } else {
        try {
          await controller.send(submission)
        } catch (error: unknown) {
          tui.restoreInput(submission)
          tui.notice(error instanceof Error ? error.message : String(error), 'error')
        }
      }
    }
    // EOF means "no more input", not "discard the accepted work". Let the
    // active turn and every queued follow-up settle so pipe/CI mode observes
    // the same transcript and errors as an interactive terminal.
    await controller.agent?.whenIdle()
  } finally {
    operation?.abort(new Error('runner disposed'))
    offInterrupt()
  }
  ctx.get('appExit')?.(0)
}

export function apply(ctx: Context): void {
  const tui = ctx.get('tui')
  if (tui === undefined) throw new Error('omdsh-runner: the tui provider must be mounted (config row: @agi-fans/dsh-tui)')
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('omdsh-runner: the launcher must provide ctx.appExit before the tree mounts')
  void run(ctx, tui).catch((error: unknown) => { fail(error, exit) })
}
