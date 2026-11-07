import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readSessionLibrary, sessionArgumentOptions, setSessionLabel, sortSessionRows, togglePinnedSession, updateSessionLibrary } from './session-library.ts'

describe('session argument presentation', () => {
  it('leads with the title and shows activity time and status instead of an ID column', () => {
    expect(sessionArgumentOptions([{ id: 'session-12345678-long-id', title: 'omdsh 中文简介', createdAt: 0, updatedAt: 60_000, status: 'done' }], 180_000))
      .toEqual([{ value: 'session-12345678-long-id', label: 'omdsh 中文简介', description: '2m ago · done' }])
  })

  it('distinguishes duplicate titles with short IDs and gives untitled sessions a readable label', () => {
    expect(sessionArgumentOptions([
      { id: 'session-12345678-a', title: 'Same\n title', createdAt: 0 },
      { id: 'session-87654321-b', title: 'Same title', createdAt: 0 },
      { id: 'session-untitled', title: 'session-untitled', createdAt: 0 },
    ], 0)).toEqual([
      { value: 'session-12345678-a', label: 'Same title', description: 'just now · 12345678' },
      { value: 'session-87654321-b', label: 'Same title', description: 'just now · 87654321' },
      { value: 'session-untitled', label: 'Untitled session', description: 'just now' },
    ])
  })
})

describe('Session Library metadata', () => {
  it('tolerates corrupt input and atomically stores distinct pins', () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-session-library-'))
    const path = join(root, 'nested', 'sessions.json')
    writeFileSync(join(root, 'bad.json'), '{')
    expect(readSessionLibrary(join(root, 'bad.json'))).toEqual({ pinned: [], archived: [], labels: {} })
    writeFileSync(join(root, 'old.json'), JSON.stringify({ pinned: ['session-b', 'session-b', '', 'session-a'] }))
    updateSessionLibrary(path, () => readSessionLibrary(join(root, 'old.json')))
    expect(readSessionLibrary(path).pinned).toEqual(['session-b', 'session-a'])
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ pinned: ['session-b', 'session-a'], archived: [], labels: {} })
  })

  it('toggles pins and orders pinned rows before recent rows', () => {
    expect(togglePinnedSession(['a'], 'a')).toEqual([])
    expect(togglePinnedSession(['a'], 'b')).toEqual(['b', 'a'])
    expect(sortSessionRows([
      { id: 'a', createdAt: 3 },
      { id: 'b', createdAt: 2 },
      { id: 'c', createdAt: 4 },
    ], ['b', 'a']).map(row => row.id)).toEqual(['b', 'a', 'c'])
  })
})


describe('library labels and archives', () => {
  it('preserves pins, archives and labels across independent mutations and restarts', () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-library-metadata-'))
    const path = join(root, 'library.json')
    writeFileSync(path, JSON.stringify({ pinned: ['a'] }))
    setSessionLabel(path, 'turn:a:1', '  重要步骤 🐳\nCheckpoint  ')
    updateSessionLibrary(path, current => ({ ...current, archived: ['b'] }))
    updateSessionLibrary(path, current => ({ ...current, pinned: togglePinnedSession(current.pinned, 'c') }))
    expect(readSessionLibrary(path)).toEqual({ pinned: ['c', 'a'], archived: ['b'], labels: { 'turn:a:1': '重要步骤 🐳 Checkpoint' } })
    setSessionLabel(path, 'turn:a:1', '')
    expect(readSessionLibrary(path)).toEqual({ pinned: ['c', 'a'], archived: ['b'], labels: {} })
  })

  it('ignores malformed labels and bounds new labels without changing the stored document', () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-library-label-'))
    const path = join(root, 'library.json')
    writeFileSync(path, JSON.stringify({ pinned: ['a'], archived: [null, ' b ', 'b'], labels: { good: '中文 🐳', bad: 123, empty: ' ', long: '🐳'.repeat(121) } }))
    expect(readSessionLibrary(path)).toEqual({ pinned: ['a'], archived: ['b'], labels: { good: '中文 🐳' } })
    const before = readFileSync(path, 'utf8')
    expect(() => setSessionLabel(path, 'good', '🐳'.repeat(121))).toThrow('120 characters')
    expect(readFileSync(path, 'utf8')).toBe(before)
    setSessionLabel(path, 'good', '🐳'.repeat(120))
    expect(readSessionLibrary(path).labels['good']).toBe('🐳'.repeat(120))
  })
})
