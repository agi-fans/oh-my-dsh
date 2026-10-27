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
    notify: false,
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
async function loadCatalog(ctx: Context): Promise<ModelCatalogEntry[]> {
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

/**
 * Marker the prompt prepends when the reader asks for one session only.
 *
 * NUL cannot occur in a model id, so it separates the scope from the value
 * without needing a second return channel from the picker.
 */
const SESSION_SCOPE = '\u0000session:'

/** Every model as one row, with the current and favorite ones marked. */
function catalogOptions(
  catalog: readonly ModelCatalogEntry[],
  current: ModelSelection,
  favorites: readonly FavoriteModel[],
): { label: string; value: string; description?: string; badge?: { label: string; tone: 'success' | 'warning' | 'error' | 'muted' } }[] {
  return catalog.map(entry => {
    const id = `${entry.provider}/${entry.model}`
    const isCurrent = entry.provider === current.provider && entry.model === current.model
    const isFavorite = favorites.some(favorite => favorite.provider === entry.provider && favorite.model === entry.model)
    return {
      label: id,
      value: id,
      ...(entry.description === '' ? {} : { description: entry.description }),
      ...(isCurrent
        ? { badge: { label: 'current', tone: 'success' as const } }
        : isFavorite ? { badge: { label: 'favorite', tone: 'muted' as const } } : {}),
    }
  })
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
  const catalog = await loadCatalog(ctx)
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
  if (sessionOnly) {
    // Session scope takes a query, or none at all to open the same list.
    if (action === 'next' || action === 'previous' || action === 'reasoning'
      || action === 'favorite' || action === 'unfavorite' || action === 'favorites') {
      return { kind: 'error', text: 'Invalid arguments: /model --session does not take a subcommand.' }
    }
    if (body !== '') return resolveQuerySelect(ctx, invocation, body, true)
  }
  if (action === 'next') return cycleFavorite(ctx, invocation, 1)
  if (action === 'previous') return cycleFavorite(ctx, invocation, -1)
  if (action === 'reasoning') return cycleReasoning(ctx, invocation)
  if (action === 'favorite' || action === 'unfavorite' || action === 'favorites') return manageFavorite(ctx, invocation, action)
  if (body !== '') return resolveQuerySelect(ctx, invocation, body, false)
  const catalog = await loadCatalog(ctx)
  if (catalog.length === 0) return { kind: 'error', text: 'No model providers are registered.' }
  const current = ctx.omdshSession.selection(invocation.agent)
  /**
   * One list for every provider.
   *
   * Choosing a model used to take three prompts — provider, then model, then
   * reasoning effort — and the first two were asking the reader to narrow a list
   * the terminal can filter itself. Provider is not a decision a reader needs to
   * make first: it is one column of the model they already have in mind, so it
   * becomes part of the row and part of the search text.
   */
  const favorites = readModelFavorites(favoritesPath())
  const picked = await ctx.tui.prompt({
    presentation: 'fullscreen-list',
    optionLayout: 'compact',
    filterable: true,
    allowCustom: false,
    notify: false,
    title: sessionOnly ? 'Model · this session' : 'Model',
    question: 'Type to search every provider, then Enter to switch',
    options: catalogOptions(catalog, current, favorites),
    ...(current.provider === '' || current.model === '' ? {} : { initialValue: `${current.provider}/${current.model}` }),
    // Enter applies the scope the reader already asked for. The action is the
    // other scope, so "just this once" no longer requires knowing the model id
    // before opening the list.
    ...(sessionOnly
      ? {}
      : { actions: [{ key: 'ctrl+d', label: 'This session only', valuePrefix: SESSION_SCOPE }] }),
    signal: invocation.signal,
  })
  if (picked === null) return { kind: 'success' }
  const scoped = picked.startsWith(SESSION_SCOPE)
  const chosen = scoped ? picked.slice(SESSION_SCOPE.length) : picked
  const entry = catalog.find(candidate => `${candidate.provider}/${candidate.model}` === chosen)
  if (entry === undefined) return { kind: 'error', text: `Unknown model: ${chosen}` }
  const useSession = sessionOnly || scoped
  const info = await ctx.llm.resolveModelInfo(entry.provider, entry.model, invocation.signal)
  const reasoningEffort = await resolveEffort(ctx, invocation, current, info, useSession)
  if (reasoningEffort === null) return { kind: 'success' }
  const selection: ModelSelection = {
    provider: entry.provider,
    model: entry.model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
  await ctx.omdshSession.changeSelection(invocation.agent, selection, info, { persist: !useSession })
  return {
    kind: 'success',
    text: `${useSession ? 'Session' : 'Default'} model: ${entry.provider}/${entry.model}`
      + (reasoningEffort === undefined ? '' : ` (${String(reasoningEffort)})`),
  }
}

/**
 * Ask for a reasoning effort only when the choice is actually open.
 *
 * The prompt used to appear on every switch to a reasoning model, including one
 * that kept an effort the new model also offers — a question whose answer was
 * already decided. It now appears when the new model's vocabulary does not
 * contain the current effort, which is the only case where the reader has
 * something to say. `undefined` means "no reasoning", `null` means "cancelled".
 */
async function resolveEffort(
  ctx: Context,
  invocation: CommandInvocation,
  current: ModelSelection,
  info: LlmResolvedModelInfo,
  sessionOnly: boolean,
): Promise<ReasoningEffortId | undefined | null> {
  const efforts = info.reasoning?.efforts ?? []
  if (efforts.length === 0) return undefined
  const ids = efforts.map(effort => String(effort.id))
  const inherited = current.reasoningEffort === undefined ? undefined : String(current.reasoningEffort)
  if (inherited !== undefined && ids.includes(inherited)) return ReasoningEffortId(inherited)
  // A single effort is not a choice; take it rather than asking.
  if (ids.length === 1) return ReasoningEffortId(ids[0]!)
  const raw = await ctx.tui.prompt({
    ...fixedChoice(efforts.length),
    title: sessionOnly ? 'Reasoning effort · this session' : 'Reasoning effort',
    question: 'Choose reasoning effort',
    options: efforts.map(effort => ({ label: String(effort.id), description: effort.description ?? effort.name })),
    ...(ids[0] === undefined ? {} : { initialValue: ids[0] }),
    signal: invocation.signal,
  })
  if (raw === null) return null
  const resolved = selected(raw, ids)
  return resolved === undefined || !ids.includes(resolved) ? undefined : ReasoningEffortId(resolved)
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
