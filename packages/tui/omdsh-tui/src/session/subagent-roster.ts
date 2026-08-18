/**
 * Fold descendant subagent sessions into a live TUI roster.
 *
 * The parent transcript never contains child-session events. This module is
 * the single writer of that derived HUD: lineage, descriptor identity, and
 * current child work stay behind one snapshot.
 * @module @agi-fans/dsh-tui/subagent-roster
 */

import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import type { TuiSubagentActivity, TuiSubagentPhase, TuiSubagentRoster, TuiSubagentView } from '../definition.ts'

const ACTIVITY_LIMIT = 8

/** Session fields required to decide whether a live record belongs under the active root. */
export interface SessionLineage {
  readonly header: {
    readonly id: SessionId | string
    readonly parentSession?: SessionId | string
    readonly origin?: string
  }
}

function asId(value: SessionId | string): string {
  return String(value)
}

function parseObject(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function firstLine(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')[0]?.trim() ?? ''
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((block) => {
      if (block === null || typeof block !== 'object') return []
      const item = block as { type?: unknown; text?: unknown }
      return (item.type === 'text' || item.type === 'reasoning') && typeof item.text === 'string'
        ? [item.text]
        : []
    })
    .join('')
}

/** Short fallback when a child has no descriptor label or title yet. */
export function shortSessionLabel(id: string): string {
  return id.length <= 12 ? id : id.slice(-8)
}

/** Continuable children accept later human turns; one-shot runs do not. */
export function isSteerableSubagent(mode: TuiSubagentView['mode'] | undefined): boolean {
  return mode === 'continuable'
}

/** One-line child tool summary used by the roster and tests. */
export function summarizeToolCall(name: string, raw: string): string {
  const args = parseObject(raw)
  if (args === undefined) return name
  const command = typeof args.command === 'string' ? firstLine(args.command) : ''
  if (command !== '') return `${name} ${command}`
  const path = typeof args.path === 'string'
    ? args.path
    : typeof args.file_path === 'string' ? args.file_path : ''
  if (path !== '') return `${name} ${path}`
  const query = typeof args.pattern === 'string'
    ? args.pattern
    : typeof args.query === 'string'
      ? args.query
      : typeof args.description === 'string'
        ? args.description
        : typeof args.url === 'string' ? args.url : ''
  return query === '' ? name : `${name} ${query}`
}

/**
 * Edge distance from `rootId` to `session`, or `undefined` when the session is
 * not an origin-classified descendant of that root.
 */
export function descendantDepth(
  session: SessionLineage,
  rootId: string,
  lookup: (id: string) => SessionLineage | undefined,
): number | undefined {
  if (session.header.origin !== 'subagent') return undefined
  const ownId = asId(session.header.id)
  if (ownId === rootId) return undefined
  let depth = 0
  let parent = session.header.parentSession === undefined ? undefined : asId(session.header.parentSession)
  const seen = new Set<string>([ownId])
  while (parent !== undefined) {
    depth += 1
    if (parent === rootId) return depth
    if (seen.has(parent)) return undefined
    seen.add(parent)
    const next = lookup(parent)
    parent = next?.header.parentSession === undefined ? undefined : asId(next.header.parentSession)
  }
  return undefined
}

function sameActivity(left: TuiSubagentActivity, right: TuiSubagentActivity): boolean {
  return left.text === right.text && left.status === right.status
}

function pushActivity(
  activity: readonly TuiSubagentActivity[],
  next: TuiSubagentActivity,
): readonly TuiSubagentActivity[] {
  const last = activity.at(-1)
  if (last !== undefined && sameActivity(last, next)) return activity
  if (last?.status === 'running' && next.status !== 'thinking' && last.text === next.text) {
    return [...activity.slice(0, -1), next]
  }
  if (last?.status === 'thinking' && next.status === 'thinking') return activity
  return [...activity, next].slice(-ACTIVITY_LIMIT)
}

function settleRunningTool(
  activity: readonly TuiSubagentActivity[],
  status: 'ok' | 'error',
): readonly TuiSubagentActivity[] {
  const last = activity.at(-1)
  if (last?.status !== 'running') return activity
  return [...activity.slice(0, -1), { text: last.text, status }]
}

/** Fold one child-session event into a roster row. Returns the same object when nothing changed. */
export function applySubagentEvent(view: TuiSubagentView, event: SessionEvent): TuiSubagentView {
  switch (event.type) {
    case 'subagent/descriptor': {
      const label = event.data.label?.trim() ?? ''
      const nextLabel = label === '' ? view.label : label
      if (nextLabel === view.label && view.mode === event.data.mode) return view
      return { ...view, label: nextLabel, mode: event.data.mode }
    }
    case 'user/message': {
      if (view.label !== shortSessionLabel(view.id)) return view
      const text = firstLine(contentText(event.data.content))
      if (text === '') return view
      return { ...view, label: text }
    }
    case 'step/start':
      return view.phase === 'running' ? view : { ...view, phase: 'running' }
    case 'assistant/chunk': {
      const chunk = event.data.chunk
      if (chunk.type === 'tool-call-delta') {
        const name = chunk.name ?? 'tool'
        const activity = pushActivity(view.activity, { text: name, status: 'running' })
        if (activity === view.activity && view.phase === 'running') return view
        return { ...view, phase: 'running', activity }
      }
      const activity = pushActivity(view.activity, { text: 'thinking', status: 'thinking' })
      if (activity === view.activity && view.phase === 'running') return view
      return { ...view, phase: 'running', activity }
    }
    case 'tool/call': {
      const activity = pushActivity(view.activity, {
        text: summarizeToolCall(event.data.name, event.data.arguments),
        status: 'running',
      })
      if (activity === view.activity && view.phase === 'running') return view
      return { ...view, phase: 'running', activity }
    }
    case 'tool/result': {
      const inner = event.data.message.content[0]
      const failed = event.data.error !== undefined || inner?.type === 'tool-result' && inner.isError === true
      const activity = settleRunningTool(view.activity, failed ? 'error' : 'ok')
      if (activity === view.activity) return view
      return { ...view, activity }
    }
    case 'assistant/message': {
      const activity = view.activity.at(-1)?.status === 'thinking'
        ? view.activity.slice(0, -1)
        : view.activity
      if (activity === view.activity) return view
      return { ...view, activity }
    }
    case 'turn/end': {
      const reason = event.data.reason
      if (reason.kind === 'error' || reason.kind === 'aborted' || reason.kind === 'interrupted') {
        return view.phase === 'error' ? view : { ...view, phase: 'error' }
      }
      if (view.mode === 'one-shot') {
        return view.phase === 'completed' ? view : { ...view, phase: 'completed' }
      }
      return view.phase === 'waiting' ? view : { ...view, phase: 'waiting' }
    }
    default:
      return view
  }
}

function emptyView(input: {
  id: string
  parentId?: string
  depth: number
  label?: string
  mode?: TuiSubagentView['mode']
  phase?: TuiSubagentPhase
}): TuiSubagentView {
  return {
    id: input.id,
    ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
    depth: input.depth,
    label: input.label === undefined || input.label === '' ? shortSessionLabel(input.id) : input.label,
    ...(input.mode === undefined ? {} : { mode: input.mode }),
    phase: input.phase ?? 'starting',
    activity: [],
  }
}

function compareAgents(left: TuiSubagentView, right: TuiSubagentView): number {
  const leftLive = left.phase === 'running' || left.phase === 'starting' ? 0 : left.phase === 'waiting' ? 1 : 2
  const rightLive = right.phase === 'running' || right.phase === 'starting' ? 0 : right.phase === 'waiting' ? 1 : 2
  if (leftLive !== rightLive) return leftLive - rightLive
  if (left.depth !== right.depth) return left.depth - right.depth
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

/** Mutable fold of the active root's known descendants. */
export class SubagentRoster {
  #rootId: string | undefined
  readonly #agents = new Map<string, TuiSubagentView>()

  reset(rootId?: string): void {
    this.#rootId = rootId
    this.#agents.clear()
  }

  get rootId(): string | undefined {
    return this.#rootId
  }

  owns(id: string): boolean {
    return this.#agents.has(id)
  }

  hasRunning(): boolean {
    for (const agent of this.#agents.values()) {
      if (agent.phase === 'running' || agent.phase === 'starting') return true
    }
    return false
  }

  snapshot(): TuiSubagentRoster | undefined {
    if (this.#agents.size === 0) return undefined
    return { agents: [...this.#agents.values()].sort(compareAgents) }
  }

  remember(input: {
    id: string
    parentId?: string
    depth: number
    label?: string
    mode?: TuiSubagentView['mode']
    phase?: TuiSubagentPhase
  }): TuiSubagentView {
    const existing = this.#agents.get(input.id)
    if (existing === undefined) {
      const created = emptyView(input)
      this.#agents.set(input.id, created)
      return created
    }
    const label = existing.label !== shortSessionLabel(existing.id)
      ? existing.label
      : input.label === undefined || input.label === '' ? existing.label : input.label
    const mode = existing.mode ?? input.mode
    const phase = existing.phase === 'starting' ? input.phase ?? existing.phase : existing.phase
    if (label === existing.label && mode === existing.mode && phase === existing.phase
      && existing.depth === input.depth && existing.parentId === input.parentId) {
      return existing
    }
    const next: TuiSubagentView = {
      ...existing,
      depth: input.depth,
      label,
      phase,
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
      ...(mode === undefined ? {} : { mode }),
    }
    this.#agents.set(input.id, next)
    return next
  }

  hydrate(session: Session, depth: number, agentStatus?: 'idle' | 'running'): TuiSubagentView {
    const id = asId(session.id)
    const parentId = session.header.parentSession === undefined ? undefined : asId(session.header.parentSession)
    const catalog = this.#agents.get(id)
    let view = emptyView({
      id,
      ...(parentId === undefined ? {} : { parentId }),
      depth,
      ...(catalog === undefined ? {} : {
        ...(catalog.label === shortSessionLabel(id) ? {} : { label: catalog.label }),
        ...(catalog.mode === undefined ? {} : { mode: catalog.mode }),
      }),
      phase: agentStatus === 'running' ? 'running' : 'starting',
    })
    const seedLength = session.header.seedLength ?? 0
    for (const event of session.events.slice(seedLength)) view = applySubagentEvent(view, event)
    if (agentStatus === 'running' && view.phase !== 'error') view = { ...view, phase: 'running' }
    else if (agentStatus === 'idle' && view.phase === 'starting') view = { ...view, phase: 'waiting' }
    this.#agents.set(id, view)
    return view
  }

  apply(session: Session, depth: number, _event: SessionEvent, agentStatus?: 'idle' | 'running'): TuiSubagentView {
    return this.hydrate(session, depth, agentStatus)
  }

  setAgentStatus(id: string, status: 'idle' | 'running' | 'gone', stopError = false): TuiSubagentView | undefined {
    const existing = this.#agents.get(id)
    if (existing === undefined) return undefined
    let phase: TuiSubagentPhase
    if (status === 'running') phase = 'running'
    else if (status === 'idle') phase = existing.mode === 'one-shot' ? 'completed' : 'waiting'
    else if (stopError) phase = 'error'
    else if (existing.phase === 'error') phase = 'error'
    else if (existing.mode === 'one-shot') phase = 'completed'
    else phase = 'waiting'
    const settled = status === 'gone' && existing.activity.at(-1)?.status === 'running'
      ? settleRunningTool(existing.activity, stopError ? 'error' : 'ok')
      : existing.activity
    if (phase === existing.phase && settled === existing.activity) return existing
    const next = { ...existing, phase, activity: settled }
    this.#agents.set(id, next)
    return next
  }
}
