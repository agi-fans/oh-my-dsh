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
const defaultCache = new Map<string, ProjectContext>()

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
  const cached = runner === runGit ? defaultCache.get(cwd) : undefined
  if (cached !== undefined) return cached
  const root = attempt(runner, cwd, ['rev-parse', '--show-toplevel'])
  if (root === undefined) {
    const result = { root: cwd, modified: 0, untracked: 0 }
    if (runner === runGit) defaultCache.set(cwd, result)
    return result
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
  const result = { root, branch, modified, untracked, gitLabel }
  if (runner === runGit) defaultCache.set(cwd, result)
  return result
}
