import { EventEmitter } from 'node:events'
import type { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { clipboardCommand, copyToClipboard } from './clipboard.ts'

describe('clipboardCommand', () => {
  it('picks the platform clipboard tool', () => {
    expect(clipboardCommand('darwin', {})).toEqual(['pbcopy'])
    expect(clipboardCommand('win32', {})).toEqual(['clip'])
    expect(clipboardCommand('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toEqual(['wl-copy'])
    expect(clipboardCommand('linux', { DISPLAY: ':0' })).toEqual(['xclip', '-selection', 'clipboard'])
    expect(clipboardCommand('linux', {})).toBeUndefined()
  })
})

// Recording helpers do not read or replace the developer's real clipboard.

function helpers(results: { code?: number; stdout?: string; error?: Error }[]) {
  const inputs: string[] = []
  const run = vi.fn((_command: string, _args: string[], _options: unknown) => {
    const result = results.shift() ?? { code: 1 }
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() })
    let input = ''
    child.stdin.on('data', chunk => { input += chunk.toString() })
    child.stdin.on('finish', () => {
      inputs.push(input)
      if (result.stdout) child.stdout.write(result.stdout)
      if (result.error) child.emit('error', result.error)
      child.emit('close', result.code ?? 0)
    })
    return child
  })
  return { run: run as unknown as typeof spawn, calls: run, inputs }
}

describe('clipboard delivery', () => {
  it('confirms a successful local platform copy without emitting terminal escapes', async () => {
    const helper = helpers([{ code: 0 }])
    const output = { isTTY: true, write: vi.fn() }
    expect(await copyToClipboard('hello 中🐳', helper.run, { platform: 'darwin', env: {}, output })).toBe('confirmed')
    expect(helper.inputs).toEqual(['hello 中🐳'])
    expect(helper.calls.mock.calls[0]?.slice(0, 2)).toEqual(['pbcopy', []])
    expect(output.write).not.toHaveBeenCalled()
  })

  it('forwards remote copies even when the server clipboard succeeds', async () => {
    const helper = helpers([{ code: 0 }])
    const output = { isTTY: true, write: vi.fn() }
    expect(await copyToClipboard('hello 中', helper.run, { platform: 'darwin', env: { SSH_TTY: 'ssh' }, output })).toBe('requested')
    expect(output.write).toHaveBeenCalledWith(`\x1b]52;c;${Buffer.from('hello 中').toString('base64')}\x07`)
  })

  it('uses tmux clipboard integration for the most active client of this pane’s session', async () => {
    const helper = helpers([
      { stdout: 'external\n' }, { stdout: '$1\n' },
      { stdout: '50\tclient-new\n10\tclient-old\n' }, { stdout: '200: Ms: (string) clipboard sequence\n' }, { code: 0 },
    ])
    const output = { isTTY: true, write: vi.fn() }
    expect(await copyToClipboard('payload', helper.run, { platform: 'linux', env: { TMUX_PANE: '%2' }, output })).toBe('requested')
    expect(helper.calls.mock.calls.map(call => call[1])).toContainEqual(['list-clients', '-t', '$1', '-F', '#{client_activity}\t#{client_name}'])
    expect(helper.calls.mock.calls.at(-1)?.slice(0, 2)).toEqual(['tmux', ['load-buffer', '-w', '-t', 'client-new', '-']])
    expect(helper.inputs.at(-1)).toBe('payload')
    expect(output.write).not.toHaveBeenCalled()
  })

  it('falls back to escaped tmux passthrough and reports it as an unconfirmed request', async () => {
    const helper = helpers([{ stdout: 'off\n' }])
    const output = { isTTY: true, write: vi.fn() }
    expect(await copyToClipboard('hello', helper.run, { platform: 'linux', env: { TMUX: 'tmux', TMUX_PANE: '%2' }, output })).toBe('requested')
    expect(output.write).toHaveBeenCalledWith('\x1bPtmux;\x1b\x1b]52;c;aGVsbG8=\x07\x1b\\')
    expect(helper.calls).toHaveBeenCalledTimes(1)
  })

  it('does not write OSC 52 into redirected output or send oversized terminal payloads', async () => {
    const helper = helpers([])
    const output = { isTTY: false, write: vi.fn() }
    await expect(copyToClipboard('hello', helper.run, { platform: 'linux', env: {}, output })).rejects.toThrow('no clipboard')
    output.isTTY = true
    await expect(copyToClipboard('中'.repeat(40_000), helper.run, { platform: 'linux', env: {}, output })).rejects.toThrow('limit')
    expect(output.write).not.toHaveBeenCalled()
  })
})
