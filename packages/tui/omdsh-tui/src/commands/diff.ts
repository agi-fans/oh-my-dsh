/** Workspace change summary command registered through dsh-commands. */

import { execFile } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-diff'
export const inject = ['commands']

/** Maximum rows rendered before a summary is truncated. */
const DIFF_MAX_ROWS = 20

/** Git invocation bound to one working directory. */
type GitRunner = (args: readonly string[]) => Promise<string>

/** One tracked file's line delta in the working tree. */
export interface FileChange {
  path: string
  added: number
  removed: number
  /** Binary files report `-` for both counts. */
  binary: boolean
}

/**
 * Parse `git diff --numstat` output.
 * @param output - raw stdout, one `added\tremoved\tpath` row per file.
 * @returns parsed changes in git's order.
 */
export function parseNumstat(output: string): FileChange[] {
  const changes: FileChange[] = []
  for (const line of output.split('\n')) {
    if (line.trim() === '') continue
    const [added, removed, ...rest] = line.split('\t')
    const path = rest.join('\t').trim()
    if (path === '') continue
    const binary = added === '-' || removed === '-'
    changes.push({
      path,
      added: binary ? 0 : Number.parseInt(added ?? '0', 10) || 0,
      removed: binary ? 0 : Number.parseInt(removed ?? '0', 10) || 0,
      binary,
    })
  }
  return changes
}

/**
 * Collect untracked paths from `git status --porcelain` output.
 * @param output - raw stdout; only `??` rows are considered.
 * @returns untracked paths in git's order.
 */
export function untrackedFromStatus(output: string): string[] {
  return output.split('\n')
    .filter(line => line.startsWith('?? '))
    .map(line => line.slice(3).trim())
    .filter(path => path !== '')
}

/**
 * Render the workspace change summary as Markdown.
 * @param changes - tracked file deltas.
 * @param untracked - untracked paths.
 * @returns a Markdown summary, or a no-change notice.
 */
export function formatChangeSummary(
  changes: readonly FileChange[],
  untracked: readonly string[],
): string {
  if (changes.length === 0 && untracked.length === 0) return 'No workspace changes.'
  const added = changes.reduce((total, change) => total + change.added, 0)
  const removed = changes.reduce((total, change) => total + change.removed, 0)
  const lines = [
    `Workspace changes · ${changes.length} tracked · ${untracked.length} untracked · +${added} −${removed}`,
  ]
  if (changes.length > 0) {
    lines.push('', '| File | + | − |', '|---|---|---|')
    for (const change of changes.slice(0, DIFF_MAX_ROWS)) {
      lines.push(`| \`${change.path}\` | ${change.binary ? '—' : change.added} | ${change.binary ? '—' : change.removed} |`)
    }
    if (changes.length > DIFF_MAX_ROWS) lines.push('', `…and ${changes.length - DIFF_MAX_ROWS} more tracked files.`)
  }
  if (untracked.length > 0) {
    lines.push('', '**Untracked**')
    for (const path of untracked.slice(0, DIFF_MAX_ROWS)) lines.push(`- \`${path}\``)
    if (untracked.length > DIFF_MAX_ROWS) lines.push(`- …and ${untracked.length - DIFF_MAX_ROWS} more.`)
  }
  return lines.join('\n')
}

function gitRunner(cwd: string): GitRunner {
  return (args) => new Promise((resolvePromise, reject) => {
    execFile('git', [...args], { cwd, timeout: 5_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error !== null) reject(error)
      else resolvePromise(stdout)
    })
  })
}

async function showDiff(invocation: CommandInvocation): Promise<CommandResult> {
  const target = invocation.rawInput.trim()
  const cwd = invocation.agent.session.header.cwd ?? process.cwd()
  const git = gitRunner(cwd)
  try {
    if (target !== '') {
      const patch = await git(['diff', '--', target])
      if (patch.trim() === '') return { kind: 'success', text: `No unstaged changes in ${target}.` }
      return { kind: 'success', text: `Diff · ${target}\n\n\`\`\`diff\n${patch.trimEnd()}\n\`\`\`` }
    }
    const [numstat, status] = await Promise.all([
      git(['diff', '--numstat']),
      git(['status', '--porcelain']),
    ])
    return {
      kind: 'success',
      text: formatChangeSummary(parseNumstat(numstat), untrackedFromStatus(status)),
    }
  } catch (error: unknown) {
    return { kind: 'error', text: 'git diff failed: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [{
    name: 'diff',
    description: 'Summarize the workspace changes, or show one file',
    input: { hint: '[path]' },
    handler: showDiff,
  }], 'omdsh diff command')
}
