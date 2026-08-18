import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseOmdshArgs } from './args.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

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
      dumpConfig: false,
    })
  })

  it('parses a config dump without starting a session', () => {
    expect(parseOmdshArgs(['--dump-config'], '0.1.0')).toMatchObject({
      prompt: [],
      dumpConfig: true,
      resume: undefined,
    })
  })

  it('parses plugin arguments without treating them as a prompt', () => {
    expect(parseOmdshArgs(['plugin', 'add', '@scope/dsh-example'], '0.1.0')).toMatchObject({
      plugin: true,
      pluginArgs: ['add', '@scope/dsh-example'],
      prompt: [],
      dumpConfig: false,
    })
  })

  it('rejects dump-config combined with a prompt or resume', () => {
    vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error('exit ' + String(code))
    }) as typeof process.exit)
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => parseOmdshArgs(['--dump-config', 'hi'], '0.1.0')).toThrow('exit 2')
    expect(() => parseOmdshArgs(['--dump-config', '--resume', 'session-1'], '0.1.0')).toThrow('exit 2')
    expect(err.mock.calls.flat().join('\n')).toContain('--dump-config cannot be combined')
  })
})
