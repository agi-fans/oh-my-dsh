/** Harness ToolDefinition presentation bridge for live events and replay. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { TuiToolPresentation } from '../chrome/tool-renderers.ts'
import type {} from '@deepseek-ai/dsh-working-directory'

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

interface CallRecord { event: SessionEvent; cwd: string | undefined }
function callKey(event: SessionEvent): string | undefined {
  if (event.type === 'tool/call') return event.data.callId
  if (event.type === 'tool/result') return event.data.message.source.callId
  if (event.type === 'tool/ptc-dispatch-start' || event.type === 'tool/ptc-dispatch') return event.data.subCallId
  return undefined
}

class HarnessToolPresentation implements ToolPresentationBridge {
  readonly #ctx: Context
  /**
   * Per-session live tool/call index. Live events arrive in log order through
   * `event()`, so each tool/result resolves its call in O(1) instead of
   * rescanning the growing session log the way `findLast` did.
   */
  readonly #liveCalls = new WeakMap<Session, Map<string, CallRecord>>()

  constructor(ctx: Context) {
    this.#ctx = ctx
  }

  event(agent: Agent, event: SessionEvent): TuiToolPresentation | undefined {
    if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') {
      let calls = this.#liveCalls.get(agent.session)
      if (calls === undefined) {
        calls = new Map()
        this.#liveCalls.set(agent.session, calls)
      }
      calls.set(callKey(event)!, { event, cwd: this.#directory(agent) })
    }
    return this.#event(agent, event, undefined)
  }

  #directory(agent: Agent, initial = false): string | undefined {
    const service = typeof this.#ctx.get === 'function' ? this.#ctx.get('workingDirectory') : undefined
    return initial ? agent.session.header?.cwd ?? service?.defaultDirectory : service?.get(agent.session) ?? agent.session.header?.cwd
  }

  #records(agent: Agent, events: readonly SessionEvent[], initial = this.#directory(agent, true)): Map<string, CallRecord> {
    const records = new Map<string, CallRecord>()
    let cwd = initial
    for (const event of events) {
      if (event.type === 'working-directory/change') cwd = event.data.cwd
      if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') records.set(callKey(event)!, { event, cwd })
    }
    return records
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
    callIndex: ReadonlyMap<string, CallRecord> | undefined,
  ): TuiToolPresentation | undefined {
    const key = callKey(event)
    if (key === undefined) return undefined
    const record = callIndex?.get(key) ?? this.#liveCalls.get(agent.session)?.get(key)
      ?? this.#records(agent, agent.session.snapshotEvents()).get(key)
    const cwd = record?.cwd
    const located = (presentation: TuiToolPresentation | undefined): TuiToolPresentation | undefined => presentation === undefined
      ? undefined : cwd === undefined ? presentation : { ...presentation, cwd }
    // A PTC sub-dispatch carries the tool name and its normalized arguments on
    // both halves of the pair, so it resolves a card without a call index — the
    // same cards a native call of the same tool would get.
    if (event.type === 'tool/ptc-dispatch-start') {
      const call = this.#presentCall(agent, event.data.name, event.data.arguments)
      return located(call === undefined ? undefined : { call })
    }
    if (event.type === 'tool/ptc-dispatch') {
      return located(this.#present(agent, event.data.name, event.data.arguments, event.data.content, event.data.isError, undefined))
    }
    if (event.type === 'tool/call') {
      const call = this.#presentCall(agent, event.data.name, parsedArguments(event.data.arguments))
      return located(call === undefined ? undefined : { call })
    }
    if (event.type !== 'tool/result') return undefined
    const callEvent = record?.event
    if (callEvent?.type !== 'tool/call') return undefined
    return located(this.#present(
      agent, callEvent.data.name, callEvent.data.arguments,
      event.data.message.content, event.data.message.isError === true, event.data.meta,
    ))
  }

  session(agent: Agent, events: readonly SessionEvent[]): ReadonlyMap<number, TuiToolPresentation> {
    // One pass builds a callId index instead of the per-result backwards
    // log scan, keeping replay linear in the event count.
    let initial = this.#directory(agent, true)
    // An inspected child's own events may omit its inherited directory changes.
    const first = events[0]?.seq
    if (first !== undefined && first > 1) {
      for (const event of agent.session.snapshotEvents()) {
        if (event.seq >= first) break
        if (event.type === 'working-directory/change') initial = event.data.cwd
      }
    }
    const callIndex = this.#records(agent, events, initial)
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
