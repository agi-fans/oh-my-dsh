/** Model/provider selection command registered through dsh-commands. */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { ReasoningEffortId, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '../runtime/session-runtime.ts'
import {
  addModelFavorite,
  readModelFavorites,
  removeModelFavorite,
  updateFavoriteEffort,
  writeModelFavorites,
  type FavoriteModel,
} from '../session/model-favorites.ts'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-model'
export const inject = ['commands', 'omdshSession', 'tui', 'llm']

const FULLSCREEN_CHOICE_THRESHOLD = 8

function fixedChoice(optionCount: number) {
  const fullscreen = optionCount > FULLSCREEN_CHOICE_THRESHOLD
  return {
    ...(fullscreen ? { presentation: 'fullscreen-list' as const } : {}),
    optionLayout: 'compact' as const,
    filterable: fullscreen,
    allowCustom: false,
  }
}

function selected(raw: string, values: readonly string[]): string | undefined {
  const index = /^\d+$/u.test(raw) ? Number(raw) - 1 : -1
  return index >= 0 ? values[index] : raw
}

function favoritesPath(): string {
  const dshHome = process.env.OMDSH_HOME ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'omdsh', 'model-favorites.json')
}

function favoriteSelection(selection: ModelSelection): FavoriteModel {
  return {
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: String(selection.reasoningEffort) }),
  }
}

function sameModel(left: Pick<FavoriteModel, 'provider' | 'model'>, right: Pick<FavoriteModel, 'provider' | 'model'>): boolean {
  return left.provider === right.provider && left.model === right.model
}

async function resolveFavorite(ctx: Context, favorite: FavoriteModel, signal: AbortSignal): Promise<{ selection: ModelSelection; info: LlmResolvedModelInfo } | undefined> {
  if (!ctx.llm.listProviders().some(provider => provider.id === favorite.provider)) return undefined
  const models = await ctx.llm.listModels(favorite.provider)
  if (!models.some(model => model.id === favorite.model)) return undefined
  const info = await ctx.llm.resolveModelInfo(favorite.provider, favorite.model, signal)
  const efforts = info.reasoning?.efforts.map(effort => String(effort.id)) ?? []
  const reasoningEffort = favorite.reasoningEffort !== undefined && efforts.includes(favorite.reasoningEffort)
    ? ReasoningEffortId(favorite.reasoningEffort)
    : undefined
  return {
    selection: {
      provider: favorite.provider,
      model: favorite.model,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    },
    info,
  }
}

async function cycleFavorite(ctx: Context, invocation: CommandInvocation, direction: 1 | -1): Promise<CommandResult> {
  const favorites = readModelFavorites(favoritesPath())
  if (favorites.length < 2) return { kind: 'error', text: 'Favorite at least two models with `/model favorite` before cycling.' }
  const current = ctx.omdshSession.selection(invocation.agent)
  const currentIndex = favorites.findIndex(entry => sameModel(entry, current))
  for (let offset = 1; offset <= favorites.length; offset += 1) {
    const start = currentIndex < 0 ? (direction === 1 ? -1 : 0) : currentIndex
    const index = (start + direction * offset + favorites.length) % favorites.length
    const entry = favorites[index]
    if (entry === undefined || sameModel(entry, current)) continue
    const resolved = await resolveFavorite(ctx, entry, invocation.signal)
    if (resolved === undefined) continue
    await ctx.omdshSession.changeSelection(invocation.agent, resolved.selection, resolved.info)
    return { kind: 'success', text: `Model: ${entry.provider}/${entry.model}${resolved.selection.reasoningEffort === undefined ? '' : ` (${String(resolved.selection.reasoningEffort)})`}` }
  }
  return { kind: 'error', text: 'No other available favorite model was found.' }
}

async function cycleReasoning(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const current = ctx.omdshSession.selection(invocation.agent)
  const info = await ctx.llm.resolveModelInfo(current.provider, current.model, invocation.signal)
  const efforts = info.reasoning?.efforts ?? []
  if (efforts.length === 0) return { kind: 'error', text: `${current.provider}/${current.model} does not expose reasoning efforts.` }
  const effective = current.reasoningEffort ?? info.reasoning?.defaultEffort
  const currentIndex = efforts.findIndex(effort => String(effort.id) === String(effective))
  const next = efforts[(currentIndex + 1 + efforts.length) % efforts.length]
  if (next === undefined) return { kind: 'error', text: 'No reasoning effort is available.' }
  const selection: ModelSelection = { ...current, reasoningEffort: ReasoningEffortId(String(next.id)) }
  await ctx.omdshSession.changeSelection(invocation.agent, selection, info)
  const path = favoritesPath()
  const favorites = readModelFavorites(path)
  if (favorites.some(entry => sameModel(entry, current))) {
    writeModelFavorites(path, updateFavoriteEffort(favorites, favoriteSelection(selection)))
  }
  return { kind: 'success', text: `Reasoning effort: ${String(next.id)}` }
}

