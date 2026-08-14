/**
 * Slash-command autocomplete: OMP-style leading-`/` matching, ranking, and
 * completion apply. Pure — the provider owns popup selection and execution.
 * @module @omdsh/tui
 */

import { SYMBOL, type Theme } from './theme.ts'
import { truncateToWidth } from './width.ts'

/** One slash command the editor can complete and the TUI can run. */
export interface SlashCommand {
  name: string
  aliases?: readonly string[]
  description: string
}

/** One ranked suggestion shown in the popup. */
export interface AutocompleteItem {
  value: string
  label: string
  description?: string
}

/** Built-in session-surface commands (no extra backend required). */
export const BUILTIN_SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'help', aliases: ['h', '?'], description: 'Show available slash commands' },
  { name: 'settings', aliases: ['set'], description: 'Open settings' },
  { name: 'theme', description: 'Switch color theme (dark/light)' },
  { name: 'clear', description: 'Clear the transcript display' },
  { name: 'quit', aliases: ['q'], description: 'Quit the application' },
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

function commandNames(command: SlashCommand): string[] {
  return [command.name, ...(command.aliases ?? [])]
}

/** Ranked command-name completions for a prefix (no leading slash). */
export function buildSlashCommandCompletions(
  commands: readonly SlashCommand[],
  lowerPrefix: string,
): AutocompleteItem[] {
  return commands
    .flatMap((command) => {
      let best: (AutocompleteItem & { score: number }) | undefined
      for (const name of commandNames(command)) {
        const score = scoreCommandTextMatch(lowerPrefix, name.toLowerCase())
        if (score === 0) continue
        if (best !== undefined && score <= best.score) continue
        const item: AutocompleteItem & { score: number } = {
          value: command.name,
          label: name,
          score,
        }
        if (command.description !== '') item.description = command.description
        best = item
      }
      return best === undefined ? [] : [best]
    })
    .sort((a, b) => b.score - a.score)
    .map(({ score: _score, ...rest }) => rest)
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
  if (token.includes(' ') || token.slice(1).includes('/')) return null
  const items = buildSlashCommandCompletions(commands, token.slice(1).toLowerCase())
  if (items.length === 0) return null
  return { items, prefix: before }
}

/** Replace the live command token with `/${item.value} `. */
export function applySlashCompletion(
  text: string,
  cursor: number,
  item: AutocompleteItem,
): { text: string; cursor: number } {
  const before = text.slice(0, cursor)
  const after = text.slice(cursor)
  const start = findLeadingSlashCommandStart(before)
  if (start === null) return { text, cursor }
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

/** Help body painted as a notice when `/help` runs. */
export function formatHelpText(commands: readonly SlashCommand[] = BUILTIN_SLASH_COMMANDS): string {
  const lines = ['Commands']
  for (const command of commands) {
    const names = ['/' + command.name, ...(command.aliases ?? []).map((alias) => '/' + alias)]
    lines.push(names.join(', ') + '  ' + command.description)
  }
  return lines.join('\n')
}

/** Popup rows: cursor + name + description, windowed around the selection. */
export function renderAutocomplete(
  items: readonly AutocompleteItem[],
  selected: number,
  theme: Theme,
  width: number,
): string[] {
  if (items.length === 0 || width <= 0) return []
  const max = AUTOCOMPLETE_MAX_VISIBLE
  const index = Math.max(0, Math.min(selected, items.length - 1))
  const start = Math.max(0, Math.min(index - Math.floor(max / 2), Math.max(0, items.length - max)))
  const end = Math.min(items.length, start + max)
  const lines: string[] = []
  for (let i = start; i < end; i += 1) {
    const item = items[i]
    if (item === undefined) continue
    const isSelected = i === index
    const cursor = isSelected ? theme.fg('accent', SYMBOL.cursor + ' ') : '  '
    const name = '/' + item.label
    const painted = isSelected ? theme.bold(theme.fg('accent', name)) : name
    const desc = item.description !== undefined && item.description !== ''
      ? theme.fg('muted', '  ' + item.description)
      : ''
    lines.push(truncateToWidth(cursor + painted + desc, width))
  }
  if (items.length > max) {
    lines.push(theme.fg('dim', '  ' + String(index + 1) + '/' + String(items.length)))
  }
  return lines
}
