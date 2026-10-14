import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TuiToolPresentation } from '../chrome/tool-renderers.ts'
import type { Block } from './transcript-types.ts'
import { blockFileAction, toolFileLocations } from './file-actions.ts'

describe('provider-owned file actions', () => {
  it('uses locations and result metadata without guessing from arguments, titles or output', () => {
    expect(blockFileAction({ kind: 'tool', name: 'read', args: '{"path":"secret"}', output: '/secret', status: 'ok', callId: 'c' } as Block)).toBeUndefined()
    const view: TuiToolPresentation = { cwd: '/original', call: { card: 'generic', title: 'provider title', locations: [{ path: '中文 🐳.ts' }] },
      result: { card: 'read', path: '中文 🐳.ts', offset: 40, totalLines: 50, lines: [] } }
    expect(toolFileLocations(view)).toEqual([{ path: '中文 🐳.ts', line: 40 }])
    const action = blockFileAction({ kind: 'tool', presentation: view } as Block)
    expect(action).toMatchObject({ cwd: '/original', files: [{ path: resolve('/original', '中文 🐳.ts'), label: '中文 🐳.ts', line: 40 }] })
  })

  it('supports generic, diff and search providers and filters unsafe declarations', () => {
    expect(toolFileLocations({ call: { card: 'diff', title: 'edit', diffs: [{ path: 'a.ts', oldText: '', newText: '' }], locations: [{ path: 'a.ts', line: 2 }, { path: 'bad\x1b.ts' }] },
      result: { card: 'diff', diffs: [{ path: 'b.ts', oldText: null, newText: '' }] } })).toEqual([{ path: 'a.ts', line: 2 }, { path: 'b.ts' }])
    expect(toolFileLocations({ result: { card: 'search', shape: 'matches', files: [{ path: 'a.ts', matches: [{ lineNumber: 12, line: 'match' }] }], total: 1, truncated: false } })).toEqual([{ path: 'a.ts', line: 12 }])
    expect(toolFileLocations({ result: { card: 'search', shape: 'paths', paths: ['a.ts', 'b.ts'], total: 2, truncated: false } })).toEqual([{ path: 'a.ts' }, { path: 'b.ts' }])
  })

  it('does not resolve an old relative call against the current directory when the original is unavailable', () => {
    expect(blockFileAction({ kind: 'tool', presentation: { call: { card: 'generic', title: 'read', locations: [{ path: 'relative.ts' }] } } } as Block)).toBeUndefined()
    const absolute = resolve('absolute.ts')
    expect(blockFileAction({ kind: 'tool', presentation: { call: { card: 'generic', title: 'read', locations: [{ path: absolute }] } } } as Block)?.files[0]?.path).toBe(absolute)
  })

  it('merges a relative call location with the canonical result path while retaining the result line', () => {
    const absolute = resolve('a.ts')
    const action = blockFileAction({ kind: 'tool', presentation: { cwd: process.cwd(),
      call: { card: 'generic', title: 'Read', locations: [{ path: 'a.ts' }] },
      result: { card: 'read', path: absolute, offset: 40, totalLines: 80, lines: [] } } } as Block)
    expect(action?.files).toEqual([{ path: absolute, label: 'a.ts', line: 40 }])
  })

  it('retains the summary directory and exposes current file contents without promising a restorable checkpoint', () => {
    expect(blockFileAction({ kind: 'workspace', turn: 1 })).toBeUndefined()
    expect(blockFileAction({ kind: 'workspace', turn: 1, summary: { turn: 1, cwd: '/original', files: [{ path: 'a.ts', display: 'a.ts' }] } } as Block))
      .toMatchObject({ cwd: '/original', title: 'Turn 1 files · current contents', files: [{ path: 'a.ts', label: 'a.ts' }] })
  })
})
