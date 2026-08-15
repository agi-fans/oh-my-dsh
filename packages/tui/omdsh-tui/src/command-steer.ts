/** Steering command registered through dsh-commands. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { registerCommands } from './command-registration.ts'

export const name = 'omdsh-command-steer'
export const inject = ['commands']

function steer(invocation: CommandInvocation): CommandResult {
  const input = invocation.rawInput.trim()
  if (input === '') return { kind: 'error', text: 'Usage: /steer <message>' }
  invocation.agent.steer(createUserMessage({ content: [{ type: 'text', text: input }], source: { kind: 'user' } }))
  return { kind: 'success', text: 'Steering queued for the next step.' }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [
    { name: 'steer', description: 'Send guidance to the next model step', input: { hint: '<message>' }, handler: steer },
  ], 'omdsh steering commands')
}
