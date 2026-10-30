import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { buildCopyTargets, extractCodeBlocks } from './copy-targets.ts'
import type { Block } from './event-views.ts'

const assistant = (text: string): Block =>
  ({ kind: 'assistant', turn: 1, step: 1, text, reasoning: '', streaming: false })

const tool = (name: string, args: string, output = ''): Block =>
  ({ kind: 'tool', callId: ToolCallId('c1'), name, args, status: 'ok', output })

describe('buildCopyTargets', () => {
  it('lists newest assistant text, its fences, bash commands, and tool outputs', () => {
    const items = buildCopyTargets([
      assistant('first reply'),
      tool('bash', '{"command":"ls -la"}', 'total 8\ndrwxr-xr-x'),
      assistant('see\n```ts\nconst x = 1\n```'),
    ])
    expect(items.map((item) => item.id)).toEqual(['msg:1', 'code:1', 'cmd:1', 'out:1', 'msg:2'])
    expect(items[0]).toMatchObject({ label: 'see', hint: '4 lines', copyMessage: 'last message' })
    expect(items[1]).toMatchObject({ label: 'const x = 1', hint: 'ts · 1 line', text: 'const x = 1', copyMessage: 'ts block' })
    expect(items[2]).toMatchObject({ label: 'ls -la', hint: 'bash · 1 line', text: 'ls -la', copyMessage: 'bash command' })
    expect(items[3]).toMatchObject({ label: 'total 8', hint: 'bash output · 2 lines', text: 'total 8\ndrwxr-xr-x', copyMessage: 'bash output' })
    expect(items[4]?.label).toBe('first reply')
  })

  it('returns an empty list when nothing is copyable', () => {
    expect(buildCopyTargets([{ kind: 'user', text: 'hi' }])).toEqual([])
  })
})
