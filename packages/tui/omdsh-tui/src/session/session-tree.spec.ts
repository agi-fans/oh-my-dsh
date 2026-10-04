import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { buildSessionTree, sessionTreeFamily } from './session-tree.ts'

const turn = (number: number, text: string): SessionEvent[] => [
  { type: 'turn/start', data: { turn: number } },
  { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } },
  { type: 'assistant/message', data: { turn: number, message: { content: [{ type: 'text', text: `Answer to ${text}` }] } } },
  { type: 'turn/end', data: { turn: number, reason: { kind: 'completed' } } },
] as unknown as SessionEvent[]

describe('Session Tree projection', () => {
  const root = { id: 'root', inheritedEventCount: 0, events: [...turn(1, 'Shared'), ...turn(2, 'Original')] }
  const child = { id: 'fork', parentId: 'root', inheritedEventCount: 4, events: [...root.events.slice(0, 4), ...turn(2, 'Alternative')] }

  it('attaches a fork at the shared turn and does not repeat the inherited prefix', () => {
    const nodes = buildSessionTree([child, root], 'fork')
    expect(nodes.filter(node => node.kind === 'turn' && node.label.includes('Shared'))).toHaveLength(1)
    expect(nodes.filter(node => node.kind === 'turn')).toHaveLength(3)
    expect(nodes.find(node => node.id === 'session:fork')?.parentId).toBe('turn:root:1')
    expect(nodes.find(node => node.label.includes('Alternative') && node.kind === 'turn')?.parentId).toBe('session:fork')
    expect(nodes.find(node => node.current)?.id).toBe('session:fork')
    const preview = nodes.find(node => node.id === 'turn:root:5')?.preview
    expect(preview).toContain('### User\n\nOriginal')
    expect(preview).toContain('### Assistant\n\nAnswer to Original')
  })

  it('locates a fork of an inherited prefix in its original ancestor', () => {
    const grandchild = { ...child, id: 'grandchild', parentId: 'fork' }
    const nodes = buildSessionTree([grandchild, child, root], 'grandchild')
    expect(nodes.find(node => node.id === 'session:grandchild')?.parentId).toBe('turn:root:1')
  })

  it('keeps unrelated sessions outside the current family and handles missing ancestors', () => {
    const other = { ...root, id: 'other' }
    expect(sessionTreeFamily([child, root, other], 'fork')).toEqual(new Set(['root', 'fork']))
    expect(buildSessionTree([child, other], 'fork').some(node => node.sessionId === 'other')).toBe(false)
    expect(buildSessionTree([child], 'fork')[0]?.parentId).toBeUndefined()
    expect(buildSessionTree([child], 'fork').filter(node => node.kind === 'turn')).toHaveLength(2)
  })

  it('keeps a fork before the first turn on the conversation root', () => {
    const emptyCut = { ...child, inheritedEventCount: 0, events: turn(1, 'Restart') }
    expect(buildSessionTree([root, emptyCut], 'fork').find(node => node.id === 'session:fork')?.parentId).toBe('session:root')
  })
})
