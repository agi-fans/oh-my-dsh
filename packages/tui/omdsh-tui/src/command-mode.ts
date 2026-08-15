/** Interactive access-mode command over the Harness permission preset seam. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from './definition.ts'
import { registerCommands } from './command-registration.ts'

export const name = 'omdsh-command-mode'
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
    detail: 'Only enable this mode for a workspace and task you trust.',
    options: [
      { label: 'Cancel', value: 'cancel', description: 'Keep the current access mode.' },
      { label: 'Enable full access', value: 'confirm', description: 'Disable sandbox and approval protection.' },
    ],
    initialValue: 'cancel',
    allowCustom: false,
    submitLabel: 'choose',
    signal: invocation.signal,
  })
  return answer === 'confirm'
}

async function selectMode(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /mode' }
  const current = ctx.permissionPresets.current(invocation.agent.session.events)
  const options = ctx.permissionPresets.names.map((value) => {
    const option = ctx.permissionPresets.optionOf(value)
    return {
      label: option.name,
      value,
      description: `${value === current ? 'Current · ' : ''}${option.description ?? titleCase(value)}`,
    }
  })
  if (options.length === 0) return { kind: 'error', text: 'No access modes are configured.' }
  const selected = await ctx.tui.prompt({
    title: 'Access mode',
    question: 'Choose how omdsh may access your workspace',
    options,
    initialValue: current,
    allowCustom: false,
    submitLabel: 'apply',
    signal: invocation.signal,
  })
  if (selected === null || selected === current) return { kind: 'success' }
  if (!ctx.permissionPresets.names.includes(selected)) {
    return { kind: 'error', text: `Unknown access mode: ${selected}` }
  }
  if (selected === 'danger-full-access' && !await confirmFullAccess(ctx, invocation)) {
    return { kind: 'success' }
  }

  // Keep the Harness command as the single mutation path. omdsh owns only
  // this fixed-choice presentation; policy events and model notifications
  // remain inside the permission plugin.
  const switched = await ctx.commands.execute(
    invocation.agent,
    `/permission ${selected}`,
    invocation.signal,
  )
  if (switched === undefined) return { kind: 'error', text: 'Access modes are unavailable.' }
  if (switched.result.kind === 'error') return switched.result
  const option = ctx.permissionPresets.optionOf(selected)
  return { kind: 'success', text: `Access mode: ${option.name}` }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [
    { name: 'mode', description: 'Choose the session access mode', handler: invocation => selectMode(ctx, invocation) },
  ], 'omdsh access-mode command')
}
