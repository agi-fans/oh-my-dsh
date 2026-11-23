/**
 * Real composition: the first-run readiness signal is false only when the
 * mounted credential and settings seams both report no configured route.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanupOverlayDir, materializeOverlayPaths, reportOverlayCleanupFailure } from './boot.ts'

const app = fileURLToPath(new URL('../', import.meta.url))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function readiness(withKey: boolean): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-first-run-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  mkdirSync(workspace)
  mkdirSync(join(root, 'profiles', 'omdsh'), { recursive: true })
  const script = join(root, 'ready.mjs')
  writeFileSync(script, `
    import { createRequire } from 'node:module'
    import { pathToFileURL } from 'node:url'
    const require = createRequire(${JSON.stringify(join(app, 'package.json'))})
    const { mountOmdsh } = await import(${JSON.stringify(pathToFileURL(join(app, 'src/boot.ts')).href)})
    const { modelRouteReady } = await import(${JSON.stringify(pathToFileURL(join(app, '../../packages/tui/omdsh-tui/src/session/model-readiness.ts')).href)})
    const ctx = await mountOmdsh({ args: [], mode: 'exec', exit: () => {} })
    try {
      console.log('READY:' + String(await modelRouteReady(ctx)))
    } finally {
      await ctx.fiber.dispose().catch(() => {})
    }
  `)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OMDSH_HOME: root,
    NO_COLOR: '1',
    NODE_PATH: fileURLToPath(new URL('../../../node_modules/.pnpm/node_modules', import.meta.url)),
  }
  delete env.DEEPSEEK_API_KEY
  if (withKey) env.DEEPSEEK_API_KEY = 'sk-first-run'
  const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, script], {
    cwd: workspace,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', chunk => { out += String(chunk) })
  child.stderr.on('data', chunk => { out += String(chunk) })
  const status = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`first-run probe timed out\n${out.slice(-3000)}`)) }, 60_000)
    child.on('error', reject)
    child.on('close', code => { clearTimeout(timer); resolve(code) })
  })
  expect(status, out.slice(-3000)).toBe(0)
  return out
}

describe('first-run model readiness', () => {
  it('reports an unconfigured fresh home', async () => {
    expect(await readiness(false)).toContain('READY:false')
  }, 90_000)

  it('accepts an environment key', async () => {
    expect(await readiness(true)).toContain('READY:true')
  }, 90_000)

  it('materializes runtime overlayPaths for ProfileContext and cleans them on disposal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-overlay-paths-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    mkdirSync(join(workspace, '.dsh'), { recursive: true })
    mkdirSync(join(root, 'profiles', 'omdsh'), { recursive: true })
    writeFileSync(join(workspace, '.dsh', 'mcp.json'), JSON.stringify({
      mcpServers: { probe: { command: 'node', args: ['-e', ''] } },
    }))
    const script = join(root, 'overlays.mjs')
    writeFileSync(script, `
      import { existsSync } from 'node:fs'
      import { createRequire } from 'node:module'
      import { dirname } from 'node:path'
      import { pathToFileURL } from 'node:url'
      const require = createRequire(${JSON.stringify(join(app, 'package.json'))})
      const { readProfilePatches } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
      const { mountOmdsh } = await import(${JSON.stringify(pathToFileURL(join(app, 'src/boot.ts')).href)})
      const ctx = await mountOmdsh({ args: [], mode: 'exec', exit: () => {} })
      const profile = ctx.get('profileContext')
      const overlayPaths = profile?.overlayPaths ?? []
      const replayed = readProfilePatches('omdsh', profile)
      const existsDuring = overlayPaths.every(file => existsSync(file))
      const overlayDir = overlayPaths[0] ? dirname(overlayPaths[0]) : ''
      await ctx.fiber.dispose()
      const existsAfter = overlayDir ? existsSync(overlayDir) : false
      console.log(JSON.stringify({ count: overlayPaths.length, existsDuring, existsAfter, hasMcp: JSON.stringify(replayed).includes('mcp-probe') }))
    `)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OMDSH_HOME: root,
      NO_COLOR: '1',
      NODE_PATH: fileURLToPath(new URL('../../../node_modules/.pnpm/node_modules', import.meta.url)),
    }
    const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, script], {
      cwd: workspace,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', chunk => { out += String(chunk) })
    child.stderr.on('data', chunk => { out += String(chunk) })
    const status = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`overlayPaths probe timed out\n${out.slice(-3000)}`)) }, 60_000)
      child.on('error', reject)
      child.on('close', code => { clearTimeout(timer); resolve(code) })
    })
    expect(status, out.slice(-3000)).toBe(0)
    const line = out.trim().split('\n').at(-1) ?? ''
    expect(JSON.parse(line)).toEqual({ count: 1, existsDuring: true, existsAfter: false, hasMcp: true })
  }, 90_000)

  it('cleans up temporary overlay directories on write failure without masking the original error and retries failed cleanup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omdsh-overlay-unit-'))
    roots.push(dir)
    const rm = vi.fn(() => { rmSync(dir, { recursive: true, force: true }) })
    expect(() => materializeOverlayPaths([{ id: 'tui', disabled: true }] as never[], {
      mkdtempSync: () => dir,
      writeFileSync: () => { throw new Error('ENOSPC: no space left on device') },
      rmSync: rm,
    })).toThrow(/ENOSPC/u)
    expect(rm).toHaveBeenCalledWith(dir, { recursive: true, force: true })
    expect(existsSync(dir)).toBe(false)

    // Cleanup throwing during materialization failure never masks the original write error.
    expect(() => materializeOverlayPaths([{ id: 'tui', disabled: true }] as never[], {
      mkdtempSync: () => '/tmp/omdsh-fake-dir',
      writeFileSync: () => { throw new Error('EACCES: write denied') },
      rmSync: () => { throw new Error('EBUSY: cleanup failed') },
    })).toThrow(/EACCES: write denied/u)

    // Failed cleanup retains the tracked path so a retry can still remove it.
    let attempts = 0
    const retryDir = mkdtempSync(join(tmpdir(), 'omdsh-overlay-retry-'))
    roots.push(retryDir)
    const materialized = materializeOverlayPaths([{ id: 'tui', disabled: true }] as never[], {
      mkdtempSync: () => retryDir,
      writeFileSync: (path, data) => writeFileSync(path, data),
      rmSync: (path, options) => {
        attempts += 1
        if (attempts === 1) throw new Error('EBUSY: transient lock')
        rmSync(path, options)
      },
    })
    expect(() => materialized.cleanup()).toThrow(/EBUSY/u)
    expect(existsSync(retryDir)).toBe(true)
    materialized.cleanup()
    expect(attempts).toBe(2)
    expect(existsSync(retryDir)).toBe(false)
    // Subsequent cleanup after success is a no-op.
    materialized.cleanup()
    expect(attempts).toBe(2)

    // Disposal helper performs bounded retries and reports persistent failures visibly.
    let transientCalls = 0
    const onSuccessFailure = vi.fn()
    expect(cleanupOverlayDir(() => {
      transientCalls += 1
      if (transientCalls < 3) throw new Error('EBUSY: still locked')
    }, { maxAttempts: 3, onFailure: onSuccessFailure })).toBe(true)
    expect(transientCalls).toBe(3)
    expect(onSuccessFailure).not.toHaveBeenCalled()

    let persistentCalls = 0
    const onPersistentFailure = vi.fn()
    expect(cleanupOverlayDir(() => {
      persistentCalls += 1
      throw new Error('EPERM: directory locked')
    }, { maxAttempts: 3, onFailure: onPersistentFailure })).toBe(false)
    expect(persistentCalls).toBe(3)
    expect(onPersistentFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'EPERM: directory locked' }))

    // Persistent disposal failure writes synchronously to omdsh.log so an immediate signal process.exit() cannot lose it.
    const logHome = mkdtempSync(join(tmpdir(), 'omdsh-overlay-log-'))
    roots.push(logHome)
    cleanupOverlayDir(() => { throw new Error('EPERM: busy handle') }, {
      maxAttempts: 2,
      onFailure: (error) => { reportOverlayCleanupFailure(logHome, 'interactive', error) },
    })
    // Readable immediately on the very next synchronous line without waiting for async stream flushes.
    const logPath = join(logHome, 'omdsh', 'logs', 'omdsh.log')
    expect(readFileSync(logPath, 'utf8')).toContain('omdsh: failed to remove temporary launch overlay directory: EPERM: busy handle')
  })

  it('retains materialized runtime overlays across an interactive-mode HMR reload', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-hmr-overlay-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const profileDir = join(root, 'profiles', 'omdsh')
    mkdirSync(join(workspace, '.dsh'), { recursive: true })
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(workspace, '.dsh', 'mcp.json'), JSON.stringify({
      mcpServers: { probe: { command: 'node', args: ['-e', 'setTimeout(() => {}, 1000)'] } },
    }))
    // Keep HMR active in interactive mode while disabling only the interactive TUI runner/provider.
    writeFileSync(join(profileDir, 'cordis.patch.yml'), [
      '- id: tui',
      '  disabled: true',
      '- id: runner',
      '  disabled: true',
      '- id: web-server',
      '  disabled: true',
      '',
    ].join('\n'))
    const script = join(root, 'hmr-probe.mjs')
    writeFileSync(script, `
      import { appendFileSync } from 'node:fs'
      import { join } from 'node:path'
      const { mountOmdsh } = await import(${JSON.stringify(pathToFileURL(join(app, 'src/boot.ts')).href)})
      const ctx = await mountOmdsh({ args: [], mode: 'interactive', exit: () => {} })
      try {
        const hasProbe = () => [...ctx.loader.entries()].some(entry => entry.options.id === 'mcp-probe')
        const before = hasProbe()
        // Wait briefly for HMR watcher to arm, then modify cordis.patch.yml to trigger recomposition.
        await new Promise(resolve => setTimeout(resolve, 400))
        appendFileSync(join(${JSON.stringify(profileDir)}, 'cordis.patch.yml'), '- id: repeat-tool-reminder\\n  disabled: true\\n')
        const deadline = Date.now() + 10_000
        let applied = false
        while (Date.now() < deadline) {
          const reminder = [...ctx.loader.entries()].find(entry => entry.options.id === 'repeat-tool-reminder')
          if (reminder?.options.disabled === true) { applied = true; break }
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        const after = hasProbe()
        console.log(JSON.stringify({ before, applied, after }))
      } finally {
        await ctx.fiber.dispose().catch(() => {})
      }
    `)
    const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, script], {
      cwd: workspace,
      env: {
        ...process.env,
        OMDSH_HOME: root,
        NO_COLOR: '1',
        NODE_PATH: fileURLToPath(new URL('../../../node_modules/.pnpm/node_modules', import.meta.url)),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', chunk => { out += String(chunk) })
    child.stderr.on('data', chunk => { out += String(chunk) })
    const status = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`HMR overlay probe timed out\n${out.slice(-3000)}`)) }, 60_000)
      child.on('error', reject)
      child.on('close', code => { clearTimeout(timer); resolve(code) })
    })
    expect(status, out.slice(-3000)).toBe(0)
    const line = out.trim().split('\n').at(-1) ?? ''
    expect(JSON.parse(line)).toEqual({ before: true, applied: true, after: true })
  }, 90_000)
})
