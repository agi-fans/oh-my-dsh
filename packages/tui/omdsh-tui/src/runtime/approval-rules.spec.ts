import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService, { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import { Session, SessionId, SESSION_FORMAT_VERSION, pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import ApprovalRules, { exactArguments } from './approval-rules.ts'
import { bindHumanInteraction } from '../session/interaction-adapter.ts'
import type { TuiService } from '../definition.ts'

async function harness(directory?: string) {
  const root = directory ?? mkdtempSync(join(tmpdir(), 'omdsh-approval-rules-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: root })
  await ctx.plugin(ApprovalService, { policy: 'ask' })
  await ctx.plugin(ApprovalRules, { stateDir: join(root, 'rules') })
  const makeAgent = (id = 'primary', cwd = root): Agent => {
    const session = Session.create(SessionId(id), [], { id: SessionId(id), version: SESSION_FORMAT_VERSION, createdAt: 1, cwd, isSeeded: false })
    session.append('turn/start', { turn: 1 })
    return { id: session.id, session } as Agent
  }
  const agent = makeAgent(), question = vi.fn(async request => {
    ctx.omdshApprovalRules.remember(request, 'session', 'allow')
    return 'allowed-once' as const
  })
  const offQuestion = ctx.on('approval/request', question)
  const body = vi.fn(async (_args, exec) => {
    const outcome = await ctx.approval.request({ agent: exec.agent, toolName: 'probe', callId: exec.callId, reason: 'Wider file access', signal: exec.signal })
    if (outcome !== 'allowed-once') throw new Error(`Approval ${outcome}`)
    return { ok: true }
  })
  ctx.tools.register({ name: 'probe', description: 'Probe', parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object' }, render: () => [] }, execute: body })
  let count = 0
  const run = (target = agent, args = { command: 'echo hello' }, signal = new AbortController().signal) =>
    ctx.tools.execute({ name: 'probe', callId: ToolCallId('call-' + count++), arguments: args, agent: target, signal })
  onTestFinished(async () => { await ctx.fiber.dispose(); if (directory === undefined) rmSync(root, { recursive: true, force: true }) })
  return { ctx, root, agent, makeAgent, run, question, body, offQuestion }
}

describe('Harness approval rules', () => {
  it('requires a visible exact preview and scope confirmation before remembering an approval', async () => {
    const h = await harness(); h.offQuestion()
    const prompt = vi.fn<TuiService['prompt']>().mockResolvedValueOnce('remember-allow').mockImplementationOnce(async request => {
      expect(request.initialValue).toBe('cancel')
      // The exact invocation and scope are the decision's detail, drawn on the card.
      expect(request.detail).toContain('echo hello')
      expect(request.detail).toContain(h.root)
      expect(request.detail).toContain('workspace-write')
      expect(request.detail).toContain('Wider file access')
      return 'session'
    })
    const dispose = bindHumanInteraction(h.ctx, { prompt, toolCallContext: () => 'Probe call' } as unknown as TuiService, () => h.agent)
    try {
      expect((await h.run()).isError).toBe(false)
      expect((await h.run()).isError).toBe(false)
      expect(prompt).toHaveBeenCalledTimes(2)
      expect(h.ctx.omdshApprovalRules.list(h.agent)[0]).toMatchObject({ scope: 'session', decision: 'allow' })
    } finally { await dispose() }
  })

  it('saves nothing when scope selection is cancelled and retains remembered rejection', async () => {
    const h = await harness(); h.offQuestion()
    const prompt = vi.fn<TuiService['prompt']>().mockResolvedValueOnce('remember-allow').mockResolvedValueOnce('cancel')
      .mockResolvedValueOnce('remember-reject').mockResolvedValueOnce('workspace')
    const dispose = bindHumanInteraction(h.ctx, { prompt, toolCallContext: () => undefined } as unknown as TuiService, () => h.agent)
    try {
      expect((await h.run()).isError).toBe(true)
      expect(h.ctx.omdshApprovalRules.list(h.agent)).toEqual([])
      expect((await h.run()).isError).toBe(true)
      expect((await h.run()).isError).toBe(true)
      expect(prompt).toHaveBeenCalledTimes(4)
      expect(h.ctx.omdshApprovalRules.list(h.agent)[0]?.decision).toBe('reject')
    } finally { await dispose() }
  })
  it('matches exact actions, records normal audit decisions and preserves session isolation', async () => {
    const h = await harness()
    expect((await h.run()).isError).toBe(false)
    expect((await h.run()).isError).toBe(false)
    expect(h.question).toHaveBeenCalledOnce()
    expect(h.agent.session.snapshotEvents().filter(e => e.type === 'approval/decided')).toHaveLength(2)
    const matches = h.agent.session.snapshotEvents().filter(e => pluginRecordOf(e)?.type === 'plugin:omdsh/approval-rule-matched')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.ignorable).toBe(true)
    await h.run(h.makeAgent('fork'))
    expect(h.question).toHaveBeenCalledTimes(2)
    await h.run(h.agent, { command: 'echo hello && touch different' })
    expect(h.question).toHaveBeenCalledTimes(3)
  })

  it('restores workspace decisions across service lifetimes and observes external revocation', async () => {
    const h = await harness()
    h.question.mockImplementationOnce(async request => { h.ctx.omdshApprovalRules.remember(request, 'workspace', 'allow'); return 'allowed-once' })
    await h.run()
    const restored = await harness(h.root)
    await restored.run(restored.makeAgent('another-session'))
    expect(restored.question).not.toHaveBeenCalled()
    const rules = restored.ctx.omdshApprovalRules.list(restored.agent)
    expect(rules).toHaveLength(1)
    restored.ctx.omdshApprovalRules.revoke(restored.agent, rules[0]!.id)
    await h.run()
    expect(h.question).toHaveBeenCalledTimes(2)
  })

  it('does not reuse a grant in a different workspace or sandbox mode', async () => {
    const h = await harness()
    h.question.mockImplementation(async request => { h.ctx.omdshApprovalRules.remember(request, 'workspace', 'allow'); return 'allowed-once' })
    await h.run()
    await h.run(h.makeAgent('outside', join(h.root, 'other')))
    expect(h.question).toHaveBeenCalledTimes(2)
    h.agent.session.append('sandbox/mode', { mode: 'read-only' })
    await h.run()
    expect(h.question).toHaveBeenCalledTimes(3)
  })

  it('keeps never and monotonic guards authoritative over remembered grants', async () => {
    const h = await harness()
    await h.run()
    setApprovalPolicy(h.agent.session, 'never')
    expect((await h.run()).isError).toBe(true)
    expect(h.question).toHaveBeenCalledOnce()
    setApprovalPolicy(h.agent.session, 'ask')
    h.ctx.tools.guard(() => 'Independent protection')
    expect(JSON.stringify(await h.run())).toContain('Independent protection')
    expect(h.body).toHaveBeenCalledTimes(2)
  })

  it('fails closed on corrupted permission records without overwriting them', async () => {
    const h = await harness()
    await h.run()
    const file = join(h.root, 'rules', readdirSync(join(h.root, 'rules'))[0]!)
    writeFileSync(file, '{broken')
    expect((await h.run()).isError).toBe(true)
    expect(h.question).toHaveBeenCalledOnce()
    expect(readFileSync(file, 'utf8')).toBe('{broken')
    expect(h.agent.session.snapshotEvents().find(e => pluginRecordOf(e)?.type === 'plugin:omdsh/approval-rule-error')).toMatchObject({
      data: { message: expect.stringContaining('storage is invalid or unavailable') } })
  })

  it('refuses stale or cancelled requests instead of inventing an execution match', async () => {
    const h = await harness()
    await h.run()
    const request = h.question.mock.calls[0]![0]
    expect(() => h.ctx.omdshApprovalRules.remember(request, 'workspace', 'allow')).toThrow('no longer pending')
    const abort = new AbortController(); abort.abort()
    expect((await h.run(h.agent, undefined, abort.signal)).isError).toBe(true)
    expect(h.question).toHaveBeenCalledOnce()
  })

  it('compares JSON structurally without interpreting shell strings as prefixes', () => {
    expect(exactArguments({ b: 1, a: { z: 2, x: ['中文', true] } })).toBe(exactArguments({ a: { x: ['中文', true], z: 2 }, b: 1 }))
    expect(exactArguments({ command: 'git status' })).not.toBe(exactArguments({ command: 'git status; rm file' }))
    expect(() => exactArguments({ missing: undefined })).toThrow('lossless JSON')
  })
})
