import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, type Config } from './hook-settings.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function hooksFile(text = '{"hooks":{}}') {
  const root = await mkdtemp(join(tmpdir(), 'omdsh-hooks-')); roots.push(root)
  const path = join(root, 'hooks.json'); await writeFile(path, text); return path
}
function harness() {
  const values = { bridge: 'off', configPath: '' }
  const config = { bridge: { get: () => values.bridge }, configPath: { get: () => values.configPath } } as unknown as Config
  const dispose = vi.fn(async () => {})
  const plugin = vi.fn(async () => ({ dispose }))
  const notice = vi.fn()
  let update: () => Promise<void>, cleanup: () => Promise<void>
  const ctx = { tui: { notice }, plugin, on: (_name: string, callback: () => Promise<void>) => { update = callback },
    effect: (callback: () => () => Promise<void>) => { cleanup = callback() } } as unknown as Context
  return { ctx, config, values, dispose, plugin, notice, update: () => update!(), cleanup: () => cleanup!() }
}

describe('opt-in hook lifecycle', () => {
  it('defaults to no execution and replaces the active bridge only after disposing it', async () => {
    const h = harness()
    await apply(h.ctx, h.config)
    expect(h.plugin).not.toHaveBeenCalled()
    h.values.bridge = 'codex'; h.values.configPath = await hooksFile()
    await h.update()
    expect(h.plugin).toHaveBeenCalledOnce()
    h.values.bridge = 'claude-code'
    await h.update()
    expect(h.dispose).toHaveBeenCalledOnce()
    expect(h.dispose.mock.invocationCallOrder[0]).toBeLessThan(h.plugin.mock.invocationCallOrder[1]!)
    h.values.bridge = 'off'
    await h.update()
    expect(h.dispose).toHaveBeenCalledTimes(2)
    await h.cleanup()
  })
  it('leaves failed configuration disabled and drains pending replacement during disposal', async () => {
    const h = harness()
    h.values.bridge = 'codex'; h.values.configPath = await hooksFile('{broken')
    await apply(h.ctx, h.config)
    expect(h.plugin).not.toHaveBeenCalled()
    expect(h.notice).toHaveBeenCalledWith(expect.stringContaining('Command hooks are disabled'), { level: 'error' })
    h.values.configPath = await hooksFile()
    let release!: (value: { dispose(): Promise<void> }) => void
    h.plugin.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const updated = h.update()
    await vi.waitFor(() => { expect(h.plugin).toHaveBeenCalledOnce() })
    const stopped = h.cleanup()
    release({ dispose: h.dispose })
    await Promise.all([updated, stopped])
    expect(h.dispose).toHaveBeenCalledOnce()
    expect(h.notice.mock.calls.filter(call => String(call[0]).includes('enabled'))).toHaveLength(0)
  })
})
