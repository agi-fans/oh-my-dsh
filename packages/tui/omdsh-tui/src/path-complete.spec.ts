import { describe, expect, it } from 'vitest'
import { createTheme } from './theme.ts'
import { renderAutocomplete } from './autocomplete.ts'
import {
  applyPathCompletion,
  buildPathCompletions,
  findPathToken,
  formatPathValue,
  listPathCompletions,
  parsePathPrefix,
  pathSuggestions,
  resolveSearch,
  searchPathSuggestions,
  type DirEntry,
  type PathSearcher,
} from './path-complete.ts'

const theme = createTheme(false)

const listing: readonly DirEntry[] = [
  { name: '.git', directory: true },
  { name: '.env', directory: false },
  { name: 'README.md', directory: false },
  { name: 'src', directory: true },
  { name: 'a file.ts', directory: false },
]

const listDir = (dir: string): readonly DirEntry[] | undefined => {
  if (dir === '/proj' || dir === '/proj/') return listing
  if (dir === '/proj/src') return [{ name: 'index.ts', directory: false }]
  if (dir === '/home/me') return [{ name: 'notes.md', directory: false }]
  if (dir === '/tmp') return [{ name: 'foo', directory: false }]
  return undefined
}

const opts = { cwd: '/proj', home: '/home/me', listDir }

describe('findPathToken', () => {
  it('finds @ tokens after a delimiter and explicit path syntax', () => {
    expect(findPathToken('@src', 4)).toEqual({ start: 0, prefix: '@src', kind: 'at' })
    expect(findPathToken('see @src/f', 10)).toEqual({ start: 4, prefix: '@src/f', kind: 'at' })
    expect(findPathToken('./src', 5)).toEqual({ start: 0, prefix: './src', kind: 'path' })
    expect(findPathToken('cd ../lib', 9)).toEqual({ start: 3, prefix: '../lib', kind: 'path' })
    expect(findPathToken('~/Do', 4)).toEqual({ start: 0, prefix: '~/Do', kind: 'path' })
    expect(findPathToken('/tmp/f', 6)).toEqual({ start: 0, prefix: '/tmp/f', kind: 'path' })
  })

  it('rejects bare words and empty tokens unless forced', () => {
    expect(findPathToken('src', 3)).toBe(null)
    expect(findPathToken('see src', 7)).toBe(null)
    expect(findPathToken('see ', 4)).toBe(null)
    expect(findPathToken('src', 3, true)).toEqual({ start: 0, prefix: 'src', kind: 'path' })
    expect(findPathToken('see src', 7, true)).toEqual({ start: 4, prefix: 'src', kind: 'path' })
    expect(findPathToken('see ', 4, true)).toEqual({ start: 4, prefix: '', kind: 'path' })
  })

  it('scopes to the current line', () => {
    expect(findPathToken('one\n@src', 8)).toEqual({ start: 4, prefix: '@src', kind: 'at' })
  })
})

describe('parsePathPrefix / resolveSearch / formatPathValue', () => {
  it('strips @ and resolves listing vs basename prefixes', () => {
    expect(parsePathPrefix('@src/f')).toEqual({ raw: 'src/f', at: true })
    expect(parsePathPrefix('./src')).toEqual({ raw: './src', at: false })
    expect(resolveSearch('', '/proj', '/home/me')).toEqual({
      searchDir: '/proj',
      searchPrefix: '',
      displayBase: '',
    })
    expect(resolveSearch('src/', '/proj', '/home/me')).toEqual({
      searchDir: '/proj/src',
      searchPrefix: '',
      displayBase: 'src/',
    })
    expect(resolveSearch('./src', '/proj', '/home/me')).toEqual({
      searchDir: '/proj',
      searchPrefix: 'src',
      displayBase: './',
    })
    expect(resolveSearch('~/Do', '/proj', '/home/me')).toEqual({
      searchDir: '/home/me',
      searchPrefix: 'Do',
      displayBase: '~/',
    })
    expect(resolveSearch('/tmp/f', '/proj', '/home/me')).toEqual({
      searchDir: '/tmp',
      searchPrefix: 'f',
      displayBase: '/tmp/',
    })
    expect(formatPathValue('src/a file.ts', true)).toBe('@"src/a file.ts"')
    expect(formatPathValue('docs/', true)).toBe('@docs/')
  })
})

describe('buildPathCompletions', () => {
  it('skips .git, hides dotfiles unless the prefix starts with a dot, and ranks dirs first', () => {
    const items = buildPathCompletions(listing, '', '', true)
    expect(items.map((item) => item.label)).toEqual(['src/', 'a file.ts', 'README.md'])
    expect(items[0]).toMatchObject({ value: '@src/', kind: 'path' })
    expect(items.find((item) => item.value.includes('a file'))?.value).toBe('@"a file.ts"')
    const hidden = buildPathCompletions(listing, '', '.', true)
    expect(hidden.map((item) => item.label)).toEqual(['.env'])
  })
})

