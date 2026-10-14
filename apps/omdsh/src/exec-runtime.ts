/** Independent script consumer of the public Harness Agent lifecycle. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { configureAgentContext } from '@agi-fans/dsh-tui/agent-profile'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence-jsonl'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-stats/types'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-user-approval'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { ExecOutput, ExecResult } from './exec-output.ts'

export interface ExecRequest { prompt: string; resume?: string }

const EVENTS: Readonly<Record<string, string>> = {
  'turn/start': 'turn.started', 'turn/end': 'turn.finished', 'step/start': 'step.started', 'step/end': 'step.finished',
  'tool/call': 'tool.started', 'tool/result': 'tool.finished', 'tool/ptc-dispatch': 'tool.ptc_result',
  'approval/asked': 'approval.asked', 'approval/decided': 'approval.decided',
  'subagent/catalog': 'delegation.catalog', 'subagent/descriptor': 'delegation.descriptor',
}

function failure(error: unknown): { code: string; message: string } {
  return { code: 'RUN_FAILED', message: error instanceof Error ? error.message : String(error) }
}

/** Own one Agent, its observers, durable flush and managed-child drain. */
export async function executeAgent(ctx: Context, request: ExecRequest, output: ExecOutput, signal: AbortSignal): Promise<ExecResult> {
  const agents = ctx.get('agents'), defaults = ctx.get('agentDefaultModel'), presets = ctx.get('agentPresets')
  if (agents === undefined || defaults === undefined || presets === undefined) throw new Error('Script execution requires the Agent, model and preset providers.')
  let root: Agent | undefined, handle: AgentHandle | undefined
  let text = '', resultError: ExecResult['error'], requiresInput = false
  let terminalReason: string | undefined
  const owned = new Set<Agent>()
  const stopped = new AbortController()
  const lifetime = AbortSignal.any([signal, stopped.signal])
  const off: Array<() => void> = []
  const belongs = (agent: Agent): boolean => owned.has(agent)
  const cancel = (): void => { root?.cancel({ kind: 'user' }) }
  lifetime.addEventListener('abort', cancel, { once: true })
  const needInput = (kind: 'approval' | 'question', data: unknown): void => {
    requiresInput = true
    output.emit('input.required', { kind, data })
    stopped.abort(new Error('Execution requires human input.'))
  }
  off.push(ctx.on('agent/created', ({ agent }): undefined => {
    if ([...owned].some(owner => agents.isOwnedBy(agent.id, owner))) owned.add(agent)
  }))
  off.push(ctx.on('agent/disposed', ({ agent }) => { if (agent !== root) owned.delete(agent) }))
  off.push(ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (belongs(agent)) output.emit('assistant.stream', { sessionId: String(agent.session.id), root: agent === root, frame })
  }))
  off.push(ctx.on('agent/error', ({ agent, error }) => {
    if (agent === root) resultError = failure(error)
  }))
  off.push(ctx.on('session/event', (session, event: SessionEvent) => {
    const owner = [...owned].find(agent => agent.session === session)
    if (owner === undefined) return
    const identity = { sessionId: String(session.id), root: owner === root, eventSequence: event.seq, time: event.time }
    if (event.type === 'assistant/message') {
      if (owner === root) text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
      const { stream: _stream, ...data } = event.data
      output.emit('assistant.message', { ...identity, ...data })
    } else {
      const type = EVENTS[event.type]
      if (type !== undefined) output.emit(type, { ...identity, ...event.data })
    }
    if (owner === root && event.type === 'turn/end') {
      terminalReason = event.data.reason.kind
      if (event.data.reason.kind === 'error') resultError = { code: event.data.reason.error.code ?? 'RUN_FAILED', message: event.data.reason.error.message }
    }
    if (owner === root && event.type === 'turn/start') { resultError = undefined; terminalReason = undefined }
  }))
  off.push(ctx.on('approval/request', async (request, next) => {
    if (!belongs(request.agent)) return next()
    needInput('approval', { sessionId: String(request.agent.id), toolName: request.toolName, callId: request.callId, reason: request.reason })
    return 'unavailable'
  }))
  off.push(ctx.on('user-questions/request', async (request, next) => {
    if (request.agent !== undefined && !belongs(request.agent)) return next()
    needInput('question', { sessionId: request.agent?.id, questions: request.questions })
    throw new UserQuestionError('Script execution requires a human answer.', 'ASK_ABORTED')
  }))
  try {
    lifetime.throwIfAborted()
    const selectedModel = defaults.currentSelection()
    const selection: ModelSelectionRef = { current: selectedModel, assembled: undefined }
    const setup = async (agentCtx: Context, agent: Agent): Promise<void> => {
      root = agent
      owned.add(agent)
      await configureAgentContext(agentCtx, agent, selection)
    }
    if (request.resume !== undefined) {
      const persistence = ctx.get('sessionPersistence')
      if (persistence === undefined) throw new Error('Session persistence is unavailable.')
      const stored = await persistence.stat(SessionId(request.resume), { signal: lifetime })
      if (stored === undefined) throw new Error(`Session ${request.resume} was not found.`)
      if (stored.formatStatus === 'migration-required') throw new Error('This session requires migration. Resume it interactively before using exec.')
      handle = await agents.resume({ resumeSessionId: SessionId(request.resume), agentOptions: selectedModel, signal: lifetime, setup })
    } else {
      const preset = await presets.resolve()
      handle = await agents.create({ sessionId: SessionId('session-' + randomUUID()), meta: { cwd: process.cwd(), agentPreset: preset.id },
        agentOptions: selectedModel, signal: lifetime, setup })
    }
    const agent = handle.agent
    root = agent
    output.emit(request.resume === undefined ? 'session.created' : 'session.resumed', { sessionId: String(agent.id), model: selection.current,
      cwd: agent.session.header.cwd })
    lifetime.throwIfAborted()
    agent.followup(createUserMessage({ content: [{ type: 'text', text: request.prompt }], source: { kind: 'user' } }))
    // The same public join contract as the interactive runner: a child can
    // deliver a follow-up after the parent's first idle transition.
    for (;;) {
      await agent.whenIdle()
      if (lifetime.aborted) break
      const interrupted = Promise.withResolvers<false>()
      const onAbort = (): void => { interrupted.resolve(false) }
      lifetime.addEventListener('abort', onAbort, { once: true })
      let joined: boolean | undefined
      try {
        if (lifetime.aborted) break
        joined = await Promise.race([ctx.get('subagents')?.waitForChildren(agent), interrupted.promise])
      } finally { lifetime.removeEventListener('abort', onAbort) }
      if (!joined) break
    }
    await ctx.get('sessions')?.flush(agent.session)
    const totals = ctx.get('sessionProjections')?.snapshot(agent.session).values
    const sessionTotals = totals === undefined ? undefined : { stats: totals.sessionStats, tokens: totals.tokenUsage }
    const identity = { sessionId: String(agent.id), text, ...(sessionTotals === undefined ? {} : { sessionTotals }) }
    if (requiresInput) return { ...identity, outcome: 'requires_input', exitCode: 3, error: { code: 'REQUIRES_INPUT', message: 'Resume this session interactively to continue with a human decision.' } }
    if (signal.aborted || terminalReason === 'aborted') return { ...identity, outcome: 'cancelled', exitCode: 130, error: { code: 'CANCELLED', message: 'Execution was interrupted.' } }
    if (resultError !== undefined || terminalReason !== 'completed') return { ...identity, outcome: 'failed', exitCode: 1,
      error: resultError ?? { code: terminalReason === 'max-tokens' ? 'MAX_TOKENS' : 'RUN_INCOMPLETE', message: `Execution ended without completion (${terminalReason ?? 'no turn'}).` } }
    return { ...identity, outcome: 'completed', exitCode: 0 }
  } catch (error) {
    return { outcome: requiresInput ? 'requires_input' : signal.aborted ? 'cancelled' : 'failed', exitCode: requiresInput ? 3 : signal.aborted ? 130 : 1,
      ...(root === undefined ? {} : { sessionId: String(root.id) }), text,
      error: requiresInput ? { code: 'REQUIRES_INPUT', message: 'Execution requires human input.' } : signal.aborted ? { code: 'CANCELLED', message: 'Execution was interrupted.' } : failure(error) }
  } finally {
    lifetime.removeEventListener('abort', cancel)
    for (const dispose of off.reverse()) dispose()
    if (handle !== undefined) await handle.dispose()
  }
}

/** Cordis owns teardown while the caller awaits the one execution result. */
export function execConsumer(request: ExecRequest, output: ExecOutput, signal: AbortSignal) {
  const result = Promise.withResolvers<ExecResult>()
  let started = false
  return { result: result.promise, plugin: {
    name: 'omdsh-exec', inject: ['agents', 'agentDefaultModel', 'agentPresets', 'sessionProjections'],
    apply(ctx: Context): void {
      if (started) return
      started = true
      const abort = new AbortController()
      const task = executeAgent(ctx, request, output, AbortSignal.any([signal, abort.signal]))
      void task.then(result.resolve, result.reject)
      ctx.effect(() => async () => { abort.abort(new Error('Script consumer unloaded.')); await task }, 'script execution lifetime')
    },
  } }
}
