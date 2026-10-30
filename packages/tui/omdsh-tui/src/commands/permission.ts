/** Interactive permission command shadowing the Harness preset write command. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '../definition.ts'
import { registerCommands } from './registration.ts'
import { choosePrompt, confirmPrompt } from '../prompt-intents.ts'
import type {} from '../runtime/approval-rules.ts'
import { approvalActionDetail } from '../views/approval-rule.ts'

export const name = 'omdsh-command-permission'
export const inject = ['commands', 'permissionPresets', 'tui']

function titleCase(value: string): string {
  return value.split(/[-_]/u).filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

async function confirmFullAccess(ctx: Context, invocation: CommandInvocation): Promise<boolean> {
  return confirmPrompt(request => ctx.tui.prompt(request), {
    title: 'Full access',
    question: 'Allow unrestricted filesystem access without approval prompts?',
    detail: 'Only enable this permission for a workspace and task you trust.',
    acceptLabel: 'Enable full access',
    acceptDescription: 'Disable sandbox and approval protection.',
    cancelDescription: 'Keep the current permission.',
    signal: invocation.signal,
  })
}

async function selectAccess(
  ctx: Context,
  invocation: CommandInvocation,
  switchPreset: CommandDefinition['handler'],
): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /permission' }
  const current = ctx.permissionPresets.current(invocation.agent.session)
  const options = ctx.permissionPresets.names.map((value) => {
    const option = ctx.permissionPresets.optionOf(value)
    return {
      label: option.name,
      value,
      description: `${value === current ? 'Current · ' : ''}${option.description ?? titleCase(value)}`,
    }
  })
  if (options.length === 0) return { kind: 'error', text: 'No permissions are configured.' }
  const selected = await ctx.tui.prompt(choosePrompt({
    title: 'Access',
    question: 'Choose how omdsh may access your workspace',
    options: [...options, ...(ctx.get('omdshApprovalRules') === undefined ? [] : [{ label: 'Approval rules', value: 'rules', description: 'Inspect and revoke remembered decisions' }])],
    initialValue: current,
    submitLabel: 'apply',
    signal: invocation.signal,
  }))
  if (selected === null || selected === current) return { kind: 'success' }
  // The composer Shell keeps the session pinned to the Access level it was
  // created in, so a spent one is closed before the switch. A Shell still
  // running a command is left alone, and the Harness then reports the conflict
  // rather than this command silently killing work.
  const { closeIdleComposerShell } = await import('../runtime/composer-shell.ts')
  await closeIdleComposerShell(ctx, invocation.agent)
  if (selected === 'rules') return manageRules(ctx, invocation)
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

async function manageRules(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const rules = ctx.get('omdshApprovalRules')!
  for (;;) {
    invocation.signal.throwIfAborted()
    const entries = rules.list(invocation.agent)
    if (entries.length === 0) return { kind: 'success', text: 'No approval rules for this session or workspace.' }
    const id = await ctx.tui.prompt({ title: 'Approval rules', question: 'Choose a remembered decision', presentation: 'card',
      filterable: true, allowCustom: false, notify: false, signal: invocation.signal,
      options: entries.map(rule => ({ label: `${rule.decision === 'allow' ? 'Allow' : 'Reject'} · ${rule.tool}`,
        value: rule.id, description: `${rule.scope} · ${rule.cwd} · ${rule.arguments}` })) })
    if (id === null) return { kind: 'success' }
    const rule = entries.find(entry => entry.id === id)
    if (rule === undefined) continue
    const selected = await ctx.tui.prompt({ title: 'Approval rule', question: `${rule.decision === 'allow' ? 'Allow' : 'Reject'} · ${rule.scope}`,
      detail: approvalActionDetail(rule),
      options: [{ label: 'Back', value: 'back' }, { label: 'Revoke rule', value: 'revoke', description: 'Future matching requests require a new decision.' }],
      allowCustom: false, notify: false, signal: invocation.signal })
    if (selected === 'revoke') { invocation.signal.throwIfAborted(); rules.revoke(invocation.agent, id); ctx.tui.notice('Approval rule revoked.') }
    else if (selected === null) return { kind: 'success' }
  }
}

/**
 * Build the interactive permission command for one agent scope. The owning
 * agent arrives by closure because a Cordis context no longer exposes the
 * agent it is scoped to.
 * @param agent - the agent whose Harness permission command this shadows.
 */
export function commandPermission(agent: Agent) {
  const apply = (ctx: Context): void => {
    const upstream = ctx.commands.find(agent, 'permission')
    if (upstream === undefined) throw new Error('the Harness permission command is unavailable')
    registerCommands(ctx, [
      {
        name: 'permission',
        description: 'Choose the session access level',
        handler: invocation => selectAccess(ctx, invocation, upstream.handler),
      },
    ], 'omdsh permission command')
  }
  // A function's own `name` is read-only, so the Cordis metadata goes on with
  // defineProperty rather than Object.assign.
  Object.defineProperty(apply, 'name', { value: name, configurable: true })
  return Object.assign(apply, { inject })
}
