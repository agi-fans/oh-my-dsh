/** Read Git's worktree registry through the calling Agent's execution providers. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { currentWorkingDirectory } from './working-directory.ts'

export interface GitWorktree {
  path: string
  branch?: string
  detached?: boolean
  locked?: boolean
  prunable?: boolean
}

/** NUL porcelain preserves spaces, newlines, Unicode and Git-quoted path characters. */
export function parseWorktrees(output: string): GitWorktree[] {
  const rows: GitWorktree[] = []
  let row: GitWorktree | undefined
  for (const field of output.split('\0')) {
    if (field.startsWith('worktree ')) {
      row = { path: field.slice(9) }
      rows.push(row)
    } else if (row !== undefined) {
      if (field.startsWith('branch ')) row.branch = field.slice(7).replace(/^refs\/heads\//u, '')
      if (field === 'detached') row.detached = true
      if (field === 'locked' || field.startsWith('locked ')) row.locked = true
      if (field === 'prunable' || field.startsWith('prunable ')) row.prunable = true
    }
  }
  return rows
}

export async function listWorktrees(ctx: Context, agent: Agent, signal: AbortSignal): Promise<GitWorktree[]> {
  const operation = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
  const git = await ctx.subprocess.resolveExecutable('git', undefined, operation)
  const argv = [git, '-c', 'core.fsmonitor=false', 'worktree', 'list', '--porcelain', '-z']
  const policy = ctx.sandboxPolicy.resolve({ session: agent.session })
  const confined = policy.mode === 'danger-full-access' ? argv : (await ctx.sandbox.confine(argv, { ...policy, mode: policy.mode }, operation)).argv
  operation.throwIfAborted()
  const child = ctx.subprocess.spawn({ argv: confined, cwd: currentWorkingDirectory(ctx, agent.session), signal: operation,
    env: { GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_COMMON_DIR: undefined, GIT_CONFIG_PARAMETERS: undefined, GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0' },
    graceMs: 1000, stdio: { stdin: 'ignore', stdout: { maxBytes: 262_144 }, stderr: { maxBytes: 65_536 } } })
  try {
    const outcome = await child.done
    operation.throwIfAborted()
    const stdout = child.collected?.stdout?.readFrom(0)
    if (outcome.exitCode !== 0) throw new Error(child.collected?.stderr?.readFrom(0).text.trim() || 'Could not list Git worktrees.')
    if (stdout === undefined || stdout.lossy) throw new Error('Git worktree listing exceeded the output limit.')
    return parseWorktrees(stdout.text)
  } finally { child.terminate(); await child.waitForExit() }
}
