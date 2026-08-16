/**
 * Fixed two-line session footer rendered below the composer.
 *
 * The caller supplies one stable projection; this module owns copy,
 * responsive group selection, color hierarchy, and terminal layout. English
 * copy deliberately stays local until a runtime language module provides a
 * second locale — then this is the single seam where a dictionary is chosen.
 * @module @agi-fans/dsh-tui/status-line
 */

import type { TuiLoopStatus, TuiSessionControls, TuiSessionStats } from './definition.ts'
import { defaultStatusBarConfig, resolveStatusBarConfig, type StatusBarConfig, type StatusGroupId } from './status-config.ts'
import type { Theme, ThemeColor } from './theme.ts'
import { padToWidth, truncateToWidth, visibleWidth } from './width.ts'

type StatusTone = 'label' | 'value' | 'positive' | 'token' | 'separator'

interface StatusPart {
  text: string
  tone: StatusTone
}

interface StatusGroup {
  id: StatusGroupId
  parts: StatusPart[]
}

const LABEL_PADDING = 2
const GROUP_SEPARATOR = ' • '
const FOOTER_PADDING = 2
const COLUMN_GAP = 3
const RIGHT_GROUPS = new Set<StatusGroupId>(['durations', 'counts'])

/** Context needed to render the fixed session footer. */
export interface StatusFooterOptions {
  model: string
  reasoningEffort?: string
  controls?: TuiSessionControls
  loop?: TuiLoopStatus
  pwd?: string
  branch?: string
  stats?: TuiSessionStats
  config: StatusBarConfig
  width: number
}

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

function formatContextPercent(tokens: number, window: number): string {
  const percent = Math.max(0, tokens) / window * 100
  const rounded = percent < 10 ? Math.round(percent * 10) / 10 : Math.round(percent)
  return String(rounded)
}

function part(text: string, tone: StatusTone): StatusPart {
  return { text, tone }
}

function metric(label: string, value: string, tone: StatusTone = 'value'): StatusPart[] {
  return [part(label + ' ', 'label'), part(value, tone)]
}

