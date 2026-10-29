// Inspection e2e: Ctrl+O opens the browsing frame only on a settled turn group,
// so this boots omdsh against the published mock LLM and makes it call a tool.
// The transcript then has a real run to inspect, and the terminal contracts that
// belong to the frame — jump label, End returns to the tail, reopening, and every
// terminal mode given back on exit — are checked under a real PTY.
// Run: node scripts/pty-inspect-smoke.mjs

import { createRequire } from 'node:module'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { cleanOutput, omdshCommand, repoRoot, sleep, smokeEnv, smokeHome, waitFor } from './smoke-lib.mjs'

const require = createRequire(import.meta.url)
const pty = require('node-pty')

if (process.platform === 'win32') {
  console.log('PTY_INSPECT_SMOKE_SKIP job control is POSIX-only')
  process.exit(0)
}

// The script is consumed one response per model request. Running out is a server
// error the harness retries, and a retrying turn never settles — so it is never
// inspectable. Padding with plain successes keeps the run finite.
const server = await startMockLlmServer({
  port: 8124,
  sequence: ['tool_call_success', ...Array.from({ length: 10 }, () => 'success')],
  successText: 'done',
  toolName: 'bash',
  toolArguments: JSON.stringify({ command: 'echo omdsh-inspect', description: 'Say hello for the smoke' }),
  chunkSize: 32,
  chunkDelayMs: 10,
})

const home = smokeHome('omdsh-pty-inspect-')
const [command, args] = omdshCommand()
const term = pty.spawn(command, args, {
  name: 'xterm-256color',
  cols: 100,
  rows: 30,
  cwd: repoRoot,
  env: smokeEnv(home, { DEEPSEEK_BASE_URL: 'http://127.0.0.1:8124/v1', DEEPSEEK_API_KEY: 'sk-mock' }),
})

let out = ''
let exitCode = null
term.onData((data) => { out += data })
term.onExit(({ exitCode: code }) => { exitCode = code })

const deadline = Date.now() + 120_000
const MOUSE_ON = '\x1b[?1000h\x1b[?1002h\x1b[?1006h'
const MOUSE_OFF = '\x1b[?1006l\x1b[?1002l\x1b[?1000l'
const fail = async (message, tail = 1500) => {
  console.error('FAIL: ' + message)
  console.error(JSON.stringify(cleanOutput(out).slice(-tail)))
  try { term.kill() } catch { /* already gone */ }
  await server.close()
  process.exit(1)
}

if (!(await waitFor(() => cleanOutput(out).includes('Into the Unknown'), 'welcome card', deadline))) {
  await fail('no welcome card')
}

let mark = out.length
term.write('call a tool\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('omdsh-inspect'), 'tool card', deadline))) {
  await fail('the turn never produced a tool card')
}
// The turn must settle before its run can be inspected: a live run has its own
// presentation and refuses the frame. The folded run header is the reader-visible
// signal that it has.
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Ctrl+O to expand'), 'settled run', deadline))) {
  await fail('the run never settled')
}

// Ctrl+O opens the browsing frame on the settled run.
mark = out.length
term.write('\x0f')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Jump to latest message'), 'inspection jump label', deadline))) {
  await fail('Ctrl+O did not open the browsing frame')
}
if (!out.slice(mark).includes(MOUSE_ON)) await fail('the browsing frame did not enable mouse reporting')

// End returns to the live tail and leaves the frame.
mark = out.length
term.write('\x1b[F')
if (!(await waitFor(() => out.length > mark && !cleanOutput(out.slice(mark)).includes('Jump to latest message'), 'End returns to the tail', deadline))) {
  await fail('End did not return to the live tail')
}

// And it can be reopened, which is the part the reader actually repeats.
mark = out.length
term.write('\x0f')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Jump to latest message'), 'reopen after End', deadline))) {
  await fail('Ctrl+O did not reopen the frame after End')
}

// Leaving with the frame open must give every terminal mode back.
term.write('\x03')
await sleep(150)
term.write('\x03')
if (!(await waitFor(() => exitCode !== null, 'clean exit', deadline))) {
  await fail('omdsh did not exit')
}

const final = out.slice(mark)
const ok = exitCode === 0
  && final.includes(MOUSE_OFF)
  && out.includes('\x1b[?1004h')
  && out.includes('\x1b[?1004l')
  && out.lastIndexOf(MOUSE_OFF) > out.lastIndexOf(MOUSE_ON)
  && cleanOutput(out).includes('omdsh-inspect')
if (!ok) await fail('terminal modes were not restored on exit')

await server.close()
term.kill()
console.log('PTY_INSPECT_SMOKE_PASS exit=0 inspection=open-end-reopen modes=restored')