describe('pathSuggestions / applyPathCompletion', () => {
  it('suggests cwd files for @ and does not steal slash commands', () => {
    const at = pathSuggestions('@', 1, opts)
    expect(at?.items.map((item) => item.label)).toEqual(['src/', 'a file.ts', 'README.md'])
    expect(pathSuggestions('/', 1, opts)).toBe(null)
    expect(pathSuggestions('/copy ', 6, opts)).toBe(null)
    expect(pathSuggestions('/theme', 6, opts)).toBe(null)
  })

  it('lists /tmp when the token is an unmatched absolute path', () => {
    const result = pathSuggestions('/tmp/f', 6, opts)
    expect(result?.items.map((item) => item.value)).toEqual(['/tmp/foo'])
  })

  it('lists @src/ children and applies files vs directories', () => {
    const result = pathSuggestions('@src/', 5, opts)
    expect(result?.items).toEqual([
      { value: '@src/index.ts', label: 'index.ts', kind: 'path' },
    ])
    expect(applyPathCompletion('@src/', 5, result?.items[0] ?? { value: '', label: '' })).toEqual({
      text: '@src/index.ts ',
      cursor: 14,
    })
    expect(applyPathCompletion('@', 1, { value: '@src/', label: 'src/', kind: 'path' })).toEqual({
      text: '@src/',
      cursor: 5,
    })
    expect(applyPathCompletion('see @R', 6, { value: '@README.md', label: 'README.md', kind: 'path' })).toEqual({
      text: 'see @README.md ',
      cursor: 15,
    })
  })

  it('completes ~/ from the home listing', () => {
    const result = pathSuggestions('~/n', 3, opts)
    expect(result?.items.map((item) => item.value)).toEqual(['~/notes.md'])
  })

  it('lists bare-word matches only when forced', () => {
    expect(pathSuggestions('READ', 4, opts)).toBe(null)
    const forced = pathSuggestions('see READ', 8, { ...opts, force: true })
    expect(forced?.items.map((item) => item.value)).toEqual(['README.md'])
    expect(applyPathCompletion('see READ', 8, forced?.items[0] ?? { value: '', label: '' })).toEqual({
      text: 'see README.md ',
      cursor: 14,
    })
    expect(pathSuggestions('/copy ', 6, { ...opts, force: true })).toBe(null)
  })
})

describe('searchPathSuggestions', () => {
  const searchFiles: PathSearcher = async (_root, query) => {
    const entries = [
      { path: 'src/', directory: true },
      { path: 'src/index.ts', directory: false },
      { path: 'history-search.ts', directory: false },
    ]
    return entries.filter(entry => {
      let offset = 0
      for (const char of query.toLowerCase()) {
        offset = entry.path.toLowerCase().indexOf(char, offset)
        if (offset < 0) return false
        offset += 1
      }
      return true
    })
  }

  it('finds a nested project file by basename without its directory prefix', async () => {
    const result = await searchPathSuggestions('@index', 6, {
      ...opts,
      projectRoot: '/proj',
      searchFiles,
    })

    expect(result?.items).toContainEqual({
      value: '@src/index.ts',
      label: 'index.ts',
      description: 'src/index.ts',
      kind: 'path',
    })
  })

  it('supports abbreviated fuzzy filename queries', async () => {
    const result = await searchPathSuggestions('@histsr', 7, {
      ...opts,
      projectRoot: '/proj',
      searchFiles,
    })

    expect(result?.items).toContainEqual({
      value: '@history-search.ts',
      label: 'history-search.ts',
      kind: 'path',
    })
  })

  it('scopes slash queries while preserving their project-relative display path', async () => {
    const calls: Array<{ root: string; query: string }> = []
    const scopedSearch: PathSearcher = async (root, query) => {
      calls.push({ root, query })
      return [{ path: 'index.ts', directory: false }]
    }
    const result = await searchPathSuggestions('@src/ind', 8, {
      ...opts,
      projectRoot: '/proj',
      searchFiles: scopedSearch,
    })

    expect(calls).toEqual([{ root: '/proj/src', query: 'ind' }])
    expect(result?.items[0]).toEqual({
      value: '@src/index.ts',
      label: 'index.ts',
      description: 'src/index.ts',
      kind: 'path',
    })
  })

  it('keeps a trailing-slash directory browse synchronous', async () => {
    let searches = 0
    const result = await searchPathSuggestions('@src/', 5, {
      ...opts,
      projectRoot: '/proj',
      searchFiles: async () => {
        searches += 1
        return []
      },
    })

    expect(searches).toBe(0)
    expect(result?.items.map(item => item.value)).toEqual(['@src/index.ts'])
  })

  it('uses projectRoot for @ browsing when the process cwd is nested', () => {
    const result = pathSuggestions('@', 1, {
      ...opts,
      cwd: '/proj/apps/omdsh',
      projectRoot: '/proj',
    })

    expect(result?.items.map(item => item.value)).toContain('@README.md')
  })

  it('does not recursively search outside the project root', async () => {
    let searches = 0
    const result = await searchPathSuggestions('@../outside/wor', 15, {
      cwd: '/proj/app',
      projectRoot: '/proj',
      home: '/home/me',
      listDir: dir => dir === '/outside'
        ? [{ name: 'workspace.md', directory: false }]
        : undefined,
      searchFiles: async () => {
        searches += 1
        return []
      },
    })

    expect(searches).toBe(0)
    expect(result?.items.map(item => item.value)).toEqual(['@../outside/workspace.md'])
  })
})

describe('listPathCompletions / render', () => {
  it('returns nothing for an unreadable directory', () => {
    expect(listPathCompletions('@missing/', opts)).toEqual([])
  })

  it('paints path rows without a leading slash', () => {
    const lines = renderAutocomplete(
      [{ value: '@src/', label: 'src/', kind: 'path' }],
      0,
      theme,
      80,
    )
    expect(lines.some((line) => line.includes('src/'))).toBe(true)
    expect(lines.every((line) => !line.includes('/src/'))).toBe(true)
    expect(lines.at(-1)).toContain('↑↓ select')
    expect(lines.at(-1)).toContain('Tab insert')
    expect(lines.at(-1)).toContain('Enter send')
    expect(lines.at(-1)).toContain('Esc close')
  })
})
