/** Durable side consultations over the public Harness Agent and fork seams. */

import { Context, Service } from '@deepseek-ai/cordis'
import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent, AgentHandle, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { Session, SessionId, SessionLogOffset, buildForkSeed, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-plan-mode'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { deriveTurnTokenUsage, type TurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import { configureAgentContext } from './agent-profile.ts'
import { BTW_PRESET } from './btw-policy.ts'
import { currentWorkingDirectory } from '../session/working-directory.ts'
import { blocksText } from '../session/content-text.ts'
import { readColdSessionLog } from '@deepseek-ai/dsh-session-query'

export interface BtwTopic {
  version: 1
  sessionId: string
  parentSessionId: string
  prefixEvents: number
  question: string
  createdAt: number
  updatedAt: number
  status: 'running' | 'completed' | 'cancelled' | 'failed'
}
export interface BtwReply { topic: BtwTopic; text: string; usage?: TurnTokenUsage; error?: string }
export interface Config { stateDir?: string }

declare module '@deepseek-ai/cordis' { interface Context { omdshBtw: BtwService } }

/** Preserve the exact source prefix, then select the child's independent world. */
export function btwSeed(parent: Session, id: SessionId, cwd: string): readonly SessionEvent[] {
  const prefix = parent.snapshotEvents()
  const seed = prefix.length === 0 ? [] : buildForkSeed(prefix, prefix.at(-1)!.seq)
  const snapshot = Session.create(id, seed, { id, version: SESSION_FORMAT_VERSION, createdAt: Date.now(), cwd,
    parentSession: parent.id, isSeeded: true, agentPreset: BTW_PRESET }, SessionLogOffset(prefix.length))
  snapshot.append('agent-preset/selected', { agentPreset: BTW_PRESET })
  return snapshot.snapshotEvents()
}

function lastTurn(events: readonly SessionEvent[]): readonly SessionEvent[] {
  const at = events.findLastIndex(event => event.type === 'turn/start')
  return at < 0 ? [] : events.slice(at)
}

export class BtwService extends Service {
  static inject = ['agents', 'agentPresets', 'sessions', 'permissionPresets']
  private readonly ownerContext: Context
  private readonly stateDir: string | undefined
  private readonly topics = new Map<string, BtwTopic>()
  private readonly active = new Map<Agent, AbortController>()
  private readonly tasks = new Set<Promise<BtwReply>>()
  private readonly closing = new AbortController()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'omdshBtw')
    this.ownerContext = ctx
    this.stateDir = config.stateDir
    if (this.stateDir !== undefined) {
      let names: string[]
      try { names = readdirSync(this.stateDir) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; names = [] }
      for (const name of names.filter(name => name.endsWith('.json'))) {
        const topic: unknown = JSON.parse(readFileSync(join(this.stateDir, name), 'utf8'))
        if (!validTopic(topic)) throw new Error(`Invalid side consultation record: ${name}`)
        this.topics.set(topic.sessionId, { ...topic, status: topic.status === 'running' ? 'cancelled' : topic.status })
      }
    }
    ctx.on('agent/disposed', ({ agent }) => { this.active.get(agent)?.abort(new Error('The parent session was closed.')) })
    ctx.effect(() => async () => { this.closing.abort(new Error('Side consultations unloaded.')); await Promise.allSettled(this.tasks) }, 'side consultation lifetime')
  }

  list(parent: Agent): BtwTopic[] {
    return [...this.topics.values()].filter(topic => topic.parentSessionId === parent.id)
      .sort((left, right) => right.updatedAt - left.updatedAt).map(topic => ({ ...topic }))
  }

  async read(parent: Agent, id: string, signal: AbortSignal): Promise<string> {
    const topic = this.topics.get(id)
    if (topic?.parentSessionId !== parent.id) throw new Error('That side consultation belongs to another session or is unavailable.')
    const persistence = this.ownerContext.get('sessionPersistence')
    if (persistence === undefined) throw new Error('Session persistence is required to read a saved side consultation.')
    const log = await readColdSessionLog(persistence, SessionId(id), signal)
    if (log.header.parentSession !== parent.id || log.inheritedEventCount !== topic.prefixEvents) throw new Error('The saved consultation no longer matches its parent snapshot.')
    return log.events.slice(log.inheritedEventCount).flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user'
      ? ['### Question\n\n' + blocksText(event.data.content)]
      : event.type === 'assistant/message' ? [blocksText(event.data.message.content)] : []).join('\n\n')
  }

  consult(parent: Agent, question: string, selection: ModelSelection, signal: AbortSignal,
    update: (text: string) => void, topicId?: string): Promise<BtwReply> {
    if (this.active.has(parent)) throw new Error('A side consultation is already running for this session.')
    if (question.trim() === '') throw new Error('Enter a side question.')
    if (this.ownerContext.get('sessionPersistence') === undefined) throw new Error('Session persistence is required for side consultations.')
    const abort = new AbortController()
    this.active.set(parent, abort)
    const task = this.runQuestion(parent, question, selection, AbortSignal.any([signal, abort.signal, this.closing.signal]), update, topicId)
      .finally(() => { this.active.delete(parent); this.tasks.delete(task) })
    this.tasks.add(task)
    return task
  }

  private async runQuestion(parent: Agent, question: string, selection: ModelSelection, signal: AbortSignal,
    update: (text: string) => void, topicId?: string): Promise<BtwReply> {
    const ctx = this.ownerContext
    const existing = topicId === undefined ? undefined : this.topics.get(topicId)
    if (topicId !== undefined && existing?.parentSessionId !== parent.id) throw new Error('That side consultation belongs to another session or is unavailable.')
    const id = SessionId(existing?.sessionId ?? 'session-' + randomUUID())
    const prefixEvents = existing?.prefixEvents ?? parent.session.snapshotEvents().length
    let topic: BtwTopic = existing === undefined ? { version: 1, sessionId: id, parentSessionId: parent.id, prefixEvents,
      question, createdAt: Date.now(), updatedAt: Date.now(), status: 'running' } : { ...existing, status: 'running', updatedAt: Date.now() }
    let handle: AgentHandle | undefined, text = '', attempt = ''
    const ref: ModelSelectionRef = { current: { ...selection }, assembled: undefined }
    const setup = async (agentCtx: Context, agent: Agent): Promise<void> => {
      const configured = await configureAgentContext(agentCtx, agent, ref)
      if (configured.agentPreset !== BTW_PRESET) throw new Error('The saved consultation no longer uses its tool-free composition.')
    }
    let offStream: (() => void) | undefined
    const cancel = (): void => { handle?.agent.cancel({ kind: 'user' }) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      signal.throwIfAborted()
      if (existing === undefined) {
        const cwd = currentWorkingDirectory(ctx, parent.session)
        const seed = btwSeed(parent.session, id, cwd)
        handle = await ctx.get('agents')!.create({ sessionId: id, seed, inheritedEventCount: SessionLogOffset(prefixEvents),
          meta: { cwd, parentSession: parent.id, isSeeded: true, agentPreset: BTW_PRESET }, agentOptions: { ...selection, maxTokens: 8192 }, signal, setup })
      } else {
        const stored = await ctx.get('sessionPersistence')!.stat(id, { signal })
        if (stored === undefined || stored.header.parentSession !== parent.id) throw new Error('The saved consultation no longer matches its parent session.')
        if (stored.formatStatus === 'migration-required') throw new Error('This consultation requires session-format migration before it can continue.')
        handle = await ctx.get('agents')!.resume({ resumeSessionId: id, agentOptions: { ...selection, maxTokens: 8192 }, signal, setup })
      }
      const agent = handle.agent
      signal.throwIfAborted()
      ctx.get('goals')?.disarm(agent)
      const goal = ctx.get('goals')?.get(agent)
      if (goal !== undefined) ctx.get('goals')!.clear(agent, goal)
      ctx.get('planMode')?.set(agent, false)
      ctx.get('permissionPresets')!.set(agent.session, 'read-only')
      if (existing === undefined) ctx.get('sessionTitles')?.rename(agent.session, 'Side question: ' + question)
      this.saveTopic(topic)
      offStream = agent.ctx.on('agent/assistant-stream', ({ frame }) => {
        if (frame.type === 'start') { attempt = ''; update('') }
        if (frame.type === 'chunk' && frame.chunk.type === 'text-delta') { attempt += frame.chunk.text; update(attempt) }
      })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: question }], source: { kind: 'user' } }))
      await agent.whenIdle()
      const events = lastTurn(agent.session.ownEvents())
      const message = events.findLast(event => event.type === 'assistant/message')
      text = message?.type === 'assistant/message' ? blocksText(message.data.message.content) : attempt
      update(text)
      const end = events.findLast(event => event.type === 'turn/end')
      const reason = end?.type === 'turn/end' ? end.data.reason : undefined
      const error = reason?.kind === 'error' ? reason.error.message : reason?.kind === 'completed' || signal.aborted ? undefined : `Side question ended without completion (${reason?.kind ?? 'no turn'}).`
      topic = { ...topic, updatedAt: Date.now(), status: signal.aborted ? 'cancelled' : reason?.kind === 'completed' ? 'completed' : 'failed' }
      await ctx.get('sessions')!.flush(agent.session)
      this.saveTopic(topic)
      const usage = deriveTurnTokenUsage(events)
      return { topic, text, ...(usage === undefined ? {} : { usage }), ...(error === undefined ? {} : { error }) }
    } catch (error) {
      topic = { ...topic, updatedAt: Date.now(), status: signal.aborted ? 'cancelled' : 'failed' }
      if (handle !== undefined) this.saveTopic(topic)
      return { topic, text: text || attempt, ...(signal.aborted ? {} : { error: error instanceof Error ? error.message : String(error) }) }
    } finally {
      signal.removeEventListener('abort', cancel)
      offStream?.()
      await handle?.dispose()
    }
  }

  private saveTopic(topic: BtwTopic): void {
    if (this.stateDir !== undefined) {
      mkdirSync(this.stateDir, { recursive: true })
      const path = join(this.stateDir, createHash('sha256').update(topic.sessionId).digest('hex') + '.json')
      const temp = path + '.' + randomUUID() + '.tmp'
      try { writeFileSync(temp, JSON.stringify(topic) + '\n', { mode: 0o600 }); renameSync(temp, path) }
      finally { rmSync(temp, { force: true }) }
    }
    this.topics.set(topic.sessionId, topic)
  }
}

function validTopic(value: unknown): value is BtwTopic {
  if (value === null || typeof value !== 'object') return false
  const item = value as Partial<BtwTopic>
  return item.version === 1 && typeof item.sessionId === 'string' && typeof item.parentSessionId === 'string'
    && typeof item.question === 'string' && Number.isSafeInteger(item.prefixEvents) && item.prefixEvents! >= 0
    && Number.isSafeInteger(item.createdAt) && Number.isSafeInteger(item.updatedAt)
    && ['running', 'completed', 'cancelled', 'failed'].includes(String(item.status))
}

export default BtwService
