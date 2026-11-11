import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentActivityController, programStatusSequence, terminalTitle, workingDirectorySequence } from './terminal-state.ts'

describe('terminal lifecycle', () => {
  it('shares root activity with Herdr and restores nested prompt state after dismissal', () => {
    const activity = new AgentActivityController()
    activity.setRunning(true)
    activity.prompt('Outer', 'permission')
    activity.prompt('Inner')
    activity.settled('error')
    activity.setRunning(false)
    expect(activity.program).toEqual({ state: 'blocked', kind: 'question', message: 'Inner' })
    activity.promptResolved()
    expect(activity.program).toEqual({ state: 'blocked', kind: 'permission', message: 'Outer' })
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
  it('cleans protocol payloads and encodes bounded Unicode titles and messages without an escape injection', () => {
    const text = '中文🐳\x1b]2;bad\x07\n' + '🐳'.repeat(300)
    const sequence = programStatusSequence({ state: 'blocked', kind: 'permission', title: text, message: text })
    const encodedTitle = /:title=([^\x1b:]+)/u.exec(sequence)![1]!
    const encodedMsg = /:msg=([^\x1b:]+)/u.exec(sequence)![1]!
    for (const encoded of [encodedTitle, encodedMsg]) {
      const decoded = Buffer.from(encoded, 'base64').toString()
      expect(decoded).not.toMatch(/[\x00-\x1f\x7f]/u)
      expect([...decoded].length).toBeLessThanOrEqual(240)
    }
    expect(sequence).toContain('state=blocked:app=omdsh:kind=permission')
    expect(programStatusSequence('clear')).toContain('state=clear')
  })
  it('projects manual and mid-turn compaction as working and settles manual outcomes', () => {
    const activity = new AgentActivityController()
    expect(activity.compactionStart('c1')).toEqual({ state: 'working' })
    expect(activity.program).toEqual({ state: 'working' })
    expect(activity.compactionEnd('stale')).toBeUndefined()
    expect(activity.compactionEnd('c1')).toEqual({ state: 'idle' })
    expect(activity.program).toEqual({ state: 'done' })
    expect(activity.compactionStart('c2')).toEqual({ state: 'working' })
    expect(activity.compactionEnd('c2', 'summarizer failed')).toEqual({ state: 'idle' })
    expect(activity.program).toEqual({ state: 'error' })
    expect(activity.setRunning(true)).toEqual({ state: 'working' })
    expect(activity.compactionStart('c3')).toBeUndefined()
    expect(activity.compactionEnd('c3')).toBeUndefined()
    expect(activity.program).toEqual({ state: 'working' })
  })
  it('encodes directory names without letting control characters enter OSC payloads', () => {
    const cwd = join(tmpdir(), '中文 🐳 # %\x07\x1b')
    const sequence = workingDirectorySequence(cwd)
    const payload = sequence.slice(2, -2)
    expect(payload).not.toMatch(/[\x00-\x1f\x7f]/u)
    const url = new URL(payload.slice(2))
    expect(url.protocol).toBe('file:')
    expect(decodeURIComponent(url.pathname)).toContain('中文 🐳 # %\x07\x1b')
  })
  it('supports status, session, workspace, native status simplification and off without exporting prompt bodies', () => {
    const status = { state: 'blocked' as const, message: 'private question' }
    expect(terminalTitle('status', status, 'Fix parser', '/workspace', 'main')).toBe('Needs input · Fix parser · omdsh')
    expect(terminalTitle('status', status, 'Fix parser', '/workspace', 'main', true)).toBe('Fix parser')
    expect(terminalTitle('status', status, undefined, '/workspace', 'main', true)).toBe('')
    expect(terminalTitle('workspace', status, 'Fix parser', '/workspace', 'main')).toContain('workspace · main')
    expect(terminalTitle('workspace', status, 'Fix parser', '/workspace', 'main', true)).toBe('workspace · main')
    expect(terminalTitle('session', status, '中文\x07🐳', '/workspace')).toBe('中文 🐳')
    expect(terminalTitle('off', status, 'Fix parser', '/workspace')).toBe('')
    expect(terminalTitle('status', status, '🐳'.repeat(200), '/workspace')).not.toContain('private question')
    expect([...terminalTitle('status', status, '🐳'.repeat(200), '/workspace')].length).toBe(120)
  })
})
