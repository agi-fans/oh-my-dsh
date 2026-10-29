/** Full-screen session Trajectory command registered through dsh-commands. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-trajectory'
export const inject = ['commands', 'tui']

function openTrajectory(ctx: Context, invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /trajectory' }
  if (!ctx.tui.openTrajectory(invocation.agent.session.snapshotEvents())) {
    return { kind: 'error', text: 'Trajectory requires an interactive terminal.' }
  }
  return { kind: 'success' }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [{
    name: 'trajectory',
    // The Harness is event-sourced, so its ledger is the product's own record
    // rather than a debug view of someone else's: this is the only surface that
    // shows a run's shape — turns, steps, timing, tokens — instead of its output.
    description: 'Inspect the session event ledger: turns, steps, timings, tokens',
    handler: invocation => openTrajectory(ctx, invocation),
  }], 'omdsh trajectory command')
}
