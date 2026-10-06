/**
 * Custom Herdr lifecycle integration.
 *
 * Herdr (https://herdr.dev) detects a fixed set of agents and lets every other
 * agent claim a pane's lifecycle authority itself over the local socket
 * (`pane.report_agent` / `pane.release_agent`). This module implements that
 * contract: it reports `idle`, `working`, and `blocked` for omdsh and is a
 * complete no-op outside a Herdr pane.
 *
 * The status projection is a pure controller; the reporter adds the stable
 * source identity, the strictly increasing sequence Herdr requires, the native
 * session reference, and best-effort socket delivery.
 * @module runtime/herdr-agent
 */

import { connect, type Socket } from 'node:net'

/** Stable, integration-unique source namespace Herdr requires for custom reports. */
export const HERDR_REPORT_SOURCE = 'custom:omdsh'
/** Agent label Herdr shows in its sidebar and agent list. */
export const HERDR_AGENT_LABEL = 'omdsh'

/** The semantic states Herdr accepts from a custom integration; `done` is derived. */
export type HerdrAgentState = 'idle' | 'working' | 'blocked'

export interface HerdrAgentStatus {
  readonly state: HerdrAgentState
  readonly message?: string
}

export interface HerdrRequest {
  readonly id: string
  readonly method: 'pane.report_agent' | 'pane.release_agent'
  readonly params: Readonly<Record<string, unknown>>
}

/** Delivery seam: production writes one JSON line per request to the local socket. */
export interface HerdrTransport {
  /** Async delivery resolves true only after a matching success response. */
  send(request: HerdrRequest): void | boolean | Promise<boolean>
}

export interface HerdrEnvironment {
  readonly paneId: string
  readonly socketPath: string
}

/**
 * Pane-authoritative Herdr detection.
 *
 * `HERDR_ENV=1` is the canonical marker; the pane id and socket path are what
 * the protocol needs. Client-side overrides (`HERDR_SOCKET_PATH`,
 * `HERDR_BIN_PATH`, `HERDR_SESSION`) can be set outside a pane, so they are
 * never detection evidence on their own.
 */
export function herdrEnvironment(env: NodeJS.ProcessEnv = process.env): HerdrEnvironment | undefined {
  if (env.HERDR_ENV !== '1') return undefined
  const paneId = env.HERDR_PANE_ID?.trim()
  const socketPath = env.HERDR_SOCKET_PATH?.trim()
  if (paneId === undefined || paneId === '' || socketPath === undefined || socketPath === '') return undefined
  return { paneId, socketPath }
}

const HERDR_MESSAGE_LIMIT = 240

function cleanHerdrMessage(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const cleaned = value
    .replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, HERDR_MESSAGE_LIMIT)
  return cleaned === '' ? undefined : cleaned
}

/**
 * Pure state projection: an active driver plus the human prompts it is blocked
 * on decide the single semantic state Herdr understands. `blocked` wins over
 * `working` because a blocked pane must reject `herdr agent prompt` input.
 */
export class HerdrAgentStatusController {
  #running = false
  #prompts = 0
  #promptMessage: string | undefined
  #last: string | undefined

  /** The initial report makes Herdr attach the agent to the pane before any turn. */
  start(): HerdrAgentStatus {
    return this.#publish(true) as HerdrAgentStatus
  }

  setRunning(running: boolean): HerdrAgentStatus | undefined {
    this.#running = running
    return this.#publish()
  }

  prompt(message?: string): HerdrAgentStatus | undefined {
    this.#prompts += 1
    const cleaned = cleanHerdrMessage(message)
    if (cleaned !== undefined) this.#promptMessage = cleaned
    return this.#publish()
  }

