import { describe, expect, it } from 'vitest'
import { rankSearchResults, subsequencePenalty } from './fuzzy-search.ts'

describe('selector search', () => {
  const fields = (item: { label: string; description?: string }): string[] => [item.label, item.description ?? '']

  it('ranks exact labels and prefixes before description matches, preserving ties', () => {
    const options = [
      { label: 'Other', description: 'Flash' },
      { label: 'Flash pro' },
      { label: 'Flash' },
      { label: 'Flash lite' },
    ]
    expect(rankSearchResults(options, 'flash', fields).map(item => item.label)).toEqual([
      'Flash', 'Flash pro', 'Flash lite', 'Other',
    ])
    expect(rankSearchResults(options, ' ', fields)).toBe(options)
  })

  it('requires every query token, across searchable fields', () => {
    const options = [
      { label: 'deepseek-v4-flash', description: 'Official provider' },
      { label: 'deepseek-v4-pro', description: 'Official provider' },
      { label: 'deepseek-v4-flash', description: 'Custom provider' },
    ]
    expect(rankSearchResults(options, 'official flash', fields)).toEqual([options[0]])
  })

  it('matches short abbreviations within words, including camel case', () => {
    const options = [{ label: 'toolExecution' }, { label: 'Terminal' }]
    expect(rankSearchResults(options, 'tool exct', fields)).toEqual([options[0]])
    expect(rankSearchResults([{ label: 'Help' }], 'hlp', fields)).toHaveLength(1)
  })

  it('does not collect a fuzzy token across unrelated description words', () => {
    const options = [{ label: 'Retry', description: 'Input mode adds graceful execution' }]
    expect(rankSearchResults(options, 'image', fields)).toEqual([])
  })

  it('keeps punctuation queries literal and searches Unicode without locale-dependent casing', () => {
    const options = [{ label: '模型 🐳', description: 'DeepSeek Official' }, { label: '模型', description: 'Custom' }]
    expect(rankSearchResults(options, '模型 🐳', fields)).toEqual([options[0]])
    expect(rankSearchResults(options, '/', fields)).toEqual([])
    expect(rankSearchResults([{ label: 'ＣＯＤＥ' }], 'code', fields)).toHaveLength(1)
    expect(rankSearchResults([{ label: 'café' }], 'cafe\u0301', fields)).toHaveLength(1)
  })

  it('refreshes cached fields when a reused option changes', () => {
    const option = { label: 'Before' }
    expect(rankSearchResults([option], 'before', fields)).toHaveLength(1)
    option.label = 'After'
    expect(rankSearchResults([option], 'before', fields)).toHaveLength(0)
    expect(rankSearchResults([option], 'after', fields)).toHaveLength(1)
  })
})

describe('short name matching', () => {
  it('prefers compact word-boundary matches and treats astral characters as one character', () => {
    expect(subsequencePenalty('cr', 'code-review')!).toBeLessThan(subsequencePenalty('cr', 'container')!)
    expect(subsequencePenalty('🐳x', '🐳 x')).toBeDefined()
    expect(subsequencePenalty('🐋', '🐳')).toBeUndefined()
  })
})
