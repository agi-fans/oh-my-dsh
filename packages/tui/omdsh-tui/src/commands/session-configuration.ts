/** Interactive selectors for the independent Agent, Workflow, and Tools concepts. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { ToolPresentationMode } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '../runtime/session-runtime.ts'
import { formatAgentPreset, formatToolPresentation } from '../session/session-configuration.ts'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-session-configuration'
export const inject = ['commands', 'omdshSession', 'tui', 'agentPresets', 'planMode']

async function selectAgent(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /agent' }
  const controls = ctx.omdshSession.controls(invocation.agent)
  const presets = await ctx.omdshSession.agentPresets()
  const available = presets.filter(preset => preset.broken === undefined)
  if (available.length === 0) return { kind: 'error', text: 'No usable Agent presets are configured.' }
  const selected = await ctx.tui.prompt({
    title: 'Agent',
    question: 'Choose the Agent composition for this blank session',
    detail: 'Locked after the first prompt',
    options: available.map(preset => ({
      label: preset.name ?? formatAgentPreset(preset.id),
      value: preset.id,
      description: `${preset.id === controls.agentPreset ? 'Current · ' : ''}${preset.description ?? preset.id}`,
    })),
    ...(controls.agentPreset === undefined ? {} : { initialValue: controls.agentPreset }),
    allowCustom: false,
    submitLabel: 'apply',
    signal: invocation.signal,
  })
  if (selected === null || selected === controls.agentPreset) return { kind: 'success' }
  try {
    const configuration = await ctx.omdshSession.changeAgentPreset(invocation.agent, selected)
    return {
      kind: 'success',
      text: `Agent: ${formatAgentPreset(configuration.agentPreset)} · Tools: ${formatToolPresentation(configuration.tools)}`,
    }
  } catch (error: unknown) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

const TOOL_MODES: readonly {
  value: ToolPresentationMode
  label: string
  description: string
}[] = [
  { value: 'native', label: 'Native', description: 'Expose each visible tool as a native function.' },
  { value: 'code', label: 'Code', description: 'Expose run_code with the generated TypeScript tools SDK.' },
  { value: 'both', label: 'Both', description: 'Expose native functions and the TypeScript tools SDK together.' },
]

async function selectTools(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /tool-mode' }
  const current = ctx.omdshSession.controls(invocation.agent).tools ?? 'native'
  const selected = await ctx.tui.prompt({
    title: 'Tools',
    question: 'Choose how tools are exposed to the model',
    detail: 'Locked after the first prompt',
    options: TOOL_MODES.map(mode => ({
      label: mode.label,
      value: mode.value,
      description: `${mode.value === current ? 'Current · ' : ''}${mode.description}`,
    })),
    initialValue: current,
    allowCustom: false,
    submitLabel: 'apply',
    signal: invocation.signal,
  })
  if (selected === null || selected === current) return { kind: 'success' }
  if (!TOOL_MODES.some(mode => mode.value === selected)) {
    return { kind: 'error', text: `Unknown tool presentation: ${selected}` }
  }
  try {
    const configuration = ctx.omdshSession.changeToolPresentation(invocation.agent, selected as ToolPresentationMode)
    return { kind: 'success', text: `Tools: ${formatToolPresentation(configuration.tools)}` }
  } catch (error: unknown) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
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
    { name: 'tool-mode', description: 'Choose Native, Code, or Both tools', handler: invocation => selectTools(ctx, invocation) },
  ], 'omdsh session configuration commands')
}
