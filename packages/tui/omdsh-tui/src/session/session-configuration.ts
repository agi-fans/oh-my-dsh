/** Agent-preset configuration and composition guards for one session. */

import { KNOWN_SESSION_EVENT_TYPES, type Session } from '@deepseek-ai/dsh-session'
import type { ToolPresentationMode } from '@deepseek-ai/dsh-tools'

/**
 * Releases v0.5.0 through v0.11.0 wrote this private event. Keep it readable
 * inside omdsh while new sessions remain portable and never append it again.
 */
function registerLegacyOmdshSessionEvents(): void {
  (KNOWN_SESSION_EVENT_TYPES as Set<string>).add('omdsh/tools-selected')
}

registerLegacyOmdshSessionEvents()

/** PTC uses Code presentation; every other preset exposes native functions. */
export function toolPresentationForPreset(agentPreset: string): ToolPresentationMode {
  return agentPreset === 'code' ? 'code' : 'native'
}

/** Agent composition may change only before any model-visible history exists. */
export function isBlankSession(session: Session): boolean {
  if (session.deriveMessages().length > 0) return false
  return !session.events.some(event => event.type === 'request/header'
    || event.type === 'request/context'
    || event.type === 'turn/start'
    || event.type === 'step/start'
    || event.type === 'assistant/chunk'
    || event.type === 'tool/call'
    || event.type === 'tool/result')
}

export function formatAgentPreset(id: string): string {
  if (id === 'standard') return 'Standard'
  if (id === 'code') return 'PTC'
  if (id === 'minimal') return 'Minimal'
  if (id === 'cordis') return 'Cordis'
  return id
}
