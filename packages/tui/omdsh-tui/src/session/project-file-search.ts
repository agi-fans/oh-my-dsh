/** Cached project-file discovery and fuzzy ranking for composer `@query`. */

import { execFile } from 'node:child_process'
import { opendir } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_CACHE_TTL_MS = 2_000
const DEFAULT_MAX_RESULTS = 100
const MAX_WALK_ENTRIES = 200_000
const FALLBACK_SKIPPED_DIRECTORIES = new Set(['.git', '.hg', '.svn', 'node_modules'])

/** One project-relative path returned by the asynchronous file index. */
export interface ProjectPathEntry {
  path: string
  directory: boolean
}

/** Recursive project-file search used by `@query`. */
export type PathSearcher = (
  root: string,
  query: string,
  options?: { signal?: AbortSignal; maxResults?: number },
) => Promise<readonly ProjectPathEntry[]>

export type ProjectPathLoader = (root: string, signal?: AbortSignal) => Promise<readonly ProjectPathEntry[]>

function abortError(): Error {
  const error = new Error('Project file search aborted')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortError()
}

function normalizedRelativePath(value: string): string | undefined {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '')
  if (normalized === '' || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) return undefined
  if (normalized.split('/').includes('.git')) return undefined
  return normalized
}

function indexedGitPaths(stdout: string): ProjectPathEntry[] {
  const entries = new Map<string, boolean>()
  for (const value of stdout.split('\0')) {
    const file = normalizedRelativePath(value)
    if (file === undefined) continue
    entries.set(file, false)
    const parts = file.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      entries.set(parts.slice(0, index).join('/'), true)
    }
  }
  return [...entries].map(([entryPath, directory]) => ({
    path: directory ? entryPath + '/' : entryPath,
    directory,
  }))
}

async function gitProjectPaths(root: string, signal?: AbortSignal): Promise<ProjectPathEntry[] | undefined> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const options = {
      cwd: root,
      encoding: 'utf8' as const,
      maxBuffer: 32 * 1024 * 1024,
      ...(signal === undefined ? {} : { signal }),
    }
    execFile(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      options,
      (error, stdout) => {
        if (signal?.aborted === true) {
          reject(abortError())
          return
        }
        if (error !== null) {
          resolve(undefined)
          return
        }
        resolve(indexedGitPaths(stdout))
      },
    )
  })
}

async function walkedProjectPaths(root: string, signal?: AbortSignal): Promise<ProjectPathEntry[]> {
  const entries: ProjectPathEntry[] = []
  const pending = ['']
  while (pending.length > 0 && entries.length < MAX_WALK_ENTRIES) {
    throwIfAborted(signal)
    const relativeDir = pending.shift() ?? ''
    let directory
    try {
      directory = await opendir(path.join(root, relativeDir))
    } catch {
      continue
    }
    for await (const entry of directory) {
      throwIfAborted(signal)
      if (entry.name === '.git') continue
      if (entry.isDirectory() && FALLBACK_SKIPPED_DIRECTORIES.has(entry.name)) continue
      const relative = (relativeDir === '' ? entry.name : relativeDir + '/' + entry.name).replaceAll('\\', '/')
      if (entry.isDirectory()) {
        entries.push({ path: relative + '/', directory: true })
        pending.push(relative)
      } else {
        entries.push({ path: relative, directory: false })
      }
      if (entries.length >= MAX_WALK_ENTRIES) break
    }
  }
  return entries
}

/** Load files tracked or visible to Git; fall back to a bounded async walk. */
export async function loadProjectPaths(root: string, signal?: AbortSignal): Promise<readonly ProjectPathEntry[]> {
  const git = await gitProjectPaths(root, signal)
  if (git !== undefined) return git
  return walkedProjectPaths(root, signal)
}

