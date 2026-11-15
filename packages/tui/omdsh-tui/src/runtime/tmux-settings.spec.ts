import type { Context } from '@deepseek-ai/cordis'
import * as tmuxContext from '@deepseek-ai/dsh-tmux-context'
import { describe, expect, it, vi } from 'vitest'
import { apply, Config, type Config as TmuxSettingsConfig } from './tmux-settings.ts'

function harness(hasTui = true) {
  const values = { enabled: true, refreshIntervalMs: 0 }
  const config = {
    enabled: { get: () => values.enabled },
    refreshIntervalMs: { get: () => values.refreshIntervalMs },
  } as unknown as TmuxSettingsConfig
  const dispose = vi.fn(async () => {})
  const plugin = vi.fn(async () => ({ dispose }))
  const notice = vi.fn()
  let update: () => Promise<void>
  let cleanup: () => Promise<void>
  const ctx = {
    get: (service: string) => (service === 'tui' && hasTui ? { notice } : undefined),
    plugin,
    on: (_name: string, callback: () => Promise<void>) => { update = callback },
    effect: (callback: () => () => Promise<void>) => { cleanup = callback() },
  } as unknown as Context
  return { ctx, config, values, dispose, plugin, notice, update: () => update!(), cleanup: () => cleanup!() }
}

describe('default-on tmux location context lifecycle', () => {
  it('stays unmounted outside POSIX tmux panes even when enabled by default', async () => {
    const outsideTmux = harness()
    await apply(outsideTmux.ctx, outsideTmux.config, { platform: 'linux', env: {} })
    expect(outsideTmux.plugin).not.toHaveBeenCalled()
    await outsideTmux.cleanup()

    const win32Pane = harness()
    await apply(win32Pane.ctx, win32Pane.config, { platform: 'win32', env: { TMUX_PANE: '%1' } })
    expect(win32Pane.plugin).not.toHaveBeenCalled()
    await win32Pane.cleanup()
  })

  it('mounts inside a POSIX tmux pane by default and disposes before remounting or turning off', async () => {
    const h = harness()
    await apply(h.ctx, h.config, { platform: 'linux', env: { TMUX_PANE: '%1' } })
    expect(h.plugin).toHaveBeenCalledTimes(1)
    expect(h.plugin).toHaveBeenLastCalledWith(tmuxContext, {})

    // Identical volatile values do not remount.
    await h.update()
    expect(h.plugin).toHaveBeenCalledTimes(1)

    h.values.refreshIntervalMs = 30_000
    await h.update()
    expect(h.dispose).toHaveBeenCalledTimes(1)
    expect(h.plugin).toHaveBeenCalledTimes(2)
    expect(h.plugin).toHaveBeenLastCalledWith(tmuxContext, { refreshIntervalMs: 30_000 })
    expect(h.dispose.mock.invocationCallOrder[0]).toBeLessThan(h.plugin.mock.invocationCallOrder[1]!)

    h.values.enabled = false
    await h.update()
    expect(h.dispose).toHaveBeenCalledTimes(2)
    await h.cleanup()
  })

  it('rejects invalid intervals cleanly and works without a TUI service in headless mode', async () => {
    const h = harness(true)
    h.values.enabled = true
    h.values.refreshIntervalMs = -1
    await apply(h.ctx, h.config, { platform: 'linux', env: { TMUX_PANE: '%1' } })
    expect(h.plugin).not.toHaveBeenCalled()
    expect(h.notice).toHaveBeenCalledWith(
      expect.stringContaining('Tmux location context is disabled: Minimum refresh interval must be a non-negative integer.'),
      { level: 'error' },
    )
    await h.cleanup()

    const headless = harness(false)
    headless.values.enabled = true
    headless.values.refreshIntervalMs = 5_000
    await apply(headless.ctx, headless.config, { platform: 'linux', env: { TMUX_PANE: '%1' } })
    expect(headless.plugin).toHaveBeenCalledWith(tmuxContext, { refreshIntervalMs: 5_000 })
    await headless.cleanup()
    expect(headless.dispose).toHaveBeenCalledOnce()
  })

  it('defaults to enabled and validates non-negative integer refreshIntervalMs in its schema', () => {
    const parsed = Config({})
    expect(parsed.enabled.get()).toBe(true)
    expect(parsed.refreshIntervalMs.get()).toBe(0)
    expect(() => Config({ refreshIntervalMs: -5 })).toThrow()
    expect(() => Config({ refreshIntervalMs: 1.5 })).toThrow()
  })
})
