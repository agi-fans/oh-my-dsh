/**
 * `/tools` help body: names visible to the current agent.
 * @module @agi-fans/dsh-tui
 */


/** One model-facing tool the TUI can list. */
export interface ToolInfo {
  name: string
  description: string
}

function tableCell(value: string): string {
  return value.replace(/\|/gu, '\\|').replace(/\s+/gu, ' ').trim()
}

/** Markdown table of the tools visible to the agent. */
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
