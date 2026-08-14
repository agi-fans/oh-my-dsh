/**
 * `/tools` help body: names visible to the current agent.
 * @module @omdsh/tui
 */

/** One model-facing tool the TUI can list. */
export interface ToolInfo {
  name: string
  description: string
}

/** Body shown as a notice when `/tools` runs. */
export function formatToolsText(tools: readonly ToolInfo[]): string {
  if (tools.length === 0) return 'No tools are available.'
  const lines = ['Tools']
  const sorted = [...tools].sort((left, right) => left.name < right.name ? -1 : 1)
  for (const tool of sorted) {
    const desc = tool.description.trim()
    lines.push(desc === '' ? '- ' + tool.name : '- ' + tool.name + '  ' + desc)
  }
  return lines.join('\n')
}
