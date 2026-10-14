/** Local host recovery provider over public filesystem, process and sandbox seams. */
import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import type { ConfinedArgv } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { SubprocessExecutableNotFoundError, type SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { FileRecoveryStore, recoveryRelativePath, type RecoveryInventory, type RecoverySnapshot } from './file-recovery-store.ts'
import type { RecoveryWorkerRequest, RecoveryWorkerResult } from './file-recovery-worker.ts'
import { currentWorkingDirectory } from '../session/working-directory.ts'
import { TurnRecoveryRecording, type TurnRecoveryRecord } from './file-recovery-recording.ts'

export interface Config { stateDir?: string; enabled: Volatile<boolean> }
export interface RecoveryReceiptEntry {
  path: string
  operationId: string
  backup: string
  status: RecoveryWorkerResult['status'] | 'planned' | 'uncertain' | 'cancelled'
  reason?: string
}
export interface RecoveryReceipt {
  version: 1
  id: string
  sessionId: string
  root: string
  before: string
  after: string
  startedAt: number
  completedAt?: number
  entries: RecoveryReceiptEntry[]
}
declare module '@deepseek-ai/cordis' { interface Context { omdshFileRecovery: LocalFileRecovery } }
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'omdsh-file-recovery': { kind: 'omdsh-file-recovery' } & ContextFormed }
}

const isReserved = (path: string): boolean => path.split('/').some(part => part.toLowerCase() === '.git' || part.startsWith('.omdsh-recovery-'))

