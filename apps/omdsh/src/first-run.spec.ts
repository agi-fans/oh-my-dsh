/**
 * Real composition: the first-run readiness signal is false only when the
 * mounted credential and settings seams both report no configured route.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

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
})
