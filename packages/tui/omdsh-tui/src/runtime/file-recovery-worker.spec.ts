import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, unlink, open, stat, chmod, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { FileRecoveryStore } from './file-recovery-store.ts'
import { restoreRecoveryFile, type RecoveryWorkerRequest } from './file-recovery-worker.ts'

const hooks = vi.hoisted(() => ({ claim: undefined as undefined | ((source: string, backup: string) => Promise<void>) }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: async (source: string, destination: string) => {
    await actual.rename(source, destination)
    if (destination.endsWith('.backup')) await hooks.claim?.(source, destination)
  } }
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'omdsh-recovery-worker-')), workspace = join(root, 'workspace'), directory = join(root, 'store')
  await mkdir(workspace)
  onTestFinished(async () => { hooks.claim = undefined; await rm(root, { recursive: true, force: true }) })
  const signal = new AbortController().signal, store = new FileRecoveryStore(directory)
  const capture = () => store.capture(workspace, async () => ({ paths: (await readdir(workspace)).filter(name => !name.startsWith('.')), excluded: [] }), signal)
  const request = async (before: string, after: string, path: string): Promise<RecoveryWorkerRequest> => {
    const plan = await store.plan(before, after, signal)
    return { root: workspace, rootIdentity: plan.rootIdentity, directory,
      operation: plan.operations.find(operation => operation.path === path)!, operationId: randomUUID(), maxFileBytes: store.limits.maxFileBytes }
  }
  return { root, workspace, directory, signal, store, capture, request }
}

describe('host file recovery operation', () => {
  it('restores binary bytes and file modes, removes a created file and recreates a deleted one', async () => {
    const h = await fixture(), binary = Buffer.from([0, 255, 128, 42])
    await writeFile(join(h.workspace, 'binary'), binary); await writeFile(join(h.workspace, 'deleted'), 'before')
    if (process.platform !== 'win32') await chmod(join(h.workspace, 'binary'), 0o755)
    const before = await h.capture()
    await writeFile(join(h.workspace, 'binary'), 'after'); await unlink(join(h.workspace, 'deleted')); await writeFile(join(h.workspace, 'created'), 'new')
    const after = await h.capture()
    for (const path of ['binary', 'created', 'deleted']) {
      expect(await restoreRecoveryFile(await h.request(before.id, after.id, path))).toMatchObject({ path, status: 'restored' })
    }
    expect(await readFile(join(h.workspace, 'binary'))).toEqual(binary)
    if (process.platform !== 'win32') expect((await stat(join(h.workspace, 'binary'))).mode & 0o777).toBe(0o755)
    expect(await readFile(join(h.workspace, 'deleted'), 'utf8')).toBe('before')
    await expect(stat(join(h.workspace, 'created'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await readdir(h.workspace)).filter(name => name.endsWith('.backup'))).toHaveLength(2)
  })

  it('rechecks the file after preview and preserves later user work', async () => {
    const h = await fixture(); await writeFile(join(h.workspace, 'file'), 'before'); const before = await h.capture()
    await writeFile(join(h.workspace, 'file'), 'after'); const after = await h.capture(), request = await h.request(before.id, after.id, 'file')
    await writeFile(join(h.workspace, 'file'), 'user changed this after preview')
    expect(await restoreRecoveryFile(request)).toMatchObject({ status: 'conflict' })
    expect(await readFile(join(h.workspace, 'file'), 'utf8')).toBe('user changed this after preview')
    expect((await readdir(h.workspace)).filter(name => name.startsWith('.omdsh-recovery-'))).toEqual([])
  })

  it('does not overwrite a new file created during the publication gap and retains the displaced entry', async () => {
    const h = await fixture(); await writeFile(join(h.workspace, 'file'), 'before'); const before = await h.capture()
    await writeFile(join(h.workspace, 'file'), 'after'); const after = await h.capture()
    const request = await h.request(before.id, after.id, 'file')
    hooks.claim = async source => { await writeFile(source, 'racing user file', { flag: 'wx' }) }
    const result = await restoreRecoveryFile(request)
    expect(result.status).toBe('conflict')
    expect(await readFile(join(h.workspace, 'file'), 'utf8')).toBe('racing user file')
    expect(await readFile(join(h.workspace, result.backup!), 'utf8')).toBe('after')
  })

  it('preserves a writer holding the old descriptor while the entry is being claimed', async () => {
    const h = await fixture(); await writeFile(join(h.workspace, 'file'), 'before'); const before = await h.capture()
    await writeFile(join(h.workspace, 'file'), 'after'); const after = await h.capture()
    const request = await h.request(before.id, after.id, 'file'), writer = await open(join(h.workspace, 'file'), 'r+')
    hooks.claim = async () => { await writer.truncate(0); await writer.writeFile('user wrote through original descriptor') }
    try {
      expect(await restoreRecoveryFile(request)).toMatchObject({ status: 'conflict' })
      expect(await readFile(join(h.workspace, 'file'), 'utf8')).toBe('user wrote through original descriptor')
    } finally { await writer.close() }
  })

  it('fails before displacing the live file when retained content is corrupt', async () => {
    const h = await fixture(); await writeFile(join(h.workspace, 'file'), 'before'); const before = await h.capture()
    await writeFile(join(h.workspace, 'file'), 'after'); const after = await h.capture(), request = await h.request(before.id, after.id, 'file')
    if (request.operation.before.kind !== 'file') throw new Error('Expected content')
    await writeFile(h.store.blobPath(request.operation.before.hash), 'broken')
    expect(await restoreRecoveryFile(request)).toMatchObject({ status: 'failed' })
    expect(await readFile(join(h.workspace, 'file'), 'utf8')).toBe('after')
    expect((await readdir(h.workspace)).filter(name => name.startsWith('.omdsh-recovery-'))).toEqual([])
  })

  it('cannot bypass a scope conflict by passing the plan directly to the worker', async () => {
    const h = await fixture(); await writeFile(join(h.workspace, 'file'), 'pre-existing ignored data')
    const before = await h.store.capture(h.workspace, async () => ({ paths: [], excluded: ['file'] }), h.signal)
    const after = await h.capture()
    expect(await restoreRecoveryFile(await h.request(before.id, after.id, 'file'))).toMatchObject({ status: 'conflict' })
    expect(await readFile(join(h.workspace, 'file'), 'utf8')).toBe('pre-existing ignored data')
  })

  it('does not restore an old snapshot into a replacement directory at the same path', async () => {
    const h = await fixture(); await writeFile(join(h.workspace, 'deleted'), 'before'); const before = await h.capture()
    await unlink(join(h.workspace, 'deleted')); const after = await h.capture(), request = await h.request(before.id, after.id, 'deleted')
    await rename(h.workspace, join(h.root, 'old-workspace')); await mkdir(h.workspace)
    expect(await restoreRecoveryFile(request)).toMatchObject({ status: 'conflict', reason: expect.stringContaining('workspace was replaced') })
    expect(await readdir(h.workspace)).toEqual([])
  })
})
