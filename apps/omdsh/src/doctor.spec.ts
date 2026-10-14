import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { executableAvailable, formatDoctorReport, runDoctor, type DoctorOptions } from './doctor.ts'
import { INSTALL_ANCHOR, PRODUCT_BUNDLE } from './profile.ts'

const roots: string[] = []
function fixture(): { cwd: string; home: string; options: DoctorOptions } {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-doctor-'))
  roots.push(root)
  const cwd = join(root, 'workspace'), home = join(root, 'home')
  mkdirSync(cwd); mkdirSync(home)
  return { cwd, home, options: { version: '0.20.0', cwd, environment: { OMDSH_HOME: home, PATH: process.env.PATH }, tty: false } }
}

function snapshot(dir: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) Object.assign(result, snapshot(path))
    else if (entry.isFile()) result[path] = `${statSync(path).mode}:${readFileSync(path).toString('base64')}`
  }
  return result
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('doctor', () => {
  it('inspects shipped defaults without initializing a missing Profile or contacting services', async () => {
    const { home, options } = fixture()
    const report = await runDoctor(options)
    expect(report.schemaVersion).toBe(1)
    expect(report.checks.find(check => check.id === 'profile')?.status).toBe('not-configured')
    expect(report.checks.find(check => check.id === 'bundle:0')?.status).toBe('ok')
    expect(report.checks.filter(check => check.id.startsWith('plugin:')).length).toBeGreaterThan(20)
    expect(report.checks.filter(check => check.status === 'failed')).toEqual([])
    expect(report.checks.find(check => check.id === 'model-auth')?.status).toBe('not-checked')
    expect(report.checks.find(check => check.id === 'terminal-capabilities')?.status).toBe('not-checked')
    expect(existsSync(join(home, 'profiles'))).toBe(false)
  })

  it('continues independent checks after malformed layers and never prints their payloads', async () => {
    const { cwd, home, options } = fixture()
    const secret = 'private-key-should-never-appear'
    mkdirSync(join(cwd, '.dsh'))
    writeFileSync(join(cwd, '.dsh', 'mcp.json'), `{${secret}`)
    writeFileSync(join(home, 'lsp.json'), `{${secret}`)
    const dir = join(home, 'profiles', 'omdsh'); mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), `{${secret}`)
    writeFileSync(join(home, 'cordis.patch.yml'), `- insert: [${secret}`)
    writeFileSync(join(home, '.credentials.yaml'), `version: 1\nrefs:\n  DEEPSEEK_API_KEY: ${secret}\n`, { mode: 0o600 })
    options.environment!.DEEPSEEK_API_KEY = secret
    const before = snapshot(home)
    const report = await runDoctor(options)
    expect(report.checks.find(check => check.id === 'mcp-config')?.status).toBe('failed')
    expect(report.checks.find(check => check.id === 'lsp-config')?.status).toBe('failed')
    expect(report.checks.find(check => check.id === 'home-patch')?.status).toBe('failed')
    expect(report.checks.find(check => check.id === 'profile')?.status).toBe('failed')
    expect(report.checks.find(check => check.id === 'composition-coverage')?.status).toBe('not-checked')
    expect(report.checks.find(check => check.id === 'deepseek-env')?.status).toBe('ok')
    expect(JSON.stringify(report) + formatDoctorReport(report)).not.toContain(secret)
    expect(snapshot(home)).toEqual(before)
  })

  it('resolves Profile plugins without executing their JavaScript or rewriting retired bundle selections', async () => {
    const { home, options } = fixture()
    const dir = join(home, 'profiles', 'omdsh'), plugin = join(dir, 'node_modules', 'doctor-fixture')
    mkdirSync(plugin, { recursive: true })
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: 'doctor-fixture', version: '1.0.0', type: 'module', exports: './index.js' }))
    writeFileSync(join(plugin, 'index.js'), 'throw new Error("Doctor must never import a configured plugin")')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'doctor-fixture': '1.0.0' }, dsh: { profile: { bundles: [PRODUCT_BUNDLE, '@deepseek-ai/dsh-bundle-reasoning-translate'] } } }))
    writeFileSync(join(dir, 'cordis.patch.yml'), '- insert:\n  - id: doctor-fixture\n    name: doctor-fixture\n')
    const before = snapshot(home)
    const report = await runDoctor(options)
    expect(report.checks.find(check => check.summary.startsWith('doctor-fixture:'))?.status).toBe('ok')
    expect(report.checks.find(check => check.id === 'bundle:1')?.status).toBe('failed')
    expect(snapshot(home)).toEqual(before)
  })

  it('distinguishes missing commands from valid server configuration and unchecked connections', async () => {
    const { home, options } = fixture()
    writeFileSync(join(home, 'mcp.json'), JSON.stringify({ mcpServers: {
      local: { command: 'definitely-missing-omdsh-doctor-server', env: { SECRET: 'hidden' } },
      remote: { url: 'https://localhost.invalid/?token=hidden' },
    } }))
    writeFileSync(join(home, 'lsp.json'), JSON.stringify({ servers: { ts: { command: 'definitely-missing-omdsh-doctor-lsp', extensionToLanguage: { '.ts': 'typescript' } } } }))
    const report = await runDoctor(options)
    expect(report.checks.find(check => check.id === 'mcp-config')?.status).toBe('ok')
    expect(report.checks.find(check => check.id === 'lsp-config')?.status).toBe('ok')
    expect(report.checks.filter(check => /^(mcp|lsp):.*:executable$/u.test(check.id)).map(check => check.status).sort()).toEqual(['failed', 'failed', 'not-checked'])
    expect(report.checks.filter(check => check.id.endsWith(':connection')).every(check => check.status === 'not-checked')).toBe(true)
    expect(JSON.stringify(report)).not.toContain('hidden')
  })

  it('does not inspect disabled credential stores or treat dynamic server environments as executable lookup failures', async () => {
    const { home, options } = fixture()
    const dir = join(home, 'profiles', 'omdsh'); mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: [PRODUCT_BUNDLE] } } }))
    writeFileSync(join(dir, 'cordis.patch.yml'), '- id: credentials\n  disabled: true\n- insert:\n  - id: dynamic-mcp\n    name: "@deepseek-ai/dsh-mcp-client"\n    config:\n      command: node\n      env:\n        PATH: !!js process.env.PATH\n')
    writeFileSync(join(home, '.credentials.yaml'), 'invalid and must not be read')
    const report = await runDoctor(options)
    expect(report.checks.find(check => check.id === 'credentials')?.status).toBe('not-configured')
    expect(report.checks.filter(check => check.id.endsWith(':executable')).map(check => check.status)).toEqual(['not-checked'])
    expect(report.checks.filter(check => check.status === 'failed')).toEqual([])
  })

  it.each(['22.18.0', '23.9.0', '20.20.0'])('rejects unsupported Node %s', async nodeVersion => {
    const { options } = fixture()
    expect((await runDoctor({ ...options, nodeVersion })).checks.find(check => check.id === 'node')?.status).toBe('failed')
  })

  it('reports unsupported terminal capabilities without emitting control sequences', async () => {
    const { options } = fixture()
    const output = formatDoctorReport(await runDoctor({ ...options, tty: true }))
    expect(output).toContain('[ok] terminal:')
    expect(output).toContain('[not-checked] terminal-capabilities:')
    expect(output).not.toContain('\x1b')
  })

  it('uses Windows PATHEXT lookup without invoking an executable', () => {
    const { cwd } = fixture()
    writeFileSync(join(cwd, 'fixture.exe'), 'not an executable')
    expect(executableAvailable('fixture', cwd, { PATH: cwd, PATHEXT: '.EXE' }, 'win32')).toBe(true)
    expect(executableAvailable('missing', cwd, { PATH: cwd }, 'win32')).toBe(false)
  })

  it.runIf(process.platform !== 'win32')('rejects executable files without POSIX execute permission', () => {
    const { cwd } = fixture()
    const file = join(cwd, 'fixture')
    writeFileSync(file, '#!/bin/sh\nexit 0', { mode: 0o600 })
    expect(executableAvailable('fixture', cwd, { PATH: cwd }, process.platform)).toBe(false)
    chmodSync(file, 0o700)
    expect(executableAvailable('fixture', cwd, { PATH: cwd }, process.platform)).toBe(true)
  })

  it('runs the real CLI with clean JSON, diagnostic exit codes and no Profile writes', () => {
    const { cwd, home } = fixture()
    const env = { ...process.env, OMDSH_HOME: home, DSH_HOME: home }
    const script = join(INSTALL_ANCHOR, '..', 'src', 'bin.ts')
    const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href
    const result = spawnSync(process.execPath, ['--import', loader, script, 'doctor', '--json'], { cwd, env, encoding: 'utf8', timeout: 15_000 })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr + JSON.stringify(JSON.parse(result.stdout).checks.filter((check: { status: string }) => check.status === 'failed'))).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.schemaVersion).toBe(1)
    expect(result.stdout).not.toContain('\x1b')
    expect(existsSync(join(home, 'profiles'))).toBe(false)
    mkdirSync(join(cwd, '.dsh'))
    writeFileSync(join(cwd, '.dsh', 'mcp.json'), '{not json')
    const failed = spawnSync(process.execPath, ['--import', loader, script, 'doctor', '--json'], { cwd, env, encoding: 'utf8', timeout: 15_000 })
    expect(failed.status, failed.stderr).toBe(1)
    expect(JSON.parse(failed.stdout).checks.find((check: { id: string }) => check.id === 'mcp-config').status).toBe('failed')
  })
})
