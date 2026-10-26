import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { TuiPrompt, TuiService } from '../definition.ts'
import * as config from './plugin-settings.ts'

const schema = z.object({
  timeout: z.number().min(1).step(1).description('Maximum wait in seconds'),
  mode: z.union(['fast', 'slow']),
  nested: z.object({ max: z.number() }),
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref'),
  profiles: z.array(z.object({ key: z.string().role('secret') })),
  hidden: z.string().hidden(),
})

describe('plugin configuration', () => {
  it('omits deprecated fields and their nested children', () => {
    const fields = config.configFields(z.object({ old: z.string().deprecated(), removed: z.object({ nested: z.string() }).deprecated(), current: z.boolean() }))
    expect(fields.map(field => field.path.join('.'))).toEqual(['current'])
  })
  it('flattens objects, hides private fields, and protects compound secrets', () => {
    const fields = config.configFields(new z(schema.toJSON()))
    expect(fields.map(field => field.path.join('.'))).toEqual(['timeout', 'mode', 'nested.max', 'apiKey', 'apiKeyEnv', 'profiles'])
    expect(fields.find(field => field.secret)?.path).toEqual(['apiKey'])
    expect(fields.find(field => field.protected)?.path).toEqual(['profiles'])
    expect(config.parseConfigValue(fields[0]!, '42')).toBe(42)
    expect(() => config.parseConfigValue(fields[0]!, '0')).toThrow()
    expect(config.parseConfigValue(fields[1]!, '"fast"')).toBe('fast')
  })

  async function harness(answers: readonly (string | null)[]) {
    const ctx = new Context()
    const prompt = vi.fn<TuiService['prompt']>(async () => null)
    for (const answer of answers) prompt.mockResolvedValueOnce(answer)
    const section = { ns: 'web-search-deepseek', schema: schema.toJSON(), revision: 7,
      value: { timeout: 12, mode: 'fast' }, base: { timeout: 10 }, user: { timeout: 12 }, applies: 'live', autoGenerate: true }
    const mutate = vi.fn(async () => {})
    const set = vi.fn(async (_ref: string, _value: string) => {})
    const unset = vi.fn(async (_ref: string) => {})
    const notice = vi.fn()
    const describe = vi.fn(() => [section])
    ctx.provide('settings', { describe, writable: true, mutate } as never)
    ctx.provide('credentials', { set, unset } as never)
    ctx.provide('tui', { prompt, notice } as unknown as TuiService)
    return { ctx, prompt, notice, mutate, set, unset, section, describe }
  }

  it('places built-in forms in product categories and preserves unclaimed fields in Advanced', async () => {
    const h = await harness([])
    const descriptors = [
      { ...h.section, ns: 'tui', schema: z.object({ theme: z.string(), statusBar: z.dict(z.string()), foldDensity: z.string(), future: z.boolean() }).toJSON() },
      { ...h.section, ns: 'agent-behavior', schema: z.object({ language: z.string() }).toJSON() },
      { ...h.section, ns: 'advisor', schema: z.object({ advisor: z.union(['off', 'codex', 'claude'] as const), future: z.string() }).toJSON() },
      { ...h.section, ns: 'agent-loop', schema: z.object({ maxParallelToolCalls: z.number() }).toJSON() },
      { ...h.section, ns: 'bash', schema: z.object({ timeoutMs: z.number(), cwd: z.string() }).toJSON() },
      { ...h.section, ns: 'private-page', autoGenerate: false },
      { ...h.section, ns: 'third-party' },
    ]
    h.describe.mockReturnValue(descriptors)
    try {
      const entries = config.pluginSettingsEntries(h.ctx)
      expect(entries.find(entry => entry.id === 'advanced:tui')).toMatchObject({ section: 'advanced', fields: ['future'] })
      expect(entries.some(entry => entry.id === 'agent-behavior' || entry.id === 'private-page')).toBe(false)
      expect(entries.find(entry => entry.id === 'advisor')).toMatchObject({ label: 'Advisor', section: 'integrations', fields: ['advisor'] })
      expect(entries.find(entry => entry.id === 'advanced:advisor')).toMatchObject({ section: 'advanced', fields: ['future'] })
      expect(entries.find(entry => entry.id === 'agent-loop')?.section).toBe('tools')
      expect(entries.find(entry => entry.id === 'bash')).toMatchObject({ section: 'tools', fields: ['timeoutMs'] })
      expect(entries.some(entry => entry.id === 'advanced:bash')).toBe(false)
      expect(entries.find(entry => entry.id === 'advanced:third-party')?.section).toBe('advanced')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('keeps third-party namespaces distinct from product and native control identities', async () => {
    const h = await harness([])
    h.describe.mockReturnValue(['advisor', 'advanced:advisor', 'integration:codex', 'constructor'].map(ns => ({ ...h.section, ns,
      schema: z.object({ advisor: z.union(['off', 'codex', 'claude'] as const), extra: z.string() }).toJSON() })))
    h.ctx.provide('pluginManager', {} as never)
    try {
      const entries = config.pluginSettingsEntries(h.ctx)
      expect(new Set(entries.map(entry => entry.id)).size).toBe(entries.length)
      expect(entries.find(entry => entry.id === 'advanced:integration:codex')?.namespace).toBe('integration:codex')
      expect(entries.find(entry => entry.id === 'advanced:constructor')?.fields).toEqual(['advisor', 'extra'])
    } finally { await h.ctx.fiber.dispose() }
  })

  it('edits product labels with schema validation and writes only the original owner path', async () => {
    // A union value is written as JSON, which is what the option list carries.
    const h = await harness(['0', '"claude"', null])
    h.section.ns = 'advisor'
    h.section.schema = z.object({ advisor: z.union(['off', 'codex', 'claude'] as const) }).toJSON()
    try {
      await config.editSettingsEntry(h.ctx, 'advisor', new AbortController().signal)
      expect(h.prompt.mock.calls[0]![0]).toMatchObject({ title: 'Advisor', options: expect.arrayContaining([expect.objectContaining({ label: 'Advisor' })]) })
      expect(h.prompt.mock.calls[1]![0].options?.map(option => option.label)).toEqual(['off', 'codex', 'claude'])
      expect(h.mutate).toHaveBeenCalledWith('advisor', [{ op: 'set', path: ['advisor'], value: 'claude' }], 7)
      expect(h.notice).toHaveBeenCalledWith('Advisor: saved.')
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each([
    ['timeoutMs', 30_000, '30s', '2m', 120_000],
    ['maxOutputBytes', 2_097_152, '2 MiB', '512 KiB', 524_288],
  ] as const)('prefills %s with readable units and validates the converted number', async (path, current, initialInput, answer, expected) => {
    const h = await harness(['0', answer, null])
    h.section.ns = 'bash'
    h.section.schema = z.object({ [path]: z.number().min(1).step(1) }).toJSON()
    Object.assign(h.section.value, { [path]: current })
    try {
      await config.editSettingsEntry(h.ctx, 'bash', new AbortController().signal)
      expect(h.prompt.mock.calls[1]![0]).toMatchObject({ initialInput, question: 'Enter a value' })
      expect(h.mutate).toHaveBeenCalledWith('bash', [{ op: 'set', path: [path], value: expected }], 7)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('preselects the effective enum and does not prefill secrets', async () => {
    const h = await harness(['0', null, null])
    h.section.ns = 'hook-settings'
    h.section.schema = z.object({ bridge: z.union(['off', 'codex', 'claude-code']) }).toJSON()
    Object.assign(h.section.value, { bridge: 'claude-code' })
    try {
      await config.editSettingsEntry(h.ctx, 'hook-settings', new AbortController().signal)
      expect(h.prompt.mock.calls[1]![0].initialValue).toBe('"claude-code"')
      h.section.ns = 'secret-owner'
      h.section.schema = z.object({ apiKey: z.string().role('secret') }).toJSON()
      h.prompt.mockResolvedValueOnce('0').mockResolvedValueOnce('set').mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      await config.editPluginSettings(h.ctx, 'secret-owner', new AbortController().signal)
      const secret = h.prompt.mock.calls.find(([request]) => request.secret)?.[0]
      expect(secret).toMatchObject({ secret: true })
      expect(secret).not.toHaveProperty('initialInput')
      expect(secret).not.toHaveProperty('initialValue')
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each(['theme', 'statusItem:context', 'statusReset', 'agentLanguage'])('restores only the chosen %s override after confirmation', async id => {
    const h = await harness(['restore'])
    h.section.ns = id === 'agentLanguage' ? 'agent-behavior' : 'tui'
    h.section.schema = z.object({ theme: z.string(), language: z.string(), statusBar: z.object({ colors: z.object({ context: z.string() }) }) }).toJSON()
    try {
      await config.resetSettingsControl(h.ctx, id, undefined, new AbortController().signal, 'Readable label')
      const paths = id === 'statusReset' ? [['statusBar'], ['statusPreset']] : id === 'statusItem:context' ? [['statusBar', 'colors', 'context']] : [[id === 'agentLanguage' ? 'language' : 'theme']]
      expect(h.prompt.mock.calls[0]![0].question).toBe(id.startsWith('statusItem:') ? 'Readable label color' : 'Readable label')
      expect(h.mutate).toHaveBeenCalledWith(h.section.ns, paths.map(path => ({ op: 'unset', path })), 7)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('keeps the displayed revision through restore confirmation and cancels without a write', async () => {
    const h = await harness([])
    h.section.ns = 'tui'
    h.section.schema = z.object({ theme: z.string() }).toJSON()
    h.prompt.mockImplementationOnce(async () => { h.section.revision++; return 'restore' }).mockResolvedValueOnce(null)
    try {
      await config.resetSettingsControl(h.ctx, 'theme', undefined, new AbortController().signal)
      expect(h.mutate).toHaveBeenLastCalledWith('tui', [{ op: 'unset', path: ['theme'] }], 7)
      await config.resetSettingsControl(h.ctx, 'theme', undefined, new AbortController().signal)
      expect(h.mutate).toHaveBeenCalledTimes(1)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('keeps Advanced scoped to unclaimed fields and hides native environment overrides', async () => {
    const h = await harness([null])
    h.section.ns = 'advisor'
    h.section.schema = z.object({ advisor: z.union(['off', 'codex', 'claude'] as const), future: z.string() }).toJSON()
    try {
      await config.editSettingsEntry(h.ctx, 'advanced:advisor', new AbortController().signal)
      expect(h.prompt.mock.calls[0]![0].options?.map(option => option.label)).toEqual(['future'])
      h.section.ns = 'subagent-codex'
      h.section.schema = z.object({ model: z.string(), permissionMode: z.string(), env: z.dict(z.string()), disposeGraceMs: z.number() }).toJSON()
      expect(config.pluginSettingsEntries(h.ctx)).toMatchObject([{ fields: ['disposeGraceMs'] }])
    } finally { await h.ctx.fiber.dispose() }
  })

  it('enables a shipped native integration through Plugin Manager and re-reads its state', async () => {
    const h = await harness(['toggle', null])
    const row = { name: '@deepseek-ai/dsh-subagent-codex', availability: 'installation', enabled: false, rows: [] }
    const listBundles = vi.fn(async () => [row])
    const setBundleEnabled = vi.fn(async (_name: string, enabled: boolean) => { row.enabled = enabled; return { application: 'applied', enabled } })
    h.ctx.provide('pluginManager', { listBundles, setBundleEnabled } as never)
    try {
      expect(config.pluginSettingsEntries(h.ctx).find(entry => entry.id === 'integration:codex')).toMatchObject({ label: 'Codex', section: 'integrations' })
      await config.editSettingsEntry(h.ctx, 'integration:codex', new AbortController().signal)
      expect(setBundleEnabled).toHaveBeenCalledWith(row.name, true)
      expect(h.prompt.mock.calls[0]![0].question).toBe('Disabled')
      expect(h.prompt.mock.calls[1]![0].question).toBe('Enabled')
      expect(listBundles).toHaveBeenCalledTimes(2)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('awaits the status reader, reads fresh registration, and closes on owner cancellation', async () => {
    const h = await harness(['check'])
    const closing = new AbortController()
    const row = { name: '@deepseek-ai/dsh-subagent-codex', availability: 'installation', enabled: false, rows: [] }
    const listBundles = vi.fn(async () => [{ ...row, enabled: true }]).mockResolvedValueOnce([row])
    const setBundleEnabled = vi.fn()
    h.ctx.provide('pluginManager', { listBundles, listPlugins: async () => [], setBundleEnabled } as never)
    h.prompt.mockImplementation(request => new Promise(resolve => {
      request.signal!.addEventListener('abort', () => { resolve(null) }, { once: true })
    }))
    try {
      const operation = config.editSettingsEntry(h.ctx, 'integration:codex', closing.signal)
      await vi.waitFor(() => { expect(h.prompt).toHaveBeenCalledTimes(2) })
      expect(h.prompt.mock.calls[1]![0]).toMatchObject({ presentation: 'document', notify: false, signal: closing.signal })
      expect(h.prompt.mock.calls[1]![0].documentSource?.text).toContain('Profile: enabled')
      expect(h.prompt.mock.calls[1]![0].documentSource?.text).toContain('authentication: not tested')
      expect(h.prompt).toHaveBeenCalledTimes(2)
      closing.abort()
      await operation
      expect(h.prompt).toHaveBeenCalledTimes(2)
      expect(setBundleEnabled).not.toHaveBeenCalled()
      expect(h.set).not.toHaveBeenCalled()
    } finally { closing.abort(); await h.ctx.fiber.dispose() }
  })

  it('directs missing native packages to Plugins without enabling or installing them', async () => {
    const h = await harness([])
    const setBundleEnabled = vi.fn(), installBundle = vi.fn()
    h.ctx.provide('pluginManager', { listBundles: async () => [], setBundleEnabled, installBundle } as never)
    try {
      await config.editSettingsEntry(h.ctx, 'integration:claude', new AbortController().signal)
      expect(h.notice).toHaveBeenCalledWith(expect.stringContaining('/plugins → Bundles'), { level: 'error' })
      expect(setBundleEnabled).not.toHaveBeenCalled()
      expect(installBundle).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('keeps stable namespaces behind readable labels and displays schema help', async () => {
    const h = await harness([null])
    h.section.ns = 'third-party'
    h.describe.mockReturnValue([h.section])
    expect(config.pluginSettingsEntries(h.ctx)[0]).toMatchObject({ id: 'advanced:third-party', section: 'advanced' })
    await config.editPluginSettings(h.ctx, 'third-party', new AbortController().signal)
    expect(h.prompt.mock.calls[0]![0].options![0]!.description).toContain('Maximum wait in seconds')
    await h.ctx.fiber.dispose()
  })

  it.each(['bash', 'pwsh'])('presents the mounted %s owner as Shell and preserves platform-specific fields', async ns => {
    const h = await harness(['restore', '0', 'reset', null])
    h.section.ns = ns
    h.section.schema = z.object({ timeoutMs: z.number(), maxOutputBytes: z.number(), executable: z.string() }).toJSON()
    try {
      expect(config.pluginSettingsEntries(h.ctx)).toMatchObject([
        { id: ns, label: 'Shell', section: 'tools', fields: ['timeoutMs', 'maxOutputBytes'] },
        { id: `advanced:${ns}`, fields: ['executable'] },
      ])
      await config.editSettingsEntry(h.ctx, ns, new AbortController().signal)
      expect(h.mutate).toHaveBeenCalledWith(ns, [{ op: 'unset', path: ['timeoutMs'] }], 7)
      expect(h.notice).toHaveBeenCalledWith('Default timeout: inherited value restored.')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('keeps Messages search limits and credentials in one fallback form', async () => {
    const h = await harness([])
    h.section.schema = z.object({ maxUses: z.number(), maxTokens: z.number(), apiKey: z.string().role('secret'), apiKeyEnv: z.string(), baseURL: z.string(), model: z.string(), apiVersion: z.string() }).toJSON()
    try {
      expect(config.pluginSettingsEntries(h.ctx)).toMatchObject([
        { id: 'web-search-deepseek', label: 'Web search · Messages', section: 'integrations',
          fields: ['maxUses', 'maxTokens', 'apiKey', 'apiKeyEnv', 'baseURL', 'model', 'apiVersion'] },
      ])
      expect(config.pluginSettingsEntries(h.ctx).some(entry => entry.section === 'advanced')).toBe(false)
      expect(h.mutate).not.toHaveBeenCalled()
      expect(h.set).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('keeps DeepSeek Search API settings in one primary form', async () => {
    const h = await harness([])
    h.section.ns = 'web-deepseek-api'
    h.section.schema = z.object({ apiKey: z.string().role('secret'), apiKeyEnv: z.string(), baseURL: z.string(), count: z.number(), sendOriginalQuestion: z.boolean() }).toJSON()
    h.describe.mockReturnValue([h.section])
    try {
      expect(config.pluginSettingsEntries(h.ctx)).toMatchObject([
        { id: 'web-deepseek-api', label: 'Web search · API', section: 'integrations',
          fields: ['apiKey', 'apiKeyEnv', 'baseURL', 'count', 'sendOriginalQuestion'] },
      ])
      expect(config.pluginSettingsEntries(h.ctx).some(entry => entry.section === 'advanced')).toBe(false)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('moves Web provider selection into Integrations', async () => {
    const h = await harness([])
    h.section.ns = 'web'
    h.section.schema = z.object({ searchProvider: z.string(), fetchProvider: z.string() }).toJSON()
    h.describe.mockReturnValue([h.section])
    try {
      expect(config.pluginSettingsEntries(h.ctx)).toMatchObject([
        { id: 'web', label: 'Web providers', section: 'integrations', fields: ['searchProvider', 'fetchProvider'] },
      ])
      expect(config.pluginSettingsEntries(h.ctx).some(entry => entry.section === 'advanced')).toBe(false)
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each([
    ['file-recovery', 'enabled', z.boolean(), false, 'true', 'On'],
    ['advisor', 'advisor', z.union(['off', 'codex', 'claude']), 'off', '"claude"', 'claude'],
    ['hook-settings', 'bridge', z.union(['off', 'codex', 'claude-code']), 'off', '"codex"', 'codex'],
  ] as const)('derives inline %s choices from its schema and writes its owner revision', async (ns, path, schema, current, choice, label) => {
    const h = await harness([])
    h.section.ns = ns
    h.section.schema = z.object({ [path]: schema }).toJSON()
    Object.assign(h.section.value, { [path]: current })
    try {
      const entry = config.pluginSettingsEntries(h.ctx)[0]!
      expect(entry.inline?.choices).toContainEqual({ value: choice, label })
      await config.setSettingsEntry(h.ctx, entry, choice, new AbortController().signal)
      expect(h.mutate).toHaveBeenCalledWith(ns, [{ op: 'set', path: [path], value: JSON.parse(choice) }], 7)
      expect(h.prompt).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('refuses inline edits after a concurrent change, cancellation, or a read-only transition', async () => {
    const h = await harness([])
    h.section.ns = 'advisor'
    h.section.schema = z.object({ advisor: z.union(['off', 'codex', 'claude']) }).toJSON()
    try {
      const entry = config.pluginSettingsEntries(h.ctx)[0]!
      h.section.revision++
      await expect(config.setSettingsEntry(h.ctx, entry, '"off"', new AbortController().signal)).rejects.toThrow('Configuration changed')
      h.section.revision--
      const closing = new AbortController(); closing.abort()
      await expect(config.setSettingsEntry(h.ctx, entry, '"off"', closing.signal)).rejects.toThrow()
      h.ctx.settings.writable = false
      expect(config.pluginSettingsEntries(h.ctx)[0]?.inline?.choices).toEqual([])
      await expect(config.setSettingsEntry(h.ctx, entry, '"off"', new AbortController().signal)).rejects.toThrow('read-only')
      expect(h.mutate).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('validates child-model prerequisites and does not retry a failed inline write', async () => {
    const h = await harness([])
    h.section.ns = 'subagent-model-selection-settings'
    h.section.schema = z.object({ enabled: z.boolean(), allowedModels: z.array(z.string()) }).toJSON()
    Object.assign(h.section.value, { enabled: false, allowedModels: [] })
    try {
      const entry = config.pluginSettingsEntries(h.ctx)[0]!
      await expect(config.setSettingsEntry(h.ctx, entry, 'true', new AbortController().signal)).rejects.toThrow('at least one')
      expect(h.mutate).not.toHaveBeenCalled()
      Object.assign(h.section.value, { allowedModels: ['model'] })
      h.mutate.mockRejectedValueOnce(new Error('Configuration changed'))
      await expect(config.setSettingsEntry(h.ctx, entry, 'true', new AbortController().signal)).rejects.toThrow('Configuration changed')
      expect(h.mutate).toHaveBeenCalledTimes(1)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('edits allowed models from the catalog, retains configured routes and writes only the owner field', async () => {
    const h = await harness(['1', '0, 1', null])
    h.section.ns = 'subagent-model-selection-settings'
    h.section.schema = z.object({ enabled: z.boolean(), allowedModels: z.array(z.object({ provider: z.string(), model: z.string() })) }).toJSON()
    const retained = { provider: 'offline-provider', model: 'custom-model' }
    Object.assign(h.section.value, { enabled: false, allowedModels: [retained] })
    h.ctx.provide('llm', { listProviders: () => [{ id: 'official' }], listModels: async () => [{ id: 'flash', name: 'Flash' }] } as never)
    try {
      await config.editSettingsEntry(h.ctx, 'subagent-model-selection-settings', new AbortController().signal)
      expect(h.prompt.mock.calls[1]![0]).toMatchObject({ multiSelect: true, allowEmptySelection: true, initialValues: ['1'], options: [{ value: '0' }, { value: '1', description: expect.stringContaining('outside the model catalog') }] })
      expect(h.mutate).toHaveBeenCalledWith(h.section.ns, [{ op: 'set', path: ['allowedModels'], value: [{ provider: 'official', model: 'flash' }, retained] }], 7)
      expect(h.prompt.mock.calls[1]![0].question).not.toContain('JSON')
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each([null, ''])('cancels without writing or explicitly clears the disabled allowlist (answer=%s)', async answer => {
    const h = await harness(['1', answer, null])
    h.section.ns = 'subagent-model-selection-settings'
    h.section.schema = z.object({ enabled: z.boolean(), allowedModels: z.array(z.object({ provider: z.string(), model: z.string() })) }).toJSON()
    Object.assign(h.section.value, { enabled: false, allowedModels: [{ provider: 'offline', model: 'custom' }] })
    try {
      await config.editSettingsEntry(h.ctx, h.section.ns, new AbortController().signal)
      if (answer === null) expect(h.mutate).not.toHaveBeenCalled()
      else expect(h.mutate).toHaveBeenCalledWith(h.section.ns, [{ op: 'set', path: ['allowedModels'], value: [] }], 7)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('opens a native model directly without a field picker and leaves permissions intact', async () => {
    const h = await harness(['field:model', 'new-model', null])
    h.section.ns = 'subagent-codex'
    h.section.schema = z.object({ model: z.string(), permissionMode: z.string() }).toJSON()
    Object.assign(h.section.value, { model: 'old-model', permissionMode: 'never' })
    const row = { name: '@deepseek-ai/dsh-subagent-codex', availability: 'installation', enabled: true, rows: [{ moduleName: '@deepseek-ai/dsh-subagent-codex', rowId: 'subagent-codex' }] }
    h.ctx.provide('pluginManager', { listBundles: async () => [row] } as never)
    try {
      await config.editSettingsEntry(h.ctx, 'integration:codex', new AbortController().signal)
      expect(h.prompt.mock.calls[0]![0].options).toContainEqual({ label: 'Model', value: 'field:model' })
      expect(h.prompt.mock.calls[1]![0]).toMatchObject({ title: 'Model', question: 'Enter a value', initialInput: 'old-model' })
      expect(h.mutate).toHaveBeenCalledWith('subagent-codex', [{ op: 'set', path: ['model'], value: 'new-model' }], 7)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('uses a path reset with the read revision and leaves other fields intact', async () => {
    const h = await harness(['0', 'reset', null])
    await config.editPluginSettings(h.ctx, 'web-search-deepseek', new AbortController().signal)
    expect(h.mutate).toHaveBeenCalledWith('web-search-deepseek', [{ op: 'unset', path: ['timeout'] }], 7)
    expect(h.prompt.mock.calls[0]![0].options![0]!.description).toContain('profile override')
    await h.ctx.fiber.dispose()
  })

  it('edits a guided field subset without displaying excluded values or writing unrelated fields', async () => {
    const h = await harness(['0', 'set', '"slow"', null])
    Object.assign(h.section.value, { apiKey: 'private-key', timeout: 12 })
    try {
      await config.editPluginSettings(h.ctx, 'web-search-deepseek', new AbortController().signal, ['mode'])
      expect(h.prompt.mock.calls[0]![0].options?.map(option => option.label)).toEqual(['mode'])
      expect(h.mutate).toHaveBeenCalledWith('web-search-deepseek', [{ op: 'set', path: ['mode'], value: 'slow' }], 7)
      expect(JSON.stringify(h.prompt.mock.calls)).not.toContain('private-key')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('stores API keys in credentials and writes only the reference to the profile', async () => {
    const h = await harness(['3', 'set', 'private-key', null])
    await config.editPluginSettings(h.ctx, 'web-search-deepseek', new AbortController().signal)
    const ref = h.set.mock.calls[0]![0]
    expect(h.set).toHaveBeenCalledWith(expect.stringMatching(/^OMDSH_WEB_SEARCH_DEEPSEEK_API_KEY_/u), 'private-key')
    expect(h.mutate).toHaveBeenCalledWith('web-search-deepseek', [
      { op: 'unset', path: ['apiKey'] },
      { op: 'set', path: ['apiKeyEnv'], value: ref },
    ], 7)
    expect(h.prompt.mock.calls[2]![0].secret).toBe(true)
    expect(JSON.stringify(h.notice.mock.calls)).not.toContain('private-key')
    await h.ctx.fiber.dispose()
  })

  it('shows a configured credential reference and resets both key paths without revoking storage', async () => {
    const h = await harness(['3', 'reset', null])
    Object.assign(h.section.value, { apiKeyEnv: 'SHARED_KEY' })
    Object.assign(h.section.user, { apiKeyEnv: 'SHARED_KEY' })
    await config.editPluginSettings(h.ctx, 'web-search-deepseek', new AbortController().signal)
    expect(h.prompt.mock.calls[0]![0].options![3]!.description).toBe('secret · credential reference configured · profile override')
    expect(h.mutate).toHaveBeenCalledWith('web-search-deepseek', [
      { op: 'unset', path: ['apiKey'] },
      { op: 'unset', path: ['apiKeyEnv'] },
    ], 7)
    expect(h.unset).not.toHaveBeenCalled()
    await h.ctx.fiber.dispose()
  })

  it('removes only the newly staged credential when its profile write loses a race', async () => {
    const h = await harness(['3', 'set', 'private-key', null])
    h.mutate.mockRejectedValueOnce(new Error('Configuration changed'))
    await config.editPluginSettings(h.ctx, 'web-search-deepseek', new AbortController().signal)
    expect(h.unset).toHaveBeenCalledWith(h.set.mock.calls[0]![0])
    expect(JSON.stringify(h.notice.mock.calls)).not.toContain('private-key')
    await h.ctx.fiber.dispose()
  })

  it('reports a stale write and does not retry with a newer revision', async () => {
    const h = await harness(['0', 'set', '42', null])
    h.mutate.mockRejectedValueOnce(new Error('Configuration changed'))
    await config.editPluginSettings(h.ctx, 'web-search-deepseek', new AbortController().signal)
    expect(h.mutate).toHaveBeenCalledTimes(1)
    expect(h.notice).toHaveBeenCalledWith('Configuration changed', { level: 'error' })
    await h.ctx.fiber.dispose()
  })

  it('closes the form when its owner aborts', async () => {
    const h = await harness([])
    h.prompt.mockImplementation((request: TuiPrompt) => new Promise(resolve => {
      request.signal!.addEventListener('abort', () => { resolve(null) }, { once: true })
    }))
    const closing = new AbortController()
    const operation = config.editPluginSettings(h.ctx, 'web-search-deepseek', closing.signal)
    await vi.waitFor(() => { expect(h.prompt).toHaveBeenCalled() })
    closing.abort()
    await operation
    await h.ctx.fiber.dispose()
  })
})
