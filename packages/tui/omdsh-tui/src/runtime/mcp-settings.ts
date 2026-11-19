/** Live MCP server management over dsh-mcp-manager and dsh-settings. */

import type { Context } from '@deepseek-ai/cordis'
import {
  SERVER_NAME_PATTERN,
  assertTemplateSyntax,
  connectionStatusOf,
  type McpConnectionStatus,
  type McpProbeResult,
} from '@deepseek-ai/dsh-mcp-client'
import type {
  McpManagedServerEntry,
  McpManagedServerStatus,
  McpManagedServerView,
} from '@deepseek-ai/dsh-mcp-manager'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import type { TuiPrompt } from '../definition.ts'
import type { PluginSettingsEntry } from '../views/settings-list.ts'
import { askPrompt, choosePrompt, confirmPrompt } from '../prompt-intents.ts'
import { resolveUiLanguage, uiText } from '../locale/index.ts'

export const MCP_MANAGER_NS = 'mcp-manager'
export const MCP_SETTINGS_ID = 'mcp:servers'

export type TranslateFn = (source: string, values?: Record<string, string | number>) => string

export interface McpPromptSurface {
  prompt(request: TuiPrompt): Promise<string | null>
  notice?(text: string, options?: { level?: 'info' | 'warning' | 'error'; transient?: boolean }): void
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function describeManager(ctx: Context): SettingsDescriptor | undefined {
  return ctx.get('settings')?.describe({ redactSecrets: true }).find(section => section.ns === MCP_MANAGER_NS)
}

function configuredServerMap(value: unknown): Record<string, Partial<McpManagedServerEntry>> {
  if (!isRecord(value) || !isRecord(value.servers)) return {}
  const result: Record<string, Partial<McpManagedServerEntry>> = {}
  for (const [name, entry] of Object.entries(value.servers)) {
    if (isRecord(entry)) result[name] = entry as Partial<McpManagedServerEntry>
  }
  return result
}

/** Read live connection status for a static `@deepseek-ai/dsh-mcp-client` Loader entry when mounted. */
export function staticMcpConnectionStatus(ctx: Context, entryId: string): McpConnectionStatus | undefined {
  const loader = ctx.get('loader')
  if (loader === undefined) return undefined
  const entry = [...loader.entries()].find(candidate => candidate.options.id === entryId)
  return entry?.fiber === undefined ? undefined : connectionStatusOf(entry.fiber)?.current()
}

/** Format any managed or client MCP status for single-line summaries and diagnostics. */
export function formatMcpStatus(
  status: McpManagedServerStatus | undefined,
  t: TranslateFn = (source, values) => uiText('en', source, values),
): string {
  if (status === undefined) return t('not mounted')
  switch (status.state) {
    case 'connected':
      return t('connected · {count} tools', { count: status.toolCount })
    case 'connecting':
      return status.attempt > 0
        ? t('connecting (attempt {attempt})', { attempt: status.attempt + 1 })
        : t('connecting')
    case 'waiting-credentials':
      return status.lastError
        ? `${t('waiting for credentials')} · ${status.lastError}`
        : t('waiting for credentials')
    case 'reconnecting':
      return `${t('reconnecting ({attempt}/{max})', { attempt: status.attempt, max: status.maxAttempts })}${status.lastError ? ` · ${status.lastError}` : ''}`
    case 'disabled':
      return t('disabled')
    case 'closed':
      return status.result.cleanupError
        ? `${t('closed')} · ${status.result.cleanupError}`
        : t('closed')
    case 'failed': {
      if (status.reason === 'cleanup') {
        const detail = status.result.cleanupError ?? (status.result.closeConfirmed ? '' : t('transport closure unconfirmed'))
        return detail ? `${t('failed (cleanup)')} · ${detail}` : t('failed (cleanup)')
      }
      return status.lastError
        ? `${t('failed ({reason})', { reason: status.reason })} · ${status.lastError}`
        : t('failed ({reason})', { reason: status.reason })
    }
  }
}

/** Render a stage-classified MCP probe outcome without leaking credentials. */
export function formatMcpProbeResult(
  name: string,
  result: McpProbeResult,
  t: TranslateFn = (source, values) => uiText('en', source, values),
): string {
  const lines: string[] = []
  if (result.ok) {
    const serverLabel = result.serverInfo ? `${result.serverInfo.name} ${result.serverInfo.version}`.trim() : name
    lines.push(t('Probe succeeded ({duration}ms) · {server} · Tools: {count}', {
      duration: Math.round(result.durationMs),
      server: serverLabel,
      count: result.toolNames.length,
    }))
    if (result.toolNames.length > 0) {
      const preview = result.toolNames.map(tool => `\`${tool}\``).join(', ')
      lines.push(result.truncated ? `${preview} …` : preview)
    }
  } else {
    lines.push(t('Probe failed during {stage} ({duration}ms): {message}', {
      stage: result.stage,
      duration: Math.round(result.durationMs),
      message: result.message,
    }))
  }
  if (!result.closeConfirmed || result.cleanupError !== undefined) {
    lines.push(t('Probe cleanup warning: {detail}', {
      detail: result.cleanupError ?? t('transport closure was not confirmed'),
    }))
  }
  return lines.join('\n')
}

/** Parse optional command arguments from either a JSON string array or shell-like tokens. */
export function parseMcpArgs(raw: string): string[] {
  const trimmed = raw.trim()
  if (trimmed === '') return []
  if (trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed)
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
      throw new Error('Arguments JSON must be an array of strings.')
    }
    return parsed
  }
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const ch of trimmed) {
    if (escaped) { current += ch; escaped = false; continue }
    if (ch === '\\' && quote !== "'") { escaped = true; continue }
    if (quote !== null) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (/\s/u.test(ch)) {
      if (current !== '') { tokens.push(current); current = '' }
      continue
    }
    current += ch
  }
  if (escaped || quote !== null) throw new Error('Unterminated quote or escape in arguments.')
  if (current !== '') tokens.push(current)
  return tokens
}

