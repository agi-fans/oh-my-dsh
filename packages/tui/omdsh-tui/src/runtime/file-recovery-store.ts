/** Durable byte snapshots and conservative recovery plans; no host mutations. */
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readFile, readlink, realpath, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface RecoveryLimits { maxFiles: number; maxFileBytes: number; maxSnapshotBytes: number }
export const RECOVERY_LIMITS: Readonly<RecoveryLimits> = { maxFiles: 10_000, maxFileBytes: 128 * 1024 * 1024, maxSnapshotBytes: 1024 * 1024 * 1024 }
export type RecoveryState = { kind: 'missing' }
  | { kind: 'file'; hash: string; size: number; mode: number; revision: string; identity: string }
  | { kind: 'link'; target: string; revision: string; identity: string }
export interface RecoveryEntry { path: string; state: RecoveryState }
export interface RecoveryInventory { paths: readonly string[]; excluded: readonly string[]; protected?: readonly string[] }
export interface RecoverySnapshot {
  version: 1
  id: string
  root: string
  rootIdentity: string
  platform: NodeJS.Platform
  createdAt: number
  entries: RecoveryEntry[]
  excluded: string[]
  protected: string[]
}
export interface RecoveryOperation {
  path: string
  before: RecoveryState
  after: RecoveryState
  status: 'ready' | 'conflict' | 'already-restored'
  reason?: string
}
export interface RecoveryPlan { root: string; rootIdentity: string; before: string; after: string; operations: RecoveryOperation[] }

