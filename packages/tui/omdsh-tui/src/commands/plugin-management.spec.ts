import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import Commands from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { PluginInfo, ChangeResult, PluginInstallRequestId } from '@deepseek-ai/dsh-plugin-manager'
import type { TuiService } from '../definition.ts'
import * as plugins from './plugins.ts'

const row = { entryId: 'include:tool-web', patchId: 'tool-web', moduleName: '@deepseek-ai/dsh-tool-web', enabled: true, fiberPhase: 'active' } as PluginInfo
const changed: ChangeResult = { changed: true, application: 'applied', stage: 'enable', target: 'tool-web', enabled: false }

async function harness(answers: readonly (string | null)[]) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(Commands)
  const prompt = vi.fn<TuiService['prompt']>()
  for (const answer of answers) prompt.mockResolvedValueOnce(answer)
  const setPluginEnabled = vi.fn(async () => changed)
  const listPlugins = vi.fn(async () => [row])
  const installBundle = vi.fn(async (_spec: string, _options: { requestId: PluginInstallRequestId }) => changed)
  const cancelInstall = vi.fn(async (_requestId: PluginInstallRequestId) => ({ status: 'cancelled' }))
  const manager = { listPlugins, setPluginEnabled, inspect: vi.fn(async () => ({ status: 'accepted', kind: 'registry', name: 'demo', bundle: true, registry: null })), installBundle, cancelInstall }
  const commandOutput = vi.fn()
  ctx.provide('pluginManager', manager as never)
  ctx.provide('tui', { prompt, commandOutput, notice: vi.fn() } as unknown as TuiService)
  const fiber = await ctx.plugin(plugins)
  const session = ctx.sessions.create(SessionId('plugins-test'))
  return { ctx, fiber, prompt, commandOutput, manager, agent: { id: session.id, session, status: 'idle', inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent }
}

describe('native plugin management', () => {
  it('toggles an addressable entry and reports the observed application result', async () => {
    const h = await harness(['entries', row.entryId, 'toggle', null])
    await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
    expect(h.manager.setPluginEnabled).toHaveBeenCalledWith(row.entryId, false)
    expect(h.commandOutput).toHaveBeenCalledWith('/plugins', 'tool-web: applied · disabled')
    await h.ctx.fiber.dispose()
  })

  it('keeps terminal owners read-only and refuses management during a turn', async () => {
    expect(plugins.pluginReadOnly({ ...row, moduleName: '@agi-fans/dsh-tui/runner' })).toBe('terminal-required')
    expect(plugins.pluginReadOnly({ ...row, readOnlyReason: 'unaddressable' } as PluginInfo)).toBe('unaddressable')
    const h = await harness([])
    Object.assign(h.agent, { status: 'running' })
    const result = await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
    expect(result?.result.kind).toBe('error')
    expect(h.prompt).not.toHaveBeenCalled()
    await h.ctx.fiber.dispose()
  })

  it('cancels an install by its request id and waits for restoration before returning', async () => {
    const h = await harness(['install', 'demo', 'install', 'cancel', null])
    const settlement = Promise.withResolvers<ChangeResult>()
    h.manager.installBundle.mockImplementation(() => settlement.promise)
    const operation = h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
    let ended = false
    void operation.then(() => { ended = true })
    await vi.waitFor(() => { expect(h.manager.cancelInstall).toHaveBeenCalledTimes(1) })
    expect(h.manager.cancelInstall.mock.calls[0]![0]).toBe(h.manager.installBundle.mock.calls[0]![1].requestId)
    expect(ended).toBe(false)
    settlement.resolve({ ...changed, stage: 'install', application: 'cancelled' })
    await operation
    expect(h.commandOutput.mock.calls[0]![1]).toContain('cancelled')
    await h.ctx.fiber.dispose()
  })

  it('aborts a pending install on unmount and joins its settlement', async () => {
    const h = await harness(['install', 'demo', 'install'])
    const settlement = Promise.withResolvers<ChangeResult>()
    h.manager.installBundle.mockImplementation(() => settlement.promise)
    h.prompt.mockImplementation(request => new Promise(resolve => {
      request.signal!.addEventListener('abort', () => { resolve(null) }, { once: true })
    }))
    const operation = h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
    await vi.waitFor(() => { expect(h.manager.installBundle).toHaveBeenCalled() })
    const disposed = h.fiber.dispose()
    await vi.waitFor(() => { expect(h.manager.cancelInstall).toHaveBeenCalled() })
    settlement.resolve({ ...changed, application: 'cancelled' })
    await disposed
    await operation
    await h.ctx.fiber.dispose()
  })

  it.each([null, 'approve'])('retries dependency scripts only after explicit group approval: %s', async approval => {
    const h = await harness(['install', 'demo', 'install', null, approval, null, null])
    h.manager.installBundle.mockResolvedValueOnce({ ...changed, application: 'failed', pendingBuilds: ['native-a', 'native-b'] })
    await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
    const consent = h.prompt.mock.calls.find(([request]) => request.title === 'Dependency scripts')![0]
    expect(consent.detail).toContain('native-a\nnative-b')
    expect(h.manager.installBundle).toHaveBeenCalledTimes(approval === 'approve' ? 2 : 1)
    if (approval === 'approve') expect(h.manager.installBundle).toHaveBeenNthCalledWith(2, 'demo', expect.objectContaining({ approvedBuilds: ['native-a', 'native-b'] }))
    await h.ctx.fiber.dispose()
  })
})
