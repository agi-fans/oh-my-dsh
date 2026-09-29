/** Harness ToolDefinition presentation bridge for live events and replay. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { TuiToolPresentation } from '../chrome/tool-renderers.ts'

export const name = 'omdsh-tool-presentation'
export const inject = ['tools']

export interface ToolPresentationBridge {
  event(agent: Agent, event: SessionEvent): TuiToolPresentation | undefined
  session(agent: Agent, events: readonly SessionEvent[]): ReadonlyMap<number, TuiToolPresentation>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Resolves tool-owned provider-neutral presentation for the active Agent scope. */
    tuiToolPresentation: ToolPresentationBridge
  }
}

/** The presenter payload's own type, read off the tool definition we call. */
type PresentResultMeta = Parameters<NonNullable<ToolDefinition['presentResult']>>[1] extends infer R
  ? R extends { meta?: infer M } ? M : never
  : never

/** Decode a `tool/call` argument string; PTC dispatch events already carry a value. */
function parsedArguments(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

class HarnessToolPresentation implements ToolPresentationBridge {
  readonly #ctx: Context
  /**
   * Per-session live tool/call index. Live events arrive in log order through
   * `event()`, so each tool/result resolves its call in O(1) instead of
   * rescanning the growing session log the way `findLast` did.
   */
  readonly #liveCalls = new WeakMap<Session, Map<string, SessionEvent>>()

  constructor(ctx: Context) {
    this.#ctx = ctx
  }

  event(agent: Agent, event: SessionEvent): TuiToolPresentation | undefined {
    if (event.type === 'tool/call') {
      let calls = this.#liveCalls.get(agent.session)
      if (calls === undefined) {
        calls = new Map()
        this.#liveCalls.set(agent.session, calls)
      }
      calls.set(event.data.callId, event)
    }
    return this.#event(agent, event, undefined)
  }

  #presentCall(agent: Agent, name: string, args: unknown): ToolCallView | undefined {
    const definition = this.#ctx.tools.get(name, agent)
    if (definition?.presentCall === undefined) return undefined
    try {
      return definition.presentCall(args)
    } catch {
      return undefined
    }
  }

  /** Resolve the call and result cards for one settled invocation. */
  #present(
    agent: Agent,
    name: string,
    rawArgs: unknown,
    content: readonly ContentBlock[],
    isError: boolean,
    meta: PresentResultMeta | undefined,
  ): TuiToolPresentation | undefined {
    const args = parsedArguments(rawArgs)
    const call = this.#presentCall(agent, name, args)
    let result
    try {
      result = this.#ctx.tools.get(name, agent)?.presentResult?.(args, {
        // The harness freezes message content; `ToolResult` declares a mutable array.
        content: [...content],
        isError,
        ...(meta === undefined ? {} : { meta }),
      })
    } catch {
      result = undefined
    }
    return call === undefined && result === undefined ? undefined : {
      ...(call === undefined ? {} : { call }),
      ...(result === undefined ? {} : { result }),
    }
  }

  #event(
    agent: Agent,
    event: SessionEvent,
    callIndex: ReadonlyMap<string, SessionEvent> | undefined,
  ): TuiToolPresentation | undefined {
    // A PTC sub-dispatch carries the tool name and its normalized arguments on
    // both halves of the pair, so it resolves a card without a call index — the
    // same cards a native call of the same tool would get.
    if (event.type === 'tool/ptc-dispatch-start') {
      const call = this.#presentCall(agent, event.data.name, event.data.arguments)
      return call === undefined ? undefined : { call }
    }
    if (event.type === 'tool/ptc-dispatch') {
      return this.#present(agent, event.data.name, event.data.arguments, event.data.content, event.data.isError, undefined)
    }
    if (event.type === 'tool/call') {
      const call = this.#presentCall(agent, event.data.name, parsedArguments(event.data.arguments))
      return call === undefined ? undefined : { call }
    }
    if (event.type !== 'tool/result') return undefined
    const callId = event.data.message.source.callId
    const callEvent = callIndex?.get(callId)
      ?? this.#liveCalls.get(agent.session)?.get(callId)
      ?? agent.session.snapshotEvents().findLast(candidate =>
        candidate.type === 'tool/call' && candidate.data.callId === callId)
    if (callEvent?.type !== 'tool/call') return undefined
    return this.#present(
      agent, callEvent.data.name, callEvent.data.arguments,
      event.data.message.content, event.data.message.isError === true, event.data.meta,
    )
  }

  session(agent: Agent, events: readonly SessionEvent[]): ReadonlyMap<number, TuiToolPresentation> {
    // One pass builds a callId index instead of the per-result backwards
    // log scan, keeping replay linear in the event count.
    const callIndex = new Map<string, SessionEvent>()
    for (const event of events) {
      if (event.type === 'tool/call') callIndex.set(event.data.callId, event)
    }
    const presentations = new Map<number, TuiToolPresentation>()
    for (const event of events) {
      const presentation = this.#event(agent, event, callIndex)
      if (presentation !== undefined) presentations.set(event.seq, presentation)
    }
    return presentations
  }
}

/** Construct the bridge for tests and non-Cordis embedding. */
export function createToolPresentationBridge(ctx: Context): ToolPresentationBridge {
  return new HarnessToolPresentation(ctx)
}

export function apply(ctx: Context): void {
  ctx.provide('tuiToolPresentation', createToolPresentationBridge(ctx))
}
