/** Integration discovery commands registered through dsh-commands. */

import { createPromptBrowser } from '../runtime/prompt-browser.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-tools'
import type { PluginInfo } from '@deepseek-ai/dsh-plugin-manager'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { readReference } from '../runtime/reference-reader.ts'
import { browseTools } from '../runtime/tool-reader.ts'
import { choosePrompt } from '../prompt-intents.ts'
import { resolveUiLanguage, uiText } from '../locale/index.ts'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-integrations'
export const inject = ['commands', 'tui']

function compactDescription(value: string, maxLength: number = 140): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength - 1).trimEnd() + '…'
}

/** Render the MCP subset of the unified Harness tool catalog. */
export function mcpCatalogText(tools: readonly { name: string; description: string }[], t: (source: string, values?: Record<string, string | number>) => string = (source, values) => uiText('en', source, values)): string {
  const servers = new Map<string, Array<{ name: string; description: string }>>()
  for (const tool of tools) {
    const match = /^mcp__(.+?)__(.+)$/u.exec(tool.name)
    if (match?.[1] === undefined || match[2] === undefined) continue
    const rows = servers.get(match[1]) ?? []
    rows.push({ name: match[2], description: compactDescription(tool.description) })
    servers.set(match[1], rows)
  }
  if (servers.size === 0) {
    return t('No MCP tools are available to this session. This does not establish whether a server is connected.')
  }
  const total = [...servers.values()].reduce((count, rows) => count + rows.length, 0)
  return [
    t('MCP tools · Servers: {servers} · Tools: {tools}', { servers: servers.size, tools: total }),
    ...[...servers].flatMap(([server, rows]) => [
      '',
      `**${server} · ${t('Tools: {count}', { count: rows.length })}**`,
      `| ${t('Tool')} | ${t('Description')} |`,
      '|---|---|',
      ...rows.map(row => `| \`${row.name.replace(/\|/gu, '\\|')}\` | ${(row.description || t('No description provided.')).replace(/\|/gu, '\\|')} |`),
    ]),
  ].join('\n')
}

interface McpCall { id: string; name: string; seq: number; outcome: 'No result recorded' | 'Returned an error' | 'Completed'; detail: string }

/** Historical outcomes never imply that a connection is currently healthy. */
export function recentMcpCalls(events: readonly SessionEvent[]): McpCall[] {
  const calls = new Map<string, McpCall>()
  for (const event of events) {
    if (event.type === 'tool/call' && event.data.name.startsWith('mcp__')) {
      calls.set(event.data.callId, { id: event.data.callId, name: event.data.name, seq: event.seq, outcome: 'No result recorded', detail: '' })
    } else if (event.type === 'tool/ptc-dispatch-start' && event.data.name.startsWith('mcp__')) {
      calls.set(event.data.subCallId, { id: event.data.subCallId, name: event.data.name, seq: event.seq, outcome: 'No result recorded', detail: '' })
    } else if (event.type === 'tool/result' || event.type === 'tool/ptc-dispatch') {
      const result = event.type === 'tool/result' ? event.data.message : event.data
      const id = event.type === 'tool/result' ? event.data.message.toolCallId : event.data.subCallId
      let call = calls.get(id)
      if (call === undefined && event.type === 'tool/ptc-dispatch' && event.data.name.startsWith('mcp__')) {
        call = { id, name: event.data.name, seq: event.seq, outcome: 'No result recorded', detail: '' }; calls.set(id, call)
      }
      if (call !== undefined) {
        call.outcome = result.isError ? 'Returned an error' : 'Completed'
        call.detail = result.isError ? result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') : ''
      }
    }
  }
  return [...calls.values()].slice(-10).reverse()
}