export class LocalFileRecovery extends Service {
  static inject = ['agents', 'fs', 'subprocess', 'sandbox', 'sandboxPolicy']
  static Config = z.object({ stateDir: z.string().hidden(), enabled: z.boolean().default(false).description('Keep private file snapshots for new Turns; uses disk space and adds capture work.').volatile() })
  readonly store: FileRecoveryStore
  get enabled(): boolean { return this.recoveryConfig.enabled.get() }
  private readonly recoveryConfig: Config
  private readonly recording: TurnRecoveryRecording
  private readonly ownerContext: Context
  private readonly closing = new AbortController()
  private readonly tasks = new Set<Promise<unknown>>()
  private readonly ownerLifetimes = new WeakMap<Agent, AbortController>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'omdshFileRecovery')
    if (config.stateDir !== undefined && (typeof config.stateDir !== 'string' || config.stateDir.trim() === '')) throw new Error('File recovery requires a private state directory.')
    this.ownerContext = ctx
    this.store = new FileRecoveryStore(config.stateDir ?? join(process.env.OMDSH_HOME || process.env.DSH_HOME || join(homedir(), '.dsh'), 'omdsh/file-recovery'))
    this.recoveryConfig = config
    ctx.on('agent/disposed', ({ agent }) => { this.ownerLifetimes.get(agent)?.abort(new Error('The file recovery owner was closed.')) })
    ctx.effect(() => async () => { this.closing.abort(new Error('File recovery unloaded.')); await Promise.allSettled(this.tasks) })
    this.recording = new TurnRecoveryRecording(ctx, this)
  }

  checkpoint(sessionId: string, turn: number): Promise<TurnRecoveryRecord | undefined> { return this.recording.get(sessionId, turn) }

  private track<T>(signal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const fused = AbortSignal.any([signal, this.closing.signal])
    const task = Promise.resolve().then(() => { fused.throwIfAborted(); return operation(fused) }).finally(() => { this.tasks.delete(task) })
    this.tasks.add(task)
    return task
  }

  private ownerSignal(agent: Agent, upstream: AbortSignal): AbortSignal {
    let lifetime = this.ownerLifetimes.get(agent)
    if (lifetime === undefined) { lifetime = new AbortController(); this.ownerLifetimes.set(agent, lifetime) }
    return AbortSignal.any([upstream, lifetime.signal])
  }

  private async rootOf(agent: Agent, signal: AbortSignal, capturedRoot?: string): Promise<string> {
    const ctx = this.ownerContext
    if (ctx.get('agents')!.get(agent.id) !== agent) throw new Error('File recovery requires the exact live session owner.')
    const cwd = capturedRoot ?? currentWorkingDirectory(ctx, agent.session)
    const target = await ctx.get('fs')!.resolve(cwd, { signal })
    const path = ctx.get('fs')!.processPath(target), host = ctx.get('fs')!.processPathFromHostPath(cwd)
    const platform = (await ctx.get('subprocess')!.terminalEnvironment(signal)).platform
    if (host === undefined || platform !== (process.platform === 'win32' ? 'windows' : 'posix')) throw new Error('This file recovery provider requires a local execution world.')
    const root = await realpath(cwd)
    if (await realpath(path) !== root || await realpath(host) !== root) throw new Error('The filesystem and recovery workspace do not share one local execution world.')
    return root
  }

  private async git(root: string, args: string[], signal: AbortSignal): Promise<{ code: number | null; text: string }> {
    const provider = this.ownerContext.get('subprocess')!, executable = await provider.resolveExecutable('git', undefined, signal)
    const handle = provider.spawn({ argv: [executable, '-C', root, ...args], cwd: root, graceMs: 500, signal,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 2 * 1024 * 1024 }, stderr: { maxBytes: 16 * 1024 } } })
    const outcome = await handle.done
    const output = handle.collected.stdout!.readFrom(0)
    if (output.lossy) throw new Error('The Git recovery inventory exceeds its output limit.')
    signal.throwIfAborted()
    return { code: outcome.exitCode, text: output.text }
  }

  private async inventory(root: string, signal: AbortSignal): Promise<RecoveryInventory> {
    let git = false
    try { git = (await this.git(root, ['rev-parse', '--is-inside-work-tree'], signal)).code === 0 }
    catch (error) { if (!(error instanceof SubprocessExecutableNotFoundError)) throw error }
    if (git) {
      const index = await this.git(root, ['ls-files', '--stage', '-z'], signal)
      const others = await this.git(root, ['ls-files', '--others', '--exclude-standard', '-z'], signal)
      const ignored = await this.git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], signal)
      if (index.code !== 0 || others.code !== 0 || ignored.code !== 0) throw new Error('Git could not provide a complete recovery inventory.')
      const paths: string[] = [], protectedPaths: string[] = [], excluded: string[] = ignored.text.split('\0').filter(Boolean).filter(path => !isReserved(path))
      for (const record of index.text.split('\0').filter(Boolean)) {
        const at = record.indexOf('\t')
        if (at < 0) throw new Error('Invalid Git recovery inventory.')
        const path = record.slice(at + 1)
        if (isReserved(path)) continue
        if (record.startsWith('160000 ')) { excluded.push(path + '/'); protectedPaths.push(path + '/') }
        else paths.push(path)
      }
      for (const path of others.text.split('\0').filter(Boolean).filter(path => !isReserved(path))) {
        if (path.endsWith('/')) { excluded.push(path); protectedPaths.push(path) }
        else paths.push(path)
      }
      return { paths, excluded, protected: protectedPaths }
    }
    const paths: string[] = []
    const walk = async (directory: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        signal.throwIfAborted()
        const path = prefix + entry.name
        if (isReserved(path)) continue
        recoveryRelativePath(path)
        if (entry.isDirectory()) await walk(join(directory, entry.name), path + '/')
        else paths.push(path)
        if (paths.length > this.store.limits.maxFiles) throw new Error('The workspace exceeds the recovery file limit.')
      }
    }
    await walk(root, '')
    return { paths, excluded: [] }
  }

  capture(agent: Agent, retainedPaths: readonly string[], upstream: AbortSignal): Promise<RecoverySnapshot> {
    return this.track(this.ownerSignal(agent, upstream), async signal => {
      const root = await this.rootOf(agent, signal)
      return this.store.capture(root, async () => {
        const current = await this.inventory(root, signal)
        return { ...current, paths: [...current.paths, ...retainedPaths.filter(path => !(current.protected ?? []).some(prefix => path.startsWith(prefix)))] }
      }, signal)
    })
  }

  restore(agent: Agent, before: string, after: string, paths: readonly string[], upstream: AbortSignal): Promise<RecoveryReceipt> {
    return this.track(this.ownerSignal(agent, upstream), signal => agent.runMaintenance(async maintenance => {
      const fused = AbortSignal.any([signal, maintenance]), plan = await this.store.plan(before, after, fused)
      const root = await this.rootOf(agent, fused, plan.root)
      const liveProtected = (await this.inventory(root, fused)).protected ?? []
      if (plan.root !== root) throw new Error('The checkpoint belongs to another workspace.')
      const unique = new Set(paths.map(recoveryRelativePath))
      if (unique.size === 0 || [...unique].some(path => !plan.operations.some(operation => operation.path === path))) throw new Error('Select captured file changes to restore.')
      const receipt: RecoveryReceipt = { version: 1, id: 'restore-' + randomUUID(), sessionId: agent.id, root, before, after, startedAt: Date.now(),
        entries: plan.operations.filter(operation => unique.has(operation.path)).map(operation => {
          const operationId = randomUUID(), parent = operation.path.includes('/') ? operation.path.slice(0, operation.path.lastIndexOf('/') + 1) : ''
          return { path: operation.path, operationId, backup: parent + '.omdsh-recovery-' + operationId + '.backup', status: 'planned' }
        }) }
      // Each intent is durable before the worker can mutate a file. A process
      // crash leaves a planned entry whose completion is explicitly unconfirmed.
      await this.saveReceipt(receipt)
      for (const entry of receipt.entries) {
        if (fused.aborted) { entry.status = 'cancelled'; entry.backup = ''; continue }
        const operation = plan.operations.find(operation => operation.path === entry.path)!
        if (liveProtected.some(prefix => entry.path.startsWith(prefix))) {
          entry.status = 'conflict'; entry.backup = ''; entry.reason = 'This path is now inside a protected Git submodule.'; await this.saveReceipt(receipt); continue
        }
        if (operation.status !== 'ready') { entry.status = operation.status; entry.backup = ''; if (operation.reason !== undefined) entry.reason = operation.reason; await this.saveReceipt(receipt); continue }
        const policy = this.ownerContext.get('sandboxPolicy')!.resolve({ session: agent.session })
        if (policy.mode === 'read-only') { entry.status = 'failed'; entry.backup = ''; entry.reason = 'Access is Read only. Change Access before restoring files.'; await this.saveReceipt(receipt); continue }
        if (policy.mode !== 'danger-full-access') {
          const fs = this.ownerContext.get('fs')!, boundary = await fs.resolve(policy.workspaceRoot, { signal: fused }), target = await fs.resolve(root, { signal: fused })
          if (!fs.contains(boundary, target)) {
            entry.status = 'failed'; entry.backup = ''; entry.reason = 'The captured directory is outside the current Access boundary.'; await this.saveReceipt(receipt); continue
          }
        }
        const argv = [process.execPath, fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './file-recovery-worker.ts' : './file-recovery-worker.js', import.meta.url)), '--omdsh-recovery-worker']
        let confined: ConfinedArgv
        try { confined = await this.ownerContext.get('sandbox')!.confine(argv, { mode: 'workspace-write', workspaceRoot: root, sessionId: agent.id }, fused) }
        catch (error) {
          entry.status = fused.aborted ? 'cancelled' : 'failed'; entry.backup = ''
          entry.reason = error instanceof Error ? error.message : String(error)
          await this.saveReceipt(receipt); continue
        }
        const request: RecoveryWorkerRequest = { root, rootIdentity: plan.rootIdentity, directory: this.store.directory, operation,
          operationId: entry.operationId, maxFileBytes: this.store.limits.maxFileBytes }
        let handle: SubprocessHandle
        try {
          handle = this.ownerContext.get('subprocess')!.spawn({ argv: confined.argv, cwd: root, graceMs: 500, signal: fused,
            stdio: { stdin: 'pipe', stdout: { maxBytes: 64 * 1024 }, stderr: { maxBytes: 16 * 1024 } } })
        } catch (error) {
          entry.status = fused.aborted ? 'cancelled' : 'failed'; entry.backup = ''; entry.reason = error instanceof Error ? error.message : String(error)
          await this.saveReceipt(receipt); continue
        }
        handle.stdin!.on('error', () => {})
        handle.stdin!.end(JSON.stringify(request))
        try {
          const outcome = await handle.done
          const output = handle.collected.stdout!.readFrom(0)
          if (outcome.exitCode !== 0 || output.lossy) throw new Error('Recovery worker did not confirm completion. Inspect the receipt and retained backup.')
          const result: unknown = JSON.parse(output.text)
          if (!validWorkerResult(result, entry.path)) throw new Error('Invalid recovery worker result; completion is unconfirmed.')
          entry.status = result.status
          if (result.reason !== undefined) entry.reason = result.reason
          if (result.backup === undefined) entry.backup = ''
          else if (result.backup !== entry.backup) throw new Error('Recovery worker returned an unexpected backup path.')
        } catch (error) {
          entry.status = 'uncertain'; entry.reason = error instanceof Error ? error.message : String(error)
        } finally { await handle.waitForExit(); await this.saveReceipt(receipt) }
      }
      receipt.completedAt = Date.now()
      await this.saveReceipt(receipt)
      if (receipt.entries.some(entry => entry.status === 'restored' || entry.status === 'uncertain')) {
        try {
          agent.inject(createUserMessage({ source: { kind: 'omdsh-file-recovery', form: 'notice', summary: 'File recovery changed or may have changed workspace files.' },
            content: [{ type: 'text', text: `The user attempted file recovery in ${JSON.stringify(root)}. Results: ${JSON.stringify(receipt.entries.map(entry => ({ path: entry.path, status: entry.status })))}. Re-read affected files before relying on earlier observations. Uncertain results do not establish completion.` }] }))
        } catch { this.ownerContext.logger.warn('File recovery completed, but its model notice could not be queued. The saved receipt retains the actual results.') }
      }
      return receipt
    }))
  }

  private async saveReceipt(receipt: RecoveryReceipt): Promise<void> {
    const path = join(this.store.directory, 'receipts', receipt.id + '.json'), temp = path + '.' + randomUUID() + '.tmp'
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const handle = await open(temp, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(receipt) + '\n'); await handle.sync(); await handle.close(); await rename(temp, path) }
    finally { try { await handle.close() } finally { await rm(temp, { force: true }) } }
  }

  async readReceipt(id: string): Promise<RecoveryReceipt> {
    if (!/^restore-[a-f0-9-]{36}$/u.test(id)) throw new Error('Invalid recovery receipt identity.')
    const path = join(this.store.directory, 'receipts', id + '.json'), stat = await lstat(path)
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('Recovery receipt must be a bounded regular file.')
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (!validReceipt(value) || value.id !== id) throw new Error('Invalid recovery receipt.')
    return value
  }

  async savedReports(before: string, after: string, signal: AbortSignal): Promise<RecoveryReceipt[]> {
    signal.throwIfAborted()
    const names = await readdir(join(this.store.directory, 'receipts')).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    })
    if (names.length > 10_000) throw new Error('The recovery report directory exceeds its inspection limit.')
    const reports: RecoveryReceipt[] = []
    for (const name of names.filter(name => /^restore-[a-f0-9-]{36}\.json$/u.test(name))) {
      signal.throwIfAborted()
      const report = await this.readReceipt(name.slice(0, -5))
      if (report.before === before && report.after === after) reports.push(report)
    }
    return reports.sort((a, b) => b.startedAt - a.startedAt)
  }
}