/** Parse newline- or semicolon-separated `KEY=VALUE` pairs for env or headers. */
export function parseMcpKeyValues(raw: string, kind: 'env' | 'headers'): Record<string, string> {
  const trimmed = raw.trim()
  if (trimmed === '') return {}
  if (trimmed.startsWith('{')) {
    const parsed: unknown = JSON.parse(trimmed)
    if (!isRecord(parsed) || Object.values(parsed).some(item => typeof item !== 'string')) {
      throw new Error(`${kind === 'env' ? 'Environment variables' : 'Headers'} JSON must be a string map.`)
    }
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]))
  }
  const result: Record<string, string> = {}
  for (const segment of trimmed.split(/\r?\n|;/u)) {
    const line = segment.trim()
    if (line === '') continue
    const eq = line.indexOf('=')
    const colon = kind === 'headers' && (eq === -1 || (line.indexOf(':') !== -1 && line.indexOf(':') < eq))
      ? line.indexOf(':')
      : -1
    const sep = colon !== -1 ? colon : eq
    if (sep <= 0) {
      throw new Error(`Invalid ${kind === 'env' ? 'KEY=VALUE' : 'Header=Value'} entry: ${line}`)
    }
    const key = line.slice(0, sep).trim()
    const value = line.slice(sep + 1).trim()
    if (key === '') throw new Error(`Empty key in ${line}`)
    result[key] = value
  }
  return result
}

