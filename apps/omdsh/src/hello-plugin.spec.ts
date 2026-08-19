import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { dumpOmdshConfig } from './composition.ts'
import { runPlugin } from './plugin.ts'
import { PRODUCT_BUNDLE, PROFILE_NAME } from './profile.ts'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const exampleDir = join(repoRoot, 'examples', 'hello')
const exampleName = '@agi-fans/omdsh-plugin-hello'
const appDir = fileURLToPath(new URL('..', import.meta.url))
const appManifest = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
}

const roots: string[] = []

function temp(name: string): string {
  const path = mkdtempSync(join(tmpdir(), name))
  roots.push(path)
  return path
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('examples/hello bundle', () => {
  it('registers /hello on the host command registry', async () => {
    const hello = await import(pathToFileURL(join(exampleDir, 'index.js')).href) as {
      apply: (ctx: Context) => void
    }
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const fiber = await ctx.plugin(hello)
    const session = ctx.sessions.create(SessionId('hello-plugin-test'))
    const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
    expect(ctx.commands.list(agent).map(command => command.name)).toContain('hello')
    expect(ctx.commands.list(agent).find(command => command.name === 'hello')?.description)
      .toBe('Confirm the example omdsh plugin is mounted')
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('installs through omdsh plugin add and appears in the dump', () => {
    const home = temp('omdsh-hello-add-')
    const lines: string[] = []
    const code = runPlugin(['add', './examples/hello'], {
      cwd: repoRoot,
      environment: { ...process.env, OMDSH_HOME: home },
      write: line => { lines.push(line) },
    })
    const dir = resolveProfileDir(PROFILE_NAME, home)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    const dump = dumpOmdshConfig(temp('omdsh-hello-dump-cwd-'), { OMDSH_HOME: home })
    expect(code, lines.join('')).toBe(0)
    expect(manifest.dsh?.profile?.bundles).toEqual([PRODUCT_BUNDLE, exampleName])
    expect(manifest.dependencies?.[exampleName]).toMatch(/examples\/hello/u)
    expect(dump).toContain(exampleName)
    expect(dump).toContain('id: omdsh-hello')
  }, 60_000)

  it('prints the example layer from the bin after a real add', () => {
    const home = temp('omdsh-hello-bin-')
    const added = runPlugin(['add', exampleDir], {
      cwd: repoRoot,
      environment: { ...process.env, OMDSH_HOME: home },
      write: () => undefined,
    })
    expect(added).toBe(0)
    const result = spawnSync('pnpm', ['exec', 'tsx', 'src/bin.ts', '--dump-config'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      env: { ...process.env, OMDSH_HOME: home },
      timeout: 30_000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(exampleName)
    expect(result.stdout).toContain('id: omdsh-hello')
    expect(result.stdout).not.toContain('Into the Unknown')
  }, 60_000)

  it('ships the Loader runtime required to resolve Profile-installed bundles', () => {
    expect(appManifest.dependencies?.['node-addon-require-builtin']).toBe('0.1.4')
  })

  it('boots a Profile-installed command from the packed application', () => {
    const packDir = temp('omdsh-hello-pack-')
    const installDir = temp('omdsh-hello-install-')
    const home = temp('omdsh-hello-packed-home-')
    const packed = spawnSync('pnpm', ['pack', '--pack-destination', packDir], {
      cwd: appDir,
      encoding: 'utf8',
      timeout: 60_000,
    })
    expect(packed.status, packed.stderr + packed.stdout).toBe(0)
    const archive = join(packDir, basename(packed.stdout.trim().split('\n').at(-1) ?? ''))
    const installed = spawnSync('npm', ['install', '--prefix', installDir, archive], {
      encoding: 'utf8',
      timeout: 180_000,
    })
    expect(installed.status, installed.stderr + installed.stdout).toBe(0)
    const bin = join(installDir, 'node_modules', '.bin', 'omdsh')
    const added = spawnSync(bin, ['plugin', 'add', exampleDir], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, OMDSH_HOME: home },
      timeout: 60_000,
    })
    expect(added.status, added.stderr + added.stdout).toBe(0)
    const launched = spawnSync(bin, [], {
      cwd: repoRoot,
      input: '/hello\n',
      encoding: 'utf8',
      env: { ...process.env, OMDSH_HOME: home },
      timeout: 60_000,
    })
    expect(launched.status, launched.stderr + launched.stdout).toBe(0)
    expect(launched.stdout).toContain('Hello from @agi-fans/omdsh-plugin-hello.')
  }, 300_000)
})
