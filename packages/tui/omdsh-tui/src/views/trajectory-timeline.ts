/**
 * Read-only timing overview for the Trajectory ledger.
 *
 * The ledger answers "what happened"; this answers "where did the time go". A
 * reader asking why one turn took sixteen minutes currently has to open the
 * detail panel on each record and add the durations up in their head — the
 * numbers are all there, but nothing puts them on one axis.
 *
 * It is deliberately not the desktop client's interactive timeline. That view
 * supports dragging an interval to filter the ledger, wheel zoom, and
 * right-drag panning, which are mouse gestures a terminal either cannot express
 * or can only approximate badly. A terminal answer to the same question is one
 * fixed-width bar per lane: the terminal's cell grid is already an axis, and
 * reading a proportion off it needs no interaction at all.
 *
 * @module @agi-fans/dsh-tui/views/trajectory-timeline
 */

import type { TrajectoryKind, TrajectoryRecord } from './trajectory.ts'

/** The lanes the overview draws, in the order a reader looks for them. */
export const TIMELINE_LANES = ['llm', 'tools', 'other'] as const
export type TimelineLane = (typeof TIMELINE_LANES)[number]

/** One lane's share of the wall clock. */
export interface TimelineLaneSpan {
  lane: TimelineLane
  /** Total milliseconds this lane occupied. */
  ms: number
  /** Cells drawn for this lane, when it filled a whole bar. */
  cells: number
}

/** The overview a renderer draws, or `undefined` when there is nothing to time. */
export interface TimelineOverview {
  /** Wall-clock span covered, from the earliest start to the latest end. */
  totalMs: number
  lanes: readonly TimelineLaneSpan[]
  /** Bars wide enough for one cell per lane. */
  width: number
}

/**
 * Which lane a record belongs to.
 *
 * Three lanes rather than one per record: the question is "model or tools or
 * overhead", and a reader answering it does not care that there were eleven
 * tool calls. Grouping is also what makes the overview fit in three rows no
 * matter how long the session is.
 */
function laneOf(kind: TrajectoryKind): TimelineLane {
  if (kind === 'assistant') return 'llm'
  if (kind === 'tool' || kind === 'subtool') return 'tools'
  return 'other'
}

/** Milliseconds a record occupied, or `undefined` when it recorded no duration. */
function durationOf(record: TrajectoryRecord): number | undefined {
  const measured = record.durationMs
  if (measured !== undefined && measured !== null && measured > 0) return measured
  return undefined
}

/**
 * Build the overview from the records that carry a duration.
 *
 * Records without one are skipped rather than guessed at: an event with no
 * recorded duration did not take zero time, and drawing it as zero would make
 * the bar lie about where the time went. Their absence is visible as a total
 * that is smaller than the wall clock, which is honest.
 */
export function trajectoryTimeline(
  records: readonly TrajectoryRecord[],
  options: { width: number; lanes?: readonly TimelineLane[] } = { width: 0 },
): TimelineOverview | undefined {
  const lanes = options.lanes ?? TIMELINE_LANES
  const totals = new Map<TimelineLane, number>()
  let earliest = Number.POSITIVE_INFINITY
  let latest = Number.NEGATIVE_INFINITY

  for (const record of records) {
    const ms = durationOf(record)
    if (ms === undefined) continue
    const lane = laneOf(record.kind)
    totals.set(lane, (totals.get(lane) ?? 0) + ms)
    const start = record.startedAt
    if (start !== null) {
      earliest = Math.min(earliest, start)
      latest = Math.max(latest, start + ms)
    }
  }

  const totalMs = [...totals.values()].reduce((sum, ms) => sum + ms, 0)
  if (totalMs <= 0) return undefined
  const width = Math.max(0, Math.floor(options.width))
  return {
    // The measured span, not the wall clock: a session idles between turns, and
    // counting idle time would make every lane look short.
    totalMs,
    lanes: lanes.map(lane => {
      const ms = totals.get(lane) ?? 0
      return { lane, ms, cells: width === 0 ? 0 : Math.round(ms / totalMs * width) }
    }),
    width,
  }
}

/** Wall clock from the first recorded start to the last recorded end. */
export function wallClockMs(records: readonly TrajectoryRecord[]): number | undefined {
  let earliest = Number.POSITIVE_INFINITY
  let latest = Number.NEGATIVE_INFINITY
  for (const record of records) {
    const ms = durationOf(record)
    const start = record.startedAt
    if (ms === undefined || start === null) continue
    earliest = Math.min(earliest, start)
    latest = Math.max(latest, start + ms)
  }
  if (!(latest > earliest)) return undefined
  return latest - earliest
}

/** Lane labels, short enough to leave the bar most of the row. */
const LANE_LABEL: Readonly<Record<TimelineLane, string>> = {
  llm: 'LLM',
  tools: 'Tools',
  other: 'Other',
}

/**
 * Draw the overview as one labelled bar per lane.
 *
 * A bar, not a scaled timeline: with three lanes the useful reading is a
 * proportion ("most of the time was the model"), and a proportion is what a
 * filled run of cells says best. An axis with tick marks would spend cells on
 * the axis and still not answer the question faster.
 *
 * The percentage and duration sit after the bar so the row stays readable when
 * the bar is truncated on a narrow terminal — the numbers are the part a reader
 * would otherwise have to compute.
 */
export function renderTimelineOverview(
  overview: TimelineOverview,
  options: {
    width: number
    /** Total including every record, so a lane's share can be stated honestly. */
    formatDuration: (ms: number) => string
    /** Colour one filled cell. */
    paint: (lane: TimelineLane, text: string) => string
    /** Colour the empty remainder. */
    paintEmpty: (text: string) => string
  },
): string[] {
  const laneWidth = Math.max(...TIMELINE_LANES.map(lane => LANE_LABEL[lane].length))
  const shown = overview.lanes.filter(span => span.ms > 0)
  if (shown.length === 0) return []
  // `LLM  ` + bar + `  62% · 15m22s`
  const suffix = (span: TimelineLaneSpan): string =>
    `  ${String(Math.round(span.ms / overview.totalMs * 100)).padStart(3)}% · ${options.formatDuration(span.ms)}`
  const widestSuffix = Math.max(...shown.map(span => suffix(span).length))
  const barWidth = Math.max(1, Math.min(overview.width - laneWidth - 2 - widestSuffix, Math.floor(options.width * 0.4)))
  return shown.map(span => {
    const filled = Math.max(1, Math.round(span.ms / overview.totalMs * barWidth))
    const bar = options.paint(span.lane, '━'.repeat(filled))
      + options.paintEmpty('─'.repeat(Math.max(0, barWidth - filled)))
    const label = LANE_LABEL[span.lane].padEnd(laneWidth)
    return `${label}  ${bar}${suffix(span)}`
  })
}
