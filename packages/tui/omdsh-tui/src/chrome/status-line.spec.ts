import { describe, expect, it } from 'vitest'
import type { TuiSessionStats } from '../definition.ts'
import {
  DEFAULT_STATUS_DENSITY,
  resolveStatusBarConfig,
  statusItemVisible,
  STATUS_CONTEXT_STYLES,
  STATUS_ITEM_IDS,
  toggleStatusItem,
  type ResolvedStatusBarConfig,
  type StatusBarConfig,
  type StatusContextStyle,
} from './status-config.ts'
import {
  formatDuration,
  formatTokens,
  renderStatusFooter,
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

/** The shipped footer, optionally narrowed or moved to another density. */
function statusBar(overrides: Partial<StatusBarConfig> = {}): ResolvedStatusBarConfig {
  return resolveStatusBarConfig({ density: DEFAULT_STATUS_DENSITY, hidden: [], ...overrides })
}

/**
 * Context only, in one representation.
 *
 * `contextStyle` used to be settable on its own; it now follows the density, so a
 * test that wants one style says which density produces it rather than reaching
 * past the document. The styles are exercised as behavior, not as a setting.
 */
function contextOnly(style: StatusContextStyle): ResolvedStatusBarConfig {
  const resolved = statusBar({ hidden: STATUS_ITEM_IDS.filter(id => id !== 'context') })
  return { ...resolved, contextStyle: style }
}

/** Read the telemetry row through the same footer used by the live TUI. */
function telemetryRow(
  sample: TuiSessionStats,
  config = statusBar(),
  theme = createTheme(false),
  width = 200,
): string {
  return renderStatusFooter({ model: 'm', stats: sample, config, width }, theme)[1]?.trim() ?? ''
}

/** Split the displayed groups at their separators and the footer column gap. */
function telemetryGroups(sample: TuiSessionStats, config = statusBar()): string[] {
  return stripAnsi(telemetryRow(sample, config)).split(/ • |\s{2,}/u)
}

/** Painted footer rows for the standard metadata and telemetry sample. */
function footerRows(width: number): string[] {
  return renderStatusFooter({
    model: 'deepseek-v4-pro',
    reasoningEffort: 'max',
    pwd: '~/Workspace/dsh-tui',
    branch: 'main *3',
    stats,
    // Every group is only on the row at `verbose`; the narrower densities are
    // about occupancy and latency, so a table of all five needs the widest one.
    config: statusBar({ density: 'verbose' }),
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
 *
 * The visible set is always a prefix of the catalog: fitting drops the last
 * group, so a narrow footer shows occupancy and then as much cost as fits.
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
  // 78 cells of content need an inner width of 78, which 80 columns does not
  // leave once the two-cell insets are taken.
  { width: 80, first: ['deepseek-v4-pro · max', '~/Workspace/dsh-tui · main *3'], dropped: [], groups: [0, 1, 2], clipped: false },
  { width: 100, first: ['deepseek-v4-pro · max', '~/Workspace/dsh-tui · main *3'], dropped: [], groups: [0, 1, 2, 3], clipped: false },
  { width: 120, first: ['deepseek-v4-pro · max', '~/Workspace/dsh-tui · main *3'], dropped: [], groups: [0, 1, 2, 3, 4], clipped: false },
  { width: 200, first: ['deepseek-v4-pro · max', '~/Workspace/dsh-tui · main *3'], dropped: [], groups: [0, 1, 2, 3, 4], clipped: false },
]

/** The telemetry row with its column gap written as a separate marker. */
function twoColumnShape(line: string): string {
  return stripAnsi(line).trim().replace(/\s{2,}/gu, '\u0000').replace(/\s+/gu, ' ')
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
    // `standard` states occupancy and latency; activity arrives at `verbose`.
    expect(telemetryGroups(initial)).toEqual(['Ctx 0%'])
    expect(telemetryGroups(initial, statusBar({ density: 'verbose' }))).toEqual([
      'Context 0% · 0/1M',
      '0 turns · 0 steps',
    ])
    expect(telemetryGroups(initial, statusBar())).toContain('Ctx 0%')
    const compact = telemetryRow(initial, statusBar(), createTheme(false), 80)
    expect(compact).toContain('Ctx 0%')
    expect(compact).not.toContain('Context')
    expect(telemetryRow(initial, statusBar({ density: 'verbose' }), createTheme(false), 80)).toContain('Context 0%')
  })

  it('renders context pressure as percentage and used/window tokens', () => {
    const withContext: TuiSessionStats = {
      ...stats,
      contextTokens: 12_200,
      contextWindow: 100_000,
    }
    // `verbose` selects the detailed form and long labels together.
    expect(telemetryGroups(withContext, statusBar({ density: 'verbose' }))).toContain(
      'Context 12% · 12.2K/100K',
    )
  })

  it.each([
    ['percent', 'Ctx 40%'],
    ['bar', 'Ctx ━━━━──────'],
    ['tokens', 'Ctx 40K/100K'],
    ['detailed', 'Ctx 40% · 40K/100K'],
  ] as const)('renders the %s context style without redundant representations', (contextStyle, expected) => {
    expect(telemetryRow({ ...stats, contextTokens: 40_000, contextWindow: 100_000 },
      contextOnly(contextStyle))).toBe(expected)
  })

  it('bounds the bar while retaining numeric over-capacity information in percent mode', () => {
    const overflow = { ...stats, contextTokens: 120, contextWindow: 100 }
    expect(telemetryRow(overflow, contextOnly('bar'))).toBe('Ctx ━━━━━━━━━━')
    expect(telemetryRow(overflow, contextOnly('percent'))).toBe('Ctx 120%')
    expect(telemetryRow({ ...overflow, contextTokens: -1 }, contextOnly('bar'))).toBe('Ctx ──────────')
    // The style is a density consequence now, so an unknown density falls back
    // instead of letting a stray document pick a representation.
    expect(resolveStatusBarConfig({ density: 'nope' as never }).contextStyle).toBe('percent')
  })

  it.each(STATUS_CONTEXT_STYLES)('keeps %s pressure colors and exact footer widths', contextStyle => {
    for (const colors of [true, false]) {
      const theme = createTheme(colors, true)
      const config = contextOnly(contextStyle)
      for (const width of [10, 20, 40, 80, 140]) {
        const lines = renderStatusFooter({ model: '模型 🐳', stats: { ...stats, contextTokens: 80, contextWindow: 100 }, config, width }, theme)
        for (const line of lines) expect(oracleWidth(line)).toBe(width)
      }
      const warning = telemetryRow({ ...stats, contextTokens: 80, contextWindow: 100 }, config, theme)
      const error = telemetryRow({ ...stats, contextTokens: 95, contextWindow: 100 }, config, theme)
      if (colors) {
        expect(warning).toContain(theme.fg('warning', '').split('\x1b[39m')[0])
        expect(error).toContain(theme.fg('error', '').split('\x1b[39m')[0])
      }
    }
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
      config: contextOnly('percent'),
      width: 80,
    }, colorTheme)
    const error = renderStatusFooter({
      model: 'm',
      stats: { ...base, contextTokens: 95 },
      config: contextOnly('percent'),
      width: 80,
    }, colorTheme)
    expect(warning[1]).toContain(colorTheme.getFgAnsi('warning'))
    expect(error[1]).toContain(colorTheme.getFgAnsi('error'))
  })

  it('formats concise English metric groups', () => {
    expect(telemetryGroups(stats, statusBar({ density: 'verbose' }))).toEqual([
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

  it('keeps the highest-priority groups on a narrow terminal', () => {
    const line = telemetryRow(stats, statusBar({ density: 'verbose' }), createTheme(false), 80)
    expect(line).toContain('Cache 99%')
    expect(line).toContain('5.9M in · 73.8K out')
    expect(line).toContain('TTFT 1.2s · 80 tok/s')
    // Fitting drops from the end of the priority list: durations and activity go
    // first, and a narrower group that comes after them does not jump the queue.
    expect(line).not.toContain('LLM 16m51s')
    expect(line).not.toContain('1 turn · 74 steps')
    expect(stripAnsi(line)).not.toContain('…')
    expect(visibleWidth(line)).toBeLessThanOrEqual(80)
  })

  it('states occupancy on the left and cost on the right', () => {
    // The two halves answer different questions — how full the window is, and
    // what the session spent getting here — so each keeps its side at every
    // density instead of running as one chain from the left margin.
    for (const [density, left, right] of [
      ['minimal', 'Ctx 1.6% • Cache 99%', ''],
      ['standard', 'Ctx 1.6% • Cache 99%', 'TTFT 1.2s · 80 tok/s'],
      ['verbose', 'Context 1.6% · 16.4K/1M • Cache 99%', '5.9M in · 73.8K out • TTFT 1.2s · 80 tok/s'
        + ' • LLM 16m51s · Tools 3m33s • 1 turn · 74 steps'],
    ] as const) {
      const line = renderStatusFooter({
        model: 'm',
        stats: { ...stats, contextTokens: 16_400, contextWindow: 1_000_000 },
        config: statusBar({ density }),
        width: 200,
      }, createTheme(false))[1] ?? ''
      const shape = stripAnsi(line).trim().replace(/\s{2,}/gu, '\u0000')
      expect(shape, density).toBe(right === '' ? left : `${left}\u0000${right}`)
    }
  })

  it('fills the row and stops, keeping the groups that came first', () => {
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
      // Occupancy on the left, cost on the right; within a side, catalog order.
      const left = testCase.groups.filter(index => index === 0).map(index => TELEMETRY_GROUPS[index] ?? '')
      const right = testCase.groups.filter(index => index !== 0).map(index => TELEMETRY_GROUPS[index] ?? '')
      const expected = right.length === 0 ? left.join('') : `${left.join('')}\u0000${right.join(' • ')}`
      expect(twoColumnShape(telemetry), label).toBe(expected)
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

  it('includes every group across the footer columns when space allows', () => {
    const line = telemetryRow(stats, statusBar({ density: 'verbose' }), createTheme(false), 160)
    // One row: cache on the left, the four cost groups on the right.
    expect(twoColumnShape(line)).toBe('Cache 99%\u00005.9M in · 73.8K out • TTFT 1.2s · 80 tok/s'
      + ' • LLM 16m51s · Tools 3m33s • 1 turn · 74 steps')
    expect(line).not.toContain('轮')
    expect(line).not.toContain('缓存')
  })

  it('uses English singular labels', () => {
    expect(telemetryGroups({ ...stats, turns: 1, steps: 1 }, statusBar({ density: 'verbose' })))
      .toContain('1 turn · 1 step')
  })

  it('keeps minimal mode as an explicit telemetry opt-out', () => {
    expect(telemetryRow(stats, statusBar({ enabled: false }), createTheme(false), 200)).toBe('')
  })

  it('migrates legacy presets into a density', () => {
    // `minimal` meant "no second line"; that is minimal density with telemetry off.
    expect(resolveStatusBarConfig(undefined, 'minimal').enabled).toBe(false)
    expect(resolveStatusBarConfig(undefined, 'full').density).toBe('verbose')
    expect(resolveStatusBarConfig(undefined, 'full').labels).toBe('full')
    expect(resolveStatusBarConfig(undefined).density).toBe('standard')
  })

  it('reduces a document written by the old layout engine', () => {
    // The old shape listed what it wanted shown, plus a colour per item and a
    // column per item. Both of those are gone; what survives is what it showed.
    const migrated = resolveStatusBarConfig({
      enabled: true,
      labels: 'compact',
      groups: ['cache'],
      meta: ['model'],
      colors: { metrics: 'warning', tokens: 'accent', model: 'accent' },
      sides: { model: 'right' },
    })
    expect(migrated.groups).toEqual(['cache'])
    expect(migrated.meta).toEqual(['model'])
    // Every other part is recorded as hidden, so it stays gone across densities.
    expect(migrated.groups).not.toContain('tokens')
    expect(migrated.meta).not.toContain('path')
  })

  it('honors a narrowing and keeps the catalog order', () => {
    // Hiding is still a per-part decision; the order is not. A reader who keeps
    // three numbers sees them where they always are, so the footer cannot
    // reshuffle itself between one session and the next.
    const custom = statusBar({ density: 'verbose', hidden: ['context', 'speed', 'durations'] })
    expect(telemetryGroups(stats, custom)).toEqual([
      'Cache 99%',
      '5.9M in · 73.8K out',
      '1 turn · 74 steps',
    ])
  })

  it('hides telemetry when no complete metric group fits', () => {
    expect(telemetryRow(stats, statusBar(), createTheme(false), 10)).toBe('')
  })

  it('renders model/workspace and telemetry as two split footer rows', () => {
    const lines = renderStatusFooter({
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
      pwd: '~/Workspace/dsh-tui',
      branch: 'main *6 ?4',
      stats,
      config: statusBar({ density: 'verbose' }),
      width: 140,
    }, createTheme(false))

    expect(lines).toHaveLength(2)
    expect(lines.every(line => visibleWidth(line) === 140)).toBe(true)
    expect(stripAnsi(lines[0] ?? '')).toMatch(/^  deepseek-v4-pro · max\s+~\/Workspace\/dsh-tui · main \*6 \?4  $/)
    // Occupancy holds the left edge, cost the right.
    expect(twoColumnShape(lines[1] ?? '')).toBe(
      'Cache 99%\u00005.9M in · 73.8K out • TTFT 1.2s · 80 tok/s • LLM 16m51s · Tools 3m33s • 1 turn · 74 steps')
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
      config: statusBar({ density: 'verbose' }),
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

  it('keeps the semantic exceptions that a custom colour used to be needed for', () => {
    // There is no per-item colour left. What remains is the hierarchy the palette
    // already encoded: a dirty branch is `warning`, whatever else is configured.
    const theme = createTheme(true, true)
    const lines = renderStatusFooter({
      model: 'deepseek-v4-pro',
      pwd: '~/ws',
      branch: 'main *1',
      stats,
      config: statusBar(),
      width: 140,
    }, theme)
    expect(lines[0]).toContain(theme.getFgAnsi('warning'))
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
    const lines = renderStatusFooter({
      model: 'deepseek',
      reasoningEffort: 'max',
      pwd: '~/project',
      branch: 'main *1',
      stats,
      config: statusBar({ density: 'verbose' }),
      width: 120,
    }, createTheme(false))
    expect(stripAnsi(lines[0] ?? '')).toMatch(/^  deepseek · max\s+~\/project · main \*1  $/)
    expect(stripAnsi(lines[1] ?? '')).toContain('Cache 99%')
    expect(stripAnsi(lines[1] ?? '')).toContain('Tools 3m33s')
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(120)
  })

  it('keeps the first preview line split instead of packing path and git left', () => {
    const lines = renderStatusFooter({
      model: 'deepseek',
      reasoningEffort: 'max',
      pwd: '~/project',
      branch: 'main *1',
      stats,
      config: statusBar(),
      width: 80,
    }, createTheme(false))
    expect(stripAnsi(lines[0] ?? '')).toMatch(/^  deepseek · max\s+~\/project · main \*1  $/)
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
      // `session` joins the first line at Verbose; Standard leaves it off.
      config: statusBar({ density: 'verbose' }),
      width: 80,
    }, createTheme(false))
    expect(stripAnsi(shown[0] ?? '')).toContain('Fix the parser')
  })
})

describe('status densities', () => {
  const withContext = { ...stats, contextTokens: 16_400, contextWindow: 1_000_000 }
  const groupsAt = (density: 'minimal' | 'standard' | 'verbose'): string[] =>
    telemetryGroups(withContext, statusBar({ density }))

  it('states occupancy alone at minimal, adds latency at standard, and all at verbose', () => {
    expect(groupsAt('minimal')).toEqual(['Ctx 1.6%', 'Cache 99%'])
    expect(groupsAt('standard')).toEqual(['Ctx 1.6%', 'Cache 99%', 'TTFT 1.2s · 80 tok/s'])
    expect(groupsAt('verbose')).toEqual([
      'Context 1.6% · 16.4K/1M',
      'Cache 99%',
      '5.9M in · 73.8K out',
      'TTFT 1.2s · 80 tok/s',
      'LLM 16m51s · Tools 3m33s',
      '1 turn · 74 steps',
    ])
  })

  it('lets a reader add a part its density omits, and keeps both directions apart', () => {
    // A part the density leaves out used to be untoggleable: `Space` removed a
    // narrowing that was never there, so the row said `hidden` and stayed that
    // way. It is an addition now, and the density keeps working underneath.
    const added = toggleStatusItem({ density: 'standard', hidden: [], shown: [] }, 'counts')
    expect(statusItemVisible(resolveStatusBarConfig(added), 'counts')).toBe(true)
    const removed = toggleStatusItem(added, 'counts')
    expect(statusItemVisible(resolveStatusBarConfig(removed), 'counts')).toBe(false)

    // The added part sits where its family sits, not at the end of the row.
    expect(resolveStatusBarConfig(added).groups).toEqual(['context', 'cache', 'speed', 'counts'])
  })

  it('keeps a choice about one part from rewriting what the density decides', () => {
    // The reported drift: hiding one part stored the whole visible set as a
    // narrowing, so afterwards `verbose` showed the same three groups as
    // `standard` — one switch silently changed another.
    const hidden = toggleStatusItem({ density: 'standard', hidden: [], shown: [] }, 'cache')
    expect(resolveStatusBarConfig(hidden).groups).toEqual(['context', 'speed'])
    const wider = resolveStatusBarConfig({ ...hidden, density: 'verbose' })
    expect(wider.groups).toEqual(['context', 'tokens', 'speed', 'durations', 'counts'])
    expect(wider.groups).not.toContain('cache')
  })
})
