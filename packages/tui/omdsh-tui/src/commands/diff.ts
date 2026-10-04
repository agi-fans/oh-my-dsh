/** Workspace change summary command registered through dsh-commands. */

import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { registerCommands } from './registration.ts'
import type {} from '@deepseek-ai/dsh-workspace-changes'
import { changedPaths, codeDocument, filePreview, gitOutput, reviewFiles } from '../runtime/file-review.ts'

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

async function showDiff(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const target = invocation.rawInput.trim()
  const cwd = invocation.agent.session.header.cwd ?? process.cwd()
  const git = gitRunner(cwd)
  try {
    const tui = ctx.get('tui')
    if (tui?.interactive === true) {
      const turn = /^turn(?:\s+(\d+))?$/u.exec(target)
      if (turn !== null) {
        const event = invocation.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/changes'
          && (turn[1] === undefined || event.data.turn === Number(turn[1])))
        const service = ctx.get('workspaceChanges')
        const summary = event === undefined ? undefined : service?.summary(invocation.agent.id, event.seq)
        if (event === undefined || summary === undefined) return { kind: 'error', text: 'This turn has no retained file comparison. Use /diff to review the current workspace.' }
        await reviewFiles(tui, `Turn ${summary.turn} changes`, summary.cwd,
          summary.files.map(file => ({ path: file.path, label: file.display, description: `+${file.added} −${file.deleted}` })), async index => {
            const diff = await service?.diff(invocation.agent.id, event.seq, index, invocation.signal)
            if (diff === undefined) return 'This comparison is no longer retained.'
            if (diff.kind !== 'text') return diff.kind === 'binary' ? 'Binary file; open the original to inspect it.' : 'File exceeds the turn comparison limit.'
            return codeDocument(diff.hunks.map(hunk => `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join('\n')}`).join('\n'), 'diff')
              + (diff.coarse ? '\n\nComparison time limit reached; complete replacement shown.' : '')
          }, invocation.signal)
      } else {
        // Git's changed-file lists use repository paths, even when the session
        // starts in a subdirectory. Keep diffs and host-file actions on that base.
        // Explicit user paths retain their session-cwd semantics.
        const root = target === ''
          ? (await gitOutput(cwd, ['rev-parse', '--show-toplevel'], invocation.signal)).replace(/\r?\n$/u, '')
          : cwd
        const paths = target === '' ? await changedPaths(root, invocation.signal) : [target]
        if (paths.length === 0) return { kind: 'success', text: 'No workspace changes.' }
        await reviewFiles(tui, 'Current workspace changes', root, paths.map(path => ({ path, label: path })), async index => {
          const path = paths[index] ?? ''
          let patch: string
          try { patch = await gitOutput(root, ['diff', 'HEAD', '--', path], invocation.signal) }
          catch { patch = (await gitOutput(root, ['diff', '--cached', '--', path], invocation.signal)) + (await gitOutput(root, ['diff', '--', path], invocation.signal)) }
          return patch.trim() === '' ? await filePreview(resolve(root, path), invocation.signal) : codeDocument(patch, 'diff')
        }, invocation.signal, target === '' ? undefined : 0)
      }
      return { kind: 'success' }
    }
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
    input: { hint: '[path|turn [number]]' },
    handler: invocation => showDiff(ctx, invocation),
  }], 'omdsh diff command')
}
