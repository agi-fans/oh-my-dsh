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
      diffStats: { added: 1, removed: 1 },
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

    expect(renderTool({
      name: 'send_message',
      arguments: '{"agent":"reviewer/checker","message":"Re-run validation."}',
      output: 'message delivered to agent reviewer/checker',
      status: 'ok',
      expanded: false,
    })).toMatchObject({
      title: 'Message',
      summary: 'reviewer/checker',
      input: ['Re-run validation.'],
    })

    expect(renderTool({
      name: 'subagent',
      arguments: '{"name":"reviewer","description":"Explore auth","prompt":"Find the login path."}',
      output: 'started subagent reviewer',
      status: 'ok',
      expanded: false,
    })).toMatchObject({
      title: 'reviewer · Explore auth',
      summary: 'started subagent reviewer',
      input: ['Find the login path.'],
      output: [],
    })

    expect(renderTool({
      name: 'interrupt_agent',
      arguments: '{"agent":"reviewer"}',
      output: 'interrupted agent reviewer',
      status: 'ok',
      expanded: false,
    })).toMatchObject({
      title: 'Interrupt',
      summary: 'reviewer',
      input: [],
    })

    expect(renderTool({
      name: 'wait_agent',
      arguments: '{"timeout_ms":30000}',
      output: '',
      status: 'running',
      expanded: false,
    })).toMatchObject({
      title: 'Wait',
      summary: '30s',
      input: [],
      output: [],
    })

    expect(renderTool({
      name: 'wait_agent',
      arguments: '{"timeout_ms":30000}',
      output: '{"timedOut":false}',
      status: 'ok',
      expanded: false,
    })).toMatchObject({
      title: 'Wait',
      summary: 'ready',
      input: [],
      output: [],
    })

    expect(renderTool({
      name: 'wait_agent',
      arguments: '{}',
      output: '{"timedOut":true}',
      status: 'ok',
      expanded: false,
    })).toMatchObject({
      title: 'Wait',
      summary: 'timed out',
      input: [],
      output: [],
    })
  })

  it('lists presented deliverables instead of raw present arguments', () => {
    expect(renderTool({
      name: 'present',
      arguments: '{"files":[{"path":"dist/omdsh.js","description":"Bundled CLI"},{"path":"report.md"}]}',
      output: 'Presented dist/omdsh.js\nPresented report.md',
      status: 'ok',
      expanded: false,
    })).toEqual({
      title: 'Deliverables',
      summary: '2 files',
      input: ['dist/omdsh.js — Bundled CLI', 'report.md'],
      output: [],
      outputPreview: 'head',
    })

    // The durable result only echoes the paths, so a failure that says
    // something else must still reach the card.
    expect(renderTool({
      name: 'present',
      arguments: '{"files":[{"path":"missing.md"}]}',
      output: 'Cannot present missing.md: file not found.',
      status: 'error',
      expanded: false,
    })).toMatchObject({
      title: 'Deliverables',
      summary: '1 file',
      input: ['missing.md'],
      output: ['Cannot present missing.md: file not found.'],
    })

    // A declaration with no usable path keeps the raw-argument fallback.
    expect(renderTool({
      name: 'present', arguments: '{"files":[]}', output: '', status: 'ok', expanded: false,
    })).toMatchObject({ title: 'present', input: ['{', '  "files": []', '}'] })
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

describe('renderTool partial arguments', () => {
  const streaming = (args: string): readonly string[] => renderTool({
    name: 'bash', arguments: args, output: '', status: 'running', expanded: false, partial: true,
  }).input

  const settled = (args: string): readonly string[] => renderTool({
    name: 'bash', arguments: args, output: '', status: 'running', expanded: false,
  }).input

  const previews: { label: string; args: string; expected: string[] }[] = [
    { label: 'a value truncated mid-string', args: '{"command":"ls -la /tm', expected: ['ls -la /tm'] },
    { label: 'a complete value before the object closes', args: '{"command":"ls -la /tmp"}', expected: ['ls -la /tmp'] },
    { label: 'a path followed by a truncated pattern', args: '{"path":"src/a.ts","pattern":"foo', expected: ['src/a.ts', 'foo'] },
    { label: 'a file_path field', args: '{"file_path":"src/a.ts","offset":1', expected: ['src/a.ts'] },
    { label: 'a query field', args: '{"query":"needle', expected: ['needle'] },
    { label: 'a url field', args: '{"url":"https://example.com/a', expected: ['https://example.com/a'] },
    { label: 'an escaped quote inside the value', args: '{"command":"echo \\"hi', expected: ['echo "hi'] },
    { label: 'an escaped newline inside the value', args: '{"command":"echo one\\necho two', expected: ['echo one', 'echo two'] },
    { label: 'a literal newline inside the value', args: '{"command":"ls -la\n/tmp', expected: ['ls -la', '/tmp'] },
    { label: 'an escaped trailing backslash', args: '{"command":"echo C:\\\\', expected: ['echo C:\\'] },
    { label: 'a lone trailing backslash', args: '{"command":"echo C:\\', expected: ['echo C:'] },
    { label: 'CJK characters in the value', args: '{"path":"中文/文件.ts', expected: ['中文/文件.ts'] },
    { label: 'an emoji in the value', args: '{"path":"docs/🐳.md', expected: ['docs/🐳.md'] },
  ]

  it.each(previews)('previews $label while arguments stream', ({ args, expected }) => {
    expect(streaming(args)).toEqual(expected)
  })

  const undecodable: { label: string; args: string; expected: string[] }[] = [
    { label: 'an empty prefix', args: '', expected: [] },
    { label: 'a lone opening brace', args: '{', expected: ['{'] },
    { label: 'a key with no value yet', args: '{"command":', expected: ['{"command":'] },
    { label: 'an object whose only field is not previewable', args: '{"timeout":30', expected: ['{"timeout":30'] },
    { label: 'plain text that is not JSON', args: 'ls -la', expected: ['ls -la'] },
  ]

  it.each(undecodable)('keeps the raw fragment for $label', ({ args, expected }) => {
    expect(streaming(args)).toEqual(expected)
    // An undecodable prefix renders exactly as the same text renders when settled.
    expect(streaming(args)).toEqual(settled(args))
  })

  it('leaves settled arguments alone when the partial flag is absent', () => {
    expect(settled('{"command":"ls -la /tmp"}')).toEqual(['{', '  "command": "ls -la /tmp"', '}'])
  })

  it('keeps a presentation call card ahead of the decoded preview', () => {
    expect(renderTool({
      name: 'read',
      arguments: '{"file_path":"src/a.ts"',
      output: '',
      status: 'running',
      expanded: false,
      partial: true,
      presentation: { call: { card: 'generic', title: 'Read src/a.ts', kind: 'read' } },
    })).toMatchObject({ title: 'Read src/a.ts', input: [] })
  })
})

describe('renderTool MCP fallback', () => {
  /**
   * A bridged MCP tool ships no `presentCall`, and on a resumed session the tool
   * definition is not even present — the server has not connected yet. The card
   * used to read `mcp__github__create_issue` above the raw argument JSON, one
   * brace per row. Presentation must not depend on the tool being live, so the
   * name alone has to be enough to render something readable.
   */
  const call = {
    name: 'mcp__github__create_issue',
    arguments: JSON.stringify({ owner: 'agi-fans', repo: 'oh-my-dsh', title: 'Fix the parser' }),
    output: '{"number":42}',
    partial: false,
  }

  it('names the server and the tool instead of the bridged identifier', () => {
    const card = renderTool(call)
    expect(card.title).toBe('github/create_issue')
    expect(card.title).not.toContain('mcp__')
  })

  it('puts the arguments on one line rather than expanding raw JSON', () => {
    const card = renderTool(call)
    expect(card.summary).toBe('owner=agi-fans repo=oh-my-dsh title=Fix the parser')
    // No `lines` means no brace-per-row dump: the summary already carries them.
    expect(card.input).toEqual([])
    expect(card.output).toEqual(['{"number":42}'])
  })

  it('cuts a long argument list so the label keeps the row', () => {
    const card = renderTool({
      ...call,
      arguments: JSON.stringify({ body: 'x'.repeat(400) }),
    })
    const summary = card.summary ?? ''
    expect(summary.length).toBeLessThanOrEqual(100)
    expect(summary.endsWith('...')).toBe(true)
  })

  it('leaves a non-bridged name to the generic fallback', () => {
    // Only the `mcp__<server>__<tool>` shape belongs to the bridge.
    const card = renderTool({ ...call, name: 'mcp__broken' })
    expect(card.title).toBe('mcp__broken')
  })

  it('yields to a tool that ships its own presentation', () => {
    // A richer card from the owning plugin always wins; this is only a fallback.
    const card = renderTool({
      ...call,
      presentation: { call: { card: 'generic', title: 'Create issue', kind: 'write' } },
    })
    expect(card.title).toBe('Create issue')
  })
})

describe('Agent Teams task-board fallback presentation', () => {
  it('renders team_task_create, team_task_list, team_task_get, and team_task_update without raw JSON dumps', () => {
    const created = renderTool({
      name: 'team_task_create',
      arguments: JSON.stringify({ subject: 'Split parser', description: 'Extract lexer.', write_scopes: ['src/lexer.ts'] }),
      output: JSON.stringify({
        id: '1',
        revision: 1,
        subject: 'Split parser',
        description: 'Extract lexer.',
        status: 'pending',
        blockedBy: [],
        writeScopes: ['src/lexer.ts'],
        ready: true,
        writeScopeWarnings: [],
      }),
    })
    expect(created).toMatchObject({
      title: 'Create task · Split parser',
      summary: '#1 · pending · rev 1',
      input: ['Extract lexer.', 'Write scopes: src/lexer.ts'],
      output: [],
    })

    const listed = renderTool({
      name: 'team_task_list',
      arguments: '{}',
      output: JSON.stringify({
        tasks: [
          { id: '1', revision: 2, subject: 'Split parser', description: 'Extract lexer.', status: 'in_progress', owner: 'worker-a', blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [] },
        ],
      }),
    })
    expect(listed).toMatchObject({
      title: 'Team tasks',
      summary: '1 task',
      input: [],
      output: ['#1 [in_progress] worker-a · Split parser'],
    })

    const fetched = renderTool({
      name: 'team_task_get',
      arguments: JSON.stringify({ task_id: '1' }),
      output: JSON.stringify({
        id: '1',
        revision: 2,
        subject: 'Split parser',
        description: 'Extract lexer.',
        status: 'in_progress',
        owner: 'worker-a',
        blockedBy: ['0'],
        writeScopes: ['src/lexer.ts'],
        ready: true,
        writeScopeWarnings: [],
      }),
    })
    expect(fetched).toMatchObject({
      title: 'Task #1 · Split parser',
      summary: 'in_progress · worker-a · rev 2',
      input: [],
      output: ['Extract lexer.', 'Blocked by: #0', 'Write scopes: src/lexer.ts'],
    })

    const updated = renderTool({
      name: 'team_task_update',
      arguments: JSON.stringify({ task_id: '1', expected_revision: 2, action: 'complete' }),
      output: JSON.stringify({
        id: '1',
        revision: 3,
        subject: 'Split parser',
        description: 'Extract lexer.',
        status: 'completed',
        owner: 'worker-a',
        blockedBy: [],
        writeScopes: [],
        ready: true,
        writeScopeWarnings: [],
      }),
    })
    expect(updated).toMatchObject({
      title: 'Complete task #1',
      summary: 'completed · worker-a · rev 3',
      input: [],
      output: [],
    })
  })
})
