/**
 * `@` and explicit path autocomplete: immediate directory browsing plus
 * asynchronous project-wide fuzzy search. Tab can force a bare-word token.
 * Filesystem access stays behind injected directory and project-search seams.
 * @module @agi-fans/dsh-tui
 */

import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { activeAtToken } from '@deepseek-ai/dsh-file-reference/grammar'
import {
  ProjectFileSearch,
  type PathSearcher,
} from '../session/project-file-search.ts'
import {
  BUILTIN_SLASH_COMMANDS,
  findLeadingSlashCommandStart,
  resolveSlashCommand,
  type AutocompleteItem,
  type SlashCommand,
} from './autocomplete.ts'

/** One directory listing entry. */
export interface DirEntry {
  name: string
  directory: boolean
}

/** Read one directory; undefined when it cannot be listed. */
export type DirReader = (dir: string) => readonly DirEntry[] | undefined

export type { PathSearcher, ProjectPathEntry } from '../session/project-file-search.ts'

/** Token in the buffer that should complete as a path. */
export interface PathToken {
  start: number
  prefix: string
  kind: 'at' | 'path'
}

const PATH_DELIMITERS = new Set([' ', '\t', '"', "'", '='])

/** Last path-token delimiter before the cursor, or -1. */
export function findLastPathDelimiter(text: string): number {
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (PATH_DELIMITERS.has(text[i] ?? '')) return i
  }
  return -1
}

function isExplicitPath(token: string): boolean {
  return (
    token.startsWith('./')
    || token.startsWith('../')
    || token === '~'
    || token.startsWith('~/')
    || token.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(token)
  )
}

/** Current editor line containing `cursor`. */
export function editorLineAt(text: string, cursor: number): { line: string; start: number; col: number } {
  const start = text.lastIndexOf('\n', cursor - 1) + 1
  const end = text.indexOf('\n', cursor)
  return {
    start,
    line: text.slice(start, end === -1 ? text.length : end),
    col: Math.max(0, cursor - start),
  }
}

/** Path token immediately before `cursor`, or null. */
export function findPathToken(text: string, cursor: number, force = false): PathToken | null {
  const lineStart = text.lastIndexOf('\n', cursor - 1) + 1
  const before = text.slice(lineStart, cursor)
  const delim = findLastPathDelimiter(before)
  const start = delim === -1 ? 0 : delim + 1
  const token = before.slice(start)
  if (token.startsWith('@')) return { start: lineStart + start, prefix: token, kind: 'at' }
  if (isExplicitPath(token)) return { start: lineStart + start, prefix: token, kind: 'path' }
  if (force) return { start: lineStart + start, prefix: token, kind: 'path' }
  return null
}

/** Strip a leading `@` from a live prefix. */
export function parsePathPrefix(prefix: string): { raw: string; at: boolean } {
  if (prefix.startsWith('@')) return { raw: prefix.slice(1), at: true }
  return { raw: prefix, at: false }
}

/** Directory to list and the display prefix for each match. */
export function resolveSearch(
  raw: string,
  cwd: string,
  home: string,
): { searchDir: string; searchPrefix: string; displayBase: string } {
  const posix = raw.replaceAll('\\', '/')
  const listing = posix === '' || posix.endsWith('/') || posix === '~'
  if (listing) {
    return {
      searchDir: resolveDir(posix === '~' ? '~/' : posix, cwd, home),
      searchPrefix: '',
      displayBase: posix === '~' ? '~/' : posix,
    }
  }
  const slash = posix.lastIndexOf('/')
  const dirRaw = slash === -1 ? '' : posix.slice(0, slash + 1)
  return {
    searchDir: resolveDir(dirRaw, cwd, home),
    searchPrefix: slash === -1 ? posix : posix.slice(slash + 1),
    displayBase: dirRaw,
  }
}

function resolveDir(dirRaw: string, cwd: string, home: string): string {
  if (dirRaw === '' || dirRaw === './') return cwd
  if (dirRaw === '~' || dirRaw === '~/') return home
  if (dirRaw.startsWith('~/')) return path.resolve(home, dirRaw.slice(2))
  if (dirRaw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(dirRaw)) return path.resolve(dirRaw)
  return path.resolve(cwd, dirRaw)
}

/** Quote a path that contains spaces; keep directory trailing slashes open. */
export function formatPathValue(pathValue: string, at: boolean): string {
  const prefix = at ? '@' : ''
  if (!pathValue.includes(' ')) return prefix + pathValue
  return pathValue.endsWith('/')
    ? prefix + '"' + pathValue
    : prefix + '"' + pathValue + '"'
}

/** Ranked path rows from a directory listing. */
export function buildPathCompletions(
  entries: readonly DirEntry[],
  displayBase: string,
  searchPrefix: string,
  at: boolean,
): AutocompleteItem[] {
  const lower = searchPrefix.toLowerCase()
  const showHidden = lower.startsWith('.')
  const items: AutocompleteItem[] = []
  for (const entry of entries) {
    if (entry.name === '.git') continue
    if (entry.name.startsWith('.') && !showHidden) continue
    if (lower !== '' && !entry.name.toLowerCase().startsWith(lower)) continue
    const rel = displayBase + entry.name
    const pathValue = entry.directory ? rel + '/' : rel
    items.push({
      value: formatPathValue(pathValue, at),
      label: entry.name + (entry.directory ? '/' : ''),
      kind: 'path',
    })
  }
  items.sort((a, b) => {
    const aDir = a.label.endsWith('/')
    const bDir = b.label.endsWith('/')
    if (aDir !== bDir) return aDir ? -1 : 1
    return a.label.localeCompare(b.label)
  })
  return items
}

