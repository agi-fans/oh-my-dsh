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
import { formatAgentPreset } from '../session/session-configuration.ts'
import {
  isResolvedStatusBarConfig,
  resolveStatusBarConfig,
  STATUS_ROWS,
  statusGroupRow,
  statusGroupSide,
  type ResolvedStatusBarConfig,
  type StatusBarInput,
  type StatusGroupId,
  type StatusItemId,
  type StatusMetaId,
} from './status-config.ts'
import type { Theme, ThemeColor } from './theme.ts'
import { padToWidth, truncateToWidth, visibleWidth } from './width.ts'

type StatusTone = 'label' | 'value' | 'positive' | 'warning' | 'error' | 'token' | 'separator'

interface StatusPart {
  text: string
  tone: StatusTone
}

interface StatusGroup {
  id: StatusGroupId
  parts: StatusPart[]
}

const GROUP_SEPARATOR = ' • '
const FOOTER_PADDING = 2
const COLUMN_GAP = 3
/**
 * Fewest cells a clipped metadata item may keep. The ellipsis costs one cell,
 * so 8 cells leave a seven-character prefix such as `deepseek…` or `~/Works…`
 * that still identifies the item; a shorter fragment is a lone initial whose
 * only content is the ellipsis announcing that content is missing.
 */
const MIN_CLIPPED_CELLS = 8
/** Context needed to render the fixed session footer. */
export interface StatusFooterOptions {
  model: string
  reasoningEffort?: string
  /** Folded session title, shown only when the `session` meta item is enabled. */
  sessionTitle?: string
  controls?: TuiSessionControls
  loop?: TuiLoopStatus
  pwd?: string
  branch?: string
  stats?: TuiSessionStats
  /** A resolved layout, or the stored document it resolves from. */
  config: ResolvedStatusBarConfig | StatusBarInput
  width: number
  /** Settings preview: underline the focused item. */
  focus?: StatusItemId
}

/** Compact token count: 517 / 12.2K / 517K / 1.2M. */
export function formatTokens(value: number): string {
  const scaled = (n: number): string => n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10)
  if (value < 1_000) return String(value)
  // Rounding at the printed precision can reach the next unit: 999_500 must
  // read `1M` instead of `1000K`, so the rounded thousands decide the scale.
  if (value < 1_000_000 && Math.round(value / 1_000) < 1_000) return `${scaled(value / 1_000)}K`
  return `${scaled(value / 1_000_000)}M`
}

