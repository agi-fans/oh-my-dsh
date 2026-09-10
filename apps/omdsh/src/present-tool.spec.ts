import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

const roots: string[] = []

function temp(name: string): string {
  const path = mkdtempSync(join(tmpdir(), name))
  roots.push(path)
  return path
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('present delivery tool', () => {
  it('lets the model declare a deliverable and renders its card', async () => {
    const home = temp('omdsh-present-home-')
    writeFileSync(join(home, 'settings.yaml'), 'agent-presets:\n  default: standard\n')
    // A real empty-port bind keeps parallel suite runs from colliding.
    const server = await startMockLlmServer({
      port: 0,
      sequence: ['tool_call_success', 'success'],
      toolName: 'present',
      toolArguments: JSON.stringify({ files: [{ path: 'package.json', description: 'Probe deliverable' }] }),
      successText: 'delivered',
      chunkSize: 64,
      chunkDelayMs: 1,
    })
    // The mock server shares this process, so the child must be async: a
    // synchronous spawn would block the event loop that serves its requests.
    const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm'
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'pnpm', '--dir', 'apps/omdsh', 'omdsh']
      : ['--dir', 'apps/omdsh', 'omdsh']
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OMDSH_HOME: home,
        DEEPSEEK_BASE_URL: server.baseURL + '/v1',
        DEEPSEEK_API_KEY: 'sk-mock',
      },
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    child.stdin.end('deliver something\n')

    try {
      const status = await new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill(); resolve(null) }, 120_000)
        child.on('close', (code) => { clearTimeout(timer); resolve(code) })
      })
      const clean = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, '')
      expect(status, clean.slice(-2000)).toBe(0)
      // The default preset must expose the tool to the model at all.
      expect(clean).toContain('Deliverables')
      expect(clean).toContain('package.json — Probe deliverable')
      // The durable result only echoes the path, so the card must not repeat it.
      expect(clean).not.toContain('Presented package.json')
    } finally {
      await server.close()
    }
  }, 180_000)
})