function summarizeEntry(entry: Partial<McpManagedServerEntry> | undefined, t: TranslateFn): string[] {
  if (entry === undefined) return []
  if (entry.transport === 'streamable-http') {
    const headerKeys = isRecord(entry.headers) ? Object.keys(entry.headers) : []
    return [
      `${t('Transport')}: streamable-http`,
      ...(entry.url ? [`URL: ${entry.url}`] : []),
      ...(headerKeys.length > 0 ? [`${t('Headers')}: ${headerKeys.join(', ')}`] : []),
    ]
  }
  if (entry.transport === 'stdio') {
    const args = Array.isArray(entry.args) && entry.args.length > 0 ? ` ${entry.args.join(' ')}` : ''
    const envKeys = isRecord(entry.env) ? Object.keys(entry.env) : []
    return [
      `${t('Transport')}: stdio`,
      ...(entry.command ? [`${t('Command')}: ${entry.command}${args}`] : []),
      ...(entry.cwd ? [`cwd: ${entry.cwd}`] : []),
      ...(envKeys.length > 0 ? [`env: ${envKeys.join(', ')}`] : []),
    ]
  }
  return []
}

function managerSummary(ctx: Context): string {
  const views = ctx.get('mcpManager')?.list()
  if (views === undefined) return 'Configure'
  if (views.length === 0) return 'None configured'
  const connected = views.filter(view => view.status.state === 'connected').length
  return connected > 0 ? `${connected}/${views.length} connected` : `${views.length} configured`
}

export function mcpSettingsEntry(ctx: Context): PluginSettingsEntry[] {
  if (ctx.get('mcpManager') === undefined && describeManager(ctx) === undefined) return []
  const writable = ctx.get('settings')?.writable === true
  return [{
    id: MCP_SETTINGS_ID,
    label: 'MCP servers',
    section: 'integrations',
    subgroup: 'MCP',
    fields: [],
    behavior: writable ? 'Profile · Saves immediately · Live' : 'Profile · Read only',
    summary: managerSummary(ctx),
    keywords: ['mcp', 'servers', 'stdio', 'streamable-http', 'tools'],
    description: 'Add, enable, probe, restart, or remove live MCP servers. Static mcp.json servers continue to mount alongside them.',
  }]
}

