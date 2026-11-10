import { expect, it } from 'vitest'
import { renderView, initialTranscript } from './event-views.ts'
import { stripAnsi } from '../chrome/width.ts'

it.each([false, true])('scopes footer information to the viewed child and restores parent metadata (colors=%s)', colors => {
  const options = { width: 120, height: 24, colors, input: '', inputCursor: 0,
    model: 'PARENT_MODEL', reasoningEffort: 'max', sessionControls: { permission: 'danger-full-access' },
    sessionStats: { turns: 99, steps: 99, inputTokens: 999999, outputTokens: 999999, llmMs: 0, toolMs: 0,
      ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }
  const state = initialTranscript()
  const read = (extra = {}) => renderView(state, { ...options, ...extra }).lines.map(stripAnsi).join('\n')
  const child = read({ inspected: { id: 'child', label: 'Child', phase: 'running', writable: true,
    model: 'CHILD_MODEL', reasoningEffort: 'low', controls: { permission: 'read-only' } } })
  expect(child).toContain('CHILD_MODEL')
  expect(child).not.toContain('PARENT_MODEL')
  expect(child).not.toContain('999')
  expect(child).not.toContain('full access')
  expect(child).toContain('read only')
  const cold = read({ inspected: { id: 'cold', label: 'Cold child', phase: 'completed', writable: false } })
  expect(cold).not.toContain('PARENT_MODEL')
  expect(cold).not.toContain('full access')
  expect(read()).toContain('PARENT_MODEL')
})
