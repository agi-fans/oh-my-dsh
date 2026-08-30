import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { TuiService } from '../definition.ts'
import { bindHumanInteraction, parsePromptAnswer } from './interaction-adapter.ts'

describe('parsePromptAnswer', () => {
  const options = [{ label: 'Alpha' }, { label: 'Beta' }]

  it('accepts a 1-based number or a case-insensitive label', () => {
    expect(parsePromptAnswer('2', { options })).toEqual({ selected: ['Beta'] })
    expect(parsePromptAnswer('alpha', { options })).toEqual({ selected: ['Alpha'] })
  })

  it('supports multi-select and keeps custom text', () => {
    expect(parsePromptAnswer('1, Beta, something else', { options, multiSelect: true })).toEqual({
      selected: ['Alpha', 'Beta'],
      custom: 'something else',
    })
  })
})

describe('bindHumanInteraction', () => {
  it('answers through the 0.1.2 user-question waterfall', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const prompt = vi.fn(async () => '1')
    const dispose = bindHumanInteraction(ctx, { prompt } as unknown as TuiService, () => undefined)

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'choice', question: 'Choose', options: [{ label: 'Alpha' }] }],
    })).resolves.toEqual({ answers: [{ id: 'choice', selected: ['Alpha'] }] })
    expect(prompt).toHaveBeenCalledOnce()

    dispose()
    await ctx.fiber.dispose()
  })
})
