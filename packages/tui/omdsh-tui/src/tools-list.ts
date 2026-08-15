/**
 * `/tools` help body: names visible to the current agent.
 * @module @oh-my-dsh/dsh-tui
 */

import { renderMarkdown } from './markdown.ts'
import type { Theme } from './theme.ts'
import { truncateToWidth, visibleWidth } from './width.ts'

/** One model-facing tool the TUI can list. */
export interface ToolInfo {
  name: string
  description: string
}

function tableCell(value: string): string {
  return value.replace(/\|/gu, '\\|').replace(/\s+/gu, ' ').trim()
}

/** Markdown table shown in the `/tools` transcript panel. */
export function formatToolsText(tools: readonly ToolInfo[]): string {
  if (tools.length === 0) return 'No tools are currently visible to the agent.'
  const lines = ['| Tool | Description |', '|---|---|']
  const sorted = [...tools].sort((left, right) => left.name < right.name ? -1 : 1)
  for (const tool of sorted) {
    const name = tableCell(tool.name)
    const description = tableCell(tool.description) || 'No description provided.'
    lines.push(`| \`${name}\` | ${description} |`)
  }
  return lines.join('\n')
}

function cleanDescription(value: string): string {
  return value.replace(/\s+/gu, ' ').trim() || 'No description provided.'
}

function compactCatalog(tools: readonly ToolInfo[], contentWidth: number): { tools: ToolInfo[]; shortened: boolean } {
  const nameWidth = Math.min(30, Math.max(visibleWidth('Tool'), ...tools.map(tool => visibleWidth(tool.name))))
  const descriptionWidth = Math.max(1, contentWidth - 7 - nameWidth)
  let shortened = false
  const compact = tools.map(tool => {
    const description = cleanDescription(tool.description)
    if (visibleWidth(description) <= descriptionWidth) return { ...tool, description }
    shortened = true
    return {
      ...tool,
      description: truncateToWidth(description, descriptionWidth).replace(/\x1b\[0m$/u, ''),
    }
  })
  return { tools: compact, shortened }
}

/** OMP-style command heading followed by the native Markdown table. */
export function renderToolsPanel(tools: readonly ToolInfo[], theme: Theme, width: number, expanded = false): string[] {
  const inset = width > 2 ? 1 : 0
  const contentWidth = Math.max(1, width - inset * 2)
  const prefix = ' '.repeat(inset)
  const title = theme.bold(theme.fg('accent', 'Available Tools'))
    + theme.fg('muted', ` · ${tools.length} active`)
  const compact = compactCatalog(tools, contentWidth)
  const shown = expanded ? tools : compact.tools
  const body = tools.length === 0
    ? [theme.fg('muted', 'No tools are currently visible to the agent.')]
    : renderMarkdown(formatToolsText(shown), theme, contentWidth)
  if (compact.shortened) {
    body.push('', theme.fg('dim', expanded
      ? '⟨Ctrl+O: Collapse descriptions⟩'
      : 'Descriptions shortened · ⟨Ctrl+O: Expand⟩'))
  }
  return [prefix + title, '', ...body.map(line => prefix + line)]
}
