import { describe, expect, it, vi } from 'vitest'
import { buildOpenExternalCommand, openExternal } from './open-external.ts'

describe('openExternal', () => {
  it('passes Windows OAuth URLs as opaque environment data to PowerShell Start-Process instead of cmd.exe', () => {
    const oauthUrl = 'https://auth.example.com/authorize?client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A4321%2Fcb&state=s1&evil=1|calc.exe%COMSPEC%;$(whoami)'
    const command = buildOpenExternalCommand(oauthUrl, 'win32', { SystemRoot: 'D:\\Windows', PATH: 'D:\\Windows\\System32' })
    expect(command).toBeDefined()
    expect(command!.file).toBe('D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(command!.file.toLowerCase()).not.toContain('cmd.exe')
    expect(command!.args.join(' ')).not.toContain(oauthUrl)
    expect(command!.args.join(' ')).not.toContain('calc.exe')
    expect(command!.args).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-Command',
      'Start-Process -FilePath $env:OMDSH_OPEN_URL',
    ])
    expect(command!.env?.OMDSH_OPEN_URL).toBe(new URL(oauthUrl).href)
    expect(command!.windowsHide).toBe(true)

    const once = vi.fn()
    const unref = vi.fn()
    const spawn = vi.fn(() => ({ once, unref }))
    openExternal(oauthUrl, { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, spawn })
    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      command!.args,
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: true,
        env: expect.objectContaining({ OMDSH_OPEN_URL: new URL(oauthUrl).href }),
      }),
    )
    expect(unref).toHaveBeenCalledOnce()
  })

  it('dispatches macOS and Linux URLs directly without a shell', () => {
    expect(buildOpenExternalCommand('https://platform.deepseek.com/api_keys', 'darwin')).toEqual({
      file: 'open',
      args: ['https://platform.deepseek.com/api_keys'],
    })
    expect(buildOpenExternalCommand('http://127.0.0.1:8080/callback?a=1&b=2', 'linux')).toEqual({
      file: 'xdg-open',
      args: ['http://127.0.0.1:8080/callback?a=1&b=2'],
    })
  })

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ms-msdt:/id PCWDiagnostic',
    'calc.exe',
    'https://example.com/a\nb',
    'https://example.com/a\0b',
    'not a url',
  ])('rejects disallowed or malformed external target %s without spawning', (target) => {
    const spawn = vi.fn()
    expect(buildOpenExternalCommand(target, 'win32')).toBeUndefined()
    openExternal(target, { platform: 'win32', spawn })
    expect(spawn).not.toHaveBeenCalled()
  })
})