/** English semantic groups; language selection will replace copy here. */
function buildStatusGroups(stats: TuiSessionStats, config: StatusBarConfig): StatusGroup[] {
  const groups: StatusGroup[] = []
  if (stats.contextWindow !== undefined && stats.contextWindow > 0) {
    const used = stats.contextTokens ?? 0
    groups.push({
      id: 'context',
      parts: [
        ...metric(config.labels === 'compact' ? 'Ctx' : 'Context', `${formatContextPercent(used, stats.contextWindow)}%`),
        part(' · ', 'separator'),
        part(`${formatTokens(used)}/${formatTokens(stats.contextWindow)}`, 'token'),
      ],
    })
  }
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
  if (stats.steps > 0) {
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
  return config.groups.flatMap(id => groups.filter(group => group.id === id))
}

function groupText(group: StatusGroup): string {
  return group.parts.map(item => item.text).join('')
}

/** Build the unpainted English groups for diagnostics and tests. */
export function sessionStatusGroups(
  stats: TuiSessionStats,
  config: StatusBarConfig = defaultStatusBarConfig(),
): string[] {
  const normalized = resolveStatusBarConfig(config)
  if (!normalized.enabled) return []
  return buildStatusGroups(stats, normalized).map(groupText)
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

function splitWidth(left: readonly StatusGroup[], right: readonly StatusGroup[]): number {
  const leftWidth = groupsWidth(left)
  const rightWidth = groupsWidth(right)
  return leftWidth + rightWidth + (leftWidth > 0 && rightWidth > 0 ? COLUMN_GAP : 0)
}

/** Select whole groups in user order, then place timing/activity on the right. */
function selectFooterGroups(groups: readonly StatusGroup[], width: number): { left: StatusGroup[]; right: StatusGroup[] } {
  const left: StatusGroup[] = []
  const right: StatusGroup[] = []
  for (const group of groups) {
    const candidateLeft = RIGHT_GROUPS.has(group.id) ? left : [...left, group]
    const candidateRight = RIGHT_GROUPS.has(group.id) ? [...right, group] : right
    if (splitWidth(candidateLeft, candidateRight) > width) break
    if (RIGHT_GROUPS.has(group.id)) right.push(group)
    else left.push(group)
  }
  return { left, right }
}

function renderSplitRow(left: string, right: string, width: number): string {
  if (width <= 0) return ''
  const padding = width >= FOOTER_PADDING * 2 ? FOOTER_PADDING : 0
  const innerWidth = Math.max(0, width - padding * 2)
  const leftWidth = visibleWidth(left)
  const rightWidth = visibleWidth(right)
  if (leftWidth === 0 || rightWidth === 0) {
    const content = leftWidth > 0 ? truncateToWidth(left, innerWidth) : truncateToWidth(right, innerWidth)
    return padToWidth(' '.repeat(padding) + content, width)
  }
  const gap = Math.max(1, innerWidth - leftWidth - rightWidth)
  return padToWidth(' '.repeat(padding) + left + ' '.repeat(gap) + right, width)
}

function planStatus(plan: TuiSessionControls['plan']): { text: string; tone: ThemeColor } | undefined {
  if (plan === undefined) return undefined
  if (plan.pending) return plan.active
    ? { text: 'PLAN→DEFAULT', tone: 'warning' }
    : { text: 'PLAN…', tone: 'accent' }
  return plan.active ? { text: 'PLAN', tone: 'accent' } : undefined
}

function loopStatus(loop: TuiLoopStatus | undefined): { text: string; tone: ThemeColor } | undefined {
  if (loop === undefined) return undefined
  const repeatProgress = loop.total === undefined ? undefined : `${loop.repeats ?? 0}/${loop.total} REPEATS`
  if (loop.phase === 'completed') {
    const completed = loop.repeats === undefined ? '' : ` · ${loop.repeats} ${loop.repeats === 1 ? 'REPEAT' : 'REPEATS'}`
    return { text: `LOOP DONE${completed}`, tone: 'success' }
  }
  if (loop.phase === 'paused') return { text: 'LOOP PAUSED · SEND TO RESUME', tone: 'warning' }
  if (loop.phase === 'waiting') {
    const budget = repeatProgress ?? loop.limit
    return { text: `LOOP WAITING · SEND PROMPT${budget === undefined ? '' : ` · ${budget}`}`, tone: 'accent' }
  }
  if (repeatProgress !== undefined) return { text: `LOOP · ${repeatProgress}`, tone: 'accent' }
  if (loop.deadline !== undefined) {
    const remainingMs = Math.max(0, loop.deadline - Date.now())
    return { text: `LOOP · ${formatDuration(Math.max(1_000, remainingMs))} LEFT`, tone: 'accent' }
  }
  if (loop.limit !== undefined) return { text: `LOOP · ${loop.limit}`, tone: 'accent' }
  return { text: 'LOOP', tone: 'accent' }
}

function fitModelColumn(
  model: string,
  effort: string | undefined,
  plan: TuiSessionControls['plan'],
  loop: TuiLoopStatus | undefined,
  theme: Theme,
  width: number,
): string {
  if (width <= 0) return ''
  const separator = ' · '
  const statuses = [planStatus(plan), loopStatus(loop)].filter(
    (status): status is { text: string; tone: ThemeColor } => status !== undefined,
  )
  const statusWidth = statuses.reduce((total, status) => total + visibleWidth(status.text), 0)
    + Math.max(0, statuses.length - 1) * visibleWidth(separator)
  if (statusWidth >= width) {
    const summary = statuses.map(status => status.text).join(separator)
    return theme.fg(statuses.at(-1)?.tone ?? 'accent', truncateToWidth(summary, width))
  }
  const suffix = statuses.map((status, index) =>
    (index === 0 ? '' : theme.fg('dim', separator)) + theme.fg(status.tone, status.text)).join('')
  const prefixWidth = statuses.length === 0 ? width : width - visibleWidth(separator) - statusWidth
  const prefix = effort === undefined || effort === ''
    ? theme.fg('text', truncateToWidth(model, Math.max(1, prefixWidth)))
    : (() => {
        const effortWidth = visibleWidth(effort)
        if (effortWidth + visibleWidth(separator) >= prefixWidth) {
          return theme.fg('customMessageLabel', truncateToWidth(effort, Math.max(1, prefixWidth)))
        }
        const modelWidth = Math.max(1, prefixWidth - visibleWidth(separator) - effortWidth)
        return theme.fg('text', truncateToWidth(model, modelWidth))
          + theme.fg('dim', separator)
          + theme.fg('customMessageLabel', effort)
      })()
  return statuses.length === 0 ? prefix : prefix + theme.fg('dim', separator) + suffix
}

function fitLocationColumn(pwd: string | undefined, branch: string | undefined, theme: Theme, width: number): string {
  if (width <= 0) return ''
  if (branch === undefined || branch === '') return theme.fg('muted', truncateToWidth(pwd ?? '', width))
  const branchTone: ThemeColor = /(?:^|\s)[*?]\d+/.test(branch) ? 'warning' : 'muted'
  if (pwd === undefined || pwd === '') return theme.fg(branchTone, truncateToWidth(branch, width))
  const separator = ' · '
  const branchWidth = visibleWidth(branch)
  if (branchWidth >= width) return theme.fg(branchTone, truncateToWidth(branch, width))
  const pwdWidth = Math.max(1, width - visibleWidth(separator) - branchWidth)
  return theme.fg('muted', truncateToWidth(pwd, pwdWidth))
    + theme.fg('dim', separator)
    + theme.fg(branchTone, branch)
}

function permissionTone(permission: string): ThemeColor {
  if (permission === 'danger-full-access' || permission === 'custom') return 'error'
  if (permission === 'read-only') return 'accent'
  return 'success'
}

function permissionLabel(permission: string): string {
  if (permission === 'danger-full-access') return 'FULL ACCESS'
  if (permission === 'workspace-write') return 'workspace-write'
  if (permission === 'read-only') return 'read-only'
  return permission === 'custom' ? 'CUSTOM ACCESS' : permission
}

function fitWorkspaceColumn(
  pwd: string | undefined,
  branch: string | undefined,
  permission: string | undefined,
  theme: Theme,
  width: number,
): string {
  if (permission === undefined || permission === '') return fitLocationColumn(pwd, branch, theme, width)
  const label = permissionLabel(permission)
  const separator = ' · '
  const labelWidth = visibleWidth(label)
  if (labelWidth >= width) return theme.fg(permissionTone(permission), truncateToWidth(label, width))
  const locationWidth = width - labelWidth - visibleWidth(separator)
  const location = fitLocationColumn(pwd, branch, theme, locationWidth)
  if (location === '') return theme.fg(permissionTone(permission), label)
  return theme.fg(permissionTone(permission), label) + theme.fg('dim', separator) + location
}

function metadataColumns(options: StatusFooterOptions, theme: Theme, innerWidth: number): { left: string; right: string } {
  const plan = planStatus(options.controls?.plan)
  const loop = loopStatus(options.loop)
  const permission = options.controls?.permission
  const rawLeftWidth = visibleWidth(options.model)
    + (options.reasoningEffort === undefined || options.reasoningEffort === '' ? 0 : 3 + visibleWidth(options.reasoningEffort))
    + (plan === undefined ? 0 : 3 + visibleWidth(plan.text))
    + (loop === undefined ? 0 : 3 + visibleWidth(loop.text))
  const rawLocationWidth = visibleWidth(options.pwd ?? '')
    + (options.branch === undefined || options.branch === '' ? 0 : 3 + visibleWidth(options.branch))
  const rawRightWidth = rawLocationWidth
    + (permission === undefined || permission === ''
      ? 0
      : visibleWidth(permissionLabel(permission)) + (rawLocationWidth === 0 ? 0 : 3))
  if (rawRightWidth === 0) {
    return { left: fitModelColumn(options.model, options.reasoningEffort, options.controls?.plan, options.loop, theme, innerWidth), right: '' }
  }
  if (rawLeftWidth + COLUMN_GAP + rawRightWidth <= innerWidth) {
    return {
      left: fitModelColumn(options.model, options.reasoningEffort, options.controls?.plan, options.loop, theme, rawLeftWidth),
      right: fitWorkspaceColumn(options.pwd, options.branch, permission, theme, rawRightWidth),
    }
  }
  const available = Math.max(2, innerWidth - COLUMN_GAP)
  const leftWidth = Math.min(rawLeftWidth, Math.max(1, Math.floor(available * 0.45)))
  const rightWidth = Math.max(1, available - leftWidth)
  return {
    left: fitModelColumn(options.model, options.reasoningEffort, options.controls?.plan, options.loop, theme, leftWidth),
    right: fitWorkspaceColumn(options.pwd, options.branch, permission, theme, rightWidth),
  }
}

/**
 * Render the fixed footer: model/workspace metadata first, customizable
 * session telemetry second. Both rows use left/right columns and exact width.
 */
export function renderStatusFooter(options: StatusFooterOptions, theme: Theme): string[] {
  const normalized = resolveStatusBarConfig(options.config)
  const width = Math.max(0, options.width)
  if (width === 0) return []
  const innerWidth = Math.max(0, width - FOOTER_PADDING * 2)
  const metadata = metadataColumns(options, theme, innerWidth)
  const telemetryGroups = options.stats === undefined || !normalized.enabled
    ? { left: [], right: [] }
    : selectFooterGroups(buildStatusGroups(options.stats, normalized), innerWidth)
  return [
    renderSplitRow(metadata.left, metadata.right, width),
    renderSplitRow(paintColumn(telemetryGroups.left, theme), paintColumn(telemetryGroups.right, theme), width),
  ]
}

/**
 * Render the telemetry row without footer metadata. Used by the settings
 * preview and retained as a compatibility seam for direct render callers.
 */
export function renderSessionStatusLabel(
  stats: TuiSessionStats | undefined,
  config: StatusBarConfig,
  theme: Theme,
  width: number,
): string {
  const normalized = resolveStatusBarConfig(config)
  if (stats === undefined || !normalized.enabled || width <= LABEL_PADDING) return ''
  const groups = selectGroups(buildStatusGroups(stats, normalized), width)
  if (groups.length === 0) return ''
  const line = ' ' + paintColumn(groups, theme) + ' '
  return truncateToWidth(line, width)
}
