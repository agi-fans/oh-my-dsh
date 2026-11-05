import { expect, it } from 'vitest'
import type { Block } from './transcript-types.ts'
import { sourceQuote, toolActionContext, toolSource } from './tool-actions.ts'

const read = { kind: 'tool', name: 'read', args: '{}', output: 'formatted result with numbers', callId: 'read', status: 'ok',
  presentation: { result: { card: 'read', path: 'src/中文.ts', offset: 99, totalLines: 200,
    lines: [{ number: 99, text: '  const source = "中文🐳";' }, { number: 100, text: '\t// ' + 'long'.repeat(100) }] } } } as Extract<Block, { kind: 'tool' }>

it('copies only contiguous retained source with original indentation, Unicode and unbroken lines', () => {
  const source = toolSource(read)!
  expect(source.label).toBe('src/中文.ts:99–100')
  expect(source.text).toBe('  const source = "中文🐳";\n\t// ' + 'long'.repeat(100))
  expect(source.language).toBe('ts')
  expect(sourceQuote(source)).toContain('```ts\n  const source')
  expect(toolSource({ ...read, presentation: undefined } as unknown as typeof read)).toBeUndefined()
  expect(toolSource({ ...read, presentation: { result: { card: 'read', path: 'a', offset: 1, totalLines: 3,
    lines: [{ number: 1, text: 'first' }, { number: 3, text: 'last' }] } } })).toBeUndefined()
})

it('quotes embedded fences literally and identifies the exact command or declared file', () => {
  expect(sourceQuote({ label: 'a.md:1–3', text: '```ts\ncode\n```' })).toBe('a.md:1–3\n\n````\n```ts\ncode\n```\n````')
  expect(toolActionContext(read)).toBe('src/中文.ts')
  expect(toolActionContext({ ...read, presentation: { call: { card: 'terminal', title: 'Get-Process', description: 'List processes' } } })).toBe('Get-Process')
})
