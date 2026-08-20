import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import {
  anchorPathSpec,
  incompatiblePeerMessage,
  PLUGIN_USAGE,
  rangeAccepts,
  reconcilePlugins,
  resolveFilesystemSpec,
  runPlugin,
} from './plugin.ts'
import { PRODUCT_BUNDLE, PROFILE_NAME } from './profile.ts'

const roots: string[] = []

function temp(name: string): string {
  const path = mkdtempSync(join(tmpdir(), name))
  roots.push(path)
  return path
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

function writePackage(dir: string, manifest: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n')
}

function profileManifest(dir: string): { dependencies?: Record<string, string>; dsh?: { profile?: { bundles?: string[] } } } {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
  }
}

function installFake(
  profileDir: string,
  name: string,
  manifest: Record<string, unknown>,
): void {
  writePackage(join(profileDir, 'node_modules', name), manifest)
}

describe('plugin version ranges', () => {
  it('accepts the shipped prerelease against a matching caret', () => {
    expect(rangeAccepts('^0.1.0-rc.8', '0.1.0-rc.8')).toBe(true)
    expect(rangeAccepts('0.1.0-rc.8', '0.1.0-rc.8')).toBe(true)
    expect(rangeAccepts('^0.1.0', '0.1.0-rc.8')).toBe(false)
    expect(rangeAccepts('^1.0.0', '0.1.0-rc.8')).toBe(false)
    expect(rangeAccepts('workspace:^', '0.5.1')).toBe(true)
  })
})