async function showMcp(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /mcp' }
  const lifetime = new AbortController()
  const signal = AbortSignal.any([invocation.signal, lifetime.signal])
  const tui = { prompt: (request: Parameters<typeof ctx.tui.prompt>[0]) => ctx.tui.prompt({ ...request, signal, onSuperseded: () => lifetime.abort() }),
    ...(ctx.tui.copyText === undefined ? {} : { copyText: (text: string, label?: string) => ctx.tui.copyText!(text, label) }) }
  const t = (source: string, values?: Record<string, string | number>): string => uiText(resolveUiLanguage(ctx.tui.prefs?.().uiLanguage), source, values)
  const caveat = t('Plugin registration and tool availability do not verify transport health or authentication.')
  const connection = t('Live connection and authentication status are unavailable in this Harness version.')
  const setup = t('Configure project servers in `.dsh/mcp.json` or home servers in `$OMDSH_HOME/mcp.json` (default `~/.dsh/mcp.json`), then restart omdsh.')
  let entries: readonly PluginInfo[] | undefined, tools: readonly { name: string; description: string }[] = [], calls: McpCall[] = []
  let loaded = false, error = ''
  const load = async (): Promise<void> => {
    try {
      const next = await ctx.get('pluginManager')?.listPlugins()
      signal.throwIfAborted()
      const schemas = ctx.get('tools')?.schemas(invocation.agent) ?? []
      const nextEntries = next?.filter(entry => entry.moduleName === '@deepseek-ai/dsh-mcp-client')
      const nextTools = schemas.filter(schema => schema.name.startsWith('mcp__')).map(schema => ({ name: schema.name, description: schema.description }))
      const nextCalls = recentMcpCalls(invocation.agent.session.snapshotEvents())
      entries = nextEntries
      tools = nextTools
      calls = nextCalls
      loaded = true; error = ''
    } catch {
      if (!signal.aborted) error = t(loaded ? 'Could not refresh MCP diagnostics. Showing the last loaded state; use Refresh to try again.' : 'Could not load MCP diagnostics. Use Refresh to try again.')
    }
  }
  const phase = (entry: PluginInfo): string => t(!entry.enabled ? 'disabled' : entry.fiberPhase ?? 'not mounted')
  const document = (): string => [
    '## MCP', error, setup, '', connection, caveat, '', '### ' + t('Plugin registration'),
    ...(entries === undefined ? [t('Registration status is unavailable in this host.')] : entries.length === 0 ? [t('No MCP client entries are registered.')] : entries.map(entry => `- ${entry.entryId} · ${phase(entry)}${entry.diagnostic ? '\n  ' + entry.diagnostic : ''}`)),
    '', mcpCatalogText(tools, t), '', '### ' + t('Recent calls in this session'),
    t('Recorded outcomes are historical; an error may come from the tool rather than the connection.'),
    ...calls.map(call => `${call.name} · ${t(call.outcome)} · #${call.seq}${call.detail ? '\n' + call.detail : ''}`),
    ...(calls.length === 0 ? [t('No MCP calls recorded in this session.')] : []),
  ].join('\n')
  await load()
  signal.throwIfAborted()
  if (ctx.tui.interactive === false) return { kind: error && !loaded ? 'error' : 'success', text: document() }
  const browse = createPromptBrowser(tui.prompt)
  while (!signal.aborted) {
    const servers = [...new Set(tools.map(tool => /^mcp__(.+?)__/u.exec(tool.name)?.[1]).filter((server): server is string => server !== undefined))]
    const answer = await browse(choosePrompt({ title: t('MCP diagnostics'), question: t('Inspect registration, available tools and recent calls'), filterable: true,
      detail: [error, connection, caveat, setup, entries === undefined ? t('Registration status is unavailable in this host.') : entries.length === 0 ? t('No MCP client entries are registered.') : ''].filter(Boolean).join('\n'),
      signal, options: [
        ...servers.map(server => ({ label: server, value: `server:${server}`,
          description: t('Tools: {count}', { count: tools.filter(tool => tool.name.startsWith(`mcp__${server}__`)).length }),
          preview: calls.filter(call => call.name.startsWith(`mcp__${server}__`)).map(call => `${call.name} · ${t(call.outcome)}`).join('\n') })),
        ...(entries ?? []).map((entry, index) => ({ label: String(entry.entryId), value: `entry:${index}`, description: phase(entry),
          ...(entry.diagnostic ? { preview: entry.diagnostic } : {}) })),
        { label: t('Available tools'), value: 'tools', description: String(tools.length) },
        { label: t('Recent calls in this session'), value: 'calls', description: String(calls.length) },
        { label: t('Refresh'), value: 'refresh' },
      ] }))
    if (signal.aborted || answer === null) break
    if (answer === 'refresh') { await load(); continue }
    if (answer === 'tools') {
      await browseTools(tui, tools, resolveUiLanguage(ctx.tui.prefs?.().uiLanguage), signal, 'Available tools')
      continue
    }
    if (answer.startsWith('server:')) {
      const server = answer.slice(7)
      const serverTools = tools.filter(tool => tool.name.startsWith(`mcp__${server}__`))
      const recent = calls.filter(call => call.name.startsWith(`mcp__${server}__`))
      await readReference(tui, server, [connection, '', mcpCatalogText(serverTools, t), '', '## ' + t('Recent calls in this session'),
        ...recent.map(call => `${call.name} · ${t(call.outcome)}${call.detail ? '\n\n' + call.detail : ''}`),
        ...(recent.length === 0 ? [t('No MCP calls recorded in this session.')] : [])].join('\n'), signal)
      continue
    }
    const entry = answer.startsWith('entry:') ? entries?.[Number(answer.slice(6))] : undefined
    const text = entry !== undefined ? [String(entry.entryId), phase(entry), entry.diagnostic, connection, t('Manage plugin configuration in /settings or /plugins.')].filter(Boolean).join('\n\n')
      : answer === 'calls' ? [t('Recorded outcomes are historical; an error may come from the tool rather than the connection.'), ...calls.map(call => `${call.name} · ${t(call.outcome)} · #${call.seq}${call.detail ? '\n' + call.detail : ''}`), ...(calls.length === 0 ? [t('No MCP calls recorded in this session.')] : [])].join('\n\n') : undefined
    if (text !== undefined) await readReference(tui, entry?.entryId ?? t('Recent calls in this session'), text, signal)
  }
  return { kind: 'success' }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [
    { name: 'mcp', description: 'Inspect MCP registration, tools and recent calls', handler: invocation => showMcp(ctx, invocation) },
  ], 'omdsh integration commands')
}
