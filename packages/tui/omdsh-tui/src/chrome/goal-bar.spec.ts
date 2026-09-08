import { describe, expect, it } from 'vitest'
import type { TuiGoalStatus } from '../definition.ts'
import { renderGoalBar } from './goal-bar.ts'
import { createTheme } from './theme.ts'
import { stripAnsi, visibleWidth } from './width.ts'

const theme = createTheme(false)

const active: TuiGoalStatus = {
  phase: 'active',
  objective: 'Ship the upstream adaptation plan',
  roundsStarted: 0,
  maxGoalRounds: 0,
}

describe('renderGoalBar', () => {
  it('renders one unframed row carrying the phase label and objective', () => {
    const lines = renderGoalBar(active, theme, 80)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Goal')
    expect(lines[0]).toContain('Ship the upstream adaptation plan')
  })

  it('labels paused and blocked goals and shows the blocked reason', () => {
    expect(renderGoalBar({ ...active, phase: 'paused' }, theme, 80)[0]).toContain('Goal paused')
    const blocked = renderGoalBar({
      ...active,
      phase: 'blocked',
      blockedReason: 'waiting on the API key',
    }, theme, 80)[0]
    expect(blocked).toContain('Goal blocked')
    expect(blocked).toContain('waiting on the API key')
  })

  it('right-aligns the admitted-round counter at the terminal edge', () => {
    const capped = stripAnsi(renderGoalBar({ ...active, roundsStarted: 3, maxGoalRounds: 12 }, theme, 60)[0] ?? '')
    expect(capped).toHaveLength(60)
    expect(capped.endsWith('round 3/12')).toBe(true)
    const uncapped = stripAnsi(renderGoalBar({ ...active, roundsStarted: 2, maxGoalRounds: 0 }, theme, 60)[0] ?? '')
    expect(uncapped).toHaveLength(60)
    expect(uncapped.endsWith('round 2')).toBe(true)
    expect(renderGoalBar(active, theme, 60)[0]).not.toContain('round')
  })

  it('never exceeds the terminal width for wide or narrow layouts', () => {
    const wide: TuiGoalStatus = {
      phase: 'blocked',
      objective: '修复上游适配计划的剩余缺口并验证回归测试',
      blockedReason: '等待上游发布',
      roundsStarted: 9,
      maxGoalRounds: 12,
    }
    for (const width of [4, 12, 20, 33, 80]) {
      const line = renderGoalBar(wide, theme, width)[0] ?? ''
      expect(visibleWidth(line), `width ${width}`).toBeLessThanOrEqual(width)
    }
    expect(stripAnsi(renderGoalBar(wide, theme, 4)[0] ?? '')).not.toContain('\n')
  })
})
