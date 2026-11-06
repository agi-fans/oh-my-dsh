/** Native profile management over the published Harness transaction service. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { BundleInfo, ChangeResult, PluginInfo, PluginInstallRequestId } from '@deepseek-ai/dsh-plugin-manager'
// The market service declares itself on Context; the type import is what makes
// `ctx.get('pluginMarket')` typed, and it is what keeps the dependency honest.
import type PluginMarket from '@deepseek-ai/dsh-plugin-market'
import { startCreator } from './session-configuration.ts'
import { registerCommands } from './registration.ts'
import { askPrompt, confirmPrompt } from '../prompt-intents.ts'
import { editSettingsEntry, nativeIntegrationId, pluginSettingsEntries, showIntegrationStatus } from '../runtime/plugin-settings.ts'
import { externalAgentGuide, externalAgentSummary } from '../session/external-agents.ts'
import { readReference } from '../runtime/reference-reader.ts'
import { createPromptBrowser } from '../runtime/prompt-browser.ts'
import { resolveUiLanguage, uiText } from '../locale/index.ts'
import type { TuiDocumentPosition, TuiPrompt } from '../definition.ts'

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

function changeSummary(result: ChangeResult): string {
  const selection = result.application === 'cancelled' || result.application === 'failed' || result.enabled === undefined
    ? '' : result.enabled ? ' · enabled' : ' · disabled'
  const restart = result.application === 'restart-required' && result.restartReason !== undefined
    ? ` · restart required (${result.restartReason})` : ''
  return `${result.target}: ${result.application}${selection}${restart}`
}

export function changeText(result: ChangeResult): string {
  return [
    changeSummary(result),
    ...(result.error === undefined ? [] : [result.error.diagnostic ?? result.error.code]),
    ...(result.error?.incompatible ?? []).map(item => `${item.name}@${item.version}: DSH ${item.runtimeVersion} rejects ${JSON.stringify(item.requirements)}`),
    ...(result.warnings ?? []),
    ...(result.packageResult === undefined ? [] : [result.packageResult.output, `Full installation log: ${result.packageResult.logPath}`]),
  ].filter(Boolean).join('\n')
}

/** Keep the observed outcome beside the operation, with full logs on demand. */
function changeFeedback(result: ChangeResult | undefined): Pick<TuiPrompt, 'detail' | 'actions'> {
  if (result === undefined) return {}
  return {
    detail: changeSummary(result),
    actions: [{ key: 'Alt+D', label: 'details', valuePrefix: 'result:', scope: 'list' }],
  }
}

async function readChangeDetails(ctx: Context, result: ChangeResult | undefined, signal: AbortSignal): Promise<void> {
  if (result === undefined || signal.aborted) return
  const text = changeText(result)
  if (ctx.tui.interactive === false) { ctx.tui.commandOutput('/plugins', text); return }
  let position: TuiDocumentPosition | undefined
  while (!signal.aborted) {
    const action = await ctx.tui.prompt({ localize: ['options'], title: result.target, question: '',
      presentation: 'document', documentSource: { text }, allowCustom: false, notify: false, signal,
      ...(position === undefined ? {} : { documentPosition: position }),
      onDocumentPosition: value => { position = value },
      options: [{ label: 'Back', value: 'back' },
        ...(ctx.tui.copyText === undefined ? [] : [{ label: 'Copy details', value: 'copy' }])],
    })
    if (signal.aborted || action !== 'copy') return
    await ctx.tui.copyText?.(text, result.target)
  }
}

function bundleStatus(row: BundleInfo): string {
  if (row.availability === 'missing') return row.installed ? 'Package unavailable' : 'Not installed'
  return `Installed · ${row.enabled ? 'Enabled' : 'Disabled'}`
}

const list = { filterable: true, allowCustom: false, notify: false }

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
  const prompt = ctx.tui.prompt({ localize: true,
    title: 'Install plugin', question: spec, presentation: 'progress',
    detail, refreshDocument: () => detail, notify: false,
    allowCustom: false, signal: AbortSignal.any([signal, promptAbort.signal]),
  }).then(() => { if (!promptAbort.signal.aborted) cancel() }, () => { if (!promptAbort.signal.aborted) cancel() })
  try { return await operation }
  finally { promptAbort.abort(); await prompt; off(); signal.removeEventListener('abort', cancel) }
}

