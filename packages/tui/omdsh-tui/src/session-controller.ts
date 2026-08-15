/**
 * Active-agent/session runtime shared by the runner and command plugins.
 *
 * This is the deep module between Harness runtime services and the TUI:
 * Agent creation, replacement, persistence lookup, model selection, recent
 * sessions, projections, command routing, and cleanup stay behind one API.
 * @module @omdsh/tui/session-controller
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  installModelSelection,
  type Agent,
  type AgentHandle,
  type ModelSelection,
  type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import { createUserMessage, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { isTokenDelta } from '@deepseek-ai/dsh-llm/message'
import type {} from '@deepseek-ai/dsh-commands'
import type { PermissionSelect } from '@deepseek-ai/dsh-permission-presets/types'
import type { PlanProjection } from '@deepseek-ai/dsh-plan-mode/types'
import { isUserInvocable, type SkillSummary } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats/types'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-session-query'
import type { ContextPressureProjection, TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  TuiCommand,
  TuiRecentSession,
  TuiService,
  TuiSessionControls,
  TuiSessionStats,
} from './definition.ts'
import type {} from './tool-presentation.ts'

interface ActiveSession {
  handle: AgentHandle
  selection: ModelSelectionRef
  contextWindow: number | undefined
  reasoningEffort: string | undefined
}

function parseControl(line: string): { name: string; input: string } | undefined {
  const match = /^\/([a-z][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)?)(?:\s+(.*))?$/su.exec(line.trim())
  if (match === null || match[1] === undefined) return undefined
  return { name: match[1].toLowerCase(), input: match[2]?.trim() ?? '' }
}

/** Projection values consumed as one consistent snapshot when the units exist. */
export interface TuiStatsProjection {
  sessionStats?: SessionStatsProjection
  tokenUsage?: TokenUsageProjection
  contextPressure?: ContextPressureProjection
  plan?: PlanProjection
  permissions?: PermissionSelect
}

/** Present only the session controls whose owning Harness plugins are composed. */
export function sessionControls(projection?: TuiStatsProjection): TuiSessionControls {
  return {
    ...(projection?.plan === undefined ? {} : { plan: { ...projection.plan } }),
    ...(projection?.permissions === undefined ? {} : { permission: projection.permissions.currentValue }),
  }
}

/** Composer projection of a Harness model selection and its adapter default. */
export function modelStatus(
  selection: ModelSelection,
  info?: Pick<LlmResolvedModelInfo, 'reasoning'>,
): { model: string; reasoningEffort?: string } {
  const effort = selection.reasoningEffort ?? info?.reasoning?.defaultEffort
  return {
    model: selection.model,
    ...(effort === undefined ? {} : { reasoningEffort: String(effort) }),
  }
}

