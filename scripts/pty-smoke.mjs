// Interactive-mode e2e: boots omdsh under a real PTY (raw-mode key path),
// submits a prompt, waits for the failed turn's rendered error (fake API
// key — keyless), quits with double Ctrl-C, and asserts the resume hint.
// Run: node scripts/pty-smoke.mjs

import { spawn } from 'node:child_process'
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

// OMDSH_RUN_MODE=built exercises the shipped artifact (lib/bin.js); the
// default exercises the tsx source launch.
const spawnCmd = process.env.OMDSH_RUN_MODE === 'built'
  ? [process.execPath, ['apps/omdsh/lib/bin.js']]
  : ['pnpm', ['--dir', 'apps/omdsh', 'omdsh']]

const term = pty.spawn(spawnCmd[0], spawnCmd[1], {
  name: 'xterm-256color',
  cols: 80,
  rows: 30,
  cwd: root,
  env: { ...process.env, OMDSH_HOME: omdshHome, DEEPSEEK_API_KEY: 'sk-invalid-key-for-smoke', NO_COLOR: '1' },
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
term.write('hi\r')
if (!(await waitFor(() => out.includes('error'), 'rendered turn error'))) {
  term.kill()
  process.exit(1)
}
term.write('\x03')
await sleep(100)
term.write('\x03')
if (!(await waitFor(() => exitCode !== null, 'clean exit'))) {
  const clean = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '')
  console.error('--- pty output at failure ---')
  console.error(clean.slice(-1500))
  term.kill()
  process.exit(1)
}
term.kill()

const clean = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '')
const ok = exitCode === 0
  && clean.includes('hi')
  && clean.includes('error:')
  && clean.includes('Resume this session with omdsh --resume session-')
if (!ok) {
  console.error('FAIL: exit=' + exitCode)
  console.error(clean.slice(-2000))
  process.exit(1)
}
console.log('PTY_SMOKE_PASS exit=' + exitCode)