async function confirmInstall(ctx: Context, spec: string, signal: AbortSignal, saveExact = false): Promise<ChangeResult | undefined> {
  const inspected = await ctx.pluginManager.inspect(spec, undefined, signal)
  if (inspected.status === 'refused') { await readReference(ctx.tui, spec, inspected.reason, signal); return }
  const consent = await confirmPrompt(request => ctx.tui.prompt(request), { localize: ['title', 'options', 'actions'],
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
    const approved = await confirmPrompt(request => ctx.tui.prompt(request), { localize: ['title', 'options', 'actions'],
      title: 'Dependency scripts',
      question: 'Allow these scripts and retry?',
      detail: `${changeSummary(result)}\n\n${result.pendingBuilds.join('\n')}\nPermission persists by package name in this profile. Scripts run with your user permissions.`,
      acceptLabel: 'Allow scripts and retry',
      cancelLabel: null,
      signal,
    })
    if (approved && !signal.aborted) result = await install(ctx, spec, signal, result.pendingBuilds, saveExact)
  }
  return result
}

/** Index text in the reader's language when the index offers one. */
function marketText(text: { readonly en: string } | string): string {
  return typeof text === 'string' ? text : text.en
}

async function discover(ctx: Context, signal: AbortSignal, onSuperseded: () => void): Promise<void> {
  const prompt = (request: TuiPrompt) => ctx.tui.prompt({ dismissLabel: 'Back', ...request, signal: request.signal ?? signal, onSuperseded })
  const market: PluginMarket | undefined = ctx.get('pluginMarket')
  const t = (text: string) => uiText(resolveUiLanguage(ctx.tui.prefs?.().uiLanguage), text)
  if (market === undefined) {
    await readReference(ctx.tui, t('Discover plugins'), t('The plugin market is not mounted in this profile.'), signal)
    return
  }
  const searchPrompt = (query: string) => prompt(askPrompt({ localize: ['title', 'question', 'actions'],
    title: 'Discover plugins', question: 'Search the plugin indexes (empty lists everything)', initialInput: query, signal }))
  const initialQuery = await searchPrompt('')
  if (initialQuery === null || signal.aborted) return
  let query = initialQuery
  type Page = Awaited<ReturnType<PluginMarket['search']>>
  let entries: { page: Page; entry: Page['entries'][number] }[] = []
  const pages = new Map<string, Page>()
  const failures = new Map<string, { offset: number; message: string }>()
  let diagnostic = '', result: ChangeResult | undefined
  const load = async (mode: 'first' | 'refresh' | 'more' | 'retry' = 'first'): Promise<void> => {
    const sources = market.listIndexes()
    const usable = sources.filter(source => source.error === undefined)
    for (const url of pages.keys()) if (!usable.some(source => source.url === url)) pages.delete(url)
    for (const url of failures.keys()) if (!usable.some(source => source.url === url)) failures.delete(url)
    const requests = usable.flatMap(source => {
      const previous = pages.get(source.url)
      const failure = failures.get(source.url)
      const offset = mode === 'more' ? previous?.nextOffset
        : mode === 'retry' ? failure?.offset : 0
      return offset == null ? [] : [{ url: source.url, offset, previous }]
    })
    // The published search API has no per-request abort. Dismissal abandons
    // this read, and only the winning result may update the browser state.
    const dismissed = new AbortController()
    const readSignal = AbortSignal.any([signal, dismissed.signal])
    const progressEnd = new AbortController()
    let progress: Promise<unknown> | undefined
    let stop!: () => void
    const stopped = new Promise<null>(resolve => { stop = () => resolve(null) })
    readSignal.addEventListener('abort', stop, { once: true })
    if (readSignal.aborted) stop()
    const timer = setTimeout(() => {
      if (readSignal.aborted) return
      progress = prompt({ localize: true, title: 'Discover plugins', question: 'Loading plugins…',
        detail: t('Esc returns to the results.'), presentation: 'progress', allowCustom: false, notify: false,
        signal: AbortSignal.any([readSignal, progressEnd.signal]),
      }).then(() => { if (!progressEnd.signal.aborted) dismissed.abort() }, () => dismissed.abort())
    }, 150)
    try {
      const operation = Promise.allSettled(requests.map(async ({ url, offset, previous }) => {
        const queryOptions = { ...(query.trim() === '' ? {} : { text: query.trim() }), sort: { kind: 'relevance' as const }, limit: 20 }
        let page = await market.search(url, { ...queryOptions, offset,
          ...(mode === 'refresh' || (mode === 'retry' && offset === 0) ? { refresh: true } : {}),
          ...(offset > 0 && previous !== undefined ? { fetchedAt: previous.fetchedAt } : {}),
        })
        if (readSignal.aborted) return page
        if (offset > 0 && previous !== undefined) {
          if (page.fetchedAt === previous.fetchedAt) page = { ...page, entries: [...previous.entries, ...page.entries] }
          else page = await market.search(url, { ...queryOptions, offset: 0, fetchedAt: page.fetchedAt })
        }
        return page
      }))
      const settled = await Promise.race([operation, stopped])
      if (signal.aborted) return
      if (settled === null || readSignal.aborted) {
        diagnostic = t('Loading cancelled. Refresh to try again.')
        return
      }
      settled.forEach((response, index) => {
        const request = requests[index]!
        if (response.status === 'fulfilled') {
          pages.set(request.url, response.value)
          failures.delete(request.url)
        } else failures.set(request.url, { offset: request.offset,
          message: response.reason instanceof Error ? response.reason.message : String(response.reason) })
      })
      entries = [...pages.values()].flatMap(page => page.entries.map(entry => ({ page, entry })))
      diagnostic = sources.length === 0 ? t('No plugin index sources are configured. Add one in Settings to browse a market.')
        : [...sources.filter(source => source.error !== undefined).map(source => `${source.url} · ${source.error}`),
          ...[...failures].map(([url, failure]) => `${url} · ${failure.message}`)].join('\n')
    } finally {
      clearTimeout(timer)
      progressEnd.abort()
      await progress
      readSignal.removeEventListener('abort', stop)
    }
  }
  const browse = createPromptBrowser(prompt)
  await load()
  while (!signal.aborted) {
    const feedback = changeFeedback(result)
    const total = [...pages.values()].reduce((sum, page) => sum + page.total, 0)
    const count = pages.size === 0 ? '' : t('Showing {loaded} of {total} plugins').replace('{loaded}', String(entries.length)).replace('{total}', String(total))
    const chosen = await browse({ localize: ['title', 'actions'], ...list,
      title: 'Discover plugins', question: query,
      detail: [count, diagnostic, feedback.detail].filter(Boolean).join('\n'), emptyText: t('No matching plugins.'),
      options: entries.map(({ page, entry }) => {
        const version = entry.versions.find(item => item.version === entry.defaultVersion) ?? entry.versions[0]
        return {
          label: entry.name, value: JSON.stringify([page.url, entry.name]),
          description: [entry.defaultVersion ?? '', marketText(page.title),
            entry.installation.status === 'installed' ? t('Installed') : '',
            version?.compatibility.compatible === false ? t('Incompatible') : '',
          ].filter(Boolean).join(' · '),
          ...(entry.description === undefined ? {} : { preview: marketText(entry.description) }),
        }
      }),
      actions: [
        { key: 'Alt+S', label: 'search', valuePrefix: 'search:', scope: 'list' },
        { key: 'Alt+R', label: 'refresh', valuePrefix: 'refresh:', scope: 'list' },
        ...([...pages.values()].some(page => page.nextOffset !== null) ? [{ key: 'Alt+N', label: 'load more', valuePrefix: 'more:', scope: 'list' as const }] : []),
        ...(failures.size > 0 ? [{ key: 'Alt+T', label: 'retry', valuePrefix: 'retry:', scope: 'list' as const }] : []),
        ...(feedback.actions ?? []),
      ], signal,
    }, query)
    if (chosen === null || signal.aborted) return
    if (chosen === 'result:') { await readChangeDetails(ctx, result, signal); continue }
    if (chosen === 'search:') {
      const next = await searchPrompt(query)
      if (next === null || signal.aborted) continue
      if (next !== query) { entries = []; pages.clear(); failures.clear(); result = undefined }
      query = next
      await load()
      continue
    }
    if (chosen === 'refresh:') { await load('refresh'); continue }
    if (chosen === 'more:') { await load('more'); continue }
    if (chosen === 'retry:') { await load('retry'); continue }
    const picked = entries.find(({ page, entry }) => JSON.stringify([page.url, entry.name]) === chosen)
    if (picked === undefined) continue
    const version = picked.entry.versions.find(item => item.version === picked.entry.defaultVersion) ?? picked.entry.versions[0]
    if (version === undefined) { diagnostic = `${picked.entry.name} lists no version.`; continue }
    if (version.compatibility.compatible === false) {
      diagnostic = `${picked.entry.name} ${version.version} requires ${Object.entries(version.compatibility.requirements).map(([key, value]) => `${key} ${value}`).join(', ')}.`
      continue
    }
    try {
      const change = await confirmInstall(ctx, version.install.spec, signal, true)
      if (change !== undefined) { result = change; await load() }
    } catch (error) { diagnostic = error instanceof Error ? error.message : String(error) }
  }
}

async function inspectPluginEntry(ctx: Context, row: PluginInfo, signal: AbortSignal): Promise<ChangeResult | undefined> {
  const language = resolveUiLanguage(ctx.tui.prefs?.().uiLanguage)
  const t = (text: string) => uiText(language, text)
  const description = row.meta?.description
  const introduction = typeof description === 'string' ? description : description?.[language] ?? description?.en
  const reason = pluginReadOnly(row)
  const text = [
    `${t('Module')}  ${row.moduleName}`,
    `${t('Plugin entry')}  ${row.patchId ?? row.entryId}`,
    `${t('Status')}  ${t(row.enabled ? 'Enabled' : 'Disabled')}`,
    `${t('Load state')}  ${row.fiberPhase ?? t('Not mounted')}`,
    ...(introduction === undefined ? [] : ['', introduction]),
    ...(reason === undefined ? [] : ['', `${t('Read-only')}  ${reason === 'terminal-required' ? t('Required by the terminal.') : reason}`]),
    ...(row.diagnostic === undefined ? [] : ['', t('Diagnostic'), row.diagnostic]),
    ...(row.meta?.error === undefined ? [] : ['', t('Diagnostic'), row.meta.error]),
  ].join('\n')
  let position: TuiDocumentPosition | undefined
  while (!signal.aborted) {
    const action = await ctx.tui.prompt({ localize: ['options'], title: row.moduleName, question: '',
      presentation: 'document', documentSource: { text }, allowCustom: false, notify: false, signal,
      ...(position === undefined ? {} : { documentPosition: position }),
      onDocumentPosition: value => { position = value },
      options: [{ label: 'Back', value: 'back' },
        ...(ctx.tui.copyText === undefined ? [] : [{ label: 'Copy details', value: 'copy' }]),
        ...(reason === undefined ? [{ label: row.enabled ? 'Disable' : 'Enable', value: 'toggle' }] : [])] })
    if (signal.aborted || action === null || action === 'back') return
    if (action === 'copy') await ctx.tui.copyText?.(text, t('Plugin entry'))
    if (action === 'toggle' && reason === undefined) {
      const confirmed = await confirmPrompt(request => ctx.tui.prompt(request), { localize: ['title', 'options'],
        title: 'Plugin entry', question: row.moduleName, acceptLabel: row.enabled ? 'Disable' : 'Enable', cancelLabel: null, signal })
      if (confirmed && !signal.aborted) {
        const current = (await ctx.pluginManager.listPlugins()).find(item => item.entryId === row.entryId)
        if (signal.aborted || current === undefined || current.enabled !== row.enabled || pluginReadOnly(current) !== undefined) return
        return ctx.pluginManager.setPluginEnabled(row.entryId, !row.enabled)
      }
    }
  }
}

async function browseBundles(ctx: Context, signal: AbortSignal, configurationCtx?: Context): Promise<void> {
  const browse = createPromptBrowser(request => ctx.tui.prompt(request))
  let result: ChangeResult | undefined
  while (!signal.aborted) {
    const rows = await ctx.pluginManager.listBundles()
    const selected = await browse({ localize: true, ...list, ...changeFeedback(result), title: 'Bundles', question: 'Choose a bundle',
      options: rows.map(row => ({ label: row.name, value: row.name,
        description: `${row.version ?? row.installTarget?.version ?? ''} · ${bundleStatus(row)}${row.error === undefined ? '' : ` · ${row.error.diagnostic ?? row.error.code}`}` })), signal })
    if (selected === null || signal.aborted) return
    if (selected === 'result:') { await readChangeDetails(ctx, result, signal); continue }
    if (!rows.some(row => row.name === selected)) continue
    let choice: string | null = null
    while (!signal.aborted) {
      const row = (await ctx.pluginManager.listBundles()).find(row => row.name === selected)
      if (row === undefined || signal.aborted) break
      const guide = externalAgentGuide(row.name)
      const integration = nativeIntegrationId(row.name)
      const ownership = row.availability === 'installation'
        ? `Included with omdsh. ${integration === undefined ? 'Use Enable or Disable to manage this bundle.' : 'Open Integration settings to enable or disable it.'} It updates with omdsh and cannot be uninstalled separately.`
        : row.installed ? 'Installed in this profile. Uninstall unloads the bundle and removes its package from this profile.' : undefined
      const language = resolveUiLanguage(ctx.tui.prefs?.().uiLanguage)
      const detail = [ownership, externalAgentSummary(row.name, language) ?? row.description].filter(Boolean).join('\n\n')
      choice = await ctx.tui.prompt({ localize: true, title: row.name, question: 'Manage bundle', ...changeFeedback(result),
        detail: [detail, row.readOnlyReason, changeFeedback(result).detail].filter(Boolean).join('\n\n'),
        ...(choice === null ? {} : { initialValue: choice }),
        options: row.readOnlyReason === undefined ? [
          ...(guide === undefined || row.availability !== 'missing' && integration !== undefined ? [] : [{ label: 'Check profile status', value: 'check' }]),
          ...(integration === undefined || row.availability === 'missing' ? [] : [{ label: 'Integration settings', value: 'settings' }]),
          ...(row.installTarget === undefined || row.availability === 'installation' ? [] : [{ label: row.availability === 'missing' ? 'Install' : 'Reinstall', value: 'install' }]),
          ...(integration !== undefined || row.availability === 'missing' || row.error !== undefined && !row.enabled ? [] : [{ label: row.enabled ? 'Disable' : 'Enable', value: 'toggle' }]),
          ...(row.removable ? [{ label: row.installed ? 'Uninstall' : 'Remove from profile', value: 'remove' }] : []),
          ...(guide === undefined || row.availability !== 'missing' ? [] : [{ label: 'Usage notes', value: 'guide' }]),
        ] : [], allowCustom: false, notify: false, signal })
      if (signal.aborted || choice === null) break
      if (choice === 'result:') { await readChangeDetails(ctx, result, signal); continue }
      if (choice === 'check' && guide !== undefined) await showIntegrationStatus(ctx, row.name, signal)
      if (choice === 'guide' && guide !== undefined) await readReference(ctx.tui, `${row.name} · ${uiText(language, 'Usage notes')}`, guide, signal)
      if (choice === 'settings' && integration !== undefined) await editSettingsEntry(configurationCtx ?? ctx, integration, signal)
      if (choice === 'install' && row.installTarget !== undefined) result = await confirmInstall(ctx, row.installTarget.spec, signal, true) ?? result
      if (choice === 'toggle') result = await ctx.pluginManager.setBundleEnabled(row.name, !row.enabled)
      if (choice === 'remove' && row.removable) {
        const consent = await confirmPrompt(request => ctx.tui.prompt(request), { localize: ['title', 'options', 'actions'],
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
    }
  }
}

async function manage(ctx: Context, invocation: CommandInvocation, signal: AbortSignal, configurationCtx?: Context): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /plugins' }
  if (invocation.agent.status === 'running') return { kind: 'error', text: 'Wait for the current turn to finish before managing plugins.' }
  const navigation = new AbortController()
  signal = AbortSignal.any([signal, navigation.signal])
  const onSuperseded = (): void => navigation.abort()
  const browse = createPromptBrowser(request => ctx.tui.prompt({ ...request, onSuperseded }))
  let result: ChangeResult | undefined
  while (!signal.aborted) {
    const runtime = ctx.get('omdshSession')
    const creator = runtime === undefined ? undefined : (await runtime.agentPresets()).find(preset => preset.id === 'cordis')
    if (signal.aborted) break
    const action = await browse({ localize: true, ...list, ...changeFeedback(result), title: 'Plugins', question: 'Manage this profile',
      detail: [uiText(resolveUiLanguage(ctx.tui.prefs?.().uiLanguage), 'Changes affect every session using this profile. Package replacements may require a restart.'), changeFeedback(result).detail].filter(Boolean).join('\n\n'),
      options: [
        ...(configurationCtx === undefined ? [] : [{ label: 'Configure plugins', value: 'configure', description: 'Shell, subagents, web providers and installed plugin settings.' }]),
        ...(runtime === undefined ? [] : [{ label: 'Let the agent create a plugin', value: 'creator', disabled: creator === undefined || creator.broken !== undefined, description: creator === undefined ? 'Creator is unavailable in this profile.' : creator.broken ?? 'Start Creator without changing your default Agent preset.' }]),
        { label: 'Plugin entries', value: 'entries' },
        { label: 'Bundles', value: 'bundles' },
        { label: 'Discover', value: 'discover', description: 'Browse the plugin indexes this profile configures and install an entry.' },
        { label: 'Install bundle', value: 'install' },
      ], signal })
    if (action === null) break
    if (action === 'result:') { await readChangeDetails(ctx, result, signal); continue }
    if (action === 'creator') return startCreator(ctx, { ...invocation, signal })
    if (action === 'configure') {
      if (configurationCtx === undefined) continue
      while (!signal.aborted) {
        const entries = pluginSettingsEntries(configurationCtx).filter(entry => ['tools', 'agent', 'integrations', 'advanced'].includes(entry.section ?? 'advanced'))
        const id = await browse({ localize: true, ...list, title: 'Plugin settings', question: 'Choose a plugin to configure',
          options: entries.map(entry => ({ label: entry.label, value: entry.id, description: entry.summary ?? entry.description })), signal })
        if (id === null || signal.aborted) break
        if (entries.some(entry => entry.id === id)) await editSettingsEntry(configurationCtx, id, signal)
      }
      continue
    }
    if (action === 'discover') { await discover(ctx, signal, onSuperseded); continue }
    if (action === 'entries') {
      let entryResult: ChangeResult | undefined
      while (!signal.aborted) {
        const rows = await ctx.pluginManager.listPlugins()
        if (signal.aborted) break
        const id = await browse({ localize: true, ...list, ...changeFeedback(entryResult), title: 'Plugin entries', question: 'Choose an entry to inspect',
          options: rows.map(row => ({ label: row.patchId ?? String(row.entryId), value: String(row.entryId),
            description: `${row.enabled ? 'Enabled' : 'Disabled'} · ${row.fiberPhase ?? 'not mounted'} · ${row.moduleName}${pluginReadOnly(row) === undefined ? '' : ` · ${pluginReadOnly(row)}`}` })), signal })
        if (id === 'result:') { await readChangeDetails(ctx, entryResult, signal); continue }
        const row = rows.find(row => row.entryId === id)
        if (row === undefined || signal.aborted) break
        const change = await inspectPluginEntry(ctx, row, signal)
        if (change !== undefined) entryResult = change
      }
    } else if (action === 'bundles') {
      await browseBundles(ctx, signal, configurationCtx)
    } else if (action === 'install') {
      const spec = await ctx.tui.prompt(askPrompt({ localize: ['title', 'question', 'actions'], title: 'Install bundle', question: 'Package name, version, Git URL, or absolute path', signal }))
      if (spec === null || spec.trim() === '' || signal.aborted) continue
      result = await confirmInstall(ctx, spec.trim(), signal) ?? result
    }
  }
  return { kind: 'success' }
}

export function apply(ctx: Context): void {
  const closing = new AbortController()
  const configurations = new Map<string, { ctx: Context; signal: AbortSignal }>()
  // Configuration is optional. Each editor receives the services declared by its scope.
  for (const services of [['settings'], ['settings', 'credentials']]) {
    const key = services.join(',')
    ctx.inject(services, configurationCtx => {
      const lifetime = new AbortController()
      configurations.set(key, { ctx: configurationCtx, signal: lifetime.signal })
      configurationCtx.effect(() => () => { configurations.delete(key); lifetime.abort() })
    })
  }
  registerCommands(ctx, [{ name: 'plugins', description: 'Manage profile plugins and bundles', handler: async invocation => {
    const configuration = configurations.get('settings,credentials') ?? configurations.get('settings')
    const signal = AbortSignal.any([invocation.signal, closing.signal, ...(configuration === undefined ? [] : [configuration.signal])])
    try { return await manage(ctx, invocation, signal, configuration?.ctx) }
    catch (error) { return { kind: 'error', text: error instanceof Error ? error.message : String(error) } }
  } }], 'omdsh plugin commands')
  ctx.effect(() => () => { closing.abort() })
}
