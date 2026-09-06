/** Read-only Git workspace projection used by composer and workspace commands. */

import { execFileSync } from 'node:child_process'

export interface ProjectContext {
  /** Git worktree root, or the supplied cwd outside a repository. */
  root: string
  branch?: string
  modified: number
  untracked: number
  /** Compact composer label such as `main *3 ?2`. */
  gitLabel?: string
}

export type GitRunner = (cwd: string, args: readonly string[]) => string

const runGit: GitRunner = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
})
/** Bounded freshness so an agent checkpoint or checkout is reflected without a restart. */
const PROJECT_CONTEXT_TTL_MS = 15_000
const defaultCache = new Map<string, { at: number; value: ProjectContext }>()

function attempt(runner: GitRunner, cwd: string, args: readonly string[]): string | undefined {
  try {
    const value = runner(cwd, args).trim()
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}

/** Resolve a cwd to its worktree root, branch, and compact dirty counters. */
export function resolveProjectContext(cwd: string, runner: GitRunner = runGit): ProjectContext {
  if (runner === runGit) {
    const cached = defaultCache.get(cwd)
    if (cached !== undefined && Date.now() - cached.at < PROJECT_CONTEXT_TTL_MS) return cached.value
  }
  const result = resolveProjectContextFresh(cwd, runner)
  if (runner === runGit) defaultCache.set(cwd, { at: Date.now(), value: result })
  return result
}

/** Re-resolve one cwd immediately, refreshing the default-cache entry. */
export function refreshProjectContext(cwd: string, runner: GitRunner = runGit): ProjectContext {
  const result = resolveProjectContextFresh(cwd, runner)
  if (runner === runGit) defaultCache.set(cwd, { at: Date.now(), value: result })
  return result
}

function resolveProjectContextFresh(cwd: string, runner: GitRunner): ProjectContext {
  const root = attempt(runner, cwd, ['rev-parse', '--show-toplevel'])
  if (root === undefined) {
    return { root: cwd, modified: 0, untracked: 0 }
  }

  const branch = attempt(runner, root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
    ?? attempt(runner, root, ['rev-parse', '--short', 'HEAD'])
    ?? 'detached'
  const status = attempt(runner, root, ['status', '--porcelain=v1', '--untracked-files=normal']) ?? ''
  let modified = 0
  let untracked = 0
  for (const row of status.split('\n')) {
    if (row === '') continue
    const code = row.slice(0, 2)
    if (code === '??') untracked += 1
    else if (code !== '!!') modified += 1
  }
  const gitLabel = branch
    + (modified > 0 ? ` *${modified}` : '')
    + (untracked > 0 ? ` ?${untracked}` : '')
  return { root, branch, modified, untracked, gitLabel }
}
