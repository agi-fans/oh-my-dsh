/**
 * Active-agent/session runtime shared by the runner and command plugins.
 *
 * This is the deep module between Harness runtime services and the TUI:
 * Agent creation, replacement, persistence lookup, model selection, recent
 * sessions, projections, command routing, and cleanup stay behind one API.
 * @module @agi-fans/dsh-tui/session-controller
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
import { resolveSessionPreset, type AgentPreset } from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage, type LlmResolvedModelInfo, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-attachment'
import { isTokenDelta } from '@deepseek-ai/dsh-llm/message'
import type {} from '@deepseek-ai/dsh-commands'
import type { PermissionSelect } from '@deepseek-ai/dsh-permission-presets/types'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type { PlanProjection } from '@deepseek-ai/dsh-plan-mode/types'
import { isUserInvocable, type SkillSummary } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats/types'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-title'
import type { ContextPressureProjection, TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import type { ToolPresentationMode } from '@deepseek-ai/dsh-tools'
import type {
  TuiCommand,
  TuiInspectedSubagent,
  TuiRecentSession,
  TuiService,
  TuiSessionControls,
  TuiSessionStats,
  TuiSubmission,
} from '../definition.ts'
import { descendantDepth, isSteerableSubagent, SubagentRoster } from './subagent-roster.ts'
import type {} from '../runtime/tool-presentation.ts'
import * as commandPermission from '../commands/permission.ts'
import {
  defaultToolPresentation,
  isBlankSession,
  resolveToolPresentation,
  type SessionConfiguration,
} from './session-configuration.ts'

interface ActiveSession {
  handle: AgentHandle
  selection: ModelSelectionRef
  contextWindow: number | undefined
  reasoningEffort: string | undefined
  configuration: SessionConfiguration
  disposeToolPresentation: () => void
}

interface ConfiguredAgentContext extends SessionConfiguration {
  disposeToolPresentation: () => void
}

async function setupAgentContext(agentCtx: Context, selection: ModelSelectionRef): Promise<ConfiguredAgentContext> {
  installModelSelection(agentCtx, selection)
  const agent = agentCtx.agent
  if (agent === undefined) throw new Error('agent setup context has no agent')
  const agentPresets = agentCtx.get('agentPresets')
  const tools = agentCtx.get('tools')
  if (agentPresets === undefined || tools === undefined) throw new Error('agent configuration services are unavailable')
  const agentPreset = resolveSessionPreset(agent.session) ?? agentPresets.defaultId
  const mounted = await agentPresets.mount(agentCtx, agentPreset)
  const presentation = resolveToolPresentation(agent.session.events, mounted.id)
  const disposeToolPresentation = tools.presentAs(presentation.tools)
  await agentCtx.plugin(commandPermission)
  return { agentPreset: mounted.id, ...presentation, disposeToolPresentation }
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
  const projectedStats = projection?.sessionStats
  const projectedUsage = projection?.tokenUsage
  const pressure = projection?.contextPressure
  const projectedContext = pressure?.projectedTokens ?? pressure?.pressureTokens
  const projectedWindow = pressure?.contextWindow ?? contextWindow
  if (projectedStats !== undefined && projectedUsage !== undefined && projectedContext !== undefined) {
    const first = events[0]?.time
    const last = events[events.length - 1]?.time
    return {
      ...projectedStats,
      inputTokens: projectedUsage.uncachedInputTokens
        + projectedUsage.cacheReadTokens
        + projectedUsage.cacheWriteTokens,
      outputTokens: projectedUsage.outputTokens,
      cacheReadTokens: projectedUsage.cacheReadTokens,
      cacheWriteTokens: projectedUsage.cacheWriteTokens,
      contextTokens: projectedContext,
      ...(projectedWindow === undefined ? {} : { contextWindow: projectedWindow }),
      ...(first === undefined || last === undefined ? {} : { elapsedMs: Math.max(0, last - first) }),
    }
  }
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
  const projectedInput = projectedUsage === undefined
    ? undefined
    : projectedUsage.uncachedInputTokens + projectedUsage.cacheReadTokens + projectedUsage.cacheWriteTokens
  const fallbackContext = projectedContext ?? contextTokens
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
    ...(fallbackContext === undefined ? {} : { contextTokens: fallbackContext }),
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

/** One direct human turn that can become a safe fork boundary. */
export interface ConversationTurn {
  /** Harness turn number shown to the user. */
  turn: number
  /** Index of the direct user/message event in the immutable log. */
  messageIndex: number
  /** Balanced seed boundary immediately before this turn starts. */
  branchIndex: number
  /** Single-line selector preview. */
  preview: string
  /** Number of image blocks in the selected message. */
  imageCount: number
}

