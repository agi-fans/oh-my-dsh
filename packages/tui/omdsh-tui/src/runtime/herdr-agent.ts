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
  send(request: HerdrRequest): void
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

  /**
   * Forget the last projection without reporting. A replaced session makes
   * the previous state meaningless, but only a fresh signal may publish,
   * because a compaction or resume can swap sessions mid-driver.
   */
  reset(): void {
    this.#running = false
    this.#prompts = 0
    this.#promptMessage = undefined
    this.#last = undefined
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
  /** Environment to detect Herdr from. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
  /** Delivery seam for tests. Defaults to the local socket transport. */
  readonly transport?: (socketPath: string) => HerdrTransport
  /** Clock seam for the monotonic sequence. Defaults to `Date.now`. */
  readonly now?: () => number
}

/**
 * Report omdsh lifecycle state to the Herdr pane that owns this process.
 *
 * Reports are best-effort and silent, matching Herdr's own integrations: a
 * missing or restarted server must never disturb the TUI.
 */
export class HerdrAgentReporter {
  readonly #environment: HerdrEnvironment | undefined
  readonly #transport: HerdrTransport | undefined
  readonly #controller = new HerdrAgentStatusController()
  readonly #now: () => number
  #seq: number
  #sessionId: string | undefined
  #released = false

  constructor(options: HerdrAgentReporterOptions = {}) {
    this.#now = options.now ?? ((): number => Date.now())
    this.#seq = this.#now() * 1000
    this.#environment = herdrEnvironment(options.env ?? process.env)
    this.#transport = this.#environment === undefined
      ? undefined
      : (options.transport ?? defaultHerdrTransport)(this.#environment.socketPath)
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
    this.#controller.reset()
  }

  /** Release the pane's lifecycle authority; later reports are dropped. */
  release(): void {
    const environment = this.#environment
    const transport = this.#transport
    if (this.#released || environment === undefined || transport === undefined) return
    this.#released = true
    this.#deliver(transport, {
      id: `${HERDR_REPORT_SOURCE}:release:${this.#now()}`,
      method: 'pane.release_agent',
      params: {
        pane_id: environment.paneId,
        source: HERDR_REPORT_SOURCE,
        agent: HERDR_AGENT_LABEL,
        seq: this.#nextSeq(),
      },
    })
  }

  #report(status: HerdrAgentStatus | undefined): void {
    const environment = this.#environment
    const transport = this.#transport
    if (status === undefined || this.#released || environment === undefined || transport === undefined) return
    const params: Record<string, unknown> = {
      pane_id: environment.paneId,
      source: HERDR_REPORT_SOURCE,
      agent: HERDR_AGENT_LABEL,
      state: status.state,
      seq: this.#nextSeq(),
    }
    if (status.message !== undefined) params.message = status.message
    if (this.#sessionId !== undefined) params.agent_session_id = this.#sessionId
    this.#deliver(transport, {
      id: `${HERDR_REPORT_SOURCE}:${status.state}:${this.#now()}`,
      method: 'pane.report_agent',
      params,
    })
  }

  /** A broken transport must never throw into the TUI's status or dispose path. */
  #deliver(transport: HerdrTransport, request: HerdrRequest): void {
    try {
      transport.send(request)
    } catch {
      // Best-effort delivery, matching Herdr's own integrations.
    }
  }

  /**
   * Strictly increasing across reporter instances in one process: Herdr
   * ignores a report whose sequence is not above the last accepted one for the
   * same source, so a plugin reload must not restart below a used sequence.
   */
  #nextSeq(): number {
    this.#seq = Math.max(this.#seq + 1, this.#now() * 1000)
    return this.#seq
  }
}

const HERDR_REQUEST_TIMEOUT_MS = 500

/**
 * One JSON line per request over a short-lived local connection. The server
 * acknowledges every request, but delivery stays fire-and-forget: the pane
 * must never wait on Herdr, and `unref()` keeps a pending write from holding
 * the process open.
 */
function defaultHerdrTransport(socketPath: string): HerdrTransport {
  const target = herdrSocketTarget(socketPath)
  return {
    send(request) {
      let socket: Socket
      try {
        socket = connect(target)
      } catch {
        return
      }
      socket.unref()
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (): void => {
        if (timer !== undefined) clearTimeout(timer)
        socket.destroy()
      }
      timer = setTimeout(finish, HERDR_REQUEST_TIMEOUT_MS)
      timer.unref()
      socket.on('error', finish)
      socket.on('connect', () => { socket.write(`${JSON.stringify(request)}\n`) })
      socket.on('data', finish)
      socket.on('end', finish)
      socket.on('close', finish)
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
