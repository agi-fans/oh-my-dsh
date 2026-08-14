/** Integration discovery commands registered through dsh-commands. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-tools'
import { registerCommands } from './command-registration.ts'

export const name = 'omdsh-command-integrations'
export const inject = ['commands']

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
    return 'No MCP tools are connected. Configure .dsh/mcp.json or ~/.dsh/mcp.json, then restart omdsh.'
  }
  const total = [...servers.values()].reduce((count, rows) => count + rows.length, 0)
  return [
    `MCP Servers · ${servers.size} connected · ${total} tool${total === 1 ? '' : 's'}`,
    ...[...servers].flatMap(([server, rows]) => [
      '',
      `**${server} · ${rows.length} tool${rows.length === 1 ? '' : 's'}**`,
      '| Tool | Description |',
      '|---|---|',
      ...rows.map(row => `| \`${row.name.replace(/\|/gu, '\\|')}\` | ${(row.description || 'No description provided.').replace(/\|/gu, '\\|')} |`),
    ]),
  ].join('\n')
}

function showMcp(ctx: Context, invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /mcp' }
  const tools = ctx.get('tools')?.schemas(invocation.agent).map(schema => ({
    name: schema.name,
    description: schema.description,
  })) ?? []
  return { kind: 'success', text: mcpCatalogText(tools) }
}

export function apply(ctx: Context): void {
  registerCommands(ctx, [
    { name: 'mcp', description: 'Show connected MCP servers and tools', handler: invocation => showMcp(ctx, invocation) },
  ], 'omdsh integration commands')
}
