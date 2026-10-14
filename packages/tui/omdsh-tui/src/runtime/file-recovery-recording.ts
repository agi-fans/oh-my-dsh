/** Optional Turn snapshots over the public Agent lifecycle. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LocalFileRecovery } from './file-recovery-local.ts'
import type { RecoverySnapshot } from './file-recovery-store.ts'
import { BTW_PRESET } from './btw-policy.ts'

export interface TurnRecoveryRecord {
  version: 1; sessionId: string; turn: number; status: 'capturing' | 'ready' | 'unavailable'
  before?: string; after?: string; error?: string
}
interface ActiveCapture { agent: Agent; record: TurnRecoveryRecord; before?: RecoverySnapshot; dirty: boolean; finishing?: Promise<void> }

export class TurnRecoveryRecording {
  private readonly active = new Map<Agent, ActiveCapture>()
  private readonly tasks = new Set<Promise<void>>()
  private readonly closing = new AbortController()
  constructor(ctx: Context, private readonly provider: LocalFileRecovery) {
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || !ctx.get('agents')!.roots().includes(payload.agent) || payload.agent.session.header.agentPreset === BTW_PRESET) return decision
      const current = this.active.get(payload.agent)
      if (payload.step === 1 && current?.record.turn !== payload.turn) {
        if (current !== undefined) await this.finish(current)
        if (provider.enabled) await this.begin(payload.agent, payload.turn, payload.signal)
      } else if (current?.record.turn === payload.turn && !current.dirty) {
        current.dirty = true; current.record.status = 'capturing'; delete current.record.after
        await this.save(current.record).catch(() => {})
      }
      return decision
    }, true)
    ctx.on('agent/turn-stopping', async ({ agent }) => { const state = this.active.get(agent); if (state !== undefined) await this.finish(state) })
    ctx.on('agent/status', ({ agent, status }) => { const state = this.active.get(agent); if (status === 'idle' && state !== undefined) void this.finish(state) })
    ctx.on('agent/disposed', ({ agent }) => { this.active.delete(agent) })
    ctx.effect(() => async () => { this.closing.abort(); await Promise.allSettled(this.tasks); this.active.clear() })
  }

  private path(sessionId: string, turn: number): string {
    if (!Number.isSafeInteger(turn) || turn <= 0) throw new Error('Invalid recovery Turn.')
    return join(this.provider.store.directory, 'turns', createHash('sha256').update(JSON.stringify([sessionId, turn])).digest('hex') + '.json')
  }
  private async save(record: TurnRecoveryRecord): Promise<void> {
    const path = this.path(record.sessionId, record.turn), temp = path + '.' + randomUUID() + '.tmp'
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const handle = await open(temp, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(record) + '\n'); await handle.sync(); await handle.close(); await rename(temp, path) }
    finally { try { await handle.close() } finally { await rm(temp, { force: true }) } }
  }
  private async begin(agent: Agent, turn: number, signal: AbortSignal): Promise<void> {
    const state: ActiveCapture = { agent, dirty: true, record: { version: 1, sessionId: agent.id, turn, status: 'capturing' } }
    this.active.set(agent, state)
    try {
      await this.save(state.record)
      state.before = await this.provider.capture(agent, [], AbortSignal.any([signal, this.closing.signal]))
      state.record.before = state.before.id
      await this.save(state.record)
    } catch (error) {
      state.record.status = 'unavailable'; state.record.error = error instanceof Error ? error.message : String(error)
      await this.save(state.record).catch(() => {})
    }
  }
  private finish(state: ActiveCapture): Promise<void> {
    if (state.finishing !== undefined) return state.finishing
    if (!state.dirty || state.before === undefined) return Promise.resolve()
    const task = (async () => {
      try {
        const after = await this.provider.capture(state.agent, state.before!.entries.map(entry => entry.path), this.closing.signal)
        if (after.root !== state.before!.root || after.rootIdentity !== state.before!.rootIdentity) throw new Error('The working directory changed during this Turn; no complete file checkpoint is available.')
        state.record.after = after.id; state.record.status = 'ready'; delete state.record.error
      } catch (error) { state.record.status = 'unavailable'; state.record.error = error instanceof Error ? error.message : String(error) }
      state.dirty = false
      await this.save(state.record).catch(() => { state.record.status = 'unavailable'; state.record.error = 'The file checkpoint could not be saved.' })
    })().finally(() => { delete state.finishing; this.tasks.delete(task) })
    state.finishing = task; this.tasks.add(task)
    return task
  }
  async get(sessionId: string, turn: number): Promise<TurnRecoveryRecord | undefined> {
    const state = [...this.active.values()].find(value => value.record.sessionId === sessionId && value.record.turn === turn)
    if (state !== undefined) { await state.finishing; return { ...state.record } }
    const path = this.path(sessionId, turn)
    const stat = await lstat(path).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error })
    if (stat === undefined) return undefined
    if (!stat.isFile() || stat.size > 32 * 1024) throw new Error('Invalid Turn recovery record.')
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (!validRecord(value) || value.sessionId !== sessionId || value.turn !== turn) throw new Error('Invalid Turn recovery record.')
    return value
  }
}
function validRecord(value: unknown): value is TurnRecoveryRecord {
  if (value === null || typeof value !== 'object') return false
  const record = value as Partial<TurnRecoveryRecord>
  const snapshot = (id: unknown): boolean => id === undefined || typeof id === 'string' && /^snapshot-[a-f0-9-]{36}$/u.test(id)
  return record.version === 1 && typeof record.sessionId === 'string' && Number.isSafeInteger(record.turn)
    && ['capturing', 'ready', 'unavailable'].includes(String(record.status)) && snapshot(record.before) && snapshot(record.after)
    && (record.error === undefined || typeof record.error === 'string') && (record.status !== 'ready' || record.before !== undefined && record.after !== undefined)
}
