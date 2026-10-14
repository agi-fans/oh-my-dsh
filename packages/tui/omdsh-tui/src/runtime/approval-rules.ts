/** Remembered decisions over the Harness approval waterfall, never a sandbox override. */
import { Context, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { currentWorkingDirectory } from '../session/working-directory.ts'

export interface ApprovalAction {
  tool: string
  arguments: string
  cwd: string
  workspace: string
  sandbox: string
  reason: string
}
export interface ApprovalRule extends ApprovalAction {
  version: 1
  id: string
  scope: 'session' | 'workspace'
  sessionId: string
  decision: 'allow' | 'reject'
  createdAt: number
}
export interface Config { stateDir: string }
declare module '@deepseek-ai/cordis' { interface Context { omdshApprovalRules: ApprovalRules } }
declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:omdsh/approval-rule-matched': { id: string; scope: 'session' | 'workspace'; decision: 'allow' | 'reject' }
    'plugin:omdsh/approval-rule-error': { message: string }
    'plugin:omdsh/workspace-changes': { turn: number; summary: import('@deepseek-ai/dsh-workspace-changes').WorkspaceChangesSummary }
  }
}

/** Stable exact JSON comparison; whitespace and object-key order are not permissions. */
export function exactArguments(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item
    if (typeof item === 'number' && Number.isFinite(item)) return item
    if (Array.isArray(item)) return item.map(canonical)
    if (typeof item === 'object' && item !== null) return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]))
    throw new Error('Approval arguments must be lossless JSON.')
  }
  const text = JSON.stringify(canonical(value))
  if (Buffer.byteLength(text) > 64 * 1024) throw new Error('This action is too large to remember; approve it once.')
  return text
}

function sameAction(rule: ApprovalAction, action: ApprovalAction): boolean {
  return rule.tool === action.tool && rule.arguments === action.arguments && rule.cwd === action.cwd
    && rule.workspace === action.workspace && rule.sandbox === action.sandbox && rule.reason === action.reason
}

