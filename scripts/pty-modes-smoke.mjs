// Terminal-mode ownership e2e: boots the built omdsh under a real PTY, answers
// its capability query the way a Kitty-protocol terminal does, suspends with
// Ctrl+Z, resumes with SIGCONT and quits with double Ctrl-C. Every mode the
// TUI turned on must be given back on suspend and on exit, and the Kitty
// keyboard stack must see exactly as many pops as pushes.
// Run: node scripts/pty-modes-smoke.mjs

import { createRequire } from 'node:module'
import { cleanOutput, omdshCommand, repoRoot, sleep, smokeEnv, smokeHome, waitFor } from './smoke-lib.mjs'

const require = createRequire(import.meta.url)
const pty = require('node-pty')

if (process.platform === 'win32') {
  console.log('PTY_MODES_SMOKE_SKIP job control is POSIX-only')
  process.exit(0)
}

const home = smokeHome('omdsh-pty-modes-')
const [command, args] = omdshCommand()
const term = pty.spawn(command, args, {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: repoRoot,
  env: smokeEnv(home, { DEEPSEEK_API_KEY: 'sk-invalid-key-for-smoke' }),
})

let out = ''
let exitCode = null
term.onData((data) => { out += data })
term.onExit(({ exitCode: code }) => { exitCode = code })

const deadline = Date.now() + 90_000
const fail = (message) => {
  console.error('FAIL: ' + message)
  console.error(JSON.stringify(out.slice(-1500)))
  try { term.kill() } catch { /* already gone */ }
  process.exit(1)
}
const count = (text, sequence) => text.split(sequence).length - 1
const PUSH = '\x1b[>1u'
const POP = '\x1b[<u'

if (!(await waitFor(() => out.includes('\x1b[?u'), 'keyboard capability query', deadline))) fail('no capability query')
if (!(await waitFor(() => out.includes('\x1b[c'), 'device-attributes sentinel', deadline))) fail('no DA sentinel at the end of the query')
if (/\x1b\[>\d*u/u.test(out)) fail('the query pushed a Kitty entry before the terminal answered')
if (!(await waitFor(() => cleanOutput(out).includes('Into the Unknown'), 'welcome card', deadline))) fail('no welcome card')

// Answer as a Kitty-protocol terminal: flags report, DECRQM 2031 support, then the DA sentinel.
term.write('\x1b[?0u\x1b[?2031;2$y\x1b[?62;22c')
if (!(await waitFor(() => count(out, PUSH) === 1, 'one Kitty push', deadline))) fail('the Kitty protocol was not enabled once')
await sleep(300)
if (count(out, PUSH) !== 1) fail('a repeated report pushed a second Kitty entry')

// Ctrl+Z hands every mode back before stopping.
let mark = out.length
term.write('\x1a')
if (!(await waitFor(() => out.slice(mark).includes(POP), 'Kitty pop on suspend', deadline))) fail('suspend kept the Kitty protocol')
if (!out.slice(mark).includes('\x1b[?2004l') || !out.slice(mark).includes('\x1b[?1004l')) fail('suspend kept paste or focus reporting')

// A PTY child is an orphaned process group, so the stop itself is discarded;
// SIGCONT to the group (the launcher and the TUI process) still runs the
// resume path that takes the modes back.
mark = out.length
process.kill(-term.pid, 'SIGCONT')
if (!(await waitFor(() => out.slice(mark).includes(PUSH), 'Kitty push on resume', deadline))) fail('resume did not re-enable the Kitty protocol')
if (!out.slice(mark).includes('\x1b[?2004h')) fail('resume did not re-enable bracketed paste')

await sleep(300)
term.write('\x03')
await sleep(150)
term.write('\x03')
if (!(await waitFor(() => exitCode !== null, 'exit', deadline))) fail('omdsh did not exit on double Ctrl-C')

const pairs = [
  ['Kitty keyboard', PUSH, POP],
  ['bracketed paste', '\x1b[?2004h', '\x1b[?2004l'],
  ['focus reporting', '\x1b[?1004h', '\x1b[?1004l'],
  ['mouse tracking', '\x1b[?1000h', '\x1b[?1000l'],
  ['alternate screen', '\x1b[?1049h', '\x1b[?1049l'],
  ['color-scheme notify', '\x1b[?2031h', '\x1b[?2031l'],
]
for (const [label, on, off] of pairs) {
  if (count(out, on) !== count(out, off)) fail(`${label} is unbalanced: ${count(out, on)} on, ${count(out, off)} off`)
}
// The last keyboard action before the shell gets the terminal is a pop.
if (out.lastIndexOf(POP) < out.lastIndexOf(PUSH)) fail('exit left a Kitty entry on the stack')
if (exitCode !== 0) fail('omdsh exited with ' + exitCode)

console.log(`PTY_MODES_SMOKE_PASS exit=${exitCode} kitty=${count(out, PUSH)}/${count(out, POP)}`)
