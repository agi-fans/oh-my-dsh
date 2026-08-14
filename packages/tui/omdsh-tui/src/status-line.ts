/**
 * Compact whole-session telemetry rendered in the editor's bottom border.
 *
 * The caller supplies one stable projection; this module owns copy,
 * responsive group selection, color hierarchy, and terminal layout. English
 * copy deliberately stays local until a runtime language module provides a
 * second locale — then this is the single seam where a dictionary is chosen.
 * @module @omdsh/tui/status-line
 */

import type { TuiSessionStats } from './definition.ts'
import type { StatusPreset } from './settings-list.ts'
import type { Theme, ThemeColor } from './theme.ts'
import { truncateToWidth, visibleWidth } from './width.ts'

type StatusGroupId = 'counts' | 'durations' | 'speed' | 'cache' | 'tokens'
type StatusTone = 'label' | 'value' | 'positive' | 'token' | 'separator'

interface StatusPart {
  text: string
  tone: StatusTone
}

interface StatusGroup {
  id: StatusGroupId
  parts: StatusPart[]
}

const STATUS_PRIORITY: readonly StatusGroupId[] = ['cache', 'tokens', 'speed', 'durations', 'counts']
const LABEL_PADDING = 2
const GROUP_SEPARATOR = ' │ '

/** Compact token count: 517 / 12.2K / 517K / 1.2M. */
export function formatTokens(value: number): string {
  const scaled = (n: number): string => n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${scaled(value / 1_000)}K`
  return `${scaled(value / 1_000_000)}M`
}

/** Compact duration: 45.2s under a minute, 2m42s from there on. */
export function formatDuration(ms: number): string {
  const seconds = ms / 1_000
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** Human-readable model throughput with the same precision as dsh web. */
export function formatTokensPerSecond(value: number): string {
  return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
}

function part(text: string, tone: StatusTone): StatusPart {
  return { text, tone }
}

function metric(label: string, value: string, tone: StatusTone = 'value'): StatusPart[] {
  return [part(label + ' ', 'label'), part(value, tone)]
}

/** English semantic groups; language selection will replace copy here. */
function buildStatusGroups(stats: TuiSessionStats): StatusGroup[] {
  const groups: StatusGroup[] = []
  if (stats.steps > 0) {
    groups.push({
      id: 'counts',
      parts: [
        part(String(stats.turns), 'value'),
        part(stats.turns === 1 ? ' turn' : ' turns', 'label'),
        part(' · ', 'separator'),
        part(String(stats.steps), 'value'),
        part(stats.steps === 1 ? ' step' : ' steps', 'label'),
      ],
    })

    const durations: StatusPart[] = []
    if (stats.llmMs > 0) durations.push(...metric('LLM', formatDuration(stats.llmMs)))
    if (stats.llmMs > 0 && stats.toolMs > 0) durations.push(part(' · ', 'separator'))
    if (stats.toolMs > 0) durations.push(...metric('Tools', formatDuration(stats.toolMs)))
    if (durations.length > 0) groups.push({ id: 'durations', parts: durations })

    const speed: StatusPart[] = []
    if (stats.ttftSteps > 0) speed.push(...metric('TTFT', formatDuration(stats.ttftMs / stats.ttftSteps)))
    if (stats.ttftSteps > 0 && stats.decodeMs > 0) speed.push(part(' · ', 'separator'))
    if (stats.decodeMs > 0) {
      speed.push(part(`${formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000))} tok/s`, 'value'))
    }
    if (speed.length > 0) groups.push({ id: 'speed', parts: speed })
  }

  if (stats.inputTokens > 0 || stats.outputTokens > 0) {
    if (stats.inputTokens > 0) {
      groups.push({
        id: 'cache',
        parts: metric('Cache', `${Math.round(stats.cacheReadTokens / stats.inputTokens * 100)}%`, 'positive'),
      })
    }
    groups.push({
      id: 'tokens',
      parts: [
        part(formatTokens(stats.inputTokens), 'token'),
        part(' in', 'label'),
        part(' · ', 'separator'),
        part(formatTokens(stats.outputTokens), 'token'),
        part(' out', 'label'),
      ],
    })
  }
  return STATUS_PRIORITY.flatMap(id => groups.filter(group => group.id === id))
}

function groupText(group: StatusGroup): string {
  return group.parts.map(item => item.text).join('')
}

/** Build the unpainted English groups for diagnostics and tests. */
export function sessionStatusGroups(stats: TuiSessionStats): string[] {
  return buildStatusGroups(stats).map(groupText)
}

function groupsWidth(groups: readonly StatusGroup[]): number {
  if (groups.length === 0) return 0
  return groups.reduce((total, group) => total + visibleWidth(groupText(group)), 0)
    + GROUP_SEPARATOR.length * (groups.length - 1)
}

function layoutWidth(groups: readonly StatusGroup[]): number {
  return LABEL_PADDING + groupsWidth(groups)
}

/**
 * Keep complete metric groups instead of truncating the sentence. Cache and
 * token usage survive first, followed by latency/rate, timings, then counts.
 */
function selectGroups(groups: readonly StatusGroup[], width: number): StatusGroup[] {
  const selected: StatusGroup[] = []
  for (const group of groups) {
    const candidate = [...selected, group]
    if (layoutWidth(candidate) > width) break
    selected.push(group)
  }
  return selected
}

function toneColor(tone: StatusTone): ThemeColor {
  if (tone === 'value') return 'text'
  if (tone === 'positive') return 'success'
  if (tone === 'token') return 'customMessageLabel'
  return tone === 'separator' ? 'dim' : 'muted'
}

function paintGroup(group: StatusGroup, theme: Theme): string {
  return group.parts.map(item => theme.fg(toneColor(item.tone), item.text)).join('')
}

function paintColumn(groups: readonly StatusGroup[], theme: Theme): string {
  const separator = theme.fg('dim', GROUP_SEPARATOR)
  return groups.map(group => paintGroup(group, theme)).join(separator)
}

/**
 * Render a responsive label for the editor's bottom border. Groups stay
 * intact on narrow terminals; `minimal` remains an explicit opt-out.
 */
export function renderSessionStatusLabel(
  stats: TuiSessionStats | undefined,
  preset: StatusPreset,
  theme: Theme,
  width: number,
): string {
  if (stats === undefined || preset === 'minimal' || width <= LABEL_PADDING) return ''
  const groups = selectGroups(buildStatusGroups(stats), width)
  if (groups.length === 0) return ''
  const line = ' ' + paintColumn(groups, theme) + ' '
  return truncateToWidth(line, width)
}
