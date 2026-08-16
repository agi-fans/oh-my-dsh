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
    })).toEqual({
      title: 'anything',
      summary: 'exit 0',
      input: ['pnpm test'],
      output: ['42 passed'],
      outputPreview: 'tail',
    })

    expect(renderTool({
      name: 'custom-edit', arguments: '{}', output: '', status: 'ok', expanded: true,
      presentation: { result: { card: 'diff', title: 'Updated a.ts', diffs: [{ path: 'a.ts', oldText: 'a', newText: 'b' }] } },
    })).toEqual({
      title: 'Updated a.ts',
      summary: undefined,
      input: [],
      output: ['--- a.ts', '+++ a.ts', '- a', '+ b'],
      outputPreview: 'head',
    })
  })

  it('maps structured search/read results and keeps a generic fallback', () => {
    expect(renderTool({
      name: 'discover', arguments: '{}', output: '', status: 'ok', expanded: true,
      presentation: { result: { card: 'search', shape: 'paths', paths: ['a.ts', 'b.ts'], total: 2, truncated: false } },
    })).toMatchObject({ summary: '2 paths', input: [], output: ['a.ts', 'b.ts'] })

    expect(renderTool({
      name: 'unknown', arguments: '{"x":1}', output: 'safe', status: 'ok', expanded: false,
    })).toEqual({
      title: 'unknown',
      summary: undefined,
      input: ['{', '  "x": 1', '}'],
      output: ['safe'],
      outputPreview: 'head',
    })
  })

  it('retains generic call input after a result arrives', () => {
    expect(renderTool({
      name: 'run_code', arguments: '{"code":"return 42"}', output: '42', status: 'ok', expanded: false,
      presentation: {
        call: { card: 'generic', title: 'Compute the answer', rawInput: 'return 42' },
        result: { card: 'generic', content: [{ type: 'text', text: '42' }] },
      },
    })).toMatchObject({
      title: 'Compute the answer',
      input: ['return 42'],
      output: ['42'],
    })
  })

  it('falls back to durable result text when a generic result omits content', () => {
    expect(renderTool({
      name: 'custom', arguments: '{"query":"needle"}', output: 'durable result', status: 'ok', expanded: false,
      presentation: {
        call: { card: 'generic', title: 'Find needle' },
        result: { card: 'generic' },
      },
    })).toMatchObject({
      title: 'Find needle',
      input: ['{', '  "query": "needle"', '}'],
      output: ['durable result'],
    })
  })
})
