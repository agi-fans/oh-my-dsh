/** Workspace change summary command registered through dsh-commands. */

import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { registerCommands } from './registration.ts'
import { currentWorkingDirectory } from '../session/working-directory.ts'
import type {} from '@deepseek-ai/dsh-workspace-changes'
import { changedPaths, fileDocument, gitOutput, reviewFiles } from '../runtime/file-review.ts'

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
  const cwd = currentWorkingDirectory(ctx, invocation.agent.session)
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
            return { text: diff.hunks.map(hunk => `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join('\n')}`).join('\n'), diff: true,
              ...(diff.coarse ? { status: 'Comparison time limit reached; complete replacement shown.' } : {}) }
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
          return patch.trim() === '' ? await fileDocument(resolve(root, path), invocation.signal) : { text: patch, diff: true }
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

async function startReview(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /review' }
  if (invocation.agent.status !== 'idle') return { kind: 'error', text: 'Finish or interrupt the active turn before starting a review.' }
  const tui = ctx.get('tui')
  if (tui?.interactive !== true) return { kind: 'error', text: 'Use an interactive terminal to choose a review target, or send a review request with its target as a normal message.' }
  const signal = invocation.signal
  const cwd = currentWorkingDirectory(ctx, invocation.agent.session)
  const target = await tui.prompt({ title: 'Code review', question: 'Choose changes to review', options: [
    { label: 'Current changes', value: 'changes', description: 'Staged, unstaged and untracked files' },
    { label: 'Against a base branch', value: 'base', description: 'Changes from the merge base to HEAD' },
    { label: 'One commit', value: 'commit', description: 'Changes introduced by a commit' },
  ], allowCustom: false, signal, notify: false })
  if (target === null || signal.aborted) return { kind: 'success' }
  if (!['changes', 'base', 'commit'].includes(target)) return { kind: 'error', text: 'Unknown review target.' }
  try {
    await gitOutput(cwd, ['rev-parse', '--show-toplevel'], signal)
    let scope = 'Review the current staged, unstaged and untracked changes. Inspect git status and both staged and unstaged diffs; read untracked files as needed.'
    let label = 'Current changes'
    if (target !== 'changes') {
      const ref = await tui.prompt({ title: target === 'base' ? 'Review against a base branch' : 'Review a commit', question: target === 'base' ? 'Local base branch or revision' : 'Commit or revision', initialInput: target === 'commit' ? 'HEAD' : '', allowCustom: true, signal, notify: false })
      if (ref === null || signal.aborted) return { kind: 'success' }
      if (ref.trim() === '') return { kind: 'error', text: 'Enter a local branch or commit.' }
      const resolved = (await gitOutput(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref.trim()}^{commit}`], signal)).trim()
      const base = target === 'base' ? (await gitOutput(cwd, ['merge-base', resolved, 'HEAD'], signal)).trim() : resolved
      if (!/^[a-f0-9]{40,64}$/u.test(base)) throw new Error('Git did not resolve a commit.')
      label = target === 'base' ? `Against ${ref.trim()}` : `Commit ${base.slice(0, 12)}`
      scope = target === 'base' ? `Review changes from merge base ${base} to HEAD using git diff ${base} HEAD. Exclude staged, unstaged and untracked changes.` : `Review only changes introduced by commit ${base}. Inspect its patch and surrounding code; include the initial commit or merge parents when applicable.`
    }
    const confirm = await tui.prompt({ title: 'Start code review', question: label, detail: 'Uses the current agent and model. Requests a review without edits; current Access and Plan mode remain in effect.', options: [{ label: 'Start review', value: 'start' }], allowCustom: false, signal, notify: false })
    if (confirm !== 'start' || signal.aborted) return { kind: 'success' }
    if (invocation.agent.status !== 'idle') return { kind: 'error', text: 'The agent became busy. Retry /review after the turn finishes.' }
    invocation.agent.steer(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: [
      `Code review: ${label}`, `Working directory: ${cwd}`, scope,
      'Review only. Do not edit files, change configuration, install dependencies, commit, or perform fixes. Use non-mutating inspection.',
      'Report actionable regressions caused by the selected changes, with severity, file and line, evidence and impact. Follow repository instructions. Distinguish confirmed findings from uncertainty. If no findings remain, say so and list material validation gaps. Return findings in the final reply without applying them.',
    ].join('\n\n') }] }))
    return { kind: 'success' }
  } catch (error) {
    if (signal.aborted) return { kind: 'success' }
    return { kind: 'error', text: `Could not prepare review: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [{
    name: 'diff',
    description: 'Summarize the workspace changes, or show one file',
    input: { hint: '[path|turn [number]]' },
    handler: invocation => showDiff(ctx, invocation),
  }, { name: 'review', description: 'Review current changes, a base branch or one commit', handler: invocation => startReview(ctx, invocation) }], 'omdsh workspace review commands')
}
