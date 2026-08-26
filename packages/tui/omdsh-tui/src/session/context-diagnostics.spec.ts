import { describe, expect, it } from 'vitest'
import { contextDiagnosticsMarkdown } from './context-diagnostics.ts'

describe('contextDiagnosticsMarkdown', () => {
  it('keeps missing projection categories explicit', () => {
    const text = contextDiagnosticsMarkdown({})
    expect(text).toMatch(/^Context Details\n\n## Occupancy/)
    expect(text).toContain('| Context window | unavailable |')
    expect(text).toContain('| System prompt | unavailable |')
    expect(text).toContain('| Attachments | unavailable |')
  })

  it('separates provider-anchored pressure, cumulative usage, and heuristic composition', () => {
    const text = contextDiagnosticsMarkdown({
      pressure: { contextWindow: 100_000, projectedTokens: 25_000, pressureTokens: 20_000 },
      usage: { uncachedInputTokens: 10_000, cacheReadTokens: 8_000, cacheWriteTokens: 2_000, outputTokens: 3_000 },
      breakdown: { systemTokens: 1_000, toolsTokens: 2_000, messageTokens: 9_000 },
    })
    expect(text).toContain('| Remaining budget | 75K |')
    expect(text).toContain('| Pressure | 25.0% |')
    expect(text).toContain('| Cache read | 8K |')
    expect(text).toContain('| Tool schemas | 2K |')
  })
})
