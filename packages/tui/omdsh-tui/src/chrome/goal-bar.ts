/**
 * Durable-goal bar docked above the composer. One unframed row: a phase label,
 * the objective (truncated to the terminal width), and the admitted-round
 * counter right-aligned at the terminal edge whenever any round has started.
 * The counter carries `/maxGoalRounds` only when the goal has a cap. A
 * completed goal never reaches this renderer — the projection reports it as
 * absent.
 * @module @agi-fans/dsh-tui/goal-bar
 */

import type { TuiGoalStatus } from '../definition.ts'
import type { Theme, ThemeColor } from './theme.ts'
import { truncateToWidth, visibleWidth } from './width.ts'

const PHASE_LABEL: Record<TuiGoalStatus['phase'], string> = {
  active: 'Goal',
  paused: 'Goal paused',
  blocked: 'Goal blocked',
}

const PHASE_TONE: Record<TuiGoalStatus['phase'], ThemeColor> = {
  active: 'accent',
  paused: 'warning',
  blocked: 'error',
}

/** Render the goal bar, or nothing when there is no row to show. */
export function renderGoalBar(goal: TuiGoalStatus, theme: Theme, width: number): string[] {
  if (width <= 0) return []
  const label = theme.bold(theme.fg(PHASE_TONE[goal.phase], PHASE_LABEL[goal.phase]))
  const objective = theme.fg('text', goal.objective)
  const reason = goal.blockedReason === undefined
    ? ''
    : theme.fg('dim', ' — ') + theme.fg('warning', goal.blockedReason)
  const left = '  ' + theme.fg(PHASE_TONE[goal.phase], '◈') + ' ' + label + theme.fg('dim', ' · ') + objective + reason
  const rounds = goal.roundsStarted === 0
    ? ''
    : theme.fg('dim', `round ${goal.roundsStarted}${goal.maxGoalRounds > 0 ? `/${goal.maxGoalRounds}` : ''}`)
  if (rounds === '') return [truncateToWidth(left, width)]
  const roundsWidth = visibleWidth(rounds)
  const leftWidth = visibleWidth(left)
  if (leftWidth + roundsWidth + 2 <= width) {
    return [left + ' '.repeat(width - leftWidth - roundsWidth) + rounds]
  }
  if (roundsWidth + 4 >= width) return [truncateToWidth(left, width)]
  return [truncateToWidth(left, width - roundsWidth - 2) + '  ' + rounds]
}
