/** Durable session configuration spanning Agent preset and tool presentation. */

import { KNOWN_SESSION_EVENT_TYPES, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolPresentationMode } from '@deepseek-ai/dsh-tools'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Tool presentation selected before the session produced model history. */
    'omdsh/tools-selected': {
      mode: ToolPresentationMode
      source: 'preset-default' | 'user'
    }
  }
}

/**
 * Persistence refuses an unknown event type that is not marked ignorable.
 * `Session.append` cannot set that marker yet, so this process adds omdsh-owned
 * log-only types to the published vocabulary before any resume or inspect.
 */
function registerOmdshSessionEvents(): void {
  (KNOWN_SESSION_EVENT_TYPES as Set<string>).add('omdsh/tools-selected')
}

registerOmdshSessionEvents()

export interface SessionConfiguration {
  agentPreset: string
  tools: ToolPresentationMode
  toolsSource: 'preset-default' | 'user'
}

/** PTC starts in Code presentation; the other shipped presets start Native. */
export function defaultToolPresentation(agentPreset: string): ToolPresentationMode {
  return agentPreset === 'code' ? 'code' : 'native'
}

/** Reconstruct tool presentation from the log, falling back to the preset default. */
export function resolveToolPresentation(
  events: readonly SessionEvent[],
  agentPreset: string,
): Pick<SessionConfiguration, 'tools' | 'toolsSource'> {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'omdsh/tools-selected') {
      return { tools: event.data.mode, toolsSource: event.data.source }
    }
  }
  return { tools: defaultToolPresentation(agentPreset), toolsSource: 'preset-default' }
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

export function formatToolPresentation(mode: ToolPresentationMode): string {
  if (mode === 'native') return 'Native'
  if (mode === 'code') return 'Code'
  return 'Both'
}
