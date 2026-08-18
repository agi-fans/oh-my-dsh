// Happy-path e2e (keyless): boots omdsh against the published Harness mock
// LLM package. The response is streamed, and the transcript must render both
// the prompt and assistant text before exiting cleanly on stdin EOF.
// Run: node scripts/happy-smoke.mjs

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

const root = fileURLToPath(new URL('..', import.meta.url))
const omdshHome = mkdtempSync(join(tmpdir(), 'omdsh-happy-smoke-'))
process.on('exit', () => { rmSync(omdshHome, { recursive: true, force: true }) })
writeFileSync(join(omdshHome, 'settings.yaml'), 'agent-presets:\n  default: code\n')

const server = await startMockLlmServer({
  port: 8123,
  sequence: ['success'],
  successText: 'hello from omdsh',
  chunkSize: 3,
  chunkDelayMs: 40,
})

const omdsh = spawn('pnpm', ['--dir', 'apps/omdsh', 'omdsh'], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, OMDSH_HOME: omdshHome, DEEPSEEK_BASE_URL: 'http://127.0.0.1:8123/v1', DEEPSEEK_API_KEY: 'sk-mock' },
})
let out = ''
omdsh.stdout.on('data', (chunk) => { out += String(chunk) })
omdsh.stderr.on('data', (chunk) => { out += String(chunk) })
omdsh.stdin.end('ping\n')

const status = await new Promise((resolve) => {
  const timeout = setTimeout(() => {
    omdsh.kill()
    resolve(null)
  }, 120_000)
  omdsh.on('close', (code) => {
    clearTimeout(timeout)
    resolve(code)
  })
})
await server.close()

const ok = status === 0 && out.includes('ping') && out.includes('hello from omdsh')
if (!ok) {
  console.error('FAIL: status=' + status)
  console.error(out.slice(-1500))
  process.exit(1)
}
console.log('HAPPY_SMOKE_PASS status=' + status)
