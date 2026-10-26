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
import type { AdvisorMode } from './advisor.ts'
import { bootTuiTurn } from './test-support/tui-boot.ts'
import { requestToolNames } from './test-support/tui-boot.ts'

const completed: SubagentResult = { stopReason: 'completed', output: [{ type: 'text', text: 'Check the cancellation race.' }] }

async function harness() {
  const ctx = new Context(), providers = new Map<string, SubagentProvider>()
  const specs: SubagentActivationSpec[] = [], nativeCalls: ResolvedSubagentStartRequest[] = []
  const configs: Record<string, unknown>[] = []
  let outcome: Promise<SubagentResult> = Promise.resolve(completed), mode: AdvisorMode = 'codex', enforcement = 'full', cwd = process.cwd()
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
  const fiber = ctx.plugin({ ...advisor, Config: undefined }, { advisor: { get: () => mode }, allowModelConsultations: { get: () => undefined } } as advisor.Config)
  await fiber.await()
  const agent = { session: { id: 'parent', header: { cwd: process.cwd() } } } as unknown as Agent
  return { ctx, fiber, agent, entries, providers, specs, configs, nativeCalls, spawn, confine, release,
    setOutcome: (value: Promise<SubagentResult>) => { outcome = value }, setMode: (value: AdvisorMode) => { mode = value }, setEnforcement: (value: string) => { enforcement = value }, setCwd: (value: string) => { cwd = value },
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

  it('automatically supplies a bounded workspace snapshot when explicit context is empty', async () => {
    const h = await harness()
    try {
      await h.ctx.advisor.consult(h.agent, 'codex', '看看我们工程在项目结构上是否有值得优化的内容', '', new AbortController().signal)
      const promptBlock = h.specs[0]!.request.prompt[0]!
      expect(promptBlock.type).toBe('text')
      if (promptBlock.type === 'text') {
        expect(promptBlock.text).toContain('Context:\nWorkspace root:')
        expect(promptBlock.text).toContain('### package.json')
        expect(promptBlock.text).toContain('### Workspace packages')
      }
    } finally { await h.ctx.fiber.dispose() }
  })

  it('uses caller delivery, workspace cwd, read-only native tools, and a confined private scratch directory', async () => {
    const h = await harness()
    try {
      expect(h.spawn).not.toHaveBeenCalled()
      expect(await h.consult()).toEqual({ provider: 'codex', question: 'Review cancellation', opinion: 'Check the cancellation race.', truncated: false })
      expect(h.specs[0]).toMatchObject({ provider: 'advisor-codex', label: 'Advisor · codex · Review cancellation', delivery: 'caller', request: { parent: h.agent } })
      expect(h.specs[0]!.request.prompt).toHaveLength(1)
      expect(h.configs[0]).toMatchObject({ model: 'selected-model', permissionMode: 'never' })
      expect(h.entries[0]!.fiber.config.permissionMode).toBe('bypassPermissions')
      const spec = h.spawn.mock.calls[0]![0]
      const scratchRoot = spec.env!.HOME!
      expect(spec.cwd).toBe(process.cwd())
      expect(scratchRoot).not.toBe(process.cwd())
      expect(spec.argv).toContain('sandbox_mode="danger-full-access"')
      expect(spec.argv[0]).toBe('sandbox-runner')
      expect(spec.env).toMatchObject({ CODEX_HOME: join(scratchRoot, '.codex'), HOME: scratchRoot })
      expect(h.confine.mock.calls[0]![1]).toMatchObject({ mode: 'workspace-write', workspaceRoot: scratchRoot })
      await expect(access(scratchRoot)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(h.release).toHaveBeenCalledTimes(1)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('isolates concurrent bindings and restricts Claude tools to read-only inspection without disabling native OAuth', async () => {
    const h = await harness()
    try {
      await Promise.all([h.consult(), h.consult('claude')])
      expect(h.spawn.mock.calls[0]![0].env!.TMPDIR).not.toBe(h.spawn.mock.calls[1]![0].env!.TMPDIR)
      const claude = h.spawn.mock.calls.map(([spec]) => spec).find(spec => spec.argv.includes('--safe-mode'))!
      expect(claude.argv).toEqual(expect.arrayContaining(['--tools', 'Read,Grep,Glob', '--strict-mcp-config', '{"mcpServers":{}}', '--disable-slash-commands']))
      expect(claude.argv).not.toContain('--bare')
      expect(h.configs.some(config => config.permissionMode === 'plan')).toBe(true)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('parses live inspection activity from Codex and Claude JSON streams', () => {
    expect(advisor.parseAdviceActivity('codex', JSON.stringify({
      method: 'item/started',
      params: { item: { type: 'commandExecution', command: '/bin/zsh -lc "rg --files apps packages"' } },
    }))).toEqual({ text: '$ rg --files apps packages', status: 'running' })
    expect(advisor.parseAdviceActivity('codex', JSON.stringify({
      method: 'item/completed',
      params: { item: { type: 'commandExecution', command: '/bin/zsh -lc "rg --files apps packages"', status: 'completed', exitCode: 0 } },
    }))).toEqual({ text: '$ rg --files apps packages', status: 'ok' })
    expect(advisor.parseAdviceActivity('codex', JSON.stringify({
      method: 'item/completed',
      params: { item: { type: 'agentMessage', phase: 'commentary', text: 'Inspecting workspace boundaries\nand scripts' } },
    }))).toEqual({ text: 'Inspecting workspace boundaries', status: 'thinking' })

    const claudeState: { lastTool?: string | undefined } = {}
    expect(advisor.parseAdviceActivity('claude', JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'package.json' } }] },
    }), claudeState)).toEqual({ text: 'Read package.json', status: 'running' })
    expect(advisor.parseAdviceActivity('claude', JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', is_error: false }] },
    }), claudeState)).toEqual({ text: 'Read package.json', status: 'ok' })
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
      const root = h.spawn.mock.calls[0]![0].env!.HOME!
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
      h.setMode('claude')
      const value = await h.tool()!.execute({ question: 'Review', context: 'DATA' }, { agent: h.agent, signal: new AbortController().signal } as never)
      expect(() => validateJsonSchemaValue(h.tool()!.output.schema, value)).not.toThrow()
      expect(h.tool()!.output.render({}, value as never)).toEqual([{ type: 'text', text: expect.stringContaining('Independent advice · claude') }])
      // Turning the advisor off removes the tool from the schema entirely.
      h.setMode('off')
      h.ctx.emit('loader/volatile-update', [['advisor']])
      expect(h.tool()).toBeUndefined()
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
          ? { name: 'consult_advisor', arguments: JSON.stringify({ question: 'Review' }) }
          : undefined
        // No advisor is configured by default, so this profile enables one the
        // way a reader would: the tool is absent until then.
        const run = await bootTuiTurn({ home, preset, patch: '- id: advisor\n  config:\n    advisor: codex\n', ...(toolCall === undefined ? {} : { toolCall }) })
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
