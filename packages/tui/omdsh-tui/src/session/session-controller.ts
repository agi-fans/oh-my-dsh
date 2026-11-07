/**
 * Active-agent/session runtime shared by the runner and command plugins.
 *
 * This is the deep module between Harness runtime services and the TUI:
 * Agent creation, replacement, persistence lookup, model selection, recent
 * sessions, projections, command routing, and cleanup stay behind one API.
 * @module @agi-fans/dsh-tui/session-controller
 */

import { openGoalControls } from './goal-controls.ts'
import { continuableFailure } from './generation-continuation.ts'
import { workflowMemberStatus, workflowOptions } from '../views/workflow.ts'
import { randomUUID } from 'node:crypto'
import { openMessageQueue } from './message-queue.ts'
import { WorkflowProjection } from './workflow-projection.ts'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  type Agent,
  type AgentHandle,
  type ModelSelection,
} from '@deepseek-ai/dsh-agent'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-preset-registry'
import {
  createUserMessage,
  type ContentBlock,
  type LlmResolvedModelInfo,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { CommandAttachments, encodeCommandAttachments } from './command-attachments.ts'
export { encodeCommandAttachments } from './command-attachments.ts'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-commands'
import type { PermissionSelection } from '@deepseek-ai/dsh-permission-presets/types'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type { PlanProjection } from '@deepseek-ai/dsh-plan-mode/types'
import { isModelInvocable, isUserInvocable, type SkillSummary } from '@deepseek-ai/dsh-skill'
import { BUILTIN_SLASH_COMMANDS } from '../views/autocomplete.ts'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-workspace'
import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats/types'
import { readColdSessionLog } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-title'
import type { ContextBreakdownProjection, ContextPressureProjection, TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { appendPluginRecord, pluginRecordOf, SessionId, SessionLogOffset, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-reference'
import type {} from '@deepseek-ai/dsh-file-reference'
import type {} from '@deepseek-ai/dsh-goal'
import type { GoalProjection } from '@deepseek-ai/dsh-goal/types'
import type { UserQuestionProjectionView } from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-subagent'
import { queueHostSubagentPrompt, steerHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import type { StreamDelta } from '../views/event-views.ts'
import { firstVisibleStreamTime } from '../views/stream-time.ts'
import { LiveAttemptTracker } from './live-attempt-tracker.ts'
import { blocksText } from './content-text.ts'
import { conversationTurns } from './conversation-turns.ts'
import { buildSessionTree, markedSessionTree, sessionTreeFamily, type SessionTreeBranch } from './session-tree.ts'
export { conversationTurns, type ConversationTurn } from './conversation-turns.ts'
import { jobNoticeFor } from './job-notice.ts'
import type {
  TuiCommand,
  TuiGoalStatus,
  TuiInspectedSubagent,
  TuiRecentSession,
  TuiArgumentOption,
  TuiService,
  TuiSessionControls,
  TuiSessionStats,
  TuiSubmission,
  TuiQueueEditRequest,
  TuiInputImage,
  TuiTranscriptReplacement,
} from '../definition.ts'
import { descendantDepth, isSteerableSubagent } from './subagent-roster.ts'
import { readRecentRows, writeRecentRows, readSessionLibrary, sessionArgumentOptions, sessionLibraryPath, setSessionLabel, type SessionRowMemo } from './session-library.ts'
import { currentWorkingDirectory } from './working-directory.ts'
import { SubagentTracker } from './subagent-tracker.ts'
import type {} from '../runtime/tool-presentation.ts'
import { commandPermission } from '../commands/permission.ts'
import { configureAgentContext } from '../runtime/agent-profile.ts'
import { BTW_PRESET } from '../runtime/btw-policy.ts'
import { reviewFileRecovery } from '../runtime/file-recovery-review.ts'
import {
  isBlankSession,
} from './session-configuration.ts'
import { stripComposerImageMarkers } from '../input/image-paste.ts'
import type { ContextDiagnostics } from './context-diagnostics.ts'

interface ActiveSession {
  handle: AgentHandle
  contextWindow: number | undefined
  reasoningEffort: string | undefined
  agentPreset: string
}

interface ConfiguredAgentContext {
  agentPreset: string
}

async function setupAgentContext(agentCtx: Context, agent: Agent): Promise<ConfiguredAgentContext> {
  const configured = await configureAgentContext(agentCtx, agent)
  await agentCtx.plugin(commandPermission(agent))
  return configured
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
  contextBreakdown?: ContextBreakdownProjection
  plan?: PlanProjection
  permissions?: PermissionSelection
  goal?: GoalProjection | null
  userQuestions?: UserQuestionProjectionView
  /** Last logged sandbox-mode override, or null before one; outranks the preset while set. */
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access' | null
}

/** Present only the session controls whose owning Harness plugins are composed. */
export function sessionControls(projection?: TuiStatsProjection, livePlan?: { active: boolean; pending?: boolean }): TuiSessionControls {
  const override = projection?.sandboxMode
  // Host pending is a target value, while the UI projection says whether a
  // change remains. Cancelling a pending change can retain the current target.
  const plan = livePlan === undefined ? projection?.plan
    : { active: livePlan.active, pending: livePlan.pending !== undefined && livePlan.pending !== livePlan.active }
  return {
    ...(plan === undefined ? {} : { plan: { ...plan } }),
    // A logged sandbox override (for example an approved widening) is the mode
    // actually in force; the preset only describes the user's standing choice.
    ...(override == null
      ? (projection?.permissions === undefined ? {} : { permission: projection.permissions.currentValue })
      : { permission: override }),
    ...goalControl(projection?.goal),
    ...(projection?.userQuestions === undefined ? {} : {
      pendingQuestions: projection.userQuestions.active.filter(question => question.state === 'continued').length,
    }),
  }
}

/** A completed goal renders nothing, mirroring the projection's own visibility rule. */
function goalControl(projection: GoalProjection | null | undefined): { goal?: TuiGoalStatus } {
  if (projection === null || projection === undefined) return {}
  const goal = projection.goal
  if (goal.phase === 'complete') return {}
  return {
    goal: {
      phase: goal.phase,
      objective: goal.objective,
      ...(goal.blockedReason === undefined ? {} : { blockedReason: goal.blockedReason.message }),
      roundsStarted: projection.roundsStarted,
      maxGoalRounds: goal.maxGoalRounds,
    },
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

/**
 * Fold a complete log as the capability-absence fallback for projections.
 * Remaining fallbacks: elapsed time from first/last event timestamps, and the
 * whole stats/token fold when `sessionStats`, `tokenUsage`, or context pressure
 * is missing from the client-visible snapshot.
 */
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
        // Format-v2 messages embed the exact timed stream; derive the first
        // visible token time from it when live chunk edges were not observed.
        if (openStep.firstTokenTime === undefined) {
          const firstTime = firstVisibleStreamTime(event.data.stream)
          if (firstTime !== undefined) openStep.firstTokenTime = firstTime
        }
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
      case 'assistant/attempt': {
        // A failed attempt may still carry the step's first visible token;
        // remember it without counting usage or closing the step (the later
        // successful settlement folds the timing exactly once).
        if (openStep === undefined || openStep.turn !== event.data.turn || openStep.step !== event.data.step) break
        if (openStep.firstTokenTime === undefined) {
          const firstTime = firstVisibleStreamTime(event.data.stream)
          if (firstTime !== undefined) openStep.firstTokenTime = firstTime
        }
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

/**
 * Streaming deltas do not change footer-visible totals. Projection change
 * notifications own first-token and usage updates; settlement refreshes the
 * fallback fold when projections are absent.
 */
export function shouldRefreshSessionInfoAfter(event: SessionEvent): boolean {
  // Live streaming no longer publishes session events; only durable
  // settlements reach this fold, and `assistant/attempt` carries no usage.
  return event.type !== 'assistant/attempt'
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
  const text = blocksText(event.data.content, { collapse: true })
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
export function userSkillCommands(skills: readonly SkillSummary[], reserved: ReadonlySet<string> = new Set()): TuiCommand[] {
  return skills.filter(skill => isUserInvocable(skill) && !reserved.has(skill.name)).map(skill => ({
    name: skill.name,
    description: compactDescription(skill.description),
    skill: { userOnly: !isModelInvocable(skill) },
  }))
}

function compactDescription(value: string, maxLength: number = 140): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength - 1).trimEnd() + '…'
}

interface SubmissionAttachmentStore {
  saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]>
}

interface RestoreAttachmentStore {
  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>
}

/** Admit one ordered image batch, then build one atomic mixed user message. */
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
  const refs: ImageAttachmentRef[] = inputs.length === 0 || attachments === undefined
    ? []
    : [...await attachments.saveImages(inputs)]
  // A recorded order keeps the picture where the reader put it; without one the
  // message falls back to text followed by its attachments.
  const content: ContentBlock[] = []
  if (submission.segments === undefined || submission.segments.length === 0) {
    if (submission.text !== '') content.push({ type: 'text', text: submission.text })
    for (const attachment of refs) content.push({ type: 'image', attachment })
    for (const attachment of submission.files ?? []) content.push({ type: 'file', attachment })
  } else {
    for (const segment of submission.segments) {
      if (segment.kind === 'text') {
        if (segment.text !== '') content.push({ type: 'text', text: segment.text })
        continue
      }
      if (segment.kind === 'file') {
        const attachment = submission.files?.[segment.index]
        if (attachment !== undefined) content.push({ type: 'file', attachment })
      } else {
        const attachment = refs[segment.index]
        if (attachment !== undefined) content.push({ type: 'image', attachment })
      }
    }
    // An attachment the composer did not mark in the text still belongs to the
    // message: keep it rather than dropping it with the marker.
    const placedImages = new Set(submission.segments.flatMap(segment => segment.kind === 'image' ? [segment.index] : []))
    for (const [index, attachment] of refs.entries()) {
      if (!placedImages.has(index)) content.push({ type: 'image', attachment })
    }
    const placedFiles = new Set(submission.segments.flatMap(segment => segment.kind === 'file' ? [segment.index] : []))
    for (const [index, attachment] of (submission.files ?? []).entries()) {
      if (!placedFiles.has(index)) content.push({ type: 'file', attachment })
    }
  }
  if (content.length === 0) throw new Error('Cannot submit an empty message.')
  return createUserMessage({ content, source: { kind: 'user' } })
}

/** Rehydrate one durable human inbox message into an editable composer draft. */
export async function restoreSubmissionMessage(
  message: UserMessage,
  attachments?: RestoreAttachmentStore,
): Promise<TuiSubmission> {
  const text = blocksText(message.content)
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
  const files = message.content.filter((block): block is Extract<(typeof message.content)[number], { type: 'file' }> => block.type === 'file').map(block => block.attachment)
  let imageIndex = 0, fileIndex = 0
  const segments = message.content.flatMap<NonNullable<TuiSubmission['segments']>[number]>(block => {
    if (block.type === 'text') return [{ kind: 'text' as const, text: block.text }]
    if (block.type === 'image') return [{ kind: 'image' as const, index: imageIndex++ }]
    if (block.type === 'file') return [{ kind: 'file' as const, index: fileIndex++ }]
    return []
  })
  return { text, images, ...(files.length === 0 ? {} : { files }),
    ...(images.length === 0 && files.length === 0 ? {} : { segments }) }
}

/** The live selection succeeded, but the profile default still needs saving. */
export class DefaultModelSaveError extends Error {
  constructor(selection: ModelSelection, cause: unknown) {
    super(`Session model is now ${selection.provider}/${selection.model}. The default model could not be saved.`, { cause })
    this.name = 'DefaultModelSaveError'
  }
}

/** Own one switchable top-level Agent and project it onto a TuiService. */
export class SessionRuntime {
  readonly #commandAttachments: CommandAttachments | undefined
  readonly #workflows = new WorkflowProjection()
  readonly #ctx: Context
  readonly #tui: TuiService
  #active: ActiveSession | undefined
  #recent: TuiRecentSession[] = []
  #archivedSessions = new Set<string>()
  #skills: readonly SkillSummary[] = []
  /**
   * Live argument vocabularies, keyed by command.
   *
   * A snapshot rather than a callback into the services: completion runs on every
   * keystroke and must not await a catalog. Session refreshes publish recent
   * rows immediately and load each provider independently.
   */
  #argumentOptions = new Map<string, readonly TuiArgumentOption[]>()
  #argumentEpoch = 0
  #started = false
  readonly #retired: AgentHandle[] = []
  // Weak: deduplication must not retain disposed session graphs.
  readonly #releasedHandles = new WeakSet<AgentHandle>()
  #disposed = false
  #queueAbort: AbortController | undefined
  #workflowAbort: AbortController | undefined
  readonly #off: Array<() => void> = []
  readonly #tracker: SubagentTracker
  readonly #streamAttempts = new LiveAttemptTracker()
  readonly #recentCache = new Map<string, SessionRowMemo>()
  readonly #libraryPath: string
  readonly #recentRowsPath: string | undefined
  #recentRowsLoaded = false
  #refreshInFlight: Promise<void> | null = null
  #refreshDirty = false
  #inspectEpoch = 0
  #inspectDeliveryTail: Promise<void> = Promise.resolve()
  #activeInteraction = new AbortController()
  readonly #pendingSends = new Map<Agent, number>()
  readonly #inspectDeliveries = new Set<AbortController>()
  readonly #descendantApprovals = new Map<AbortController, Agent>()
  #activationEpoch = 0
  #inspectedId: string | undefined

  constructor(ctx: Context, tui: TuiService, options: { stateDir?: string } = {}) {
    this.#ctx = ctx
    this.#tui = tui
    const commands = ctx.get('commands')
    if (commands !== undefined) {
      this.#commandAttachments = new CommandAttachments(commands)
      this.#off.push(() => this.#commandAttachments?.dispose())
    }
    this.#libraryPath = sessionLibraryPath(options.stateDir)
    this.#recentRowsPath = options.stateDir === undefined ? undefined : join(options.stateDir, 'recent-sessions.json')
    this.#tracker = new SubagentTracker({
      rootId: () => this.#active?.handle.agent.id,
      depth: (session) => {
        const rootId = this.#active?.handle.agent.id
        return rootId === undefined ? undefined : descendantDepth(session, rootId, this.#lookupSession)
      },
      agentStatus: id => this.#ctx.get('agents')?.get(SessionId(id))?.status,
      sessions: () => this.#ctx.get('sessions')?.list() ?? [],
      listChildren: rootId => this.#ctx.get('subagents')?.listChildren(SessionId(rootId)),
      publish: (roster) => {
        this.#tui.setSubagents(this.#workflows.roster(roster))
        if (this.#inspectedId === undefined) return
        this.#tui.setInspectedSubagent(this.#inspectView(this.#inspectedId))
      },
    })
    const offGoal = tui.setGoalHandler?.(signal => openGoalControls(ctx, tui, this.#requiredAgent(), AbortSignal.any([signal, this.interactionSignal])))
    if (offGoal !== undefined) this.#off.push(offGoal)
    this.#off.push(tui.setQueueHandler(signal => this.openQueue(signal)))
    const offContinue = tui.setContinueHandler?.(async request => {
      const agent = this.#requiredAgent()
      if (agent.id !== request.sessionId) throw new Error('The continuation belongs to another session.')
      await this.continueGeneration(agent, request.failureSeq)
    })
    if (offContinue !== undefined) this.#off.push(offContinue)
    this.#off.push(tui.onInspectSubagent(id => { void this.#inspectSubagent(id) }))
    const offWorkflow = tui.onInspectWorkflow?.(id => {
      void this.openWorkflow(id).catch(error => { this.#tui.notice(error instanceof Error ? error.message : String(error), { level: 'error' }) })
    })
    if (offWorkflow !== undefined) this.#off.push(offWorkflow)
    this.#off.push(tui.onInspectClose(() => { this.#closeInspect() }))
    this.#off.push(tui.onInspectSubmit(submission => { void this.#steerInspected(submission) }))
    tui.setSessionSearch(async (query, signal) => {
      const agent = this.#active?.handle.agent
      const resolver = this.#ctx.get('sessionReferenceResolver')
      if (agent === undefined || resolver === undefined) return []
      return resolver.listCandidates(agent, query, 20, signal)
    })
    const fileReferences = this.#ctx.get('fileReferences')
    if (fileReferences !== undefined) {
      tui.setFileSearch(async (query, signal) => {
        const agent = this.#inspectedId === undefined ? this.#active?.handle.agent : this.#ctx.get('agents')?.get(SessionId(this.#inspectedId))
        if (agent === undefined) return []
        return fileReferences.list(agent, query, signal ?? new AbortController().signal)
      })
    }
    const attachments = this.#ctx.get('attachments')
    if (attachments !== undefined) {
      tui.setImageValidator(image => attachments.validateImage({
        data: image.data,
        mediaType: image.mediaType,
        ...(image.name === undefined ? {} : { name: image.name }),
      }))
    }
    const jobs = this.#ctx.get('jobs')
    if (jobs !== undefined) {
      // Settlements speak session ids, so the owning Agent is resolved here;
      // a job whose owner is gone has no notice to show.
      this.#off.push(jobs.events.subscribe({ owners: 'scope' }, (event) => {
        if (event.type !== 'settled') return
        const owner = event.job.owner === undefined ? undefined : this.#ctx.get('agents')?.get(event.job.owner)
        const notice = jobNoticeFor(event.job, owner, this.#active?.handle.agent)
        if (notice !== undefined) {
          const job = event.job
          tui.notice(notice, {
            process: true, processSource: `job:${job.id}`,
            ...(/^(bash|pwsh)$/u.test(job.kind) && (job.status === 'completed' || job.status === 'failed' || job.status === 'killed')
              ? { job: { id: job.id, label: job.label, status: job.status, startedAt: job.startedAt, ...(job.detail === undefined ? {} : { detail: job.detail }) } }
              : {}),
            ...(job.status === 'failed' || job.status === 'killed' ? { level: 'error' as const } : {}),
          })
        }
      }))
    }
    this.#off.push(ctx.on('agent/status', (payload) => {
      if (payload.agent === this.#active?.handle.agent) {
        tui.setStatus(payload.status, { root: true })
        this.#pushSessionInfo()
        return
      }
      if (payload.agent.id === this.#inspectedId) tui.setStatus(payload.status)
      this.#tracker.noteStatus(payload.agent.session, payload.status)
    }))
    this.#off.push(ctx.on('session/created', (session) => {
      this.#tracker.noteSession(session)
    }))
    this.#off.push(ctx.on('subagent/start', info => { this.#tracker.noteExternalRun(info) }))
    this.#off.push(ctx.on('subagent/end', info => { this.#tracker.noteExternalRun(info) }))
    this.#off.push(ctx.on('subagent/external-activity', info => { this.#tracker.noteExternalActivity(info.id, info.activity) }))
    this.#off.push(ctx.on('session/disposed', (session) => {
      this.#tracker.noteGone(session)
    }))
    this.#off.push(ctx.on('session/event', (session, event) => {
      const active = this.#active
      if (active === undefined) return
      if (event.type === 'working-directory/change') {
        if (session.id === (this.#inspectedId ?? active.handle.agent.id)) {
          tui.setWorkingDirectory?.(currentWorkingDirectory(ctx, session))
        }
        if (session === active.handle.agent.session) {
          void this.#refreshSkills().catch(error => { ctx.logger.warn(error) })
          void this.refreshRecent().catch(error => { ctx.logger.warn(error) })
        }
      }
      if (session.id === this.#inspectedId) {
        const child = ctx.get('agents')?.get(session.id)
        tui.event(event, child === undefined ? undefined : ctx.get('tuiToolPresentation')?.event(child, event))
        this.#tracker.noteEvent(session, event)
        return
      }
      if (session === active.handle.agent.session) {
        if (event.type === 'turn/end') tui.setStatus(active.handle.agent.status, { root: true, outcome: event.data.reason.kind })
        if (this.#workflows.apply(event)) tui.setSubagents(this.#workflows.roster(this.#tracker.snapshot()))
        if (this.#inspectedId === undefined) {
          tui.event(event, ctx.get('tuiToolPresentation')?.event(active.handle.agent, event))
        }
        if (event.type === 'workspace/changes') this.#serveWorkspaceSummary(ctx, tui, session, event)
        if (event.type === 'subagent/catalog') this.#tracker.observeCatalog(session, [event])
        if (shouldRefreshSessionInfoAfter(event)) this.#pushSessionInfo()
        if (event.type === 'session/title') void this.refreshRecent()
        return
      }
      this.#tracker.noteEvent(session, event)
    }))
    // Format v2 moved live assistant increments off the session log. The
    // durable `session/event` firehose now carries only settlements; chunk
    // frames arrive on this agent-scoped stream and are folded into the
    // transcript (or the subagent roster) as transient deltas.
    this.#off.push(ctx.on('agent/assistant-stream', (payload) => {
      const frame = payload.frame
      const key = `${payload.agent.session.id}:${frame.attemptId}`
      if (frame.type === 'start') {
        this.#streamAttempts.start(key, frame)
        return
      }
      if (frame.type === 'end') {
        this.#streamAttempts.end(key)
        return
      }
      const delta = this.#streamAttempts.chunk(key, frame)
      if (delta !== undefined) this.#forwardLiveDelta(payload.agent, delta)
    }, { global: true }))
    this.#off.push(ctx.on('goal/activation-changed', payload => {
      if (payload.sessionId === this.#active?.handle.agent.session.id) this.#pushSessionInfo()
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
        if (key === 'sessionStats' || key === 'tokenUsage' || key === 'contextPressure' || key === 'contextBreakdown'
          || key === 'plan' || key === 'permissions' || key === 'goal' || key === 'userQuestions') this.#pushSessionInfo()
      }))
    }
  }

  /** Presentation requests from a replaced root must not survive into its successor. */
  get interactionSignal(): AbortSignal { return this.#activeInteraction.signal }

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
      try { this.#ctx.get('subagents')?.interrupt(SessionId(this.#inspectedId), { kind: 'ancestor', agent: root }) }
      catch (error) { this.#tui.notice(error instanceof Error ? error.message : String(error), { level: 'error' }) }
    }
    return true
  }

  #isOwnedDescendant(agent: Agent, root: Agent): boolean {
    const agents = this.#ctx.get('agents')
    if (agents?.get(agent.id) !== agent
      || descendantDepth(agent.session, root.id, this.#lookupSession) === undefined) return false
    // Durable lineage alone also matches an independently resumed runtime root.
    let child = agent
    while (child !== root) {
      const parentId = child.session.header.parentSession
      const parent = parentId === undefined ? undefined : agents.get(parentId)
      if (parent === undefined || !agents.isOwnedBy(child.id, parent)) return false
      child = parent
    }
    return true
  }

  /** Accept only live descendants of the active root for shared approval prompts. */
  beginSubagentApproval(agent: Agent): { label: string; signal: AbortSignal; finish(): void } | undefined {
    const root = this.agent
    if (root === undefined || !this.#isOwnedDescendant(agent, root)) return undefined
    this.#tracker.noteSession(agent.session)
    const abort = new AbortController()
    this.#descendantApprovals.set(abort, root)
    const finish = this.#tracker.beginApprovalRequest(agent.id)
    const off = this.#ctx.on('agent/disposed', event => { if (event.agent === agent) abort.abort() })
    return { label: this.#inspectView(agent.id).label, signal: abort.signal, finish: () => {
      off()
      this.#descendantApprovals.delete(abort)
      finish()
    } }
  }

  async start(): Promise<void> {
    if (this.#started) return
    this.#started = true
    const defaults = this.#ctx.get('agentDefaultModel')?.currentSelection()
    if (defaults === undefined) throw new Error('agent default model is unavailable')
    await this.refreshRecent()
    await this.#activate(await this.#create(defaults), 'initial')
  }

  /** Admit a complete composer value through the selected Harness inbox entry. */
  async send(input: string | TuiSubmission, agent: Agent = this.#requiredAgent()): Promise<void> {
    const submission = typeof input === 'string' ? { text: input, images: [] } : input
    await this.#sendSubmission(submission, agent)
  }

  async #sendSubmission(submission: TuiSubmission, agent: Agent, signal?: AbortSignal): Promise<void> {
    const assertDelivery = (): void => {
      signal?.throwIfAborted()
      this.assertActive(agent)
      if (submission.delivery === 'steer' && agent.status !== 'running') {
        throw new Error('Steering needs an active turn. Use Enter to send the next message.')
      }
    }
    assertDelivery()
    this.#pendingSends.set(agent, (this.#pendingSends.get(agent) ?? 0) + 1)
    try {
      const message = await createSubmissionMessage(submission, this.#ctx.get('attachments'))
      assertDelivery()
      this.#tui.pendingInputs?.prepare?.(submission, message.id)
      this.#admit(agent, message, submission.delivery)
    } finally {
      const remaining = (this.#pendingSends.get(agent) ?? 1) - 1
      if (remaining === 0) this.#pendingSends.delete(agent)
      else this.#pendingSends.set(agent, remaining)
    }
  }

  #admit(agent: Agent, message: UserMessage, delivery?: 'queue' | 'steer'): void {
    const offset = agent.session.snapshotEvents().length
    try {
      if (delivery === 'steer') agent.steer(message)
      else agent.followup(message)
    } catch (error) {
      // An event subscriber may throw after admission, even after the message was claimed.
      // Only a pre-admission failure may return the submission to the composer.
      const accepted = agent.session.snapshotEvents().slice(offset).some(event =>
        event.type === 'agent/inbox/spliced' && event.data.inserted.some(item => item.id === message.id))
      if (!accepted) throw error
      this.#tui.notice(error instanceof Error ? error.message : String(error), { level: 'error' })
    }
  }

  #assertCanRepeat(agent: Agent, signal?: AbortSignal): void {
    signal?.throwIfAborted()
    this.assertActive(agent)
    if (this.#inspectedId !== undefined) throw new Error('Return to the parent session to continue or resend a prompt.')
    if (agent.status !== 'idle' || this.#pendingSends.has(agent)) throw new Error('Wait for the current work to finish before continuing or resending.')
    if (agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.some(message => message.source.kind === 'user')
      || (this.#tui.pendingInputs?.list().length ?? 0) > 0) throw new Error('Resolve pending input in /queue before continuing or resending.')
    if (this.#descendantApprovals.size > 0 || this.#ctx.get('sessionProjections')?.snapshot(agent.session).values.userQuestions?.active.some(question => question.state !== 'continued')) {
      throw new Error('Answer the pending question or approval before continuing or resending.')
    }
  }

  /** Wake an eligible failed generation with empty retry input; never duplicate the original prompt. */
  async continueGeneration(agent: Agent = this.#requiredAgent(), expectedFailure?: number, signal?: AbortSignal): Promise<void> {
    this.#assertCanRepeat(agent, signal)
    await agent.runMaintenance(async maintenance => {
      maintenance.throwIfAborted()
      this.#assertCanRepeat(agent, signal)
      const failure = continuableFailure(agent.session.snapshotEvents())
      if (failure === undefined || expectedFailure !== undefined && expectedFailure !== failure) {
        throw new Error('No recoverable model failure is available to continue. Use /retry to resend the last prompt.')
      }
      this.#admit(agent, createUserMessage({ content: [], source: { kind: 'retry' } }))
    })
  }

  /** Explicitly resend the complete latest human message with a fresh Harness identity. */
  async retryLastPrompt(agent: Agent = this.#requiredAgent(), signal?: AbortSignal): Promise<boolean> {
    this.#assertCanRepeat(agent, signal)
    return agent.runMaintenance(async maintenance => {
      maintenance.throwIfAborted()
      this.#assertCanRepeat(agent, signal)
      const previous = agent.session.snapshotEvents().findLast(event => event.type === 'user/message'
        && event.data.source.kind === 'user' && event.data.content.length > 0)
      if (previous?.type !== 'user/message') return false
      this.#admit(agent, createUserMessage({ content: previous.data.content, source: { kind: 'user' } }))
      return true
    })
  }

  /** Resolve one visible live inbox, retaining its identity across asynchronous UI work. */
  #queueTarget(): { agent: Agent; label?: string; check(): void } {
    const root = this.#requiredAgent()
    const inspectedId = this.#inspectedId
    if (inspectedId !== undefined && !this.#inspectView(inspectedId).writable) throw new Error('This subagent is read-only.')
    const agent = inspectedId === undefined ? root : this.#ctx.get('agents')?.get(SessionId(inspectedId))
    if (agent === undefined) throw new Error('This subagent is not loaded locally. Send it a message to continue before managing its queue.')
    const check = (): void => {
      this.assertActive(root)
      if (this.#inspectedId !== inspectedId || inspectedId !== undefined && !this.#isOwnedDescendant(agent, root)) {
        throw new Error('The queue session is no longer active.')
      }
    }
    check()
    return { agent, check, ...(inspectedId === undefined ? {} : { label: this.#inspectView(inspectedId).label }) }
  }

  async openQueue(signal: AbortSignal, requestingAgent?: Agent): Promise<void> {
    if (requestingAgent !== undefined) this.assertActive(requestingAgent)
    const target = this.#queueTarget()
    const { agent } = target
    if (this.#queueAbort !== undefined && !this.#queueAbort.signal.aborted) throw new Error('Message Queue is already open.')
    // Validate recall state before opening; child views must never list parent delivery entries.
    this.#tui.pendingInputs.list()
    const abort = new AbortController()
    this.#queueAbort = abort
    const onAbort = (): void => { abort.abort(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    const off = this.#ctx.on('agent/disposed', event => { if (event.agent === agent) abort.abort() })
    try {
      await openMessageQueue({ agent, signal: abort.signal, assertActive: target.check,
        ...(target.label === undefined ? {} : { ownerLabel: target.label }),
        tui: {
          prompt: request => this.#tui.prompt(request), notice: (text, options) => this.#tui.notice(text, options),
          restoreInput: submission => this.#tui.restoreInput(submission, agent.id),
          pendingInputs: target.label === undefined ? this.#tui.pendingInputs : { list: () => [], update: () => false },
        },
        restore: message => restoreSubmissionMessage(message, this.#ctx.get('attachments')) })
    } catch (error) {
      if (!abort.signal.aborted) throw error
    } finally {
      off()
      signal.removeEventListener('abort', onAbort)
      if (this.#queueAbort === abort) this.#queueAbort = undefined
    }
  }

  /** Inspect durable membership; only a currently running, owned local member can be opened. */
  async openWorkflow(id: string): Promise<void> {
    const root = this.#requiredAgent()
    const inspectedId = this.#inspectedId
    this.#workflowAbort?.abort()
    const abort = new AbortController()
    this.#workflowAbort = abort
    const check = (): void => {
      abort.signal.throwIfAborted()
      this.assertActive(root)
      if (this.#inspectedId !== inspectedId) throw new Error('The workflow session is no longer active.')
    }
    const canOpen = (run: NonNullable<ReturnType<WorkflowProjection['get']>>, member: typeof run.members[number]): boolean => {
      const child = this.#ctx.get('agents')?.get(SessionId(member.childId))
      return workflowMemberStatus(run, member) === 'open' && child?.status === 'running'
        && child.session.header.parentSession === root.id && this.#isOwnedDescendant(child, root) && this.#tracker.owns(child.id)
    }
    try {
      let lastRun: ReturnType<WorkflowProjection['get']>
      let lastOpen = ''
      let options: ReturnType<typeof workflowOptions> = []
      const refresh = (): ReturnType<typeof workflowOptions> => {
        check()
        const run = this.#workflows.get(id)
        if (run === undefined) throw new Error('This workflow is no longer available.')
        const open = run.members.filter(member => canOpen(run, member)).map(member => member.seq).join(',')
        if (run !== lastRun || open !== lastOpen) {
          options = workflowOptions(run, member => canOpen(run, member))
          lastRun = run; lastOpen = open
        }
        return options
      }
      let selected: string | undefined
      while (!abort.signal.aborted) {
        const answer = await this.#tui.prompt({ title: 'Workflow',
          question: 'Browse phases and members. Only running local members can be opened.',
          localize: ['title', 'question'], notify: false, options: refresh(), refreshOptions: refresh,
          presentation: 'tree', filterable: true, allowCustom: false, submitLabel: 'open',
          emptyText: 'No matching workflow members.', signal: abort.signal,
          ...(selected === undefined ? {} : { initialValue: selected }) })
        if (answer === null) return
        check()
        selected = answer
        const run = this.#workflows.get(id)
        const member = run?.members.find(member => `member:${member.seq}` === answer)
        if (run === undefined || member === undefined || !canOpen(run, member)) {
          this.#tui.notice('This workflow member is no longer available to open.')
          continue
        }
        await this.#inspectSubagent(member.childId)
        return
      }
    } catch (error) {
      if (!abort.signal.aborted) throw error
    } finally {
      if (this.#workflowAbort === abort) this.#workflowAbort = undefined
    }
  }

  /** Rehydrate before withdrawing so navigation or missing attachments leave the inbox intact. */
  async editLatestFollowup(request?: TuiQueueEditRequest): Promise<TuiSubmission | undefined> {
    request?.signal.throwIfAborted()
    const target = this.#queueTarget()
    const { agent } = target
    if (request?.sessionId !== undefined && request.sessionId !== agent.id) throw new Error('The queue session is no longer active.')
    const message = agent.inbox.nextTurn.findLast(candidate => candidate.source.kind === 'user')
    if (message === undefined) return undefined
    const submission = await restoreSubmissionMessage(message, this.#ctx.get('attachments'))
    request?.signal.throwIfAborted()
    target.check()
    return agent.inbox.remove(message.id) ? { ...submission, literal: true, delivery: 'queue' } : undefined
  }

  /** Execute a plugin-owned slash command, falling back to user-invocable skills. */
  async execute(
    input: string | TuiSubmission,
    signal: AbortSignal,
    images: readonly TuiInputImage[] = [],
  ): Promise<boolean> {
    const submission: TuiSubmission = typeof input === 'string' ? { text: input, images } : input
    const { text: line } = submission
    images = submission.images
    const commandLine = stripComposerImageMarkers(line, images)
    const parsed = parseControl(commandLine)
    if (parsed === undefined) return false
    const commands = this.#ctx.get('commands')
    const agent = this.#requiredAgent()
    const staged = this.#commandAttachments?.stage(agent, submission)
    const execution = await (async () => {
      try {
        return await commands?.execute(
          agent,
          commandLine,
          staged?.attachments ?? encodeCommandAttachments(images),
          signal,
        )
      } finally {
        staged?.dispose()
        await this.#disposeRetired()
      }
    })()
    if (execution === undefined) {
      const skill = await this.#findUserSkill(parsed.name, signal)
      signal.throwIfAborted()
      this.assertActive(agent)
      if (skill === undefined) return false
      await this.#sendSubmission(submission, agent, signal)
      return true
    }
    const result = execution.result
    if (result.kind === 'error' && (images.length > 0 || submission.files?.length)) this.#tui.restoreInput(submission, agent.session.id)
    const presented = result.kind === 'success' && result.sourceEventSeq !== undefined
      && agent.session.snapshotEvents().some(event => event.seq === result.sourceEventSeq && event.type === 'compaction/summary')
    if (result.text !== undefined && !presented) {
      if (result.kind === 'error') this.#tui.notice(result.text, { level: 'error', focus: true })
      else this.#tui.commandOutput(parsed.name, result.text, { focus: true })
    }
    return true
  }

  /** Fail when a command invocation targets a stale or background Agent. */
  assertActive(agent: Agent): void {
    if (agent !== this.#requiredAgent()) throw new Error('the command does not target the active omdsh session')
  }

  /** Shared local metadata document for Session Library and Tree actions. */
  get sessionLibraryPath(): string { return this.#libraryPath }

  /** Immutable recent-session view used by the resume command. */
  get recentSessions(): readonly TuiRecentSession[] {
    return this.#recent
  }

  /** Current model selection for the active Agent, read from its durable projection. */
  selection(agent: Agent = this.#requiredAgent()): ModelSelection {
    this.assertActive(agent)
    const current = agent.model.current()
    if (current === undefined) throw new Error('active agent has no model selection')
    return current
  }

  /** Replace the active Agent's selection, optionally persisting it as the next default. */
  async changeSelection(
    agent: Agent,
    selection: ModelSelection,
    info?: LlmResolvedModelInfo,
    options?: { persist?: boolean },
  ): Promise<void> {
    this.assertActive(agent)
    const active = this.#requiredActive()
    const resolved = info ?? await this.#resolveModelInfo(selection)
    this.assertActive(agent)
    const current = agent.model.current()
    if (current?.provider !== selection.provider || current.model !== selection.model || current.reasoningEffort !== selection.reasoningEffort) {
      agent.model.select(selection)
    }
    active.contextWindow = resolved?.context?.contextWindow
    const status = modelStatus(selection, resolved)
    active.reasoningEffort = status.reasoningEffort
    this.#tui.setModel(status.model, status.reasoningEffort)
    this.#pushSessionInfo()
    if (options?.persist !== false) {
      try { await this.#ctx.get('agentDefaultModel')?.saveSelection(selection) }
      catch (error) { throw new DefaultModelSaveError(selection, error) }
    }
  }

  /** Start a new top-level session with the current model selection. */
  async newSession(agent: Agent, presetId?: string): Promise<void> {
    this.assertActive(agent)
    await this.#activate(await this.#create(this.selection(agent), presetId), 'new')
    await this.refreshRecent()
  }

  /** Replace the active top-level session with one durable session. */
  async resumeSession(agent: Agent, id: string, signal: AbortSignal): Promise<void> {
    this.assertActive(agent)
    const selection = this.selection(agent)
    let configured: ConfiguredAgentContext | undefined
    const handle = await this.#ctx.agents.resume({
      resumeSessionId: SessionId(id),
      agentOptions: { provider: selection.provider, model: selection.model },
      signal,
      setup: async (agentCtx, agent) => { configured = await setupAgentContext(agentCtx, agent) },
    })
    const configuration = configured
    if (configuration === undefined) {
      await handle.dispose()
      throw new Error('resumed agent was published without session configuration')
    }
    await this.#activate({
      handle,
      contextWindow: undefined,
      reasoningEffort: undefined,
      agentPreset: configuration.agentPreset,
    })
    await this.refreshRecent()
  }

  /** Rename a live or durable top-level session through the public log-backed title service. */
  async renameSession(agent: Agent, id: string, title: string, signal: AbortSignal): Promise<void> {
    this.assertActive(agent)
    if (id === agent.id) {
      this.#ctx.sessionTitle.rename(agent.session, title)
      await this.refreshRecent()
      return
    }
    const selection = this.selection(agent)
    const handle = await this.#ctx.agents.resume({
      resumeSessionId: SessionId(id),
      agentOptions: { provider: selection.provider, model: selection.model },
      signal,
      setup: async (agentCtx, agent) => { await setupAgentContext(agentCtx, agent) },
    })
    try {
      this.#ctx.sessionTitle.rename(handle.agent.session, title)
    } finally {
      await handle.dispose()
    }
    await this.refreshRecent()
  }

  /** Browse conversation forks and preview turns before editing or continuing a branch. */
  async openSessionTree(signal: AbortSignal): Promise<void> {
    const agent = this.#requiredAgent()
    if (agent.status !== 'idle') return
    const persistence = this.#ctx.get('sessionPersistence')
    const snapshots = persistence === undefined ? [] : await persistence.list({ signal })
    const candidates = snapshots.filter(item => item.header.origin !== 'subagent'
      && item.header.cwd === agent.session.header.cwd).map(item => ({
        id: String(item.header.id),
        ...(item.header.isSeeded && item.header.parentSession !== undefined ? { parentId: String(item.header.parentSession) } : {}),
      }))
    const current = { id: String(agent.id),
      ...(agent.session.header.isSeeded && agent.session.header.parentSession !== undefined
        ? { parentId: String(agent.session.header.parentSession) } : {}) }
    const headers = [...candidates.filter(item => item.id !== current.id), current]
    const family = sessionTreeFamily(headers, current.id)
    const branches: SessionTreeBranch[] = []
    for (const header of headers) {
      if (!family.has(header.id)) continue
      signal.throwIfAborted()
      if (header.id === current.id) {
        const events = agent.session.snapshotEvents()
        const title = explicitSessionTitle(events.slice(header.parentId === undefined ? 0 : Number(agent.session.inheritedEventCount)))
        branches.push({ ...header, events, inheritedEventCount: Number(agent.session.inheritedEventCount), ...(title === undefined ? {} : { title }),
          ...(agent.session.header.agentPreset === undefined ? {} : { agentPreset: agent.session.header.agentPreset }) })
      } else if (persistence !== undefined) {
        const log = await readColdSessionLog(persistence, SessionId(header.id), signal)
        const title = explicitSessionTitle(log.events.slice(header.parentId === undefined ? 0 : Number(log.inheritedEventCount)))
        branches.push({ ...header, events: log.events, inheritedEventCount: Number(log.inheritedEventCount), ...(title === undefined ? {} : { title }),
          ...(log.header.agentPreset === undefined ? {} : { agentPreset: log.header.agentPreset }) })
      }
    }
    this.assertActive(agent)
    if (agent.status !== 'idle') return
    const nodes = buildSessionTree(branches, current.id)
    if (!nodes.some(node => node.kind === 'turn')) {
      this.#tui.notice('No conversation turns are available in the Session Tree.')
      return
    }
    const target = nodes.findLast(node => node.sessionId === current.id && node.kind === 'turn')
      ?? nodes.find(node => node.sessionId === current.id)
    let markedOnly = false
    let selectedId = target?.id
    let answer: string | null
    while (true) {
      const library = readSessionLibrary(this.#libraryPath)
      const visible = markedOnly ? markedSessionTree(nodes, library.labels) : nodes
      answer = await this.#tui.prompt({
        title: markedOnly ? 'Session Tree · Marked' : 'Session Tree', question: '', notify: false,
        emptyText: 'No marked nodes. Alt+B shows the full tree.',
        options: visible.map(node => {
          const label = library.labels[node.id]
          return {
            label: label === undefined ? node.label : `◆ ${label} · ${node.label}`,
            value: node.id, ...(node.parentId === undefined ? {} : { parentValue: node.parentId }),
            preview: node.preview, previewFormat: node.previewFormat, description: node.description,
            submitLabel: node.kind === 'turn' ? 'edit from here' : 'continue branch',
            ...(node.current ? { badge: { label: 'Current', tone: 'success' as const } } : {}),
          }
        }),
        actions: [
          { key: 'Alt+Enter', label: 'continue branch', valuePrefix: 'continue:' },
          { key: 'Alt+L', label: 'label', valuePrefix: 'label:' },
          { key: 'Alt+U', label: 'clear label', valuePrefix: 'unlabel:' },
          { key: 'Alt+B', label: markedOnly ? 'full tree' : 'marked nodes', valuePrefix: 'marked:', scope: 'list' },
          ...(this.#ctx.get('omdshFileRecovery') === undefined ? [] : [{ key: 'Alt+R', label: 'restore Turn files', valuePrefix: 'restore:' }]),
        ],
        ...(selectedId === undefined ? {} : { initialValue: selectedId }), presentation: 'tree', filterable: true, allowCustom: false, signal,
      })
      if (answer === null) return
      this.assertActive(agent)
      signal.throwIfAborted()
      if (agent.status !== 'idle') throw new Error('Finish or interrupt the active turn before navigating the Session Tree.')
      if (answer === 'marked:') { markedOnly = !markedOnly; continue }
      if (answer.startsWith('restore:')) {
        const restoreId = answer.slice('restore:'.length)
        const node = visible.find(item => item.id === restoreId)
        if (node?.kind !== 'turn' || node.turn === undefined) { this.#tui.notice('Select a Turn to restore its files.'); continue }
        selectedId = node.id
        await reviewFileRecovery(this.#ctx, agent, node.sessionId, node.turn, signal, () => this.assertActive(agent))
        continue
      }
      const clear = answer.startsWith('unlabel:')
      if (clear || answer.startsWith('label:')) {
        const id = answer.slice(clear ? 'unlabel:'.length : 'label:'.length)
        const node = visible.find(item => item.id === id)
        if (node === undefined) continue
        selectedId = id
        if (clear) {
          setSessionLabel(this.#libraryPath, id, '')
          continue
        }
        let draft = library.labels[id] ?? ''
        let error: string | undefined
        while (true) {
          const label = await this.#tui.prompt({
            title: 'Label Conversation Node', question: `Label for ${node.label}`,
            initialInput: draft, detail: error ?? 'Up to 120 characters. Alt+U in the tree clears a label.',
            signal,
          })
          if (label === null) break
          this.assertActive(agent)
          signal.throwIfAborted()
          try { setSessionLabel(this.#libraryPath, id, label); break }
          catch (failure) {
            error = failure instanceof Error ? failure.message : String(failure)
            draft = label
          }
        }
        continue
      }
      break
    }
    const continuing = answer.startsWith('continue:')
    const node = nodes.find(item => item.id === (continuing ? answer.slice('continue:'.length) : answer))
    if (node === undefined) throw new Error('The selected conversation node is no longer available.')
    if (continuing || node.kind === 'branch') {
      if (node.sessionId === current.id) { this.#tui.notice('This branch is already active.'); return }
      await this.resumeSession(agent, node.sessionId, signal)
      this.#tui.notice('Continued the selected conversation branch.')
      return
    }
    // Draft preparation forks the selected branch; browsing itself never activates it.
    const source = branches.find(branch => branch.id === node.sessionId)
    if (source === undefined) throw new Error('The selected conversation branch is no longer available.')
    const events = source.events
    const selected = conversationTurns(events).find(turn => turn.messageIndex === node.messageIndex)
    if (selected === undefined) throw new Error('The selected conversation turn is no longer available.')
    const message = events[selected.messageIndex]
    if (message?.type !== 'user/message' || message.data.source.kind !== 'user') {
      throw new Error('The selected conversation turn is no longer available.')
    }
    const text = blocksText(message.data.content)
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
    const active = this.#requiredActive()
    let configured: ConfiguredAgentContext | undefined
    const handle = await this.#ctx.agents.create({
      sessionId: SessionId('session-' + randomUUID()),
      seed: events.slice(0, selected.branchIndex),
      meta: {
        ...(agent.session.header.cwd === undefined ? {} : { cwd: agent.session.header.cwd }),
        parentSession: SessionId(source.id),
        isSeeded: true,
        agentPreset: source.agentPreset ?? active.agentPreset,
      },
      inheritedEventCount: SessionLogOffset(selected.branchIndex),
      agentOptions: { provider: selection.provider, model: selection.model },
      signal,
      setup: async (agentCtx, agent) => {
        // A pre-turn prefix includes admission but excludes the later inbox claim.
        // Cancel that inherited work durably before publishing the editable fork.
        agent.inbox.clear()
        configured = await setupAgentContext(agentCtx, agent)
      },
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
    await this.#activate({
      handle,
      contextWindow: undefined,
      reasoningEffort: undefined,
      agentPreset: configuration.agentPreset,
    })
    const files = message.data.content.filter((block): block is Extract<(typeof message.data.content)[number], { type: 'file' }> => block.type === 'file').map(block => block.attachment)
    this.#tui.restoreInput({ text, images, ...(files.length === 0 ? {} : { files }) })
    this.#tui.notice(`Editing from before turn ${selected.turn}. The original branch remains available in the Session Tree.`)
    await this.#disposeRetired()
    await this.refreshRecent()
  }

  /** Whole-session figures for the active Agent. */
  stats(agent: Agent = this.#requiredAgent()): TuiSessionStats {
    this.assertActive(agent)
    return this.#stats(this.#requiredActive())
  }

  /** Current client-visible context projections, read as one consistent snapshot. */
  contextDiagnostics(agent: Agent = this.#requiredAgent()): ContextDiagnostics {
    this.assertActive(agent)
    const projection = this.#projection(this.#requiredActive())
    return {
      ...(projection?.contextPressure === undefined ? {} : { pressure: { ...projection.contextPressure } }),
      ...(projection?.tokenUsage === undefined ? {} : { usage: { ...projection.tokenUsage } }),
      ...(projection?.contextBreakdown === undefined ? {} : { breakdown: { ...projection.contextBreakdown } }),
    }
  }

  /** Effective reasoning effort after applying the selected model's adapter default. */
  reasoningEffort(agent: Agent = this.#requiredAgent()): string | undefined {
    this.assertActive(agent)
    return this.#requiredActive().reasoningEffort
  }

  /** Harness-owned workflow/access state plus the creation-time Agent preset. */
  controls(agent: Agent = this.#requiredAgent()): TuiSessionControls {
    this.assertActive(agent)
    const active = this.#requiredActive()
    return this.#sessionControls(active, this.#projection(active))
  }

  /** Agent presets available from the live Harness roster. */
  async agentPresets(): Promise<readonly AgentPreset[]> {
    return (await this.#ctx.agentPresets.list()).filter(preset => preset.id !== BTW_PRESET).sort((left, right) =>
      (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id))
  }

  /** Recompose one blank session, including the preset's fixed tool exposure. */
  async changeAgentPreset(agent: Agent, id: string): Promise<string> {
    this.assertActive(agent)
    if (!isBlankSession(agent.session)) {
      throw new Error('Agent is locked after the first prompt. Start /new, then choose the Agent before sending a message.')
    }
    const active = this.#requiredActive()
    if (active.agentPreset === id) return active.agentPreset
    const preset = await this.#ctx.agentPresets.recompose(agent.ctx, id)
    active.agentPreset = preset.id
    agent.session.append('agent-preset/selected', { agentPreset: preset.id })
    this.#pushTools()
    this.#pushCommands()
    await this.#refreshSkills()
    this.#replaceTranscript(agent)
    this.#pushSessionInfo()
    return active.agentPreset
  }

  /**
   * Resolve and attach the changed-file summary a `workspace/changes` event
   * announces.
   *
   * The Harness appends the event and only then files the summary under its
   * sequence, so a listener running inside that append always reads
   * `undefined`. The lookup is therefore deferred by one microtask, which runs
   * after the recorder's own synchronous store, and enriches the turn-only
   * block the transcript already rendered. A session without the plugin, or a
   * recorder that has already been disposed, simply keeps the fallback.
   *
   * @param ctx - host context carrying the optional service.
   * @param tui - the mounted presentation service.
   * @param session - the Session that appended the event.
   * @param event - the `workspace/changes` event.
   */
  #serveWorkspaceSummary(
    ctx: Context,
    tui: TuiService,
    session: Session,
    event: Extract<SessionEvent, { type: 'workspace/changes' }>,
  ): void {
    const service = ctx.get('workspaceChanges')
    if (service === undefined) return
    const { id } = session
    const { seq, data } = event
    queueMicrotask(() => {
      const summary = service.summary(id, seq)
      if (summary === undefined) return
      tui.setWorkspaceSummary(data.turn, summary)
      const recorded = session.snapshotEvents().some(candidate => {
        const record = pluginRecordOf(candidate)
        return record?.type === 'plugin:omdsh/workspace-changes'
          && typeof record.data === 'object'
          && record.data !== null
          && (record.data as { turn?: unknown }).turn === data.turn
      })
      if (!recorded) {
        try {
          appendPluginRecord(session, 'plugin:omdsh/workspace-changes', { turn: data.turn, summary })
        } catch {
          // A read-only or closed session log still keeps the in-memory summary.
        }
      }
    })
  }

  /**
   * Rebuild the argument vocabularies the composer completes.
   *
   * A snapshot, because completion runs per keystroke. `/model provider/model`
   * and `/resume <id>` are names that already exist in
   * this process, so the reader types toward them instead of opening a picker.
   */
  async #refreshArgumentOptions(): Promise<void> {
    const epoch = ++this.#argumentEpoch
    const llm = this.#ctx.get('llm')
    const providers = llm?.listProviders() ?? []
    const previous = this.#argumentOptions.get('model') ?? []
    const groups = new Map(providers.map(provider => [provider.id, previous.filter(model => model.value.startsWith(`${provider.id}/`))]))
    const options = new Map<string, readonly TuiArgumentOption[]>([['resume', sessionArgumentOptions(this.#recent)]])
    const publish = (): void => {
      if (this.#disposed || epoch !== this.#argumentEpoch) return
      options.set('model', providers.flatMap(provider => groups.get(provider.id) ?? []))
      this.#argumentOptions = options
      this.#pushCommands()
    }
    publish()
    await Promise.all(providers.map(async provider => {
      try {
        const models = await llm?.listModels(provider.id) ?? []
        if (this.#disposed || epoch !== this.#argumentEpoch) return
        groups.set(provider.id, models.map(model => ({
          value: `${provider.id}/${model.id}`,
          ...(model.name === undefined ? {} : { description: model.name }),
        })))
      } catch {
        // Preserve the last successful catalog. The model picker owns diagnostics.
        return
      }
      publish()
    }))
  }

  async refreshRecent(): Promise<void> {
    // Coalesce concurrent callers: the recent list is one snapshot, and a
    // burst of title/status events must not queue a read of every stored log.
    if (this.#refreshInFlight !== null) {
      // Mark the invalidation observed during the snapshot so one trailing
      // refresh publishes it instead of dropping the change.
      this.#refreshDirty = true
      return this.#refreshInFlight
    }
    const run = (async () => {
      for (;;) {
        await this.#refreshRecentNow()
        if (!this.#refreshDirty || this.#disposed) break
        this.#refreshDirty = false
      }
    })().finally(() => {
      this.#refreshInFlight = null
      // Completion must read the newly published rows, not the previous
      // directory's snapshot while persistence.list() is still pending.
      queueMicrotask(() => { if (!this.#disposed) void this.#refreshArgumentOptions().catch(() => {}) })
    })
    this.#refreshInFlight = run
    return run
  }

  async #refreshRecentNow(): Promise<void> {
    this.#archivedSessions = new Set(readSessionLibrary(this.#libraryPath).archived)
    const persistence = this.#ctx.get('sessionPersistence')
    if (persistence === undefined) {
      this.#recent = []
      this.#pushSessionInfo()
      return
    }
    const snapshots = (await persistence.list()).filter(snapshot => snapshot.header.origin !== 'subagent')
      .sort((left, right) => right.header.createdAt - left.header.createdAt)
    const agent = this.agent
    const cwd = agent === undefined ? process.cwd() : currentWorkingDirectory(this.#ctx, agent.session)
    // A stored row stays valid while its revision holds, so a cold process
    // renders labels for unchanged sessions without reading their logs; only a
    // new or changed session pays a read.
    if (!this.#recentRowsLoaded && this.#recentRowsPath !== undefined) {
      this.#recentRowsLoaded = true
      for (const [id, memo] of readRecentRows(this.#recentRowsPath)) this.#recentCache.set(id, memo)
    }
    const rows: TuiRecentSession[] = []
    let memoChanged = false
    const liveIds = new Set<string>(snapshots.map(snapshot => snapshot.header.id))
    for (const id of this.#recentCache.keys()) {
      if (liveIds.has(id)) continue
      this.#recentCache.delete(id)
      memoChanged = true
    }
    for (const snapshot of snapshots) {
      const header = snapshot.header
      // Scope before opening logs or consulting shared row caches. Other
      // directories remain available through an explicit session ID.
      if (header.cwd !== cwd) continue
      const cached = this.#recentCache.get(header.id)
      if (snapshot.formatStatus === 'migration-required') {
        // Do not open the log merely to browse it. A previous label is a hint;
        // the stored format classification always comes from this listing.
        rows.push({ ...(cached?.row ?? { id: header.id, title: header.id, createdAt: header.createdAt }), formatStatus: 'migration-required' })
        continue
      }
      if (cached?.revision === snapshot.revision) {
        if (cached.row !== null) rows.push({ ...cached.row, ...(snapshot.formatStatus === undefined ? {} : { formatStatus: snapshot.formatStatus }) })
        continue
      }
      try {
        const log = await readColdSessionLog(persistence, header.id)
        const status = recentSessionStatus(log.events)
        const content = recentSessionContent(log.events)
        if (content === undefined) {
          this.#recentCache.set(header.id, { revision: snapshot.revision, row: null })
          memoChanged = true
          continue
        }
        const row: TuiRecentSession = {
          id: header.id,
          ...content,
          createdAt: header.createdAt,
          updatedAt: log.events.at(-1)?.time ?? header.createdAt,
          eventCount: log.events.length,
          ...(status === undefined ? {} : { status }),
        }
        this.#recentCache.set(header.id, { revision: snapshot.revision, row })
        memoChanged = true
        rows.push(row)
      } catch {
        rows.push({ id: header.id, title: '(unavailable session)', createdAt: header.createdAt })
      }
    }
    if (memoChanged && this.#recentRowsPath !== undefined) writeRecentRows(this.#recentRowsPath, this.#recentCache)
    this.#recent = rows
    this.#pushSessionInfo()
  }

  async dispose(): Promise<void> {
    this.#queueAbort?.abort(new Error('session runtime disposed'))
    this.#workflowAbort?.abort()
    for (const abort of this.#descendantApprovals.keys()) abort.abort()
    if (this.#disposed) return
    this.#disposed = true
    this.#activeInteraction.abort()
    this.#activationEpoch += 1
    this.#cancelInspectDeliveries()
    this.#inspectedId = undefined
    this.#tracker.reset()
    this.#tui.setInspectedSubagent(undefined)
    this.#tui.setSubagents(undefined)
    this.#tui.setSessionSearch()
    this.#tui.setFileSearch()
    this.#tui.setImageValidator()
    for (const off of this.#off.splice(0).reverse()) off()
    const handles = this.#retired.splice(0)
    const active = this.#active
    this.#active = undefined
    if (active !== undefined) handles.push(active.handle)
    // Own every handle here so a late activation cannot double-release it.
    for (const handle of handles) this.#releasedHandles.add(handle)
    await this.#disposeHandles(handles)
  }

  async #create(selection: ModelSelection, presetId?: string): Promise<ActiveSession> {
    const preset = await this.#ctx.agentPresets.resolve(presetId)
    let configured: ConfiguredAgentContext | undefined
    const handle = await this.#ctx.agents.create({
      sessionId: SessionId('session-' + randomUUID()),
      meta: { cwd: process.cwd(), agentPreset: preset.id },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: async (agentCtx, agent) => { configured = await setupAgentContext(agentCtx, agent) },
    })
    const configuration = configured
    if (configuration === undefined) {
      await handle.dispose()
      throw new Error('created agent was published without session configuration')
    }
    return {
      handle,
      contextWindow: undefined,
      reasoningEffort: undefined,
      agentPreset: configuration.agentPreset,
    }
  }

  /**
   * Claim the activated session into the cwd workspace so grouped session
   * surfaces (the harness web sidebar) file it instead of leaving it
   * ungrouped. Best-effort like `#resolveModelInfo`: the registry is an
   * optional service and a failed claim must not disturb activation.
   */
  async #claimWorkspace(active: ActiveSession): Promise<void> {
    const registry = this.#ctx.get('workspaceRegistry')
    if (registry === undefined) return
    try {
      const { session } = active.handle.agent
      const cwd = session.header.cwd
      if (cwd === undefined) return
      const workspace = await registry.resolveByPath(cwd) ?? await registry.create(cwd)
      await workspace.attachSession(session.id)
    } catch {
      // The workspace claim is cosmetic interop; the session itself is fine.
    }
  }

  async #resolveModelInfo(selection: ModelSelection): Promise<LlmResolvedModelInfo | undefined> {
    try {
      return await this.#ctx.get('llm')?.resolveModelInfo(selection.provider, selection.model)
    } catch {
      return undefined
    }
  }

  async #activate(next: ActiveSession, reason: TuiTranscriptReplacement = 'open'): Promise<void> {
    // Reject a late create before it publishes UI on a disposed tree.
    if (this.#disposed) {
      this.#releaseHandle(next.handle)
      return
    }
    const previous = this.#active
    const epoch = ++this.#activationEpoch
    this.#queueAbort?.abort(new Error('active session changed'))
    this.#workflowAbort?.abort()
    this.#activeInteraction.abort()
    this.#activeInteraction = new AbortController()
    this.#active = next
    void this.#claimWorkspace(next)
    try {
      this.#presentAgent(next, reason)
      const selected = this.selection(next.handle.agent)
      const info = await this.#resolveModelInfo(selected)
      if (this.#disposed || this.#activationEpoch !== epoch) {
        // Dispose (or a newer activation) already reclaimed the visible
        // handle; the superseded previous agent is the one still unowned.
        if (previous !== undefined) this.#releaseHandle(previous.handle)
        return
      }
      next.contextWindow = info?.context?.contextWindow
      const status = modelStatus(selected, info)
      next.reasoningEffort = status.reasoningEffort
      this.#tui.setModel(status.model, status.reasoningEffort)
      await this.#refreshSkills()
      if (this.#disposed || this.#activationEpoch !== epoch) {
        if (previous !== undefined) this.#releaseHandle(previous.handle)
        return
      }
      this.#pushSessionInfo()
    } catch (error: unknown) {
      // A rejected activation must not orphan the freshly created handle nor
      // leave the screen on an agent that is no longer active: revert the
      // slot and re-present the previous agent. The rejected handle joins
      // teardown ownership even when the rollback presentation itself fails,
      // and the activation failure remains the actionable error.
      try {
        if (this.#activationEpoch === epoch) {
          this.#activeInteraction.abort()
          this.#activeInteraction = new AbortController()
          this.#active = previous
          if (previous !== undefined) {
            try {
              this.#presentAgent(previous)
            } catch (rollback: unknown) {
              try {
                this.#tui.notice(rollback instanceof Error ? rollback.message : String(rollback), { level: 'error' })
              } catch {
                // The display itself is failing; the activation error stays primary.
              }
            }
          }
        } else if (previous !== undefined) {
          // A dispose or a newer activation owns the visible handle chain;
          // only the superseded previous agent is still unowned here.
          this.#releaseHandle(previous.handle)
        }
      } finally {
        if (this.#activationEpoch === epoch) this.#releaseHandle(next.handle)
      }
      throw error
    }
    if (previous !== undefined) this.#releaseHandle(previous.handle)
  }

  /** Show one active session on the terminal: transcript, tools, controls, model. */
  #presentAgent(active: ActiveSession, reason: TuiTranscriptReplacement = 'open'): void {
    for (const [abort, root] of this.#descendantApprovals) if (root !== active.handle.agent) abort.abort()
    this.#workflows.reset(active.handle.agent.session.snapshotEvents())
    const agent = active.handle.agent
    this.#cancelInspectDeliveries()
    this.#inspectedId = undefined
    this.#tui.setInspectedSubagent(undefined)
    this.#tui.setStatus(agent.status)
    this.#tracker.sync()
    this.#tui.setSubagents(this.#workflows.roster(this.#tracker.snapshot()))
    const selected = this.selection(agent)
    const status = modelStatus(selected, undefined)
    this.#tui.setModel(status.model, status.reasoningEffort ?? active.reasoningEffort)
    // Seed welcome metadata before replaceSession commits the startup header to
    // native scrollback; later updates cannot rewrite that frozen first frame.
    this.#pushSessionInfo()
    this.#replaceTranscript(agent, reason)
    this.#pushTools()
    this.#pushCommands()
  }

  /** Retire one agent handle once; a raced dispose takes it directly. */
  #releaseHandle(handle: AgentHandle): void {
    if (this.#releasedHandles.has(handle)) return
    this.#releasedHandles.add(handle)
    if (this.#disposed) {
      void handle.dispose().catch(() => {})
      return
    }
    this.#retired.push(handle)
  }

  #pushCommands(): void {
    const agent = this.agent
    const runtime = agent === undefined ? [] : (this.#ctx.get('commands')?.list(agent) ?? [])
    const commands: TuiCommand[] = runtime.map(command => {
      const options = this.#argumentOptions.get(command.name)
      return {
        name: command.name,
        description: command.description,
        ...(command.input?.hint === undefined ? {} : { inputHint: command.input.hint }),
        ...(options === undefined ? {} : { complete: (prefix: string) => matchArgumentOptions(options, prefix) }),
      }
    })
    const names = new Set([...commands.map(command => command.name),
      ...BUILTIN_SLASH_COMMANDS.flatMap(command => [command.name, ...(command.aliases ?? [])])])
    for (const skill of userSkillCommands(this.#skills, names)) {
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
      this.#skills = []
    } else {
      const cwd = currentWorkingDirectory(this.#ctx, agent.session)
      const list = await skills.list({ cwd, scope: agent, signal })
      if (this.#disposed || this.agent !== agent || currentWorkingDirectory(this.#ctx, agent.session) !== cwd) return
      this.#skills = list
    }
    this.#pushCommands()
  }

  async #findUserSkill(name: string, signal: AbortSignal): Promise<SkillSummary | undefined> {
    const agent = this.#requiredAgent()
    const skills = this.#ctx.get('skills')
    if (skills === undefined) return undefined
    const list = await skills.list({ cwd: currentWorkingDirectory(this.#ctx, agent.session), scope: agent, signal })
    return list.find(skill => skill.name === name && isUserInvocable(skill))
  }

  #lookupSession = (id: string): Session | undefined => this.#ctx.get('sessions')?.get(SessionId(id))

  /** Route live output only to the visible session; background frames remain buffered for inspection. */
  #forwardLiveDelta(agent: Agent, delta: StreamDelta): void {
    const active = this.#active
    if (active !== undefined && agent.session.id === active.handle.agent.session.id) {
      if (this.#inspectedId === undefined) this.#tui.streamDelta(delta)
      return
    }
    if (agent.session.id === this.#inspectedId) {
      this.#tui.streamDelta(delta)
      return
    }
  }

  /**
   * Replay the buffered live deltas of one session after a transcript
   * rebuild. The durable log only carries settlements, so a rebuilt state
   * starts without any in-flight prefix; re-folding the buffered chunks
   * restores it without waiting for the next frame.
   */
  #replayLivePrefix(sessionId: string): void {
    for (const key of this.#streamAttempts.activeKeys()) {
      if (!key.startsWith(`${sessionId}:`)) continue
      for (const delta of this.#streamAttempts.deltas(key)) this.#tui.streamDelta(delta)
    }
  }

  #inspectView(id: string, fallbackPhase: TuiInspectedSubagent['phase'] = 'waiting'): TuiInspectedSubagent {
    const view = this.#tracker.snapshot()?.agents.find(agent => agent.id === id)
    const mode = view?.mode
    return {
      id,
      label: view?.label ?? id,
      phase: view?.phase ?? fallbackPhase,
      needsApproval: view?.needsApproval === true,
      ...(mode === undefined ? {} : { mode }),
      writable: isSteerableSubagent(mode),
    }
  }

  #pushSessionInfo(): void {
    const active = this.#active
    if (active === undefined) return
    const agent = active.handle.agent
    const projection = this.#projection(active)
    // One snapshot feeds both folds; each append invalidates the session's
    // cached snapshot, so a second call would pay another O(log) copy.
    const events = agent.session.snapshotEvents()
    const title = explicitSessionTitle(events)
    this.#tui.setSession({
      id: agent.id,
      ...(title === undefined ? {} : { title }),
      recent: this.#recent.filter(row => row.id !== agent.id && !this.#archivedSessions.has(row.id)),
      stats: sessionStats(events, active.contextWindow, projection),
      controls: this.#sessionControls(active, projection),
    })
  }

  #replaceTranscript(agent: Agent, reason: TuiTranscriptReplacement = 'refresh'): void {
    this.#tui.setWorkingDirectory?.(currentWorkingDirectory(this.#ctx, agent.session))
    const events = agent.session.snapshotEvents()
    this.#tui.pendingInputs?.reconcile?.(agent.id, new Set(events.flatMap(event =>
      event.type === 'agent/inbox/spliced' ? event.data.inserted.map(message => message.id) : [])))
    this.#tracker.observeCatalog(agent.session, events)
    this.#tui.replaceSession(events, this.#ctx.get('tuiToolPresentation')?.session(agent, events), agent.status, reason)
    this.#replayLivePrefix(agent.session.id)
  }

  #replaceVisibleTranscript(): void {
    if (this.#inspectedId !== undefined) {
      void this.#inspectSubagent(this.#inspectedId)
      return
    }
    const agent = this.#active?.handle.agent
    if (agent !== undefined) this.#replaceTranscript(agent)
  }

  #cancelInspectDeliveries(): void {
    for (const delivery of this.#inspectDeliveries) delivery.abort()
    this.#inspectDeliveries.clear()
  }

  #closeInspect(): void {
    if (this.#inspectedId === undefined) return
    this.#inspectEpoch += 1
    this.#queueAbort?.abort(new Error('viewed session changed'))
    this.#workflowAbort?.abort()
    this.#cancelInspectDeliveries()
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
    if (!this.#tracker.owns(id)) {
      this.#tui.notice('That subagent is no longer available.', { level: 'error' })
      return
    }
    if (this.#tracker.snapshot()?.agents.find(agent => agent.id === id)?.mode === 'external') {
      this.#tui.notice('External executions have no local transcript. Their results appear in the parent session.')
      return
    }
    const live = this.#ctx.get('sessions')?.get(SessionId(id))
    let cwd = live === undefined ? undefined : currentWorkingDirectory(this.#ctx, live)
    let events: readonly SessionEvent[]
    if (live !== undefined) {
      events = live.ownEvents()
    } else {
      try {
        const persistence = this.#ctx.get('sessionPersistence')
        const log = persistence === undefined ? undefined : await readColdSessionLog(persistence, SessionId(id))
        if (log === undefined) throw new Error('subagent transcript is unavailable')
        events = log.events.slice(log.inheritedEventCount)
        const change = log.events.findLast(event => event.type === 'working-directory/change')
        cwd = change?.type === 'working-directory/change' ? change.data.cwd : log.header.cwd
      } catch {
        if (request === this.#inspectEpoch) {
          this.#tui.notice('Unable to open that subagent transcript.', { level: 'error' })
        }
        return
      }
    }
    if (request !== this.#inspectEpoch) return
    if (this.#inspectedId !== id) {
      this.#queueAbort?.abort(new Error('viewed session changed'))
      this.#workflowAbort?.abort()
      this.#cancelInspectDeliveries()
    }
    this.#tui.pendingInputs?.reconcile?.(id, new Set(events.flatMap(event =>
      event.type === 'agent/inbox/spliced' ? event.data.inserted.map(message => message.id) : [])))
    this.#inspectedId = id
    if (cwd !== undefined) this.#tui.setWorkingDirectory?.(cwd)
    const child = this.#ctx.get('agents')?.get(SessionId(id))
    this.#tui.replaceSession(
      events,
      child === undefined ? undefined : this.#ctx.get('tuiToolPresentation')?.session(child, events),
      child?.status ?? 'idle',
      'refresh',
    )
    this.#replayLivePrefix(id)
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
      this.#tui.restoreInput(submission, childId)
      return
    }
    const view = this.#inspectView(childId)
    if (!view.writable) {
      this.#tui.restoreInput(submission, childId)
      this.#tui.notice('This subagent is a completed run and cannot take more messages.')
      return
    }
    const live = this.#ctx.get('sessions')?.get(SessionId(childId))
    const rosterParent = this.#tracker.snapshot()?.agents.find(agent => agent.id === childId)?.parentId
    const parentId = live?.header.parentSession ?? rosterParent
    const parent = parentId === undefined || parentId === root.id
      ? root
      : this.#ctx.get('agents')?.get(SessionId(parentId))
    const subagents = this.#ctx.get('subagents')
    if (parent === undefined || subagents === undefined) {
      this.#tui.restoreInput(submission, childId)
      this.#tui.notice(parent === undefined
        ? 'The parent of this subagent is not live, so it cannot take a follow-up.'
        : 'Subagent follow-up is unavailable in this composition.')
      return
    }
    const previous = this.#inspectDeliveryTail
    let release: () => void = () => {}
    this.#inspectDeliveryTail = new Promise<void>(resolve => { release = resolve })
    const delivery = new AbortController()
    this.#inspectDeliveries.add(delivery)
    let cancelUpload: () => void = () => {}
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancelUpload = () => { reject(delivery.signal.reason) }
      delivery.signal.addEventListener('abort', cancelUpload, { once: true })
    })
    try {
      // Recalled messages can include attachments; admission must retain submission order.
      await Promise.race([previous, cancelled])
      delivery.signal.throwIfAborted()
      // Attachment storage need not support cancellation; release the draft now
      // and ignore a later upload result before crossing Harness admission.
      const message = await Promise.race([createSubmissionMessage(submission, this.#ctx.get('attachments')), cancelled])
      delivery.signal.removeEventListener('abort', cancelUpload)
      delivery.signal.throwIfAborted()
      if (this.#inspectedId !== childId || this.#active?.handle.agent !== root) throw new Error('The viewed session changed before delivery.')
      const send = submission.delivery === 'steer' ? steerHostSubagentPrompt : queueHostSubagentPrompt
      const messageId = await send(subagents, parent, SessionId(childId), message.content,
        { kind: 'user' }, delivery.signal)
      this.#tui.pendingInputs?.prepare?.(submission, messageId)
      this.#tui.pendingInputs?.acknowledge?.(submission)
    } catch (error: unknown) {
      this.#tui.restoreInput(submission, childId)
      if (!delivery.signal.aborted) this.#tui.notice(error instanceof Error ? error.message : String(error), { level: 'error' })
    } finally {
      delivery.signal.removeEventListener('abort', cancelUpload)
      this.#inspectDeliveries.delete(delivery)
      release()
    }
  }

  #sessionControls(active: ActiveSession, projection: TuiStatsProjection | undefined): TuiSessionControls {
    const liveGoal = this.#ctx.get('goals')?.get(active.handle.agent)
    const controls = sessionControls(projection, this.#ctx.get('planMode')?.get(active.handle.agent))
    if (controls.goal !== undefined && liveGoal !== undefined && liveGoal.id === projection?.goal?.goal.id && liveGoal.revision === projection?.goal?.goal.revision) {
      controls.goal.activation = liveGoal.activation
    }
    const failure = active.handle.agent.status === 'idle' ? continuableFailure(active.handle.agent.session.snapshotEvents()) : undefined
    return {
      ...controls,
      ...(failure === undefined ? {} : { continuation: failure }),
      agentPreset: active.agentPreset,
    }
  }

  /** Read one client-visible snapshot. Host-only projection state is never consulted. */
  #projection(active: ActiveSession): TuiStatsProjection | undefined {
    return this.#ctx.get('sessionProjections')?.snapshot(active.handle.agent.session).values
  }

  #stats(active: ActiveSession, projection: TuiStatsProjection | undefined = this.#projection(active)): TuiSessionStats {
    const agent = active.handle.agent
    return sessionStats(agent.session.snapshotEvents(), active.contextWindow, projection)
  }

  #requiredActive(): ActiveSession {
    if (this.#active === undefined) throw new Error('no active session')
    return this.#active
  }

  #requiredAgent(): Agent {
    return this.#requiredActive().handle.agent
  }

  async #disposeRetired(): Promise<void> {
    await this.#disposeHandles(this.#retired.splice(0))
  }

  async #disposeHandles(handles: readonly AgentHandle[]): Promise<void> {
    if (handles.length === 0) return
    try { await this.#ctx.get('subagents')?.drainDescendants(handles.map(handle => handle.agent)) }
    catch (error) { this.#ctx.logger.warn(error) }
    finally { await Promise.allSettled(handles.map(handle => handle.dispose())) }
  }
}

/** Candidates for an argument prefix, matched the way the command list matches. */
export function matchArgumentOptions(
  options: readonly TuiArgumentOption[],
  prefix: string,
): readonly TuiArgumentOption[] {
  const lower = prefix.trim().toLowerCase()
  if (lower === '') return options
  return options.filter(option => option.value.toLowerCase().includes(lower)
    || (option.label ?? '').toLowerCase().includes(lower)
    || (option.description ?? '').toLowerCase().includes(lower))
}
