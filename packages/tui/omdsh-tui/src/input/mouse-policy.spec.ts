import type { execFile } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { readTmuxMouseEnabled } from './mouse-policy.ts'

describe('readTmuxMouseEnabled', () => {
  it('does not probe outside tmux', async () => {
    const execute = vi.fn()
    expect(await readTmuxMouseEnabled({}, execute as unknown as typeof execFile)).toBeUndefined()
    expect(execute).not.toHaveBeenCalled()
  })

  it.each(['0', 'off', '1', 'on', 'unknown'])('interprets %s in the current pane with a bounded probe', async value => {
    const execute = vi.fn((_command, _args, _options, done) => done(null, value + '\n'))
    expect(await readTmuxMouseEnabled({ TMUX_PANE: '%2' }, execute as unknown as typeof execFile))
      .toBe(['0', 'off'].includes(value) ? false : ['1', 'on'].includes(value) ? true : undefined)
    expect(execute.mock.calls[0]?.slice(0, 3)).toEqual(['tmux', ['display-message', '-p', '-t', '%2', '#{mouse}'],
      { timeout: 1000, maxBuffer: 4096, encoding: 'utf8', windowsHide: true }])
  })

  it('keeps the normal policy when a tmux probe fails', async () => {
    const execute = vi.fn((_command, _args, _options, done) => done(new Error('timed out'), '0'))
    expect(await readTmuxMouseEnabled({ TMUX: 'present' }, execute as unknown as typeof execFile)).toBeUndefined()
  })
})
