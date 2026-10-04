/** Opt-in command-hook bridge with one configuration owner and awaited replacement. */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import * as codex from '@deepseek-ai/dsh-hooks-codex'
import * as claude from '@deepseek-ai/dsh-hooks-claude-code'
import z from '@deepseek-ai/schemastery'

export const name = 'omdsh-hook-settings'
export const inject = ['tui', 'agents']
export interface Config {
  bridge: Volatile<'off' | 'codex' | 'claude-code'>
  configPath: Volatile<string>
}
export const Config = z.object({
  bridge: z.union(['off', 'codex', 'claude-code']).default('off').description('Command-hook compatibility bridge; off disables hook execution.').volatile(),
  configPath: z.string().default('').description('Path to hooks.json or Claude settings.json; empty uses the selected bridge’s project default.').volatile(),
})

export function apply(ctx: Context, config: Config): Promise<void> {
  let child: { dispose(): Promise<unknown> } | undefined
  let key: string | undefined
  let disposed = false
  let pending: Promise<void> = Promise.resolve()
  const update = (): Promise<void> => {
    const bridge = config.bridge.get()
    const path = resolve(config.configPath.get() || (bridge === 'codex' ? '.codex/hooks.json' : '.claude/settings.json'))
    const nextKey = `${bridge}:${path}`
    pending = pending.then(async () => {
      if (disposed || key === nextKey) return
      // Disable the previous interception chain before publishing a replacement.
      await child?.dispose()
      child = undefined
      key = undefined
      if (disposed) return
      if (bridge === 'off') { key = nextKey; return }
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Hook configuration must be a JSON object.')
      const hooks = (parsed as Record<string, unknown>)['hooks'] ?? parsed
      if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) throw new Error('The hooks section must be a JSON object.')
      if (disposed) return
      child = bridge === 'codex' ? await ctx.plugin(codex, { configPath: path }) : await ctx.plugin(claude, { configPath: path })
      key = nextKey
      if (!disposed) ctx.tui.notice(`${bridge} command hooks enabled from ${path}. Existing sessions do not replay SessionStart hooks.`)
    }).catch(error => {
      if (!disposed) ctx.tui.notice(`Command hooks are disabled: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' })
    })
    return pending
  }
  ctx.on('loader/volatile-update', () => update())
  ctx.effect(() => async () => { disposed = true; await pending; await child?.dispose() })
  return update()
}
