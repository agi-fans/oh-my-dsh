import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseLocalFileLink, parseLocalFileLinkCandidates } from './local-file-link.ts'

describe('parseLocalFileLink', () => {
  const base = resolve('/workspace/project')
  const home = resolve('/home/tester')

  it('parses relative paths with hash and colon line locators', () => {
    expect(parseLocalFileLink('src/app.ts#L42-L50', base, home)).toEqual({
      path: resolve(base, 'src/app.ts'),
      label: 'src/app.ts',
      line: 42,
    })
    expect(parseLocalFileLink('./src/app.ts#L12C4-L15C9', base, home)).toEqual({
      path: resolve(base, 'src/app.ts'),
      label: 'src/app.ts',
      line: 12,
      column: 4,
    })
    expect(parseLocalFileLink('src/app.ts:88:3', base, home)).toEqual({
      path: resolve(base, 'src/app.ts'),
      label: 'src/app.ts',
      line: 88,
      column: 3,
    })
    expect(parseLocalFileLink('src/app.ts:10–20', base, home)).toEqual({
      path: resolve(base, 'src/app.ts'),
      label: 'src/app.ts',
      line: 10,
    })
  })

  it('parses file:// URIs, home paths, percent-encoding, and non-line markdown anchors', () => {
    const abs = resolve(base, 'docs/my file.md')
    expect(parseLocalFileLink(`${pathToFileURL(abs).href}#L7`, base, home)).toEqual({
      path: abs,
      label: 'docs/my file.md',
      line: 7,
    })
    expect(parseLocalFileLink('~/notes/plan.md:5', base, home)).toEqual({
      path: resolve(home, 'notes/plan.md'),
      label: '~/notes/plan.md',
      line: 5,
    })
    expect(parseLocalFileLink('README.md#overview', base, home)).toEqual({
      path: resolve(base, 'README.md'),
      label: 'README.md',
    })
    expect(parseLocalFileLink('C:/repo/file.ts:15', base, home)).toEqual({
      path: 'C:/repo/file.ts',
      label: 'C:/repo/file.ts',
      line: 15,
    })
  })

  it('rejects web links, remote file hosts, UNC shares, pure anchors, queries, and directories', () => {
    for (const target of [
      '',
      'https://example.com/a.ts#L10',
      'http://localhost:3000/a.ts',
      'mailto:user@example.com',
      'javascript:alert(1)',
      'file://remote-host/share/file.ts',
      '//server/share/file.ts',
      '\\\\server\\share\\file.ts',
      '/\\server/share/file.ts',
      '\\/server/share/file.ts',
      '~///server/share/file.ts',
      '~\\/server/share/file.ts',
      '~/\\server/share/file.ts',
      '#only-anchor',
      'src/app.ts?raw=1',
      'src/dir/',
      '~',
      'foo:bar',
      'src/bad\x00file.ts',
    ]) {
      expect(parseLocalFileLink(target, base, home), target).toBeUndefined()
    }
  })

  it('produces deduplicated fallback candidates across cwd and repository root', () => {
    const sub = resolve(base, 'apps/omdsh')
    expect(parseLocalFileLinkCandidates('packages/a.ts#L5', [sub, base], home)).toEqual([
      { path: resolve(sub, 'packages/a.ts'), label: 'packages/a.ts', line: 5 },
      { path: resolve(base, 'packages/a.ts'), label: 'packages/a.ts', line: 5 },
    ])
    expect(parseLocalFileLinkCandidates(resolve(base, 'packages/a.ts'), [sub, base], home)).toHaveLength(1)
  })
})
