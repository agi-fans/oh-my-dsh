/** Harness ToolDefinition presentation bridge for live events and replay. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
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

function parsedArguments(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

class HarnessToolPresentation implements ToolPresentationBridge {
  readonly #ctx: Context

  constructor(ctx: Context) {
    this.#ctx = ctx
  }

  event(agent: Agent, event: SessionEvent): TuiToolPresentation | undefined {
    if (event.type === 'tool/call') {
      const definition = this.#ctx.tools.get(event.data.name, agent)
      if (definition?.presentCall === undefined) return undefined
      try {
        const call = definition.presentCall(parsedArguments(event.data.arguments))
        return call === undefined ? undefined : { call }
      } catch {
        return undefined
      }
    }
    if (event.type !== 'tool/result') return undefined
    const callId = event.data.message.source.callId
    const callEvent = agent.session.events.findLast(candidate =>
      candidate.type === 'tool/call' && candidate.data.callId === callId)
    if (callEvent?.type !== 'tool/call') return undefined
    const definition = this.#ctx.tools.get(callEvent.data.name, agent)
    const args = parsedArguments(callEvent.data.arguments)
    let call
    let result
    try {
      call = definition?.presentCall?.(args)
    } catch {
      call = undefined
    }
    try {
      const block = event.data.message.content[0]
      result = definition?.presentResult?.(args, {
        content: block.content,
        isError: block.isError === true,
        ...(event.data.meta === undefined ? {} : { meta: event.data.meta }),
      })
    } catch {
      result = undefined
    }
    return call === undefined && result === undefined ? undefined : {
      ...(call === undefined ? {} : { call }),
      ...(result === undefined ? {} : { result }),
    }
  }

  session(agent: Agent, events: readonly SessionEvent[]): ReadonlyMap<number, TuiToolPresentation> {
    const presentations = new Map<number, TuiToolPresentation>()
    for (const event of events) {
      const presentation = this.event(agent, event)
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
