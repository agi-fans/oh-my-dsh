/** Native profile management over the published Harness transaction service. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { ChangeResult, PluginInfo, PluginInstallRequestId } from '@deepseek-ai/dsh-plugin-manager'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-plugins'
export const inject = ['commands', 'pluginManager', 'tui']

// Removing the command's own presentation or session owner during its awaited
// handler would make disposal wait for the operation that caused disposal.
const TERMINAL_OWNERS = new Set([
  'commands', 'agent', 'session', 'agent-preset-registry', 'tools', 'llm',
  'settings', 'config-editor', 'credentials', 'agent-default-model',
  'session-persistence', 'session-projection', 'authorization', 'approval',
  'user-questions', 'plan-mode',
])

export function pluginReadOnly(row: PluginInfo): string | undefined {
  if (row.moduleName.startsWith('@agi-fans/') || TERMINAL_OWNERS.has(row.patchId ?? '')) return 'terminal-required'
  return row.readOnlyReason
}

export function changeText(result: ChangeResult): string {
  return [
    `${result.target}: ${result.application}${result.enabled === undefined ? '' : result.enabled ? ' · enabled' : ' · disabled'}`,
    ...(result.error === undefined ? [] : [result.error.diagnostic ?? result.error.code]),
    ...(result.error?.incompatible ?? []).map(item => `${item.name}@${item.version}: DSH ${item.runtimeVersion} rejects ${JSON.stringify(item.peers)}`),
    ...(result.warnings ?? []),
    ...(result.packageResult === undefined ? [] : [result.packageResult.output, `Full installation log: ${result.packageResult.logPath}`]),
  ].filter(Boolean).join('\n')
}

const list = { presentation: 'fullscreen-list' as const, filterable: true, allowCustom: false, optionLayout: 'compact' as const }

async function install(ctx: Context, spec: string, signal: AbortSignal, approvedBuilds?: string[]): Promise<ChangeResult> {
  signal.throwIfAborted()
  const requestId = randomUUID() as PluginInstallRequestId
  const promptAbort = new AbortController()
  const cancel = (): void => { void ctx.pluginManager.cancelInstall(requestId).catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  const off = ctx.on('plugin-manager/install-state', progress => {
    if (progress.requestId !== requestId) return
    const attempt = progress.attempt
    ctx.tui.notice(`Plugin ${progress.phase}${attempt === undefined ? '' : ` · ${attempt.index}/${attempt.total} · ${attempt.registry ?? 'configured registry'}`}`)
    if (progress.phase === 'applying') promptAbort.abort()
  })
  const operation = ctx.pluginManager.installBundle(spec, { requestId, ...(approvedBuilds === undefined ? {} : { approvedBuilds }) })
  // The installer owns cancellation through restoration, even after the
  // prompt closes. Never abandon its promise or report cancellation early.
  const prompt = ctx.tui.prompt({
    title: 'Install plugin', question: spec,
    detail: 'Installing into this profile. Enter or Esc cancels; applying a finished installation cannot be cancelled.',
    options: [{ label: 'Cancel installation', value: 'cancel' }],
    allowCustom: false, signal: AbortSignal.any([signal, promptAbort.signal]),
  }).then(() => { if (!promptAbort.signal.aborted) cancel() }, () => { cancel() })
  try { return await operation }
  finally { promptAbort.abort(); await prompt; off(); signal.removeEventListener('abort', cancel) }
}

async function manage(ctx: Context, invocation: CommandInvocation, signal: AbortSignal): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /plugins' }
  if (invocation.agent.status === 'running') return { kind: 'error', text: 'Wait for the current turn to finish before managing plugins.' }
  while (!signal.aborted) {
    const action = await ctx.tui.prompt({ ...list, title: 'Plugins', question: 'Manage this profile',
      detail: 'Changes affect every session using this profile. Package replacements may require a restart.',
      options: [{ label: 'Plugin entries', value: 'entries' }, { label: 'Bundles', value: 'bundles' }, { label: 'Install bundle', value: 'install' }], signal })
    if (action === null) break
    let result: ChangeResult | undefined
    if (action === 'entries') {
      const rows = await ctx.pluginManager.listPlugins()
      const id = await ctx.tui.prompt({ ...list, title: 'Plugin entries', question: 'Choose an entry to inspect or toggle',
        options: rows.map(row => ({ label: row.patchId ?? String(row.entryId), value: String(row.entryId),
          description: `${row.enabled ? 'Enabled' : 'Disabled'} · ${row.fiberPhase ?? 'not mounted'} · ${row.moduleName}${pluginReadOnly(row) === undefined ? '' : ` · ${pluginReadOnly(row)}`}` })), signal })
      const row = rows.find(row => row.entryId === id)
      if (row === undefined) continue
      const reason = pluginReadOnly(row)
      if (reason !== undefined) { ctx.tui.notice(`${row.moduleName}: read-only (${reason}).`); continue }
      const choice = await ctx.tui.prompt({ title: 'Plugin entry', question: row.moduleName,
        options: [{ label: row.enabled ? 'Disable' : 'Enable', value: 'toggle' }], allowCustom: false, signal })
      if (choice === 'toggle' && !signal.aborted) result = await ctx.pluginManager.setPluginEnabled(row.entryId, !row.enabled)
    } else if (action === 'bundles') {
      const rows = await ctx.pluginManager.listBundles()
      const selected = await ctx.tui.prompt({ ...list, title: 'Bundles', question: 'Choose a bundle',
        options: rows.map(row => ({ label: row.name, value: row.name,
          description: `${row.version ?? ''} · ${row.enabled ? 'Enabled' : 'Disabled'}${row.error === undefined ? '' : ` · ${row.error.diagnostic ?? row.error.code}`}` })), signal })
      const row = rows.find(row => row.name === selected)
      if (row === undefined) continue
      if (row.readOnlyReason !== undefined) { ctx.tui.notice(`${row.name}: read-only (${row.readOnlyReason}).`); continue }
      const choice = await ctx.tui.prompt({ title: row.name, question: 'Manage bundle', ...(row.description === undefined ? {} : { detail: row.description }),
        options: [
          ...(row.error !== undefined && !row.enabled ? [] : [{ label: row.enabled ? 'Disable' : 'Enable', value: 'toggle' }]),
          ...(row.removable ? [{ label: 'Remove package', value: 'remove' }] : []),
        ], allowCustom: false, signal })
      if (signal.aborted) break
      if (choice === 'toggle') result = await ctx.pluginManager.setBundleEnabled(row.name, !row.enabled)
      if (choice === 'remove') result = await ctx.pluginManager.removeBundle(row.name)
    } else if (action === 'install') {
      const spec = await ctx.tui.prompt({ title: 'Install bundle', question: 'Package name, version, Git URL, or absolute path', allowCustom: true, signal })
      if (spec === null || spec.trim() === '' || signal.aborted) continue
      const inspected = await ctx.pluginManager.inspect(spec.trim(), undefined, signal)
      if (inspected.status === 'refused') { ctx.tui.notice(inspected.reason, { level: 'error' }); continue }
      const consent = await ctx.tui.prompt({ title: 'Install bundle', question: inspected.name ?? spec.trim(),
        detail: `${inspected.version ?? ''} ${inspected.description ?? ''}\nInstalled Host code runs with your user permissions and affects all sessions in this profile.`,
        options: [{ label: 'Install and enable', value: 'install' }], allowCustom: false, signal })
      if (consent !== 'install' || signal.aborted) continue
      result = await install(ctx, spec.trim(), signal)
      if (result.pendingBuilds?.length && !signal.aborted) {
        ctx.tui.commandOutput('/plugins', changeText(result))
        const approved = await ctx.tui.prompt({ title: 'Dependency scripts', question: 'Allow these scripts and retry?',
          detail: `${result.pendingBuilds.join('\n')}\nPermission persists by package name in this profile. Scripts run with your user permissions.`,
          options: [{ label: 'Allow scripts and retry', value: 'approve' }], allowCustom: false, signal })
        if (approved === 'approve' && !signal.aborted) result = await install(ctx, spec.trim(), signal, result.pendingBuilds)
      }
    }
    if (result !== undefined) ctx.tui.commandOutput('/plugins', changeText(result))
  }
  return { kind: 'success' }
}

export function apply(ctx: Context): void {
  const closing = new AbortController()
  registerCommands(ctx, [{ name: 'plugins', description: 'Manage profile plugins and bundles', handler: async invocation => {
    try { return await manage(ctx, invocation, AbortSignal.any([invocation.signal, closing.signal])) }
    catch (error) { return { kind: 'error', text: error instanceof Error ? error.message : String(error) } }
  } }], 'omdsh plugin commands')
  ctx.effect(() => () => { closing.abort() })
}
