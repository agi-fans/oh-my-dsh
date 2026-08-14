import { describe, expect, it } from 'vitest'
import { renderTool } from './tool-renderers.ts'

describe('renderTool', () => {
  it('maps provider-neutral terminal and diff views without knowing tool names', () => {
    expect(renderTool({
      name: 'anything', arguments: '{}', output: 'fallback', status: 'ok', expanded: true,
      presentation: {
        call: { card: 'terminal', title: 'pnpm test', description: 'Run tests', cwd: '/repo' },
        result: { card: 'terminal', output: '42 passed', exitCode: 0 },
      },
    })).toEqual({ title: 'pnpm test', summary: 'exit 0', lines: ['42 passed'] })

    expect(renderTool({
      name: 'custom-edit', arguments: '{}', output: '', status: 'ok', expanded: true,
      presentation: { result: { card: 'diff', title: 'Updated a.ts', diffs: [{ path: 'a.ts', oldText: 'a', newText: 'b' }] } },
    })).toEqual({ title: 'Updated a.ts', summary: '{}', lines: ['--- a.ts', '+++ a.ts', '- a', '+ b'] })
  })

  it('maps structured search/read results and keeps a generic fallback', () => {
    expect(renderTool({
      name: 'discover', arguments: '{}', output: '', status: 'ok', expanded: true,
      presentation: { result: { card: 'search', shape: 'paths', paths: ['a.ts', 'b.ts'], total: 2, truncated: false } },
    })).toMatchObject({ summary: '2 paths', lines: ['a.ts', 'b.ts'] })

    expect(renderTool({
      name: 'unknown', arguments: '{"x":1}', output: 'safe', status: 'ok', expanded: false,
    })).toEqual({ title: 'unknown', summary: '{"x":1}', lines: ['safe'] })
  })
})
