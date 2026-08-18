import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROFILE_PATCH_FILENAME } from '@deepseek-ai/dsh-app-boot'
import {
  composeLaunch,
  ensureOmdshProfile,
  ensureProductBundleFirst,
  prepareProfile,
  PRODUCT_BUNDLE,
  PROFILE_NAME,
  PROFILE_ROOT_FILENAME,
  SHIPPED_PRESET_ROOT,
} from './profile.ts'

const roots: string[] = []

function temp(name: string): string {
  const path = mkdtempSync(join(tmpdir(), name))
  roots.push(path)
  return path
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('omdsh profile', () => {
  it('initializes the omdsh profile with the product bundle first', () => {
    const home = temp('omdsh-profile-init-')
    const dir = ensureOmdshProfile(home)
    expect(dir).toBe(join(home, 'profiles', PROFILE_NAME))
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(manifest.dsh?.profile?.bundles).toEqual([PRODUCT_BUNDLE])
    expect(existsSync(join(dir, PROFILE_PATCH_FILENAME))).toBe(true)
  })

  it('restores a dropped product bundle without reordering user layers', () => {
    const home = temp('omdsh-profile-heal-')
    const dir = ensureOmdshProfile(home)
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-omdsh',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ['@scope/extra'] } },
    }, undefined, 2) + '\n')
    ensureProductBundleFirst(dir)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(manifest.dsh?.profile?.bundles).toEqual([PRODUCT_BUNDLE, '@scope/extra'])
  })

  it('rewrites the empty profile root and overlays shipped agent presets', () => {
    const home = temp('omdsh-profile-root-')
    const profile = prepareProfile(home)
    expect(readFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), 'utf8')).toMatch(/^# omdsh profile root/u)
    expect(readFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), 'utf8')).toMatch(/\n\[\]\n$/u)
    const composed = composeLaunch(temp('omdsh-profile-cwd-'), { OMDSH_HOME: home })
    const overlay = composed.layers.find(layer => layer.label === 'agent-presets')
    expect(overlay?.patches).toEqual([
      expect.objectContaining({
        id: 'agent-presets',
        config: expect.objectContaining({
          roots: [{ path: SHIPPED_PRESET_ROOT, trust: 'system' }],
        }),
      }),
    ])
  })

  it('loads a user bundle layer after the product bundle', () => {
    const home = temp('omdsh-profile-user-')
    const dir = ensureOmdshProfile(home)
    const bundleDir = join(dir, 'node_modules', '@scope', 'dsh-example')
    mkdirSync(bundleDir, { recursive: true })
    writeFileSync(join(bundleDir, 'package.json'), JSON.stringify({
      name: '@scope/dsh-example',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, undefined, 2) + '\n')
    writeFileSync(join(bundleDir, 'cordis.patch.yml'), '- insert:\n    - id: example\n      name: \'@scope/dsh-example\'\n')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-omdsh',
      private: true,
      dependencies: { '@scope/dsh-example': '1.0.0' },
      dsh: { profile: { bundles: [PRODUCT_BUNDLE, '@scope/dsh-example'] } },
    }, undefined, 2) + '\n')
    const composed = composeLaunch(temp('omdsh-profile-user-cwd-'), { OMDSH_HOME: home })
    expect(composed.layers.map(layer => layer.label).slice(0, 2)).toEqual([PRODUCT_BUNDLE, '@scope/dsh-example'])
    expect(composed.patches).toEqual(expect.arrayContaining([
      expect.objectContaining({ insert: [expect.objectContaining({ id: 'example', name: '@scope/dsh-example' })] }),
    ]))
  })

  it('places the profile under OMDSH_HOME rather than DSH_HOME', () => {
    const omdsh = temp('omdsh-profile-omdsh-')
    const dsh = temp('omdsh-profile-dsh-')
    const dir = ensureOmdshProfile(omdsh)
    expect(dir.startsWith(omdsh)).toBe(true)
    expect(existsSync(join(dsh, 'profiles', PROFILE_NAME, 'package.json'))).toBe(false)
    mkdirSync(join(dsh, 'profiles', PROFILE_NAME), { recursive: true })
    expect(composeLaunch(temp('omdsh-profile-home-cwd-'), {
      OMDSH_HOME: omdsh,
      DSH_HOME: dsh,
    }).profile.dir).toBe(dir)
  })
})
