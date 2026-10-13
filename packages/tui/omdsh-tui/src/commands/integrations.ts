/** Integration discovery commands registered through dsh-commands. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import { registerCommands } from './registration.ts'

export const name = 'omdsh-command-integrations'
export const inject = ['commands', 'tui']

function compactDescription(value: string, maxLength: number = 140): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength - 1).trimEnd() + '…'
}

/** Render the MCP subset of the unified Harness tool catalog. */
export function mcpCatalogText(tools: readonly { name: string; description: string }[]): string {
  const servers = new Map<string, Array<{ name: string; description: string }>>()
  for (const tool of tools) {
    const match = /^mcp__(.+?)__(.+)$/u.exec(tool.name)
    if (match?.[1] === undefined || match[2] === undefined) continue
    const rows = servers.get(match[1]) ?? []
    rows.push({ name: match[2], description: compactDescription(tool.description) })
    servers.set(match[1], rows)
  }
  if (servers.size === 0) {
    return 'No MCP tools are available to this session. This does not establish whether a server is connected.'
  }
  const total = [...servers.values()].reduce((count, rows) => count + rows.length, 0)
  return [
    `MCP Tools · ${servers.size} server${servers.size === 1 ? '' : 's'} represented · ${total} tool${total === 1 ? '' : 's'}`,
    ...[...servers].flatMap(([server, rows]) => [
      '',
      `**${server} · ${rows.length} tool${rows.length === 1 ? '' : 's'}**`,
      '| Tool | Description |',
      '|---|---|',
      ...rows.map(row => `| \`${row.name.replace(/\|/gu, '\\|')}\` | ${(row.description || 'No description provided.').replace(/\|/gu, '\\|')} |`),
    ]),
  ].join('\n')
}

async function showMcp(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /mcp' }
  const tools = ctx.get('tools')?.schemas(invocation.agent).map(schema => ({
    name: schema.name,
    description: schema.description,
  })) ?? []
  const manager = ctx.get('pluginManager')
  const entries = manager === undefined ? undefined : (await manager.listPlugins()).filter(entry => entry.moduleName === '@deepseek-ai/dsh-mcp-client')
  invocation.signal.throwIfAborted()
  const text = [
    'MCP',
    'Configure project servers in .dsh/mcp.json or home servers in ~/.dsh/mcp.json, then restart omdsh.',
    '', 'Plugin registration',
    ...(entries === undefined ? ['Registration status is unavailable in this host.'] : entries.length === 0 ? ['No MCP client entries are registered.'] : entries.map(entry => `${entry.entryId} · ${entry.enabled ? entry.fiberPhase ?? 'not mounted' : 'disabled'}`)),
    'Plugin registration and tool availability do not verify transport health or authentication.',
    '', mcpCatalogText(tools),
  ].join('\n')
  if (ctx.tui.interactive !== true) return { kind: 'success', text }
  await ctx.tui.prompt({ title: 'MCP · Installation and tools', question: '', presentation: 'document', documentSource: { text, language: 'text' }, options: [{ label: 'Back', value: 'back' }], allowCustom: false, notify: false, signal: invocation.signal })
  return { kind: 'success' }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [
    { name: 'mcp', description: 'Inspect MCP registration and available tools', handler: invocation => showMcp(ctx, invocation) },
  ], 'omdsh integration commands')
}