describe('omdsh plugin', () => {
  it('prints usage when invoked without pnpm arguments', () => {
    const lines: string[] = []
    expect(runPlugin([], { write: line => { lines.push(line) } })).toBe(0)
    expect(lines.join('')).toContain(PLUGIN_USAGE)
  })

  it('anchors relative filesystem specs to the invoking directory', () => {
    expect(anchorPathSpec('.', '/tmp/plugin-src')).toBe('/tmp/plugin-src')
    expect(anchorPathSpec('file:../plugin', '/tmp/checkout')).toBe('file:/tmp/plugin')
    expect(anchorPathSpec('@scope/dsh-example', '/tmp/checkout')).toBe('@scope/dsh-example')
  })

  it('walks parent directories for a missing ./path and fails when nothing exists', () => {
    const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
    const example = join(repoRoot, 'examples', 'hello')
    const fromApp = resolveFilesystemSpec('./examples/hello', join(repoRoot, 'apps', 'omdsh'))
    expect(fromApp.resolved).toBe(example)
    expect(fromApp.relocated?.to).toBe(example)
    expect(resolveFilesystemSpec('./examples/hello', repoRoot).resolved).toBe(example)
    expect(resolveFilesystemSpec('./no-such-plugin', repoRoot).missing).toMatch(/no-such-plugin$/u)
    expect(resolveFilesystemSpec('../missing-plugin', join(repoRoot, 'apps', 'omdsh')).missing)
      .toBe(join(repoRoot, 'apps', 'missing-plugin'))
  })

  it('forwards the checkout example when add runs from apps/omdsh', () => {
    const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
    const home = temp('omdsh-plugin-from-app-')
    const lines: string[] = []
    const forwarded: string[] = []
    expect(runPlugin(['add', './examples/hello'], {
      cwd: join(repoRoot, 'apps', 'omdsh'),
      environment: { OMDSH_HOME: home },
      write: line => { lines.push(line) },
      runPnpm: (args, cwd) => {
        forwarded.push(...args)
        const current = profileManifest(cwd)
        writePackage(cwd, {
          ...current,
          dependencies: { '@agi-fans/omdsh-plugin-hello': `link:${join(repoRoot, 'examples', 'hello')}` },
        })
        installFake(cwd, '@agi-fans/omdsh-plugin-hello', JSON.parse(
          readFileSync(join(repoRoot, 'examples', 'hello', 'package.json'), 'utf8'),
        ) as Record<string, unknown>)
        return { status: 0 }
      },
    })).toBe(0)
    expect(forwarded).toEqual(['add', join(repoRoot, 'examples', 'hello')])
    expect(lines.join('')).toContain('is missing; using')
    expect(profileManifest(resolveProfileDir(PROFILE_NAME, home)).dsh?.profile?.bundles)
      .toEqual([PRODUCT_BUNDLE, '@agi-fans/omdsh-plugin-hello'])
  })

  it('rejects a missing filesystem spec before calling pnpm', () => {
    const home = temp('omdsh-plugin-missing-')
    const calls: string[][] = []
    const lines: string[] = []
    expect(runPlugin(['add', './no-such-plugin'], {
      cwd: temp('omdsh-plugin-missing-cwd-'),
      environment: { OMDSH_HOME: home },
      write: line => { lines.push(line) },
      runPnpm: (args) => {
        calls.push([...args])
        return { status: 0 }
      },
    })).toBe(2)
    expect(calls).toEqual([])
    expect(lines.join('')).toContain('does not exist')
    expect(existsSync(join(resolveProfileDir(PROFILE_NAME, home), 'package.json'))).toBe(false)
  })

  it('initializes the profile, installs a bundle, and leaves the product layer first', () => {
    const home = temp('omdsh-plugin-add-')
    const dir = resolveProfileDir(PROFILE_NAME, home)
    const lines: string[] = []
    const code = runPlugin(['add', '@scope/dsh-example'], {
      environment: { OMDSH_HOME: home },
      write: line => { lines.push(line) },
      runPnpm: (args, cwd) => {
        expect(args).toEqual(['add', '@scope/dsh-example'])
        expect(cwd).toBe(dir)
        const current = profileManifest(cwd)
        writePackage(cwd, {
          ...current,
          dependencies: { '@scope/dsh-example': '1.0.0' },
        })
        installFake(cwd, '@scope/dsh-example', {
          name: '@scope/dsh-example',
          dsh: { bundle: { patch: './cordis.patch.yml' } },
        })
        return { status: 0 }
      },
    })
    expect(code).toBe(0)
    expect(lines.join('')).toContain(`initialized profile ${PROFILE_NAME}`)
    expect(profileManifest(dir).dsh?.profile?.bundles).toEqual([PRODUCT_BUNDLE, '@scope/dsh-example'])
  })

  it('installs a plain library without adding it as a layer', () => {
    const home = temp('omdsh-plugin-lib-')
    const dir = resolveProfileDir(PROFILE_NAME, home)
    const lines: string[] = []
    expect(runPlugin(['add', 'left-pad'], {
      environment: { OMDSH_HOME: home },
      write: line => { lines.push(line) },
      runPnpm: (_args, cwd) => {
        const current = profileManifest(cwd)
        writePackage(cwd, {
          ...current,
          dependencies: { 'left-pad': '1.0.0' },
        })
        installFake(cwd, 'left-pad', { name: 'left-pad', version: '1.0.0' })
        return { status: 0 }
      },
    })).toBe(0)
    expect(lines.join('')).toContain('declares no dsh.bundle')
    expect(profileManifest(dir).dsh?.profile?.bundles).toEqual([PRODUCT_BUNDLE])
  })

  it('removes a user bundle and keeps the product bundle', () => {
    const home = temp('omdsh-plugin-remove-')
    const dir = resolveProfileDir(PROFILE_NAME, home)
    runPlugin(['add', '@scope/dsh-example'], {
      environment: { OMDSH_HOME: home },
      write: () => undefined,
      runPnpm: (_args, cwd) => {
        const current = profileManifest(cwd)
        writePackage(cwd, {
          ...current,
          dependencies: { '@scope/dsh-example': '1.0.0' },
        })
        installFake(cwd, '@scope/dsh-example', {
          name: '@scope/dsh-example',
          dsh: { bundle: { patch: './cordis.patch.yml' } },
        })
        return { status: 0 }
      },
    })
    expect(runPlugin(['remove', '@scope/dsh-example'], {
      environment: { OMDSH_HOME: home },
      write: () => undefined,
      runPnpm: (_args, cwd) => {
        const current = profileManifest(cwd)
        writePackage(cwd, {
          ...current,
          dependencies: {},
        })
        return { status: 0 }
      },
    })).toBe(0)
    expect(profileManifest(dir).dsh?.profile?.bundles).toEqual([PRODUCT_BUNDLE])
  })

  it('rejects an incompatible DSH peer and rolls back a failed add', () => {
    const home = temp('omdsh-plugin-peer-')
    const dir = resolveProfileDir(PROFILE_NAME, home)
    const lines: string[] = []
    const verbs: string[][] = []
    expect(runPlugin(['add', '@scope/old-bundle'], {
      environment: { OMDSH_HOME: home },
      write: line => { lines.push(line) },
      runPnpm: (args, cwd) => {
        verbs.push([...args])
        if (args[0] === 'add') {
          const current = profileManifest(cwd)
          writePackage(cwd, {
            ...current,
            dependencies: { '@scope/old-bundle': '1.0.0' },
          })
          installFake(cwd, '@scope/old-bundle', {
            name: '@scope/old-bundle',
            peerDependencies: { '@deepseek-ai/dsh-agent': '^0.0.1' },
            dsh: { bundle: { patch: './cordis.patch.yml' } },
          })
        } else if (args[0] === 'remove') {
          const current = profileManifest(cwd)
          writePackage(cwd, { ...current, dependencies: {} })
        }
        return { status: 0 }
      },
    })).toBe(1)
    expect(lines.join('')).toMatch(/peer @deepseek-ai\/dsh-agent/u)
    expect(verbs).toEqual([['add', '@scope/old-bundle'], ['remove', '@scope/old-bundle']])
    expect(profileManifest(dir).dependencies ?? {}).toEqual({})
    expect(profileManifest(dir).dsh?.profile?.bundles).toEqual([PRODUCT_BUNDLE])
  })

  it('prints usage from the bin without starting a session', () => {
    const appRoot = fileURLToPath(new URL('..', import.meta.url))
    const result = spawnSync('pnpm', ['exec', 'tsx', 'src/bin.ts', 'plugin'], {
      cwd: appRoot,
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(result.status).toBe(0)
    expect(result.stderr + result.stdout).toContain('omdsh plugin add')
    expect(result.stdout).not.toContain('Into the Unknown')
  })

  it('reports a missing pnpm as exit 127', () => {
    const home = temp('omdsh-plugin-pnpm-')
    const error = Object.assign(new Error('not found'), { code: 'ENOENT' })
    const lines: string[] = []
    expect(runPlugin(['add', '@scope/x'], {
      environment: { OMDSH_HOME: home },
      write: line => { lines.push(line) },
      runPnpm: () => ({ status: null, error }),
    })).toBe(127)
    expect(lines.join('')).toContain('pnpm not found')
  })

  it('does not treat the product bundle as a removable dependency', () => {
    const home = temp('omdsh-plugin-product-')
    const dir = resolveProfileDir(PROFILE_NAME, home)
    runPlugin(['add', '@scope/dsh-example'], {
      environment: { OMDSH_HOME: home },
      write: () => undefined,
      runPnpm: (_args, cwd) => {
        const current = profileManifest(cwd)
        writePackage(cwd, {
          ...current,
          dependencies: { '@scope/dsh-example': '1.0.0' },
        })
        installFake(cwd, '@scope/dsh-example', {
          name: '@scope/dsh-example',
          dsh: { bundle: { patch: './cordis.patch.yml' } },
        })
        return { status: 0 }
      },
    })
    const before = profileManifest(dir)
    reconcilePlugins(before, dir)
    expect(profileManifest(dir).dsh?.profile?.bundles?.[0]).toBe(PRODUCT_BUNDLE)
  })

  it('detects a nested core dependency against a fake install anchor', () => {
    const home = temp('omdsh-plugin-nested-')
    const dir = resolveProfileDir(PROFILE_NAME, home)
    const anchor = join(temp('omdsh-plugin-anchor-'), 'package.json')
    writePackage(join(anchor, '..'), {
      name: '@agi-fans/oh-my-dsh',
      dependencies: { '@deepseek-ai/dsh-agent': '0.1.0-rc.8' },
    })
    writePackage(dir, {
      name: 'dsh-profile-omdsh',
      dependencies: { '@scope/nested': '1.0.0' },
      dsh: { profile: { bundles: [PRODUCT_BUNDLE] } },
    })
    installFake(dir, '@scope/nested', {
      name: '@scope/nested',
      dependencies: { '@deepseek-ai/dsh-agent': '0.0.1' },
    })
    expect(incompatiblePeerMessage(dir, anchor)).toMatch(/would nest a copy/u)
  })
})
