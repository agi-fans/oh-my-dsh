import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { blocksText } from './content-text.ts'
import { conversationTurns } from './conversation-turns.ts'

export interface SessionTreeBranch {
  id: string
  parentId?: string
  inheritedEventCount: number
  events: readonly SessionEvent[]
  title?: string
  agentPreset?: string
}

export interface SessionTreeNode {
  id: string
  parentId?: string
  sessionId: string
  kind: 'branch' | 'turn'
  messageIndex?: number
  label: string
  preview: string
  description: string
  current: boolean
}

/** Select the current conversation's ancestors and forks, excluding unrelated roots. */
export function sessionTreeFamily(branches: readonly Pick<SessionTreeBranch, 'id' | 'parentId'>[], currentId: string): Set<string> {
  const byId = new Map(branches.map(branch => [branch.id, branch]))
  let root = currentId
  const ancestors = new Set<string>()
  while (!ancestors.has(root)) {
    ancestors.add(root)
    const parent = byId.get(root)?.parentId
    if (parent === undefined || !byId.has(parent) || ancestors.has(parent)) break
    root = parent
  }
  const family = new Set([root])
  const children = new Map<string, string[]>()
  for (const branch of branches) {
    if (branch.parentId === undefined) continue
    const siblings = children.get(branch.parentId) ?? []
    siblings.push(branch.id)
    children.set(branch.parentId, siblings)
  }
  const pending = [root]
  for (let at = 0; at < pending.length; at++) {
    for (const id of children.get(pending[at]!) ?? []) {
      if (family.has(id)) continue
      family.add(id)
      pending.push(id)
    }
  }
  return family
}

/** Project immutable Harness fork prefixes into Turn nodes without repeating inherited turns. */
export function buildSessionTree(branches: readonly SessionTreeBranch[], currentId: string): SessionTreeNode[] {
  const family = sessionTreeFamily(branches, currentId)
  const byId = new Map(branches.filter(branch => family.has(branch.id)).map(branch => [branch.id, branch]))
  const nodes: SessionTreeNode[] = []
  const anchors = new Map<string, { at: number; id: string }[]>()
  const visiting = new Set<string>()
  const add = (branch: SessionTreeBranch): void => {
    if (anchors.has(branch.id) || visiting.has(branch.id)) return
    visiting.add(branch.id)
    const parent = branch.parentId === undefined ? undefined : byId.get(branch.parentId)
    if (parent !== undefined) add(parent)
    const cut = parent === undefined ? 0 : Math.max(0, branch.inheritedEventCount)
    const inherited = parent === undefined ? [] : (anchors.get(parent.id) ?? []).filter(anchor => anchor.at < cut)
    const branchId = `session:${branch.id}`
    const turns = conversationTurns(branch.events)
    const own = turns.filter(turn => turn.messageIndex >= cut)
    const title = branch.title ?? own[0]?.preview ?? turns[0]?.preview ?? 'Empty conversation'
    const current = branch.id === currentId
    const branchPoint = parent === undefined ? undefined
      : cut <= parent.events.length ? inherited.at(-1)?.id ?? `session:${parent.id}` : `session:${parent.id}`
    nodes.push({
      id: branchId, ...(branchPoint === undefined ? {} : { parentId: branchPoint }),
      sessionId: branch.id, kind: 'branch', label: parent === undefined ? `Conversation · ${title}` : `Branch · ${title}`,
      description: current ? 'Current branch' : 'Continue branch', current,
      preview: `### Branch\n\n${title}\n\n${current ? 'This branch is active.' : 'Continue this branch from its latest state.'}\n\n${turns.length} conversation turns.`,
    })
    let previous = branchId
    const positions = [...inherited]
    for (let index = 0; index < own.length; index++) {
      const turn = own[index]!
      const id = `turn:${branch.id}:${turn.messageIndex}`
      const message = branch.events[turn.messageIndex]!
      const next = own[index + 1]?.branchIndex ?? branch.events.length
      const tail = branch.events.slice(turn.messageIndex + 1, next)
      const replies = tail.flatMap(event => event.type === 'assistant/message'
        ? [blocksText(event.data.message.content)] : []).filter(text => text !== '')
      const end = tail.find(event => event.type === 'turn/end' && event.data.turn === turn.turn)
      const outcome = end?.type === 'turn/end' ? end.data.reason.kind : 'unfinished'
      const content = message.type === 'user/message' ? blocksText(message.data.content) : turn.preview
      const fileCount = message.type === 'user/message' ? message.data.content.filter(block => block.type === 'file').length : 0
      const attachments = [turn.imageCount > 0 ? `${turn.imageCount} images` : '', fileCount > 0 ? `${fileCount} files` : ''].filter(Boolean).join(' · ')
      nodes.push({
        id, parentId: previous, sessionId: branch.id, kind: 'turn', messageIndex: turn.messageIndex,
        label: `Turn ${turn.turn} · ${turn.preview}`, description: outcome, current: false,
        preview: `## Turn ${turn.turn} · ${outcome}\n\n### User\n\n${content || turn.preview}${attachments === '' ? '' : `\n\nAttachments: ${attachments}`}\n\n### Assistant\n\n${replies.at(-1) ?? 'No final reply recorded.'}`,
      })
      positions.push({ at: turn.branchIndex, id })
      previous = id
    }
    anchors.set(branch.id, positions)
    visiting.delete(branch.id)
  }
  for (const id of family) {
    const branch = byId.get(id)
    if (branch !== undefined) add(branch)
  }
  return nodes
}
