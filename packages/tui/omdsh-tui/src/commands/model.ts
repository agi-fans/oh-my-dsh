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

/** One public-catalog model row used by query resolution (no private metadata). */
export interface ModelCatalogEntry {
  readonly provider: string
  readonly model: string
  readonly name: string
  readonly description: string
}

export type ModelQueryResolution =
  | { kind: 'unknown-provider'; provider: string }
  | { kind: 'exact'; matches: readonly ModelCatalogEntry[] }
  | { kind: 'fuzzy'; matches: readonly ModelCatalogEntry[] }
  | { kind: 'none'; closest: readonly ModelCatalogEntry[] }

function doubledHill(a: string, b: string, max: number): number | undefined {
  if (Math.abs(a.length - b.length) > max) return undefined
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1)
    current[0] = i
    let min = current[0]!
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost)
      if (current[j]! < min) min = current[j]!
    }
    if (min > max) return undefined
    previous = current
  }
  return previous[b.length]
}

function closestEntries(query: string, catalog: readonly ModelCatalogEntry[]): ModelCatalogEntry[] {
  const targets: { entry: ModelCatalogEntry; distance: number }[] = []
  for (const entry of catalog) {
    let distance: number | undefined
    for (const candidate of [entry.model, entry.name]) {
      const attempt = doubledHill(query.toLowerCase(), candidate.toLowerCase(), 3)
      if (attempt !== undefined && (distance === undefined || attempt < distance)) distance = attempt
    }
    if (distance !== undefined) targets.push({ entry, distance })
  }
  targets.sort((left, right) => left.distance - right.distance)
  return targets.slice(0, 3).map(entry => entry.entry)
}

function matchesQuery(entry: ModelCatalogEntry, query: string): boolean {
  return entry.model.toLowerCase().includes(query)
    || entry.name.toLowerCase().includes(query)
    || entry.description.toLowerCase().includes(query)
}

/**
 * Resolve one /model query against the public catalog. Pure; the caller
 * fetches the catalog and performs the side effects.
 */
