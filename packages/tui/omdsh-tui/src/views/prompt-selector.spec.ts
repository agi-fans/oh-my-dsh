import { describe, expect, it } from 'vitest'
import { maskPromptSecret, renderPlanReviewPage, renderPromptSelector, renderPromptSelectorPage, type PromptSelectorState } from './prompt-selector.ts'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'

function reviewState(overrides: Partial<PromptSelectorState> = {}): PromptSelectorState {
  return {
    request: {
      title: 'Plan review',
      question: 'Approve this plan and leave plan mode?',
      detail: ['# Implementation plan', ...Array.from({ length: 80 }, (_, index) => `- Step ${index + 1}`)].join('\n'),
      options: [
        { label: 'Approve', description: 'Leave plan mode.' },
        { label: 'Keep planning', description: 'Revise the plan.' },
      ],
      presentation: 'plan-review',
      approveValue: 'Approve',
      allowCustom: true,
    },
    selected: 0,
    checked: new Set(),
    ...overrides,
  }
}

describe('plan review page', () => {
  it('keeps a long Markdown plan inside the terminal viewport', () => {
    const frame = renderPlanReviewPage(reviewState(), createTheme(false), 100, 30, '', 0, 'omdsh')
    const text = stripAnsi(frame.lines.join('\n'))

    expect(frame.lines).toHaveLength(30)
    expect(frame.lines.every(line => visibleWidth(line) === 100)).toBe(true)
    expect(text).toContain('omdsh · Plan review')
    expect(text).toContain('Implementation plan')
    expect(text).toContain('later plan lines')
    expect(text).toContain('[ Approve ]')
    expect(frame.document?.maxStart).toBeGreaterThan(0)
    expect(frame.cursorVisible).toBe(false)
  })

  it('scrolls the document independently and reserves an in-frame feedback editor', () => {
    const scrolled = renderPlanReviewPage(
      reviewState({ documentScroll: 10_000 }),
      createTheme(false),
      80,
      24,
      '',
      0,
      'omdsh',
    )
    expect(stripAnsi(scrolled.lines.join('\n'))).toContain('earlier plan lines')
    expect(scrolled.document?.start).toBe(scrolled.document?.maxStart)

    const feedback = renderPlanReviewPage(
      reviewState({ selected: 1, feedback: true }),
      createTheme(false),
      80,
      24,
      'Cover the failure path',
      22,
      'omdsh',
    )
    const text = stripAnsi(feedback.lines.join('\n'))
    expect(feedback.lines).toHaveLength(24)
    expect(text).toContain('Revision feedback · optional')
    expect(text).toContain('Cover the failure path')
    expect(feedback.editor).toEqual({ start: 21, rows: 1 })
    expect(feedback.cursorVisible).toBe(true)
  })
})

describe('secret prompt', () => {
  it('masks the value without changing editor indices or exposing the key', () => {
    const secret = 'sk-secret-value'
    const state: PromptSelectorState = {
      request: {
        title: 'Login to DeepSeek',
        question: 'Paste your DeepSeek API key',
        allowCustom: true,
        secret: true,
      },
      selected: 0,
      checked: new Set(),
    }
    const frame = renderPromptSelector(state, createTheme(false), 72, secret, secret.length)
    const text = stripAnsi(frame.lines.join('\n'))

    expect(maskPromptSecret(secret)).toBe('•'.repeat(secret.length))
    expect(text).not.toContain(secret)
    expect(text).toContain('•'.repeat(secret.length))
    expect(text).toContain('API key · hidden')
    expect(frame.cursorVisible).toBe(true)
  })
})

describe('full-screen selector density', () => {
  it('keeps compact choices and their descriptions on one row', () => {
    const state: PromptSelectorState = {
      request: {
        title: 'Model',
        question: 'Choose a model',
        presentation: 'fullscreen-list',
        optionLayout: 'compact',
        filterable: true,
        allowCustom: false,
        options: [
          { label: 'deepseek-v4-flash', description: 'DeepSeek-V4-Flash' },
          { label: 'deepseek-v4-pro', description: 'DeepSeek-V4-Pro' },
        ],
      },
      selected: 0,
      checked: new Set(),
    }

    const frame = renderPromptSelectorPage(state, createTheme(false), 80, 24, '', 0, 'omdsh')
    const rows = frame.lines.map(stripAnsi)

    expect(frame.lines).toHaveLength(24)
    expect(rows.some(row => row.includes('deepseek-v4-flash — DeepSeek-V4-Flash'))).toBe(true)
    expect(rows.some(row => row.includes('deepseek-v4-pro — DeepSeek-V4-Pro'))).toBe(true)
    expect(frame.itemRows?.filter(index => index !== undefined)).toHaveLength(2)
  })
})