function subsequenceScore(query: string, target: string): number | undefined {
  let queryIndex = 0
  let first = -1
  let previous = -1
  let gaps = 0
  for (let index = 0; index < target.length && queryIndex < query.length; index += 1) {
    if (target[index] !== query[queryIndex]) continue
    if (first < 0) first = index
    if (previous >= 0) gaps += Math.max(0, index - previous - 1)
    previous = index
    queryIndex += 1
  }
  if (queryIndex !== query.length) return undefined
  return Math.max(0, first) * 2 + gaps * 3 + target.length - query.length
}

/** Lower scores are better; undefined means the query does not match. */
export function fuzzyProjectPathScore(query: string, candidate: string): number | undefined {
  const needle = query.trim().toLowerCase().replaceAll('\\', '/')
  const target = candidate.toLowerCase().replaceAll('\\', '/').replace(/\/$/u, '')
  if (needle === '') return target.split('/').length * 10
  const basename = target.slice(target.lastIndexOf('/') + 1)
  const depthPenalty = Math.max(0, target.split('/').length - 1) * 2
  if (basename === needle) return depthPenalty
  if (basename.startsWith(needle)) return 20 + basename.length - needle.length + depthPenalty
  const basenameContains = basename.indexOf(needle)
  if (basenameContains >= 0) return 60 + basenameContains + depthPenalty
  const targetContains = target.indexOf(needle)
  if (targetContains >= 0) return 100 + targetContains + depthPenalty
  const basenameFuzzy = subsequenceScore(needle, basename)
  if (basenameFuzzy !== undefined) return 160 + basenameFuzzy + depthPenalty
  const pathFuzzy = subsequenceScore(needle, target)
  if (pathFuzzy !== undefined) return 260 + pathFuzzy + depthPenalty
  return undefined
}

/** Rank a stable project index for one live query. */
export function rankProjectPaths(
  entries: readonly ProjectPathEntry[],
  query: string,
  maxResults = DEFAULT_MAX_RESULTS,
): ProjectPathEntry[] {
  if (maxResults <= 0) return []
  return entries
    .flatMap((entry) => {
      const entryPath = normalizedRelativePath(entry.path)
      if (entryPath === undefined) return []
      const score = fuzzyProjectPathScore(query, entryPath)
      if (score === undefined) return []
      return [{
        entry: { path: entry.directory ? entryPath + '/' : entryPath, directory: entry.directory },
        score,
        depth: entryPath.split('/').length,
      }]
    })
    .sort((left, right) => left.score - right.score
      || Number(right.entry.directory) - Number(left.entry.directory)
      || left.depth - right.depth
      || left.entry.path.localeCompare(right.entry.path))
    .slice(0, maxResults)
    .map(result => result.entry)
}

/** Per-TUI project index cache; search remains asynchronous and cancellable. */
export class ProjectFileSearch {
  readonly #cache = new Map<string, { expiresAt: number; entries: readonly ProjectPathEntry[] }>()
  readonly #loader: ProjectPathLoader
  readonly #cacheTtlMs: number

  constructor(loader: ProjectPathLoader = loadProjectPaths, cacheTtlMs = DEFAULT_CACHE_TTL_MS) {
    this.#loader = loader
    this.#cacheTtlMs = cacheTtlMs
  }

  readonly search: PathSearcher = async (root, query, options = {}) => {
    throwIfAborted(options.signal)
    const cacheKey = path.resolve(root)
    const now = Date.now()
    const cached = this.#cache.get(cacheKey)
    let entries: readonly ProjectPathEntry[]
    if (cached !== undefined && cached.expiresAt >= now) {
      entries = cached.entries
    } else {
      entries = await this.#loader(cacheKey, options.signal)
      throwIfAborted(options.signal)
      this.#cache.set(cacheKey, { entries, expiresAt: Date.now() + this.#cacheTtlMs })
    }
    return rankProjectPaths(entries, query, options.maxResults ?? DEFAULT_MAX_RESULTS)
  }

  invalidate(root?: string): void {
    if (root === undefined) this.#cache.clear()
    else this.#cache.delete(path.resolve(root))
  }
}
