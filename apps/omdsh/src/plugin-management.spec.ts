/** Exercise published profile transactions through the actual omdsh launcher. */
import { spawnTool } from './test-support/pnpm.ts'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const appRoot = fileURLToPath(new URL('..', import.meta.url))

describe('runtime plugin management', () => {
  it('installs, mounts, disables, reenables, removes, and edits a live profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-plugin-runtime-'))
    const home = join(root, 'home')
    const profile = join(home, 'profiles', 'omdsh')
    const bundle = join(root, 'demo')
    mkdirSync(profile, { recursive: true })
    mkdirSync(bundle)
    writeFileSync(join(profile, 'cordis.patch.yml'), '- id: runner\n  disabled: true\n')
    writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'omdsh-runtime-probe', version: '1.0.0', type: 'module', exports: './index.mjs', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    writeFileSync(join(bundle, 'index.mjs'), 'export function apply(ctx) { ctx.provide("omdshRuntimeProbe", true) }\n')
    writeFileSync(join(bundle, 'cordis.patch.yml'), '- insert:\n    - id: runtime-probe\n      name: omdsh-runtime-probe\n')
    const script = join(root, 'probe.mts')
    writeFileSync(script, `
import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import { runOmdsh } from ${JSON.stringify(pathToFileURL(join(appRoot, 'src', 'boot.ts')).href)}
import { pluginSettingsEntries, setSettingsEntry } from ${JSON.stringify(pathToFileURL(join(appRoot, '../../packages/tui/omdsh-tui/src/runtime/plugin-settings.ts')).href)}
const { ctx, shutdown } = await runOmdsh([])
try {
  assert.ok(ctx.get('hmr'), 'HMR activated')
  const manager = ctx.pluginManager
  const forms = pluginSettingsEntries(ctx)
  assert.ok(!forms.some(row => ['tui', 'agent-behavior', 'llm-deepseek', 'llm-pi-ai'].includes(row.id)), 'dedicated and automatic-form-disabled settings stay out of Advanced')
  assert.equal(forms.find(row => row.id === 'advisor').section, 'integrations')
  assert.equal(forms.find(row => row.id === (process.platform === 'win32' ? 'pwsh' : 'bash')).label, 'Shell')
  assert.equal(ctx.get('translator'), undefined)
  assert.ok(![...ctx.loader.entries()].some(entry => entry.options.id === 'tui-command-reasoning'), 'retired reasoning plugin is not mounted')
  assert.ok(!forms.some(row => row.namespace === 'tui-command-reasoning'), 'retired reasoning settings are absent')
  assert.equal(forms.find(row => row.id === 'subagent').section, 'agent')
  assert.equal(forms.find(row => row.id === 'integration:codex').section, 'integrations')
  const advisor = ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'advisor')
  // One field answers both questions: whether an advisor exists and which one.
  assert.equal(pluginSettingsEntries(ctx).find(row => row.id === 'advisor').inline.value, 'off')
  await setSettingsEntry(ctx, forms.find(row => row.id === 'advisor'), '"claude"', new AbortController().signal)
  assert.equal(pluginSettingsEntries(ctx).find(row => row.id === 'advisor').inline.value, 'claude')
  const changedAdvisor = ctx.settings.describe().find(row => row.ns === advisor.ns)
  assert.equal(changedAdvisor.value.advisor, 'claude')
  await ctx.settings.mutate(advisor.ns, [{ op: 'unset', path: ['advisor'] }], changedAdvisor.revision)
  const bundles = await manager.listBundles()
  assert.equal(bundles.find(row => row.name === '@agi-fans/oh-my-dsh').readOnlyReason, 'management-required')
  for (const name of ['@deepseek-ai/dsh-subagent-codex', '@deepseek-ai/dsh-subagent-claude-code']) {
    const bundle = bundles.find(row => row.name === name)
    assert.equal(bundle.availability, 'installation', name + ' ships with omdsh')
    assert.equal(bundle.enabled, false, name + ' starts disabled')
    assert.equal(bundle.removable, false, name + ' is installation-owned')
    assert.equal((await manager.setBundleEnabled(name, true)).application, 'applied')
    assert.equal((await manager.listBundles()).find(row => row.name === name).enabled, true)
    assert.equal((await manager.setBundleEnabled(name, false)).application, 'applied')
    assert.equal((await manager.listBundles()).find(row => row.name === name).enabled, false)
  }
  const installed = await manager.installBundle(${JSON.stringify(bundle)})
  assert.equal(installed.application, 'applied', JSON.stringify(installed))
  assert.equal(ctx.get('omdshRuntimeProbe'), true)
  const refreshed = (await manager.listBundles()).find(row => row.name === 'omdsh-runtime-probe')
  assert.equal(refreshed.availability, 'profile', 'installed bundle is immediately readable')
  assert.equal(refreshed.installed, true)
  assert.equal(refreshed.enabled, true)
  assert.equal((await manager.setBundleEnabled('omdsh-runtime-probe', false)).application, 'applied')
  assert.equal(ctx.get('omdshRuntimeProbe'), undefined)
  assert.equal((await manager.setBundleEnabled('omdsh-runtime-probe', true)).application, 'applied')
  assert.equal(ctx.get('omdshRuntimeProbe'), true)
  const section = ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'agent-loop')
  assert.ok(section)
  await ctx.settings.mutate(section.ns, [{ op: 'set', path: ['maxParallelToolCalls'], value: 3 }], section.revision)
  const updated = ctx.settings.describe().find(row => row.ns === section.ns)
  assert.equal(updated.value.maxParallelToolCalls, 3)
  await assert.rejects(ctx.settings.mutate(section.ns, [{ op: 'set', path: ['maxParallelToolCalls'], value: 4 }], section.revision), /changed|revision/i)
  await ctx.settings.mutate(section.ns, [{ op: 'unset', path: ['maxParallelToolCalls'] }], updated.revision)
  assert.equal(ctx.settings.describe().find(row => row.ns === section.ns).value.maxParallelToolCalls, section.base.maxParallelToolCalls)
  const selection = ctx.settings.describe().find(row => row.ns === 'subagent-model-selection-settings')
  assert.ok(selection, 'published model-selection settings mounted')
  await ctx.settings.update(selection.ns, { allowedModels: [{ provider: 'deepseek-official', model: 'deepseek-flash' }], enabled: true }, selection.revision)
  assert.deepEqual(ctx.subagentModelSelection.current(), { enabled: true, allowedModels: [{ provider: 'deepseek-official', model: 'deepseek-flash' }] })
  assert.equal((await manager.removeBundle('omdsh-runtime-probe')).application, 'applied')
  assert.equal(ctx.get('omdshRuntimeProbe'), undefined)
  assert.ok(!(await manager.listBundles()).some(row => row.name === 'omdsh-runtime-probe'))
  appendFileSync(${JSON.stringify(join(profile, 'cordis.patch.yml'))}, '- id: tool-web\\n  disabled: true\\n')
  let watched = false
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    if ((await manager.listPlugins()).find(row => row.patchId === 'tool-web')?.enabled === false) { watched = true; break }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(watched, 'profile patch watcher applies a hand edit')
  // The interactive host redirects console output into its log; emit the probe
  // marker on stdout so this launcher-level assertion still observes completion.
  process.stdout.write('RUNTIME_MANAGEMENT_OK\\n')
} finally { await shutdown.shutdown(0) }
`)
    try {
      const result = spawnTool(process.execPath, [join(appRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), script], {
        cwd: appRoot, encoding: 'utf8', timeout: 120_000,
        env: { ...process.env, OMDSH_HOME: home, NO_COLOR: '1' },
      })
      const output = (result.stdout ?? '') + (result.stderr ?? '')
      expect(result.status, output.slice(-6000)).toBe(0)
      expect(output).toContain('RUNTIME_MANAGEMENT_OK')
      expect(output).not.toContain('did not activate')
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 130_000)
})
