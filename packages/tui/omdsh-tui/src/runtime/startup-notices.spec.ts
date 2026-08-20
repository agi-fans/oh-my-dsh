import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TuiService } from '../definition.ts'
import * as startupNotices from './startup-notices.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('startup notices plugin', () => {
  it('registers /changelog and presents unseen release notes after session startup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-startup-notices-'))
    roots.push(root)
    const changelogPath = join(root, 'CHANGELOG.md')
    const markerDir = join(root, 'omdsh')
    mkdirSync(markerDir)
    writeFileSync(join(markerDir, 'last-changelog-version'), '0.2.0\n')
    writeFileSync(changelogPath, '# Changelog\n\n## [0.3.0] - 2026-08-16\n\n### Fixed\n\n- Fixed startup.\n')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const notice = vi.fn()
    ctx.provide('tui', { notice } as unknown as TuiService)
    ctx.provide('settings', {
      get: () => ({ checkUpdates: false, startupChangelog: 'summary' }),
    } as never)
    await ctx.plugin(startupNotices, { currentVersion: '0.3.0', changelogPath, dshHome: root })
    const session = ctx.sessions.create(SessionId('startup-notices-test'))
    const agent = { id: session.id, session, status: 'idle' } as unknown as Agent

    await ctx.omdshStartup.afterSessionStart()
    expect(notice).toHaveBeenCalledWith("What's New · v0.3.0\n1 fix · /changelog for details")
    const result = await ctx.commands.execute(agent, '/changelog', [], new AbortController().signal)
    expect(result?.result).toMatchObject({ kind: 'success', text: expect.stringContaining('## [0.3.0]') })

    await ctx.fiber.dispose()
  })

  it('checks npm after startup and presents a non-blocking upgrade command', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-update-notice-'))
    roots.push(root)
    const changelogPath = join(root, 'CHANGELOG.md')
    writeFileSync(changelogPath, '# Changelog\n\n## [0.3.0] - 2026-08-16\n')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: '0.3.1' }), { status: 200 })))
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const notice = vi.fn()
    ctx.provide('tui', { notice } as unknown as TuiService)
    ctx.provide('settings', {
      get: () => ({ checkUpdates: true, startupChangelog: 'summary' }),
    } as never)
    await ctx.plugin(startupNotices, {
      currentVersion: '0.3.0',
      changelogPath,
      dshHome: root,
      packageName: '@agi-fans/oh-my-dsh',
    })

    await ctx.omdshStartup.afterSessionStart()

    expect(notice).toHaveBeenCalledWith(
      'Update available · 0.3.0 → 0.3.1\nnpm install --global @agi-fans/oh-my-dsh@latest',
    )
    await ctx.fiber.dispose()
  })

  it('renders expanded startup notes through the markdown command-output surface', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-expanded-notes-'))
    roots.push(root)
    const changelogPath = join(root, 'CHANGELOG.md')
    const markerDir = join(root, 'omdsh')
    mkdirSync(markerDir)
    writeFileSync(join(markerDir, 'last-changelog-version'), '0.2.0\n')
    writeFileSync(changelogPath, '# Changelog\n\n## [0.3.0] - 2026-08-16\n\n### Added\n\n- Added updates.\n')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const commandOutput = vi.fn()
    ctx.provide('tui', { notice: vi.fn(), commandOutput } as unknown as TuiService)
    ctx.provide('settings', {
      get: () => ({ checkUpdates: false, startupChangelog: 'expanded' }),
    } as never)
    await ctx.plugin(startupNotices, { currentVersion: '0.3.0', changelogPath, dshHome: root })

    await ctx.omdshStartup.afterSessionStart()

    expect(commandOutput).toHaveBeenCalledWith('What\'s New', expect.stringContaining('## [0.3.0]'))
    await ctx.fiber.dispose()
  })
})
