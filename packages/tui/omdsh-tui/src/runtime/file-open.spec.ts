import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { openSystemFile } from './file-open.ts'

describe('openSystemFile', () => {
  it('opens files on macOS and desktop Linux without a shell', async () => {
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout: '', stderr: '' }))
    const signal = new AbortController().signal
    await openSystemFile('docs/readme.txt', signal, { platform: 'darwin', run })
    expect(run).toHaveBeenLastCalledWith('open', [resolve('docs/readme.txt')], signal, 'hidden')

    await openSystemFile('docs/readme.txt', signal, { platform: 'linux', osRelease: '6.8.0-generic', env: { DISPLAY: ':0' }, run })
    expect(run).toHaveBeenLastCalledWith('xdg-open', [resolve('docs/readme.txt')], signal, 'hidden')
  })

  it('prefers the configured browser for HTML exports and falls back to file association', async () => {
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout: '', stderr: '' }))
    const signal = new AbortController().signal
    await openSystemFile('report.html', signal, { platform: 'linux', osRelease: '6.8.0-generic', env: { BROWSER: 'firefox' }, run })
    expect(run).toHaveBeenLastCalledWith('firefox', [resolve('report.html')], signal, 'hidden')
  })

  it('accepts Windows Explorer delegate exit code 1 while rejecting other failures', async () => {
    const delegateRun = vi.fn<NativeCommandRunner>(async () => {
      throw Object.assign(new Error('delegated'), { code: 1 })
    })
    await expect(openSystemFile('C:\\work\\中文,a=b.txt', new AbortController().signal, {
      platform: 'win32',
      run: delegateRun,
    })).resolves.toBeUndefined()
    const explorerArg = delegateRun.mock.calls[0]?.[1]?.[0] ?? ''
    expect(delegateRun.mock.calls[0]?.[0]).toBe('explorer.exe')
    expect(explorerArg).toContain('%2C')
    expect(explorerArg).toContain('%3D')
    expect(explorerArg).toContain('中文')

    const failedRun = vi.fn<NativeCommandRunner>(async () => {
      throw Object.assign(new Error('explorer failed'), { code: 2 })
    })
    await expect(openSystemFile('a.txt', new AbortController().signal, {
      platform: 'win32',
      run: failedRun,
    })).rejects.toThrow('explorer failed')
  })

  it('translates WSL paths through wslpath before handing them to Explorer', async () => {
    const run = vi.fn<NativeCommandRunner>(async (command) => ({
      stdout: command === 'wslpath' ? '\\\\wsl.localhost\\Ubuntu\\home\\user\\file.txt\n' : '',
      stderr: '',
    }))
    const signal = new AbortController().signal
    await openSystemFile('/home/user/file.txt', signal, {
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      run,
    })
    expect(run).toHaveBeenNthCalledWith(1, 'wslpath', ['-w', resolve('/home/user/file.txt')], signal, 'hidden')
    expect(run).toHaveBeenNthCalledWith(2, 'explorer.exe', [expect.stringContaining('wsl.localhost')], signal, 'visible')
  })

  it('honors AbortSignal cancellation', async () => {
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))
    const run = vi.fn<NativeCommandRunner>(async (_cmd, _args, signal) => {
      signal.throwIfAborted()
      return { stdout: '', stderr: '' }
    })
    await expect(openSystemFile('a.txt', abort.signal, { platform: 'darwin', run })).rejects.toThrow('cancelled')
  })
})
