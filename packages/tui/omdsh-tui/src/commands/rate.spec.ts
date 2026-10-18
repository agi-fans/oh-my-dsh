import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { MessageFeedbackItem } from '@deepseek-ai/dsh-message-feedback'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type { TuiService } from '../definition.ts'
import * as rate from './rate.ts'

function appendReply(session: Session, text: string, turn = 1, step = 1): string {
  const id = MessageId(`msg-${turn}-${step}-${Math.random().toString(16).slice(2)}`)
  session.append('assistant/message', {
    turn,
    step,
    message: {
      id,
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    },
    stream: [],
  }, { surfaceOp: 'append' })
  return String(id)
}

/** In-memory stand-in for the Harness service; the command owns the UX, not storage. */
function fakeFeedback(session: Session) {
  const items = new Map<string, MessageFeedbackItem>()
  return {
    items,
    list: vi.fn(async () => ({ ok: true as const, value: { items: [...items.values()] } })),
    put: vi.fn(async (request: {
      messageId: string
      rating: 'positive' | 'negative'
      note?: string
      category?: MessageFeedbackItem['category']
      ifVersion: string | null
    }) => {
      const existing = items.get(request.messageId)
      if (request.ifVersion !== (existing?.version ?? null)) {
        return { ok: false as const, error: { code: 'version-conflict' as const, current: existing ?? null } }
      }
      const now = Date.now()
      const item: MessageFeedbackItem = {
        messageId: request.messageId as MessageFeedbackItem['messageId'],
        rating: request.rating,
        ...(request.note === undefined ? {} : { note: request.note }),
        ...(request.category === undefined ? {} : { category: request.category }),
        version: `v${items.size + 1}` as MessageFeedbackItem['version'],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      items.set(request.messageId, item)
      session.append('feedback/message-put', { sessionId: session.id, item })
      return { ok: true as const, value: item }
    }),
    delete: vi.fn(async (request: { messageId: string; ifVersion: string }) => {
      const existing = items.get(request.messageId)
      if (existing !== undefined && request.ifVersion !== existing.version) {
        return { ok: false as const, error: { code: 'version-conflict' as const, current: existing } }
      }
      items.delete(request.messageId)
      session.append('feedback/message-delete', { sessionId: session.id, messageId: request.messageId as MessageFeedbackItem['messageId'] })
      return { ok: true as const, value: { absent: true as const } }
    }),
  }
}

async function fixture(prompts: (string | null)[]) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const prompt = vi.fn(async () => prompts.shift() ?? null)
  ctx.provide('tui', { prompt } as unknown as TuiService)
  const session = ctx.sessions.create(SessionId(`rate-${Math.random().toString(16).slice(2)}`))
  const feedback = fakeFeedback(session)
  ctx.provide('messageFeedback', feedback as never)
  await ctx.plugin(rate)
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  return { ctx, session, agent, prompt, feedback }
}

describe('/rate command', () => {
  it('records positive feedback for a finalized reply', async () => {
    const f = await fixture([])
    try {
      const messageId = appendReply(f.session, 'The build now passes.')
      f.prompt.mockResolvedValueOnce(messageId).mockResolvedValueOnce('positive').mockResolvedValueOnce('')
      const execution = await f.ctx.commands.execute(f.agent, '/rate', [], new AbortController().signal)
      expect(execution?.result).toMatchObject({
        kind: 'success',
        text: 'Feedback recorded for Turn 1 · Step 1: positive.',
      })
      expect(f.feedback.put).toHaveBeenCalledWith(expect.objectContaining({
        messageId,
        rating: 'positive',
        ifVersion: null,
      }))
      const put = f.session.snapshotEvents().find(event => event.type === 'feedback/message-put')
      expect(put?.type).toBe('feedback/message-put')
      if (put?.type !== 'feedback/message-put') throw new Error('missing feedback event')
      expect(put.data.item.rating).toBe('positive')
      expect(put.data.item.note).toBeUndefined()
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it('records a negative judgment with a category and preserves the note verbatim', async () => {
    const f = await fixture([])
    try {
      const messageId = appendReply(f.session, 'It edited the wrong file.')
      f.prompt.mockResolvedValueOnce(messageId).mockResolvedValueOnce('negative')
        .mockResolvedValueOnce('instruction-following').mockResolvedValueOnce('  ignored the plan  ')
      const execution = await f.ctx.commands.execute(f.agent, '/rate', [], new AbortController().signal)
      expect(execution?.result).toMatchObject({
        kind: 'success',
        text: 'Feedback recorded for Turn 1 · Step 1: negative · instruction-following.',
      })
      expect(f.feedback.put).toHaveBeenCalledWith(expect.objectContaining({
        rating: 'negative',
        category: 'instruction-following',
        note: '  ignored the plan  ',
      }))
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it('clears stored feedback with its observed version', async () => {
    const f = await fixture([])
    try {
      const messageId = appendReply(f.session, 'A reply worth rating.')
      f.prompt.mockResolvedValueOnce(messageId).mockResolvedValueOnce('negative')
        .mockResolvedValueOnce('').mockResolvedValueOnce('')
      await f.ctx.commands.execute(f.agent, '/rate', [], new AbortController().signal)
      f.prompt.mockResolvedValueOnce(messageId).mockResolvedValueOnce('clear')
      const cleared = await f.ctx.commands.execute(f.agent, '/rate', [], new AbortController().signal)
      expect(cleared?.result).toMatchObject({ kind: 'success', text: 'Feedback cleared for Turn 1 · Step 1.' })
      expect(f.feedback.delete).toHaveBeenCalledWith(expect.objectContaining({ messageId, ifVersion: 'v1' }))
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it('reports an empty session without opening a picker', async () => {
    const f = await fixture([])
    try {
      const execution = await f.ctx.commands.execute(f.agent, '/rate', [], new AbortController().signal)
      expect(execution?.result).toMatchObject({ kind: 'success', text: 'No finalized assistant replies in this session yet.' })
      expect(f.prompt).not.toHaveBeenCalled()
    } finally {
      await f.ctx.fiber.dispose()
    }
  })

  it('keeps only append-origin assistant replies with text', async () => {
    const f = await fixture([])
    try {
      appendReply(f.session, '')
      appendReply(f.session, 'Visible reply', 2, 1)
      const targets = rate.rateTargets(f.session)
      expect(targets.map(target => target.preview)).toEqual(['Visible reply'])
      expect(targets[0]?.turn).toBe(2)
    } finally {
      await f.ctx.fiber.dispose()
    }
  })
})
