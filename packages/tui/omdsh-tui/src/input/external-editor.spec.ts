import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { editExternally, editFileExternally } from './external-editor.ts'
import { resolveEditor } from './editor-discovery.ts'
vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
vi.mock('./editor-discovery.ts', () => ({ resolveEditor: vi.fn() }))
afterEach(() => { vi.resetAllMocks() })

describe('external editor handoff', () => {
  it('waits for prompt editing, reads saved text, and removes the temporary file', () => {
    vi.mocked(resolveEditor).mockReturnValue({ command: '/app/editor', args: ['--wait'] })
    let path = ''
    vi.mocked(spawnSync).mockImplementation((command, args) => {
      path = args!.at(-1)!
      expect(command).toBe('/app/editor')
      expect(args).toEqual(['--wait', path])
      expect(readFileSync(path, 'utf8')).toBe('original')
      writeFileSync(path, 'saved\n')
      return { status: 0 } as ReturnType<typeof spawnSync>
    })
    expect(editExternally('original', 'code')).toBe('saved')
    expect(resolveEditor).toHaveBeenCalledWith('code')
    expect(existsSync(path)).toBe(false)
  })
  it.each(['error', 'nonzero'])('cleans up after an editor %s', kind => {
    vi.mocked(resolveEditor).mockReturnValue({ command: '/missing', args: [] })
    let path = ''
    vi.mocked(spawnSync).mockImplementation((_command, args) => {
      path = args!.at(-1)!
      return (kind === 'error' ? { error: new Error('missing app') } : { status: 1 }) as ReturnType<typeof spawnSync>
    })
    expect(() => editExternally('original')).toThrow()
    expect(existsSync(path)).toBe(false)
  })
  it('passes filenames as single arguments, including shell metacharacters and spaces', () => {
    const env = { ELECTRON_RUN_AS_NODE: '1' }
    vi.mocked(resolveEditor).mockReturnValue({ command: 'Code.exe', args: ['cli.js', '--wait'], env })
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>)
    editFileExternally('/some dir/a;$(echo unsafe).ts', 'code')
    expect(spawnSync).toHaveBeenCalledWith('Code.exe', ['cli.js', '--wait', '/some dir/a;$(echo unsafe).ts'], { stdio: 'inherit', env })
  })
})
