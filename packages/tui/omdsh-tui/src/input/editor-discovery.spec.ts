import { describe, expect, it } from 'vitest'
import { discoverEditors, resolveEditor, type EditorDiscovery } from './editor-discovery.ts'

function system(platform: NodeJS.Platform, files: string[], env: NodeJS.ProcessEnv = {}): EditorDiscovery {
  return { platform, home: platform === 'win32' ? 'C:\\Users\\me' : '/home/me', env,
    executable: path => files.includes(path) }
}
describe('editor discovery', () => {
  it('prefers a graphical editor and lists only installed alternatives', () => {
    const discovery = system('linux', ['/bin/vim', '/tools/code'], { PATH: '/bin:/tools' })
    expect(discoverEditors('auto', discovery)).toEqual([
      { id: 'auto', label: 'Auto (VS Code)' }, { id: 'code', label: 'VS Code' }, { id: 'vim', label: 'Vim' },
    ])
    expect(resolveEditor('auto', discovery)).toEqual({ command: '/tools/code', args: ['--wait'] })
    expect(resolveEditor('vim', discovery)).toEqual({ command: '/bin/vim', args: [] })
  })
  it('finds macOS apps without requiring a command in PATH', () => {
    const path = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
    const discovery = system('darwin', [path])
    expect(resolveEditor('auto', discovery)).toEqual({ command: path, args: ['--wait'] })
    const cursor = '/home/me/Applications/Cursor.app/Contents/Resources/app/bin/code'
    expect(resolveEditor('cursor', system('darwin', [cursor, '/bin/cursor'], { PATH: '/bin' }))).toEqual({ command: cursor, args: ['--wait'] })
  })
  it('resolves Windows GUI installations without invoking a command shell', () => {
    const command = 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'
    const cli = 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\resources\\app\\out\\cli.js'
    const env = { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', PATH: 'C:\\Windows\\System32' }
    expect(resolveEditor('auto', system('win32', [command, cli], env)))
      .toEqual({ command, args: [cli, '--wait'], env: { ...env, ELECTRON_RUN_AS_NODE: '1' } })

  })
  it('preserves quoted environment arguments but lets a selected app override them', () => {
    const discovery = system('linux', ['/bin/vim'], { PATH: '/bin', VISUAL: '"/editor with spaces/app" --wait', EDITOR: 'nano' })
    expect(resolveEditor('auto', discovery)).toEqual({ command: '/editor with spaces/app', args: ['--wait'] })
    expect(resolveEditor('vim', discovery)).toEqual({ command: '/bin/vim', args: [] })
    expect(discoverEditors('auto', discovery)[0]?.label).toBe('Auto (environment)')
    discovery.env.VISUAL = ' '
    expect(resolveEditor('auto', discovery)).toEqual({ command: 'nano', args: [] })
  })
  it('keeps missing selections visible and actionable instead of silently switching apps', () => {
    const discovery = system('linux', [])
    expect(discoverEditors('cursor', discovery)).toEqual([
      { id: 'auto', label: 'Auto (none found)' }, { id: 'cursor', label: 'Cursor (unavailable)' },
    ])
    expect(() => resolveEditor('cursor', discovery)).toThrow('Choose an installed editor in /settings')
    expect(() => resolveEditor('auto', discovery)).toThrow('No editor was found')
  })
})
