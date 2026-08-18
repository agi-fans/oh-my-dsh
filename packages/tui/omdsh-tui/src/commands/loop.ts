/** Process-local prompt loop contributed as an independent omdsh plugin. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { TuiLoopStatus, TuiService, TuiSubmission } from '../definition.ts'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-loop'
export const inject = ['commands', 'omdshSession', 'tui']

const DEFAULT_REPEAT_DELAY_MS = 800
const DEFAULT_COMPLETION_MS = 1_600

export type LoopLimit =
  | { kind: 'iterations'; count: number }
  | { kind: 'duration'; durationMs: number; label: string }

export interface LoopRequest {
  limit?: LoopLimit
  prompt?: string
}

interface LoopSessionPort {
  readonly agent: Agent | undefined
  assertActive(agent: Agent): void
  send(input: string | TuiSubmission, agent?: Agent): Promise<void>
}

interface ActiveLoop {
  agent: Agent
  prompt?: TuiSubmission
  phase: TuiLoopStatus['phase']
  remaining?: number
  total?: number
  repeats: number
  durationRemainingMs?: number
  deadline?: number
  limitLabel?: string
  operation: AbortController
}

function durationUnitMs(unit: string): number | undefined {
  if (/^(?:s|sec|secs|second|seconds)$/u.test(unit)) return 1_000
  if (/^(?:m|min|mins|minute|minutes)$/u.test(unit)) return 60_000
  if (/^(?:h|hr|hrs|hour|hours)$/u.test(unit)) return 3_600_000
  return undefined
}

function parseDuration(token: string): number | undefined {
  const part = /(\d+(?:\.\d+)?)([a-z]+)/guy
  let offset = 0
  let total = 0
  while (offset < token.length) {
    part.lastIndex = offset
    const match = part.exec(token)
    if (match === null || match.index !== offset || match[1] === undefined || match[2] === undefined) return undefined
    const unitMs = durationUnitMs(match[2].toLowerCase())
    if (unitMs === undefined) return undefined
    total += Number(match[1]) * unitMs
    offset = part.lastIndex
  }
  return Number.isFinite(total) && total > 0 ? Math.round(total) : undefined
}

/** Parse the oh-my-pi-compatible `/loop [count|duration] [prompt]` tail. */
export function parseLoopRequest(rawInput: string): LoopRequest {
  const input = rawInput.trim()
  if (input === '') return {}
  const separator = input.search(/\s/u)
  const head = separator === -1 ? input : input.slice(0, separator)
  const tail = separator === -1 ? '' : input.slice(separator).trim()
  if (/^\d+$/u.test(head)) {
    const count = Number(head)
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error('Loop count must be a positive integer.')
    return {
      limit: { kind: 'iterations', count },
      ...(tail === '' ? {} : { prompt: tail }),
    }
  }
  const durationMs = parseDuration(head)
  if (durationMs !== undefined) {
    return {
      limit: { kind: 'duration', durationMs, label: head },
      ...(tail === '' ? {} : { prompt: tail }),
    }
  }
  if (/^\d/u.test(head)) {
    throw new Error('Invalid loop limit. Use a count such as 5 or a duration such as 10m or 1h30m.')
  }
  return { prompt: input }
}

function cloneSubmission(submission: TuiSubmission): TuiSubmission {
  return {
    text: submission.text,
    images: submission.images.map(image => ({ ...image, data: image.data.slice() })),
  }
}

function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel)
      resolve(true)
    }, ms)
    const cancel = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', cancel, { once: true })
  })
}

