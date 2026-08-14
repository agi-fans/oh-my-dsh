/**
 * TUI capability seam — interactive runner Consumer.

 * Direct agent driver in the @deepseek-ai/dsh-headless pattern: creates one
 * Agent through the core registry, forwards its session events to the tui
 * presentation service, and loops on tui.readline() — followup, quiescence,
 * repeat — until Ctrl-D (or stdin EOF) requests exit through ctx.appExit.
 * @module @omdsh/tui/runner
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-cmdline'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { TuiService } from './definition.ts'

export const name = 'omdsh-runner'

/** Services required before the interactive loop can start. */
export const inject = ['tui', 'agentDefaultModel', 'agents']

/**
 * Report an unexpected driver failure and request a failing exit.
 * @param error - the failure.
 * @param exit - the launcher-provided bounded exit request.
 */
function fail(error: unknown, exit: (code: number) => void): void {
  console.error('omdsh: ' + (error instanceof Error ? error.message : String(error)))
  exit(1)
}

/**
 * Run the interactive loop: create the agent, subscribe its event feed,
 * drive one turn per submitted input line, exit on quit.
 * @param ctx - plugin context carrying the tui, agent registry, and model route.
 */
async function run(ctx: Context, tui: TuiService): Promise<void> {
  // Loader siblings mount concurrently. Await the complete application
  // before creating an Agent so its scoped tools are not half-composed.
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  if (agents === undefined || defaultModel === undefined) return

  const selection = defaultModel.currentSelection()
  // The status line shows the route this agent actually runs on — the
  // settings document may override the composition's default model.
  tui.setModel(selection.model)
  const { agent } = await agents.create({
    sessionId: SessionId('session-' + randomUUID()),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx) => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
    },
  })

  const offStatus = ctx.on('agent/status', (payload) => {
    if (payload.agent.id === agent.id) tui.setStatus(payload.status)
  })
  const offEvent = ctx.on('session/event', (session, event) => {
    if (session.id === agent.id) tui.event(event)
  })
  const offInterrupt = tui.onInterrupt(() => { agent.cancel({ kind: 'user' }) })
  try {
    // The invocation's positional prompt (omdsh 'list files') runs as the
    // first turn; the loop then serves interactive input.
    const args = ctx.get('cmdlineArgs')?.get() ?? []
    if (args.length > 0) {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: args.join(' ') }],
        source: { kind: 'user' },
      }))
      await agent.whenIdle()
    }
    for (;;) {
      const line = await tui.readline()
      if (line === null) break
      if (line.trim() === '') continue
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: line }],
        source: { kind: 'user' },
      }))
      await agent.whenIdle()
    }
  } finally {
    offStatus()
    offEvent()
    offInterrupt()
  }
  ctx.get('appExit')?.(0)
}

/**
 * Mount the interactive driver.
 * @param ctx - plugin context carrying the presentation service and the launcher-provided exit request.
 */
export function apply(ctx: Context): void {
  const tui = ctx.get('tui')
  if (tui === undefined) {
    throw new Error('omdsh-runner: the tui provider must be mounted (config row: @omdsh/tui)')
  }
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('omdsh-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  void run(ctx, tui).catch((error: unknown) => { fail(error, exit) })
}