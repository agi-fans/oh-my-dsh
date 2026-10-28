import { describe, expect, it } from 'vitest'
import { renderTimelineOverview, trajectoryTimeline, wallClockMs } from './trajectory-timeline.ts'
import type { TrajectoryKind, TrajectoryRecord } from './trajectory.ts'

/** One record with only the fields the overview reads. */
function record(kind: TrajectoryKind, startedAt: number, durationMs: number | null): TrajectoryRecord {
  return {
    id: `${kind}:${startedAt}`,
    index: 0,
    seq: startedAt,
    type: kind,
    kind,
    turn: 1,
    step: 1,
    label: kind,
    summary: '',
    payload: '',
    result: '',
    schema: '',
    status: 'ok',
    startedAt,
    durationMs,
    ttftMs: null,
    inputTokens: null,
    outputTokens: null,
    parentCallId: null,
  }
}

const paint = (lane: string, text: string): string => `<${lane}>${text}`
const paintEmpty = (text: string): string => text
const formatDuration = (ms: number): string => `${Math.round(ms / 1000)}s`

describe('trajectory timeline', () => {
  it('groups records into three lanes instead of one bar per record', () => {
    // The question is "model or tools or overhead", not "eleven tool calls".
    const overview = trajectoryTimeline([
      record('assistant', 0, 60_000),
      record('tool', 60_000, 20_000),
      record('tool', 80_000, 19_000),
      record('tool', 99_000, 1_000),
      record('user', 100_000, 0),
    ], { width: 40 })
    expect(overview?.lanes.map(span => [span.lane, span.ms])).toEqual([
      ['llm', 60_000],
      ['tools', 40_000],
      ['other', 0],
    ])
    expect(overview?.totalMs).toBe(100_000)
  })

  it('skips records that recorded no duration rather than counting them as zero', () => {
    // An event without a duration did not take zero time; drawing it as zero
    // would make the bar claim time went somewhere it did not.
    const overview = trajectoryTimeline([
      record('assistant', 0, 30_000),
      record('tool', 30_000, null),
      record('user', 40_000, 10_000),
    ], { width: 20 })
    expect(overview?.totalMs).toBe(40_000)
    expect(overview?.lanes.find(span => span.lane === 'tools')?.ms).toBe(0)
  })

  it('returns nothing when no record was timed', () => {
    expect(trajectoryTimeline([record('user', 0, null)], { width: 20 })).toBeUndefined()
    expect(trajectoryTimeline([], { width: 20 })).toBeUndefined()
  })

  it('measures the recorded span, not the session wall clock', () => {
    // A session that idled for an hour between two 10 s turns must not have its
    // lanes scaled down to invisibility by the idle time.
    const overview = trajectoryTimeline([record('assistant', 0, 10_000), record('assistant', 3_600_000, 10_000)], { width: 20 })
    expect(overview?.totalMs).toBe(20_000)
    // The wall clock still reports the gap, for the caller that wants it.
    expect(wallClockMs([record('assistant', 0, 10_000), record('assistant', 3_600_000, 10_000)])).toBe(3_610_000)
  })

  it('draws one labelled bar per lane that had time', () => {
    const overview = trajectoryTimeline([record('assistant', 0, 75_000), record('tool', 75_000, 25_000)], { width: 60 })!
    const rows = renderTimelineOverview(overview, { width: 60, formatDuration, paint, paintEmpty })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('LLM')
    expect(rows[0]).toContain('75%')
    expect(rows[1]).toContain('Tools')
    expect(rows[1]).toContain('25%')
    // A lane with no time is not drawn: an empty bar says "zero" louder than it
    // says "nothing to report".
    expect(rows.join('\n')).not.toContain('Other')
  })

  it('keeps every bar the same width so the lanes are comparable', () => {
    const overview = trajectoryTimeline([record('assistant', 0, 90_000), record('tool', 90_000, 10_000)], { width: 80 })!
    const rows = renderTimelineOverview(overview, { width: 80, formatDuration, paint, paintEmpty })
    // Strip the label prefix and the percentage suffix, then measure the fill.
    const bars = rows.map(row => /[━─]+/u.exec(row)?.[0] ?? '')
    expect(bars).toHaveLength(2)
    expect(bars[0]!.length).toBe(bars[1]!.length)
    // The dominant lane is visibly longer than the minor one.
    expect(bars[0]!.split('').filter(ch => ch === '━').length)
      .toBeGreaterThan(bars[1]!.split('').filter(ch => ch === '━').length)
  })

  it('never lets a nonzero lane disappear entirely', () => {
    // 0.4% rounded to zero cells would read as "this lane never ran".
    const overview = trajectoryTimeline([
      record('assistant', 0, 1_000_000),
      record('tool', 1_000_000, 4_000),
    ], { width: 40 })!
    const rows = renderTimelineOverview(overview, { width: 40, formatDuration, paint, paintEmpty })
    expect(rows[1]).toContain('━')
  })
})
