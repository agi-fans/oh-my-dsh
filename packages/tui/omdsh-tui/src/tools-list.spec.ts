import { describe, expect, it } from 'vitest'
import { formatToolsText } from './tools-list.ts'

describe('formatToolsText', () => {
  it('builds an alphabetical two-column tool catalog', () => {
    expect(formatToolsText([])).toBe('No tools are currently visible to the agent.')
    const text = formatToolsText([
      { name: 'bash', description: 'Run a shell\ncommand | safely' },
      { name: 'fs', description: '  ' },
    ])
    expect(text).toBe([
      '| Tool | Description |',
      '|---|---|',
      '| `bash` | Run a shell command \\| safely |',
      '| `fs` | No description provided. |',
    ].join('\n'))
  })
})
