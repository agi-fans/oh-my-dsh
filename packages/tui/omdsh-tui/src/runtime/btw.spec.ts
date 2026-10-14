import { describe, expect, it } from 'vitest'
import { Session, SessionId, SessionLogOffset, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { btwSeed } from './btw.ts'

describe('side consultation snapshot', () => {
  it('preserves an exact prefix and closes its open tail without changing the source', () => {
    const parent = Session.create(SessionId('parent'))
    parent.append('agent-preset/selected', { agentPreset: 'code' })
    parent.append('turn/start', { turn: 1 })
    parent.append('step/start', { turn: 1, step: 1 })
    parent.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Original question' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const before = parent.snapshotEvents()
    const seed = btwSeed(parent, SessionId('side'), '/workspace')
    expect(seed.slice(0, before.length)).toEqual(before)
    expect(parent.snapshotEvents()).toEqual(before)
    expect(seed.at(-1)).toMatchObject({ type: 'agent-preset/selected', data: { agentPreset: 'btw' } })
    const side = Session.create(SessionId('side'), seed, { id: SessionId('side'), version: SESSION_FORMAT_VERSION, createdAt: 1,
      parentSession: parent.id, isSeeded: true, cwd: '/workspace', agentPreset: 'btw' }, SessionLogOffset(before.length))
    expect(side.inheritedEventCount).toBe(before.length)
    expect(side.ownEvents().some(event => event.type === 'turn/end' && event.data.reason.kind === 'forked')).toBe(true)
    parent.append('step/end', { turn: 1, step: 1 })
    parent.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(side.snapshotEvents()).toEqual(seed)
  })
})
