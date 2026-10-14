import { describe, expect, it } from 'vitest'
import { AgentActivityController, programStatusSequence, terminalTitle } from './terminal-state.ts'

describe('terminal lifecycle', () => {
  it('shares root activity with Herdr and restores nested prompt state after dismissal', () => {
    const activity = new AgentActivityController()
    activity.setRunning(true)
    activity.prompt('Outer')
    activity.prompt('Inner')
    activity.settled('error')
    activity.setRunning(false)
    expect(activity.program).toEqual({ state: 'blocked', message: 'Inner' })
    activity.promptResolved()
    expect(activity.program).toEqual({ state: 'blocked', message: 'Outer' })
    activity.promptResolved()
    expect(activity.current).toEqual({ state: 'idle' })
    expect(activity.program).toEqual({ state: 'error' })
    activity.setRunning(true)
    expect(activity.program).toEqual({ state: 'working' })
  })
  it.each([['complete', 'done'], ['completed', 'done'], ['error', 'error'], ['blocked', 'error'], ['aborted', 'idle'], ['interrupted', 'idle']])('projects settled %s as %s', (reason, expected) => {
    const activity = new AgentActivityController()
    activity.settled(reason)
    expect(activity.program.state).toBe(expected)
    activity.resetResult()
    expect(activity.program.state).toBe('idle')
  })
  it('cleans protocol payloads and encodes bounded Unicode messages without an escape injection', () => {
    const text = '中文🐳\x1b]2;bad\x07\n' + '🐳'.repeat(300)
    const sequence = programStatusSequence({ state: 'blocked', message: text })
    const encoded = /:msg=([^\x1b]+)/u.exec(sequence)![1]!
    const decoded = Buffer.from(encoded, 'base64').toString()
    expect(decoded).not.toMatch(/[\x00-\x1f\x7f]/u)
    expect([...decoded].length).toBeLessThanOrEqual(240)
    expect(sequence).toContain('state=blocked:app=omdsh')
    expect(programStatusSequence('clear')).toContain('state=clear')
  })
  it('supports status, session, workspace and off without exporting prompt bodies', () => {
    const status = { state: 'blocked' as const, message: 'private question' }
    expect(terminalTitle('status', status, 'Fix parser', '/workspace', 'main')).toBe('Needs input · Fix parser · omdsh')
    expect(terminalTitle('workspace', status, 'Fix parser', '/workspace', 'main')).toContain('workspace · main')
    expect(terminalTitle('session', status, '中文\x07🐳', '/workspace')).toBe('中文 🐳')
    expect(terminalTitle('off', status, 'Fix parser', '/workspace')).toBe('')
    expect(terminalTitle('status', status, '🐳'.repeat(200), '/workspace')).not.toContain('private question')
    expect([...terminalTitle('status', status, '🐳'.repeat(200), '/workspace')].length).toBe(120)
  })
})
