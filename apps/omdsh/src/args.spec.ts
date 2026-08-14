import { describe, expect, it } from 'vitest'
import { parseOmdshArgs } from './args.ts'

describe('omdsh arguments', () => {
  it('parses a durable session resume', () => {
    expect(parseOmdshArgs(['--resume', 'session-123'], '0.1.0')).toMatchObject({
      prompt: [],
      resume: 'session-123',
    })
    expect(parseOmdshArgs(['-r', 'session-456'], '0.1.0').resume).toBe('session-456')
  })

  it('keeps positional words as the initial prompt', () => {
    expect(parseOmdshArgs(['explain', 'this'], '0.1.0')).toMatchObject({
      prompt: ['explain', 'this'],
      resume: undefined,
    })
  })
})