/** Find direct human messages whose preceding log prefix is safe to seed into a fork. */
export function conversationTurns(events: readonly SessionEvent[]): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  let open: { turn: number; branchIndex: number } | undefined
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'turn/start') {
      open = { turn: event.data.turn, branchIndex: index }
      continue
    }
    if (event.type === 'turn/end') {
      if (open?.turn === event.data.turn) open = undefined
      continue
    }
    if (open === undefined || event.type !== 'user/message' || event.data.source.kind !== 'user') continue
    const text = event.data.content
      .filter((block): block is Extract<(typeof event.data.content)[number], { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .replace(/\s+/gu, ' ')
      .trim()
    const imageCount = event.data.content.filter(block => block.type === 'image').length
    if (text === '' && imageCount === 0) continue
    turns.push({
      turn: open.turn,
      messageIndex: index,
      branchIndex: open.branchIndex,
      preview: text === '' ? (imageCount === 1 ? 'Image' : `${imageCount} images`) : text,
      imageCount,
    })
  }
  return turns
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

interface SubmissionAttachmentStore {
  validateImage(input: SaveImageAttachment): Promise<void>
  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>
}

interface RestoreAttachmentStore {
  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>
}

/** Validate all drafts, persist them, then build one atomic mixed user message. */
export async function createSubmissionMessage(
  submission: TuiSubmission,
  attachments?: SubmissionAttachmentStore,
) {
  const inputs: SaveImageAttachment[] = submission.images.map(image => ({
    data: image.data,
    mediaType: image.mediaType,
    ...(image.name === undefined ? {} : { name: image.name }),
  }))
  if (inputs.length > 0 && attachments === undefined) throw new Error('Attachment storage is not configured.')
  const refs: ImageAttachmentRef[] = []
  if (attachments !== undefined) {
    for (const input of inputs) await attachments.validateImage(input)
    for (const input of inputs) refs.push(await attachments.saveImage(input))
  }
  const content = [
    ...(submission.text === '' ? [] : [{ type: 'text' as const, text: submission.text }]),
    ...refs.map(attachment => ({ type: 'image' as const, attachment })),
  ]
  if (content.length === 0) throw new Error('Cannot submit an empty message.')
  return createUserMessage({ content, source: { kind: 'user' } })
}

/** Rehydrate one durable human inbox message into an editable composer draft. */
export async function restoreSubmissionMessage(
  message: UserMessage,
  attachments?: RestoreAttachmentStore,
): Promise<TuiSubmission> {
  const text = message.content
    .filter((block): block is Extract<(typeof message.content)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  const refs = message.content
    .filter((block): block is Extract<(typeof message.content)[number], { type: 'image' }> => block.type === 'image')
    .map(block => block.attachment)
  if (refs.length > 0 && attachments === undefined) {
    throw new Error('The queued message contains images, but attachment storage is unavailable.')
  }
  const images = await Promise.all(refs.map(async (ref) => {
    const stored = await attachments?.readImage(ref)
    if (stored === undefined) throw new Error('Unable to restore an image from the queued message.')
    return {
      data: stored.data,
      mediaType: stored.ref.mediaType,
      ...(stored.ref.name === undefined ? {} : { name: stored.ref.name }),
      width: stored.ref.width,
      height: stored.ref.height,
    }
  }))
  return { text, images }
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
  readonly #subagents = new SubagentRoster()
  #subagentEpoch = 0
  #inspectEpoch = 0
  #inspectedId: string | undefined

  constructor(ctx: Context, tui: TuiService) {
    this.#ctx = ctx
    this.#tui = tui
    this.#off.push(tui.onInspectSubagent(id => { void this.#inspectSubagent(id) }))
    this.#off.push(tui.onInspectClose(() => { this.#closeInspect() }))
    this.#off.push(tui.onInspectSubmit(submission => { void this.#steerInspected(submission) }))
    this.#off.push(ctx.on('agent/status', (payload) => {
      if (payload.agent === this.#active?.handle.agent) {
        if (this.#inspectedId === undefined) tui.setStatus(payload.status)
        return
      }
      if (payload.agent.id === this.#inspectedId) tui.setStatus(payload.status)
      this.#noteSubagentStatus(payload.agent.session, payload.status)
    }))
    this.#off.push(ctx.on('session/created', (session) => {
      this.#noteSubagentSession(session)
    }))
    this.#off.push(ctx.on('session/disposed', (session) => {
      if (!this.#subagents.owns(session.id)) return
      this.#subagents.setAgentStatus(session.id, 'gone')
      this.#pushSubagents()
    }))
    this.#off.push(ctx.on('session/event', (session, event) => {
      const active = this.#active
      if (active === undefined) return
      if (session.id === this.#inspectedId) {
        const child = ctx.get('agents')?.get(session.id)
        tui.event(event, child === undefined ? undefined : ctx.get('tuiToolPresentation')?.event(child, event))
        this.#noteSubagentEvent(session, event)
        return
      }
      if (session === active.handle.agent.session) {
        if (this.#inspectedId === undefined) {
          tui.event(event, ctx.get('tuiToolPresentation')?.event(active.handle.agent, event))
        }
        this.#pushSessionInfo()
        if (event.type === 'session/title') void this.refreshRecent()
        return
      }
      this.#noteSubagentEvent(session, event)
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
        if (active !== undefined) this.#replaceVisibleTranscript()
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

  /**
   * Interrupt the visible continuable child when one is inspected.
   * @returns true when this consumed the gesture so the parent turn stays running.
   */
  interruptVisible(): boolean {
    if (this.#inspectedId === undefined) return false
    const root = this.#active?.handle.agent
    if (root !== undefined) {
      this.#ctx.get('subagents')?.interrupt(SessionId(this.#inspectedId), { kind: 'ancestor', agent: root })
    }
    return true
  }

  async start(): Promise<void> {
    if (this.#started) return
    this.#started = true
    const defaults = this.#ctx.get('agentDefaultModel')?.currentSelection()
    if (defaults === undefined) throw new Error('agent default model is unavailable')
    await this.#activate(await this.#create(defaults))
    await this.refreshRecent()
  }

  /** Submit one human composer value; active turns retain it as a later follow-up. */
  async send(input: string | TuiSubmission, agent: Agent = this.#requiredAgent()): Promise<void> {
    this.assertActive(agent)
    const submission = typeof input === 'string' ? { text: input, images: [] } : input
    const message = await createSubmissionMessage(submission, this.#ctx.get('attachments'))
    this.assertActive(agent)
    agent.followup(message)
  }

  /** Remove and rehydrate the newest durable human follow-up for queue browsing. */
  async editLatestFollowup(agent: Agent = this.#requiredAgent()): Promise<TuiSubmission | undefined> {
    this.assertActive(agent)
    const message = agent.inbox.nextTurn.findLast(candidate => candidate.source.kind === 'user')
    if (message === undefined || !agent.inbox.remove(message.id)) return undefined
    try {
      const submission = await restoreSubmissionMessage(message, this.#ctx.get('attachments'))
      this.assertActive(agent)
      return submission
    } catch (error: unknown) {
      try { agent.inbox.append('next-turn', message) } catch { /* agent retired or message was restored elsewhere */ }
      throw error
    }
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
      await this.send('/' + skill.name + (parsed.input === '' ? '' : ' ' + parsed.input))
      return true
    }
    const result = execution.result
    if (result.text !== undefined) {
      if (result.kind === 'error') this.#tui.notice(result.text, { level: 'error' })
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
    let configured: ConfiguredAgentContext | undefined
    const handle = await this.#ctx.agents.resume({
      resumeSessionId: SessionId(id),
      agentOptions: { provider: selection.provider, model: selection.model },
      signal,
      setup: async (agentCtx) => { configured = await setupAgentContext(agentCtx, ref) },
    })
    const configuration = configured
    if (configuration === undefined) {
      await handle.dispose()
      throw new Error('resumed agent was published without session configuration')
    }
    this.#pinToolPresentation(handle.agent, configuration)
    await this.#activate({
      handle,
      selection: ref,
      contextWindow: undefined,
      reasoningEffort: undefined,
      configuration: {
        agentPreset: configuration.agentPreset,
        tools: configuration.tools,
        toolsSource: configuration.toolsSource,
      },
      disposeToolPresentation: configuration.disposeToolPresentation,
    })
    await this.refreshRecent()
  }

  /** Fork before a selected human turn and restore that message as an editable draft. */
  async rewindToTurn(signal: AbortSignal): Promise<void> {
    const agent = this.#requiredAgent()
    if (agent.status !== 'idle') return
    const events = agent.session.events
    const turns = conversationTurns(events)
    if (turns.length === 0) {
      this.#tui.notice('No conversation turns are available to rewind.')
      return
    }
    const newestFirst = [...turns].reverse()
    const answer = await this.#tui.prompt({
      title: 'Rewind Conversation',
      question: '',
      detail: 'original session preserved',
      options: newestFirst.map(turn => ({
        label: `Turn ${turn.turn}`,
        value: String(turn.messageIndex),
        preview: turn.preview,
        description: turn.imageCount === 0
          ? 'Branch before this message'
          : `Branch before this message · ${turn.imageCount} ${turn.imageCount === 1 ? 'image' : 'images'}`,
      })),
      initialValue: String(newestFirst[0]?.messageIndex),
      presentation: 'fullscreen-list',
      optionLayout: 'spacious',
      filterable: true,
      allowCustom: false,
      submitLabel: 'rewind',
      signal,
    })
    if (answer === null) return
    this.assertActive(agent)
    if (agent.status !== 'idle') throw new Error('Finish or interrupt the active turn before rewinding.')
    const selected = turns.find(turn => String(turn.messageIndex) === answer)
    if (selected === undefined) throw new Error('The selected conversation turn is no longer available.')
    const message = events[selected.messageIndex]
    if (message?.type !== 'user/message' || message.data.source.kind !== 'user') {
      throw new Error('The selected conversation turn is no longer available.')
    }
    const text = message.data.content
      .filter((block): block is Extract<(typeof message.data.content)[number], { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    const imageRefs = message.data.content
      .filter((block): block is Extract<(typeof message.data.content)[number], { type: 'image' }> => block.type === 'image')
      .map(block => block.attachment)
    const attachments = this.#ctx.get('attachments')
    if (imageRefs.length > 0 && attachments === undefined) {
      throw new Error('The selected message contains images, but attachment storage is unavailable.')
    }
    const images = await Promise.all(imageRefs.map(async (ref) => {
      const stored = await attachments?.readImage(ref, signal)
      if (stored === undefined) throw new Error('Unable to restore an image from the selected message.')
      return {
        data: stored.data,
        mediaType: stored.ref.mediaType,
        ...(stored.ref.name === undefined ? {} : { name: stored.ref.name }),
        width: stored.ref.width,
        height: stored.ref.height,
      }
    }))
    this.assertActive(agent)
    const selection = this.selection(agent)
    const ref: ModelSelectionRef = { current: selection, assembled: undefined }
    const active = this.#requiredActive()
    let configured: ConfiguredAgentContext | undefined
    const handle = await this.#ctx.agents.create({
      sessionId: SessionId('session-' + randomUUID()),
      seed: events.slice(0, selected.branchIndex),
      meta: {
        ...(agent.session.header.cwd === undefined ? {} : { cwd: agent.session.header.cwd }),
        parentSession: agent.id,
        seedLength: selected.branchIndex,
        agentPreset: active.configuration.agentPreset,
      },
      agentOptions: { provider: selection.provider, model: selection.model },
      signal,
      setup: async (agentCtx) => { configured = await setupAgentContext(agentCtx, ref) },
    })
    try {
      this.assertActive(agent)
    } catch (error: unknown) {
      await handle.dispose()
      throw error
    }
    const configuration = configured
    if (configuration === undefined) {
      await handle.dispose()
      throw new Error('forked agent was published without session configuration')
    }
    this.#pinToolPresentation(handle.agent, configuration)
    await this.#activate({
      handle,
      selection: ref,
      contextWindow: undefined,
      reasoningEffort: undefined,
      configuration: {
        agentPreset: configuration.agentPreset,
        tools: configuration.tools,
        toolsSource: configuration.toolsSource,
      },
      disposeToolPresentation: configuration.disposeToolPresentation,
    })
    this.#tui.restoreInput({ text, images })
    this.#tui.notice(`Rewound to before turn ${selected.turn}. The original session remains available in /resume.`)
    await this.#disposeRetired()
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

  /** Harness-owned workflow/access state plus creation-time Agent/tool configuration. */
  controls(agent: Agent = this.#requiredAgent()): TuiSessionControls {
    this.assertActive(agent)
    const active = this.#requiredActive()
    return this.#sessionControls(active, this.#projection(active))
  }

  /** Agent presets available from the live Harness roster. */
  async agentPresets(): Promise<readonly AgentPreset[]> {
    return (await this.#ctx.agentPresets.list()).sort((left, right) =>
      (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id))
  }

  /** Recompose one blank session and restore that preset's recommended tool presentation. */
  async changeAgentPreset(agent: Agent, id: string): Promise<SessionConfiguration> {
    this.assertActive(agent)
    if (!isBlankSession(agent.session)) {
      throw new Error('Agent is locked after the first prompt. Start /new, then choose the Agent before sending a message.')
    }
    const active = this.#requiredActive()
    if (active.configuration.agentPreset === id) return { ...active.configuration }
    const previousPreset = active.configuration.agentPreset
    const preset = await this.#ctx.agentPresets.recompose(agent.ctx, id)
    try {
      this.#replaceToolPresentation(active, defaultToolPresentation(preset.id), 'preset-default')
    } catch (error: unknown) {
      await this.#ctx.agentPresets.recompose(agent.ctx, previousPreset)
      throw error
    }
    active.configuration.agentPreset = preset.id
    agent.session.append('agent-preset/selected', { agentPreset: preset.id })
    this.#pushTools()
    this.#pushCommands()
    await this.#refreshSkills()
    this.#replaceTranscript(agent)
    this.#pushSessionInfo()
    return { ...active.configuration }
  }

  /** Change how one blank session exposes its real Harness tool registry to the model. */
  changeToolPresentation(agent: Agent, mode: ToolPresentationMode): SessionConfiguration {
    this.assertActive(agent)
    if (!isBlankSession(agent.session)) {
      throw new Error('Tools are locked after the first prompt. Start /new, then choose the tool presentation before sending a message.')
    }
    const active = this.#requiredActive()
    if (active.configuration.tools !== mode || active.configuration.toolsSource !== 'user') {
      this.#replaceToolPresentation(active, mode, 'user')
      this.#pushTools()
      this.#replaceTranscript(agent)
      this.#pushSessionInfo()
    }
    return { ...active.configuration }
  }

  /** Select the Harness Plan Mode controller and immediately refresh terminal state. */
  changeWorkflow(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop' {
    this.assertActive(agent)
    const planMode = this.#ctx.get('planMode')
    if (planMode === undefined) throw new Error('Plan workflow is not configured.')
    const outcome = planMode.set(agent, active)
    this.#pushSessionInfo()
    return outcome
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
    this.#subagentEpoch += 1
    this.#inspectedId = undefined
    this.#subagents.reset()
    this.#tui.setInspectedSubagent(undefined)
    this.#tui.setSubagents(undefined)
    for (const off of this.#off.splice(0).reverse()) off()
    await Promise.allSettled(this.#retired.splice(0).map(handle => handle.dispose()))
    await this.#active?.handle.dispose()
    this.#active = undefined
  }

  async #create(selection: ModelSelection): Promise<ActiveSession> {
    const ref: ModelSelectionRef = { current: selection, assembled: undefined }
    const preset = await this.#ctx.agentPresets.resolve()
    let configured: ConfiguredAgentContext | undefined
    const handle = await this.#ctx.agents.create({
      sessionId: SessionId('session-' + randomUUID()),
      meta: { cwd: process.cwd(), agentPreset: preset.id },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: async (agentCtx) => { configured = await setupAgentContext(agentCtx, ref) },
    })
    const configuration = configured
    if (configuration === undefined) {
      await handle.dispose()
      throw new Error('created agent was published without session configuration')
    }
    this.#pinToolPresentation(handle.agent, configuration)
    return {
      handle,
      selection: ref,
      contextWindow: undefined,
      reasoningEffort: undefined,
      configuration: {
        agentPreset: configuration.agentPreset,
        tools: configuration.tools,
        toolsSource: configuration.toolsSource,
      },
      disposeToolPresentation: configuration.disposeToolPresentation,
    }
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
    this.#inspectedId = undefined
    this.#tui.setInspectedSubagent(undefined)
    this.#tui.setStatus(agent.status)
    this.#syncSubagents()
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

  #lookupSession = (id: string): Session | undefined => this.#ctx.get('sessions')?.get(SessionId(id))

  #subagentDepth(session: Session): number | undefined {
    const rootId = this.#active?.handle.agent.id
    if (rootId === undefined) return undefined
    return descendantDepth(session, rootId, this.#lookupSession)
  }

  #noteSubagentSession(session: Session): void {
    const depth = this.#subagentDepth(session)
    if (depth === undefined) return
    const parentId = session.header.parentSession
    this.#subagents.remember({
      id: session.id,
      ...(parentId === undefined ? {} : { parentId }),
      depth,
      phase: this.#ctx.get('agents')?.get(session.id)?.status === 'running' ? 'running' : 'starting',
    })
    this.#pushSubagents()
  }

  #noteSubagentEvent(session: Session, event: SessionEvent): void {
    const depth = this.#subagentDepth(session)
    if (depth === undefined) return
    this.#subagents.apply(session, depth, event, this.#ctx.get('agents')?.get(session.id)?.status)
    this.#pushSubagents()
  }

  #noteSubagentStatus(session: Session, status: 'idle' | 'running'): void {
    if (this.#subagents.owns(session.id)) {
      this.#subagents.setAgentStatus(session.id, status)
      this.#pushSubagents()
      return
    }
    const depth = this.#subagentDepth(session)
    if (depth === undefined) return
    this.#subagents.hydrate(session, depth, this.#ctx.get('agents')?.get(session.id)?.status ?? status)
    this.#pushSubagents()
  }

  #syncSubagents(): void {
    const root = this.#active?.handle.agent
    const epoch = this.#subagentEpoch + 1
    this.#subagentEpoch = epoch
    if (root === undefined) {
      this.#subagents.reset()
      this.#tui.setSubagents(undefined)
      return
    }
    this.#subagents.reset(root.id)
    for (const session of this.#ctx.get('sessions')?.list() ?? []) {
      const depth = descendantDepth(session, root.id, this.#lookupSession)
      if (depth === undefined) continue
      this.#subagents.hydrate(session, depth, this.#ctx.get('agents')?.get(session.id)?.status)
    }
    this.#pushSubagents()
    const listed = this.#ctx.get('subagents')?.listChildren(root.id)
    if (listed === undefined) return
    void listed.then((entries) => {
      if (epoch !== this.#subagentEpoch || this.#active?.handle.agent !== root) return
      for (const entry of entries) {
        if (entry.kind !== 'child') continue
        this.#subagents.remember({
          id: entry.id,
          depth: 1,
          mode: entry.mode,
          ...(entry.label === undefined ? {} : { label: entry.label }),
          phase: entry.activity === 'running' ? 'running' : 'waiting',
        })
      }
      this.#pushSubagents()
    }, () => undefined)
  }

  #inspectView(id: string, fallbackPhase: TuiInspectedSubagent['phase'] = 'waiting'): TuiInspectedSubagent {
    const view = this.#subagents.snapshot()?.agents.find(agent => agent.id === id)
    const mode = view?.mode
    return {
      id,
      label: view?.label ?? id,
      phase: view?.phase ?? fallbackPhase,
      ...(mode === undefined ? {} : { mode }),
      writable: isSteerableSubagent(mode),
    }
  }

  #pushSubagents(): void {
    this.#tui.setSubagents(this.#subagents.snapshot())
    if (this.#inspectedId === undefined) return
    this.#tui.setInspectedSubagent(this.#inspectView(this.#inspectedId))
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
      controls: this.#sessionControls(active, projection),
    })
  }

  #pinToolPresentation(agent: Agent, configuration: SessionConfiguration): void {
    const selected = resolveToolPresentation(agent.session.events, configuration.agentPreset)
    if (agent.session.events.some(event => event.type === 'omdsh/tools-selected')) return
    agent.session.append('omdsh/tools-selected', {
      mode: selected.tools,
      source: selected.toolsSource,
    })
  }

  #replaceToolPresentation(
    active: ActiveSession,
    mode: ToolPresentationMode,
    source: SessionConfiguration['toolsSource'],
  ): void {
    const previousMode = active.configuration.tools
    active.disposeToolPresentation()
    try {
      const tools = active.handle.agent.ctx.get('tools')
      if (tools === undefined) throw new Error('tool registry is unavailable')
      active.disposeToolPresentation = tools.presentAs(mode)
    } catch (error: unknown) {
      const tools = active.handle.agent.ctx.get('tools')
      if (tools === undefined) throw error
      active.disposeToolPresentation = tools.presentAs(previousMode)
      throw error
    }
    active.configuration.tools = mode
    active.configuration.toolsSource = source
    active.handle.agent.session.append('omdsh/tools-selected', { mode, source })
  }

  #replaceTranscript(agent: Agent): void {
    const events = agent.session.events
    this.#tui.replaceSession(events, this.#ctx.get('tuiToolPresentation')?.session(agent, events))
  }

  #replaceVisibleTranscript(): void {
    if (this.#inspectedId !== undefined) {
      void this.#inspectSubagent(this.#inspectedId)
      return
    }
    const agent = this.#active?.handle.agent
    if (agent !== undefined) this.#replaceTranscript(agent)
  }

  #closeInspect(): void {
    if (this.#inspectedId === undefined) return
    this.#inspectEpoch += 1
    this.#inspectedId = undefined
    this.#tui.setInspectedSubagent(undefined)
    const agent = this.#active?.handle.agent
    if (agent === undefined) return
    this.#replaceTranscript(agent)
    this.#tui.setStatus(agent.status)
  }

  async #inspectSubagent(id: string): Promise<void> {
    const request = this.#inspectEpoch + 1
    this.#inspectEpoch = request
    if (!this.#subagents.owns(id)) {
      this.#tui.notice('That subagent is no longer available.', { level: 'error' })
      return
    }
    const live = this.#ctx.get('sessions')?.get(SessionId(id))
    let events: readonly SessionEvent[]
    if (live !== undefined) {
      events = live.events.slice(live.header.seedLength ?? 0)
    } else {
      try {
        const inspected = await this.#ctx.get('sessionPersistence')?.inspect(SessionId(id))
        if (inspected === undefined) throw new Error('subagent transcript is unavailable')
        events = inspected.events.slice(inspected.meta.seedLength ?? 0)
      } catch {
        if (request === this.#inspectEpoch) {
          this.#tui.notice('Unable to open that subagent transcript.', { level: 'error' })
        }
        return
      }
    }
    if (request !== this.#inspectEpoch) return
    this.#inspectedId = id
    const child = this.#ctx.get('agents')?.get(SessionId(id))
    this.#tui.replaceSession(
      events,
      child === undefined ? undefined : this.#ctx.get('tuiToolPresentation')?.session(child, events),
    )
    this.#tui.setInspectedSubagent(this.#inspectView(
      id,
      child?.status === 'running' ? 'running' : 'waiting',
    ))
    this.#tui.setStatus(child?.status ?? 'idle')
  }

  async #steerInspected(submission: TuiSubmission): Promise<void> {
    const childId = this.#inspectedId
    const root = this.#active?.handle.agent
    if (childId === undefined || root === undefined) {
      this.#tui.restoreInput(submission)
      return
    }
    const view = this.#inspectView(childId)
    if (!view.writable) {
      this.#tui.restoreInput(submission)
      this.#tui.notice('This subagent is a completed run and cannot take more messages.')
      return
    }
    const live = this.#ctx.get('sessions')?.get(SessionId(childId))
    const rosterParent = this.#subagents.snapshot()?.agents.find(agent => agent.id === childId)?.parentId
    const parentId = live?.header.parentSession ?? rosterParent
    const parent = parentId === undefined || parentId === root.id
      ? root
      : this.#ctx.get('agents')?.get(SessionId(parentId))
    const subagents = this.#ctx.get('subagents')
    if (parent === undefined || subagents === undefined) {
      this.#tui.restoreInput(submission)
      this.#tui.notice(parent === undefined
        ? 'The parent of this subagent is not live, so it cannot take a follow-up.'
        : 'Subagent follow-up is unavailable in this composition.')
      return
    }
    try {
      const message = await createSubmissionMessage(submission, this.#ctx.get('attachments'))
      if (this.#inspectedId !== childId || this.#active?.handle.agent !== root) {
        this.#tui.restoreInput(submission)
        return
      }
      await subagents.followup(parent, SessionId(childId), message.content, {
        source: { kind: 'user' },
        signal: new AbortController().signal,
      })
    } catch (error: unknown) {
      this.#tui.restoreInput(submission)
      this.#tui.notice(error instanceof Error ? error.message : String(error), { level: 'error' })
    }
  }

  #sessionControls(active: ActiveSession, projection: TuiStatsProjection | undefined): TuiSessionControls {
    const controls = sessionControls(projection)
    const livePlan = this.#ctx.get('planMode')?.get(active.handle.agent)
    return {
      ...controls,
      agentPreset: active.configuration.agentPreset,
      tools: active.configuration.tools,
      ...(livePlan === undefined
        ? {}
        : { plan: { active: livePlan.active, pending: livePlan.pending !== undefined } }),
    }
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
