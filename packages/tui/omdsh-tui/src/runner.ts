/**
 * Interactive runner: continuously reads the terminal, delegates lifecycle
 * and command work to SessionController, and binds Harness human interaction.
 * @module @omdsh/tui/runner
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { TuiService } from './definition.ts'
import { bindHumanInteraction } from './interaction-adapter.ts'
import { SessionController } from './session-controller.ts'

export const name = 'omdsh-runner'
export const inject = ['tui', 'agentDefaultModel', 'agents']

function fail(error: unknown, exit: (code: number) => void): void {
  console.error('omdsh: ' + (error instanceof Error ? error.message : String(error)))
  exit(1)
}

async function run(ctx: Context, tui: TuiService): Promise<void> {
  await ctx.get('loader')?.await()
  if (ctx.get('agents') === undefined || ctx.get('agentDefaultModel') === undefined) return

  const controller = new SessionController(ctx, tui)
  await controller.start()
  const offInteraction = bindHumanInteraction(ctx, tui, () => controller.agent)
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
      controller.send(args.join(' '))
    }
    for (;;) {
      const line = await tui.readline()
      if (line === null) break
      if (line.trim() === '') continue
      if (line.trimStart().startsWith('/')) {
        operation = new AbortController()
        try {
          const handled = await controller.execute(line, operation.signal)
          if (!handled) tui.notice(`Unknown command: ${line.trim().split(/\s/u, 1)[0] ?? line}`, 'error')
        } catch (error: unknown) {
          if (!operation.signal.aborted) {
            tui.notice(error instanceof Error ? error.message : String(error), 'error')
          }
        } finally {
          operation = undefined
        }
      } else {
        controller.send(line)
      }
    }
    // EOF means "no more input", not "discard the accepted work". Let the
    // active turn and every queued follow-up settle so pipe/CI mode observes
    // the same transcript and errors as an interactive terminal.
    await controller.agent?.whenIdle()
  } finally {
    operation?.abort(new Error('runner disposed'))
    offInterrupt()
    offInteraction()
    await controller.dispose()
  }
  ctx.get('appExit')?.(0)
}

export function apply(ctx: Context): void {
  const tui = ctx.get('tui')
  if (tui === undefined) throw new Error('omdsh-runner: the tui provider must be mounted (config row: @omdsh/tui)')
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('omdsh-runner: the launcher must provide ctx.appExit before the tree mounts')
  void run(ctx, tui).catch((error: unknown) => { fail(error, exit) })
}
