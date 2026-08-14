import { describe, expect, it } from 'vitest'
import type { TuiSessionStats } from './definition.ts'
import { defaultStatusBarConfig, resolveStatusBarConfig, type StatusBarConfig } from './status-config.ts'
import { formatDuration, formatTokens, renderSessionStatusLabel, sessionStatusGroups } from './status-line.ts'
import { createTheme } from './theme.ts'
import { stripAnsi, visibleWidth } from './width.ts'

const stats: TuiSessionStats = {
  turns: 1,
  steps: 74,
  llmMs: 1_011_000,
  toolMs: 213_000,
  ttftMs: 88_800,
  ttftSteps: 74,
  decodeMs: 922_500,
  decodeTokens: 73_800,
  inputTokens: 5_900_000,
  outputTokens: 73_800,
  cacheReadTokens: 5_841_000,
  cacheWriteTokens: 0,
}

function statusBar(overrides: Partial<StatusBarConfig> = {}): StatusBarConfig {
  return { ...defaultStatusBarConfig(), ...overrides }
}

describe('session status line', () => {
  it('keeps initialization telemetry visible with zero context usage', () => {
    const initial: TuiSessionStats = {
      turns: 0,
      steps: 0,
      llmMs: 0,
      toolMs: 0,
      ttftMs: 0,
      ttftSteps: 0,
      decodeMs: 0,
      decodeTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      contextWindow: 1_000_000,
    }
    expect(sessionStatusGroups(initial)).toEqual([
      'Ctx 0% · 0/1M',
      '0 turns · 0 steps',
    ])
    expect(sessionStatusGroups(initial, statusBar())).toContain('Ctx 0% · 0/1M')
    const compact = renderSessionStatusLabel(initial, statusBar(), createTheme(false), 80)
    expect(compact).toContain('Ctx 0% · 0/1M')
    expect(compact).not.toContain('Context')
    expect(renderSessionStatusLabel(initial, statusBar({ labels: 'full' }), createTheme(false), 80)).toContain('Context 0% · 0/1M')
  })

  it('formats concise English metric groups', () => {
    expect(sessionStatusGroups(stats)).toEqual([
      'Cache 99%',
      '5.9M in · 73.8K out',
      'TTFT 1.2s · 80 tok/s',
      'LLM 16m51s · Tools 3m33s',
      '1 turn · 74 steps',
    ])
  })

  it('uses compact token and duration precision', () => {
    expect([formatTokens(517), formatTokens(12_200), formatTokens(517_000), formatTokens(1_200_000)]).toEqual([
      '517', '12.2K', '517K', '1.2M',
    ])
    expect([formatDuration(45_240), formatDuration(162_000)]).toEqual(['45.2s', '2m42s'])
  })

  it('keeps complete high-priority groups on a narrow terminal', () => {
    const line = renderSessionStatusLabel(stats, statusBar(), createTheme(false), 76)
    expect(line).toContain('Cache 99%')
    expect(line).toContain('5.9M in · 73.8K out')
    expect(line).toContain('TTFT 1.2s · 80 tok/s')
    expect(line).not.toContain('LLM 16m51s')
    expect(line).not.toContain('1 turn · 74 steps')
    expect(stripAnsi(line)).not.toContain('…')
    expect(visibleWidth(line)).toBeLessThanOrEqual(80)
  })

  it('uses a continuous border label and includes every group when space allows', () => {
    const line = renderSessionStatusLabel(stats, statusBar(), createTheme(false), 160)
    expect(line).toContain('Cache 99% • 5.9M in · 73.8K out • TTFT 1.2s · 80 tok/s')
    expect(line).toContain('LLM 16m51s · Tools 3m33s • 1 turn · 74 steps')
    expect(stripAnsi(line)).toMatch(/^ .* $/)
    expect(line).not.toContain('轮')
    expect(line).not.toContain('缓存')
  })

  it('uses English singular labels', () => {
    expect(sessionStatusGroups({ ...stats, turns: 1, steps: 1 })).toContain('1 turn · 1 step')
  })

  it('keeps minimal mode as an explicit telemetry opt-out', () => {
    expect(renderSessionStatusLabel(stats, statusBar({ enabled: false }), createTheme(false), 200)).toBe('')
  })

  it('migrates legacy presets into the customizable layout', () => {
    expect(resolveStatusBarConfig(undefined, 'minimal').enabled).toBe(false)
    expect(resolveStatusBarConfig(undefined, 'full').labels).toBe('full')
  })

  it('honors configured visibility and order', () => {
    const custom = statusBar({ groups: ['tokens', 'cache', 'counts'] })
    expect(sessionStatusGroups(stats, custom)).toEqual([
      '5.9M in · 73.8K out',
      'Cache 99%',
      '1 turn · 74 steps',
    ])
  })

  it('hides telemetry when no complete metric group fits', () => {
    expect(renderSessionStatusLabel(stats, statusBar(), createTheme(false), 10)).toBe('')
  })
})
