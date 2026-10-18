/**
 * Real-entry delivery: a reminder created through the mounted service fires
 * through the Host timer, resolves its live Session, and appends the framed
 * reminder to that Session. Proves the schedule composition and the background
 * session controller without a model-authored tool call.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

const app = fileURLToPath(new URL('../', import.meta.url))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('scheduled reminder delivery', () => {
  it('fires through the Host timer and appends the reminder to its Session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-schedule-delivery-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const profile = join(root, 'profiles', 'omdsh')
    mkdirSync(workspace)
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n')
    const script = join(root, 'deliver.mjs')
    writeFileSync(script, `
      import { createRequire } from 'node:module'
      import { pathToFileURL } from 'node:url'
      const require = createRequire(${JSON.stringify(join(app, 'package.json'))})
      const { mountOmdsh } = await import(${JSON.stringify(pathToFileURL(join(app, 'src/boot.ts')).href)})
      const { configureAgentContext } = await import(pathToFileURL(require.resolve('@agi-fans/dsh-tui/agent-profile')).href)
      const ctx = await mountOmdsh({ args: [], mode: 'exec', exit: code => { process.exitCode = code } })
      let handle
      try {
        const selection = ctx.get('agentDefaultModel').currentSelection()
        handle = await ctx.get('agents').create({
          sessionId: 'schedule-delivery',
          meta: { cwd: process.cwd(), agentPreset: 'standard' },
          agentOptions: selection,
          setup: async (agentCtx, agent) => {
            await configureAgentContext(agentCtx, agent, { current: selection, assembled: undefined })
          },
        })
        await ctx.get('schedule').create(handle.agent.session.id, {
          title: 'Delivery probe',
          prompt: 'SCHEDULE_DELIVERY_PROBE',
          after_seconds: 1,
        })
        const deadline = Date.now() + 15000
        let delivered = false
        while (Date.now() < deadline) {
          const messages = handle.agent.session.deriveMessages()
          if (messages.some(message => message.role === 'user' && message.source?.kind === 'schedule'
            && JSON.stringify(message.content).includes('SCHEDULE_DELIVERY_PROBE'))) {
            delivered = true
            break
          }
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        console.log(delivered ? 'SCHEDULE_DELIVERY_OK' : 'SCHEDULE_DELIVERY_TIMEOUT')
      } finally {
        if (handle !== undefined) await handle.dispose().catch(() => {})
        await ctx.fiber.dispose().catch(() => {})
      }
    `)
    const server = await startMockLlmServer({ port: 0, sequence: ['ok'] })
    try {
      const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, script], {
        cwd: workspace,
        env: {
          ...process.env,
          OMDSH_HOME: root,
          NO_COLOR: '1',
          DEEPSEEK_API_KEY: 'sk-mock',
          DEEPSEEK_BASE_URL: server.baseURL + '/v1',
          NODE_PATH: fileURLToPath(new URL('../../../node_modules/.pnpm/node_modules', import.meta.url)),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      child.stdout.on('data', chunk => { out += String(chunk) })
      child.stderr.on('data', chunk => { out += String(chunk) })
      const status = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`schedule delivery timed out\n${out.slice(-3000)}`)) }, 60_000)
        child.on('error', reject)
        child.on('close', code => { clearTimeout(timer); resolve(code) })
      })
      expect(status, out.slice(-3000)).toBe(0)
      expect(out, out.slice(-3000)).toContain('SCHEDULE_DELIVERY_OK')
    } finally {
      await server.close()
    }
  }, 90_000)
})

describe('scheduled reminder delivery to a cold Session', () => {
  it('resumes the stored Session on restart and delivers without an open TUI', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-schedule-cold-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const profile = join(root, 'profiles', 'omdsh')
    mkdirSync(workspace)
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n')
    const env = {
      ...process.env,
      OMDSH_HOME: root,
      NO_COLOR: '1',
      DEEPSEEK_API_KEY: 'sk-mock',
      NODE_PATH: fileURLToPath(new URL('../../../node_modules/.pnpm/node_modules', import.meta.url)),
    }
    const server = await startMockLlmServer({ port: 0, sequence: ['ok', 'ok', 'ok'] })
    const run = async (script: string): Promise<string> => {
      const file = join(root, `phase-${Math.random().toString(16).slice(2)}.mjs`)
      writeFileSync(file, script)
      const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, file], {
        cwd: workspace,
        env: { ...env, DEEPSEEK_BASE_URL: server.baseURL + '/v1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      child.stdout.on('data', chunk => { out += String(chunk) })
      child.stderr.on('data', chunk => { out += String(chunk) })
      const status = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`phase timed out\n${out.slice(-3000)}`)) }, 90_000)
        child.on('error', reject)
        child.on('close', code => { clearTimeout(timer); resolve(code) })
      })
      expect(status, out.slice(-3000)).toBe(0)
      return out
    }
    try {
      const header = `
        import { createRequire } from 'node:module'
        import { pathToFileURL } from 'node:url'
        const require = createRequire(${JSON.stringify(join(app, 'package.json'))})
        const { mountOmdsh } = await import(${JSON.stringify(pathToFileURL(join(app, 'src/boot.ts')).href)})
        const { configureAgentContext } = await import(pathToFileURL(require.resolve('@agi-fans/dsh-tui/agent-profile')).href)
      `
      const scheduled = await run(`${header}
        const ctx = await mountOmdsh({ args: [], mode: 'exec', exit: code => { process.exitCode = code } })
        let handle
        try {
          const selection = ctx.get('agentDefaultModel').currentSelection()
          handle = await ctx.get('agents').create({
            sessionId: 'cold-delivery',
            meta: { cwd: process.cwd(), agentPreset: 'standard' },
            agentOptions: selection,
            setup: async (agentCtx, agent) => {
              await configureAgentContext(agentCtx, agent, { current: selection, assembled: undefined })
            },
          })
          await ctx.get('schedule').create(handle.agent.session.id, {
            title: 'Cold delivery probe',
            prompt: 'COLD_DELIVERY_PROBE',
            after_seconds: 5,
          })
          console.log('SCHEDULED')
        } finally {
          if (handle !== undefined) await handle.dispose().catch(() => {})
          await ctx.fiber.dispose().catch(() => {})
        }
      `)
      expect(scheduled, scheduled.slice(-3000)).toContain('SCHEDULED')

      const delivered = await run(`${header}
        const ctx = await mountOmdsh({ args: [], mode: 'exec', exit: code => { process.exitCode = code } })
        try {
          const deadline = Date.now() + 20000
          let found = false
          while (Date.now() < deadline) {
            const session = ctx.get('sessions').get('cold-delivery')
            const messages = session === undefined ? [] : session.deriveMessages()
            if (messages.some(message => message.role === 'user' && message.source?.kind === 'schedule'
              && JSON.stringify(message.content).includes('COLD_DELIVERY_PROBE'))) {
              found = true
              break
            }
            await new Promise(resolve => setTimeout(resolve, 100))
          }
          console.log(found ? 'COLD_DELIVERY_OK' : 'COLD_DELIVERY_TIMEOUT')
        } finally {
          await ctx.fiber.dispose().catch(() => {})
        }
      `)
      expect(delivered, delivered.slice(-3000)).toContain('COLD_DELIVERY_OK')
    } finally {
      await server.close()
    }
  }, 120_000)
})
