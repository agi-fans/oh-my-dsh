/**
 * Unified `@` completion: project files, then other sessions.
 * Quoted `@"…` tokens stay file-only, matching the Harness web menu.
 */
import { activeAtToken, formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import { SessionId } from '@deepseek-ai/dsh-session'
import { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import type { AutocompleteItem, SlashCommand } from './autocomplete.ts'
import {
  editorLineAt,
  searchPathSuggestions,
  type DirReader,
  type PathSearcher,
} from './path-complete.ts'

/** One session the `@` menu can insert as a canonical mention. */
export interface SessionMentionCandidate {
  sessionId: string
  label: string
  cwd?: string
}

/** List other sessions for the live `@` token. */
export type SessionSearcher = (
  query: string,
  signal?: AbortSignal,
) => Promise<readonly SessionMentionCandidate[]>

/** List workspace files for the live `@` token through `ctx.fileReferences`. */
export type FileSearcher = (
  query: string,
  signal?: AbortSignal,
) => Promise<readonly FileReferenceCandidate[]>

const FILE_HEADING: AutocompleteItem = { value: '', label: 'Files & folders', kind: 'heading' }
const SESSION_HEADING: AutocompleteItem = { value: '', label: 'Session conversations', kind: 'heading' }

/** Quoted `@"` / `@'` tokens, or path fragments, stay file-only. */
export function filesOnlyAtQuery(raw: string, quoted = false): boolean {
  return quoted || raw.startsWith('"') || raw.startsWith("'") || raw.includes('/')
}

function basename(pathValue: string): string {
  const slash = pathValue.replaceAll('\\', '/').lastIndexOf('/')
  return slash < 0 ? pathValue : pathValue.slice(slash + 1)
}

function fileMentionItems(
  candidates: readonly FileReferenceCandidate[],
  quoted: boolean,
): AutocompleteItem[] {
  return candidates.flatMap((candidate) => {
    const value = formatFileMention(candidate, quoted)
    if (value === undefined) return []
    const name = basename(candidate.path)
    const directory = candidate.kind === 'directory'
    return [{
      value,
      label: name + (directory ? '/' : ''),
      ...(candidate.path === name ? {} : { description: candidate.path }),
      kind: 'path' as const,
    }]
  })
}

function sessionItems(candidates: readonly SessionMentionCandidate[]): AutocompleteItem[] {
  return candidates.map((candidate) => ({
    value: formatSessionReferenceMention({
      sessionId: SessionId(candidate.sessionId),
      label: candidate.label,
    }),
    label: candidate.label,
    ...(candidate.cwd === undefined ? {} : { description: candidate.cwd }),
    kind: 'session',
  }))
}

function mergeAtItems(
  files: readonly AutocompleteItem[],
  sessions: readonly AutocompleteItem[],
): AutocompleteItem[] {
  const items: AutocompleteItem[] = []
  if (files.length > 0) items.push(FILE_HEADING, ...files)
  if (sessions.length > 0) items.push(SESSION_HEADING, ...sessions)
  return items
}

/** `@` suggestions: files first, then sessions, with non-selectable headings. */
export async function searchAtSuggestions(
  text: string,
  cursor: number,
  opts: {
    cwd: string
    projectRoot: string
    home: string
    listDir: DirReader
    searchFiles: PathSearcher
    searchFileMentions?: FileSearcher
    searchSessions?: SessionSearcher
    signal?: AbortSignal
  },
  commands: readonly SlashCommand[] = [],
): Promise<{ items: AutocompleteItem[]; prefix: string } | null> {
  const { line, col } = editorLineAt(text, cursor)
  const at = activeAtToken(line, col)
  const fallback = await searchPathSuggestions(text, cursor, opts, commands)
  if (at === undefined) return fallback
  let files: AutocompleteItem[] = []
  if (opts.searchFileMentions !== undefined) {
    try {
      files = fileMentionItems(await opts.searchFileMentions(at.query, opts.signal), at.quoted)
    } catch {
      files = []
    }
  }
  if (files.length === 0) files = fallback?.items ?? []
  let sessions: AutocompleteItem[] = []
  if (opts.searchSessions !== undefined && !filesOnlyAtQuery(at.query, at.quoted)) {
    try {
      sessions = sessionItems(await opts.searchSessions(at.query, opts.signal))
    } catch {
      sessions = []
    }
  }
  const items = mergeAtItems(files, sessions)
  if (items.length === 0) return null
  return { items, prefix: at.prefix }
}

/** First selectable autocomplete index at or after `from`, wrapping once. */
export function nextSelectableAutocompleteIndex(
  items: readonly AutocompleteItem[],
  from: number,
  dir: -1 | 1 = 1,
): number {
  if (items.length === 0) return 0
  const start = ((from % items.length) + items.length) % items.length
  for (let step = 0; step < items.length; step += 1) {
    const index = (start + step * dir + items.length * 2) % items.length
    if (items[index]?.kind !== 'heading') return index
  }
  return start
}