/** List completions for a live `@` / path prefix. */
export function listPathCompletions(
  prefix: string,
  opts: { cwd: string; projectRoot?: string; home: string; listDir: DirReader },
): AutocompleteItem[] {
  const parsed = parsePathPrefix(prefix)
  const search = resolveSearch(parsed.raw, parsed.at ? (opts.projectRoot ?? opts.cwd) : opts.cwd, opts.home)
  const entries = opts.listDir(search.searchDir)
  if (entries === undefined) return []
  return buildPathCompletions(entries, search.displayBase, search.searchPrefix, parsed.at)
}

function slashCommandOwnsInput(
  text: string,
  cursor: number,
  commands: readonly SlashCommand[],
): boolean {
  const before = text.slice(0, cursor)
  const start = findLeadingSlashCommandStart(before)
  if (start === null) return false
  const token = before.slice(start)
  if (token === '/') return true
  if (token.includes(' ')) return true
  if (token.slice(1).includes('/')) return false
  return resolveSlashCommand(token.slice(1), commands) !== undefined
}

/** Suggestions for a path token, or null when the cursor is not in one. */
export function pathSuggestions(
  text: string,
  cursor: number,
  opts: { cwd: string; projectRoot?: string; home: string; listDir: DirReader; force?: boolean },
  commands: readonly SlashCommand[] = BUILTIN_SLASH_COMMANDS,
): { items: AutocompleteItem[]; prefix: string } | null {
  if (slashCommandOwnsInput(text, cursor, commands)) return null
  const token = findPathToken(text, cursor, opts.force === true)
  if (token === null) return null
  const items = listPathCompletions(token.prefix, opts)
  if (items.length === 0) return null
  return { items, prefix: text.slice(token.start, cursor) }
}

/** Async `@query` search with prefix-listing fallback. */
export async function searchPathSuggestions(
  text: string,
  cursor: number,
  opts: {
    cwd: string
    projectRoot: string
    home: string
    listDir: DirReader
    searchFiles: PathSearcher
    signal?: AbortSignal
  },
  commands: readonly SlashCommand[] = BUILTIN_SLASH_COMMANDS,
): Promise<{ items: AutocompleteItem[]; prefix: string } | null> {
  if (slashCommandOwnsInput(text, cursor, commands)) return null
  const token = findPathToken(text, cursor)
  if (token === null || token.kind !== 'at') return pathSuggestions(text, cursor, opts, commands)
  const parsed = parsePathPrefix(token.prefix)
  if (parsed.raw === '' || parsed.raw.replaceAll('\\', '/').endsWith('/')) {
    return pathSuggestions(text, cursor, opts, commands)
  }
  const normalized = parsed.raw.replaceAll('\\', '/')
  const slash = normalized.lastIndexOf('/')
  const displayBase = slash < 0 ? '' : normalized.slice(0, slash + 1)
  const query = slash < 0 ? normalized : normalized.slice(slash + 1)
  const searchDir = resolveDir(displayBase, opts.projectRoot, opts.home)
  const relative = path.relative(opts.projectRoot, searchDir)
  const outside = path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)
  if (outside) return pathSuggestions(text, cursor, opts, commands)
  const matches = await opts.searchFiles(searchDir, query, {
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    maxResults: 100,
  })
  if (matches.length === 0) return pathSuggestions(text, cursor, opts, commands)
  const items = matches.flatMap((entry): AutocompleteItem[] => {
    const relativePath = entry.path.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/$/u, '')
    if (relativePath === '' || /(^|\/)\.git(\/|$)/u.test(relativePath)) return []
    const displayPath = displayBase + relativePath
    const pathValue = entry.directory ? displayPath + '/' : displayPath
    const basename = path.posix.basename(relativePath)
    return [{
      value: formatPathValue(pathValue, true),
      label: basename + (entry.directory ? '/' : ''),
      ...(displayPath === basename ? {} : { description: displayPath }),
      kind: 'path',
    }]
  })
  if (items.length === 0) return pathSuggestions(text, cursor, opts, commands)
  return { items, prefix: text.slice(token.start, cursor) }
}

/** Replace the live path token with the selected value. */
export function applyPathCompletion(
  text: string,
  cursor: number,
  item: AutocompleteItem,
): { text: string; cursor: number } {
  const after = text.slice(cursor)
  const insert = item.value.endsWith('/') ? item.value : item.value + ' '
  const { line, start, col } = editorLineAt(text, cursor)
  const at = activeAtToken(line, col)
  if (at !== undefined) {
    const tokenStart = start + col - at.prefix.length
    return { text: text.slice(0, tokenStart) + insert + after, cursor: tokenStart + insert.length }
  }
  const token = findPathToken(text, cursor, true)
  if (token === null) return { text, cursor }
  return { text: text.slice(0, token.start) + insert + after, cursor: token.start + insert.length }
}

/** Default reader: `readdir` plus symlink-to-directory. */
export function readDirEntries(dir: string): DirEntry[] | undefined {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((entry) => {
      let directory = entry.isDirectory()
      if (!directory && entry.isSymbolicLink()) {
        try { directory = statSync(path.join(dir, entry.name)).isDirectory() } catch { directory = false }
      }
      return { name: entry.name, directory }
    })
  } catch {
    return undefined
  }
}

/** Filesystem options the provider uses for path completion. */
export function defaultPathSource(): { cwd: string; home: string; listDir: DirReader; searchFiles: PathSearcher } {
  const search = new ProjectFileSearch()
  return { cwd: process.cwd(), home: homedir(), listDir: readDirEntries, searchFiles: search.search }
}
