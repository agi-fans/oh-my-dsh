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
      summary: '+1/-1',
      input: [],
      output: ['a.ts', '- a', '+ b'],
      outputPreview: 'head',
    })

    expect(renderTool({
      name: 'edit', arguments: '{}', output: '', status: 'ok', expanded: true,
      presentation: {
        result: {
          card: 'diff',
          title: 'Edit a.ts',
          diffs: [{ path: 'a.ts', oldText: 'keep\nold\nkeep', newText: 'keep\nnew\nkeep' }],
        },
      },
    })).toMatchObject({
      title: 'Edit a.ts',
      summary: '+1/-1',
      output: ['a.ts', '  keep', '- old', '+ new', '  keep'],
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

  it('presents delegation tools by description instead of raw JSON', () => {
    expect(renderTool({
      name: 'subagent',
      arguments: '{"description":"Explore auth","prompt":"Find the login path.","run_in_background":true}',
      output: '',
      status: 'running',
      expanded: false,
    })).toMatchObject({
      title: 'Explore auth',
      summary: 'background',
      input: ['Find the login path.'],
      output: [],
    })

    expect(renderTool({
      name: 'subagent',
      arguments: '{"description":"Explore auth","prompt":"Find the login path."}',
      output: 'started subagent session-abc',
      status: 'ok',
      expanded: false,
    })).toMatchObject({
      title: 'Explore auth',
      summary: 'started subagent session-abc',
      input: ['Find the login path.'],
      output: [],
    })

    expect(renderTool({
      name: 'send_message',
      arguments: '{"subagent_id":"session-abc","message":"Also check logout."}',
      output: 'message queued as the next turn for subagent session-abc',
      status: 'ok',
      expanded: false,
    })).toMatchObject({
      title: 'Message',
      summary: 'session-abc',
      input: ['Also check logout.'],
    })

    expect(renderTool({
      name: 'send_message',
      arguments: '{"agent_id":"session-abc","message":"Also check logout."}',
      output: 'message delivered to agent session-abc',
      status: 'ok',
      expanded: false,
    })).toMatchObject({
      title: 'Message',
      summary: 'session-abc',
      input: ['Also check logout.'],
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
      // The call card carries a semantic title, so raw argument JSON stays out.
      input: [],
      output: ['durable result'],
    })
  })

  it('omits raw argument JSON when a generic call card carries a semantic title', () => {
    expect(renderTool({
      name: 'read',
      arguments: '{"file_path":"src/commands/export.ts","offset":1,"limit":100}',
      output: 'import { writeFile } from "node:fs"',
      status: 'ok',
      expanded: false,
      presentation: {
        call: {
          card: 'generic',
          title: 'Read src/commands/export.ts',
          kind: 'read',
          locations: [{ path: 'src/commands/export.ts', line: 1 }],
        },
        result: { card: 'read', path: 'src/commands/export.ts', offset: 1, totalLines: 240, lines: [{ number: 1, text: 'x' }] },
      },
    })).toMatchObject({
      title: 'Read src/commands/export.ts',
      summary: '1/240 lines',
      input: [],
    })

    // Without any call presentation the durable arguments remain the only input.
    expect(renderTool({
      name: 'unknown', arguments: '{"x":1}', output: 'safe', status: 'ok', expanded: false,
    })).toMatchObject({ input: ['{', '  "x": 1', '}'] })
  })
})
