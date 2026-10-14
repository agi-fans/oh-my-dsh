/** One confined host-file recovery operation. The parent owns durable receipts. */
import { createHash } from 'node:crypto'
import { chmod, link, lstat, mkdir, open, readFile, readlink, rename, rm, symlink } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { FileRecoveryStore, recoveryHostPath, recoveryHostState, recoveryRelativePath, recoveryRootIdentity, recoveryState, sameRecoveryContent, sameRecoveryVersion,
  type RecoveryOperation } from './file-recovery-store.ts'

export interface RecoveryWorkerRequest { root: string; rootIdentity: string; directory: string; operation: RecoveryOperation; operationId: string; maxFileBytes: number }
export interface RecoveryWorkerResult {
  path: string
  status: 'restored' | 'conflict' | 'already-restored' | 'failed'
  reason?: string
  backup?: string
}

async function ensureParents(root: string, path: string): Promise<void> {
  const parts = recoveryRelativePath(path).split('/').slice(0, -1)
  let parent = root
  for (const part of parts) {
    parent = join(parent, part)
    try { await mkdir(parent, { mode: 0o700 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const stat = await lstat(parent)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('A recovery parent is not an ordinary directory.')
  }
}

/** Move a raced entry back only if its original name remains absent. */
async function rescue(root: string, backup: string, target: string): Promise<boolean> {
  try {
    const stat = await lstat(join(root, backup))
    if (stat.isSymbolicLink()) await symlink(await readlink(join(root, backup), { encoding: 'buffer' }), target)
    else await link(join(root, backup), target)
    await rm(join(root, backup))
    return true
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error }
}

/**
 * Recheck the post-Turn version, retain the displaced entry, and publish with
 * exclusive creation. A racing new file is never overwritten. The original
 * inode stays in a visible backup, so a writer holding an old descriptor does
 * not lose its data. No parent caller may run this without sandbox confinement.
 */
export async function restoreRecoveryFile(request: RecoveryWorkerRequest): Promise<RecoveryWorkerResult> {
  const { root, directory, operation, operationId, maxFileBytes } = request
  const path = recoveryRelativePath(operation.path), signal = new AbortController().signal
  if (!/^[a-f0-9-]{36}$/u.test(operationId)) throw new Error('Invalid recovery operation identity.')
  let stage: string | undefined, backup: string | undefined, claimed = false
  try {
    if (await recoveryRootIdentity(root) !== request.rootIdentity) return { path, status: 'conflict', reason: 'The original workspace was replaced after preview.' }
    if (operation.status === 'conflict') return { path, status: 'conflict', reason: operation.reason ?? 'This path has no safe restoration contract.' }
    const current = (await recoveryState(root, path, maxFileBytes, signal)).state
    if (sameRecoveryContent(current, operation.before)) return { path, status: 'already-restored' }
    if (operation.status !== 'ready') return { path, status: 'conflict', reason: 'The previously restored path changed after preview.' }
    if (!sameRecoveryVersion(current, operation.after)) return { path, status: 'conflict', reason: 'Changed after the recovery preview; nothing was overwritten.' }
    const target = await recoveryHostPath(root, path)
    await ensureParents(root, path)
    if (operation.before.kind === 'file') {
      const store = new FileRecoveryStore(directory), blob = store.blobPath(operation.before.hash)
      const stat = await lstat(blob)
      if (!stat.isFile() || stat.size !== operation.before.size || stat.size > maxFileBytes) throw new Error('Recovery content is missing or invalid.')
      const bytes = await readFile(blob)
      if (createHash('sha256').update(bytes).digest('hex') !== operation.before.hash) throw new Error('Recovery content failed its checksum.')
      stage = join(dirname(target), '.omdsh-recovery-' + operationId + '.stage')
      const handle = await open(stage, 'wx', 0o600)
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      await chmod(stage, operation.before.mode)
    }
    if (current.kind !== 'missing') {
      // Reserve the destination first; rename may replace only our own empty
      // reservation, never an unrelated recovery artifact.
      const absoluteBackup = join(dirname(target), '.omdsh-recovery-' + operationId + '.backup')
      const reserve = await open(absoluteBackup, 'wx', 0o600); await reserve.close()
      backup = relative(root, absoluteBackup).replaceAll('\\', '/')
      try { await rename(target, absoluteBackup); claimed = true }
      catch (error) { await rm(absoluteBackup, { force: true }); backup = undefined; throw error }
      const observed = (await recoveryHostState(absoluteBackup, maxFileBytes, signal)).state
      if (!sameRecoveryContent(observed, current) || observed.kind === 'missing' || observed.identity !== current.identity) {
        const rescued = await rescue(root, backup, target)
        if (rescued) { claimed = false; backup = undefined }
        return { path, status: 'conflict', reason: 'The file changed while recovery was claiming it.', ...(backup === undefined ? {} : { backup }) }
      }
    }
    if (operation.before.kind === 'file') await link(stage!, target)
    else if (operation.before.kind === 'link') await symlink(Buffer.from(operation.before.target, 'base64'), target)
    else {
      try { await lstat(target); return { path, status: 'conflict', reason: 'A new file appeared during recovery.', ...(backup === undefined ? {} : { backup }) } }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    return { path, status: 'restored', ...(backup === undefined ? {} : { backup }) }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (claimed && backup !== undefined) {
      try { if (await rescue(root, backup, await recoveryHostPath(root, path))) backup = undefined }
      catch { /* Retain the backup when safe rescue is unavailable. */ }
    }
    return { path, status: (error as NodeJS.ErrnoException).code === 'EEXIST' ? 'conflict' : 'failed', reason, ...(backup === undefined ? {} : { backup }) }
  } finally { if (stage !== undefined) await rm(stage, { force: true }) }
}

if (process.argv[2] === '--omdsh-recovery-worker') {
  let input = ''
  for await (const chunk of process.stdin) {
    input += String(chunk)
    if (Buffer.byteLength(input) > 64 * 1024) throw new Error('Recovery worker request exceeds its limit.')
  }
  const result = await restoreRecoveryFile(JSON.parse(input) as RecoveryWorkerRequest)
  process.stdout.write(JSON.stringify(result) + '\n')
}
