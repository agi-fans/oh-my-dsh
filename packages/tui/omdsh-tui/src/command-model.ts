/** Model/provider selection command registered through dsh-commands. */

import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from './session-runtime.ts'
import { registerCommands } from './command-registration.ts'

export const name = 'omdsh-command-model'
export const inject = ['commands', 'omdshSession', 'tui', 'llm']

function selected(raw: string, values: readonly string[]): string | undefined {
  const index = /^\d+$/u.test(raw) ? Number(raw) - 1 : -1
  return index >= 0 ? values[index] : raw
}

async function selectModel(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /model' }
  const providers = ctx.llm.listProviders()
  if (providers.length === 0) return { kind: 'error', text: 'No model providers are registered.' }
  const current = ctx.omdshSession.selection(invocation.agent)
  const providerRaw = await ctx.tui.prompt({
    title: 'Model provider',
    question: 'Choose a provider',
    options: providers.map(provider => ({ label: provider.id, description: provider.name })),
    signal: invocation.signal,
  })
  if (providerRaw === null) return { kind: 'success' }
  const provider = selected(providerRaw, providers.map(entry => entry.id))
  if (provider === undefined || !providers.some(entry => entry.id === provider)) {
    return { kind: 'error', text: `Unknown provider: ${providerRaw}` }
  }
  const models = await ctx.llm.listModels(provider)
  const modelRaw = await ctx.tui.prompt({
    title: 'Model',
    question: `Choose a model for ${provider}`,
    options: models.map(model => ({ label: model.id, description: model.description ?? model.name })),
    signal: invocation.signal,
  })
  if (modelRaw === null) return { kind: 'success' }
  const model = selected(modelRaw, models.map(entry => entry.id))
  if (model === undefined || !models.some(entry => entry.id === model)) {
    return { kind: 'error', text: `Unknown model: ${modelRaw}` }
  }
  const info = await ctx.llm.resolveModelInfo(provider, model, invocation.signal)
  let reasoningEffort = current.reasoningEffort
  if (info.reasoning === undefined) {
    reasoningEffort = undefined
  } else {
    const effortRaw = await ctx.tui.prompt({
      title: 'Reasoning effort',
      question: 'Choose reasoning effort',
      options: info.reasoning.efforts.map(effort => ({ label: String(effort.id), description: effort.description ?? effort.name })),
      signal: invocation.signal,
    })
    if (effortRaw === null) return { kind: 'success' }
    const effortIds = info.reasoning.efforts.map(entry => String(entry.id))
    const resolved = selected(effortRaw, effortIds)
    if (resolved === undefined || !effortIds.includes(resolved)) {
      return { kind: 'error', text: `Unknown reasoning effort: ${effortRaw}` }
    }
    reasoningEffort = ReasoningEffortId(resolved)
  }
  const selection: ModelSelection = {
    provider,
    model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
  await ctx.omdshSession.changeSelection(invocation.agent, selection, info)
  return {
    kind: 'success',
    text: `Model: ${provider}/${model}${reasoningEffort === undefined ? '' : ` (${String(reasoningEffort)})`}`,
  }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [
    { name: 'model', description: 'Select provider, model, and reasoning effort', handler: invocation => selectModel(ctx, invocation) },
  ], 'omdsh model command')
}
