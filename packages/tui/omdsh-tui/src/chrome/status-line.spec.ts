import { describe, expect, it } from 'vitest'
import type { TuiSessionStats } from '../definition.ts'
import { defaultStatusBarConfig, resolveStatusBarConfig, type StatusBarConfig } from './status-config.ts'
import {
  formatDuration,
  formatTokens,
  renderSessionStatusLabel,
  renderStatusFooter,
  renderStatusPreviewLines,
  sessionStatusGroups,
} from './status-line.ts'
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
    expect(resolveStatusBarConfig({ enabled: true, labels: 'compact', groups: ['cache'], colors: { model: 'accent' } }).colors).toMatchObject({
      model: 'accent',
      path: 'default',
      git: 'default',
      metrics: 'default',
      cache: 'default',
    })
    expect(resolveStatusBarConfig({
      enabled: true,
      labels: 'compact',
      groups: ['cache'],
      colors: { metrics: 'warning', tokens: 'accent' },
    }).colors).toMatchObject({
      cache: 'warning',
      tokens: 'accent',
      metrics: 'warning',
    })
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

  it('renders model/workspace and telemetry as two split footer rows', () => {
    const lines = renderStatusFooter({
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
      pwd: '~/Workspace/dsh-tui',
      branch: 'main *6 ?4',
      stats,
      config: statusBar(),
      width: 140,
    }, createTheme(false))

    expect(lines).toHaveLength(2)
    expect(lines.every(line => visibleWidth(line) === 140)).toBe(true)
    expect(stripAnsi(lines[0] ?? '')).toMatch(/^  deepseek-v4-pro · max\s+~\/Workspace\/dsh-tui · main \*6 \?4  $/)
    expect(stripAnsi(lines[1] ?? '')).toMatch(/^  Cache 99% • 5\.9M in · 73\.8K out • TTFT 1\.2s · 80 tok\/s\s+LLM 16m51s · Tools 3m33s • 1 turn · 74 steps  $/)
  })

  it('keeps collaboration and access controls visible in metadata', () => {
    const active = renderStatusFooter({
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
      controls: {
        agentPreset: 'code',
        tools: 'both',
        plan: { active: true, pending: false },
        permission: 'workspace-write',
      },
      pwd: '~/Workspace/dsh-tui',
      branch: 'main',
      stats,
      config: statusBar(),
      width: 140,
    }, createTheme(false))
    expect(active[0]).toContain('deepseek-v4-pro · max · ptc · plan · both')
    expect(active[0]).toContain('~/Workspace/dsh-tui · main')
    expect(active[0]).not.toContain('Workspace write')

    const leaving = renderStatusFooter({
      model: 'm',
      controls: {
        plan: { active: true, pending: true },
        permission: 'danger-full-access',
      },
      config: statusBar(),
      width: 48,
    }, createTheme(false))
    expect(leaving[0]).toContain('standard · plan off…')
    expect(leaving[0]).not.toContain('default')
    expect(leaving[0]).not.toContain('native')
    expect(leaving[0]).not.toContain('full access')

    const idle = renderStatusFooter({
      model: 'm',
      controls: {
        agentPreset: 'minimal',
        tools: 'native',
        plan: { active: false, pending: false },
      },
      config: statusBar(),
      width: 48,
    }, createTheme(false))
    expect(idle[0]).toContain('m · minimal')
    expect(idle[0]).not.toContain('default')
    expect(idle[0]).not.toContain('native')

    const codeTools = renderStatusFooter({
      model: 'm',
      controls: {
        agentPreset: 'code',
        tools: 'code',
        plan: { active: false, pending: false },
      },
      config: statusBar(),
      width: 48,
    }, createTheme(false))
    expect(codeTools[0]).toContain('m · ptc · code')
  })

  it('shows process-local loop state beside the model controls', () => {
    const waiting = renderStatusFooter({
      model: 'deepseek-v4-pro',
      loop: { phase: 'waiting', repeats: 0, total: 3 },
      config: statusBar(),
      width: 100,
    }, createTheme(false))
    expect(waiting[0]).toContain('LOOP WAITING · SEND PROMPT · 0/3 REPEATS')

    const running = renderStatusFooter({
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
      loop: { phase: 'running', repeats: 1, total: 3 },
      config: statusBar(),
      width: 80,
    }, createTheme(false))
    expect(running[0]).toContain('deepseek-v4-pro · max · LOOP · 1/3 REPEATS')

    const paused = renderStatusFooter({
      model: 'deepseek-v4-pro',
      loop: { phase: 'paused' },
      config: statusBar(),
      width: 80,
    }, createTheme(false))
    expect(paused[0]).toContain('LOOP PAUSED · SEND TO RESUME')

    const duration = renderStatusFooter({
      model: 'deepseek-v4-pro',
      loop: { phase: 'running', repeats: 2, deadline: Date.now() + 2_000, limit: '10m' },
      config: statusBar(),
      width: 80,
    }, createTheme(false))
    expect(duration[0]).toMatch(/LOOP · 2(?:\.\d)?s LEFT/u)

    const completed = renderStatusFooter({
      model: 'deepseek-v4-pro',
      loop: { phase: 'completed', repeats: 3, total: 3 },
      config: statusBar(),
      width: 80,
    }, createTheme(false))
    expect(completed[0]).toContain('LOOP DONE · 3 REPEATS')
  })

  it('keeps complete high-priority footer groups and only disables customizable telemetry', () => {
    const narrow = renderStatusFooter({
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
      pwd: '~/Workspace/a-very-long-project-name',
      branch: 'main *6 ?4',
      stats,
      config: statusBar(),
      width: 76,
    }, createTheme(false))
    const telemetry = stripAnsi(narrow[1] ?? '')
    expect(narrow).toHaveLength(2)
    expect(narrow.every(line => visibleWidth(line) === 76)).toBe(true)
    expect(telemetry).toContain('Cache 99%')
    expect(telemetry).toContain('5.9M in · 73.8K out')
    expect(telemetry).not.toContain('LLM 16m51s')
    const minimal = renderStatusFooter({
      model: 'm',
      controls: {
        plan: { active: true, pending: false },
        permission: 'read-only',
      },
      stats,
      config: statusBar({ enabled: false }),
      width: 76,
    }, createTheme(false))
    expect(minimal).toHaveLength(2)
    expect(minimal[0]).toContain('m · standard · plan')
    expect(minimal[0]).not.toContain('native')
    expect(minimal[0]).not.toContain('Read only')
    expect(stripAnsi(minimal[1] ?? '').trim()).toBe('')
  })

  it('paints configured status slot colors and keeps semantic exceptions', () => {
    const theme = createTheme(true, true)
    const colored = statusBar({
      colors: { model: 'accent', path: 'border', git: 'success', metrics: 'warning' },
    })
    const lines = renderStatusFooter({
      model: 'deepseek-v4-pro',
      pwd: '~/ws',
      branch: 'main *1',
      stats,
      config: colored,
      width: 140,
    }, theme)
    expect(lines[0]).toContain(theme.getFgAnsi('accent'))
    expect(lines[0]).toContain(theme.getFgAnsi('border'))
    expect(lines[0]).toContain(theme.getFgAnsi('success'))
    expect(lines[0]).not.toContain(theme.getFgAnsi('warning'))
    expect(lines[1]).toContain(theme.getFgAnsi('warning'))
    expect(lines[1]).toContain(theme.getFgAnsi('success'))

    const dirtyDefault = renderStatusFooter({
      model: 'm',
      pwd: '~/ws',
      branch: 'main *1',
      config: statusBar(),
      width: 80,
    }, theme)
    expect(dirtyDefault[0]).toContain(theme.getFgAnsi('warning'))
  })

  it('packs a complete settings preview instead of clipping the right column', () => {
    const lines = renderStatusPreviewLines({
      model: 'deepseek',
      reasoningEffort: 'max',
      pwd: '~/project',
      branch: 'main *1',
      stats,
      config: statusBar(),
      width: 120,
    }, createTheme(false))
    expect(stripAnsi(lines[0] ?? '')).toMatch(/^deepseek · max\s+~\/project · main \*1$/)
    expect(stripAnsi(lines[1] ?? '')).toContain('Cache 99%')
    expect(stripAnsi(lines[1] ?? '')).toContain('Tools 3m33s')
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(120)
  })

  it('keeps the first preview line split instead of packing path and git left', () => {
    const lines = renderStatusPreviewLines({
      model: 'deepseek',
      reasoningEffort: 'max',
      pwd: '~/project',
      branch: 'main *1',
      stats,
      config: statusBar(),
      width: 80,
    }, createTheme(false))
    expect(stripAnsi(lines[0] ?? '')).toMatch(/^deepseek · max\s+~\/project · main \*1$/)
    expect(lines.join('\n')).not.toContain('…')
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(80)
  })
})
