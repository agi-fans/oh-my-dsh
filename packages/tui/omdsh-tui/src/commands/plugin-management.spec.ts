import { promptBrowserState } from '../runtime/prompt-browser.ts'
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

async function harness(answers: readonly (string | null)[], settings?: unknown, credentials?: unknown) {
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
  const settingsProvider = settings === undefined ? undefined : await ctx.plugin({ name: 'test-profile-settings', apply(provider: Context) {
    provider.provide('settings', settings as never)
  } })
  if (credentials !== undefined) await ctx.plugin({ name: 'test-profile-credentials', apply(provider: Context) {
    provider.provide('credentials', credentials as never)
  } })
  const fiber = await ctx.plugin(plugins)
  const session = ctx.sessions.create(SessionId('plugins-test'))
  return { ctx, fiber, settingsProvider, prompt, commandOutput, manager, agent: { id: session.id, session, status: 'idle', inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent }
}

describe('native plugin management', () => {
  it('opens Configure plugins with Settings provided by a sibling plugin', async () => {
    const h = await harness(['configure', null, null], { writable: true, describe: () => [] })
    try {
      const result = await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(result?.result).toEqual({ kind: 'success' })
      expect(h.prompt.mock.calls[1]![0]).toMatchObject({ title: 'Plugin settings' })
    } finally { await h.ctx.fiber.dispose() }
  })

  it('saves configuration and credentials through their sibling provider scopes', async () => {
    const mutate = vi.fn(async () => {}), set = vi.fn(async (_reference: string, _value: string) => {})
    const h = await harness(['configure', 'advanced:custom', '0', 'set', 'test-token', null, null], {
      writable: true, describe: () => [{ ns: 'custom', revision: 7,
        schema: z.object({ apiKey: z.string().role('secret'), apiKeyEnv: z.string() }).toJSON(),
        value: {}, base: {}, user: {} }], mutate,
    }, { set })
    try {
      const result = await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(result?.result).toEqual({ kind: 'success' })
      expect(set).toHaveBeenCalledWith(expect.stringMatching(/^OMDSH_CUSTOM_API_KEY_/u), 'test-token')
      expect(mutate).toHaveBeenCalledWith('custom', [
        { op: 'unset', path: ['apiKey'] },
        { op: 'set', path: ['apiKeyEnv'], value: set.mock.calls[0]![0] },
      ], 7)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('keeps plugin management available when Settings is absent', async () => {
    const h = await harness([null])
    try {
      expect((await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal))?.result).toEqual({ kind: 'success' })
      expect(h.prompt.mock.calls[0]![0].options?.some(option => option.value === 'configure')).toBe(false)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('closes a configuration prompt when its Settings provider is unloaded', async () => {
    const h = await harness(['configure'], { writable: true, describe: () => [] })
    h.prompt.mockImplementation(request => new Promise(resolve => {
      request.signal!.addEventListener('abort', () => resolve(null), { once: true })
    }))
    try {
      const operation = h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      await vi.waitFor(() => expect(h.prompt.mock.calls[1]?.[0].title).toBe('Plugin settings'))
      await h.settingsProvider!.dispose()
      expect((await operation)?.result).toEqual({ kind: 'success' })
      h.prompt.mockResolvedValue(null)
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls.at(-1)![0].options?.some(option => option.value === 'configure')).toBe(false)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('starts Creator from Plugins without submitting a message', async () => {
    const h = await harness(['creator'])
    const changeAgentPreset = vi.fn(), newSession = vi.fn(), send = vi.fn()
    h.ctx.provide('omdshSession', { agentPresets: async () => [{ id: 'cordis' }], changeAgentPreset, newSession, send } as never)
    try {
      const result = await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls[0]![0].options).toContainEqual(expect.objectContaining({ value: 'creator', disabled: false }))
      expect(result?.result).toMatchObject({ kind: 'success', text: expect.stringContaining('Creator is ready') })
      expect(changeAgentPreset).toHaveBeenCalledWith(h.agent, 'cordis')
      expect(newSession).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each([{ presets: [] }, { presets: [{ id: 'cordis', broken: 'missing dependency' }] }])('disables an unavailable Creator with a reason ($presets)', async ({ presets }) => {
    const h = await harness([null])
    h.ctx.provide('omdshSession', { agentPresets: async () => presets } as never)
    try {
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls[0]![0].options).toContainEqual(expect.objectContaining({
        value: 'creator', disabled: true, description: presets[0]?.broken ?? 'Creator is unavailable in this profile.',
      }))
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each(['cancelled', 'failed'] as const)('does not describe a %s installation as enabled', application => {
    expect(plugins.changeText({ ...changed, stage: 'install', application, enabled: true })).not.toContain('enabled')
  })
  it('offers an exact runtime-matched install for missing official bundles without enabling an absent package', async () => {
    const h = await harness(['bundles', '@deepseek-ai/dsh-subagent-codex', 'install', 'accept', null, null])
    await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
    expect(h.prompt.mock.calls[1]![0].options?.[0]?.description).toContain('Not installed')
    expect(h.prompt.mock.calls[2]![0].options?.map(option => option.value)).toEqual(['check', 'install', 'guide'])
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
    const h = await harness(['entries', row.entryId, 'toggle', 'accept', null])
    await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
    expect(h.manager.setPluginEnabled).toHaveBeenCalledWith(row.entryId, false)
    expect(h.prompt.mock.calls[4]![0]).toMatchObject({ title: 'Plugin entries', detail: 'tool-web: applied · disabled' })
    expect(h.commandOutput).not.toHaveBeenCalled()
    await h.ctx.fiber.dispose()
  })

  it('reports a missing native bundle without probing credentials or executing a task', async () => {
    const h = await harness(['bundles', '@deepseek-ai/dsh-subagent-codex', 'check', null])
    try {
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls[2]![0].detail).toContain('Bundled runtime')
      expect(h.prompt.mock.calls[3]![0]).toMatchObject({ presentation: 'document', title: 'Codex · Installation status' })
      expect(h.prompt.mock.calls[3]![0].detail).toContain('| Installation | Not installed |')
      expect(h.prompt.mock.calls[3]![0].detail).toContain('Not checked. Runtime startup and sign-in')
      expect(h.prompt.mock.calls[4]![0]).toMatchObject({ title: '@deepseek-ai/dsh-subagent-codex', initialValue: 'check' })
      expect(h.commandOutput).not.toHaveBeenCalled()
      expect(h.manager.installBundle).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('opens native model and permission fields through revision-checked Settings without exposing env', async () => {
    const mutate = vi.fn(async () => {})
    const h = await harness(['bundles', '@deepseek-ai/dsh-subagent-codex', 'settings', 'field:permissionMode', '"never"', null, null, null], { writable: true, describe: () => [{ ns: 'subagent-codex', revision: 3,
      schema: z.object({ model: z.string(), permissionMode: z.union(['never', 'approve-for-me']), env: z.dict(z.string()) }).toJSON(),
      value: { permissionMode: 'approve-for-me', env: { API_KEY: 'private-secret' } }, base: {}, user: {} }], mutate })
    h.manager.listBundles.mockResolvedValue([{ name: '@deepseek-ai/dsh-subagent-codex', official: true, availability: 'profile', enabled: true,
      installed: true, optional: false, removable: true, rows: [{ rowId: 'subagent-codex', moduleName: '@deepseek-ai/dsh-subagent-codex' }], overrides: [] }] as never)

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
    expect(h.prompt.mock.lastCall![0].detail).toContain('cancelled')
    expect(h.commandOutput).not.toHaveBeenCalled()
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

describe('Discover', () => {
  const entry = {
    name: 'dsh-plugin-example',
    defaultVersion: '1.2.0',
    description: { en: 'An example plugin.' },
    versions: [{ version: '1.2.0', install: { spec: 'dsh-plugin-example@1.2.0' }, compatibility: { compatible: true } }],
    installation: { status: 'not-installed' },
  }

  async function discoverHarness(options: { indexes: unknown[]; entries?: unknown[] }) {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(Commands)
    const prompt = vi.fn<TuiService['prompt']>(async () => null)
    const commandOutput = vi.fn(), notice = vi.fn()
    const search = vi.fn(async () => ({
      url: 'https://market.test/index.json', title: { en: 'Test market' }, metadata: {},
      fetchedAt: 1, entries: options.entries ?? [entry], total: 1, nextOffset: null,
    }))
    ctx.provide('pluginMarket', { listIndexes: () => options.indexes, search } as never)
    // The command plugin injects the manager, so it must exist for the row to mount.
    const manager = { listPlugins: async () => [], listBundles: async () => [],
      inspect: vi.fn(async () => ({ status: 'accepted', name: entry.name, version: '1.2.0' })),
      installBundle: vi.fn(async () => ({ ...changed, target: entry.name, stage: 'install', enabled: true })), cancelInstall: vi.fn() }
    ctx.provide('pluginManager', manager as never)
    ctx.provide('tui', { prompt, commandOutput, notice } as unknown as TuiService)
    await ctx.plugin(plugins)
    const session = ctx.sessions.create(SessionId('market-test'))
    const agent = { id: session.id, session, status: 'idle', inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent
    return { ctx, agent, prompt, commandOutput, notice, search, manager }
  }

  it('keeps source setup guidance and retry in Discover', async () => {
    const h = await discoverHarness({ indexes: [] })
    try {
      h.prompt.mockResolvedValueOnce('discover').mockResolvedValueOnce('')
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls[2]![0]).toMatchObject({ title: 'Discover plugins', detail: expect.stringContaining('No plugin index sources') })
      expect(h.commandOutput).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('lists a source that cannot be read with the reason it was refused', async () => {
    const h = await discoverHarness({ indexes: [{ url: 'https://market.test/index.json', error: 'not canonical' }] })
    try {
      h.prompt.mockResolvedValueOnce('discover').mockResolvedValueOnce('')
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls[2]![0].detail).toContain('not canonical')
      expect(h.commandOutput).not.toHaveBeenCalled()
      expect(h.search).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('searches the configured indexes and offers the entry that was chosen', async () => {
    const h = await discoverHarness({ indexes: [{ url: 'https://market.test/index.json' }] })
    try {
      h.prompt.mockResolvedValueOnce('discover').mockResolvedValueOnce('example').mockResolvedValueOnce(JSON.stringify(['https://market.test/index.json', entry.name])).mockResolvedValueOnce(null)
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.search).toHaveBeenCalledWith('https://market.test/index.json', expect.objectContaining({ text: 'example', offset: 0 }))
      const results = h.prompt.mock.calls[2]![0]
      expect(results.options?.[0]).toMatchObject({ label: 'dsh-plugin-example', value: JSON.stringify(['https://market.test/index.json', entry.name]) })
      expect(results.options?.[0]?.preview).toBe('An example plugin.')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('returns from cancelled installation to the same search result', async () => {
    const h = await discoverHarness({ indexes: [{ url: 'https://market.test/index.json' }] })
    h.prompt.mockResolvedValueOnce('discover').mockResolvedValueOnce('example')
      .mockImplementationOnce(async request => {
        Object.assign(promptBrowserState(request)!, { query: 'plugin', selected: request.options![0]!.value })
        return request.options![0]!.value!
      }).mockResolvedValueOnce(null)
    try {
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls[3]![0].title).toBe('Install bundle')
      expect(h.prompt.mock.calls[4]![0]).toMatchObject({ title: 'Discover plugins', question: 'example' })
      expect(promptBrowserState(h.prompt.mock.calls[4]![0])).toMatchObject({ query: 'plugin', selected: JSON.stringify(['https://market.test/index.json', entry.name]) })
      expect(h.search).toHaveBeenCalledTimes(1)
      expect(h.manager.installBundle).not.toHaveBeenCalled()
      expect(h.commandOutput).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('allows a new search from empty results and keeps its text on cancellation', async () => {
    const h = await discoverHarness({ indexes: [{ url: 'https://market.test/index.json' }], entries: [] })
    for (const answer of ['discover', 'missing', 'search:', null, 'search:', 'example', null]) h.prompt.mockResolvedValueOnce(answer)
    h.search.mockResolvedValueOnce({ url: 'https://market.test/index.json', title: { en: 'Test market' }, metadata: {}, fetchedAt: 1, entries: [], total: 0, nextOffset: null })
    try {
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls[2]![0]).toMatchObject({ emptyText: 'No matching plugins.', actions: expect.arrayContaining([expect.objectContaining({ valuePrefix: 'search:', scope: 'list' })]) })
      expect(h.prompt.mock.calls[3]![0].initialInput).toBe('missing')
      expect(h.prompt.mock.calls[4]![0].question).toBe('missing')
      expect(h.search).toHaveBeenLastCalledWith('https://market.test/index.json', expect.objectContaining({ text: 'example' }))
      expect(h.commandOutput).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('retains the previous search results after a failed refresh and retries in place', async () => {
    const h = await discoverHarness({ indexes: [{ url: 'https://market.test/index.json' }] })
    h.prompt.mockResolvedValueOnce('discover').mockResolvedValueOnce('example')
      .mockImplementationOnce(async () => { h.search.mockRejectedValueOnce(new Error('Index unavailable')); return 'refresh:' })
      .mockResolvedValueOnce('refresh:')
    try {
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls[3]![0]).toMatchObject({ question: 'example', detail: 'Index unavailable', options: expect.arrayContaining([expect.objectContaining({ label: entry.name })]) })
      expect(h.prompt.mock.calls[4]![0].detail).toBe('')
      expect(h.search).toHaveBeenCalledTimes(3)
      expect(h.commandOutput).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('keeps incompatible plugin feedback with the results', async () => {
    const h = await discoverHarness({ indexes: [{ url: 'https://market.test/index.json' }], entries: [{ ...entry,
      versions: [{ ...entry.versions[0], compatibility: { compatible: false, requirements: { dsh: '99.0.0' } } }] }] })
    h.prompt.mockResolvedValueOnce('discover').mockResolvedValueOnce('example')
      .mockResolvedValueOnce(JSON.stringify(['https://market.test/index.json', entry.name]))
    try {
      await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
      expect(h.prompt.mock.calls[3]![0]).toMatchObject({ title: 'Discover plugins', question: 'example', detail: expect.stringContaining('requires dsh 99.0.0') })
      expect(h.manager.inspect).not.toHaveBeenCalled()
      expect(h.commandOutput).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })
})

it('reads and copies full diagnostics for a required plugin, then returns to its list', async () => {
  const h = await harness(['entries', row.entryId, 'copy', null, null, null])
  const diagnostic = 'Startup failed\n' + 'long error detail\n'.repeat(80)
  h.manager.listPlugins.mockResolvedValue([{ ...row, moduleName: '@agi-fans/dsh-tui', diagnostic,
    meta: { description: { en: 'English introduction', 'zh-CN': '中文介绍' } } }])
  const copyText = vi.fn(async () => {})
  Object.assign(h.ctx.tui, { copyText, prefs: () => ({ uiLanguage: 'zh-CN' }) })
  try {
    await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
    const detail = h.prompt.mock.calls[2]![0]
    expect(detail.presentation).toBe('document')
    expect(detail.documentSource?.text).toContain(diagnostic)
    expect(detail.documentSource?.text).toContain('中文介绍')
    expect(detail.documentSource?.text).toContain('终端运行所必需')
    expect(detail.options?.map(option => option.value)).toEqual(['back', 'copy'])
    expect(copyText).toHaveBeenCalledWith(detail.documentSource?.text, '插件条目')
    expect(h.prompt.mock.calls[4]![0].title).toBe('Plugin entries')
    expect(h.manager.setPluginEnabled).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})

it('returns from a declined toggle to the plugin detail and rechecks stale enablement', async () => {
  const h = await harness(['entries', row.entryId, 'toggle', null, 'toggle', 'accept', null, null])
  h.manager.listPlugins.mockResolvedValueOnce([row]).mockResolvedValue([{ ...row, enabled: false }])
  try {
    await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
    expect(h.prompt.mock.calls[4]![0].presentation).toBe('document')
    expect(h.manager.setPluginEnabled).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})


it('returns through configuration and bundle parents with their filters intact', async () => {
  const bundle = '@deepseek-ai/dsh-subagent-codex'
  const h = await harness([], { writable: true, describe: () => [{ ns: 'custom', revision: 1,
    schema: z.object({ value: z.string() }).toJSON(), value: {}, base: {}, user: {} }] })
  h.manager.listBundles.mockResolvedValue([{ name: bundle, official: true, availability: 'installation', installed: false,
    enabled: false, optional: false, removable: false, rows: [], overrides: [] }] as never)
  h.prompt.mockResolvedValueOnce('configure').mockImplementationOnce(async request => {
    Object.assign(promptBrowserState(request)!, { query: 'custom', selected: 'advanced:custom' })
    return 'advanced:custom'
  }).mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce('bundles')
    .mockImplementationOnce(async request => {
      Object.assign(promptBrowserState(request)!, { query: 'codex', selected: bundle })
      return bundle
    }).mockResolvedValueOnce('settings').mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
  try {
    expect((await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal))?.result.kind).toBe('success')
    expect(h.prompt.mock.calls[3]![0].title).toBe('Plugin settings')
    expect(promptBrowserState(h.prompt.mock.calls[3]![0])).toMatchObject({ query: 'custom', selected: 'advanced:custom' })
    expect(h.prompt.mock.calls[8]![0]).toMatchObject({ title: bundle, initialValue: 'settings' })
    expect(h.prompt.mock.calls[9]![0].title).toBe('Bundles')
    expect(promptBrowserState(h.prompt.mock.calls[9]![0])).toMatchObject({ query: 'codex', selected: bundle })
    expect(h.prompt.mock.calls[10]![0].title).toBe('Plugins')
  } finally { await h.ctx.fiber.dispose() }
})

it('shows a compact installation result and opens copyable full logs on demand', async () => {
  const h = await harness(['install', 'demo', 'accept', null, 'result:', 'copy', 'back', null])
  const copyText = vi.fn(async () => {})
  const log = 'installation output\n' + 'log detail\n'.repeat(80)
  const result = { ...changed, stage: 'install', application: 'failed', packageResult: { output: log, logPath: '/tmp/install.log' } } as ChangeResult
  h.manager.installBundle.mockResolvedValue(result)
  Object.assign(h.ctx.tui, { copyText })
  try {
    await h.ctx.commands.execute(h.agent, '/plugins', [], new AbortController().signal)
    expect(h.prompt.mock.calls[4]![0]).toMatchObject({ title: 'Plugins', detail: expect.stringContaining('failed'), actions: expect.arrayContaining([expect.objectContaining({ valuePrefix: 'result:' })]) })
    expect(h.prompt.mock.calls[4]![0].detail).not.toContain(log)
    expect(h.prompt.mock.calls[5]![0]).toMatchObject({ presentation: 'document', documentSource: { text: expect.stringContaining(log) } })
    expect(copyText).toHaveBeenCalledWith(plugins.changeText(result), result.target)
    expect(h.prompt.mock.calls[7]![0].title).toBe('Plugins')
    expect(h.commandOutput).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})
