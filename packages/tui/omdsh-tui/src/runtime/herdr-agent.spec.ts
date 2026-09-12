/** Herdr custom-integration contract: detection, status projection, and request shape. */
import { describe, expect, it } from 'vitest'
import {
  HERDR_AGENT_LABEL,
  HERDR_REPORT_SOURCE,
  HerdrAgentReporter,
  HerdrAgentStatusController,
  herdrEnvironment,
  herdrSocketTarget,
  type HerdrRequest,
} from './herdr-agent.ts'

const ACTIVE_ENV = {
  HERDR_ENV: '1',
  HERDR_PANE_ID: 'w1:p2',
  HERDR_SOCKET_PATH: '/tmp/herdr-test.sock',
}

function createRecorder(): { requests: HerdrRequest[]; transport: (socketPath: string) => { send(request: HerdrRequest): void } } {
  const requests: HerdrRequest[] = []
  return {
    requests,
    transport: () => ({ send: (request) => { requests.push(request) } }),
  }
}

describe('herdrEnvironment', () => {
  it('requires HERDR_ENV=1 plus a pane id and socket path', () => {
    expect(herdrEnvironment({})).toBeUndefined()
    expect(herdrEnvironment({ HERDR_ENV: '0', HERDR_PANE_ID: 'w1:p2', HERDR_SOCKET_PATH: '/tmp/herdr.sock' })).toBeUndefined()
    expect(herdrEnvironment({ HERDR_ENV: '1' })).toBeUndefined()
    expect(herdrEnvironment({ HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p2' })).toBeUndefined()
    expect(herdrEnvironment({ HERDR_ENV: '1', HERDR_SOCKET_PATH: '/tmp/herdr.sock' })).toBeUndefined()
    expect(herdrEnvironment({ HERDR_ENV: '1', HERDR_PANE_ID: '  ', HERDR_SOCKET_PATH: '/tmp/herdr.sock' })).toBeUndefined()
  })

  it('treats pane identity without HERDR_ENV as client-side state, not detection evidence', () => {
    expect(herdrEnvironment({
      HERDR_PANE_ID: 'w1:p2',
      HERDR_TAB_ID: 'w1:t1',
      HERDR_WORKSPACE_ID: 'w1',
      HERDR_SOCKET_PATH: '/tmp/herdr.sock',
    })).toBeUndefined()
  })

  it('returns the trimmed pane identity for a live pane', () => {
    expect(herdrEnvironment({
      HERDR_ENV: '1',
      HERDR_PANE_ID: ' w1:p2 ',
      HERDR_SOCKET_PATH: ' /tmp/herdr-test.sock ',
    })).toEqual({ paneId: 'w1:p2', socketPath: '/tmp/herdr-test.sock' })
  })
})

describe('herdrSocketTarget', () => {
  it('keeps Unix socket paths untouched', () => {
    expect(herdrSocketTarget('/Users/me/.config/herdr/herdr.sock', 'darwin')).toBe('/Users/me/.config/herdr/herdr.sock')
    expect(herdrSocketTarget('/Users/me/.config/herdr/herdr.sock', 'linux')).toBe('/Users/me/.config/herdr/herdr.sock')
  })

  it('maps a Windows path into the named-pipe namespace once', () => {
    expect(herdrSocketTarget('C:\\\\Users\\\\me\\\\.config\\\\herdr\\\\herdr.sock', 'win32'))
      .toBe('\\\\.\\pipe\\C:\\\\Users\\\\me\\\\.config\\\\herdr\\\\herdr.sock')
    expect(herdrSocketTarget('\\\\.\\pipe\\herdr', 'win32')).toBe('\\\\.\\pipe\\herdr')
    expect(herdrSocketTarget('\\\\?\\pipe\\herdr', 'win32')).toBe('\\\\?\\pipe\\herdr')
  })
})

describe('HerdrAgentStatusController', () => {
  it('projects running, blocked, and idle into one semantic state', () => {
    const controller = new HerdrAgentStatusController()
    expect(controller.start()).toEqual({ state: 'idle' })
    expect(controller.setRunning(true)).toEqual({ state: 'working' })
    expect(controller.setRunning(true)).toBeUndefined()
    expect(controller.prompt('Approval required')).toEqual({ state: 'blocked', message: 'Approval required' })
    expect(controller.setRunning(false)).toBeUndefined()
    expect(controller.promptResolved()).toEqual({ state: 'idle' })
    expect(controller.promptResolved()).toBeUndefined()
  })

  it('keeps blocked ahead of a running driver until the last prompt resolves', () => {
    const controller = new HerdrAgentStatusController()
    controller.setRunning(true)
    controller.prompt('Question')
    expect(controller.prompt('Approval required')).toEqual({ state: 'blocked', message: 'Approval required' })
    // One of two prompts settling keeps the projection blocked, so it republishes nothing.
    expect(controller.promptResolved()).toBeUndefined()
    expect(controller.promptResolved()).toEqual({ state: 'working' })
  })

  it('normalizes prompt text and drops an empty one', () => {
    const controller = new HerdrAgentStatusController()
    expect(controller.prompt('  Approve\n\nrm -rf build/\t ')).toEqual({
      state: 'blocked',
      message: 'Approve rm -rf build/',
    })
    expect(controller.promptResolved()).toEqual({ state: 'idle' })
    expect(controller.prompt('\u0007\u0007')).toEqual({ state: 'blocked' })
  })

  it('caps a prompt message at the protocol limit', () => {
    const controller = new HerdrAgentStatusController()
    const status = controller.prompt('x'.repeat(400))
    expect(status?.message).toHaveLength(240)
  })

  it('republishes a signature that was never sent before a session reset', () => {
    const controller = new HerdrAgentStatusController()
    controller.setRunning(true)
    expect(controller.setRunning(true)).toBeUndefined()
    controller.reset()
    expect(controller.setRunning(true)).toEqual({ state: 'working' })
  })
})

describe('HerdrAgentReporter', () => {
  it('is a complete no-op without a Herdr pane', () => {
    const recorder = createRecorder()
    const reporter = new HerdrAgentReporter({ env: {}, transport: recorder.transport })
    expect(reporter.active).toBe(false)
    reporter.start()
    reporter.setRunning(true)
    reporter.prompt('Approval required')
    reporter.promptResolved()
    reporter.setSession('session-1')
    reporter.release()
    expect(recorder.requests).toHaveLength(0)
  })

  it('reports the custom source identity with a strictly increasing sequence', () => {
    const recorder = createRecorder()
    const reporter = new HerdrAgentReporter({ env: ACTIVE_ENV, transport: recorder.transport })
    reporter.start()
    reporter.setRunning(true)
    reporter.setRunning(false)

    expect(recorder.requests.map(request => request.method)).toEqual([
      'pane.report_agent',
      'pane.report_agent',
      'pane.report_agent',
    ])
    const [idle, working, settled] = recorder.requests
    expect(idle?.params).toMatchObject({
      pane_id: 'w1:p2',
      source: HERDR_REPORT_SOURCE,
      agent: HERDR_AGENT_LABEL,
      state: 'idle',
    })
    expect(working?.params.state).toBe('working')
    expect(settled?.params.state).toBe('idle')
    const sequences = recorder.requests.map(request => Number(request.params.seq))
    expect(sequences[1]).toBeGreaterThan(sequences[0] as number)
    expect(sequences[2]).toBeGreaterThan(sequences[1] as number)
  })

  it('carries the blocked message, the session reference, and the release', () => {
    const recorder = createRecorder()
    const reporter = new HerdrAgentReporter({ env: ACTIVE_ENV, transport: recorder.transport })
    reporter.setRunning(true)
    reporter.setSession('session-42')
    reporter.prompt('Approval required')
    reporter.promptResolved()
    reporter.release()

    const blocked = recorder.requests.find(request => request.params.state === 'blocked')
    expect(blocked?.params.message).toBe('Approval required')
    expect(blocked?.params.agent_session_id).toBe('session-42')
    const release = recorder.requests.at(-1)
    expect(release?.method).toBe('pane.release_agent')
    expect(release?.params).toMatchObject({ source: HERDR_REPORT_SOURCE, agent: HERDR_AGENT_LABEL, pane_id: 'w1:p2' })
    const sequences = recorder.requests.map(request => Number(request.params.seq))
    expect(sequences).toEqual([...sequences].sort((left, right) => left - right))
  })

  it('drops every report after the release', () => {
    const recorder = createRecorder()
    const reporter = new HerdrAgentReporter({ env: ACTIVE_ENV, transport: recorder.transport })
    reporter.release()
    reporter.setRunning(true)
    reporter.prompt('Approval required')
    reporter.release()
    expect(recorder.requests).toHaveLength(1)
    expect(recorder.requests[0]?.method).toBe('pane.release_agent')
  })

  it('keeps a later reload above the previous instance sequence', () => {
    const first = createRecorder()
    const previous = new HerdrAgentReporter({ env: ACTIVE_ENV, transport: first.transport, now: () => 1_000 })
    previous.start()
    previous.setRunning(true)
    const last = Number(first.requests.at(-1)?.params.seq)

    const second = createRecorder()
    const successor = new HerdrAgentReporter({ env: ACTIVE_ENV, transport: second.transport, now: () => 2_000 })
    successor.start()
    expect(Number(second.requests[0]?.params.seq)).toBeGreaterThan(last)
  })

  it('survives a transport that throws', () => {
    const reporter = new HerdrAgentReporter({
      env: ACTIVE_ENV,
      transport: () => ({ send: () => { throw new Error('socket exploded') } }),
    })
    expect(() => { reporter.start() }).not.toThrow()
    expect(() => { reporter.setRunning(true) }).not.toThrow()
    expect(() => { reporter.prompt('Approval required') }).not.toThrow()
    expect(() => { reporter.release() }).not.toThrow()
  })
})