/** Runtime state for one top-level omdsh loop; intentionally not persisted. */
export class LoopRuntime {
  #active: ActiveLoop | undefined
  #completionTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly session: LoopSessionPort,
    private readonly tui: Pick<TuiService, 'notice' | 'setLoopStatus'>,
    private readonly repeatDelayMs = DEFAULT_REPEAT_DELAY_MS,
    private readonly completionMs = DEFAULT_COMPLETION_MS,
  ) {}

  isEnabled(agent?: Agent): boolean {
    return this.#active !== undefined && (agent === undefined || this.#active.agent === agent)
  }

  async enable(agent: Agent, request: LoopRequest): Promise<void> {
    this.session.assertActive(agent)
    this.#stop()
    const operation = new AbortController()
    this.#active = {
      agent,
      phase: 'waiting',
      repeats: 0,
      ...(request.limit?.kind === 'iterations' ? { remaining: request.limit.count, total: request.limit.count } : {}),
      ...(request.limit?.kind === 'duration'
        ? { durationRemainingMs: request.limit.durationMs, limitLabel: request.limit.label }
        : {}),
      operation,
    }
    this.#publish()
    if (request.prompt !== undefined) {
      const submission = { text: request.prompt, images: [] }
      await this.submit(submission, agent)
    }
  }

  disable(agent?: Agent): boolean {
    if (this.#active === undefined || (agent !== undefined && this.#active.agent !== agent)) return false
    this.#stop()
    return true
  }

  /** Atomically accept, dispatch, and arm a human composer submission. */
  async submit(submission: TuiSubmission, agent: Agent): Promise<boolean> {
    const active = this.#active
    if (active === undefined || active.agent !== agent) return false
    const previousPrompt = active.prompt === undefined ? undefined : cloneSubmission(active.prompt)
    const previousPhase = active.phase
    const previousDeadline = active.deadline
    active.operation.abort()
    active.operation = new AbortController()
    active.prompt = cloneSubmission(submission)
    active.phase = 'running'
    if (active.durationRemainingMs !== undefined && active.deadline === undefined) {
      active.deadline = Date.now() + active.durationRemainingMs
    }
    this.#publish()
    try {
      await this.session.send(submission, agent)
    } catch (error: unknown) {
      active.operation.abort()
      active.operation = new AbortController()
      if (previousPrompt === undefined) delete active.prompt
      else active.prompt = previousPrompt
      active.phase = previousPhase
      if (previousDeadline === undefined) delete active.deadline
      else active.deadline = previousDeadline
      this.#publish()
      if (active.prompt !== undefined) void this.#run(active, active.operation.signal)
      throw error
    }
    void this.#run(active, active.operation.signal)
    return true
  }

  /** Interrupt the current iteration and wait for a new prompt without disabling Loop. */
  pause(agent?: Agent): boolean {
    const active = this.#active
    if (active === undefined || (agent !== undefined && active.agent !== agent) || active.prompt === undefined) return false
    active.operation.abort()
    active.operation = new AbortController()
    if (active.deadline !== undefined) {
      active.durationRemainingMs = Math.max(0, active.deadline - Date.now())
      delete active.deadline
    }
    delete active.prompt
    active.phase = 'paused'
    this.#publish()
    return true
  }

  /** Drop a loop as soon as a command replaces the active session. */
  syncAgent(agent: Agent | undefined): void {
    if (this.#active !== undefined && this.#active.agent !== agent) this.#stop()
  }

  dispose(): void {
    this.#stop()
  }

  async #run(active: ActiveLoop, signal: AbortSignal): Promise<void> {
    while (!signal.aborted && this.#active === active && active.prompt !== undefined) {
      try {
        await active.agent.whenIdle()
      } catch (error: unknown) {
        if (!signal.aborted) this.#fail(error)
        return
      }
      if (signal.aborted || this.#active !== active) return
      if (this.session.agent !== active.agent) {
        this.#stop()
        return
      }
      if (!await wait(this.repeatDelayMs, signal)) return
      if (active.remaining !== undefined && active.remaining <= 0) {
        this.#complete()
        return
      }
      if (active.deadline !== undefined && Date.now() >= active.deadline) {
        this.#complete()
        return
      }
      const prompt = cloneSubmission(active.prompt)
      if (active.remaining !== undefined) active.remaining -= 1
      active.repeats += 1
      this.#publish()
      try {
        await this.session.send(prompt, active.agent)
      } catch (error: unknown) {
        if (!signal.aborted) this.#fail(error)
        return
      }
    }
  }

  #complete(): void {
    const active = this.#active
    if (active === undefined) return
    active.operation.abort()
    this.#active = undefined
    if (this.#completionTimer !== undefined) clearTimeout(this.#completionTimer)
    this.tui.setLoopStatus({
      phase: 'completed',
      repeats: active.repeats,
      ...(active.total === undefined ? {} : { total: active.total }),
      ...(active.limitLabel === undefined ? {} : { limit: active.limitLabel }),
    })
    this.#completionTimer = setTimeout(() => {
      this.#completionTimer = undefined
      if (this.#active === undefined) this.tui.setLoopStatus(undefined)
    }, this.completionMs)
    this.#completionTimer.unref?.()
  }

  #fail(error: unknown): void {
    this.#stop()
    this.tui.notice(`Loop stopped: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' })
  }

  #stop(): void {
    if (this.#completionTimer !== undefined) {
      clearTimeout(this.#completionTimer)
      this.#completionTimer = undefined
    }
    this.#active?.operation.abort()
    this.#active = undefined
    this.tui.setLoopStatus(undefined)
  }

  #publish(): void {
    const active = this.#active
    if (active === undefined) {
      this.tui.setLoopStatus(undefined)
      return
    }
    this.tui.setLoopStatus({
      phase: active.phase,
      repeats: active.repeats,
      ...(active.total === undefined ? {} : { total: active.total }),
      ...(active.deadline === undefined ? {} : { deadline: active.deadline }),
      ...(active.limitLabel === undefined ? {} : { limit: active.limitLabel }),
    })
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Process-local repeated-prompt scheduler contributed by `/loop`. */
    omdshLoop: LoopRuntime
  }
}

async function loop(runtime: LoopRuntime, invocation: CommandInvocation): Promise<CommandResult> {
  if (runtime.disable(invocation.agent)) return { kind: 'success' }
  let request: LoopRequest
  try {
    request = parseLoopRequest(invocation.rawInput)
  } catch (error: unknown) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
  await runtime.enable(invocation.agent, request)
  return { kind: 'success' }
}

export function apply(ctx: Context): void {
  const session = ctx.get('omdshSession')
  const tui = ctx.get('tui')
  if (session === undefined || tui === undefined) throw new Error('omdsh-command-loop: session runtime and tui are required')
  const runtime = new LoopRuntime(session, tui)
  ctx.provide('omdshLoop', runtime)
  registerCommands(ctx, [{
    name: 'loop',
    description: 'Repeat a prompt after every completed turn',
    input: { hint: '[count|duration] [prompt]' },
    handler: invocation => loop(runtime, invocation),
  }], 'omdsh loop command')
  ctx.effect(() => () => { runtime.dispose() }, 'omdsh loop runtime lifecycle')
}
