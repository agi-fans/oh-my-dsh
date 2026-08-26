import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readPinnedSessions, sortSessionRows, togglePinnedSession, writePinnedSessions } from './session-library.ts'

describe('Session Library metadata', () => {
  it('tolerates corrupt input and atomically stores distinct pins', () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-session-library-'))
    const path = join(root, 'nested', 'sessions.json')
    writeFileSync(join(root, 'bad.json'), '{')
    expect(readPinnedSessions(join(root, 'bad.json'))).toEqual([])
    writePinnedSessions(path, ['session-b', 'session-b', '', 'session-a'])
    expect(readPinnedSessions(path)).toEqual(['session-b', 'session-a'])
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ pinned: ['session-b', 'session-a'] })
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
