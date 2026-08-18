import { describe, expect, it } from 'vitest'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  defaultToolPresentation,
  formatAgentPreset,
  formatToolPresentation,
  isBlankSession,
  resolveToolPresentation,
} from './session-configuration.ts'

describe('session configuration', () => {
  it('derives the PTC tool default independently from an explicit selection', () => {
    expect(defaultToolPresentation('standard')).toBe('native')
    expect(defaultToolPresentation('code')).toBe('code')
    expect(resolveToolPresentation([], 'code')).toEqual({ tools: 'code', toolsSource: 'preset-default' })
    expect(resolveToolPresentation([
      { type: 'omdsh/tools-selected', data: { mode: 'both', source: 'user' } },
    ] as SessionEvent[], 'code')).toEqual({ tools: 'both', toolsSource: 'user' })
  })

  it('locks composition only after model work begins', () => {
    const session = Session.create(SessionId('configuration-blank'))
    expect(isBlankSession(session)).toBe(true)
    session.append('plan/mode', { active: true })
    session.append('omdsh/tools-selected', { mode: 'native', source: 'user' })
    expect(isBlankSession(session)).toBe(true)
    session.append('turn/start', { turn: 1 })
    expect(isBlankSession(session)).toBe(false)
  })

  it('uses stable product labels for shipped concepts', () => {
    expect(['standard', 'code', 'minimal', 'cordis'].map(formatAgentPreset))
      .toEqual(['Standard', 'PTC', 'Minimal', 'Cordis'])
    expect(['native', 'code', 'both'].map(mode => formatToolPresentation(mode as 'native' | 'code' | 'both')))
      .toEqual(['Native', 'Code', 'Both'])
  })
})
