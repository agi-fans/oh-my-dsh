/**
 * Slash-command autocomplete: OMP-style leading-`/` matching, ranking, and
 * completion apply. Pure — the provider owns popup selection and execution.
 * @module @agi-fans/dsh-tui
 */

import type { Theme } from '../chrome/theme.ts'
import { truncateToWidth } from '../chrome/width.ts'
import { subsequencePenalty } from '../input/fuzzy-search.ts'
import {
  listPrimaryColumnWidth,
  listVisibleRange,
  renderListCounter,
  renderListRow,
  renderListRowWithValue,
  type ListRow,
} from './list-view.ts'

/** One argument token a slash command can complete. */
export interface SlashArgument {
  value: string
  aliases?: readonly string[]
  description: string
}

/** One slash command the editor can complete and the TUI can run. */
export interface SlashCommand {
  name: string
  aliases?: readonly string[]
  description: string
  arguments?: readonly SlashArgument[]
  /** Free-form argument usage contributed by a runtime command plugin. */
  inputHint?: string
  /**
   * Live candidates for this command's argument.
   *
   * Static `arguments` describe a fixed vocabulary; this reports one that lives
   * in runtime state — the models on offer, the sessions that exist — so the
   * reader completes the line instead of opening a picker to choose from it.
   */
  complete?: (prefix: string) => readonly { value: string; description?: string }[]
}

/** One ranked suggestion shown in the popup. */
export interface AutocompleteItem {
  value: string
  label: string
  description?: string
  /** Argument, path, and session rows paint without a leading `/`. */
  kind?: 'command' | 'argument' | 'path' | 'session' | 'heading'
}

const HELP_ARGUMENTS: readonly SlashArgument[] = [
  { value: 'full', description: 'Include every keyboard shortcut' },
]

/** Built-in session-surface commands (no extra backend required). */
export const BUILTIN_SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'help', aliases: ['h', '?'], description: 'Show commands and essential shortcuts', arguments: HELP_ARGUMENTS },
  { name: 'settings', aliases: ['set'], description: 'Open settings' },
  { name: 'copy', description: 'Copy the last reply, a code block, a command, or tool output' },
  { name: 'tools', description: 'Show tools visible to the agent' },
  { name: 'clear', description: 'Clear the transcript display' },
  { name: 'quit', aliases: ['q', 'exit'], description: 'Quit the application' },
]

// Task groups affect discovery only; command registration stays in Harness.
export const COMMAND_GROUPS: readonly { label: string; names: readonly string[] }[] = [
  { label: 'Session', names: ['new', 'resume', 'retry', 'clear'] },
  { label: 'Model and access', names: ['model', 'plan', 'permission', 'agent', 'login', 'logout'] },
  { label: 'Files and output', names: ['diff', 'attach', 'copy', 'export'] },
  { label: 'Tasks', names: ['queue', 'btw', 'questions', 'jobs', 'goal', 'compact', 'schedule'] },
  { label: 'Settings and integrations', names: ['settings', 'mcp', 'plugins'] },
  { label: 'Diagnostics', names: ['session', 'context', 'trajectory', 'tools', 'changelog'] },
  { label: 'Application', names: ['help', 'quit'] },
]
const COMMON_COMMANDS = ['model', 'plan', 'permission', 'resume', 'diff', 'settings', 'new', 'help']

/** Visible popup rows (OMP editor default). */
export const AUTOCOMPLETE_MAX_VISIBLE = 5

/** Index of the `/` that opens a leading slash command, or null. */
export function findLeadingSlashCommandStart(text: string): number | null {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('/')) return null
  return text.length - trimmed.length
}

/**
 * Source range of a leading `/name` token, matching {@link parseSlashInput}.
 * Null for prose, multiline input, or an absolute-path lookalike (`/tmp/foo`).
 */
export function leadingSlashCommandNameRange(text: string): { start: number; end: number } | null {
  if (text.includes('\n')) return null
  const start = findLeadingSlashCommandStart(text)
  if (start === null) return null
  const token = text.slice(start)
  if (token.slice(1).includes('/')) return null
  const body = token.slice(1)
  if (body.startsWith('skill:')) {
    const space = body.search(/\s/u)
    return { start, end: start + 1 + (space === -1 ? body.length : space) }
  }
  const sep = body.search(/[\s:]/u)
  return { start, end: start + 1 + (sep === -1 ? body.length : sep) }
}