export class ApprovalRules extends Service {
  static inject = ['tools', 'approval', 'sandboxPolicy']
  private readonly ownerContext: Context
  private readonly directory: string
  private readonly pending = new Map<Agent, Map<string, Omit<ApprovalAction, 'reason'>>>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'omdshApprovalRules')
    if (typeof config?.stateDir !== 'string' || config.stateDir.trim() === '') throw new Error('Approval rules require a private state directory.')
    this.ownerContext = ctx
    this.directory = config.stateDir
    // Both hook asks before dispatch and capability-owned asks inside the body
    // carry the registry's immutable execution, including native and PTC calls.
    ctx.on('tools/pre-execute', (exec, next) => this.observe(exec, next), true)
    ctx.on('tools/execute', (exec, next) => this.observe(exec, next), true)
    ctx.on('approval/request', async (request, next) => {
      if (request.signal?.aborted) return 'cancelled'
      try {
        const action = this.describe(request)
        if (action === undefined) return next()
        const matches = this.list(request.agent).filter(rule => sameAction(rule, action))
        const rule = matches.find(rule => rule.decision === 'reject') ?? matches[0]
        if (rule === undefined) return next()
        appendPluginRecord(request.agent.session, 'plugin:omdsh/approval-rule-matched', { id: rule.id, scope: rule.scope, decision: rule.decision })
        return rule.decision === 'allow' ? 'allowed-once' : 'rejected'
      } catch {
        // Corrupt/unreadable permission state must never grant the request.
        appendPluginRecord(request.agent.session, 'plugin:omdsh/approval-rule-error', { message: 'Approval rule storage is invalid or unavailable. The request was rejected; inspect /permission → Approval rules.' })
        return 'rejected'
      }
    }, true)
    ctx.effect(() => () => { this.pending.clear() })
  }

  private async observe<T>(exec: ToolExecution, next: () => Promise<T>): Promise<T> {
    if (exec.agent === undefined) return next()
    let argumentsText: string
    try { argumentsText = exactArguments(exec.arguments) } catch { return next() }
    const policy = this.ownerContext.get('sandboxPolicy')!.resolve({ session: exec.agent.session })
    const action = { tool: exec.name, arguments: argumentsText, cwd: resolve(currentWorkingDirectory(this.ownerContext, exec.agent.session)),
      workspace: resolve(policy.workspaceRoot), sandbox: policy.mode }
    let calls = this.pending.get(exec.agent)
    if (calls === undefined) { calls = new Map(); this.pending.set(exec.agent, calls) }
    if (calls.has(exec.callId)) throw new Error('Duplicate pending approval call identity.')
    calls.set(exec.callId, action)
    try { return await next() }
    finally { calls.delete(exec.callId); if (calls.size === 0) this.pending.delete(exec.agent) }
  }

  describe(request: ApprovalRequestEvent): ApprovalAction | undefined {
    const action = request.callId === undefined ? undefined : this.pending.get(request.agent)?.get(request.callId)
    if (action === undefined || action.tool !== request.toolName || request.signal?.aborted) return undefined
    const reason = request.reason ?? ''
    if (Buffer.byteLength(reason) > 64 * 1024) return undefined
    return { ...action, reason }
  }

  list(agent: Agent): ApprovalRule[] {
    const workspace = resolve(this.ownerContext.get('sandboxPolicy')!.resolve({ session: agent.session }).workspaceRoot)
    let names: string[]
    try { names = readdirSync(this.directory).filter(name => name.endsWith('.json')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    if (names.length > 500) throw new Error('Too many approval rules; revoke unused decisions.')
    return names.sort().map(name => {
      const path = join(this.directory, name), stat = lstatSync(path)
      if (!stat.isFile() || stat.size > 160 * 1024) throw new Error('Approval rule must be a bounded regular file.')
      const text = readFileSync(path, 'utf8')
      if (Buffer.byteLength(text) > 160 * 1024) throw new Error('Approval rule exceeds the record limit.')
      const rule: unknown = JSON.parse(text)
      if (!validRule(rule) || name !== rule.id + '.json') throw new Error('Invalid approval rule record.')
      if (exactArguments(JSON.parse(rule.arguments)) !== rule.arguments) throw new Error('Approval rule arguments are not canonical JSON.')
      return rule
    }).filter(rule => rule.workspace === workspace && (rule.scope === 'workspace' || rule.sessionId === agent.id))
  }

  remember(request: ApprovalRequestEvent, scope: ApprovalRule['scope'], decision: ApprovalRule['decision']): ApprovalRule {
    request.signal?.throwIfAborted()
    if (!['session', 'workspace'].includes(scope) || !['allow', 'reject'].includes(decision)) throw new Error('Invalid approval rule selection.')
    const action = this.describe(request)
    if (action === undefined) throw new Error('The requested action is no longer pending; no rule was saved.')
    // Read before mutation; do not overwrite corrupted permissions or duplicate
    // an existing decision. Files are independent so other processes can revoke
    // or add unrelated rules without a read-modify-write race on one document.
    const rules = this.list(request.agent)
    const existing = rules.find(rule => rule.scope === scope && rule.decision === decision && sameAction(rule, action))
    if (existing !== undefined) return existing
    const rule: ApprovalRule = { ...action, version: 1, id: randomUUID(), scope, decision, sessionId: request.agent.id, createdAt: Date.now() }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    if (readdirSync(this.directory).filter(name => name.endsWith('.json')).length >= 500) throw new Error('Revoke an unused approval rule before adding another.')
    const target = join(this.directory, rule.id + '.json'), temp = target + '.tmp'
    try { writeFileSync(temp, JSON.stringify(rule) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temp, target) }
    finally { rmSync(temp, { force: true }) }
    return rule
  }

  revoke(agent: Agent, id: string): void {
    const rule = this.list(agent).find(rule => rule.id === id)
    if (rule === undefined) throw new Error('That approval rule does not belong to this session or workspace.')
    rmSync(join(this.directory, rule.id + '.json'), { force: true })
  }
}

function validRule(value: unknown): value is ApprovalRule {
  if (value === null || typeof value !== 'object') return false
  const rule = value as Partial<ApprovalRule>
  return rule.version === 1 && typeof rule.id === 'string' && /^[0-9a-f-]{36}$/u.test(rule.id)
    && ['tool', 'arguments', 'cwd', 'workspace', 'sandbox', 'reason', 'sessionId'].every(key => typeof (rule as Record<string, unknown>)[key] === 'string')
    && ['session', 'workspace'].includes(String(rule.scope)) && ['allow', 'reject'].includes(String(rule.decision))
    && Number.isSafeInteger(rule.createdAt)
}

export default ApprovalRules
