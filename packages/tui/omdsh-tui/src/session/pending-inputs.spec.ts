import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PendingInputs } from './pending-inputs.ts'
import * as json from './json-file.ts'

const directories: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-pending-'))
  directories.push(root)
  const error = vi.fn()
  const open = () => new PendingInputs(root, error)
  return { root, error, open }
}

it('retains uncertain admission until the matching Harness identity is reconciled', () => {
  const f = fixture(), pending = f.open()
  const submission = { text: 'once', images: [] }
  pending.take(submission, 'a')
  pending.prepare(submission, 'accepted-id')
  const recovered = f.open()
  recovered.reconcile('b', new Set(['accepted-id']))
  expect(recovered.session('a').queued).toHaveLength(1)
  recovered.reconcile('a', new Set(['other-id']))
  expect(recovered.session('a').queued).toHaveLength(1)
  recovered.reconcile('a', new Set(['accepted-id']))
  expect(f.open().session('a').queued).toEqual([])
})

it('keeps private recovery files outside any path selected by session identifiers', () => {
  const f = fixture(), pending = f.open()
  const id = '../../elsewhere', submission = { text: '!a shell command', images: [] }
  pending.session(id).queued.push(submission)
  pending.flush(id)
  const files = readdirSync(f.root)
  expect(files).toEqual([createHash('sha256').update(id).digest('hex') + '.json'])
  if (process.platform !== 'win32') expect(statSync(join(f.root, files[0]!)).mode & 0o777).toBe(0o600)
  expect(f.open().session(id).queued).toEqual([submission])
  expect(f.open().receipt(submission)).toBeUndefined()
})

it('leaves a damaged recovery file intact and reports it once', () => {
  const f = fixture(), pending = f.open()
  pending.take({ text: 'kept', images: [] }, 'a')
  const path = join(f.root, readdirSync(f.root)[0]!)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  raw.entries[0].submission.images = [{ mediaType: 'image/png', data: 'broken!' }]
  const damaged = JSON.stringify(raw)
  writeFileSync(path, damaged)
  const next = f.open()
  expect(next.session('a').queued).toEqual([])
  next.flush('a'); next.flush('a')
  expect(readFileSync(path, 'utf8')).toBe(damaged)
  expect(f.error).toHaveBeenCalledOnce()
})

it('retries a failed save without recursive error reports and skips unchanged input', () => {
  const f = fixture(), pending = f.open()
  const write = vi.spyOn(json, 'writeJsonAtomic').mockImplementation(() => { throw new Error('disk full') })
  // A terminal error notice paints another frame and attempts another flush.
  f.error.mockImplementation(() => pending.flush('a'))
  pending.take({ text: 'keep', images: [] }, 'a')
  pending.flush('a')
  expect(f.error).toHaveBeenCalledOnce()
  write.mockRestore()
  const saved = vi.spyOn(json, 'writeJsonAtomic')
  pending.flush('a'); pending.flush('a')
  expect(saved).toHaveBeenCalledOnce()
  expect(f.open().session('a').queued[0]?.text).toBe('keep')
})
