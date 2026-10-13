import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentActivationSpec, SubagentProvider, SubagentResult, SubagentRun, ResolvedSubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { NO_START_CAPABILITIES } from '@deepseek-ai/dsh-subagent'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { validateJsonSchemaValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as advisor from './advisor.ts'
import { bootTuiTurn } from './test-support/tui-boot.ts'
import { requestToolNames } from './test-support/tui-boot.ts'

const completed: SubagentResult = { stopReason: 'completed', output: [{ type: 'text', text: 'Check the cancellation race.' }] }

async function harness() {
  const ctx = new Context(), providers = new Map<string, SubagentProvider>()
  const specs: SubagentActivationSpec[] = [], nativeCalls: ResolvedSubagentStartRequest[] = []
  const configs: Record<string, unknown>[] = []
  let outcome: Promise<SubagentResult> = Promise.resolve(completed), enabled = true, enforcement = 'full', cwd = process.cwd()
  const release = vi.fn(async () => {})
  const spawn = vi.fn((_spec: SubprocessSpawnSpec) => ({}))
  const native = { Config: z.object({ providerName: z.string(), model: z.string(), env: z.dict(z.string()), permissionMode: z.string(), disposeGraceMs: z.number().default(3000) }),
    apply(child: Context, config: Record<string, unknown>) {
      configs.push(config)
      child.subagents.registerProvider({ name: String(config.providerName), capabilities: NO_START_CAPABILITIES, inheritsParentContext: false,
        start: async request => {
          nativeCalls.push(request)
          child.subprocess.spawn({ argv: ['native-payload', '--stdio'], cwd: request.cwd, env: { SAMPLE: 'configured' }, stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }, graceMs: 3000 })
          return { id: `child-${nativeCalls.length}`, result: outcome, dispose: release } as unknown as SubagentRun
        } })
    } }
  const entries = ['codex', 'claude-code'].map(provider => ({ options: { name: `@deepseek-ai/dsh-subagent-${provider}` }, disabled: false, moduleNamespace: native,
    fiber: { state: 2, runtime: native, config: { model: 'selected-model', env: { CODEX_HOME: resolve('.missing-advice-auth') }, permissionMode: 'bypassPermissions', disposeGraceMs: 3000 } } }))
  ctx.provide('loader', { entries: () => entries.values(), unwrapExports: (value: unknown) => value } as never)
  class FakeSubprocess extends LocalSubprocess { override spawn(spec: SubprocessSpawnSpec) { return spawn(spec) as never } }
  await ctx.plugin(FakeSubprocess).await()
  const confine = vi.fn(async (argv: string[], _policy, signal: AbortSignal) => { signal.throwIfAborted(); return { argv: ['sandbox-runner', ...argv], enforcement } })
  ctx.provide('sandbox', { confine } as never)
  ctx.provide('subagents', {
    registerProvider(value: SubagentProvider) { providers.set(value.name, value); return ctx.effect(() => () => { providers.delete(value.name) }) },
    async startActivation(spec: SubagentActivationSpec) {
      specs.push(spec)
      const run = await providers.get(spec.provider)!.start!({ ...spec.request, label: spec.label, signal: spec.signal, cwd })
      let cleanup: Promise<void> | undefined
      const dispose = () => cleanup ??= run.dispose()
      return { childId: run.id, dispose, result: run.result.then(async result => { await dispose(); return result }) }
    },
  } as never)
  let tool: ToolDefinition | undefined
  ctx.provide('tools', { register: (value: ToolDefinition) => { tool = value; return () => { tool = undefined } } } as never)
  const fiber = ctx.plugin({ ...advisor, Config: undefined }, { allowModelConsultations: { get: () => enabled } } as advisor.Config)
  await fiber.await()
  const agent = { session: { id: 'parent', header: { cwd: process.cwd() } } } as unknown as Agent
  return { ctx, fiber, agent, entries, providers, specs, configs, nativeCalls, spawn, confine, release,
    setOutcome: (value: Promise<SubagentResult>) => { outcome = value }, setEnabled: (value: boolean) => { enabled = value }, setEnforcement: (value: string) => { enforcement = value }, setCwd: (value: string) => { cwd = value },
    consult: (provider: 'codex' | 'claude' = 'codex', signal = new AbortController().signal) => ctx.advisor.consult(agent, provider, 'Review cancellation', 'CODE', signal),
    tool: () => tool!,
  }
}