function manageFavorite(ctx: Context, invocation: CommandInvocation, action: 'favorite' | 'unfavorite' | 'favorites'): CommandResult {
  const path = favoritesPath()
  const favorites = readModelFavorites(path)
  if (action === 'favorites') {
    if (favorites.length === 0) return { kind: 'success', text: 'No favorite models. Use `/model favorite` to add the current model.' }
    return { kind: 'success', text: favorites.map((entry, index) => `${index + 1}. ${entry.provider}/${entry.model}${entry.reasoningEffort === undefined ? '' : ` (${entry.reasoningEffort})`}`).join('\n') }
  }
  const current = favoriteSelection(ctx.omdshSession.selection(invocation.agent))
  if (action === 'favorite') {
    writeModelFavorites(path, addModelFavorite(favorites, current))
    return { kind: 'success', text: `Favorited model: ${current.provider}/${current.model}` }
  }
  writeModelFavorites(path, removeModelFavorite(favorites, current))
  return { kind: 'success', text: `Removed favorite: ${current.provider}/${current.model}` }
}

async function selectModel(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const action = invocation.rawInput.trim().toLowerCase()
  if (action === 'next') return cycleFavorite(ctx, invocation, 1)
  if (action === 'previous') return cycleFavorite(ctx, invocation, -1)
  if (action === 'reasoning') return cycleReasoning(ctx, invocation)
  if (action === 'favorite' || action === 'unfavorite' || action === 'favorites') return manageFavorite(ctx, invocation, action)
  if (action !== '') return { kind: 'error', text: 'Usage: /model [favorite|unfavorite|favorites|next|previous|reasoning]' }
  const providers = ctx.llm.listProviders()
  if (providers.length === 0) return { kind: 'error', text: 'No model providers are registered.' }
  const current = ctx.omdshSession.selection(invocation.agent)
  let provider = providers[0]?.id
  if (providers.length > 1) {
    const providerRaw = await ctx.tui.prompt({
      ...fixedChoice(providers.length),
      title: 'Model provider',
      question: 'Choose a provider',
      options: providers.map(entry => ({
        label: entry.id === 'deepseek-official' ? 'deepseek' : entry.id,
        value: entry.id,
      })),
      initialValue: current.provider,
      signal: invocation.signal,
    })
    if (providerRaw === null) return { kind: 'success' }
    provider = selected(providerRaw, providers.map(entry => entry.id))
    if (provider === undefined || !providers.some(entry => entry.id === provider)) {
      return { kind: 'error', text: `Unknown provider: ${providerRaw}` }
    }
  }
  if (provider === undefined) return { kind: 'error', text: 'No model provider is available.' }
  const models = await ctx.llm.listModels(provider)
  if (models.length === 0) return { kind: 'error', text: `No models are available for ${provider}.` }
  const modelRaw = await ctx.tui.prompt({
    ...fixedChoice(models.length),
    title: 'Model',
    question: `Choose a model for ${provider}`,
    options: models.map(model => ({ label: model.id, value: model.id, description: model.description ?? model.name })),
    ...(provider === current.provider ? { initialValue: current.model } : {}),
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
      ...fixedChoice(info.reasoning.efforts.length),
      title: 'Reasoning effort',
      question: 'Choose reasoning effort',
      options: info.reasoning.efforts.map(effort => ({ label: String(effort.id), description: effort.description ?? effort.name })),
      ...(reasoningEffort === undefined ? {} : { initialValue: String(reasoningEffort) }),
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
    {
      name: 'model',
      description: 'Select, favorite, or cycle models and reasoning effort',
      input: { hint: '[favorite|unfavorite|favorites|next|previous|reasoning]' },
      handler: invocation => selectModel(ctx, invocation),
    },
  ], 'omdsh model command')
}
