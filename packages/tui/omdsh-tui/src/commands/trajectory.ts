/** Full-screen session Trajectory command registered through dsh-commands. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-trajectory'
export const inject = ['commands', 'tui']

function openTrajectory(ctx: Context, invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /trajectory' }
  if (!ctx.tui.openTrajectory(invocation.agent.session.events)) {
    return { kind: 'error', text: 'Trajectory requires an interactive terminal.' }
  }
  return { kind: 'success' }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [{
    name: 'trajectory',
    description: 'Inspect the session event trajectory',
    handler: invocation => openTrajectory(ctx, invocation),
  }], 'omdsh trajectory command')
}
