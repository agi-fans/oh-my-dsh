import { describe, expect, it } from 'vitest'
import { formatToolsText } from './tools-list.ts'

describe('formatToolsText', () => {
  it('lists names alphabetically with descriptions', () => {
    expect(formatToolsText([])).toBe('No tools are available.')
    const text = formatToolsText([
      { name: 'bash', description: 'Run a shell command' },
      { name: 'fs', description: '  ' },
    ])
    expect(text).toBe('Tools\n- bash  Run a shell command\n- fs')
  })
})
