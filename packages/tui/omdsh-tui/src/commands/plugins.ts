/** Native profile management over the published Harness transaction service. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { BundleInfo, ChangeResult, PluginInfo, PluginInstallRequestId } from '@deepseek-ai/dsh-plugin-manager'
import { registerCommands } from './registration.ts'
import { askPrompt, confirmPrompt } from '../prompt-intents.ts'
import { editSettingsEntry, nativeIntegrationId, showIntegrationStatus } from '../runtime/plugin-settings.ts'
import { externalAgentGuide } from '../session/external-agents.ts'

export const name = 'omdsh-command-plugins'
export const inject = ['commands', 'pluginManager', 'tui']

// Removing the command's own presentation or session owner during its awaited
// handler would make disposal wait for the operation that caused disposal.
const TERMINAL_OWNERS = new Set([
  'commands', 'agent', 'session', 'agent-preset-registry', 'tools', 'llm',
  'settings', 'config-editor', 'credentials', 'agent-default-model',
  'session-persistence', 'session-projection', 'authorization', 'approval',
  'user-questions', 'plan-mode', 'working-directory',
])

export function pluginReadOnly(row: PluginInfo): string | undefined {
  if (row.moduleName.startsWith('@agi-fans/') || TERMINAL_OWNERS.has(row.patchId ?? '')) return 'terminal-required'
  return row.readOnlyReason
}

export function changeText(result: ChangeResult): string {
  const selection = result.application === 'cancelled' || result.application === 'failed' || result.enabled === undefined
    ? '' : result.enabled ? ' · enabled' : ' · disabled'
  const restart = result.application === 'restart-required' && result.restartReason !== undefined
    ? ` · restart required (${result.restartReason})` : ''
  return [
    `${result.target}: ${result.application}${selection}${restart}`,
    ...(result.error === undefined ? [] : [result.error.diagnostic ?? result.error.code]),
    ...(result.error?.incompatible ?? []).map(item => `${item.name}@${item.version}: DSH ${item.runtimeVersion} rejects ${JSON.stringify(item.requirements)}`),
    ...(result.warnings ?? []),
    ...(result.packageResult === undefined ? [] : [result.packageResult.output, `Full installation log: ${result.packageResult.logPath}`]),
  ].filter(Boolean).join('\n')
}

function bundleStatus(row: BundleInfo): string {
  if (row.availability === 'missing') return row.installed ? 'Package unavailable' : 'Not installed'
  return `Installed · ${row.enabled ? 'Enabled' : 'Disabled'}`
}

const list = { presentation: 'fullscreen-list' as const, filterable: true, allowCustom: false, optionLayout: 'compact' as const, notify: false }

async function install(ctx: Context, spec: string, signal: AbortSignal, approvedBuilds?: string[], saveExact = false): Promise<ChangeResult> {
  signal.throwIfAborted()
  const requestId = randomUUID() as PluginInstallRequestId
  const promptAbort = new AbortController()
  let detail = 'Installing into this profile. Esc or Ctrl+C cancels; applying a finished installation cannot be cancelled.'
  const cancel = (): void => { void ctx.pluginManager.cancelInstall(requestId).catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  const off = ctx.on('plugin-manager/install-state', progress => {
    if (progress.requestId !== requestId) return
    const attempt = progress.attempt
    detail = `Plugin ${progress.phase}${attempt === undefined ? '' : ` · ${attempt.index}/${attempt.total} · ${attempt.registry ?? 'configured registry'}`}\n\nEsc or Ctrl+C cancels.`
    if (progress.phase === 'applying') promptAbort.abort()
  })
  const operation = ctx.pluginManager.installBundle(spec, { requestId, saveExact, ...(approvedBuilds === undefined ? {} : { approvedBuilds }) })
  // The installer owns cancellation through restoration, even after the
  // prompt closes. Never abandon its promise or report cancellation early.
  const prompt = ctx.tui.prompt({
    title: 'Install plugin', question: spec, presentation: 'progress',
    detail, refreshDocument: () => detail, notify: false,
    allowCustom: false, signal: AbortSignal.any([signal, promptAbort.signal]),
  }).then(() => { if (!promptAbort.signal.aborted) cancel() }, () => { if (!promptAbort.signal.aborted) cancel() })
  try { return await operation }
  finally { promptAbort.abort(); await prompt; off(); signal.removeEventListener('abort', cancel) }
}

async function confirmInstall(ctx: Context, spec: string, signal: AbortSignal, saveExact = false): Promise<ChangeResult | undefined> {
  const inspected = await ctx.pluginManager.inspect(spec, undefined, signal)
  if (inspected.status === 'refused') { ctx.tui.notice(inspected.reason, { level: 'error' }); return }
  const consent = await confirmPrompt(request => ctx.tui.prompt(request), {
    title: 'Install bundle',
    question: inspected.name ?? spec,
    detail: `${inspected.version ?? ''} ${inspected.description ?? ''}\nInstalled Host code runs with your user permissions and affects all sessions in this profile.`,
    acceptLabel: 'Install and enable',
    // Nothing to put opposite "install": the reader either proceeds or leaves.
    cancelLabel: null,
    signal,
  })
  if (!consent || signal.aborted) return
  let result = await install(ctx, spec, signal, undefined, saveExact)
  if (result.pendingBuilds?.length && !signal.aborted) {
    ctx.tui.commandOutput('/plugins', changeText(result))
    const approved = await confirmPrompt(request => ctx.tui.prompt(request), {
      title: 'Dependency scripts',
      question: 'Allow these scripts and retry?',
      detail: `${result.pendingBuilds.join('\n')}\nPermission persists by package name in this profile. Scripts run with your user permissions.`,
      acceptLabel: 'Allow scripts and retry',
      cancelLabel: null,
      signal,
    })
    if (approved && !signal.aborted) result = await install(ctx, spec, signal, result.pendingBuilds, saveExact)
  }
  return result
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
      const choice = await confirmPrompt(request => ctx.tui.prompt(request), {
        title: 'Plugin entry',
        question: row.moduleName,
        acceptLabel: row.enabled ? 'Disable' : 'Enable',
        cancelLabel: null,
        signal,
      })
      if (choice && !signal.aborted) result = await ctx.pluginManager.setPluginEnabled(row.entryId, !row.enabled)
    } else if (action === 'bundles') {
      const rows = await ctx.pluginManager.listBundles()
      const selected = await ctx.tui.prompt({ ...list, title: 'Bundles', question: 'Choose a bundle',
        options: rows.map(row => ({ label: row.name, value: row.name,
          description: `${row.version ?? row.installTarget?.version ?? ''} · ${bundleStatus(row)}${row.error === undefined ? '' : ` · ${row.error.diagnostic ?? row.error.code}`}` })), signal })
      const row = rows.find(row => row.name === selected)
      if (row === undefined) continue
      if (row.readOnlyReason !== undefined) { ctx.tui.notice(`${row.name}: read-only (${row.readOnlyReason}).`); continue }
      const guide = externalAgentGuide(row.name)
      const integration = nativeIntegrationId(row.name)
      const ownership = row.availability === 'installation'
        ? `Included with omdsh. ${integration === undefined ? 'Use Enable or Disable to manage this bundle.' : 'Open Integration settings to enable or disable it.'} It updates with omdsh and cannot be uninstalled separately.`
        : row.installed ? 'Installed in this profile. Uninstall unloads the bundle and removes its package from this profile.' : undefined
      const detail = [ownership, guide ?? row.description].filter(Boolean).join('\n\n')
      const choice = await ctx.tui.prompt({ title: row.name, question: 'Manage bundle', ...(detail === '' ? {} : { detail }),
        options: [
          ...(guide === undefined || row.availability !== 'missing' && integration !== undefined ? [] : [{ label: 'Check profile status', value: 'check' }]),
          ...(integration === undefined || row.availability === 'missing' ? [] : [{ label: 'Integration settings', value: 'settings' }]),
          ...(row.installTarget === undefined || row.availability === 'installation' ? [] : [{ label: row.availability === 'missing' ? 'Install' : 'Reinstall', value: 'install' }]),
          ...(integration !== undefined || row.availability === 'missing' || row.error !== undefined && !row.enabled ? [] : [{ label: row.enabled ? 'Disable' : 'Enable', value: 'toggle' }]),
          ...(row.removable ? [{ label: row.installed ? 'Uninstall' : 'Remove from profile', value: 'remove' }] : []),
        ], allowCustom: false, notify: false, signal })
      if (signal.aborted) break
      if (choice === 'check' && guide !== undefined) await showIntegrationStatus(ctx, row.name, signal)
      if (choice === 'settings' && integration !== undefined) await editSettingsEntry(ctx, integration, signal)
      if (choice === 'install' && row.installTarget !== undefined) result = await confirmInstall(ctx, row.installTarget.spec, signal, true)
      if (choice === 'toggle') result = await ctx.pluginManager.setBundleEnabled(row.name, !row.enabled)
      if (choice === 'remove' && row.removable) {
        const consent = await confirmPrompt(request => ctx.tui.prompt(request), {
          title: row.installed ? 'Uninstall bundle' : 'Remove bundle from profile',
          question: row.name,
          detail: row.installed
            ? `Unload this bundle and remove its package for every session using this profile.${guide === undefined ? '' : ' Native login and user settings are kept.'}`
            : 'Remove this bundle from the profile selection. No installed package is removed.',
          acceptLabel: row.installed ? 'Uninstall' : 'Remove from profile',
          cancelLabel: null,
          signal,
        })
        if (consent && !signal.aborted) result = await ctx.pluginManager.removeBundle(row.name)
      }
    } else if (action === 'install') {
      const spec = await ctx.tui.prompt(askPrompt({ title: 'Install bundle', question: 'Package name, version, Git URL, or absolute path', signal }))
      if (spec === null || spec.trim() === '' || signal.aborted) continue
      result = await confirmInstall(ctx, spec.trim(), signal)
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
