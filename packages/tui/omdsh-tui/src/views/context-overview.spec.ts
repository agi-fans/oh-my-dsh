import { describe, expect, it } from 'vitest'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import type { ContextOverview } from '../session/context-diagnostics.ts'
import { renderContextOverview } from './context-overview.ts'

const snapshot: ContextOverview = {
  sessionId: 'session-test', model: 'deepseek/model', agent: 'Standard', workflow: 'Default',
  turns: 12, steps: 38, inputTokens: 280_000, outputTokens: 18_000, followUp: 0, steering: 0,
  pressure: { contextWindow: 128_000, projectedTokens: 64_000, pressureTokens: 63_000 },
  breakdown: { systemTokens: 2_800, toolsTokens: 8_200, messageTokens: 50_100 },
}

describe('context overview', () => {
  it.each([20, 40, 58, 80])('fits %s cells in both themes and languages', width => {
    for (const themeName of ['light', 'dark'] as const) for (const language of ['en', 'zh-CN'] as const) for (const colors of [false, true]) {
      const lines = renderContextOverview({ ...snapshot, agent: '代理🐳 e\u0301'.repeat(5) }, createTheme(colors, 'truecolor', themeName, undefined, language), width)
      expect(lines.every(line => visibleWidth(line) <= width)).toBe(true)
      expect(stripAnsi(lines.join('\n'))).toContain('50.0%')
    }
  })

  it('uses projected occupancy for the grid independently of the heuristic categories', () => {
    const text = stripAnsi(renderContextOverview(snapshot, createTheme(false), 80).join('\n'))
    expect(text.match(/■/gu)).toHaveLength(20)
    expect(text).toContain('64K / 128K')
    expect(text).toContain('≈ 50.1K')
    expect(text).toContain('Input 280K · Output 18K')
  })

  it('reports missing measurements and over-capacity values honestly', () => {
    const theme = createTheme(false)
    expect(renderContextOverview({ ...snapshot, pressure: undefined }, theme, 80).join('\n')).toContain('not available yet')
    const text = renderContextOverview({ ...snapshot, pressure: { contextWindow: 100, projectedTokens: 120 } }, theme, 80).join('\n')
    expect(text).toContain('120.0%')
    expect(text).toContain('0 tokens remaining')
    expect(text.match(/■/gu)).toHaveLength(40)
  })
})
