/**
 * Active-agent/session control plane for the terminal runner.
 *
 * This is the deep module between Harness runtime services and the TUI:
 * create/resume/switch, command dispatch, model selection, recent sessions,
 * statistics, queue controls, and lifecycle cleanup stay behind one API.
 * @module @omdsh/tui/session-controller
 */

import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import {
  installModelSelection,
  type Agent,
  type AgentHandle,
  type ModelSelection,
  type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { isTokenDelta } from '@deepseek-ai/dsh-llm/message'
import type {} from '@deepseek-ai/dsh-commands'
import { isUserInvocable, type SkillSummary } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats/types'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-session-query'
import type { ContextPressureProjection, TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-attachment'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { TuiCommand, TuiRecentSession, TuiService, TuiSessionStats } from './definition.ts'
import { formatTranscriptMarkdown } from './transcript-export.ts'

const CONTROL_COMMANDS: readonly TuiCommand[] = [
  { name: 'new', description: 'Start a new session' },
  { name: 'resume', description: 'Resume a durable session', inputHint: '[session-id]' },
  { name: 'session', description: 'Show current session details' },
  { name: 'model', description: 'Select provider, model, and reasoning effort' },
  { name: 'retry', description: 'Run the most recent human prompt again' },
  { name: 'steer', description: 'Send guidance to the next model step', inputHint: '<message>' },
  { name: 'queue', description: 'Show queued follow-up and steering messages' },
  { name: 'dequeue', description: 'Clear queued follow-up and steering messages' },
  { name: 'todo', description: 'Show the current session todo list' },
  { name: 'mcp', description: 'Show connected MCP servers and tools' },
  { name: 'attach', description: 'Attach a PNG/JPEG/WebP/GIF as an image-only prompt', inputHint: '<path>' },
  { name: 'search', description: 'Search this transcript, or all sessions with --all', inputHint: '[--all] <query>' },
  { name: 'export', description: 'Export the complete transcript as Markdown', inputHint: '[path]' },
]

interface ActiveSession {
  handle: AgentHandle
  selection: ModelSelectionRef
  contextWindow: number | undefined
}

function parseControl(line: string): { name: string; input: string } | undefined {
  const match = /^\/([a-z][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)?)(?:\s+(.*))?$/su.exec(line.trim())
  if (match === null || match[1] === undefined) return undefined
  return { name: match[1].toLowerCase(), input: match[2]?.trim() ?? '' }
}

function humanText(event: SessionEvent): string | undefined {
  if (event.type !== 'user/message' || event.data.source.kind !== 'user') return undefined
  const text = event.data.content
    .filter((block): block is Extract<(typeof event.data.content)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  return text === '' ? undefined : text
}

/** Projection values consumed as one consistent snapshot when the units exist. */
export interface TuiStatsProjection {
  sessionStats?: SessionStatsProjection
  tokenUsage?: TokenUsageProjection
  contextPressure?: ContextPressureProjection
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

function sessionTitle(events: readonly SessionEvent[], fallback: string): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type === 'session/title') return event.data.title
  }
  return fallback
}

function formatAge(createdAt: number): string {
  const elapsed = Math.max(0, Date.now() - createdAt)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
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

/** Render the MCP subset of the unified Harness tool catalog. */
export function mcpCatalogText(tools: readonly { name: string; description: string }[]): string {
  const servers = new Map<string, Array<{ name: string; description: string }>>()
  for (const tool of tools) {
    const match = /^mcp__(.+?)__(.+)$/u.exec(tool.name)
    if (match?.[1] === undefined || match[2] === undefined) continue
    const rows = servers.get(match[1]) ?? []
    rows.push({ name: match[2], description: compactDescription(tool.description) })
    servers.set(match[1], rows)
  }
  if (servers.size === 0) {
    return 'No MCP tools are connected. Configure .dsh/mcp.json or ~/.dsh/mcp.json, then restart omdsh.'
  }
  return [...servers].map(([server, rows]) => [
    `${server} · ${rows.length} tool${rows.length === 1 ? '' : 's'}`,
    ...rows.map(row => `  ${row.name}${row.description === '' ? '' : ` — ${row.description}`}`),
  ].join('\n')).join('\n\n')
}

/** Own one switchable top-level Agent and project it onto a TuiService. */
export class SessionController {
  readonly #ctx: Context
  readonly #tui: TuiService
  #active: ActiveSession | undefined
  #recent: TuiRecentSession[] = []
  #skillCommands: TuiCommand[] = []
  #toolCatalog: Array<{ name: string; description: string }> = []
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
      tui.event(event)
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
      this.#off.push(ctx.on('tools/change', () => { this.#pushTools() }))
    }
    const projections = ctx.get('sessionProjections')
    if (projections !== undefined) {
      this.#off.push(projections.onChanged((session, key) => {
        if (session !== this.#active?.handle.agent.session) return
        if (key === 'sessionStats' || key === 'tokenUsage' || key === 'contextPressure') this.#pushSessionInfo()
      }))
    }
  }

  get agent(): Agent | undefined {
    return this.#active?.handle.agent
  }

  async start(): Promise<void> {
    const defaults = this.#ctx.get('agentDefaultModel')?.currentSelection()
    if (defaults === undefined) throw new Error('agent default model is unavailable')
    await this.#activate(await this.#create(defaults))
    await this.refreshRecent()
  }

  /** Submit ordinary human text; active turns retain it as a later follow-up. */
  send(text: string): void {
    const agent = this.#requiredAgent()
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  }

  /** Execute a runner-owned or plugin-owned slash command. */
  async execute(line: string, signal: AbortSignal): Promise<boolean> {
    const parsed = parseControl(line)
    if (parsed === undefined) return false
    if (CONTROL_COMMANDS.some(command => command.name === parsed.name)) {
      await this.#executeControl(parsed.name, parsed.input, signal)
      return true
    }
    const commands = this.#ctx.get('commands')
    const execution = await commands?.execute(this.#requiredAgent(), line, signal)
    if (execution === undefined) {
      const skill = await this.#findUserSkill(skillNameFromCommand(parsed.name), signal)
      if (skill === undefined) return false
      this.send('/' + skill.name + (parsed.input === '' ? '' : ' ' + parsed.input))
      return true
    }
    const result = execution.result
    if (result.text !== undefined) this.#tui.notice(result.text, result.kind === 'error' ? 'error' : 'info')
    return true
  }

  async refreshRecent(): Promise<void> {
    const persistence = this.#ctx.get('sessionPersistence')
    if (persistence === undefined) {
      this.#recent = []
      this.#pushSessionInfo()
      return
    }
    const headers = (await persistence.list()).filter(header => header.origin !== 'subagent')
      .sort((left, right) => right.createdAt - left.createdAt).slice(0, 8)
    const rows: TuiRecentSession[] = []
    for (const header of headers) {
      try {
        const inspected = await persistence.inspect(header.id)
        rows.push({
          id: header.id,
          title: sessionTitle(inspected.events, header.id),
          createdAt: header.createdAt,
        })
      } catch {
        rows.push({ id: header.id, title: header.id, createdAt: header.createdAt })
      }
    }
    this.#recent = rows
    this.#pushSessionInfo()
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    for (const off of this.#off.splice(0).reverse()) off()
    await this.#active?.handle.dispose()
    this.#active = undefined
  }

  async #executeControl(name: string, input: string, signal: AbortSignal): Promise<void> {
    switch (name) {
      case 'new':
        if (input !== '') return this.#usage('/new')
        if (this.#requiredAgent().status === 'running') return this.#tui.notice('Finish or interrupt the active turn before starting a new session.', 'error')
        await this.#activate(await this.#create(this.#selection()))
        await this.refreshRecent()
        this.#tui.notice('Started a new session.')
        return
      case 'resume':
        await this.#resume(input, signal)
        return
      case 'session':
        this.#showSession()
        return
      case 'model':
        await this.#selectModel(signal)
        return
      case 'retry':
        this.#retry()
        return
      case 'steer':
        if (input === '') return this.#usage('/steer <message>')
        this.#requiredAgent().steer(createUserMessage({ content: [{ type: 'text', text: input }], source: { kind: 'user' } }))
        this.#tui.notice('Steering queued for the next step.')
        return
      case 'queue':
        this.#showQueue()
        return
      case 'dequeue':
        this.#clearQueue()
        return
      case 'todo':
        this.#showTodo()
        return
      case 'mcp':
        if (input !== '') return this.#usage('/mcp')
        this.#tui.notice(mcpCatalogText(this.#toolCatalog))
        return
      case 'attach':
        await this.#attach(input)
        return
      case 'search':
        await this.#search(input, signal)
        return
      case 'export':
        await this.#export(input)
        return
    }
  }

  async #resume(input: string, signal: AbortSignal): Promise<void> {
    const persistence = this.#ctx.get('sessionPersistence')
    if (persistence === undefined) return this.#tui.notice('Session persistence is not configured.', 'error')
    if (this.#requiredAgent().status === 'running') return this.#tui.notice('Finish or interrupt the active turn before resuming another session.', 'error')
    await this.refreshRecent()
    let id = input
    if (id === '') {
      if (this.#recent.length === 0) return this.#tui.notice('No durable sessions found.')
      const answer = await this.#tui.prompt({
        title: 'Resume session',
        question: 'Choose a session',
        options: this.#recent.map(row => ({ label: row.id, description: `${row.title} · ${formatAge(row.createdAt)}` })),
        signal,
      })
      if (answer === null) return
      const index = /^\d+$/u.test(answer) ? Number(answer) - 1 : -1
      id = index >= 0 ? (this.#recent[index]?.id ?? answer) : answer
    }
    if (id === this.#requiredAgent().id) return this.#tui.notice('That session is already active.')
    try {
      const selection = this.#selection()
      const ref: ModelSelectionRef = { current: selection, assembled: undefined }
      const handle = await this.#ctx.agents.resume({
        resumeSessionId: SessionId(id),
        agentOptions: { provider: selection.provider, model: selection.model },
        signal,
        setup: agentCtx => { installModelSelection(agentCtx, ref) },
      })
      await this.#activate({ handle, selection: ref, contextWindow: undefined })
      await this.refreshRecent()
      this.#tui.notice(`Resumed ${id}.`)
    } catch (error: unknown) {
      this.#tui.notice('Resume failed: ' + (error instanceof Error ? error.message : String(error)), 'error')
    }
  }

  async #selectModel(signal: AbortSignal): Promise<void> {
    const llm = this.#ctx.get('llm')
    if (llm === undefined) return this.#tui.notice('Model directory is unavailable.', 'error')
    const providers = llm.listProviders()
    if (providers.length === 0) return this.#tui.notice('No model providers are registered.', 'error')
    const current = this.#selection()
    const providerRaw = await this.#tui.prompt({
      title: 'Model provider',
      question: 'Choose a provider',
      options: providers.map(provider => ({ label: provider.id, description: provider.name })),
      signal,
    })
    if (providerRaw === null) return
    const providerIndex = /^\d+$/u.test(providerRaw) ? Number(providerRaw) - 1 : -1
    const provider = providerIndex >= 0 ? providers[providerIndex]?.id : providerRaw
    if (provider === undefined || !providers.some(entry => entry.id === provider)) {
      return this.#tui.notice(`Unknown provider: ${providerRaw}`, 'error')
    }
    const models = await llm.listModels(provider)
    const modelRaw = await this.#tui.prompt({
      title: 'Model',
      question: `Choose a model for ${provider}`,
      options: models.map(model => ({ label: model.id, description: model.description ?? model.name })),
      signal,
    })
    if (modelRaw === null) return
    const modelIndex = /^\d+$/u.test(modelRaw) ? Number(modelRaw) - 1 : -1
    const model = modelIndex >= 0 ? models[modelIndex]?.id : modelRaw
    if (model === undefined || !models.some(entry => entry.id === model)) {
      return this.#tui.notice(`Unknown model: ${modelRaw}`, 'error')
    }
    const info = await llm.resolveModelInfo(provider, model, signal)
    let reasoningEffort = current.reasoningEffort
    if (info.reasoning !== undefined) {
      const effortRaw = await this.#tui.prompt({
        title: 'Reasoning effort',
        question: 'Choose reasoning effort',
        options: info.reasoning.efforts.map(effort => ({ label: String(effort.id), description: effort.description ?? effort.name })),
        signal,
      })
      if (effortRaw === null) return
      const effortIndex = /^\d+$/u.test(effortRaw) ? Number(effortRaw) - 1 : -1
      const effort = effortIndex >= 0 ? info.reasoning.efforts[effortIndex]?.id : ReasoningEffortId(effortRaw)
      if (effort === undefined || !info.reasoning.efforts.some(entry => entry.id === effort)) {
        return this.#tui.notice(`Unknown reasoning effort: ${effortRaw}`, 'error')
      }
      reasoningEffort = effort
    } else {
      reasoningEffort = undefined
    }
    const selection: ModelSelection = {
      provider,
      model,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    }
    const active = this.#requiredActive()
    active.selection.current = selection
    active.contextWindow = info.context?.contextWindow
    this.#tui.setModel(model)
    this.#pushSessionInfo()
    await this.#ctx.get('agentDefaultModel')?.saveSelection(selection)
    this.#tui.notice(`Model: ${provider}/${model}${reasoningEffort === undefined ? '' : ` (${String(reasoningEffort)})`}`)
  }

  #retry(): void {
    const events = this.#requiredAgent().session.events
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const text = humanText(events[i] as SessionEvent)
      if (text === undefined) continue
      this.send(text)
      this.#tui.notice('Re-running the most recent human prompt as a new turn.')
      return
    }
    this.#tui.notice('No human prompt is available to retry.')
  }

  #showQueue(): void {
    const inbox = this.#requiredAgent().inbox
    const lines = [
      `Follow-ups: ${inbox.nextTurn.length}`,
      ...inbox.nextTurn.map((message, index) => `  ${index + 1}. ${message.content.map(block => block.type === 'text' ? block.text : `[${block.type}]`).join('')}`),
      `Steering: ${inbox.nextStep.length}`,
      ...inbox.nextStep.map((message, index) => `  ${index + 1}. ${message.content.map(block => block.type === 'text' ? block.text : `[${block.type}]`).join('')}`),
    ]
    this.#tui.notice(lines.join('\n'))
  }

  #clearQueue(): void {
    const inbox = this.#requiredAgent().inbox
    const count = inbox.nextTurn.length + inbox.nextStep.length
    inbox.splice('next-turn', 0, inbox.nextTurn.length, [])
    inbox.splice('next-step', 0, inbox.nextStep.length, [])
    this.#tui.notice(`Removed ${count} queued message${count === 1 ? '' : 's'}.`)
  }

  #showTodo(): void {
    const event = this.#requiredAgent().session.events.findLast(item => item.type === 'todo/write')
    if (event === undefined) return this.#tui.notice('No todo list has been recorded.')
    const todos = event.data.todos
    this.#tui.notice(['Todo', ...todos.map((todo, index) => `${index + 1}. [${todo.status}] ${todo.content}`)].join('\n'))
  }

  async #attach(input: string): Promise<void> {
    if (input === '') return this.#usage('/attach <image-path>')
    const attachments = this.#ctx.get('attachments')
    if (attachments === undefined) return this.#tui.notice('Attachment storage is not configured.', 'error')
    const unquoted = input.replace(/^(?:"(.*)"|'(.*)')$/u, '$1$2')
    const path = resolve(unquoted.startsWith('~/') ? homedir() + unquoted.slice(1) : unquoted)
    const mediaTypes: Record<string, ImageMediaType> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.webp': 'image/webp', '.gif': 'image/gif',
    }
    const mediaType = mediaTypes[extname(path).toLowerCase()]
    if (mediaType === undefined) return this.#tui.notice('Supported images: PNG, JPEG, WebP, GIF.', 'error')
    try {
      const data = await readFile(path)
      const name = path.split('/').at(-1)
      const attachment = await attachments.saveImage({
        data,
        mediaType,
        ...(name === undefined ? {} : { name }),
      })
      this.#requiredAgent().followup(createUserMessage({
        content: [{ type: 'image', attachment }],
        source: { kind: 'user' },
      }))
      this.#tui.notice(`Attached ${path.split('/').at(-1) ?? path} (${attachment.width}×${attachment.height}).`)
    } catch (error: unknown) {
      this.#tui.notice('Attach failed: ' + (error instanceof Error ? error.message : String(error)), 'error')
    }
  }

  async #search(input: string, signal: AbortSignal): Promise<void> {
    const all = input === '--all' || input.startsWith('--all ')
    const query = (all ? input.slice('--all'.length) : input).trim()
    if (query === '') return this.#usage('/search [--all] <query>')
    const service = this.#ctx.get('sessionQuery')
    if (service === undefined) return this.#tui.notice('Session search is not configured.', 'error')
    try {
      if (all) {
        const page = await service.searchSessions({ query, limit: 20 }, { signal })
        const lines = page.items.map((hit, index) =>
          `${index + 1}. ${hit.header.id} · #${hit.bestMatch.seq} ${hit.bestMatch.type}\n   ${hit.bestMatch.snippet}`)
        this.#tui.notice(lines.length === 0 ? `No sessions match “${query}”.` : `Session matches for “${query}”\n\n${lines.join('\n')}`)
      } else {
        const sessionId = this.#requiredAgent().session.id
        const page = await service.searchEvents({ sessionId, query, limit: 30 }, { signal })
        const lines = page.items.map((hit, index) => `${index + 1}. #${hit.seq} ${hit.type}\n   ${hit.snippet}`)
        this.#tui.notice(lines.length === 0 ? `No transcript matches “${query}”.` : `Transcript matches for “${query}”\n\n${lines.join('\n')}`)
      }
    } catch (error: unknown) {
      if (signal.aborted) return
      this.#tui.notice('Search failed: ' + (error instanceof Error ? error.message : String(error)), 'error')
    }
  }

  async #export(input: string): Promise<void> {
    const agent = this.#requiredAgent()
    const unquoted = input.replace(/^(?:"(.*)"|'(.*)')$/u, '$1$2')
    const fallback = `omdsh-transcript-${agent.id}.md`
    const path = resolve(unquoted === '' ? fallback : (unquoted.startsWith('~/') ? homedir() + unquoted.slice(1) : unquoted))
    const title = sessionTitle(agent.session.events, agent.id)
    try {
      await writeFile(path, formatTranscriptMarkdown(agent.id, title, agent.session.events), { encoding: 'utf8', mode: 0o600 })
      this.#tui.notice(`Exported complete transcript to ${path}`)
    } catch (error: unknown) {
      this.#tui.notice('Export failed: ' + (error instanceof Error ? error.message : String(error)), 'error')
    }
  }

  #showSession(): void {
    const active = this.#requiredActive()
    const agent = active.handle.agent
    const stats = this.#stats(active)
    this.#tui.notice([
      `Session: ${agent.id}`,
      `Model: ${this.#selection().provider}/${this.#selection().model}`,
      `Turns: ${stats.turns} · Steps: ${stats.steps}`,
      `Tokens: ${stats.inputTokens} in · ${stats.outputTokens} out`,
      `Queued: ${agent.inbox.nextTurn.length} follow-up · ${agent.inbox.nextStep.length} steering`,
    ].join('\n'))
  }

  #usage(text: string): void {
    this.#tui.notice('Usage: ' + text, 'error')
  }

  async #create(selection: ModelSelection): Promise<ActiveSession> {
    const ref: ModelSelectionRef = { current: selection, assembled: undefined }
    const handle = await this.#ctx.agents.create({
      sessionId: SessionId('session-' + randomUUID()),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: agentCtx => { installModelSelection(agentCtx, ref) },
    })
    return { handle, selection: ref, contextWindow: undefined }
  }

  async #activate(next: ActiveSession): Promise<void> {
    const previous = this.#active
    this.#active = next
    const agent = next.handle.agent
    this.#tui.setModel(this.#selection().model)
    this.#tui.setStatus(agent.status)
    this.#tui.replaceSession(agent.session.events)
    this.#pushTools()
    try {
      const llm = this.#ctx.get('llm')
      const selected = this.#selection()
      next.contextWindow = llm === undefined
        ? undefined
        : (await llm.resolveModelInfo(selected.provider, selected.model)).context?.contextWindow
    } catch {
      next.contextWindow = undefined
    }
    await this.#refreshSkills()
    this.#pushSessionInfo()
    if (previous !== undefined) await previous.handle.dispose()
  }

  #pushCommands(): void {
    const agent = this.agent
    const runtime = agent === undefined ? [] : (this.#ctx.get('commands')?.list(agent) ?? [])
    const commands: TuiCommand[] = [
      ...CONTROL_COMMANDS,
      ...runtime.map(command => ({
        name: command.name,
        description: command.description,
        ...(command.input?.hint === undefined ? {} : { inputHint: command.input.hint }),
      })),
    ]
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
    this.#toolCatalog = agent === undefined
      ? []
      : (this.#ctx.get('tools')?.schemas(agent).map(schema => ({
          name: schema.name,
          description: schema.description,
        })) ?? [])
    this.#tui.setTools(this.#toolCatalog)
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
    this.#tui.setSession({
      id: agent.id,
      recent: this.#recent.filter(row => row.id !== agent.id),
      stats: this.#stats(active),
    })
  }

  /** Read one consistent projection cut, with the complete-log fold as fallback. */
  #stats(active: ActiveSession): TuiSessionStats {
    const agent = active.handle.agent
    const values = this.#ctx.get('sessionProjections')?.snapshot(agent.session).values
    return sessionStats(agent.session.events, active.contextWindow, values)
  }

  #selection(): ModelSelection {
    const current = this.#requiredActive().selection.current
    if (current === undefined) throw new Error('active agent has no model selection')
    return current
  }

  #requiredActive(): ActiveSession {
    if (this.#active === undefined) throw new Error('no active session')
    return this.#active
  }

  #requiredAgent(): Agent {
    return this.#requiredActive().handle.agent
  }
}