/** Fold a complete log as the capability-absence fallback for projections. */
export function sessionStats(
  events: readonly SessionEvent[],
  contextWindow?: number,
  projection?: TuiStatsProjection,
): TuiSessionStats {
  let turns = 0
  let steps = 0
  let llmMs = 0
  let toolMs = 0
  let ttftMs = 0
  let ttftSteps = 0
  let decodeMs = 0
  let decodeTokens = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let contextTokens: number | undefined
  let first: number | undefined
  let last: number | undefined
  let lastTurn: number | undefined
  let openStep: { turn: number; step: number; startTime: number; firstTokenTime?: number } | undefined
  const pendingCalls = new Map<string, number>()
  for (const event of events) {
    first ??= event.time
    last = event.time
    switch (event.type) {
      case 'step/start':
        openStep = { turn: event.data.turn, step: event.data.step, startTime: event.time }
        break
      case 'assistant/chunk':
        if (openStep !== undefined
          && openStep.turn === event.data.turn
          && openStep.step === event.data.step
          && openStep.firstTokenTime === undefined
          && isTokenDelta(event.data.chunk)) {
          openStep.firstTokenTime = event.time
        }
        break
      case 'assistant/message': {
        const usage = event.data.usage
        if (usage !== undefined) {
          const read = usage.cacheReadTokens ?? 0
          const write = usage.cacheWriteTokens ?? 0
          const billedInput = usage.inputTokens + read + write
          inputTokens += billedInput
          outputTokens += usage.outputTokens
          cacheReadTokens += read
          cacheWriteTokens += write
          contextTokens = billedInput + usage.outputTokens
        }
        if (openStep === undefined || openStep.turn !== event.data.turn || openStep.step !== event.data.step) break
        llmMs += Math.max(0, event.time - openStep.startTime)
        if (openStep.firstTokenTime !== undefined) {
          ttftMs += Math.max(0, openStep.firstTokenTime - openStep.startTime)
          ttftSteps += 1
          if (usage !== undefined) {
            decodeMs += Math.max(0, event.time - openStep.firstTokenTime)
            decodeTokens += usage.outputTokens
          }
        }
        openStep = undefined
        break
      }
      case 'tool/call':
        pendingCalls.set(event.data.callId, event.time)
        break
      case 'tool/result': {
        const source = event.data.message.source
        if (source.kind !== 'tool') break
        const dispatched = pendingCalls.get(source.callId)
        if (dispatched === undefined) break
        toolMs += Math.max(0, event.time - dispatched)
        pendingCalls.delete(source.callId)
        break
      }
      case 'step/end':
        turns += lastTurn === event.data.turn ? 0 : 1
        steps += 1
        lastTurn = event.data.turn
        openStep = undefined
        break
      case 'turn/end':
        pendingCalls.clear()
        break
    }
  }
  const projectedStats = projection?.sessionStats
  const projectedUsage = projection?.tokenUsage
  const pressure = projection?.contextPressure
  const projectedInput = projectedUsage === undefined
    ? undefined
    : projectedUsage.uncachedInputTokens + projectedUsage.cacheReadTokens + projectedUsage.cacheWriteTokens
  const projectedContext = pressure?.projectedTokens ?? pressure?.pressureTokens ?? contextTokens
  const projectedWindow = pressure?.contextWindow ?? contextWindow
  return {
    turns: projectedStats?.turns ?? turns,
    steps: projectedStats?.steps ?? steps,
    llmMs: projectedStats?.llmMs ?? llmMs,
    toolMs: projectedStats?.toolMs ?? toolMs,
    ttftMs: projectedStats?.ttftMs ?? ttftMs,
    ttftSteps: projectedStats?.ttftSteps ?? ttftSteps,
    decodeMs: projectedStats?.decodeMs ?? decodeMs,
    decodeTokens: projectedStats?.decodeTokens ?? decodeTokens,
    inputTokens: projectedInput ?? inputTokens,
    outputTokens: projectedUsage?.outputTokens ?? outputTokens,
    cacheReadTokens: projectedUsage?.cacheReadTokens ?? cacheReadTokens,
    cacheWriteTokens: projectedUsage?.cacheWriteTokens ?? cacheWriteTokens,
    ...(projectedContext === undefined ? {} : { contextTokens: projectedContext }),
    ...(projectedWindow === undefined ? {} : { contextWindow: projectedWindow }),
    ...(first === undefined || last === undefined ? {} : { elapsedMs: Math.max(0, last - first) }),
  }
}

function explicitSessionTitle(events: readonly SessionEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type === 'session/title') return event.data.title
  }
  return undefined
}

function humanMessageText(event: SessionEvent): string | undefined {
  if (event.type !== 'user/message' || event.data.source.kind !== 'user') return undefined
  const text = event.data.content
    .filter((block): block is Extract<(typeof event.data.content)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return text === '' ? undefined : text
}

/** Title and latest-human-message preview for durable session discovery. */
export function recentSessionContent(events: readonly SessionEvent[]): { title: string; preview?: string } | undefined {
  const generatedTitle = explicitSessionTitle(events)
  const firstMessage = events.map(humanMessageText).find((text): text is string => text !== undefined)
  if (firstMessage === undefined) return undefined
  let lastMessage: string | undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    lastMessage = humanMessageText(events[index] as SessionEvent)
    if (lastMessage !== undefined) break
  }
  const title = generatedTitle ?? firstMessage
  return {
    title,
    ...(lastMessage === undefined || lastMessage === title ? {} : { preview: lastMessage }),
  }
}

function recentSessionStatus(events: readonly SessionEvent[]): TuiRecentSession['status'] {
  const end = events.findLast(event => event.type === 'turn/end')
  if (end?.type !== 'turn/end') return undefined
  if (end.data.reason.kind === 'completed') return 'done'
  if (end.data.reason.kind === 'error') return 'failed'
  if (end.data.reason.kind === 'blocked' || end.data.reason.kind === 'max-tokens') return 'blocked'
  return 'interrupted'
}

