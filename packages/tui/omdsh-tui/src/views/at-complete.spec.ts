import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import { nextSelectableAutocompleteIndex, searchAtSuggestions, filesOnlyAtQuery } from './at-complete.ts'
import type { DirEntry } from './path-complete.ts'

const listing: readonly DirEntry[] = [
  { name: 'README.md', directory: false },
  { name: 'src', directory: true },
]

describe('filesOnlyAtQuery', () => {
  it('keeps quoted tokens and path fragments on the file side', () => {
    expect(filesOnlyAtQuery('"docs')).toBe(true)
    expect(filesOnlyAtQuery("'docs")).toBe(true)
    expect(filesOnlyAtQuery('src/index')).toBe(true)
    expect(filesOnlyAtQuery('notes')).toBe(false)
    expect(filesOnlyAtQuery('')).toBe(false)
  })
})

describe('searchAtSuggestions', () => {
  const opts = {
    cwd: '/proj',
    projectRoot: '/proj',
    home: '/home/me',
    listDir: (dir: string): readonly DirEntry[] | undefined => dir === '/proj' ? listing : undefined,
    searchFiles: async () => [],
  }

  it('lists files then sessions under headings for an unquoted @ token', async () => {
    const result = await searchAtSuggestions('@', 1, {
      ...opts,
      searchSessions: async () => [
        { sessionId: 'session-a', label: 'Research notes', cwd: '/proj' },
      ],
    })
    expect(result?.items.map(item => [item.kind, item.label])).toEqual([
      ['heading', 'Files & folders'],
      ['path', 'src/'],
      ['path', 'README.md'],
      ['heading', 'Session conversations'],
      ['session', 'Research notes'],
    ])
    expect(result?.items.find(item => item.kind === 'session')?.value).toBe(
      formatSessionReferenceMention({ sessionId: SessionId('session-a'), label: 'Research notes' }),
    )
  })

  it('omits sessions for quoted @" tokens', async () => {
    let queried = false
    const result = await searchAtSuggestions('@"src/', 6, {
      ...opts,
      listDir: (dir: string): readonly DirEntry[] | undefined => {
        if (dir.endsWith('src') || dir.includes('"src')) return [{ name: 'index.ts', directory: false }]
        return listing
      },
      searchSessions: async () => {
        queried = true
        return [{ sessionId: 'session-a', label: 'Research notes' }]
      },
    })
    expect(queried).toBe(false)
    expect(result?.items.some(item => item.kind === 'session') ?? false).toBe(false)
  })

  it('keeps files when session discovery fails', async () => {
    const result = await searchAtSuggestions('@', 1, {
      ...opts,
      searchSessions: async () => { throw new Error('query unavailable') },
    })
    expect(result?.items.some(item => item.kind === 'path')).toBe(true)
    expect(result?.items.some(item => item.kind === 'session')).toBe(false)
  })

  it('formats file-reference candidates with the Harness mention grammar', async () => {
    const result = await searchAtSuggestions('@read', 5, {
      ...opts,
      searchFileMentions: async () => [
        { path: 'README.md', kind: 'file' },
        { path: 'src', kind: 'directory' },
      ],
    })
    expect(result?.items.filter(item => item.kind === 'path').map(item => item.value)).toEqual([
      '@README.md',
      '@src/',
    ])
  })

  it('does not fall back to local path listing when file-reference returns nothing', async () => {
    let listed = false
    const result = await searchAtSuggestions('@missing', 8, {
      ...opts,
      listDir: () => {
        listed = true
        return listing
      },
      searchFileMentions: async () => [],
      searchSessions: async () => [
        { sessionId: 'session-a', label: 'Research notes' },
      ],
    })
    expect(listed).toBe(false)
    expect(result?.items.some(item => item.kind === 'path') ?? false).toBe(false)
    expect(result?.items.map(item => [item.kind, item.label])).toEqual([
      ['heading', 'Session conversations'],
      ['session', 'Research notes'],
    ])
  })

  it('does not fall back to local path listing when file-reference fails', async () => {
    let listed = false
    const result = await searchAtSuggestions('@read', 5, {
      ...opts,
      listDir: () => {
        listed = true
        return listing
      },
      searchFileMentions: async () => { throw new Error('index unavailable') },
      searchSessions: async () => [
        { sessionId: 'session-a', label: 'Research notes' },
      ],
    })
    expect(listed).toBe(false)
    expect(result?.items.some(item => item.kind === 'path') ?? false).toBe(false)
    expect(result?.items.some(item => item.kind === 'session')).toBe(true)
  })

  it('cancels @ suggestions without a local path fallback', async () => {
    let listed = false
    const error = new Error('aborted')
    error.name = 'AbortError'
    const result = await searchAtSuggestions('@read', 5, {
      ...opts,
      listDir: () => {
        listed = true
        return listing
      },
      searchFileMentions: async () => { throw error },
      searchSessions: async () => [
        { sessionId: 'session-a', label: 'Research notes' },
      ],
    })
    expect(listed).toBe(false)
    expect(result).toBeNull()
  })

  it('does not treat an email address as an @ mention token', async () => {
    let files = false
    let sessions = false
    const result = await searchAtSuggestions('dev@example.com', 15, {
      ...opts,
      searchFileMentions: async () => {
        files = true
        return [{ path: 'README.md', kind: 'file' }]
      },
      searchSessions: async () => {
        sessions = true
        return [{ sessionId: 'session-a', label: 'Research notes' }]
      },
    })
    expect(files).toBe(false)
    expect(sessions).toBe(false)
    expect(result?.items.some(item => item.kind === 'session') ?? false).toBe(false)
  })
})

describe('nextSelectableAutocompleteIndex', () => {
  it('skips heading rows in both directions', () => {
    const items = [
      { value: '', label: 'Files & folders', kind: 'heading' as const },
      { value: '@a', label: 'a', kind: 'path' as const },
      { value: '', label: 'Session conversations', kind: 'heading' as const },
      { value: '@b', label: 'b', kind: 'session' as const },
    ]
    expect(nextSelectableAutocompleteIndex(items, 0, 1)).toBe(1)
    expect(nextSelectableAutocompleteIndex(items, 2, 1)).toBe(3)
    expect(nextSelectableAutocompleteIndex(items, 4, 1)).toBe(1)
    expect(nextSelectableAutocompleteIndex(items, 0, -1)).toBe(3)
  })
})