describe('advisor consultations', () => {
  it('bounds supplied evidence without truncation or inherited history', () => {
    expect(advisor.advicePrompt('question', 'CODE')).toContain('Context:\nCODE')
    expect(() => advisor.advicePrompt('  ')).toThrow('question')
    expect(() => advisor.advicePrompt('x'.repeat(8001))).toThrow('question')
    expect(() => advisor.advicePrompt('question', 'x'.repeat(48001))).toThrow('smaller excerpt')
  })

  it('uses caller delivery, separate native permissions, the configured model, and a confined private directory', async () => {
    const h = await harness()
    try {
      expect(h.spawn).not.toHaveBeenCalled()
      expect(await h.consult()).toEqual({ provider: 'codex', question: 'Review cancellation', opinion: 'Check the cancellation race.', truncated: false })
      expect(h.specs[0]).toMatchObject({ provider: 'advisor-codex', label: 'Advisor · codex · Review cancellation', delivery: 'caller', request: { parent: h.agent } })
      expect(h.specs[0]!.request.prompt).toHaveLength(1)
      expect(h.configs[0]).toMatchObject({ model: 'selected-model', permissionMode: 'never' })
      expect(h.entries[0]!.fiber.config.permissionMode).toBe('bypassPermissions')
      const spec = h.spawn.mock.calls[0]![0]
      expect(spec.cwd).not.toBe(process.cwd())
      expect(spec.argv).toContain('sandbox_mode="read-only"')
      expect(spec.argv[0]).toBe('sandbox-runner')
      expect(spec.env).toMatchObject({ CODEX_HOME: join(spec.cwd, '.codex'), HOME: spec.cwd })
      expect(h.confine.mock.calls[0]![1]).toMatchObject({ mode: 'workspace-write', workspaceRoot: spec.cwd })
      await expect(access(spec.cwd)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(h.release).toHaveBeenCalledTimes(1)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('isolates concurrent bindings and restricts Claude tools without disabling native OAuth', async () => {
    const h = await harness()
    try {
      await Promise.all([h.consult(), h.consult('claude')])
      expect(h.spawn.mock.calls[0]![0].cwd).not.toBe(h.spawn.mock.calls[1]![0].cwd)
      const claude = h.spawn.mock.calls.map(([spec]) => spec).find(spec => spec.argv.includes('--safe-mode'))!
      expect(claude.argv).toEqual(expect.arrayContaining(['--tools', '', '--strict-mcp-config', '{"mcpServers":{}}', '--disable-slash-commands']))
      expect(claude.argv).not.toContain('--bare')
      expect(h.configs.some(config => config.permissionMode === 'plan')).toBe(true)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('fails closed on missing native bundles and partial confinement, without spawning or falling back', async () => {
    const h = await harness()
    try {
      h.entries[0]!.disabled = true
      await expect(h.consult()).rejects.toThrow('/plugins')
      h.entries[0]!.disabled = false
      h.setEnforcement('partial')
      await expect(h.consult()).rejects.toThrow('full filesystem confinement')
      h.setEnforcement('full')
      h.setCwd(tmpdir())
      await expect(h.consult()).rejects.toThrow('platform temporary area')
      expect(h.spawn).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('marks oversized opinions without splitting emoji', async () => {
    const h = await harness()
    try {
      h.setOutcome(Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'a'.repeat(47_999) + '🐳' }] }))
      const result = await h.consult()
      expect(result.truncated).toBe(true)
      expect(result.opinion).toBe('a'.repeat(47_999))
    } finally { await h.ctx.fiber.dispose() }
  })

  it('cancels after publication and waits for native cleanup; unloading also drains active consultations', async () => {
    const h = await harness()
    let finish!: (value: SubagentResult) => void
    h.setOutcome(new Promise(resolve => { finish = resolve }))
    h.release.mockImplementation(async () => { finish({ stopReason: 'aborted', output: [] }) })
    const cancellation = new AbortController()
    try {
      const result = h.consult('codex', cancellation.signal)
      await vi.waitFor(() => expect(h.spawn).toHaveBeenCalledTimes(1))
      cancellation.abort()
      await expect(result).rejects.toThrow()
      const root = h.spawn.mock.calls[0]![0].cwd
      await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' })
      h.setOutcome(new Promise(resolve => { finish = resolve }))
      const pending = h.consult('claude')
      const rejected = expect(pending).rejects.toThrow()
      await vi.waitFor(() => expect(h.spawn).toHaveBeenCalledTimes(2))
      await h.fiber.dispose()
      await rejected
      expect(h.release).toHaveBeenCalledTimes(2)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('observes cancellation before publication, reports failed or empty opinions, and preserves the typed output contract', async () => {
    const h = await harness()
    try {
      await expect(h.consult('codex', AbortSignal.abort())).rejects.toThrow()
      expect(h.spawn).not.toHaveBeenCalled()
      h.setOutcome(Promise.resolve({ stopReason: 'error', output: [], diagnostic: 'Native authentication failed' }))
      await expect(h.consult()).rejects.toThrow('authentication failed')
      h.setOutcome(Promise.resolve({ stopReason: 'completed', output: [] }))
      await expect(h.consult()).rejects.toThrow('no opinion')
      h.setOutcome(Promise.resolve(completed))
      const value = await h.tool().execute({ provider: 'claude', question: 'Review', context: 'DATA' }, { agent: h.agent, signal: new AbortController().signal } as never)
      expect(() => validateJsonSchemaValue(h.tool().output.schema, value)).not.toThrow()
      expect(h.tool().output.render({}, value as never)).toEqual([{ type: 'text', text: expect.stringContaining('Independent advice · claude') }])
      h.setEnabled(false)
      await expect(h.tool().execute({ provider: 'codex', question: 'Review' }, { agent: h.agent, signal: new AbortController().signal } as never)).rejects.toThrow('consultations are off')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('mounts the shipped command without model traffic', async () => {
    for (const preset of ['standard', 'code']) {
      const home = await mkdtemp(join(tmpdir(), 'omdsh-advisor-boot-'))
      try {
        const run = await bootTuiTurn({ home, preset, input: '/advisor codex Review cancellation\n' })
        expect(run.status, run.output.slice(-3000)).toBe(0)
        expect(run.output).toContain('@deepseek-ai/dsh-subagent-codex')
        expect(run.bodies).toEqual([])
      } finally { await rm(home, { recursive: true, force: true }) }
    }
  }, 180_000)

  it('exposes consultation on the native wire and in the generated PTC SDK without native traffic', async () => {
    for (const preset of ['standard', 'code']) {
      const home = await mkdtemp(join(tmpdir(), 'omdsh-advisor-catalog-'))
      try {
        const toolCall = preset === 'standard'
          ? { name: 'consult_advisor', arguments: JSON.stringify({ provider: 'codex', question: 'Review' }) }
          : undefined
        const run = await bootTuiTurn({ home, preset, ...(toolCall === undefined ? {} : { toolCall }) })
        expect(run.status, run.output.slice(-3000)).toBe(0)
        expect(JSON.stringify(run.bodies[0])).not.toContain('consult_adviser')
        if (preset === 'standard') {
          expect(requestToolNames(run.bodies[0])).toContain('consult_advisor')
          expect(JSON.stringify(run.bodies.at(-1))).toContain('Enable @deepseek-ai/dsh-subagent-codex')
        } else {
          expect(requestToolNames(run.bodies[0])).toContain('run_code')
          expect(JSON.stringify(run.bodies[0])).toContain('consult_advisor')
          expect(JSON.stringify(run.bodies[0])).toContain('truncated: boolean')
        }
      } finally { await rm(home, { recursive: true, force: true }) }
    }
  }, 180_000)
})