/** Convert the human-visible part of a skill catalog into slash commands. */
export function userSkillCommands(skills: readonly SkillSummary[]): TuiCommand[] {
  return skills.filter(isUserInvocable).map(skill => ({
    name: `skill:${skill.name}`,
    description: compactDescription(skill.description),
  }))
}

function skillNameFromCommand(name: string): string {
  return name.startsWith('skill:') ? name.slice('skill:'.length) : name
}

function compactDescription(value: string, maxLength: number = 140): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength - 1).trimEnd() + '…'
}

/** Own one switchable top-level Agent and project it onto a TuiService. */
export class SessionRuntime {
  readonly #ctx: Context
  readonly #tui: TuiService
  #active: ActiveSession | undefined
  #recent: TuiRecentSession[] = []
  #skillCommands: TuiCommand[] = []
  #started = false
  readonly #retired: AgentHandle[] = []
  #disposed = false
  readonly #off: Array<() => void> = []

  constructor(ctx: Context, tui: TuiService) {
    this.#ctx = ctx
    this.#tui = tui
    this.#off.push(ctx.on('agent/status', (payload) => {
      if (payload.agent === this.#active?.handle.agent) tui.setStatus(payload.status)
    }))
    this.#off.push(ctx.on('session/event', (session, event) => {
      const active = this.#active
      if (active === undefined || session !== active.handle.agent.session) return
      tui.event(event, ctx.get('tuiToolPresentation')?.event(active.handle.agent, event))
      this.#pushSessionInfo()
      if (event.type === 'session/title') void this.refreshRecent()
    }))
    if (ctx.get('commands') !== undefined) {
      this.#off.push(ctx.on('commands/change', () => { this.#pushCommands() }))
    }
    if (ctx.get('skills') !== undefined) {
      this.#off.push(ctx.on('skills/change', () => { void this.#refreshSkills() }))
    }
    if (ctx.get('tools') !== undefined) {
      this.#off.push(ctx.on('tools/change', () => {
        this.#pushTools()
        const active = this.#active
        if (active !== undefined) this.#replaceTranscript(active.handle.agent)
      }))
    }
    const projections = ctx.get('sessionProjections')
    if (projections !== undefined) {
      this.#off.push(projections.onChanged((session, key) => {
        if (session !== this.#active?.handle.agent.session) return
        if (key === 'sessionStats' || key === 'tokenUsage' || key === 'contextPressure'
          || key === 'plan' || key === 'permissions') this.#pushSessionInfo()
      }))
    }
  }

  get agent(): Agent | undefined {
    return this.#active?.handle.agent
  }

  async start(): Promise<void> {
    if (this.#started) return
    this.#started = true
    const defaults = this.#ctx.get('agentDefaultModel')?.currentSelection()
    if (defaults === undefined) throw new Error('agent default model is unavailable')
    await this.#activate(await this.#create(defaults))
    await this.refreshRecent()
  }

  /** Submit ordinary human text; active turns retain it as a later follow-up. */
  send(text: string, agent: Agent = this.#requiredAgent()): void {
    this.assertActive(agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  }

  /** Execute a plugin-owned slash command, falling back to user-invocable skills. */
  async execute(line: string, signal: AbortSignal): Promise<boolean> {
    const parsed = parseControl(line)
    if (parsed === undefined) return false
    const commands = this.#ctx.get('commands')
    const execution = await (async () => {
      try {
        return await commands?.execute(this.#requiredAgent(), line, signal)
      } finally {
        await this.#disposeRetired()
      }
    })()
    if (execution === undefined) {
      const skill = await this.#findUserSkill(skillNameFromCommand(parsed.name), signal)
      if (skill === undefined) return false
      this.send('/' + skill.name + (parsed.input === '' ? '' : ' ' + parsed.input))
      return true
    }
    const result = execution.result
    if (result.text !== undefined) {
      if (result.kind === 'error') this.#tui.notice(result.text, 'error')
      else this.#tui.commandOutput(parsed.name, result.text)
    }
    return true
  }

  /** Fail when a command invocation targets a stale or background Agent. */
  assertActive(agent: Agent): void {
    if (agent !== this.#requiredAgent()) throw new Error('the command does not target the active omdsh session')
  }

  /** Immutable recent-session view used by the resume command. */
  get recentSessions(): readonly TuiRecentSession[] {
    return this.#recent
  }

  /** Current model selection for the active Agent. */
  selection(agent: Agent = this.#requiredAgent()): ModelSelection {
    this.assertActive(agent)
    const current = this.#requiredActive().selection.current
    if (current === undefined) throw new Error('active agent has no model selection')
    return current
  }

  /** Replace the active Agent's selection and persist it as the next default. */
  async changeSelection(agent: Agent, selection: ModelSelection, info?: LlmResolvedModelInfo): Promise<void> {
    this.assertActive(agent)
    const active = this.#requiredActive()
    active.selection.current = selection
    const resolved = info ?? await this.#resolveModelInfo(selection)
    active.contextWindow = resolved?.context?.contextWindow
    const status = modelStatus(selection, resolved)
    active.reasoningEffort = status.reasoningEffort
    this.#tui.setModel(status.model, status.reasoningEffort)
    this.#pushSessionInfo()
    await this.#ctx.get('agentDefaultModel')?.saveSelection(selection)
  }

  /** Start a new top-level session with the current model selection. */
  async newSession(agent: Agent): Promise<void> {
    this.assertActive(agent)
    await this.#activate(await this.#create(this.selection(agent)))
    await this.refreshRecent()
  }

  /** Replace the active top-level session with one durable session. */
  async resumeSession(agent: Agent, id: string, signal: AbortSignal): Promise<void> {
    this.assertActive(agent)
    const selection = this.selection(agent)
    const ref: ModelSelectionRef = { current: selection, assembled: undefined }
    const handle = await this.#ctx.agents.resume({
      resumeSessionId: SessionId(id),
      agentOptions: { provider: selection.provider, model: selection.model },
      signal,
      setup: agentCtx => { installModelSelection(agentCtx, ref) },
    })
    await this.#activate({ handle, selection: ref, contextWindow: undefined, reasoningEffort: undefined })
    await this.refreshRecent()
  }

  /** Whole-session figures for the active Agent. */
  stats(agent: Agent = this.#requiredAgent()): TuiSessionStats {
    this.assertActive(agent)
    return this.#stats(this.#requiredActive())
  }

  /** Effective reasoning effort after applying the selected model's adapter default. */
  reasoningEffort(agent: Agent = this.#requiredAgent()): string | undefined {
    this.assertActive(agent)
    return this.#requiredActive().reasoningEffort
  }

  /** Harness-owned collaboration and permission controls for the active Agent. */
  controls(agent: Agent = this.#requiredAgent()): TuiSessionControls {
    this.assertActive(agent)
    return sessionControls(this.#projection(this.#requiredActive()))
  }

  async refreshRecent(): Promise<void> {
    const persistence = this.#ctx.get('sessionPersistence')
    if (persistence === undefined) {
      this.#recent = []
      this.#pushSessionInfo()
      return
    }
    const headers = (await persistence.list()).filter(header => header.origin !== 'subagent')
      .sort((left, right) => right.createdAt - left.createdAt)
    const rows: TuiRecentSession[] = []
    for (const header of headers) {
      try {
        const inspected = await persistence.inspect(header.id)
        const status = recentSessionStatus(inspected.events)
        const content = recentSessionContent(inspected.events)
        if (content === undefined) continue
        rows.push({
          id: header.id,
          ...content,
          createdAt: header.createdAt,
          updatedAt: inspected.events.at(-1)?.time ?? header.createdAt,
          eventCount: inspected.events.length,
          ...(status === undefined ? {} : { status }),
        })
        if (rows.length >= 8) break
      } catch {
        rows.push({ id: header.id, title: '(unavailable session)', createdAt: header.createdAt })
        if (rows.length >= 8) break
      }
    }
    this.#recent = rows
    this.#pushSessionInfo()
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    for (const off of this.#off.splice(0).reverse()) off()
    await Promise.allSettled(this.#retired.splice(0).map(handle => handle.dispose()))
    await this.#active?.handle.dispose()
    this.#active = undefined
  }

  async #create(selection: ModelSelection): Promise<ActiveSession> {
    const ref: ModelSelectionRef = { current: selection, assembled: undefined }
    const handle = await this.#ctx.agents.create({
      sessionId: SessionId('session-' + randomUUID()),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: agentCtx => { installModelSelection(agentCtx, ref) },
    })
    return { handle, selection: ref, contextWindow: undefined, reasoningEffort: undefined }
  }

  async #resolveModelInfo(selection: ModelSelection): Promise<LlmResolvedModelInfo | undefined> {
    try {
      return await this.#ctx.get('llm')?.resolveModelInfo(selection.provider, selection.model)
    } catch {
      return undefined
    }
  }

  async #activate(next: ActiveSession): Promise<void> {
    const previous = this.#active
    this.#active = next
    const agent = next.handle.agent
    this.#tui.setStatus(agent.status)
    this.#replaceTranscript(agent)
    this.#pushTools()
    const selected = this.selection(agent)
    const info = await this.#resolveModelInfo(selected)
    next.contextWindow = info?.context?.contextWindow
    const status = modelStatus(selected, info)
    next.reasoningEffort = status.reasoningEffort
    this.#tui.setModel(status.model, status.reasoningEffort)
    await this.#refreshSkills()
    this.#pushSessionInfo()
    if (previous !== undefined) this.#retired.push(previous.handle)
  }

  #pushCommands(): void {
    const agent = this.agent
    const runtime = agent === undefined ? [] : (this.#ctx.get('commands')?.list(agent) ?? [])
    const commands: TuiCommand[] = runtime.map(command => ({
      name: command.name,
      description: command.description,
      ...(command.input?.hint === undefined ? {} : { inputHint: command.input.hint }),
    }))
    const names = new Set(commands.map(command => command.name))
    for (const skill of this.#skillCommands) {
      if (names.has(skill.name)) continue
      commands.push(skill)
      names.add(skill.name)
    }
    this.#tui.setCommands(commands)
  }

  #pushTools(): void {
    const agent = this.agent
    const tools = agent === undefined
      ? []
      : (this.#ctx.get('tools')?.schemas(agent).map(schema => ({
          name: schema.name,
          description: schema.description,
        })) ?? [])
    this.#tui.setTools(tools)
  }

  async #refreshSkills(signal?: AbortSignal): Promise<void> {
    const agent = this.agent
    const skills = this.#ctx.get('skills')
    if (agent === undefined || skills === undefined) {
      this.#skillCommands = []
    } else {
      const list = await skills.list({ cwd: agent.session.header.cwd, scope: agent, signal })
      this.#skillCommands = userSkillCommands(list)
    }
    this.#pushCommands()
  }

  async #findUserSkill(name: string, signal: AbortSignal): Promise<SkillSummary | undefined> {
    const agent = this.#requiredAgent()
    const skills = this.#ctx.get('skills')
    if (skills === undefined) return undefined
    const list = await skills.list({ cwd: agent.session.header.cwd, scope: agent, signal })
    return list.find(skill => skill.name === name && isUserInvocable(skill))
  }

  #pushSessionInfo(): void {
    const active = this.#active
    if (active === undefined) return
    const agent = active.handle.agent
    const projection = this.#projection(active)
    this.#tui.setSession({
      id: agent.id,
      recent: this.#recent.filter(row => row.id !== agent.id),
      stats: this.#stats(active, projection),
      controls: sessionControls(projection),
    })
  }

  #replaceTranscript(agent: Agent): void {
    const events = agent.session.events
    this.#tui.replaceSession(events, this.#ctx.get('tuiToolPresentation')?.session(agent, events))
  }

  /** Read one consistent projection cut, with the complete-log fold as fallback. */
  #projection(active: ActiveSession): TuiStatsProjection | undefined {
    return this.#ctx.get('sessionProjections')?.snapshot(active.handle.agent.session).values
  }

  #stats(active: ActiveSession, projection: TuiStatsProjection | undefined = this.#projection(active)): TuiSessionStats {
    const agent = active.handle.agent
    return sessionStats(agent.session.events, active.contextWindow, projection)
  }

  #requiredActive(): ActiveSession {
    if (this.#active === undefined) throw new Error('no active session')
    return this.#active
  }

  #requiredAgent(): Agent {
    return this.#requiredActive().handle.agent
  }

  async #disposeRetired(): Promise<void> {
    await Promise.allSettled(this.#retired.splice(0).map(handle => handle.dispose()))
  }
}
