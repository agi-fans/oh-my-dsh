/**
 * Fixed two-line session footer rendered below the composer.
 *
 * The caller supplies one stable projection; this module owns copy,
 * responsive group selection, color hierarchy, and terminal layout. English
 * copy deliberately stays local until a runtime language module provides a
 * second locale — then this is the single seam where a dictionary is chosen.
 * @module @agi-fans/dsh-tui/status-line
 */

import type { TuiLoopStatus, TuiSessionControls, TuiSessionStats } from '../definition.ts'
import { formatAgentPreset, formatToolPresentation } from '../session/session-configuration.ts'
import {
  defaultStatusBarConfig,
  itemSide,
  resolveStatusBarConfig,
  type StatusBarConfig,
  type StatusColorToken,
  type StatusGroupId,
  type StatusItemId,
  type StatusMetaId,
} from './status-config.ts'
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
  /** Settings preview: underline the focused item. */
  focus?: StatusItemId
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

function tokenThemeColor(token: StatusColorToken | undefined, fallback: ThemeColor): ThemeColor {
  if (token === undefined || token === 'default') return fallback
  return token === 'label' ? 'customMessageLabel' : token
}

function itemColor(config: StatusBarConfig, id: StatusItemId, fallback: ThemeColor): ThemeColor {
  const direct = config.colors?.[id]
  if (direct !== undefined && direct !== 'default') return tokenThemeColor(direct, fallback)
  return fallback
}

function toneColor(tone: StatusTone, config: StatusBarConfig, group: StatusGroupId): ThemeColor {
  if (tone === 'positive') return 'success'
  if (tone === 'separator') return 'dim'
  if (tone === 'label') return 'muted'
  const custom = itemColor(config, group, 'text')
  if (config.colors?.[group] !== undefined && config.colors[group] !== 'default') return custom
  if (config.colors?.metrics !== undefined && config.colors.metrics !== 'default') return tokenThemeColor(config.colors.metrics, 'text')
  return tone === 'value' ? 'text' : 'customMessageLabel'
}

function paintGroup(group: StatusGroup, theme: Theme, config: StatusBarConfig, focus?: StatusItemId): string {
  const painted = group.parts.map(item => theme.fg(toneColor(item.tone, config, group.id), item.text)).join('')
  return focus === group.id ? theme.underline(painted) : painted
}

function paintColumn(
  groups: readonly StatusGroup[],
  theme: Theme,
  config: StatusBarConfig,
  focus?: StatusItemId,
): string {
  const separator = theme.fg('dim', GROUP_SEPARATOR)
  return groups.map(group => paintGroup(group, theme, config, focus)).join(separator)
}

function splitWidth(left: readonly StatusGroup[], right: readonly StatusGroup[]): number {
  const leftWidth = groupsWidth(left)
  const rightWidth = groupsWidth(right)
  return leftWidth + rightWidth + (leftWidth > 0 && rightWidth > 0 ? COLUMN_GAP : 0)
}

