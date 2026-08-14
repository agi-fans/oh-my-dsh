// Happy-path e2e (keyless): boots omdsh against the harness's own mock LLM
// server. The first request is refused (exercising the mounted provider
// retry), the second streams a success — the transcript must render both
// the prompt and the streamed assistant text, then exit 0 on stdin EOF.
// Run: node scripts/happy-smoke.mjs

import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const server = spawn('pnpm', ['exec', 'node', '--import', 'tsx',
  'refs/deepseek-harness/packages/test-support/llm-mock-server/src/bin.ts',
  '--sequence', 'connection_refused,success',
  '--success-text', 'hello from omdsh',
  '--chunk-size', '3', '--chunk-delay-ms', '40', '--port', '8123'],
  { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] })

await new Promise((resolve) => {
  server.stdout.on('data', (chunk) => { if (String(chunk).includes('ready')) resolve() })
  server.stdout.on('close', resolve)
  server.on('exit', resolve)
  setTimeout(resolve, 15000)
})

const result = spawnSync('pnpm', ['--filter', '@omdsh/app', 'omdsh'], {
  cwd: root, input: 'ping\n', encoding: 'utf8', timeout: 120_000,
  env: { ...process.env, DEEPSEEK_BASE_URL: 'http://127.0.0.1:8123/v1', DEEPSEEK_API_KEY: 'sk-mock' },
})
server.kill()

const out = (result.stdout ?? '') + (result.stderr ?? '')
const ok = result.status === 0 && out.includes('ping') && out.includes('hello from omdsh')
if (!ok) {
  console.error('FAIL: status=' + result.status)
  console.error(out.slice(-1500))
  process.exit(1)
}
console.log('HAPPY_SMOKE_PASS status=' + result.status)
