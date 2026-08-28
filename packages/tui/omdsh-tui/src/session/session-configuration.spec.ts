import { describe, expect, it } from 'vitest'
import { KNOWN_SESSION_EVENT_TYPES, Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  formatAgentPreset,
  isBlankSession,
  toolPresentationForPreset,
} from './session-configuration.ts'

describe('session configuration', () => {
  it('derives tool exposure entirely from the Agent preset', () => {
    expect(toolPresentationForPreset('standard')).toBe('native')
    expect(toolPresentationForPreset('code')).toBe('code')
    expect(toolPresentationForPreset('minimal')).toBe('native')
    expect(toolPresentationForPreset('cordis')).toBe('native')
  })

  it('keeps legacy private events readable inside omdsh', () => {
    expect(KNOWN_SESSION_EVENT_TYPES.has('omdsh/tools-selected')).toBe(true)
  })

  it('locks composition only after model work begins', () => {
    const session = Session.create(SessionId('configuration-blank'))
    expect(isBlankSession(session)).toBe(true)
    session.append('plan/mode', { active: true })
    expect(isBlankSession(session)).toBe(true)
    session.append('turn/start', { turn: 1 })
    expect(isBlankSession(session)).toBe(false)
  })

  it('uses stable product labels for shipped concepts', () => {
    expect(['standard', 'code', 'minimal', 'cordis'].map(formatAgentPreset))
      .toEqual(['Standard', 'PTC', 'Minimal', 'Cordis'])
  })
})