/** Interactive wizard to add a stdio or streamable-http MCP server to `mcp-manager`. */
export async function promptAddMcpServer(
  ctx: Context,
  tui: McpPromptSurface,
  signal: AbortSignal,
): Promise<string | null> {
  const language = resolveUiLanguage(ctx.get('tui')?.prefs?.().uiLanguage)
  const t: TranslateFn = (source, values) => uiText(language, source, values)
  const settings = ctx.get('settings')
  if (settings === undefined || !settings.writable) {
    tui.notice?.(t('This profile is read-only.'), { level: 'error' })
    return null
  }
  const section = describeManager(ctx)
  if (section === undefined) {
    tui.notice?.(t('MCP manager configuration is unavailable in this host.'), { level: 'error' })
    return null
  }
  const readField = async <T>(
    request: Parameters<typeof askPrompt>[0],
    parse: (raw: string) => T,
    optional = false,
  ): Promise<T | null> => {
    let initialInput: string | undefined
    let detail = request.detail ?? ''
    while (!signal.aborted) {
      const input = await tui.prompt({ ...askPrompt({
        ...request, detail, signal, ...(initialInput === undefined ? {} : { initialInput }),
      }), ...(optional ? { skippable: true } : {}) })
      if (input === null || signal.aborted) return null
      initialInput = input
      try { return parse(input) }
      catch (error) { detail = [request.detail, t(error instanceof Error ? error.message : String(error))].filter(Boolean).join('\n') }
    }
    return null
  }
  const name = await readField({
    title: t('Add MCP server'),
    question: t('Server name'),
    detail: t('Use 1–32 letters, digits, hyphens, or underscores (for example: docs). Tools register as mcp__<name>__<tool>.'),
  }, raw => {
    const candidate = raw.trim()
    if (!SERVER_NAME_PATTERN.test(candidate)) throw new Error(t('Server name must match [A-Za-z0-9_-]{1,32}.'))
    const existing = ctx.get('mcpManager')?.list().some(view => view.name === candidate && view.configured)
      || Object.hasOwn(configuredServerMap(section.value), candidate)
    if (existing) throw new Error(t('Server "{name}" already exists.', { name: candidate }))
    return candidate
  })
  if (name === null) return null

  const transport = await tui.prompt(choosePrompt({
    title: t('Add MCP server'),
    question: t('Choose transport for {name}', { name }),
    options: [
      { label: t('Local process (stdio)'), value: 'stdio', description: t('Spawn a local command over stdin/stdout.') },
      { label: t('Remote endpoint (Streamable HTTP)'), value: 'streamable-http', description: t('Connect to an HTTP/SSE MCP endpoint.') },
    ],
    signal,
  }))
  if (transport === null || signal.aborted) return null

  let entry: Record<string, unknown>
  if (transport === 'stdio') {
    const command = await readField({
      title: name,
      question: t('Executable command'),
      detail: t('Executable started without a shell (for example: npx, uvx, or node).'),
    }, raw => {
      const value = raw.trim()
      assertTemplateSyntax(value, `servers.${name}.command`)
      return value
    })
    if (!command) return null

    const args = await readField({
      title: name,
      question: t('Arguments (optional)'),
      detail: t('Space-separated arguments or a JSON array (for example: -y @modelcontextprotocol/server-memory).'),
    }, raw => {
      const values = parseMcpArgs(raw)
      values.forEach((arg, index) => assertTemplateSyntax(arg, `servers.${name}.args[${index}]`))
      return values
    }, true)
    if (args === null) return null

    const env = await readField({
      title: name,
      question: t('Environment variables (optional)'),
      detail: t('Enter KEY=VALUE pairs (separated by ";" or newlines). Use ${credential:NAME} to reference stored secrets.'),
    }, raw => {
      const values = parseMcpKeyValues(raw, 'env')
      for (const [key, value] of Object.entries(values)) assertTemplateSyntax(value, `servers.${name}.env.${key}`)
      return values
    }, true)
    if (env === null) return null

    entry = {
      transport: 'stdio',
      command,
      ...(args.length > 0 ? { args } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      enabled: true,
    }
  } else {
    const url = await readField({
      title: name,
      question: t('MCP endpoint URL'),
      detail: t('HTTP or HTTPS Streamable HTTP endpoint (for example: https://example.com/mcp).'),
    }, raw => {
      const value = raw.trim()
      assertTemplateSyntax(value, `servers.${name}.url`)
      return value
    })
    if (!url) return null

    const headers = await readField({
      title: name,
      question: t('Request headers (optional)'),
      detail: t('Enter Header=Value pairs (separated by ";" or newlines). Use ${credential:NAME} to reference stored secrets.'),
    }, raw => {
      const values = parseMcpKeyValues(raw, 'headers')
      for (const [key, value] of Object.entries(values)) assertTemplateSyntax(value, `servers.${name}.headers.${key}`)
      return values
    }, true)
    if (headers === null) return null

    entry = {
      transport: 'streamable-http',
      url,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      enabled: true,
    }
  }

  const latest = describeManager(ctx)
  if (latest === undefined) throw new Error(t('MCP manager configuration is no longer available.'))
  await settings.mutate(MCP_MANAGER_NS, [{ op: 'set', path: ['servers', name], value: entry }], latest.revision)
  tui.notice?.(t('MCP server "{name}" saved.', { name }), { transient: true })
  return name
}

/** Manage one runtime MCP server: inspect status, enable/disable, probe, restart, or remove. */
export async function manageMcpServer(
  ctx: Context,
  tui: McpPromptSurface,
  name: string,
  signal: AbortSignal,
  extraDetail?: () => string,
): Promise<void> {
  const language = resolveUiLanguage(ctx.get('tui')?.prefs?.().uiLanguage)
  const t: TranslateFn = (source, values) => uiText(language, source, values)
  let diagnostic = ''
  let initialValue: string | undefined

  while (!signal.aborted) {
    const manager = ctx.get('mcpManager')
    const section = describeManager(ctx)
    const configured = configuredServerMap(section?.value)
    const baseServers = configuredServerMap(section?.base)
    const userServers = configuredServerMap(section?.user)
    const entry = configured[name]
    const hasConfig = entry !== undefined
    const hasOverride = Object.hasOwn(userServers, name)
    const hasInherited = Object.hasOwn(baseServers, name)
    const view: McpManagedServerView | undefined = manager?.list().find(item => item.name === name)

    if (view === undefined && !hasConfig) return

    const origin = hasConfig
      ? (hasOverride ? t('Profile override') : t('Inherited'))
      : view?.configured
        ? t('Registered by plugin')
        : t('Removed (cleanup pending)')
    const enabled = entry?.enabled ?? (view?.status.state !== 'disabled')
    const writable = ctx.get('settings')?.writable === true && section !== undefined

    const detail = [
      `${t('Status')}: ${formatMcpStatus(view?.status, t)} · ${origin}`,
      ...summarizeEntry(entry, t),
      diagnostic,
      extraDetail?.() ?? '',
    ].filter(Boolean).join('\n\n')

    const options: NonNullable<TuiPrompt['options']> = [
      ...(hasConfig && writable ? [{
        label: t(enabled ? 'Disable server' : 'Enable server'),
        value: 'toggle',
      }] : []),
      ...(manager !== undefined && (view?.configured ?? hasConfig) ? [
        { label: t('Probe connection'), value: 'probe', description: t('Connect once, list tools, and close without touching the live instance.') },
        { label: t('Restart server'), value: 'restart', description: t('Reconnect from scratch with a fresh retry budget.') },
      ] : []),
      ...(hasOverride && writable ? [{
        label: t(hasInherited ? 'Restore inherited configuration' : 'Remove server'),
        value: 'unset',
      }] : []),
      { label: t('Refresh'), value: 'refresh' },
      { label: t('Back'), value: 'back' },
    ]

    const action = await tui.prompt({
      title: name,
      question: t('Manage MCP server'),
      detail,
      options,
      allowCustom: false,
      notify: false,
      ...(initialValue === undefined ? {} : { initialValue }),
      signal,
    })
    if (action === null || action === 'back' || signal.aborted) return
    initialValue = action
    if (action === 'refresh') { diagnostic = ''; continue }

    try {
      if (action === 'toggle') {
        const current = describeManager(ctx)
        if (current === undefined) throw new Error(t('MCP manager configuration is unavailable.'))
        const latestEnabled = configuredServerMap(current.value)[name]?.enabled ?? true
        await ctx.settings.update(MCP_MANAGER_NS, { servers: { [name]: { enabled: !latestEnabled } } }, current.revision)
        diagnostic = t(!latestEnabled ? 'Server enabled.' : 'Server disabled.')
      } else if (action === 'probe' && manager !== undefined) {
        const result = await manager.probe(name, { signal })
        diagnostic = formatMcpProbeResult(name, result, t)
      } else if (action === 'restart' && manager !== undefined) {
        await manager.restart(name)
        diagnostic = t('Server restarted.')
      } else if (action === 'unset') {
        const confirmLabel = hasInherited ? t('Restore inherited configuration') : t('Remove server')
        const confirmed = await confirmPrompt(tui.prompt, {
          title: name,
          question: `${confirmLabel}?`,
          detail: hasInherited
            ? t('Removes your profile override for "{name}" and restores the inherited server definition.', { name })
            : t('Removes "{name}" from your profile and unmounts its tools.', { name }),
          acceptLabel: confirmLabel,
          cancelLabel: t('Cancel'),
          signal,
        })
        if (!confirmed || signal.aborted) continue
        const current = describeManager(ctx)
        if (current === undefined) throw new Error(t('MCP manager configuration is unavailable.'))
        await ctx.settings.mutate(MCP_MANAGER_NS, [{ op: 'unset', path: ['servers', name] }], current.revision)
        tui.notice?.(t(hasInherited ? 'Restored inherited configuration for "{name}".' : 'Removed MCP server "{name}".', { name }), { transient: true })
        if (!hasInherited) return
        diagnostic = ''
      }
    } catch (error) {
      if (signal.aborted) return
      diagnostic = error instanceof Error ? error.message : String(error)
    }
  }
}

/** Settings → Integrations → MCP servers page with live watch updates. */
export async function openMcpSettings(ctx: Context, signal: AbortSignal, resetOnly = false): Promise<void> {
  const manager = ctx.get('mcpManager')
  if (manager === undefined && describeManager(ctx) === undefined) return
  const lifetime = new AbortController()
  const live = AbortSignal.any([signal, lifetime.signal])
  const language = resolveUiLanguage(ctx.tui.prefs?.().uiLanguage)
  const t: TranslateFn = (source, values) => uiText(language, source, values)
  let views: McpManagedServerView[] = manager?.list() ?? []
  let diagnostic = ''

  if (manager !== undefined) {
    void (async () => {
      try {
        for await (const next of manager.watch(live)) {
          if (live.aborted) break
          views = next
        }
      } catch {
        /* Surface reads fall back to direct list() calls. */
      }
    })()
  }

  const readRows = () => {
    views = manager?.list() ?? views
    const section = describeManager(ctx)
    const configured = configuredServerMap(section?.value)
    const userServers = configuredServerMap(section?.user)
    const names = [...new Set([...views.map(view => view.name), ...Object.keys(configured)])]
    return { section, configured, userServers, names }
  }

  const details = (): string => {
    const { names } = readRows()
    return [
      diagnostic,
      names.length === 0
        ? t('No runtime MCP servers are configured. Static servers in `.dsh/mcp.json` or `$OMDSH_HOME/mcp.json` remain active alongside this list.')
        : t('Runtime MCP servers reconcile live without restarting omdsh.'),
    ].filter(Boolean).join('\n\n')
  }

  const options = (): NonNullable<TuiPrompt['options']> => {
    const { userServers, names } = readRows()
    const writable = ctx.get('settings')?.writable === true
    const visible = resetOnly ? names.filter(name => Object.hasOwn(userServers, name)) : names
    return [
      ...visible.map(name => {
        const view = views.find(item => item.name === name)
        return {
          label: name,
          value: `server:${name}`,
          description: formatMcpStatus(view?.status, t),
        }
      }),
      ...(!resetOnly && writable ? [{ label: t('Add server…'), value: 'add', description: t('Configure a stdio or Streamable HTTP server.') }] : []),
      { label: t('Refresh'), value: 'refresh' },
      { label: t('Back'), value: 'back' },
    ]
  }

  try {
    while (!live.aborted) {
      const action = await ctx.tui.prompt({
        title: t('MCP servers'),
        question: t(resetOnly ? 'Choose a server override to restore' : 'Manage live MCP servers'),
        detail: details(),
        refreshDocument: details,
        options: options(),
        refreshOptions: options,
        filterable: true,
        allowCustom: false,
        notify: false,
        signal: live,
      })
      if (action === null || action === 'back' || live.aborted) return
      if (action === 'refresh') { diagnostic = ''; continue }
      if (action === 'add') {
        try {
          diagnostic = ''
          await promptAddMcpServer(ctx, ctx.tui, live)
        } catch (error) {
          if (!live.aborted) diagnostic = error instanceof Error ? error.message : String(error)
        }
        continue
      }
      if (action.startsWith('server:')) {
        await manageMcpServer(ctx, ctx.tui, action.slice(7), live)
      }
    }
  } finally {
    lifetime.abort()
  }
}
