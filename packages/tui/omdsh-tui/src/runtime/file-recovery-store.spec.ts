import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, unlink, symlink, link, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, onTestFinished } from 'vitest'
import { FileRecoveryStore, recoveryRelativePath, recoveryState } from './file-recovery-store.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'omdsh-recovery-')), workspace = join(root, 'workspace'), directory = join(root, 'store')
  await mkdir(workspace)
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const signal = new AbortController().signal, store = new FileRecoveryStore(directory)
  const inventory = async () => ({ paths: (await readdir(workspace)).filter(name => !name.startsWith('.')), excluded: [] })
  const capture = () => store.capture(workspace, inventory, signal)
  return { root, workspace, directory, store, signal, capture, inventory }
}

describe('durable file recovery snapshots', () => {
  it('retains raw bytes, created and deleted paths and executable modes across a restart', async () => {
    const h = await fixture(), binary = Buffer.from([0, 255, 1, 0, 128])
    await writeFile(join(h.workspace, 'binary.bin'), binary)
    await writeFile(join(h.workspace, 'deleted.txt'), 'original')
    await writeFile(join(h.workspace, 'script'), 'before')
    if (process.platform !== 'win32') await chmod(join(h.workspace, 'script'), 0o755)
    const before = await h.capture()
    await writeFile(join(h.workspace, 'binary.bin'), Buffer.from([3, 0]))
    await unlink(join(h.workspace, 'deleted.txt'))
    await writeFile(join(h.workspace, 'created.txt'), 'new')
    await writeFile(join(h.workspace, 'script'), 'after')
    const after = await h.capture(), restored = new FileRecoveryStore(h.directory)
    const plan = await restored.plan(before.id, after.id, h.signal)
    expect(plan.operations.map(operation => [operation.path, operation.status])).toEqual([
      ['binary.bin', 'ready'], ['created.txt', 'ready'], ['deleted.txt', 'ready'], ['script', 'ready']])
    const original = (await restored.read(before.id)).entries.find(entry => entry.path === 'binary.bin')!
    if (original.state.kind !== 'file') throw new Error('Expected a raw binary snapshot')
    expect(await readFile(restored.blobPath(original.state.hash))).toEqual(binary)
    const script = before.entries.find(entry => entry.path === 'script')!
    if (process.platform !== 'win32') expect(script.state).toMatchObject({ mode: 0o755 })
    expect(plan.operations.find(operation => operation.path === 'deleted.txt')?.after).toEqual({ kind: 'missing' })
    expect(plan.operations.find(operation => operation.path === 'created.txt')?.before).toEqual({ kind: 'missing' })
  })

  it('protects later user writes, recreated deleted files and identical-content rewrites', async () => {
    const h = await fixture()
    for (const name of ['edited', 'deleted', 'same', 'already']) await writeFile(join(h.workspace, name), 'before')
    const before = await h.capture()
    for (const name of ['edited', 'same', 'already']) await writeFile(join(h.workspace, name), 'after')
    await unlink(join(h.workspace, 'deleted'))
    const after = await h.capture()
    await writeFile(join(h.workspace, 'edited'), 'later user work')
    await writeFile(join(h.workspace, 'deleted'), 'user recreated this')
    await writeFile(join(h.workspace, 'same'), 'after')
    await writeFile(join(h.workspace, 'already'), 'before')
    const plan = await h.store.plan(before.id, after.id, h.signal)
    expect(plan.operations.map(operation => [operation.path, operation.status])).toEqual([
      ['already', 'already-restored'], ['deleted', 'conflict'], ['edited', 'conflict'], ['same', 'conflict']])
    expect(await readFile(join(h.workspace, 'edited'), 'utf8')).toBe('later user work')
  })

  it('captures links without following them and refuses replaced directory parents', async () => {
    const h = await fixture()
    // Directory junctions are supported without requiring Windows symlink privileges.
    await mkdir(join(h.workspace, 'folder')); await writeFile(join(h.workspace, 'folder', 'file'), 'before')
    const inventory = async () => ({ paths: ['folder/file'], excluded: [] })
    const before = await h.store.capture(h.workspace, inventory, h.signal)
    await writeFile(join(h.workspace, 'folder', 'file'), 'after')
    const after = await h.store.capture(h.workspace, inventory, h.signal)
    const outside = join(h.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'file'), 'outside')
    await rm(join(h.workspace, 'folder'), { recursive: true }); await symlink(outside, join(h.workspace, 'folder'), process.platform === 'win32' ? 'junction' : 'dir')
    expect((await h.store.plan(before.id, after.id, h.signal)).operations[0]).toMatchObject({ status: 'conflict', reason: expect.stringContaining('ordinary directory') })
    expect(await readFile(join(outside, 'file'), 'utf8')).toBe('outside')
    if (process.platform !== 'win32') {
      await symlink('../outside/file', join(h.workspace, 'link'))
      expect((await recoveryState(h.workspace, 'link', 1024, h.signal)).state).toMatchObject({ kind: 'link', target: Buffer.from('../outside/file').toString('base64') })
    }
  })

  it('publishes no snapshot when the workspace changes during capture or exceeds a bound', async () => {
    const h = await fixture(); await writeFile(join(h.workspace, 'file'), 'first')
    let scans = 0
    await expect(h.store.capture(h.workspace, async () => {
      if (++scans === 2) await writeFile(join(h.workspace, 'file'), 'later')
      return { paths: ['file'], excluded: [] }
    }, h.signal)).rejects.toThrow('changed during snapshot')
    expect(await readdir(join(h.directory, 'snapshots')).catch(() => [])).toEqual([])
    const limited = new FileRecoveryStore(h.directory, { maxFiles: 1, maxFileBytes: 1, maxSnapshotBytes: 1 })
    await expect(limited.capture(h.workspace, h.inventory, h.signal)).rejects.toThrow('snapshot limit')
    await link(join(h.workspace, 'file'), join(h.workspace, 'alias'))
    await expect(h.capture()).rejects.toThrow('hard links')
  })

  it('fails closed on corrupted manifests, invalid paths and pre-aborted capture', async () => {
    const h = await fixture(); await writeFile(join(h.workspace, 'file'), 'before')
    const snapshot = await h.capture(), path = join(h.directory, 'snapshots', snapshot.id + '.json')
    const envelope = JSON.parse(await readFile(path, 'utf8')); envelope.snapshot.entries[0].path = '../outside'
    await writeFile(path, JSON.stringify(envelope))
    await expect(h.store.read(snapshot.id)).rejects.toThrow('validation')
    for (const bad of ['../x', '/x', 'a/../x', '.git/config', '.omdsh-recovery-backup/file', 'bad\0name']) expect(() => recoveryRelativePath(bad)).toThrow()
    const abort = new AbortController(); abort.abort()
    await expect(h.store.capture(h.workspace, h.inventory, abort.signal)).rejects.toThrow()
    expect(await readdir(join(h.directory, 'snapshots'))).toHaveLength(1)
  })

  it('does not misidentify a previously ignored existing file as a new creation', async () => {
    const h = await fixture(); await writeFile(join(h.workspace, 'was-ignored'), 'existing user file')
    const before = await h.store.capture(h.workspace, async () => ({ paths: [], excluded: ['was-ignored'] }), h.signal)
    const after = await h.capture()
    expect((await h.store.plan(before.id, after.id, h.signal)).operations).toMatchObject([
      { path: 'was-ignored', status: 'conflict', reason: expect.stringContaining('original content is unknown') }])
    expect(await readFile(join(h.workspace, 'was-ignored'), 'utf8')).toBe('existing user file')
  })
})