function validWorkerResult(value: unknown, path: string): value is RecoveryWorkerResult {
  if (value === null || typeof value !== 'object') return false
  const result = value as Partial<RecoveryWorkerResult>
  return result.path === path && ['restored', 'conflict', 'already-restored', 'failed'].includes(String(result.status))
    && (result.reason === undefined || typeof result.reason === 'string') && (result.backup === undefined || typeof result.backup === 'string')
}

function validReceipt(value: unknown): value is RecoveryReceipt {
  if (value === null || typeof value !== 'object') return false
  const receipt = value as Partial<RecoveryReceipt>
  const validEntry = (entry: RecoveryReceiptEntry): boolean => {
    try {
      if (typeof entry?.path !== 'string' || recoveryRelativePath(entry.path) !== entry.path || typeof entry.operationId !== 'string'
        || !/^[a-f0-9-]{36}$/u.test(entry.operationId) || typeof entry.backup !== 'string') return false
      const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/') + 1) : ''
      return (entry.backup === '' || entry.backup === parent + '.omdsh-recovery-' + entry.operationId + '.backup')
        && ['planned', 'restored', 'conflict', 'already-restored', 'failed', 'uncertain', 'cancelled'].includes(entry.status)
        && (entry.reason === undefined || typeof entry.reason === 'string')
    } catch { return false }
  }
  return receipt.version === 1 && typeof receipt.id === 'string' && typeof receipt.sessionId === 'string' && typeof receipt.root === 'string' && isAbsolute(receipt.root)
    && typeof receipt.before === 'string' && typeof receipt.after === 'string' && Number.isSafeInteger(receipt.startedAt)
    && (receipt.completedAt === undefined || Number.isSafeInteger(receipt.completedAt)) && Array.isArray(receipt.entries) && receipt.entries.length <= 10_000
    && receipt.entries.every(validEntry)
}

export default LocalFileRecovery
