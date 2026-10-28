/** Human navigation and optional creation of retained Git worktrees. */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-experimental-worktree'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import { registerCommands } from './registration.ts'
import { currentWorkingDirectory } from '../session/working-directory.ts'
import { listWorktrees } from '../session/worktrees.ts'
import { cancellable } from '../runtime/cancellable.ts'

export const name = 'omdsh-command-worktree'
export const inject = ['commands', 'tui', 'workingDirectory', 'subprocess', 'sandbox', 'sandboxPolicy']

async function create(ctx: Context, invocation: CommandInvocation, signal: AbortSignal): Promise<void> {
  const service = ctx.get('worktrees')
  if (service === undefined) return
  const name = await ctx.tui.prompt({ title: 'Create worktree', question: 'New branch name', allowCustom: true, signal, notify: false })
  if (name === null || signal.aborted) return
  const from = await ctx.tui.prompt({ title: 'Create worktree', question: 'Local base commit, branch or tag', initialInput: 'HEAD', allowCustom: true, signal, notify: false })
  if (from === null || signal.aborted) return
  const confirm = await ctx.tui.prompt({ title: 'Create worktree', question: `${name.trim() || 'Generated name'} · ${from.trim() || 'HEAD'}`,
    detail: 'Creates a new branch and checkout, then enters it. Uncommitted files stay here. Leaving retains the checkout and branch. Current Access applies; dependencies are not installed.',
    options: [{ label: 'Create and enter', value: 'create' }], allowCustom: false, signal, notify: false })
  if (confirm !== 'create' || signal.aborted) return
  if (invocation.agent.status !== 'idle') throw new Error('Finish or interrupt the active turn before creating a worktree.')
  const outcome = await cancellable(ctx.tui, {
    title: 'Creating worktree',
    question: name.trim() || 'New checkout',
    detail: 'Enter or Esc cancels. Partial files or branches may remain if creation fails or is cancelled.',
    surface: ctx.tui.interactive === true,
  }, signal, work => service.create(invocation.agent, {
    ...(name.trim() === '' ? {} : { name: name.trim() }),
    from: from.trim() || 'HEAD',
  }, work))
  if (outcome === undefined || outcome.reason !== undefined) return
  ctx.tui.notice(`Entered ${outcome.value.branch} · ${outcome.value.path}`)
}

async function manage(ctx: Context, invocation: CommandInvocation, signal: AbortSignal): Promise<CommandResult> {
  const argument = invocation.rawInput.trim()
  if (argument !== '' && argument !== 'return') return { kind: 'error', text: 'Usage: /worktree [return]' }
  if (invocation.agent.status !== 'idle') return { kind: 'error', text: 'Finish or interrupt the active turn before changing worktrees.' }
  const original = invocation.agent.session.header.cwd ?? ctx.workingDirectory.defaultDirectory
  if (argument === 'return') {
    const cwd = await ctx.workingDirectory.set(invocation.agent, original, signal)
    return { kind: 'success', text: `Returned to ${cwd}. Worktrees and branches are retained.` }
  }
  while (!signal.aborted) {
    const cwd = currentWorkingDirectory(ctx, invocation.agent.session)
    const worktrees = await listWorktrees(ctx, invocation.agent, signal)
    if (ctx.tui.interactive !== true) return { kind: 'success', text: worktrees.map(row => `${row.path === cwd ? '* ' : ''}${row.branch ?? 'detached'} · ${row.path}`).join('\n') }
    const selected = await ctx.tui.prompt({ title: 'Worktrees', question: cwd, presentation: 'fullscreen-list', optionLayout: 'compact', filterable: true, allowCustom: false, signal, notify: false,
      detail: 'Switching keeps this conversation and current Access. Existing shells keep their directories. Worktrees and branches are retained.',
      options: [
        ...(ctx.get('worktrees') === undefined ? [{ label: 'Enable worktree creation', value: 'enable', description: 'Uses the shipped Git Worktrees integration; changes this profile' }] : [{ label: 'Create worktree', value: 'create' }]),
        ...(cwd === original ? [] : [{ label: 'Return to session directory', value: 'return', description: original }]),
        ...worktrees.filter(row => !row.prunable).map((row, index) => ({ label: row.branch ?? 'Detached HEAD', value: `enter:${index}`, description: `${row.path}${row.path === cwd ? ' · current' : ''}${row.locked ? ' · locked' : ''}` })),
      ] })
    if (selected === null || signal.aborted) break
    if (selected === 'enable') {
      const manager = ctx.get('pluginManager')
      if (manager === undefined) return { kind: 'error', text: 'Worktree creation cannot be enabled in this host.' }
      const result = await manager.setBundleEnabled('@deepseek-ai/dsh-experimental-tool-worktree', true)
      signal.throwIfAborted()
      if (result.error !== undefined || result.application === 'failed') return { kind: 'error', text: result.error?.diagnostic ?? result.error?.code ?? 'Could not enable worktree creation.' }
      if (result.application !== 'applied' || ctx.get('worktrees') === undefined) return { kind: 'success', text: `Worktree creation: ${result.application}. Restart omdsh if the integration is not available yet.` }
      ctx.tui.notice('Worktree creation enabled. Choose Create worktree to create a checkout.')
      continue
    }
    if (selected === 'create') { await create(ctx, invocation, signal); continue }
    const target = selected === 'return' ? original : worktrees.filter(row => !row.prunable)[Number(selected.slice(6))]?.path
    if (target === undefined || selected !== 'return' && !selected.startsWith('enter:')) continue
    if (invocation.agent.status !== 'idle') return { kind: 'error', text: 'Finish or interrupt the active turn before changing worktrees.' }
    const entered = await ctx.workingDirectory.set(invocation.agent, target, signal)
    ctx.tui.notice(`Current directory: ${entered}`)
  }
  return { kind: 'success' }
}

export function apply(ctx: Context): void {
  const closing = new AbortController()
  registerCommands(ctx, [{ name: 'worktree', description: 'Create or switch Git worktrees, or return to the session directory', input: { hint: '[return]' }, handler: async invocation => {
    const signal = AbortSignal.any([invocation.signal, closing.signal])
    try { return await manage(ctx, invocation, signal) }
    catch (error) { return { kind: 'error', text: signal.aborted ? 'Worktree operation cancelled.' : error instanceof Error ? error.message : String(error) } }
  } }], 'omdsh worktree commands')
  ctx.effect(() => () => { closing.abort() })
}
