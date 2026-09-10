// Interactive-mode e2e: boots omdsh under a real PTY (raw-mode key path),
// submits a prompt, waits for the failed turn's rendered error (fake API
// key — keyless), rewinds the failed human turn through double Escape, then
// quits with double Ctrl-C and asserts the resume hint.
// Run: node scripts/pty-smoke.mjs

import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const pty = require('node-pty')
const omdshHome = mkdtempSync(join(tmpdir(), 'omdsh-pty-smoke-'))
process.on('exit', () => { rmSync(omdshHome, { recursive: true, force: true }) })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const cleanOutput = (value) => value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '')
const hasReasoningEffort = (value) => /deepseek-flash · (?:off|high|max)/u.test(cleanOutput(value))

// OMDSH_RUN_MODE=built exercises the shipped artifact (lib/bin.js); the
// default exercises the tsx source launch.
const spawnCmd = process.env.OMDSH_RUN_MODE === 'built'
  ? [process.execPath, ['apps/omdsh/lib/bin.js']]
  : process.platform === 'win32'
    // Windows resolves pnpm through a .cmd shim, so it needs a command shell.
    ? ['cmd.exe', ['/d', '/s', '/c', 'pnpm', '--dir', 'apps/omdsh', 'omdsh']]
    : ['pnpm', ['--dir', 'apps/omdsh', 'omdsh']]

const smokeEnv = {
  ...process.env,
  OMDSH_HOME: omdshHome,
  DEEPSEEK_API_KEY: 'sk-invalid-key-for-smoke',
  NO_COLOR: '1',
}
const seeded = spawnSync(spawnCmd[0], spawnCmd[1], {
  cwd: root,
  input: 'Recent header seed\n',
  encoding: 'utf8',
  timeout: 120_000,
  env: smokeEnv,
})
if (seeded.status !== 0) {
  console.error('FAIL: could not seed a durable recent session')
  console.error((seeded.stdout ?? '') + (seeded.stderr ?? ''))
  process.exit(1)
}

const term = pty.spawn(spawnCmd[0], spawnCmd[1], {
  name: 'xterm-256color',
  cols: 80,
  rows: 30,
  cwd: root,
  env: smokeEnv,
})

let out = ''
let exitCode = null
term.onData((data) => { out += data })
term.onExit(({ exitCode: code }) => { exitCode = code })

const deadline = Date.now() + 120_000
const waitFor = async (predicate, label) => {
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(200)
  }
  console.error('FAIL: timed out waiting for ' + label)
  return false
}

await sleep(2500)
if (!(await waitFor(() => hasReasoningEffort(out), 'effective reasoning effort'))) {
  console.error(cleanOutput(out).slice(-2000))
  term.kill()
  process.exit(1)
}
let mark = out.length
term.write('/agent\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Choose the Agent composition for this blank session'), 'Agent selector'))) {
  term.kill()
  process.exit(1)
}
term.write('\x1b[B')
term.write('\r')
if (!(await waitFor(() => cleanOutput(out).includes('Agent: PTC'), 'PTC preset'))) {
  term.kill()
  process.exit(1)
}
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('ptc'), 'PTC footer'))) {
  console.error('FAIL: Agent switch did not refresh the footer')
  console.error(cleanOutput(out.slice(mark)).slice(-2000))
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('/agent\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Choose the Agent composition for this blank session'), 'PTC Agent selector'))) {
  term.kill()
  process.exit(1)
}
term.write('\x1b[B')
term.write('\r')
if (!(await waitFor(() => cleanOutput(out).includes('Agent: Minimal'), 'Minimal preset'))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('/tools\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Available Tools'), 'Minimal tool catalog'))) {
  term.kill()
  process.exit(1)
}
const minimalCatalog = cleanOutput(out.slice(mark))
if (!minimalCatalog.includes('bash') || !minimalCatalog.includes('str_replace_editor') || minimalCatalog.includes('todo_write')) {
  console.error('FAIL: Minimal tool catalog is not restricted to its two-tool composition')
  console.error(minimalCatalog.slice(-2000))
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('/agent\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Choose the Agent composition for this blank session'), 'Minimal Agent selector'))) {
  term.kill()
  process.exit(1)
}
term.write('\x1b[B')
term.write('\r')
if (!(await waitFor(() => cleanOutput(out).includes('Agent: Cordis'), 'Cordis preset'))) {
  console.error(cleanOutput(out).slice(-2500))
  term.kill()
  process.exit(1)
}
term.write('/workflow\r')
if (!(await waitFor(() => cleanOutput(out).includes('Choose how this session approaches the next step'), 'Workflow selector'))) {
  term.kill()
  process.exit(1)
}
term.write('\x1b[B')
term.write('\r')
if (!(await waitFor(() => cleanOutput(out).includes('Workflow: Plan'), 'Plan workflow'))) {
  term.kill()
  process.exit(1)
}
term.write('/permission\r')
if (!(await waitFor(() => cleanOutput(out).includes('Choose how omdsh may access your workspace'), 'permission selector'))) {
  term.kill()
  process.exit(1)
}
term.write('\x1b[A')
term.write('\r')
if (!(await waitFor(() => cleanOutput(out).includes('Access: Read only'), 'permission switch'))) {
  term.kill()
  process.exit(1)
}
term.write('hi\r')
if (!(await waitFor(() => out.includes('error'), 'rendered turn error'))) {
  term.kill()
  process.exit(1)
}
term.write('\x1b')
await sleep(100)
term.write('\x1b')
if (!(await waitFor(() => cleanOutput(out).includes('Rewind Conversation'), 'rewind selector'))) {
  term.kill()
  process.exit(1)
}
term.write('\r')
if (!(await waitFor(() => cleanOutput(out).includes('Rewound to before turn 1.'), 'rewound session fork'))) {
  term.kill()
  process.exit(1)
}
term.write('\x03')
await sleep(100)
term.write('\x03')
if (!(await waitFor(() => exitCode !== null, 'clean exit'))) {
  const clean = cleanOutput(out)
  console.error('--- pty output at failure ---')
  console.error(clean.slice(-1500))
  term.kill()
  process.exit(1)
}
term.kill()

const clean = cleanOutput(out)
const ok = exitCode === 0
  && clean.includes('Recent sessions')
  && clean.includes('Recent header seed')
  && clean.includes('hi')
  && clean.includes('error:')
  && clean.includes('deepseek-flash')
  && hasReasoningEffort(clean)
  && clean.includes('Agent: PTC')
  && clean.includes('ptc')
  && clean.includes('Agent: Minimal')
  && clean.includes('Agent: Cordis')
  && clean.includes('Workflow: Plan')
  && clean.includes('Access: Read only')
  && clean.includes('Rewind Conversation')
  && clean.includes('Rewound to before turn 1.')
  && clean.includes('Resume this session with omdsh --resume session-')
if (!ok) {
  console.error('FAIL: exit=' + exitCode)
  console.error(clean.slice(-2000))
  process.exit(1)
}
console.log('PTY_SMOKE_PASS exit=' + exitCode)
