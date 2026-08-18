import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import { buildCopyTargets, extractCodeBlocks, extractCopyTarget, parseCopyKind } from './copy-targets.ts'
import type { Block } from './event-views.ts'

const assistant = (text: string): Block =>
  ({ kind: 'assistant', turn: 1, step: 1, text, reasoning: '', streaming: false })

const tool = (name: string, args: string, output = ''): Block =>
  ({ kind: 'tool', callId: CallId('c1'), name, args, status: 'ok', output })

describe('parseCopyKind', () => {
  it('accepts the OMP tokens and rejects unknown ones', () => {
    expect(parseCopyKind('')).toBe('text')
    expect(parseCopyKind(' text ')).toBe('text')
    expect(parseCopyKind('code')).toBe('code')
    expect(parseCopyKind('cmd')).toBe('cmd')
    expect(parseCopyKind('command')).toBe('cmd')
    expect(parseCopyKind('nope')).toBeUndefined()
  })
})

describe('extractCodeBlocks', () => {
  it('collects closed fences and ignores an unclosed one', () => {
    const blocks = extractCodeBlocks('intro\n```js\nconst x = 1\n```\n```\nstill open')
    expect(blocks).toEqual([{ lang: 'js', code: 'const x = 1' }])
  })
})

describe('extractCopyTarget', () => {
  it('takes the last assistant text', () => {
    const target = extractCopyTarget([
      assistant('first'),
      { kind: 'user', text: 'hi' },
      assistant('second'),
    ], 'text')
    expect(target).toEqual({ text: 'second', label: 'assistant text' })
  })

  it('takes the last closed fence from assistant or tool output', () => {
    const fromAssistant = extractCopyTarget([
      assistant('```py\nold\n```\n```ts\nnew\n```'),
    ], 'code')
    expect(fromAssistant).toEqual({ text: 'new', label: 'ts block' })
    const fromTool = extractCopyTarget([
      assistant('```js\nold\n```'),
      tool('bash', '{}', 'see\n```\nplain\n```'),
    ], 'code')
    expect(fromTool).toEqual({ text: 'plain', label: 'code block' })
  })

  it('takes the last bash tool command', () => {
    const target = extractCopyTarget([
      tool('bash', '{"command":"ls"}'),
      tool('fs', '{"path":"/tmp"}'),
      tool('bash', '{"command":"pwd"}'),
    ], 'cmd')
    expect(target).toEqual({ text: 'pwd', label: 'bash command' })
  })

  it('returns undefined when the transcript has no match', () => {
    expect(extractCopyTarget([], 'text')).toBeUndefined()
    expect(extractCopyTarget([assistant('no fence')], 'code')).toBeUndefined()
    expect(extractCopyTarget([tool('fs', '{}')], 'cmd')).toBeUndefined()
  })
})

describe('buildCopyTargets', () => {
  it('lists newest assistant text, its fences, and bash commands', () => {
    const items = buildCopyTargets([
      assistant('first reply'),
      tool('bash', '{"command":"ls -la"}'),
      assistant('see\n```ts\nconst x = 1\n```'),
    ])
    expect(items.map((item) => item.id)).toEqual(['msg:1', 'code:1', 'cmd:1', 'msg:2'])
    expect(items[0]).toMatchObject({ label: 'see', hint: '4 lines', copyMessage: 'last message' })
    expect(items[1]).toMatchObject({ label: 'const x = 1', hint: 'ts · 1 line', text: 'const x = 1', copyMessage: 'ts block' })
    expect(items[2]).toMatchObject({ label: 'ls -la', hint: 'bash · 1 line', text: 'ls -la', copyMessage: 'bash command' })
    expect(items[3]?.label).toBe('first reply')
  })

  it('returns an empty list when nothing is copyable', () => {
    expect(buildCopyTargets([{ kind: 'user', text: 'hi' }])).toEqual([])
  })
})