/** Subsequence match (`wig` hits `skill:wig`). */
export function fuzzyMatch(query: string, target: string): boolean {
  return subsequencePenalty(query, target) !== undefined
}

/**
 * Rank a fuzzy hit. Exact > starts-with > contains > tight subsequence.
 */
export function fuzzyScore(query: string, target: string): number {
  if (query.length === 0) return 1
  if (target === query) return 100
  if (target.startsWith(query)) return 80
  if (target.includes(query)) return 60
  const penalty = subsequencePenalty(query, target)
  return penalty === undefined ? 0 : Math.max(1, 40 - penalty)
}

/**
 * Score a typed prefix against a command name or alias. Prefix matches share
 * one flat rank so registry order is preserved (OMP `/set` vs `/settings`).
 */
export function scoreCommandTextMatch(lowerPrefix: string, lowerTarget: string): number {
  if (lowerPrefix.length === 0) return 1
  if (lowerPrefix === lowerTarget) return 1000
  if (lowerTarget.startsWith(lowerPrefix)) return 900
  return fuzzyScore(lowerPrefix, lowerTarget)
}

function namesOf(value: string, aliases?: readonly string[]): string[] {
  return [value, ...(aliases ?? [])]
}

interface NamedMatch {
  value: string
  aliases?: readonly string[]
  description: string
}

function buildNamedCompletions(
  entries: readonly NamedMatch[],
  lowerPrefix: string,
  kind: 'command' | 'argument',
): AutocompleteItem[] {
  if (kind === 'argument' && lowerPrefix.includes(' ')) return []
  return entries
    .flatMap((entry) => {
      let best: (AutocompleteItem & { score: number }) | undefined
      for (const name of namesOf(entry.value, entry.aliases)) {
        const score = scoreCommandTextMatch(lowerPrefix, name.toLowerCase())
        if (score === 0) continue
        if (best !== undefined && score <= best.score) continue
        const item: AutocompleteItem & { score: number } = {
          value: entry.value,
          label: name,
          kind,
          score,
        }
        if (entry.description !== '') item.description = entry.description
        best = item
      }
      if (kind === 'command' && lowerPrefix.length >= 3 && best === undefined && entry.description.toLowerCase().includes(lowerPrefix)) {
        best = { value: entry.value, label: entry.value, kind, score: 50, description: entry.description }
      }
      return best === undefined ? [] : [best]
    })
    .sort((a, b) => b.score - a.score)
    .map(({ score: _score, ...rest }) => rest)
}

/** Ranked command-name completions for a prefix (no leading slash). */
export function buildSlashCommandCompletions(
  commands: readonly SlashCommand[],
  lowerPrefix: string,
): AutocompleteItem[] {
  return buildNamedCompletions(
    (lowerPrefix === '' ? [...commands].sort((a, b) => {
      const rank = (name: string): number => { const i = COMMON_COMMANDS.indexOf(name); return i < 0 ? COMMON_COMMANDS.length : i }
      return rank(a.name) - rank(b.name)
    }) : commands).map((command) => ({
      value: command.name,
      ...(command.aliases === undefined ? {} : { aliases: command.aliases }),
      description: command.description,
    })),
    lowerPrefix,
    'command',
  )
}

/** Ranked argument completions for the token after `/name `. */
export function buildSlashArgumentCompletions(
  args: readonly SlashArgument[],
  lowerPrefix: string,
): AutocompleteItem[] {
  return buildNamedCompletions(args, lowerPrefix, 'argument')
}

function argumentHint(command: SlashCommand): string {
  if (command.inputHint !== undefined && command.inputHint !== '') return ' ' + command.inputHint
  const args = command.arguments
  if (args === undefined || args.length === 0) return ''
  return ' [' + args.map((arg) => arg.value).join('|') + ']'
}