/** Compact duration: 45.2s under a minute, 2m42s under an hour, 1h1m above. */
export function formatDuration(ms: number): string {
  const seconds = ms / 1_000
  // A single rounding at the printed precision keeps a value just under a unit
  // boundary from reading as `60s`, `60m0s`, or an empty unit.
  const tenths = Math.round(seconds * 10)
  if (tenths < 600) return `${tenths / 10}s`
  const whole = Math.round(seconds)
  const minutes = Math.floor(whole / 60)
  const restSeconds = whole % 60
  if (minutes < 60) return restSeconds === 0 ? `${minutes}m` : `${minutes}m${restSeconds}s`
  const restMinutes = minutes % 60
  return restMinutes === 0 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h${restMinutes}m`
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

function contextPressureTone(tokens: number, window: number): StatusTone {
  const ratio = window <= 0 ? 0 : Math.max(0, tokens / window)
  if (ratio >= 0.9) return 'error'
  if (ratio >= 0.75) return 'warning'
  return 'token'
}

function part(text: string, tone: StatusTone): StatusPart {
  return { text, tone }
}

function metric(label: string, value: string, tone: StatusTone = 'value'): StatusPart[] {
  return [part(label + ' ', 'label'), part(value, tone)]
}

/** English semantic groups; language selection will replace copy here. */
function buildStatusGroups(stats: TuiSessionStats, config: ResolvedStatusBarConfig): StatusGroup[] {
  const groups: StatusGroup[] = []
  if (stats.contextWindow !== undefined && stats.contextWindow > 0) {
    const used = stats.contextTokens ?? 0
    const pressureTone = contextPressureTone(used, stats.contextWindow)
    const contextValue = `${formatContextPercent(used, stats.contextWindow)}%`
    const tokenValue = `${formatTokens(used)}/${formatTokens(stats.contextWindow)}`
    const filled = Math.max(0, Math.min(10, Math.round(used / stats.contextWindow * 10)))
    const style = config.contextStyle ?? 'percent'
    const value = style === 'bar' ? '━'.repeat(filled) + '─'.repeat(10 - filled)
      : style === 'tokens' ? tokenValue : contextValue
    groups.push({
      id: 'context',
      parts: [
        ...metric(config.labels === 'compact' ? 'Ctx' : 'Context', value, pressureTone),
        ...(style === 'detailed' ? [part(' · ', 'separator'), part(tokenValue, pressureTone)] : []),
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

function groupsWidth(groups: readonly StatusGroup[]): number {
  if (groups.length === 0) return 0
  return groups.reduce((total, group) => total + visibleWidth(groupText(group)), 0)
    + GROUP_SEPARATOR.length * (groups.length - 1)
}

/**
 * The tone a part is painted with.
 *
 * There is no per-item colour any more. Both shipped palettes already paint each
 * part the right way — a dirty branch stays `warning`, the effort stays
 * `customMessageLabel`, a group value stays `text` — and offering eight theme
 * tokens per row let a reader paint a footer that no longer said anything.
 */
function toneColor(tone: StatusTone): ThemeColor {
  if (tone === 'positive') return 'success'
  if (tone === 'warning') return 'warning'
  if (tone === 'error') return 'error'
  if (tone === 'separator') return 'dim'
  if (tone === 'label') return 'muted'
  return tone === 'value' ? 'text' : 'customMessageLabel'
}

function paintGroup(group: StatusGroup, theme: Theme, focus?: StatusItemId): string {
  const painted = group.parts.map(item => theme.fg(toneColor(item.tone), item.text)).join('')
  return focus === group.id ? theme.underline(painted) : painted
}

function paintColumn(groups: readonly StatusGroup[], theme: Theme, focus?: StatusItemId): string {
  const separator = theme.fg('dim', GROUP_SEPARATOR)
  return groups.map(group => paintGroup(group, theme, focus)).join(separator)
}

function splitWidth(left: readonly StatusGroup[], right: readonly StatusGroup[]): number {
  const leftWidth = groupsWidth(left)
  const rightWidth = groupsWidth(right)
  return leftWidth + rightWidth + (leftWidth > 0 && rightWidth > 0 ? COLUMN_GAP : 0)
}

/**
 * Fit one telemetry row, occupancy on the left and cost on the right.
 *
 * A group's side is fixed by what it says, not by the order it arrived in:
 * context and cache describe how full the window is and read as one figure, and
 * everything else is what the session has spent getting here. Placing them by
 * side keeps the two halves comparable row to row, which is what the row is for.
 *
 * The list already arrives in priority order, so fitting drops from the end: the
 * reader loses turn counts before durations, and durations before latency. That
 * is the same priority `AGENTS.md` states, and it means the visible set is always
 * a prefix — nothing reappears out of order as the terminal grows.
 */
function selectFooterGroups(
  groups: readonly StatusGroup[],
  /** Cells available inside the footer's horizontal inset, not the row width. */
  innerWidth: number,
): { left: StatusGroup[]; right: StatusGroup[] } {
  const split = (visible: readonly StatusGroup[]): { left: StatusGroup[]; right: StatusGroup[] } => ({
    left: visible.filter(group => statusGroupSide(group.id) === 'left'),
    right: visible.filter(group => statusGroupSide(group.id) === 'right'),
  })
  let visible = [...groups]
  while (visible.length > 0) {
    const { left, right } = split(visible)
    if (splitWidth(left, right) <= innerWidth) return { left, right }
    visible = visible.slice(0, -1)
  }
  return { left: [], right: [] }
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
  const agent = formatAgentPreset(controls.agentPreset ?? 'standard').toLowerCase()
  const parts = [agent]
  if (controls.plan?.pending === true) parts.push(controls.plan.active ? 'plan off…' : 'plan…')
  else if (controls.plan?.active === true) parts.push('plan')
  return {
    text: parts.join(' · '),
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

function gitTone(branch: string): ThemeColor {
  // A dirty worktree is the one thing on the first line that needs attention, so
  // it keeps `warning` whatever else has been reconfigured.
  return /(?:^|\s)[*?]\d+/.test(branch) ? 'warning' : 'muted'
}

/** Visible first-line pieces, always in catalog order. */
function visibleMetaIds(config: ResolvedStatusBarConfig): StatusMetaId[] {
  return config.meta
}

function buildMetaParts(
  options: Pick<StatusFooterOptions, 'model' | 'reasoningEffort' | 'pwd' | 'branch' | 'sessionTitle'>,
  config: ResolvedStatusBarConfig,
): { id: StatusItemId; text: string; color: ThemeColor }[] {
  const parts: { id: StatusItemId; text: string; color: ThemeColor }[] = []
  for (const id of visibleMetaIds(config)) {
    if (id === 'model' && options.model !== '') parts.push({ id, text: options.model, color: 'text' })
    if (id === 'effort' && options.reasoningEffort !== undefined && options.reasoningEffort !== '') {
      parts.push({ id, text: options.reasoningEffort, color: 'customMessageLabel' })
    }
    if (id === 'session' && options.sessionTitle !== undefined && options.sessionTitle !== '') {
      parts.push({ id, text: options.sessionTitle, color: 'customMessageLabel' })
    }
    if (id === 'path' && options.pwd !== undefined && options.pwd !== '') parts.push({ id, text: options.pwd, color: 'muted' })
    if (id === 'git' && options.branch !== undefined && options.branch !== '') {
      parts.push({ id, text: options.branch, color: gitTone(options.branch) })
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
  return formatPermission(permission).toLowerCase()
}

/** Painted permission mode for the composer top-right cap. */
export function renderPermissionBadge(permission: string | undefined, theme: Theme): string {
  if (permission === undefined || permission === '') return ''
  return theme.fg(permissionTone(permission), permissionLabel(permission))
}

/**
 * Split the first line into its two columns.
 *
 * The split is positional, not configured: identity stays with the left column
 * (which model, which effort, which session) and place stays on the right (where
 * the work is, on which branch). That is what the columns meant before a reader
 * could drag items between them, and it is what keeps the line readable at a
 * glance — a path on the left and a model on the right reads as noise.
 */
const LEFT_META: readonly StatusItemId[] = ['model', 'effort', 'session']
const RIGHT_META: readonly StatusItemId[] = ['path', 'git']

function splitMetaParts(
  options: Pick<StatusFooterOptions, 'model' | 'reasoningEffort' | 'pwd' | 'branch' | 'sessionTitle'>,
  config: ResolvedStatusBarConfig,
): { left: ReturnType<typeof buildMetaParts>; right: ReturnType<typeof buildMetaParts> } {
  const left: ReturnType<typeof buildMetaParts> = []
  const right: ReturnType<typeof buildMetaParts> = []
  for (const part of buildMetaParts(options, config)) {
    if (RIGHT_META.includes(part.id)) right.push(part)
    else if (LEFT_META.includes(part.id)) left.push(part)
  }
  return { left, right }
}

function metadataColumns(
  options: StatusFooterOptions,
  theme: Theme,
  innerWidth: number,
  config: ResolvedStatusBarConfig,
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
  const normalized = isResolvedStatusBarConfig(options.config) ? options.config : resolveStatusBarConfig(options.config)
  const width = Math.max(0, options.width)
  if (width === 0) return []
  const innerWidth = Math.max(0, width - FOOTER_PADDING * 2)
  const metadata = metadataColumns({ ...options, config: normalized }, theme, innerWidth, normalized, options.focus)
  /*
   * Three states, three row counts. Telemetry turned off reclaims its row, which
   * is the point of turning it off. A session that has not projected stats yet —
   * or a terminal too narrow for one complete group — keeps an empty row, so the
   * footer is two lines from the first frame and the composer does not step up
   * when the first numbers arrive.
   */
  const telemetryRows = !normalized.enabled
    ? []
    : options.stats === undefined
      ? [{ left: [], right: [] }]
      : selectFooterRows(buildStatusGroups(options.stats, normalized), innerWidth)
  return [
    renderSplitRow(metadata.left, metadata.right, width),
    // One row per telemetry row that has something to say. `standard` fills the
    // first and stops, so its footer is two lines; `verbose` fills both.
    ...(telemetryRows.length === 0 && normalized.enabled ? [{ left: [], right: [] }] : telemetryRows).map(row => renderSplitRow(
      paintColumn(row.left, theme, options.focus),
      paintColumn(row.right, theme, options.focus),
      width,
    )),
  ]
}

/**
 * Which rows the telemetry needs, each fitted on its own width.
 *
 * A row only competes with the row it shares, which is what lets the widest
 * density state everything instead of dropping from one long line. Priority is
 * still global: once a group does not fit, every group after it is gone too, so a
 * narrow terminal cannot show the session's duration while the turn's own latency
 * is missing above it.
 */
function selectFooterRows(
  groups: readonly StatusGroup[],
  innerWidth: number,
): { left: StatusGroup[]; right: StatusGroup[] }[] {
  const bucket = STATUS_ROWS.map(() => [] as StatusGroup[])
  for (const group of groups) bucket[statusGroupRow(group.id)]?.push(group)
  const rows: { left: StatusGroup[]; right: StatusGroup[] }[] = []
  for (const row of bucket) {
    if (row.length === 0) continue
    const fitted = selectFooterGroups(row, innerWidth)
    if (fitted.left.length > 0 || fitted.right.length > 0) rows.push(fitted)
    if (fitted.left.length + fitted.right.length < row.length) break
  }
  return rows
}

/**
 * Pack metadata items into one column. Every item is painted whole or dropped
 * as a unit: a clip shorter than `MIN_CLIPPED_CELLS` says nothing about the
 * value it replaces, so the leftover columns stay padding instead.
 */
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
    if (remaining < MIN_CLIPPED_CELLS) break
    if (out !== '') out += theme.fg('dim', separator)
    out += paint(truncateToWidth(part.text, remaining))
    break
  }
  return out
}
