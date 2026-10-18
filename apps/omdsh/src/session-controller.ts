/**
 * Host session controller for background consumers.
 *
 * `dsh-schedule` resolves the Session that owns a due reminder through
 * `sessionController.resolveAgent`. A live Session returns its Agent; a cold
 * one is resumed here with its recorded Agent preset and the current default
 * model, then kept resident so delivery can append the reminder and flush it.
 * Resuming never activates or replaces the TUI's visible Session.
 * @module @agi-fans/oh-my-dsh/session-controller
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { configureAgentContext } from '@agi-fans/dsh-tui/agent-profile'

export const name = 'omdsh-session-controller'
export const inject = [
  'agents',
  'sessions',
  'sessionPersistence',
  'agentDefaultModel',
  'agentPresets',
  'sessionProjections',
]

/** The narrow surface background plugins (currently Schedule delivery) consume. */
export interface OmdshSessionController {
  /**
   * Resolve one Session to a live Agent, resuming it when it is cold.
   * @param sessionId - persisted or live Session identity.
   * @returns the Agent, or a delivery-blocking error.
   */
  resolveAgent(sessionId: SessionId): Promise<{ agent: Agent } | { error: Error }>
}

export function apply(ctx: Context): void {
  const handles = new Map<string, AgentHandle>()
  const pending = new Map<string, Promise<{ agent: Agent } | { error: Error }>>()

  const resume = async (sessionId: SessionId): Promise<{ agent: Agent } | { error: Error }> => {
    const persistence = ctx.get('sessionPersistence')
    if (persistence === undefined) return { error: new Error('Session persistence is unavailable.') }
    const stored = await persistence.stat(sessionId)
    if (stored === undefined) return { error: new Error(`Session ${sessionId} was not found.`) }
    if (stored.formatStatus === 'migration-required') {
      return { error: new Error(`Session ${sessionId} requires migration before it can receive this reminder.`) }
    }
    const selected = ctx.agentDefaultModel.currentSelection()
    const selection: ModelSelectionRef = { current: selected, assembled: undefined }
    try {
      const handle = await ctx.agents.resume({
        resumeSessionId: sessionId,
        agentOptions: selected,
        setup: async (agentCtx, agent) => { await configureAgentContext(agentCtx, agent, selection) },
      })
      handles.set(String(sessionId), handle)
      return { agent: handle.agent }
    } catch (error) {
      return { error: error instanceof Error ? error : new Error(String(error)) }
    }
  }

  const controller: OmdshSessionController = {
    async resolveAgent(sessionId: SessionId) {
      const live = ctx.agents.get(sessionId)
      if (live !== undefined) return { agent: live }
      const resident = handles.get(String(sessionId))
      if (resident !== undefined) return { agent: resident.agent }
      const running = pending.get(String(sessionId))
      if (running !== undefined) return running
      const operation = resume(sessionId).finally(() => { pending.delete(String(sessionId)) })
      pending.set(String(sessionId), operation)
      return operation
    },
  }

  ctx.provide('sessionController', controller)
  ctx.effect(() => async () => {
    const owned = [...handles.values()]
    handles.clear()
    for (const handle of owned) await handle.dispose().catch(() => {})
  }, 'omdsh background session controller')
}
