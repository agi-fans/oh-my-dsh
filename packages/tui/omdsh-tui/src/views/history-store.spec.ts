import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HistoryStore } from './history-store.ts'

describe('HistoryStore', () => {
  it('round-trips multiline prompts as JSONL', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'omdsh-history-')), 'history.jsonl')
    const store = new HistoryStore(path)
    store.add('one\ntwo')
    expect(store.load()).toEqual(['one\ntwo'])
    expect(readFileSync(path, 'utf8')).toContain('\\n')
  })
})
