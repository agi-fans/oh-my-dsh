import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import Commands from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { PluginInfo, ChangeResult, PluginInstallRequestId } from '@deepseek-ai/dsh-plugin-manager'
import type { TuiService } from '../definition.ts'
import z from '@deepseek-ai/schemastery'
import * as plugins from './plugins.ts'

const row = { entryId: 'include:tool-web', patchId: 'tool-web', moduleName: '@deepseek-ai/dsh-tool-web', enabled: true, fiberPhase: 'active' } as PluginInfo
const changed: ChangeResult = { changed: true, application: 'applied', stage: 'enable', target: 'tool-web', enabled: false }

async function harness(answers: readonly (string | null)[]) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(Commands)
  const prompt = vi.fn<TuiService['prompt']>(async () => null)
  for (const answer of answers) prompt.mockResolvedValueOnce(answer)
  const setPluginEnabled = vi.fn(async () => changed)
  const listPlugins = vi.fn(async () => [row])
  const installBundle = vi.fn(async (_spec: string, _options: { requestId: PluginInstallRequestId }) => changed)
  const cancelInstall = vi.fn(async (_requestId: PluginInstallRequestId) => ({ status: 'cancelled' }))
  const listBundles = vi.fn(async () => [{ name: '@deepseek-ai/dsh-subagent-codex', official: true, availability: 'missing', enabled: false, installed: false,
    optional: false, removable: false, rows: [], overrides: [], installTarget: { spec: '@deepseek-ai/dsh-subagent-codex@0.2.1-rc.2', version: '0.2.1-rc.2' } }])
  const setBundleEnabled = vi.fn(async () => changed)
  const removeBundle = vi.fn(async () => ({ ...changed, stage: 'remove' as const }))
  const manager = { listPlugins, setPluginEnabled, listBundles, setBundleEnabled, removeBundle, inspect: vi.fn(async () => ({ status: 'accepted', kind: 'registry', name: 'demo', bundle: true, registry: null })), installBundle, cancelInstall }
  const commandOutput = vi.fn()
  ctx.provide('pluginManager', manager as never)
  ctx.provide('tui', { prompt, commandOutput, notice: vi.fn() } as unknown as TuiService)
  const fiber = await ctx.plugin(plugins)
  const session = ctx.sessions.create(SessionId('plugins-test'))
  return { ctx, fiber, prompt, commandOutput, manager, agent: { id: session.id, session, status: 'idle', inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent }
}