/** Dim ghost text after the caret for `/name ` argument state. */
export function slashInlineHint(
  text: string,
  cursor: number,
  commands: readonly SlashCommand[] = BUILTIN_SLASH_COMMANDS,
): string | null {
  if (cursor !== text.length || text.includes('\n')) return null
  const start = findLeadingSlashCommandStart(text)
  if (start === null) return null
  const token = text.slice(start)
  if (token.slice(1).includes('/')) return null
  const space = token.indexOf(' ')
  if (space === -1) return null
  const command = resolveSlashCommand(token.slice(1, space), commands)
  const args = command?.arguments
  if (args === undefined || args.length === 0) return null
  const prefix = token.slice(space + 1)
  if (prefix.includes(' ')) return null
  if (prefix === '') return args.map((arg) => arg.value).join('|')
  const lower = prefix.toLowerCase()
  for (const arg of args) {
    for (const name of [arg.value, ...(arg.aliases ?? [])]) {
      if (!name.toLowerCase().startsWith(lower)) continue
      const remaining = name.slice(prefix.length)
      return remaining === '' ? null : remaining
    }
  }
  return null
}

/** Suggestions for the live buffer, or null when the cursor is not in a command token. */
export function slashSuggestions(
  text: string,
  cursor: number,
  commands: readonly SlashCommand[] = BUILTIN_SLASH_COMMANDS,
): { items: AutocompleteItem[]; prefix: string } | null {
  const before = text.slice(0, cursor)
  if (text.includes('\n')) return null
  const start = findLeadingSlashCommandStart(before)
  if (start === null) return null
  const token = before.slice(start)
  if (token.slice(1).includes('/')) return null
  const space = token.indexOf(' ')
  if (space === -1) {
    const items = buildSlashCommandCompletions(commands, token.slice(1).toLowerCase())
    if (items.length === 0) return null
    return { items, prefix: before }
  }
  const command = resolveSlashCommand(token.slice(1, space), commands)
  const prefix = token.slice(space + 1)
  const lower = prefix.toLowerCase()
  // A live vocabulary wins over a static one: the static list says what the
  // argument means, the live one says what it can be right now.
  if (command?.complete !== undefined) {
    const items: AutocompleteItem[] = []
    for (const option of command.complete(prefix)) {
      if (!fuzzyMatch(lower, option.value.toLowerCase())) continue
      items.push({
        value: option.value,
        label: option.value,
        ...(option.description === undefined ? {} : { description: option.description }),
        kind: 'argument',
      })
    }
    return items.length === 0 ? null : { items, prefix: before }
  }
  const args = command?.arguments
  if (args === undefined || args.length === 0) return null
  const items = buildSlashArgumentCompletions(args, lower)
  if (items.length === 0) return null
  return { items, prefix: before }
}

/** Replace the live command or argument token with the selected completion. */
export function applySlashCompletion(
  text: string,
  cursor: number,
  item: AutocompleteItem,
): { text: string; cursor: number } {
  const before = text.slice(0, cursor)
  const after = text.slice(cursor)
  const start = findLeadingSlashCommandStart(before)
  if (start === null) return { text, cursor }
  if (item.kind === 'argument') {
    const space = before.slice(start).lastIndexOf(' ')
    if (space === -1) return { text, cursor }
    const argStart = start + space + 1
    const insert = item.value.endsWith(' ') ? item.value : item.value + ' '
    return { text: text.slice(0, argStart) + insert + after, cursor: argStart + insert.length }
  }
  const insert = `/${item.value} `
  return { text: text.slice(0, start) + insert + after, cursor: start + insert.length }
}

/** Parse a submitted line as `/name args`. Null when the line is not a slash command. */
export function parseSlashInput(text: string): { name: string; args: string } | null {
  if (text.includes('\n')) return null
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const body = trimmed.slice(1)
  if (body === '') return { name: '', args: '' }
  if (body.startsWith('skill:')) {
    const space = body.search(/\s/u)
    if (space === -1) return { name: body, args: '' }
    return { name: body.slice(0, space), args: body.slice(space + 1).trim() }
  }
  const sep = body.search(/[\s:]/)
  if (sep === -1) return { name: body, args: '' }
  return { name: body.slice(0, sep), args: body.slice(sep + 1).trim() }
}

/** Resolve a typed name or alias to a catalog entry. */
export function resolveSlashCommand(
  name: string,
  commands: readonly SlashCommand[] = BUILTIN_SLASH_COMMANDS,
): SlashCommand | undefined {
  const lower = name.toLowerCase()
  return commands.find((command) => command.name === lower || (command.aliases ?? []).includes(lower))
}