/** Select whole groups in user order, then place each on its configured column. */
function selectFooterGroups(
  groups: readonly StatusGroup[],
  width: number,
  config: StatusBarConfig,
): { left: StatusGroup[]; right: StatusGroup[] } {
  const left: StatusGroup[] = []
  const right: StatusGroup[] = []
  for (const group of groups) {
    const rightSide = itemSide(config, group.id) === 'right'
    const candidateLeft = rightSide ? left : [...left, group]
    const candidateRight = rightSide ? [...right, group] : right
    if (splitWidth(candidateLeft, candidateRight) > width) break
    if (rightSide) right.push(group)
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

function sessionConfigurationStatus(controls: TuiSessionControls | undefined): { text: string; tone: ThemeColor } | undefined {
  if (controls === undefined) return undefined
  const agent = formatAgentPreset(controls.agentPreset ?? 'standard').toUpperCase()
  const workflow = controls.plan?.pending === true
    ? controls.plan.active ? 'PLAN→DEFAULT' : 'PLAN…'
    : controls.plan?.active === true ? 'PLAN' : 'DEFAULT'
  const tools = formatToolPresentation(controls.tools ?? 'native').toUpperCase()
  return {
    text: `${agent} · ${workflow} · ${tools}`,
    tone: controls.plan?.pending === true ? 'warning' : 'accent',
  }
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

function gitTone(branch: string, config: StatusBarConfig): ThemeColor {
  const custom = config.colors?.git
  if (custom !== undefined && custom !== 'default') return tokenThemeColor(custom, 'muted')
  return /(?:^|\s)[*?]\d+/.test(branch) ? 'warning' : 'muted'
}

function visibleMetaIds(config: StatusBarConfig): StatusMetaId[] {
  const order = config.metaOrder ?? ['model', 'effort', 'path', 'git']
  const visible = new Set(config.meta ?? ['model', 'effort', 'path', 'git'])
  return order.filter(id => visible.has(id))
}

function buildMetaParts(
  options: Pick<StatusFooterOptions, 'model' | 'reasoningEffort' | 'pwd' | 'branch'>,
  config: StatusBarConfig,
): { id: StatusItemId; text: string; color: ThemeColor }[] {
  const parts: { id: StatusItemId; text: string; color: ThemeColor }[] = []
  for (const id of visibleMetaIds(config)) {
    if (id === 'model' && options.model !== '') {
      parts.push({ id, text: options.model, color: itemColor(config, 'model', 'text') })
    }
    if (id === 'effort' && options.reasoningEffort !== undefined && options.reasoningEffort !== '') {
      parts.push({ id, text: options.reasoningEffort, color: itemColor(config, 'effort', 'customMessageLabel') })
    }
    if (id === 'path' && options.pwd !== undefined && options.pwd !== '') {
      parts.push({ id, text: options.pwd, color: itemColor(config, 'path', 'muted') })
    }
    if (id === 'git' && options.branch !== undefined && options.branch !== '') {
      parts.push({ id, text: options.branch, color: gitTone(options.branch, config) })
    }
  }
  return parts
}

function permissionTone(permission: string): ThemeColor {
  if (permission === 'danger-full-access' || permission === 'custom') return 'error'
  if (permission === 'read-only') return 'accent'
  return 'success'
}

/** Human-facing permission preset used consistently across terminal surfaces. */
export function formatPermission(permission: string): string {
  if (permission === 'danger-full-access') return 'Full access'
  if (permission === 'workspace-write') return 'Workspace write'
  if (permission === 'read-only') return 'Read only'
  return permission === 'custom' ? 'Custom access' : permission
}

function permissionLabel(permission: string): string {
  const label = formatPermission(permission)
  return permission === 'danger-full-access' || permission === 'custom' ? label.toUpperCase() : label
}

/** Painted permission mode for the composer top-right cap. */
export function renderPermissionBadge(permission: string | undefined, theme: Theme): string {
  if (permission === undefined || permission === '') return ''
  return theme.fg(permissionTone(permission), permissionLabel(permission))
}

function splitMetaParts(
  options: Pick<StatusFooterOptions, 'model' | 'reasoningEffort' | 'pwd' | 'branch'>,
  config: StatusBarConfig,
): { left: ReturnType<typeof buildMetaParts>; right: ReturnType<typeof buildMetaParts> } {
  const left: ReturnType<typeof buildMetaParts> = []
  const right: ReturnType<typeof buildMetaParts> = []
  for (const part of buildMetaParts(options, config)) {
    if (itemSide(config, part.id) === 'right') right.push(part)
    else left.push(part)
  }
  return { left, right }
}

function metadataColumns(
  options: StatusFooterOptions,
  theme: Theme,
  innerWidth: number,
  config: StatusBarConfig,
  focus?: StatusItemId,
): { left: string; right: string } {
  const separator = ' · '
  const statuses = [sessionConfigurationStatus(options.controls), loopStatus(options.loop)].filter(
    (status): status is { text: string; tone: ThemeColor } => status !== undefined,
  )
  const columns = splitMetaParts(options, config)
  const statusWidth = statuses.reduce((total, status) => total + visibleWidth(status.text), 0)
    + Math.max(0, statuses.length - 1) * visibleWidth(separator)
  const rightNatural = columns.right.reduce((total, part) => total + visibleWidth(part.text), 0)
    + Math.max(0, columns.right.length - 1) * visibleWidth(separator)
  const leftNatural = columns.left.reduce((total, part) => total + visibleWidth(part.text), 0)
    + Math.max(0, columns.left.length - 1) * visibleWidth(separator)
    + (statusWidth === 0 ? 0 : visibleWidth(separator) + statusWidth)
  const gap = leftNatural > 0 && rightNatural > 0 ? COLUMN_GAP : 0
  let leftWidth = leftNatural
  let rightWidth = rightNatural
  if (leftWidth + gap + rightWidth > innerWidth) {
    const available = Math.max(2, innerWidth - gap)
    leftWidth = Math.min(leftNatural, Math.max(1, Math.floor(available * 0.45)))
    rightWidth = Math.max(1, available - leftWidth)
  }
  const statusPainted = statuses.map((status, index) =>
    (index === 0 ? '' : theme.fg('dim', separator)) + theme.fg(status.tone, status.text)).join('')
  const metaLeft = packPreviewParts(columns.left, theme, Math.max(1, leftWidth - (statusWidth === 0 ? 0 : visibleWidth(separator) + statusWidth)), focus)
  const left = metaLeft === ''
    ? statusPainted
    : statusPainted === '' ? metaLeft : metaLeft + theme.fg('dim', separator) + statusPainted
  const right = packPreviewParts(columns.right, theme, rightWidth, focus)
  return { left, right }
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
  const metadata = metadataColumns({ ...options, config: normalized }, theme, innerWidth, normalized, options.focus)
  const telemetryGroups = options.stats === undefined || !normalized.enabled
    ? { left: [], right: [] }
    : selectFooterGroups(buildStatusGroups(options.stats, normalized), innerWidth, normalized)
  return [
    renderSplitRow(metadata.left, metadata.right, width),
    renderSplitRow(
      paintColumn(telemetryGroups.left, theme, normalized, options.focus),
      paintColumn(telemetryGroups.right, theme, normalized, options.focus),
      width,
    ),
  ]
}

function packPreviewParts(
  parts: readonly { text: string; color: ThemeColor; id?: StatusItemId }[],
  theme: Theme,
  width: number,
  focus?: StatusItemId,
): string {
  if (width <= 0) return ''
  const separator = ' · '
  const separatorWidth = visibleWidth(separator)
  let used = 0
  let out = ''
  for (const part of parts) {
    if (part.text === '') continue
    const prefix = out === '' ? 0 : separatorWidth
    const textWidth = visibleWidth(part.text)
    const paint = (text: string): string => {
      const colored = theme.fg(part.color, text)
      return focus !== undefined && part.id === focus ? theme.underline(colored) : colored
    }
    if (used + prefix + textWidth <= width) {
      if (out !== '') out += theme.fg('dim', separator)
      out += paint(part.text)
      used += prefix + textWidth
      continue
    }
    const remaining = width - used - prefix
    if (remaining <= 0) break
    if (out !== '') out += theme.fg('dim', separator)
    out += paint(truncateToWidth(part.text, remaining))
    break
  }
  return out
}

/**
 * Status sample for `/settings`. Uses the same left/right footer layout as
 * the live two-line status bar.
 */
export function renderStatusPreviewLines(
  options: {
    model: string
    reasoningEffort?: string
    pwd?: string
    branch?: string
    stats?: TuiSessionStats
    config: StatusBarConfig
    width: number
    focus?: StatusItemId
  },
  theme: Theme,
): string[] {
  const normalized = resolveStatusBarConfig(options.config)
  const width = Math.max(0, options.width)
  if (width === 0) return []
  return renderStatusFooter({
    model: options.model,
    ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
    ...(options.pwd === undefined ? {} : { pwd: options.pwd }),
    ...(options.branch === undefined ? {} : { branch: options.branch }),
    ...(options.stats === undefined ? {} : { stats: options.stats }),
    config: normalized,
    width,
    ...(options.focus === undefined ? {} : { focus: options.focus }),
  }, theme).map(line => line.trim())
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
  const line = ' ' + paintColumn(groups, theme, normalized) + ' '
  return truncateToWidth(line, width)
}