describe('native plugin management', () => {
  it.each(['cancelled', 'failed'] as const)('does not describe a %s installation as enabled', application => {
    expect(plugins.changeText({ ...changed, stage: 'install', application, enabled: true })).not.toContain('enabled')
  })
  it('offers an exact runtime-matched install for missing official bundles without enabling an absent package', async () => {
    const h = await harness(['bundles', '@deepseek-ai/dsh-subagent-codex', 'install', 'accept', null, null])
    await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
    expect(h.prompt.mock.calls[1]![0].options?.[0]?.description).toContain('Not installed')
    expect(h.prompt.mock.calls[2]![0].options?.map(option => option.value)).toEqual(['check', 'install'])
    expect(h.manager.setBundleEnabled).not.toHaveBeenCalled()
    expect(h.manager.inspect).toHaveBeenCalledWith('@deepseek-ai/dsh-subagent-codex@0.2.1-rc.2', undefined, expect.any(AbortSignal))
    expect(h.manager.installBundle).toHaveBeenCalledWith('@deepseek-ai/dsh-subagent-codex@0.2.1-rc.2', expect.objectContaining({ saveExact: true }))
    expect(h.prompt.mock.calls[4]![0]).toMatchObject({ presentation: 'progress', notify: false })
    await h.ctx.fiber.dispose()
  })

  it('refreshes the picker after installation completes without cancelling during prompt cleanup', async () => {
    const h = await harness(['bundles', '@deepseek-ai/dsh-subagent-codex', 'install', 'install', 'bundles', null, null])
    const answers = ['bundles', '@deepseek-ai/dsh-subagent-codex', 'install', 'accept', 'bundles', null, null]
    h.prompt.mockReset().mockImplementation(request => {
      if (request.presentation !== 'progress') return Promise.resolve(answers.shift() ?? null)
      return new Promise(resolve => {
        if (request.signal!.aborted) resolve(null)
        else request.signal!.addEventListener('abort', () => resolve(null), { once: true })
      })
    })
    h.manager.installBundle.mockImplementation(async () => {
      h.manager.listBundles.mockResolvedValue([{ name: '@deepseek-ai/dsh-subagent-codex', availability: 'profile', installed: true, enabled: true,
        rows: [], overrides: [], official: true, optional: false, removable: true }] as never)
      return { ...changed, stage: 'install', target: '@deepseek-ai/dsh-subagent-codex', enabled: true }
    })
    try {
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls.filter(([request]) => request.title === 'Bundles').at(-1)![0].options![0]!.description).toContain('Installed · Enabled')
      expect(h.manager.cancelInstall).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('routes bundled native runtimes to the shared Integration settings without installing a redundant profile copy', async () => {
    const h = await harness(['bundles', '@deepseek-ai/dsh-subagent-codex', 'settings', 'toggle', null, null])
    h.manager.listBundles.mockResolvedValue([{ name: '@deepseek-ai/dsh-subagent-codex', official: true, availability: 'installation', installed: false,
      enabled: false, optional: false, removable: false, rows: [], overrides: [], installTarget: { spec: '@deepseek-ai/dsh-subagent-codex@0.2.1-rc.2', version: '0.2.1-rc.2' } }] as never)
    try {
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls[1]![0].options![0]!.description).toContain('Installed · Disabled')
      expect(h.prompt.mock.calls[2]![0].options?.map(option => option.value)).toEqual(['settings'])
      expect(h.prompt.mock.calls[3]![0]).toMatchObject({ title: 'Codex', question: 'Disabled' })
      expect(h.prompt.mock.calls[2]![0].detail).toContain('Included with omdsh')
      expect(h.prompt.mock.calls[2]![0].detail).toContain('cannot be uninstalled separately')
      expect(h.manager.setBundleEnabled).toHaveBeenCalledWith('@deepseek-ai/dsh-subagent-codex', true)
      expect(h.manager.installBundle).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each(['accept', null])('confirms uninstall of a profile-owned bundle: %s', async consent => {
    const bundle = '@deepseek-ai/dsh-subagent-codex'
    const h = await harness(['bundles', bundle, 'remove', consent, null])
    h.manager.listBundles.mockResolvedValue([{ name: bundle, official: true, availability: 'profile', installed: true,
      enabled: true, optional: false, removable: true, rows: [], overrides: [] }] as never)
    try {
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls[2]![0].options).toContainEqual({ label: 'Uninstall', value: 'remove' })
      expect(h.prompt.mock.calls[3]![0]).toMatchObject({ title: 'Uninstall bundle', question: bundle })
      expect(h.prompt.mock.calls[3]![0].detail).toContain('every session using this profile')
      if (consent === 'accept') expect(h.manager.removeBundle).toHaveBeenCalledWith(bundle)
      else expect(h.manager.removeBundle).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('labels removal of an absent selected bundle as profile removal rather than uninstall', async () => {
    const bundle = '@deepseek-ai/dsh-subagent-codex'
    const h = await harness(['bundles', bundle, 'remove', null, null])
    h.manager.listBundles.mockResolvedValue([{ name: bundle, official: true, availability: 'missing', installed: false,
      enabled: true, optional: false, removable: true, rows: [], overrides: [] }] as never)
    try {
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls[2]![0].options).toContainEqual({ label: 'Remove from profile', value: 'remove' })
      expect(h.prompt.mock.calls[3]![0].title).toBe('Remove bundle from profile')
      expect(h.manager.removeBundle).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('toggles an addressable entry and reports the observed application result', async () => {
    const h = await harness(['entries', row.entryId, 'accept', null])
    await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
    expect(h.manager.setPluginEnabled).toHaveBeenCalledWith(row.entryId, false)
    expect(h.commandOutput).toHaveBeenCalledWith('/plugins', 'tool-web: applied · disabled')
    await h.ctx.fiber.dispose()
  })

  it('reports a missing native bundle without probing credentials or executing a task', async () => {
    const h = await harness(['bundles', '@deepseek-ai/dsh-subagent-codex', 'check', null])
    try {
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls[2]![0].detail).toContain('no executable from PATH')
      // Status is a result, so it lands in the transcript rather than on a surface.
      expect(h.commandOutput).toHaveBeenCalledWith('Codex · Status', expect.stringContaining('Package: not installed'))
      expect(h.commandOutput).toHaveBeenCalledWith('Codex · Status', expect.stringContaining('authentication: not tested'))
      expect(h.manager.installBundle).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('opens native model and permission fields through revision-checked Settings without exposing env', async () => {
    const h = await harness(['bundles', '@deepseek-ai/dsh-subagent-codex', 'settings', 'field:permissionMode', '"never"', null, null, null])
    const mutate = vi.fn(async () => {})
    h.manager.listBundles.mockResolvedValue([{ name: '@deepseek-ai/dsh-subagent-codex', official: true, availability: 'profile', enabled: true,
      installed: true, optional: false, removable: true, rows: [{ rowId: 'subagent-codex', moduleName: '@deepseek-ai/dsh-subagent-codex' }], overrides: [] }] as never)
    h.ctx.provide('settings', { writable: true, describe: () => [{ ns: 'subagent-codex', revision: 3,
      schema: z.object({ model: z.string(), permissionMode: z.union(['never', 'approve-for-me']), env: z.dict(z.string()) }).toJSON(),
      value: { permissionMode: 'approve-for-me', env: { API_KEY: 'private-secret' } }, base: {}, user: {} }], mutate } as never)
    try {
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls[4]![0]).toMatchObject({ title: 'Permissions' })
      expect(h.prompt.mock.calls[4]![0].options?.map(option => option.label)).toEqual(['never', 'approve-for-me'])
      expect(mutate).toHaveBeenCalledWith('subagent-codex', [{ op: 'set', path: ['permissionMode'], value: 'never' }], 3)
      expect(JSON.stringify(h.prompt.mock.calls)).not.toContain('private-secret')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('retains direct enablement for generic bundles', async () => {
    const h = await harness(['bundles', 'third-party', 'toggle', null])
    h.manager.listBundles.mockResolvedValue([{ name: 'third-party', availability: 'profile', installed: true, enabled: false, removable: true, rows: [], overrides: [] }] as never)
    try {
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls[2]![0].options).toContainEqual({ label: 'Enable', value: 'toggle' })
      expect(h.manager.setBundleEnabled).toHaveBeenCalledWith('third-party', true)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('keeps terminal owners read-only and refuses management during a turn', async () => {
    expect(plugins.pluginReadOnly({ ...row, moduleName: '@agi-fans/dsh-tui/runner' })).toBe('terminal-required')
    expect(plugins.pluginReadOnly({ ...row, patchId: 'working-directory' })).toBe('terminal-required')
    expect(plugins.pluginReadOnly({ ...row, readOnlyReason: 'unaddressable' } as PluginInfo)).toBe('unaddressable')
    const h = await harness([])
    Object.assign(h.agent, { status: 'running' })
    const result = await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
    expect(result?.result.kind).toBe('error')
    expect(h.prompt).not.toHaveBeenCalled()
    await h.ctx.fiber.dispose()
  })

  it('cancels an install by its request id and waits for restoration before returning', async () => {
    const h = await harness(['install', 'demo', 'accept', 'cancel', null])
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
    const h = await harness(['install', 'demo', 'accept'])
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
    const h = await harness(['install', 'demo', 'accept', null, approval === 'approve' ? 'accept' : null, null, null])
    h.manager.installBundle.mockResolvedValueOnce({ ...changed, application: 'failed', pendingBuilds: ['native-a', 'native-b'] })
    await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
    const consent = h.prompt.mock.calls.find(([request]) => request.title === 'Dependency scripts')![0]
    expect(consent.detail).toContain('native-a\nnative-b')
    expect(h.manager.installBundle).toHaveBeenCalledTimes(approval === 'approve' ? 2 : 1)
    if (approval === 'approve') expect(h.manager.installBundle).toHaveBeenNthCalledWith(2, 'demo', expect.objectContaining({ approvedBuilds: ['native-a', 'native-b'] }))
    await h.ctx.fiber.dispose()
  })
})
