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
import { oracleWidth } from './width.oracle.ts'

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

/** Painted footer rows for the standard metadata and telemetry sample. */
function footerRows(width: number): string[] {
  return renderStatusFooter({
    model: 'deepseek-v4-pro',
    reasoningEffort: 'max',
    pwd: '~/Workspace/dsh-tui',
    branch: 'main *3',
    stats,
    config: statusBar(),
    width,
  }, createTheme(false))
}

/** Cell widths of the ellipsis-terminated fragments a row shows. */
function clippedCells(line: string): number[] {
  return [...stripAnsi(line).matchAll(/\S*…/gu)].map(match => oracleWidth(match[0]))
}

/**
 * Telemetry groups `stats` can show, in configured order. The sample has no
 * context window, so the context group never appears.
 */
const TELEMETRY_GROUPS = [
  'Cache 99%',
  '5.9M in · 73.8K out',
  'TTFT 1.2s · 80 tok/s',
  'LLM 16m51s · Tools 3m33s',
  '1 turn · 74 steps',
] as const

/**
 * Degradation expected at each width, stated from the configured order and the
 * measured group sizes rather than read back from the selection code.
 */
const FOOTER_WIDTH_CASES: ReadonlyArray<{
  width: number
  first: readonly string[]
  dropped: readonly string[]
  groups: readonly number[]
  clipped: boolean
}> = [
  { width: 30, first: ['deepseek', '~/Workspace'], dropped: ['max', 'main *3'], groups: [0], clipped: true },
  { width: 40, first: ['deepseek', '~/Workspace/dsh-tui'], dropped: ['max', 'main *3'], groups: [0, 1], clipped: true },
  { width: 50, first: ['deepseek-v4-pro', '~/Workspace/dsh-tui'], dropped: ['max', 'main *3'], groups: [0, 1], clipped: false },
  { width: 60, first: ['deepseek-v4-pro · max', '~/Workspace/dsh-tui · main *3'], dropped: [], groups: [0, 1, 2], clipped: false },
  { width: 70, first: ['deepseek-v4-pro · max', '~/Workspace/dsh-tui · main *3'], dropped: [], groups: [0, 1, 2], clipped: false },
  // durations fills 24 cells and does not fit the 76 inner columns, while the
  // narrower counts group fills 17, so counts takes the free right column.
  { width: 80, first: ['deepseek-v4-pro · max', '~/Workspace/dsh-tui · main *3'], dropped: [], groups: [0, 1, 2, 4], clipped: false },
  // At 100 the wider durations group fits first and counts no longer does: the
  // visible set is allowed to change with width.
  { width: 100, first: ['deepseek-v4-pro · max', '~/Workspace/dsh-tui · main *3'], dropped: [], groups: [0, 1, 2, 3], clipped: false },
  { width: 120, first: ['deepseek-v4-pro · max', '~/Workspace/dsh-tui · main *3'], dropped: [], groups: [0, 1, 2, 3, 4], clipped: false },
  { width: 200, first: ['deepseek-v4-pro · max', '~/Workspace/dsh-tui · main *3'], dropped: [], groups: [0, 1, 2, 3, 4], clipped: false },
]

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

  it('renders context pressure as percentage and used/window tokens', () => {
    const withContext: TuiSessionStats = {
      ...stats,
      contextTokens: 12_200,
      contextWindow: 100_000,
    }
    expect(sessionStatusGroups(withContext, statusBar())).toContain(
      'Ctx 12% · 12.2K/100K',
    )
  })

  it('raises context pressure text from warning to error colors', () => {
    const colorTheme = createTheme(true, true)
    const base: TuiSessionStats = {
      ...stats,
      contextWindow: 100,
      contextTokens: 80,
    }
    const warning = renderStatusFooter({
      model: 'm',
      stats: base,
      config: statusBar({ groups: ['context'] }),
      width: 80,
    }, colorTheme)
    const error = renderStatusFooter({
      model: 'm',
      stats: { ...base, contextTokens: 95 },
      config: statusBar({ groups: ['context'] }),
      width: 80,
    }, colorTheme)
    expect(warning[1]).toContain(colorTheme.getFgAnsi('warning'))
    expect(error[1]).toContain(colorTheme.getFgAnsi('error'))
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

  it('carries a rounded token count into the next unit', () => {
    expect([
      formatTokens(999),
      formatTokens(999_499),
      formatTokens(999_500),
      formatTokens(999_999),
      formatTokens(1_000_000),
      formatTokens(1_250_000),
    ]).toEqual(['999', '999K', '1M', '1M', '1M', '1.3M'])
  })

  it('carries duration seconds into minutes and hours', () => {
    expect([
      formatDuration(1_000),
      formatDuration(59_900),
      formatDuration(60_000),
      formatDuration(62_000),
      formatDuration(3_600_000),
      formatDuration(3_660_000),
    ]).toEqual(['1s', '59.9s', '1m', '1m2s', '1h', '1h1m'])
    // Rounding up to a boundary must not print an empty unit either.
    expect([formatDuration(59_990), formatDuration(3_599_999)]).toEqual(['1m', '1h'])
  })

  it('keeps complete high-priority groups on a narrow terminal', () => {
    const line = renderSessionStatusLabel(stats, statusBar(), createTheme(false), 76)
    expect(line).toContain('Cache 99%')
    expect(line).toContain('5.9M in · 73.8K out')
    expect(line).toContain('TTFT 1.2s · 80 tok/s')
    expect(line).not.toContain('LLM 16m51s')
    // The wide durations group does not fit, so the scan skips it and the
    // narrower counts group fills the columns it left free.
    expect(line).toContain('1 turn · 74 steps')
    expect(stripAnsi(line)).not.toContain('…')
    expect(visibleWidth(line)).toBeLessThanOrEqual(80)
  })

  it('skips a telemetry group that does not fit so a narrower one can use the columns', () => {
    for (const testCase of FOOTER_WIDTH_CASES) {
      const label = `${testCase.width} columns`
      const lines = footerRows(testCase.width)
      expect(lines, label).toHaveLength(2)
      const first = stripAnsi(lines[0] ?? '')
      const telemetry = stripAnsi(lines[1] ?? '')
      for (const line of lines) expect(oracleWidth(line), label).toBeLessThanOrEqual(testCase.width)
      for (const text of testCase.first) expect(first, label).toContain(text)
      for (const text of testCase.dropped) expect(first, label).not.toContain(text)
      TELEMETRY_GROUPS.forEach((group, index) => {
        if (testCase.groups.includes(index)) expect(telemetry, label).toContain(group)
        else expect(telemetry, label).not.toContain(group)
      })
      // Configured order and column sides survive the skip: the row reads as
      // the left column then the right column, each in configured order.
      const column = (indices: readonly number[]): string =>
        indices.map(index => TELEMETRY_GROUPS[index] ?? '').join(' • ')
      const expected = [
        column(testCase.groups.filter(index => index < 3)),
        column(testCase.groups.filter(index => index >= 3)),
      ].filter(text => text !== '').join(' ')
      expect(telemetry.trim().replace(/\s+/gu, ' '), label).toBe(expected)
      // A separator never precedes an ellipsis, and a clip only survives with a
      // readable prefix: a metadata item is shown whole, clipped, or not at all.
      expect(first, label).not.toMatch(/·\s*…/u)
      if (testCase.clipped) expect(clippedCells(first), label).not.toHaveLength(0)
      else expect(first, label).not.toContain('…')
      for (const cells of clippedCells(first)) expect(cells, label).toBeGreaterThanOrEqual(8)
    }
  })

  it('drops a clipped metadata item instead of keeping a fragment', () => {
    // 50 columns is the reported case: `deepseek-v4-pro · …` and `main *3`
    // clipped to `m…` named nothing, so both items go away whole.
    const narrow = footerRows(50).map(stripAnsi)
    expect(narrow[0]).toContain('deepseek-v4-pro')
    expect(narrow[0]).toContain('~/Workspace/dsh-tui')
    expect(narrow[0]).not.toContain('…')
    expect(narrow[1]).not.toContain('…')

    // A clip survives only when the free cells still hold a readable prefix:
    // 8 cells are seven characters plus the ellipsis.
    for (const width of [30, 40]) {
      const fragments = clippedCells(footerRows(width)[0] ?? '')
      expect(fragments, `${width} columns`).not.toHaveLength(0)
      for (const cells of fragments) expect(cells, `${width} columns`).toBeGreaterThanOrEqual(8)
    }
    expect(clippedCells(footerRows(200)[0] ?? '')).toHaveLength(0)
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
        plan: { active: true, pending: false },
        permission: 'workspace-write',
      },
      pwd: '~/Workspace/dsh-tui',
      branch: 'main',
      stats,
      config: statusBar(),
      width: 140,
    }, createTheme(false))
    expect(active[0]).toContain('deepseek-v4-pro · max · ptc · plan')
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
        plan: { active: false, pending: false },
      },
      config: statusBar(),
      width: 48,
    }, createTheme(false))
    expect(idle[0]).toContain('m · minimal')
    expect(idle[0]).not.toContain('default')
    expect(idle[0]).not.toContain('native')
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

  it('shows the session title only when the session meta item is enabled', () => {
    const hidden = renderStatusFooter({
      model: 'deepseek', sessionTitle: 'Fix the parser', config: statusBar(), width: 80,
    }, createTheme(false))
    expect(stripAnsi(hidden[0] ?? '')).not.toContain('Fix the parser')

    const shown = renderStatusFooter({
      model: 'deepseek',
      sessionTitle: 'Fix the parser',
      config: statusBar({ meta: [...defaultStatusBarConfig().meta, 'session'] }),
      width: 80,
    }, createTheme(false))
    expect(stripAnsi(shown[0] ?? '')).toContain('Fix the parser')
  })
})