function helpCell(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function helpRows(commands: readonly SlashCommand[]): string[] {
  if (commands.length === 0) return []
  return commands.map((command) => {
    const names = [command.name, ...(command.aliases ?? [])]
      .map((name, index) => `\`${helpCell(`/${name}${index === 0 ? argumentHint(command) : ''}`)}\``)
      .join(', ')
    return `- ${names} — ${helpCell(command.description)}`
  })
}

/** Grouped Markdown command directory rendered by the command-output surface. */
export function formatHelpText(
  commands: readonly SlashCommand[] = BUILTIN_SLASH_COMMANDS,
): string {
  const skills = commands.filter(command => command.name.startsWith('skill:'))
  const core = commands.filter(command => !command.name.startsWith('skill:'))
  const lines = [`Commands · ${core.length} core${skills.length === 0 ? '' : ` · ${skills.length} skills`}`]
  const assigned = new Set(COMMAND_GROUPS.flatMap(group => group.names))
  const groups = [...COMMAND_GROUPS.map(group => ({ label: group.label, commands: core.filter(command => group.names.includes(command.name)) })),
    { label: 'Extensions', commands: core.filter(command => !assigned.has(command.name)) }]
  for (const group of groups) {
    if (group.commands.length > 0) lines.push('', `**${group.label} · ${group.commands.length}**`, ...helpRows(group.commands))
  }
  if (skills.length > 0) {
    lines.push(
      '',
      `**Skills · ${skills.length}**`,
      '',
      'Type `/skill:` to browse and filter skills with descriptions.',
    )
  }
  return lines.join('\n')
}

/** Visible item-index window around `selected` (counter row is not included). */
export function autocompleteVisibleRange(
  count: number,
  selected: number,
): { start: number; end: number } {
  return listVisibleRange(count, selected, AUTOCOMPLETE_MAX_VISIBLE)
}

/**
 * Popup rows: cursor + name + description, windowed around the selection.
 *
 * Drawn through the shared list row so the cursor cell, the description gap and
 * the `(n/total)` footnote are the same ones every other list in the TUI uses.
 */
export function renderAutocomplete(
  items: readonly AutocompleteItem[],
  selected: number,
  theme: Theme,
  width: number,
): string[] {
  if (items.length === 0 || width <= 0) return []
  const index = Math.max(0, Math.min(selected, items.length - 1))
  const { start, end } = autocompleteVisibleRange(items.length, index)
  const lines: string[] = []
  const primaryWidth = listPrimaryColumnWidth(
    items.flatMap(item => item.kind === 'heading' ? [] : [{ label: autocompleteLabel(item) }]),
    width,
  )
  for (let at = start; at < end; at += 1) {
    const item = items[at]
    if (item === undefined) continue
    if (item.kind === 'heading') {
      lines.push(renderListRow({ label: item.label, heading: true }, theme, width, { selected: false }))
      continue
    }
    const bare = item.kind === 'argument' || item.kind === 'path' || item.kind === 'session'
    const row: ListRow = {
      label: autocompleteLabel(item),
      ...(bare ? {} : { tone: 'accent' as const }),
      ...(item.description === undefined || item.description === '' ? {} : { description: item.description }),
    }
    lines.push(renderListRowWithValue(row, theme, width, primaryWidth, { selected: at === index }))
  }
  const pathMode = items.some(item => item.kind === 'path' || item.kind === 'session')
  if (pathMode) {
    const position = items.length > 1 ? `${index + 1}/${items.length} · ` : ''
    lines.push(theme.fg('dim', truncateToWidth(
      `  ${position}↑↓ select · Tab insert · Enter send · Esc close`,
      width,
    )))
  } else if (items.length > AUTOCOMPLETE_MAX_VISIBLE) {
    lines.push(renderListCounter(theme, index, items.length, width))
  }
  return lines
}

/** A completion's primary column: paths and arguments keep their bare text. */
function autocompleteLabel(item: AutocompleteItem): string {
  return item.kind === 'argument' || item.kind === 'path' || item.kind === 'session' ? item.label : '/' + item.label
}