  promptResolved(): HerdrAgentStatus | undefined {
    if (this.#prompts === 0) return undefined
    this.#prompts -= 1
    if (this.#prompts === 0) this.#promptMessage = undefined
    return this.#publish()
  }

  #desired(): HerdrAgentStatus {
    if (this.#prompts > 0) {
      return this.#promptMessage === undefined
        ? { state: 'blocked' }
        : { state: 'blocked', message: this.#promptMessage }
    }
    return this.#running ? { state: 'working' } : { state: 'idle' }
  }

  #publish(force = false): HerdrAgentStatus | undefined {
    const next = this.#desired()
    const signature = `${next.state}\u0000${next.message ?? ''}`
    if (!force && signature === this.#last) return undefined
    this.#last = signature
    return next
  }
}

export interface HerdrAgentReporterOptions {
  /** Whether the provider owns interactive input and output. Defaults to true. */
  readonly interactive?: boolean
  /** Environment to detect Herdr from. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
  /** Delivery seam for tests. Defaults to the local socket transport. */
  readonly transport?: (socketPath: string) => HerdrTransport
  /** Clock seam for the monotonic sequence. Defaults to `Date.now`. */
  readonly now?: () => number
}

const HERDR_RETRY_MS = 1_000
const HERDR_RELEASE_TIMEOUT_MS = 1_100
let lastSequence = 0
const owners = new Map<string, () => void>()

/** Report pane lifecycle silently, retaining only the latest undelivered state. */
export class HerdrAgentReporter {
  readonly #environment: HerdrEnvironment | undefined
  readonly #transport: HerdrTransport | undefined
  readonly #controller = new HerdrAgentStatusController()
  readonly #now: () => number
  readonly #ownerKey: string | undefined
  #pending: HerdrRequest | undefined
  #sending = false
  #retry: ReturnType<typeof setTimeout> | undefined
  #finished = false
  #releasePromise: Promise<void> | undefined
  #resolveRelease: (() => void) | undefined
  #releaseTimer: ReturnType<typeof setTimeout> | undefined
  #sessionId: string | undefined
  #released = false

  constructor(options: HerdrAgentReporterOptions = {}) {
    this.#now = options.now ?? ((): number => Date.now())
    this.#environment = options.interactive === false ? undefined : herdrEnvironment(options.env ?? process.env)
    this.#transport = this.#environment === undefined
      ? undefined
      : (options.transport ?? defaultHerdrTransport)(this.#environment.socketPath)
    this.#ownerKey = this.#environment === undefined ? undefined : `${this.#environment.socketPath}\0${this.#environment.paneId}`
    if (this.#ownerKey !== undefined) {
      owners.get(this.#ownerKey)?.()
      owners.set(this.#ownerKey, this.#stop)
    }
  }

  /** Whether this process runs inside a Herdr pane with a usable socket. */
  get active(): boolean {
    return this.#transport !== undefined
  }

  start(): void {
    this.#report(this.#controller.start())
  }

  setRunning(running: boolean): void {
    this.#report(this.#controller.setRunning(running))
  }

  prompt(message?: string): void {
    this.#report(this.#controller.prompt(message))
  }

  promptResolved(): void {
    this.#report(this.#controller.promptResolved())
  }

  /** Attach the native session reference Herdr exposes on its agent records. */
  setSession(sessionId: string | undefined): void {
    const trimmed = sessionId?.trim()
    const next = trimmed === undefined || trimmed === '' ? undefined : trimmed
    if (next === this.#sessionId) return
    this.#sessionId = next
    this.#report(this.#controller.start())
  }

  /** Drain an in-flight report, then release authority within a bounded shutdown grace. */
  release(): Promise<void> {
    if (this.#releasePromise !== undefined) return this.#releasePromise
    const environment = this.#environment
    if (this.#finished || environment === undefined || this.#transport === undefined) return Promise.resolve()
    this.#released = true
    this.#releasePromise = new Promise(resolve => { this.#resolveRelease = resolve })
    // This timer deliberately holds process lifetime until the release settles.
    this.#releaseTimer = setTimeout(this.#stop, HERDR_RELEASE_TIMEOUT_MS)
    this.#enqueue({
      id: '', method: 'pane.release_agent',
      params: { pane_id: environment.paneId, source: HERDR_REPORT_SOURCE, agent: HERDR_AGENT_LABEL },
    })
    return this.#releasePromise
  }

  #report(status: HerdrAgentStatus | undefined): void {
    const environment = this.#environment
    const transport = this.#transport
    if (status === undefined || this.#released || this.#finished || environment === undefined || transport === undefined) return
    const params: Record<string, unknown> = {
      pane_id: environment.paneId,
      source: HERDR_REPORT_SOURCE,
      agent: HERDR_AGENT_LABEL,
      state: status.state,
    }
    if (status.message !== undefined) params.message = status.message
    if (this.#sessionId !== undefined) params.agent_session_id = this.#sessionId
    this.#enqueue({ id: '', method: 'pane.report_agent', params })
  }

  #request(request: HerdrRequest): HerdrRequest {
    lastSequence = Math.max(lastSequence + 1, this.#now() * 1000)
    return { ...request, id: `${HERDR_REPORT_SOURCE}:${request.method}:${lastSequence}`, params: { ...request.params, seq: lastSequence } }
  }

  #enqueue(request: HerdrRequest): void {
    if (this.#retry !== undefined) clearTimeout(this.#retry)
    this.#retry = undefined
    this.#pending = this.#request(request)
    this.#drain()
  }

  #drain(): void {
    if (this.#finished || this.#sending || this.#pending === undefined || this.#transport === undefined) return
    const request = this.#pending
    this.#pending = undefined
    this.#sending = true
    let delivered: ReturnType<HerdrTransport['send']>
    try { delivered = this.#transport.send(request) } catch { delivered = false }
    if (delivered instanceof Promise) void delivered.then(success => { this.#settled(request, success) }, () => { this.#settled(request, false) })
    else this.#settled(request, delivered !== false)
  }

  #settled(request: HerdrRequest, success: boolean): void {
    if (this.#finished) return
    this.#sending = false
    if (request.method === 'pane.release_agent') { this.#stop(); return }
    if (this.#pending !== undefined) { this.#drain(); return }
    if (!success && !this.#released) {
      this.#pending = request
      this.#retry = setTimeout(() => {
        this.#retry = undefined
        if (this.#pending !== undefined) this.#pending = this.#request(this.#pending)
        this.#drain()
      }, HERDR_RETRY_MS)
      this.#retry.unref()
    }
  }

  readonly #stop = (): void => {
    this.#finished = true
    this.#pending = undefined
    if (this.#retry !== undefined) clearTimeout(this.#retry)
    if (this.#releaseTimer !== undefined) clearTimeout(this.#releaseTimer)
    this.#retry = undefined
    this.#releaseTimer = undefined
    if (this.#ownerKey !== undefined && owners.get(this.#ownerKey) === this.#stop) owners.delete(this.#ownerKey)
    this.#resolveRelease?.()
  }
}

const HERDR_REQUEST_TIMEOUT_MS = 500

/** One bounded newline-delimited request/response per connection, off the render path. */
function defaultHerdrTransport(socketPath: string): HerdrTransport {
  const target = herdrSocketTarget(socketPath)
  return {
    send(request) {
      return new Promise<boolean>(resolve => {
        let socket: Socket
        try { socket = connect(target) } catch { resolve(false); return }
        socket.unref()
        socket.setEncoding('utf8')
        let completed = false
        const finish = (success = false): void => {
          if (completed) return
          completed = true
          clearTimeout(timer)
          socket.destroy()
          resolve(success)
        }
        const timer = setTimeout(finish, HERDR_REQUEST_TIMEOUT_MS)
        timer.unref()
        let response = ''
        socket.on('error', () => { finish() })
        socket.on('connect', () => {
          try { socket.write(`${JSON.stringify(request)}\n`) } catch { finish() }
        })
        socket.on('data', (chunk: string) => {
          response += chunk
          if (response.length > 64 * 1024) { finish(); return }
          let newline: number
          while ((newline = response.indexOf('\n')) >= 0) {
            const line = response.slice(0, newline)
            response = response.slice(newline + 1)
            try {
              const reply = JSON.parse(line) as { id?: unknown; result?: { type?: unknown }; error?: unknown }
              if (reply.id === request.id) { finish(reply.error === undefined && reply.result?.type === 'ok'); return }
            } catch { finish(); return }
          }
        })
        socket.on('end', () => { finish() })
        socket.on('close', () => { finish() })
      })
    },
  }
}

/** Herdr exports Unix-style paths; Windows dials them as named pipes. */
export function herdrSocketTarget(socketPath: string, platform: NodeJS.Platform = process.platform): string {
  const lowered = socketPath.toLowerCase()
  if (platform !== 'win32' || lowered.startsWith('\\\\.\\pipe\\') || lowered.startsWith('\\\\?\\pipe\\')) {
    return socketPath
  }
  return `\\\\.\\pipe\\${socketPath}`
}
