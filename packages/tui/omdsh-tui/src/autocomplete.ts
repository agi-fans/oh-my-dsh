/**
 * Slash-command autocomplete: OMP-style leading-`/` matching, ranking, and
 * completion apply. Pure — the provider owns popup selection and execution.
 * @module @omdsh/tui
 */

import { SYMBOL, type Theme } from './theme.ts'
import { truncateToWidth } from './width.ts'

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
}

/** One ranked suggestion shown in the popup. */
export interface AutocompleteItem {
  value: string
  label: string
  description?: string
  /** Argument and path rows paint without a leading `/`. */
  kind?: 'command' | 'argument' | 'path'
}

const COPY_ARGUMENTS: readonly SlashArgument[] = [
  { value: 'text', description: 'Last assistant reply' },
  { value: 'code', description: 'Last fenced code block' },
  { value: 'cmd', aliases: ['command'], description: 'Last bash command' },
]

/** Built-in session-surface commands (no extra backend required). */
export const BUILTIN_SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'help', aliases: ['h', '?'], description: 'Show available slash commands' },
  { name: 'settings', aliases: ['set'], description: 'Open settings' },
  { name: 'hotkeys', description: 'Show keyboard shortcuts' },
  { name: 'copy', description: 'Pick text, code, or a command to copy', arguments: COPY_ARGUMENTS },
  { name: 'tools', description: 'Show tools visible to the agent' },
  { name: 'pwd', aliases: ['dirs'], description: 'Show working directory and model' },
  { name: 'clear', description: 'Clear the transcript display' },
  { name: 'quit', aliases: ['q', 'exit'], description: 'Quit the application' },
]

/** Visible popup rows (OMP editor default). */
export const AUTOCOMPLETE_MAX_VISIBLE = 5

/** Index of the `/` that opens a leading slash command, or null. */
export function findLeadingSlashCommandStart(text: string): number | null {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('/')) return null
  return text.length - trimmed.length
}

/** Subsequence match (`wig` hits `skill:wig`). */
export function fuzzyMatch(query: string, target: string): boolean {
  if (query.length === 0) return true
  if (query.length > target.length) return false
  let qi = 0
  for (let ti = 0; ti < target.length && qi < query.length; ti += 1) {
    if (query[qi] === target[ti]) qi += 1
  }
  return qi === query.length
}

/**
 * Rank a fuzzy hit. Exact > starts-with > contains > tight subsequence.
 */
export function fuzzyScore(query: string, target: string): number {
  if (query.length === 0) return 1
  if (target === query) return 100
  if (target.startsWith(query)) return 80
  if (target.includes(query)) return 60
  let qi = 0
  let gaps = 0
  let last = -1
  for (let ti = 0; ti < target.length && qi < query.length; ti += 1) {
    if (query[qi] === target[ti]) {
      if (last >= 0 && ti - last > 1) gaps += 1
      last = ti
      qi += 1
    }
  }
  if (qi !== query.length) return 0
  return Math.max(1, 40 - gaps * 5)
}

/**
 * Score a typed prefix against a command name or alias. Prefix matches share
 * one flat rank so registry order is preserved (OMP `/set` vs `/settings`).
 */
export function scoreCommandTextMatch(lowerPrefix: string, lowerTarget: string): number {
  if (lowerPrefix.length === 0) return 1
  if (lowerPrefix === lowerTarget) return 1000
  if (lowerTarget.startsWith(lowerPrefix)) return 900
  return fuzzyMatch(lowerPrefix, lowerTarget) ? fuzzyScore(lowerPrefix, lowerTarget) : 0
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
    commands.map((command) => ({
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
  const args = command?.arguments
  if (args === undefined || args.length === 0) return null
  const items = buildSlashArgumentCompletions(args, token.slice(space + 1).toLowerCase())
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
  return value.replace(/\|/gu, '\\|').replace(/\s+/gu, ' ').trim()
}

function helpTable(commands: readonly SlashCommand[]): string[] {
  if (commands.length === 0) return []
  return [
    '| Command | Description |',
    '|---|---|',
    ...commands.map((command) => {
      const names = [command.name, ...(command.aliases ?? [])]
        .map((name, index) => `\`${helpCell(`/${name}${index === 0 ? argumentHint(command) : ''}`)}\``)
        .join(' / ')
      return `| ${names} | ${helpCell(command.description)} |`
    }),
  ]
}

/** Grouped Markdown command directory rendered by the command-output surface. */
export function formatHelpText(
  commands: readonly SlashCommand[] = BUILTIN_SLASH_COMMANDS,
): string {
  const skills = commands.filter(command => command.name.startsWith('skill:'))
  const terminalNames = new Set(BUILTIN_SLASH_COMMANDS.map(command => command.name))
  const terminal = commands.filter(command => terminalNames.has(command.name))
  const agent = commands.filter(command => !command.name.startsWith('skill:') && !terminalNames.has(command.name))
  const lines = [`Commands · ${terminal.length + agent.length} available`]
  if (terminal.length > 0) {
    lines.push(
      '',
      `**Terminal Commands · ${terminal.length}**`,
      ...helpTable(terminal),
    )
  }
  if (agent.length > 0) {
    lines.push(
      '',
      `**Agent Commands · ${agent.length}**`,
      ...helpTable(agent),
    )
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
  const max = AUTOCOMPLETE_MAX_VISIBLE
  const index = Math.max(0, Math.min(selected, Math.max(0, count - 1)))
  const start = Math.max(0, Math.min(index - Math.floor(max / 2), Math.max(0, count - max)))
  return { start, end: Math.min(count, start + max) }
}

/** Item index under a popup-local row, or undefined on the counter/padding. */
export function hitTestAutocomplete(
  count: number,
  selected: number,
  localRow: number,
): number | undefined {
  const { start, end } = autocompleteVisibleRange(count, selected)
  const index = start + localRow
  if (index < start || index >= end) return undefined
  return index
}

/** Popup rows: cursor + name + description, windowed around the selection. */
export function renderAutocomplete(
  items: readonly AutocompleteItem[],
  selected: number,
  theme: Theme,
  width: number,
): string[] {
  if (items.length === 0 || width <= 0) return []
  const { start, end } = autocompleteVisibleRange(items.length, selected)
  const index = Math.max(0, Math.min(selected, items.length - 1))
  const lines: string[] = []
  for (let i = start; i < end; i += 1) {
    const item = items[i]
    if (item === undefined) continue
    const isSelected = i === index
    const cursor = isSelected ? theme.fg('accent', SYMBOL.cursor + ' ') : '  '
    const name = item.kind === 'argument' || item.kind === 'path' ? item.label : '/' + item.label
    const painted = isSelected ? theme.bold(theme.fg('accent', name)) : name
    const desc = item.description !== undefined && item.description !== ''
      ? theme.fg('muted', '  ' + item.description)
      : ''
    lines.push(truncateToWidth(cursor + painted + desc, width))
  }
  const pathMode = items.some(item => item.kind === 'path')
  if (pathMode) {
    const position = items.length > 1 ? `${index + 1}/${items.length} · ` : ''
    lines.push(theme.fg('dim', truncateToWidth(
      `  ${position}↑↓ select · Tab insert · Enter send · Esc close`,
      width,
    )))
  } else if (items.length > AUTOCOMPLETE_MAX_VISIBLE) {
    lines.push(theme.fg('dim', '  ' + String(index + 1) + '/' + String(items.length)))
  }
  return lines
}
