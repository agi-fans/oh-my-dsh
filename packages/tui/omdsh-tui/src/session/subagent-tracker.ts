/**
 * SubagentTracker — Session/SessionEvent stream -> published TuiSubagentRoster.
 *
 * Owns the live SubagentRoster, the epoch that fences the async catalog
 * listing, and the snapshot-identity dedup that keeps unchanged rosters off
 * the wire. The controller supplies Harness lookups (depth, agent status,
 * session list, durable children) and owns where the snapshot lands.
 */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { TuiSubagentRoster, TuiSubagentView } from '../definition.ts'
import { SubagentRoster } from './subagent-roster.ts'

/** One durable catalog child, as declared by the subagents runtime listing. */
export interface SubagentCatalogEntry {
  readonly kind: string
  readonly id: string
  readonly mode?: TuiSubagentView['mode']
  readonly label?: string
  readonly activity?: string
}

export interface SubagentTrackerDeps {
  /** Id of the active root agent's session, if a session is active. */
  rootId(): string | undefined
  /** Depth of `session` under the active root, or undefined when unrelated. */
  depth(session: Session): number | undefined
  /** Live status the agents service reports for a session, when loaded. */
  agentStatus(id: string): 'idle' | 'running' | undefined
  /** Loaded sessions, consulted on a full resync. */
  sessions(): readonly Session[]
  /** Durable children of the root, when the subagents runtime is mounted. */
  listChildren(rootId: string): Promise<readonly SubagentCatalogEntry[]> | undefined
  /** Publish the latest roster snapshot after the dedup check passes. */
  publish(roster: TuiSubagentRoster | undefined): void
}

export class SubagentTracker {
  readonly #deps: SubagentTrackerDeps
  readonly #roster = new SubagentRoster()
  #published: TuiSubagentRoster | undefined
  #epoch = 0

  constructor(deps: SubagentTrackerDeps) {
    this.#deps = deps
  }

  /** Whether the roster already tracks this session id. */
  owns(id: string): boolean {
    return this.#roster.owns(id)
  }

  /** The current published snapshot, or undefined for an empty roster. */
  snapshot(): TuiSubagentRoster | undefined {
    return this.#roster.snapshot()
  }

  /** Drop all tracked children and invalidate any in-flight catalog listing. */
  reset(): void {
    this.#epoch += 1
    this.#roster.reset()
  }

  /** Remember a freshly created session when it descends from the root. */
  noteSession(session: Session): void {
    const depth = this.#deps.depth(session)
    if (depth === undefined) return
    const parentId = session.header.parentSession
    this.#roster.remember({
      id: session.id,
      ...(parentId === undefined ? {} : { parentId }),
      depth,
      phase: this.#deps.agentStatus(session.id) === 'running' ? 'running' : 'starting',
    })
    this.#publish()
  }

  /** Fold one durable child event into its roster row. */
  noteEvent(session: Session, event: SessionEvent): void {
    const depth = this.#deps.depth(session)
    if (depth === undefined) return
    this.#roster.apply(session, depth, event, this.#deps.agentStatus(session.id))
    this.#publish()
  }

  /** Add the direct children a Session's durable catalog declares. */
  observeCatalog(session: Session, events: readonly SessionEvent[]): void {
    if (this.#roster.observeCatalog(session.id, events)) this.#publish()
  }

  /** Apply a live agent-status change, hydrating cold children on first sight. */
  noteStatus(session: Session, status: 'idle' | 'running'): void {
    if (this.#roster.owns(session.id)) {
      this.#roster.setAgentStatus(session.id, status)
      this.#publish()
      return
    }
    const depth = this.#deps.depth(session)
    if (depth === undefined) return
    this.#roster.hydrate(session, depth, this.#deps.agentStatus(session.id) ?? status)
    this.#publish()
  }

  /** Mark a disposed session gone so its running tools settle. */
  noteGone(session: Session): void {
    if (!this.#roster.owns(session.id)) return
    this.#roster.setAgentStatus(session.id, 'gone')
    this.#publish()
  }

  /**
   * Rebuild the roster around the active root: live sessions hydrate from
   * their own events, then the durable catalog lists children that are not
   * loaded. A stale listing is fenced by the epoch and a root re-check.
   */
  sync(): void {
    const rootId = this.#deps.rootId()
    const epoch = this.#epoch + 1
    this.#epoch = epoch
    if (rootId === undefined) {
      this.#roster.reset()
      this.#publish()
      return
    }
    this.#roster.reset(rootId)
    for (const session of this.#deps.sessions()) {
      const depth = this.#deps.depth(session)
      if (depth === undefined) continue
      this.#roster.hydrate(session, depth, this.#deps.agentStatus(session.id))
    }
    this.#publish()
    const listed = this.#deps.listChildren(rootId)
    if (listed === undefined) return
    void listed.then((entries) => {
      if (epoch !== this.#epoch || this.#deps.rootId() !== rootId) return
      for (const entry of entries) {
        if (entry.kind !== 'child') continue
        this.#roster.remember({
          id: entry.id,
          depth: 1,
          mode: entry.mode,
          ...(entry.label === undefined ? {} : { label: entry.label }),
          phase: entry.activity === 'running' ? 'running' : 'waiting',
        })
      }
      this.#publish()
    }, () => undefined)
  }

  /** Push the roster when its snapshot identity changed since the last push. */
  #publish(): void {
    const roster = this.#roster.snapshot()
    if (roster === this.#published) return
    this.#published = roster
    this.#deps.publish(roster)
  }
}
