/** Interactive selectors for the independent Agent and Workflow concepts. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '../runtime/session-runtime.ts'
import { formatAgentPreset } from '../session/session-configuration.ts'
import { registerCommands } from './registration.ts'
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import type { Agent } from '@deepseek-ai/dsh-agent'

export const name = 'omdsh-command-session-configuration'
export const inject = ['commands', 'omdshSession', 'tui', 'agentPresets', 'planMode']

async function selectAgent(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const args = invocation.rawInput.trim().split(/\s+/u)
  if (args[0] === 'inspect' && args.length <= 2) {
    return { kind: 'success', text: await presetDiagnostics(ctx.agentPresets, invocation.agent, args[1]) }
  }
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /agent [inspect [preset-id]]' }
  const controls = ctx.omdshSession.controls(invocation.agent)
  const presets = await ctx.omdshSession.agentPresets()
  if (presets.length === 0) return { kind: 'error', text: 'No Agent presets are configured.' }
  const selected = await ctx.tui.prompt({
    title: 'Agent',
    question: 'Choose the Agent composition for this blank session',
    detail: 'Locked after the first prompt · /agent inspect shows composition diagnostics',
    options: presets.map(preset => ({
      label: preset.name ?? formatAgentPreset(preset.id),
      value: preset.id,
      description: `${preset.id === controls.agentPreset ? 'Current · ' : ''}${preset.broken ?? preset.description ?? preset.id}`,
      ...(preset.broken === undefined ? {} : { badge: { label: 'Unavailable', tone: 'error' as const } }),
    })),
    ...(controls.agentPreset === undefined ? {} : { initialValue: controls.agentPreset }),
    allowCustom: false,
    submitLabel: 'apply',
    signal: invocation.signal,
  })
  if (selected === null) return { kind: 'success' }
  const broken = presets.find(preset => preset.id === selected)?.broken
  if (broken !== undefined) return { kind: 'error', text: broken }
  if (selected === controls.agentPreset) return { kind: 'success' }
  try {
    const agentPreset = await ctx.omdshSession.changeAgentPreset(invocation.agent, selected)
    return { kind: 'success', text: `Agent: ${formatAgentPreset(agentPreset)}` }
  } catch (error: unknown) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

/** Read current declarations beside the exact composition retained by this Agent. */
export async function presetDiagnostics(registry: AgentPresetRegistry, agent: Agent, requested?: string): Promise<string> {
  const declared = await registry.compositionInventory()
  const retained = registry.inspectCompositions(agent.ctx)
  const rows = requested === undefined ? declared : declared.filter(row => row.id === requested)
  if (rows.length === 0) return `No declared preset: ${requested ?? '(none)'}`
  return [
    'Agent compositions',
    'Current declarations apply to new sessions. Existing sessions retain their mounted revision.',
    ...rows.flatMap(row => [
      '', `${row.name ?? row.id} (${row.id})${row.isDefault ? ' · default' : ''}${row.broken === undefined ? '' : ' · unavailable'}`,
      ...(row.broken === undefined ? row.rows.map(plugin => `  ${plugin.entryId ?? '(no id)'} · ${plugin.enabled === 'conditional' ? 'conditional' : plugin.enabled ? 'enabled' : 'disabled'} · ${plugin.moduleName}${plugin.fiberState === undefined ? '' : ` · ${['pending', 'loading', 'active', 'failed', 'disposed', 'unloading'][plugin.fiberState] ?? 'unknown'}`}`) : [row.broken]),
    ]),
    '', 'This session’s retained composition',
    ...(retained.length === 0 ? ['No preset composition is bound to this session.'] : retained.flatMap(row => [
      row.id,
      ...row.modules.map(module => `  ${module.moduleName}`),
      ...(row.leakedServices.length === 0 ? [] : [`Isolation errors: ${row.leakedServices.join(', ')}`]),
    ])),
  ].join('\n')
}

async function selectWorkflow(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /workflow' }
  const state = ctx.planMode.get(invocation.agent)
  const current = state.pending ?? state.active
  const selected = await ctx.tui.prompt({
    title: 'Workflow',
    question: 'Choose how this session approaches the next step',
    options: [
      { label: 'Default', value: 'default', description: `${current ? '' : 'Current · '}Work directly on the request.` },
      { label: 'Plan', value: 'plan', description: `${current ? 'Current · ' : ''}Explore and present a reviewable plan before implementation.` },
    ],
    initialValue: current ? 'plan' : 'default',
    allowCustom: false,
    submitLabel: 'apply',
    signal: invocation.signal,
  })
  if (selected === null) return { kind: 'success' }
  const active = selected === 'plan'
  const outcome = ctx.omdshSession.changeWorkflow(invocation.agent, active)
  const suffix = outcome === 'queued' ? ' (next step)' : ''
  return { kind: 'success', text: `Workflow: ${active ? 'Plan' : 'Default'}${suffix}` }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [
    { name: 'agent', description: 'Choose the session Agent preset', handler: invocation => selectAgent(ctx, invocation) },
    { name: 'workflow', description: 'Choose Default or Plan workflow', handler: invocation => selectWorkflow(ctx, invocation) },
  ], 'omdsh session configuration commands')
}
