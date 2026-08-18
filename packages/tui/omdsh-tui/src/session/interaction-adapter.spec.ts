import { describe, expect, it } from 'vitest'
import { parsePromptAnswer } from './interaction-adapter.ts'

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
