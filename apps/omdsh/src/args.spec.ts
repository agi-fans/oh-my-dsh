import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseOmdshArgs } from './args.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('omdsh arguments', () => {
  it('parses independent exec routes, a resume with a new prompt and literal delimiters', () => {
    expect(parseOmdshArgs(['exec', '--json', '--model', 'm', '--provider', 'p', '--resume', 'session-one', 'Continue'], '0.20.0'))
      .toMatchObject({ exec: { json: true }, model: 'm', provider: 'p', resume: 'session-one', prompt: ['Continue'] })
    expect(parseOmdshArgs(['exec', '--json', '-'], '0.20.0').prompt).toEqual(['-'])
    expect(parseOmdshArgs(['exec', '--json', '--', '--literal', '!command'], '0.20.0').prompt).toEqual(['--literal', '!command'])
  })
  it('rejects incomplete exec routes and unrelated runtime flags', () => {
    vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit 2') }) as typeof process.exit)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const args of [['exec'], ['exec', '--json', '--model'], ['exec', '--json', '--resume', '--json'], ['exec', '--json', '--dump-config']]) {
      expect(() => parseOmdshArgs(args, '0.20.0')).toThrow('exit 2')
    }
  })
  it('parses doctor as a standalone diagnostic entry', () => {
    expect(parseOmdshArgs(['doctor'], '0.20.0')).toMatchObject({ doctor: { json: false }, prompt: [], plugin: false })
    expect(parseOmdshArgs(['doctor', '--json'], '0.20.0').doctor).toEqual({ json: true })
  })

  it('rejects prompts and runtime options after doctor', () => {
    vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit 2') }) as typeof process.exit)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => parseOmdshArgs(['doctor', 'prompt'], '0.20.0')).toThrow('exit 2')
    expect(() => parseOmdshArgs(['doctor', '--model', 'flash'], '0.20.0')).toThrow('exit 2')
  })
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

  it('parses shell completion generation without starting the application', () => {
    expect(parseOmdshArgs(['completions', 'zsh'], '0.1.0')).toMatchObject({
      completions: 'zsh',
      prompt: [],
      plugin: false,
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
