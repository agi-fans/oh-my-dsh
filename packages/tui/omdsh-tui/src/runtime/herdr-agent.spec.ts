import { EventEmitter } from 'node:events'
import { connect, type Socket } from 'node:net'
/** Herdr custom-integration contract: detection, status projection, and request shape. */
import { describe, expect, it, vi } from 'vitest'
import {
  HERDR_AGENT_LABEL,
  HERDR_REPORT_SOURCE,
  HerdrAgentReporter,
  HerdrAgentStatusController,
  herdrEnvironment,
  herdrSocketTarget,
  type HerdrRequest,
} from './herdr-agent.ts'

vi.mock('node:net', async importOriginal => ({ ...await importOriginal<typeof import('node:net')>(), connect: vi.fn() }))

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

  it('forces republication without discarding the current driver state', () => {
    const controller = new HerdrAgentStatusController()
    controller.setRunning(true)
    expect(controller.setRunning(true)).toBeUndefined()
    expect(controller.start()).toEqual({ state: 'working' })
    controller.setRunning(false)
    expect(controller.setRunning(true)).toEqual({ state: 'working' })
  })
})

describe('HerdrAgentReporter', () => {
  it('does not claim an inherited pane for a non-interactive provider', async () => {
    const recorder = createRecorder()
    const reporter = new HerdrAgentReporter({ env: ACTIVE_ENV, interactive: false, transport: recorder.transport })
    reporter.start()
    reporter.setRunning(true)
    await reporter.release()
    expect(reporter.active).toBe(false)
    expect(recorder.requests).toEqual([])
  })

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


it('keeps rapid reporter reloads monotonic even with a fixed or backwards clock', () => {
  const recorded = createRecorder()
  const previous = new HerdrAgentReporter({ env: ACTIVE_ENV, transport: recorded.transport, now: () => 1000 })
  previous.start(); previous.setRunning(true); previous.release()
  const successor = new HerdrAgentReporter({ env: ACTIVE_ENV, transport: recorded.transport, now: () => 999 })
  successor.start(); successor.setRunning(true)
  const sequences = recorded.requests.map(request => Number(request.params.seq))
  for (let index = 1; index < sequences.length; index++) expect(sequences[index]).toBeGreaterThan(sequences[index - 1]!)
})

it('retains the active driver through session metadata updates and prompt dismissal', () => {
  const recorder = createRecorder()
  const reporter = new HerdrAgentReporter({ env: ACTIVE_ENV, transport: recorder.transport, now: () => 1000 })
  reporter.setRunning(true)
  reporter.setSession('session-next')
  reporter.prompt('Question')
  reporter.promptResolved()
  expect(recorder.requests.at(-1)?.params).toMatchObject({ state: 'working', agent_session_id: 'session-next' })
})


it('serializes async delivery and replaces unsent intermediate states with the newest one', async () => {
  const sent: HerdrRequest[] = [], settle: ((success: boolean) => void)[] = []
  const reporter = new HerdrAgentReporter({ env: ACTIVE_ENV, transport: () => ({ send: request => {
    sent.push(request); return new Promise<boolean>(resolve => { settle.push(resolve) })
  } }) })
  reporter.start(); reporter.setRunning(true); reporter.setRunning(false); reporter.prompt('Approval')
  expect(sent).toHaveLength(1)
  settle.shift()!(true)
  await Promise.resolve(); await Promise.resolve()
  expect(sent).toHaveLength(2)
  expect(sent[1]?.params).toMatchObject({ state: 'blocked', message: 'Approval' })
  settle.shift()!(true)
})

it('retries a dropped state without requiring another state transition', async () => {
  vi.useFakeTimers()
  const sent: HerdrRequest[] = []
  let recovered = false
  const reporter = new HerdrAgentReporter({ env: ACTIVE_ENV, transport: () => ({ send: request => {
    sent.push(request); return Promise.resolve(recovered)
  } }) })
  try {
    reporter.setRunning(true)
    await vi.advanceTimersByTimeAsync(100)
    recovered = true
    await vi.advanceTimersByTimeAsync(1500)
    expect(sent.length).toBeGreaterThan(1)
    expect(sent.at(-1)?.params.state).toBe('working')
    expect(Number(sent.at(-1)?.params.seq)).toBeGreaterThan(Number(sent[0]?.params.seq))
    const count = sent.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(sent).toHaveLength(count)
  } finally { reporter.release(); vi.useRealTimers() }
})


it('preserves blocked status when session identity changes while a prompt is active', () => {
  const recorder = createRecorder()
  const reporter = new HerdrAgentReporter({ env: ACTIVE_ENV, transport: recorder.transport })
  reporter.setRunning(true); reporter.prompt('Approval')
  reporter.setSession('session-2')
  expect(recorder.requests.at(-1)?.params).toMatchObject({ state: 'blocked', message: 'Approval', agent_session_id: 'session-2' })
  reporter.promptResolved()
  expect(recorder.requests.at(-1)?.params.state).toBe('working')
  reporter.release()
})

it('stops old retries and prevents old release from clearing a replacement reporter', async () => {
  vi.useFakeTimers()
  const first = createRecorder(), second = createRecorder()
  const previous = new HerdrAgentReporter({ env: ACTIVE_ENV, transport: () => ({ send: request => { first.requests.push(request); return Promise.resolve(false) } }) })
  try {
    previous.setRunning(true)
    await vi.advanceTimersByTimeAsync(100)
    const successor = new HerdrAgentReporter({ env: ACTIVE_ENV, transport: second.transport })
    successor.start()
    await previous.release()
    await vi.advanceTimersByTimeAsync(3000)
    expect(first.requests).toHaveLength(1)
    expect(second.requests.at(-1)?.params.state).toBe('idle')
    await successor.release()
  } finally { await previous.release(); vi.useRealTimers() }
})

it('orders release after the in-flight report and discards unsent states during teardown', async () => {
  const sent: HerdrRequest[] = [], settle: ((success: boolean) => void)[] = []
  const reporter = new HerdrAgentReporter({ env: ACTIVE_ENV, transport: () => ({ send: request => {
    sent.push(request); return new Promise<boolean>(resolve => { settle.push(resolve) })
  } }) })
  reporter.start(); reporter.setRunning(true)
  const release = reporter.release()
  expect(reporter.release()).toBe(release)
  expect(sent).toHaveLength(1)
  settle.shift()!(false)
  await Promise.resolve(); await Promise.resolve()
  expect(sent.map(request => request.method)).toEqual(['pane.report_agent', 'pane.release_agent'])
  reporter.setRunning(true)
  settle.shift()!(true)
  await release
  expect(sent).toHaveLength(2)
})

it('bounds teardown even if a custom transport never settles', async () => {
  vi.useFakeTimers()
  const send = vi.fn(() => new Promise<boolean>(() => {}))
  const reporter = new HerdrAgentReporter({ env: ACTIVE_ENV, transport: () => ({ send }) })
  try {
    reporter.start()
    const release = reporter.release()
    await vi.advanceTimersByTimeAsync(1100)
    await release
    expect(send).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})

class FakeHerdrSocket extends EventEmitter {
  writes: string[] = []
  destroyed = false
  throwOnWrite = false
  unref() { return this }
  setEncoding() { return this }
  write(chunk: string) { if (this.throwOnWrite) throw new Error('write failed'); this.writes.push(chunk); return true }
  destroy() { this.destroyed = true; this.emit('close'); return this }
  request(): HerdrRequest { return JSON.parse(this.writes[0]!) as HerdrRequest }
}

it('waits for a complete matching acknowledgement rather than the first socket chunk', async () => {
  const socket = new FakeHerdrSocket()
  vi.mocked(connect).mockReturnValueOnce(socket as unknown as Socket)
  const reporter = new HerdrAgentReporter({ env: ACTIVE_ENV })
  reporter.start(); socket.emit('connect')
  const request = socket.request()
  socket.emit('data', JSON.stringify({ id: 'other-request', result: { type: 'ok' } }) + '\n')
  expect(socket.destroyed).toBe(false)
  const ack = JSON.stringify({ id: request.id, result: { type: 'ok' } })
  socket.emit('data', ack.slice(0, 10))
  expect(socket.destroyed).toBe(false)
  socket.emit('data', ack.slice(10) + '\n')
  await Promise.resolve()
  expect(socket.destroyed).toBe(true)
  const releaseSocket = new FakeHerdrSocket()
  vi.mocked(connect).mockReturnValueOnce(releaseSocket as unknown as Socket)
  const release = reporter.release()
  releaseSocket.emit('connect')
  releaseSocket.emit('data', JSON.stringify({ id: releaseSocket.request().id, result: { type: 'ok' } }) + '\n')
  await release
})

it.each(['error-response', 'broken-json', 'oversize', 'timeout', 'write-error'] as const)('retries a failed production socket (%s)', async failure => {
  vi.useFakeTimers()
  const first = new FakeHerdrSocket(), retry = new FakeHerdrSocket(), releaseSocket = new FakeHerdrSocket()
  vi.mocked(connect).mockReturnValueOnce(first as unknown as Socket).mockReturnValueOnce(retry as unknown as Socket).mockReturnValueOnce(releaseSocket as unknown as Socket)
  const reporter = new HerdrAgentReporter({ env: ACTIVE_ENV })
  try {
    first.throwOnWrite = failure === 'write-error'
    reporter.setRunning(true); first.emit('connect')
    if (failure === 'error-response') first.emit('data', JSON.stringify({ id: first.request().id, error: { code: 'unavailable' } }) + '\n')
    if (failure === 'broken-json') first.emit('data', 'bad-json\n')
    if (failure === 'oversize') first.emit('data', 'x'.repeat(64 * 1024 + 1))
    await vi.advanceTimersByTimeAsync(failure === 'timeout' ? 1500 : 1000)
    expect(first.destroyed).toBe(true)
    retry.emit('connect')
    expect(retry.request().params.state).toBe('working')
    retry.emit('data', JSON.stringify({ id: retry.request().id, result: { type: 'ok' } }) + '\n')
    await vi.advanceTimersByTimeAsync(0)
    const release = reporter.release()
    releaseSocket.emit('connect')
    releaseSocket.emit('data', JSON.stringify({ id: releaseSocket.request().id, result: { type: 'ok' } }) + '\n')
    await release
    expect(vi.getTimerCount()).toBe(0)
  } finally { void reporter.release(); vi.useRealTimers() }
})