const missing: RecoveryState = { kind: 'missing' }
const digest = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
async function canonicalFuturePath(path: string): Promise<string> {
  const parts: string[] = []
  let current = resolve(path)
  for (;;) {
    try { return join(await realpath(current), ...parts.reverse()) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      if (parent === current) throw error
      parts.push(current.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)))
      current = parent
    }
  }
}
export async function recoveryRootIdentity(root: string): Promise<string> {
  const stat = await lstat(root, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The recovery workspace is not an ordinary directory.')
  return digest([stat.dev, stat.ino, stat.birthtimeNs].join(':'))
}
const stateContent = (state: RecoveryState): string => state.kind === 'file' ? `file:${state.hash}:${state.mode}`
  : state.kind === 'link' ? `link:${state.target}` : 'missing'
export const sameRecoveryContent = (left: RecoveryState, right: RecoveryState): boolean => stateContent(left) === stateContent(right)
export const sameRecoveryVersion = (left: RecoveryState, right: RecoveryState): boolean => sameRecoveryContent(left, right)
  // Windows reports creation time in `ctime`, and antivirus/indexing can touch
  // timestamps between capture and restore. Byte content and mode remain the
  // safe identity there; elsewhere the revision catches same-content replacement.
  && (process.platform === 'win32' || left.kind === 'missing' || right.kind === 'missing' || left.revision === right.revision)

export function recoveryRelativePath(path: string): string {
  if (path === '' || isAbsolute(path) || path.includes('\0') || path.includes('\uFFFD')
    || (process.platform !== 'win32' && path.includes('\\'))) throw new Error('Recovery requires an unambiguous workspace-relative path.')
  const parts = path.replaceAll('\\', '/').split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..' || part.toLowerCase() === '.git' || part.startsWith('.omdsh-recovery-')))
    throw new Error('Recovery cannot include metadata, backup paths or parent traversal.')
  return parts.join('/')
}

function exclusionPath(path: string): string {
  return recoveryRelativePath(path.endsWith('/') ? path.slice(0, -1) : path) + (path.endsWith('/') ? '/' : '')
}

/** Refuse directory links so a path cannot silently leave the captured workspace. */
export async function recoveryHostPath(root: string, path: string): Promise<string> {
  const parts = recoveryRelativePath(path).split('/')
  let current = root
  for (const part of parts.slice(0, -1)) {
    current = join(current, part)
    try {
      const stat = await lstat(current)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('A recovery parent is not an ordinary directory.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
      throw error
    }
  }
  return join(root, ...parts)
}

/** Read a stable entry without following its final symbolic link. */
export async function recoveryState(root: string, path: string, maxBytes: number, signal: AbortSignal): Promise<{ state: RecoveryState; bytes?: Buffer }> {
  return recoveryHostState(await recoveryHostPath(root, path), maxBytes, signal)
}

/** Local-provider probe for an already bounded host path, including retained backups. */
export async function recoveryHostState(host: string, maxBytes: number, signal: AbortSignal): Promise<{ state: RecoveryState; bytes?: Buffer }> {
  signal.throwIfAborted()
  const first = await lstat(host, { bigint: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
  if (first === undefined) return { state: missing }
  const revision = (stat: typeof first): string => digest([stat.dev, stat.ino, stat.size, stat.mode, stat.mtimeNs, stat.ctimeNs].join(':'))
  const token = revision(first)
  // Rename changes ctime. This second token still detects writes, replacement,
  // size/mode changes and timestamp changes after an entry has been claimed.
  const identity = digest([first.dev, first.ino, first.size, first.mode, first.mtimeNs].join(':'))
  if (first.isSymbolicLink()) {
    if (process.platform === 'win32') throw new Error('Windows reparse points require dedicated recovery support; this snapshot was not captured.')
    const target = await readlink(host, { encoding: 'buffer' })
    if (revision(await lstat(host, { bigint: true })) !== token) throw new Error('A link changed while its snapshot was being read.')
    return { state: { kind: 'link', target: target.toString('base64'), revision: token, identity } }
  }
  if (!first.isFile() || first.nlink > 1n) throw new Error('Recovery snapshots require regular files or symbolic links; hard links and special files are unsupported.')
  if ((first.mode & 0o7000n) !== 0n) throw new Error('Files with special permission bits require metadata recovery support; this snapshot was not captured.')
  if (first.size > BigInt(maxBytes)) throw new Error('A file exceeds the recovery snapshot limit.')
  const handle = await open(host, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW))
  try {
    if (revision(await handle.stat({ bigint: true })) !== token) throw new Error('A file changed before its snapshot could be opened.')
    const bytes = Buffer.alloc(Number(first.size))
    let at = 0
    while (at < bytes.length) {
      signal.throwIfAborted()
      const read = await handle.read(bytes, at, Math.min(64 * 1024, bytes.length - at), at)
      if (read.bytesRead === 0) throw new Error('A file was shortened during snapshot capture.')
      at += read.bytesRead
    }
    if (revision(await handle.stat({ bigint: true })) !== token || revision(await lstat(host, { bigint: true })) !== token)
      throw new Error('A file changed while its snapshot was being read.')
    return { state: { kind: 'file', hash: digest(bytes), size: bytes.length, mode: Number(first.mode & 0o777n), revision: token, identity }, bytes }
  } finally { await handle.close() }
}

/** Publish a complete private record without replacing any existing identity. */
async function publish(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temp = path + '.' + randomUUID() + '.tmp'
  const handle = await open(temp, 'wx', 0o600)
  try { await handle.writeFile(bytes); await handle.sync(); await handle.close(); await link(temp, path) }
  finally { try { await handle.close() } finally { await rm(temp, { force: true }) } }
}

/** All-or-nothing snapshots; incomplete captures never publish a manifest. */
export class FileRecoveryStore {
  readonly directory: string
  readonly limits: Readonly<RecoveryLimits>
  constructor(directory: string, limits: RecoveryLimits = RECOVERY_LIMITS) {
    this.directory = resolve(directory)
    for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Recovery limits must be positive safe integers.')
    if (limits.maxFiles > 10_000) throw new Error('Recovery manifests support at most 10,000 files.')
    this.limits = { ...limits }
  }

  private async checkLocation(root: string): Promise<void> {
    const inside = relative(root, await canonicalFuturePath(this.directory))
    if (inside === '' || (!isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep))) throw new Error('Recovery storage must be outside the workspace.')
  }

  async capture(workspace: string, inventory: () => Promise<RecoveryInventory>, signal: AbortSignal): Promise<RecoverySnapshot> {
    const root = await realpath(workspace)
    const rootIdentity = await recoveryRootIdentity(root)
    await this.checkLocation(root)
    const initial = await inventory()
    const paths = [...new Set(initial.paths.map(recoveryRelativePath))].sort()
    const excluded = [...new Set(initial.excluded.map(exclusionPath))].sort()
    const protectedPaths = [...new Set((initial.protected ?? []).map(exclusionPath))].sort()
    if (excluded.length > this.limits.maxFiles) throw new Error('The workspace exceeds the recovery exclusion limit.')
    if (protectedPaths.length > this.limits.maxFiles) throw new Error('The workspace exceeds the recovery boundary limit.')
    if (paths.length > this.limits.maxFiles) throw new Error('The workspace exceeds the recovery file limit.')
    const entries: RecoveryEntry[] = []
    let total = 0
    for (const path of paths) {
      const { state, bytes } = await recoveryState(root, path, this.limits.maxFileBytes, signal)
      if (bytes !== undefined) {
        total += bytes.length
        if (total > this.limits.maxSnapshotBytes) throw new Error('The workspace exceeds the recovery byte limit.')
        const blob = this.blobPath((state as Extract<RecoveryState, { kind: 'file' }>).hash)
        try { await publish(blob, bytes) }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          if (digest(await readFile(blob)) !== digest(bytes)) throw new Error('Stored recovery content failed its checksum.')
        }
      }
      entries.push({ path, state })
    }
    // Recheck the inventory and freshness after the scan. Concurrent changes
    // invalidate the whole capture instead of publishing a mixed file set.
    const final = await inventory(), endPaths = [...new Set(final.paths.map(recoveryRelativePath))].sort()
    const endExcluded = [...new Set(final.excluded.map(exclusionPath))].sort()
    const endProtected = [...new Set((final.protected ?? []).map(exclusionPath))].sort()
    if (JSON.stringify(paths) !== JSON.stringify(endPaths) || JSON.stringify(excluded) !== JSON.stringify(endExcluded)
      || JSON.stringify(protectedPaths) !== JSON.stringify(endProtected)) throw new Error('The workspace file set changed during snapshot capture.')
    for (const entry of entries) {
      const now = await recoveryState(root, entry.path, this.limits.maxFileBytes, signal)
      if (!sameRecoveryVersion(entry.state, now.state)) throw new Error('A file changed during snapshot capture.')
    }
    signal.throwIfAborted()
    if (await recoveryRootIdentity(root) !== rootIdentity) throw new Error('The recovery workspace was replaced during snapshot capture.')
    const snapshot: RecoverySnapshot = { version: 1, id: 'snapshot-' + randomUUID(), root, rootIdentity, platform: process.platform, createdAt: Date.now(), entries, excluded, protected: protectedPaths }
    const text = JSON.stringify(snapshot)
    if (Buffer.byteLength(text) > 8 * 1024 * 1024 - 256) throw new Error('The recovery manifest exceeds its storage limit.')
    await publish(this.snapshotPath(snapshot.id), Buffer.from(JSON.stringify({ checksum: digest(text), snapshot }) + '\n'))
    return snapshot
  }

  blobPath(hash: string): string {
    if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error('Invalid recovery content identity.')
    return join(this.directory, 'blobs', hash)
  }

  private snapshotPath(id: string): string {
    if (!/^snapshot-[a-f0-9-]{36}$/u.test(id)) throw new Error('Invalid recovery snapshot identity.')
    return join(this.directory, 'snapshots', id + '.json')
  }

  async read(id: string): Promise<RecoverySnapshot> {
    const path = this.snapshotPath(id), stat = await lstat(path)
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('Recovery manifest must be a bounded regular file.')
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (value === null || typeof value !== 'object') throw new Error('Invalid recovery manifest.')
    const { checksum, snapshot } = value as { checksum: unknown; snapshot: unknown }
    if (typeof checksum !== 'string' || checksum !== digest(JSON.stringify(snapshot)) || !validSnapshot(snapshot) || snapshot.id !== id)
      throw new Error('Recovery manifest failed validation.')
    return snapshot
  }

  async plan(beforeId: string, afterId: string, signal: AbortSignal): Promise<RecoveryPlan> {
    const before = await this.read(beforeId), after = await this.read(afterId)
    await this.checkLocation(before.root)
    if (before.root !== after.root || before.rootIdentity !== after.rootIdentity || before.platform !== process.platform || after.platform !== process.platform) throw new Error('Recovery snapshots belong to another workspace or platform.')
    if (await realpath(before.root) !== before.root) throw new Error('The original recovery workspace no longer resolves to its captured directory.')
    if (await recoveryRootIdentity(before.root) !== before.rootIdentity) throw new Error('The original recovery workspace was replaced.')
    const old = new Map(before.entries.map(entry => [entry.path, entry.state])), last = new Map(after.entries.map(entry => [entry.path, entry.state]))
    const operations: RecoveryOperation[] = []
    for (const path of [...new Set([...old.keys(), ...last.keys()])].sort()) {
      const start = old.get(path) ?? missing, end = last.get(path) ?? missing
      if (sameRecoveryContent(start, end)) continue
      if ([...before.protected, ...after.protected].some(item => item.endsWith('/') ? path.startsWith(item) : path === item)) {
        operations.push({ path, before: start, after: end, status: 'conflict', reason: 'This path belongs to a protected snapshot boundary.' })
        continue
      }
      if (!old.has(path) && before.excluded.some(item => item.endsWith('/') ? path.startsWith(item) : path === item)) {
        operations.push({ path, before: start, after: end, status: 'conflict', reason: 'This path was outside the captured scope at Turn start; its original content is unknown.' })
        continue
      }
      try {
        const now = (await recoveryState(before.root, path, this.limits.maxFileBytes, signal)).state
        const status = sameRecoveryContent(now, start) ? 'already-restored' : sameRecoveryVersion(now, end) ? 'ready' : 'conflict'
        operations.push({ path, before: start, after: end, status, ...(status === 'conflict' ? { reason: 'Changed since the retained post-Turn snapshot.' } : {}) })
      } catch (error) {
        signal.throwIfAborted()
        operations.push({ path, before: start, after: end, status: 'conflict', reason: error instanceof Error ? error.message : String(error) })
      }
    }
    return { root: before.root, rootIdentity: before.rootIdentity, before: before.id, after: after.id, operations }
  }
}

function validSnapshot(value: unknown): value is RecoverySnapshot {
  if (value === null || typeof value !== 'object') return false
  const record = value as Partial<RecoverySnapshot>
  if (record.version !== 1 || typeof record.id !== 'string' || typeof record.root !== 'string' || !isAbsolute(record.root)
    || typeof record.rootIdentity !== 'string' || !/^[a-f0-9]{64}$/u.test(record.rootIdentity)
    || typeof record.platform !== 'string' || !Number.isSafeInteger(record.createdAt) || !Array.isArray(record.entries) || record.entries.length > 10_000
    || !Array.isArray(record.excluded) || record.excluded.length > 10_000 || !Array.isArray(record.protected) || record.protected.length > 10_000) return false
  for (const path of [...record.excluded, ...record.protected]) { try { if (typeof path !== 'string' || exclusionPath(path) !== path) return false } catch { return false } }
  const seen = new Set<string>()
  for (const entry of record.entries) {
    if (entry === null || typeof entry !== 'object' || typeof entry.path !== 'string' || entry.state === null || typeof entry.state !== 'object') return false
    try { if (recoveryRelativePath(entry.path) !== entry.path || seen.has(entry.path)) return false } catch { return false }
    seen.add(entry.path)
    const state = entry.state
    if (state.kind === 'missing') continue
    if (typeof state.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(state.revision)) return false
    if (typeof state.identity !== 'string' || !/^[a-f0-9]{64}$/u.test(state.identity)) return false
    if (state.kind === 'link') { if (typeof state.target !== 'string' || Buffer.from(state.target, 'base64').toString('base64') !== state.target) return false; continue }
    if (state.kind !== 'file' || !/^[a-f0-9]{64}$/u.test(state.hash) || !Number.isSafeInteger(state.size) || state.size < 0
      || !Number.isSafeInteger(state.mode) || state.mode < 0 || state.mode > 0o777) return false
  }
  return true
}
