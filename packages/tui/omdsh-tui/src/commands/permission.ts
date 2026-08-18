/** Interactive permission command shadowing the Harness preset write command. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '../definition.ts'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-permission'
export const inject = ['commands', 'permissionPresets', 'tui']

function titleCase(value: string): string {
  return value.split(/[-_]/u).filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

async function confirmFullAccess(ctx: Context, invocation: CommandInvocation): Promise<boolean> {
  const answer = await ctx.tui.prompt({
    title: 'Full access',
    question: 'Allow unrestricted filesystem access without approval prompts?',
    detail: 'Only enable this permission for a workspace and task you trust.',
    options: [
      { label: 'Cancel', value: 'cancel', description: 'Keep the current permission.' },
      { label: 'Enable full access', value: 'confirm', description: 'Disable sandbox and approval protection.' },
    ],
    initialValue: 'cancel',
    allowCustom: false,
    submitLabel: 'choose',
    signal: invocation.signal,
  })
  return answer === 'confirm'
}

async function selectAccess(
  ctx: Context,
  invocation: CommandInvocation,
  switchPreset: CommandDefinition['handler'],
): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /access or /permission' }
  const current = ctx.permissionPresets.current(invocation.agent.session.events)
  const options = ctx.permissionPresets.names.map((value) => {
    const option = ctx.permissionPresets.optionOf(value)
    return {
      label: option.name,
      value,
      description: `${value === current ? 'Current · ' : ''}${option.description ?? titleCase(value)}`,
    }
  })
  if (options.length === 0) return { kind: 'error', text: 'No permissions are configured.' }
  const selected = await ctx.tui.prompt({
    title: 'Access',
    question: 'Choose how omdsh may access your workspace',
    options,
    initialValue: current,
    allowCustom: false,
    submitLabel: 'apply',
    signal: invocation.signal,
  })
  if (selected === null || selected === current) return { kind: 'success' }
  if (!ctx.permissionPresets.names.includes(selected)) {
    return { kind: 'error', text: `Unknown permission: ${selected}` }
  }
  if (selected === 'danger-full-access' && !await confirmFullAccess(ctx, invocation)) {
    return { kind: 'success' }
  }

  // The scoped presentation shadows the global Harness command, while its
  // captured handler remains the single authoritative mutation path.
  const switched = await switchPreset({ ...invocation, rawInput: ` ${selected}` })
  if (switched.kind === 'error') return switched
  const option = ctx.permissionPresets.optionOf(selected)
  return { kind: 'success', text: `Access: ${option.name}` }
}

export function apply(ctx: Context): void {
  const agent = ctx.agent
  if (agent === undefined) throw new Error('omdsh-command-permission must be mounted under agent.ctx')
  const upstream = ctx.commands.find(agent, 'permission')
  if (upstream === undefined) throw new Error('the Harness permission command is unavailable')
  registerCommands(ctx, [
    {
      name: 'permission',
      description: 'Choose the session access level',
      handler: invocation => selectAccess(ctx, invocation, upstream.handler),
    },
    {
      name: 'access',
      description: 'Choose Read only, Workspace write, or Full access',
      handler: invocation => selectAccess(ctx, invocation, upstream.handler),
    },
  ], 'omdsh permission command')
}
