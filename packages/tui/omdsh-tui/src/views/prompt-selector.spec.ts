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
  it.each([false, true])('keeps every document action visible with an explicit selection at narrow widths (color=%s)', color => {
    for (const width of [30, 40, 60, 100]) {
      const labels = ['Files', 'Previous', 'Next', 'Open', 'Editor']
      const frame = renderPlanReviewPage({ request: { title: 'File', question: 'a.txt', presentation: 'document', detail: 'Content',
        options: labels.map(label => ({ label })) }, selected: 4, checked: new Set() }, createTheme(color), width, 24, '', 0, 'omdsh')
      const text = stripAnsi(frame.lines.join('\n'))
      for (const label of labels) expect(text).toContain(`[ ${label} ]`)
      expect(text).toContain('› [ Editor ]')
      expect(frame.lines).toHaveLength(24)
      expect(frame.lines.every(line => visibleWidth(line) === width)).toBe(true)
    }
  })

  it('keeps the selected action inside a very short viewport', () => {
    const frame = renderPlanReviewPage({ request: { title: 'File', question: 'a.txt', presentation: 'document', detail: 'Content',
      options: ['Files', 'Preview', 'Previous', 'Next', 'Open', 'Editor'].map(label => ({ label })) },
      selected: 5, checked: new Set() }, createTheme(false), 30, 10, '', 0, 'omdsh')
    expect(frame.lines).toHaveLength(10)
    expect(frame.lines.every(line => visibleWidth(line) === 30)).toBe(true)
    expect(frame.lines.join('\n')).toContain('› [ Editor ]')
  })

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

  it('scrolls the document independently and reserves an in-frame feedback field', () => {
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
  })
})

describe('timed question cards', () => {
  it.each([false, true])('keeps the countdown and multilingual answer padding within display cells (colors=%s)', (colors) => {
    const state: PromptSelectorState = {
      request: { title: 'Question', question: '选择项目范围 🐳',
        options: [{ label: '项目范围 e\u0301' }], skippable: true, dismissLabel: 'Later',
        wait: { deadline: Date.now() + 120_000, hold: () => {} },
      }, selected: 0, checked: new Set(),
    }
    for (const width of [30, 60, 90]) {
      const frame = renderPromptSelector(state, createTheme(colors), width, '自定义答案 🐳', 6)
      expect(frame.lines.every(line => visibleWidth(line) <= width), `width=${width}`).toBe(true)
    }
    const frame = renderPromptSelector(state, createTheme(colors), 90, '', 0)
    const text = stripAnsi(frame.lines.join('\n'))
    expect(text).toContain('Continues in')
    expect(text).toContain('ctrl+t take time')
    expect(text).toContain('esc later')
    expect(text).toContain('ctrl+s skip')
    const held = renderPromptSelector({ ...state, waitHeld: true }, createTheme(colors), 90, '', 0)
    expect(stripAnsi(held.lines.join('\n'))).toContain('Take your time')
  })
})


it('renders scrolling documents in bounded cells and keeps action selection visible', () => {
  for (const color of [false, true]) for (const width of [24, 40, 80]) {
    const state = reviewState()
    state.request = { ...state.request, presentation: 'document', question: '文件 🐳', detail: Array.from({ length: 30 }, (_, index) => `文档 e\u0301 🐳 ${index}`).join('\n'),
      options: [{ label: 'Open', value: 'open' }, { label: 'Files', value: 'files' }], actions: [{ key: 'o', label: 'open', valuePrefix: 'open' }] }
    state.documentScroll = Number.POSITIVE_INFINITY
    const frame = renderPlanReviewPage(state, createTheme(color), width, 20, '', 0, 'omdsh')
    expect(frame.lines).toHaveLength(20)
    expect(frame.lines.every(line => visibleWidth(line) <= width)).toBe(true)
    expect(stripAnsi(frame.lines.join('\n'))).toContain('29')
    expect(frame.document!.start).toBe(frame.document!.maxStart)
  }
})