export function resolveModelQuery(query: string, catalog: readonly ModelCatalogEntry[]): ModelQueryResolution {
  const trimmed = query.trim()
  if (trimmed === '') return { kind: 'exact', matches: [] }
  const qualifier = /^([^:]+):([^:]+)$/u.exec(trimmed)
  if (qualifier !== null) {
    const provider = qualifier[1]!.toLowerCase()
    const model = qualifier[2]!.toLowerCase()
    const inProvider = catalog.filter(entry => entry.provider.toLowerCase() === provider)
    if (inProvider.length === 0) return { kind: 'unknown-provider', provider: qualifier[1]! }
    const exactId = inProvider.filter(entry => entry.model.toLowerCase() === model)
    if (exactId.length > 0) return { kind: 'exact', matches: exactId }
    const exactName = inProvider.filter(entry => entry.name.toLowerCase() === model)
    if (exactName.length > 0) return { kind: 'exact', matches: exactName }
    const exactDescription = inProvider.filter(entry => entry.description.toLowerCase() === model)
    if (exactDescription.length > 0) return { kind: 'exact', matches: exactDescription }
    const fuzzy = inProvider.filter(entry => matchesQuery(entry, model))
    return fuzzy.length > 0 ? { kind: 'fuzzy', matches: fuzzy } : { kind: 'none', closest: closestEntries(model, inProvider) }
  }
  const lower = trimmed.toLowerCase()
  const exact = catalog.filter(entry => entry.model.toLowerCase() === lower)
  if (exact.length > 0) return { kind: 'exact', matches: exact }
  const fuzzy = catalog.filter(entry => matchesQuery(entry, lower))
  if (fuzzy.length > 0) return { kind: 'fuzzy', matches: fuzzy }
  return { kind: 'none', closest: closestEntries(lower, catalog) }
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

/** Load the public model catalog (id/name/description only). */
async function loadCatalog(ctx: Context, signal: AbortSignal): Promise<ModelCatalogEntry[]> {
  const catalog: ModelCatalogEntry[] = []
  for (const provider of ctx.llm.listProviders()) {
    const models = await ctx.llm.listModels(provider.id)
    for (const model of models) {
      catalog.push({
        provider: provider.id,
        model: model.id,
        name: model.name ?? model.id,
        description: model.description ?? '',
      })
    }
  }
  return catalog
}

function pickEffort(current: ModelSelection, info: LlmResolvedModelInfo): ReasoningEffortId | undefined {
  if (current.reasoningEffort === undefined) return undefined
  const efforts = info.reasoning?.efforts.map(effort => String(effort.id)) ?? []
  return efforts.includes(String(current.reasoningEffort))
    ? ReasoningEffortId(String(current.reasoningEffort))
    : undefined
}

/** Switch through one resolved catalog entry; `sessionOnly` skips the default write. */
async function applyResolved(
  ctx: Context,
  invocation: CommandInvocation,
  entry: ModelCatalogEntry,
  sessionOnly: boolean,
  current: ModelSelection,
): Promise<CommandResult> {
  const info = await ctx.llm.resolveModelInfo(entry.provider, entry.model, invocation.signal)
  const reasoningEffort = pickEffort(current, info)
  const selection: ModelSelection = {
    provider: entry.provider,
    model: entry.model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
  await ctx.omdshSession.changeSelection(invocation.agent, selection, info, { persist: !sessionOnly })
  return {
    kind: 'success',
    text: `${sessionOnly ? 'Session' : 'Default'} model: ${entry.provider}/${entry.model}${reasoningEffort === undefined ? '' : ` (${String(reasoningEffort)})`}`,
  }
}

async function resolveQuerySelect(ctx: Context, invocation: CommandInvocation, query: string, sessionOnly: boolean): Promise<CommandResult> {
  const catalog = await loadCatalog(ctx, invocation.signal)
  if (catalog.length === 0) return { kind: 'error', text: 'No model providers are registered.' }
  const resolve = resolveModelQuery(query, catalog)
  const current = ctx.omdshSession.selection(invocation.agent)
  if (resolve.kind === 'unknown-provider') return { kind: 'error', text: `Unknown provider: ${resolve.provider}` }
  if (resolve.kind === 'none') {
    const closest = resolve.closest.map(entry => `${entry.provider}/${entry.model}`).join(' · ')
    return {
      kind: 'error',
      text: `No model matches "${query.trim()}"` + (closest === '' ? '' : `. Closest: ${closest}`),
    }
  }
  const matches = resolve.matches
  let entry: ModelCatalogEntry | undefined
  if (matches.length === 1) {
    entry = matches[0]
  } else {
    const raw = await ctx.tui.prompt({
      ...fixedChoice(matches.length),
      title: sessionOnly ? 'Model (session)' : 'Model',
      question: `Matches for "${query.trim()}"; use provider:model to disambiguate`,
      options: matches.map(match => ({ label: `${match.provider}/${match.model}`, value: `${match.provider}/${match.model}`, description: match.description })),
      signal: invocation.signal,
    })
    if (raw === null) return { kind: 'success' }
    entry = matches.find(match => `${match.provider}/${match.model}` === raw)
  }
  if (entry === undefined) return { kind: 'error', text: `Unknown match: ${query.trim()}` }
  return applyResolved(ctx, invocation, entry, sessionOnly, current)
}

async function selectModel(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const raw = invocation.rawInput.trim()
  const sessionOnly = raw === '--session' || raw.startsWith('--session ')
  const body = sessionOnly ? raw.slice('--session'.length).trim() : raw
  const action = body.toLowerCase()
  if (action === 'next') return cycleFavorite(ctx, invocation, 1)
  if (action === 'previous') return cycleFavorite(ctx, invocation, -1)
  if (action === 'reasoning') return cycleReasoning(ctx, invocation)
  if (action === 'favorite' || action === 'unfavorite' || action === 'favorites') return manageFavorite(ctx, invocation, action)
  if (sessionOnly) return { kind: 'error', text: 'Usage: /model --session <query>' }
  if (body !== '') return resolveQuerySelect(ctx, invocation, body, false)
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
    text: `Default model: ${provider}/${model}${reasoningEffort === undefined ? '' : ` (${String(reasoningEffort)})`}`,
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
