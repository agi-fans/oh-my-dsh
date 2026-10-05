// Interactive-mode e2e: boots omdsh under a real PTY (raw-mode key path),
// submits a prompt, waits for the failed turn's rendered error (fake API
// key — keyless), opens the Session Tree through double Escape and forks
// before the failed human turn, then
// quits with double Ctrl-C and asserts the resume hint.
// Run: node scripts/pty-smoke.mjs

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { cleanOutput, omdshCommand, repoRoot, sleep, smokeEnv, smokeHome, waitFor } from './smoke-lib.mjs'

const require = createRequire(import.meta.url)
const pty = require('node-pty')
const omdshHome = smokeHome('omdsh-pty-smoke-')

const hasReasoningEffort = (value) => /deepseek-flash · (?:off|high|max)/u.test(cleanOutput(value))

const spawnCmd = omdshCommand()
const env = smokeEnv(omdshHome, { DEEPSEEK_API_KEY: 'sk-invalid-key-for-smoke' })
const seeded = spawnSync(spawnCmd[0], spawnCmd[1], {
  cwd: repoRoot,
  input: 'Recent header seed\n',
  encoding: 'utf8',
  timeout: 120_000,
  env,
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
  cwd: repoRoot,
  env,
})

let out = ''
let exitCode = null
term.onData((data) => { out += data })
term.onExit(({ exitCode: code }) => { exitCode = code })

const deadline = Date.now() + 120_000

await sleep(2500)
if (!(await waitFor(() => hasReasoningEffort(out), 'effective reasoning effort', deadline))) {
  console.error(cleanOutput(out).slice(-2000))
  term.kill()
  process.exit(1)
}
// File viewing and attachment staging use the same raw TTY owner as chat.
const reviewDirectory = join(omdshHome, 'file-review')
mkdirSync(reviewDirectory, { recursive: true })
const attachmentPath = join(reviewDirectory, 'a.txt')
writeFileSync(attachmentPath, 'Hello file preview\n')
writeFileSync(join(reviewDirectory, 'b.txt'), 'Hello sibling preview\n')
let featureMark = out.length
term.write(`/files "${attachmentPath}"\r`)
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('Hello file preview'), 'file document page', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
featureMark = out.length
term.write('\t\t\r')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('Hello sibling preview'), 'Next file via Tab and Enter', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
featureMark = out.length
term.write('P')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('Hello file preview'), 'Previous file via uppercase shortcut', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
featureMark = out.length
term.write('F')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('b.txt'), 'Files action', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
featureMark = out.length
term.write('\x1b[27u')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('../'), 'directory after file review', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
term.write('\x1b[27u')
await sleep(100)
featureMark = out.length
term.write('/terminal\r')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('New shell'), 'terminal picker', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
term.write('\r')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('session sandbox'), 'terminal document', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
term.write('i')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('Send a line'), 'terminal input', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
featureMark = out.length
term.write('echo OMDSH_TERMINAL_READY\r')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('OMDSH_TERMINAL_READY'), 'terminal input output', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
// Detach, then return to prove the registry still owns the shell.
term.write('\x1b[27u')
await sleep(100)
featureMark = out.length
term.write('/terminal\r')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('running'), 'persistent shell after detach', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
term.write('\x1b[27u')
await sleep(100)
// Close the fixture shell explicitly before testing Access changes.
featureMark = out.length
term.write('/terminal\r')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('New shell'), 'terminal picker before close', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
featureMark = out.length
term.write('\r')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('session sandbox'), 'terminal document before close', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
featureMark = out.length
term.write('\t\t\t\r')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('Terminate this shell'), 'terminal close confirmation', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
featureMark = out.length
term.write('\x1b[B\r')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('New shell'), 'terminal registry after close', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
term.write('\x1b[27u')
await sleep(100)
featureMark = out.length
term.write(`/attach "${attachmentPath}"\r`)
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('Attached ' + basename(attachmentPath)), 'file attachment receipt', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
if (!cleanOutput(out.slice(featureMark)).includes('[File:')) {
  console.error('FAIL: file reference marker missing'); term.kill(); process.exit(1)
}
// Clear the staged draft before subsequent command and exit contracts.
term.write('\x03')
await sleep(100)
let mark = out.length
term.write('/settings\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('General'), 'settings sections', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1b[Z')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('● Plugins'), 'plugin settings section', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('text filter'), 'plugin field form', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1b[27u')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('● Plugins'), 'return to Settings after plugin fields', deadline))) {
  term.kill()
  process.exit(1)
}
term.write('\x1b[27u')
await sleep(100)
mark = out.length
term.write('/agent\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Choose the Agent composition for this blank session'), 'Agent selector', deadline))) {
  term.kill()
  process.exit(1)
}
term.write('\x1b[B')
term.write('\r')
if (!(await waitFor(() => cleanOutput(out).includes('Agent: PTC'), 'PTC preset', deadline))) {
  term.kill()
  process.exit(1)
}
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('ptc'), 'PTC footer', deadline))) {
  console.error('FAIL: Agent switch did not refresh the footer')
  console.error(cleanOutput(out.slice(mark)).slice(-2000))
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('/agent\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Choose the Agent composition for this blank session'), 'PTC Agent selector', deadline))) {
  term.kill()
  process.exit(1)
}
term.write('\x1b[B')
term.write('\r')
if (!(await waitFor(() => cleanOutput(out).includes('Agent: Minimal'), 'Minimal preset', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('/tools\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Available Tools'), 'Minimal tool catalog', deadline))) {
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
term.write('\x0f')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Jump to latest message'), 'inspection jump label', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1b[F')
if (!(await waitFor(() => out.length > mark && !cleanOutput(out.slice(mark)).includes('Jump to latest message'), 'End returns to latest', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x0f')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Jump to latest message'), 'reopen after End', deadline))) {
  term.kill()
  process.exit(1)
}
term.write('\x1b[<64;10;5M')
mark = out.length
term.write('/settings\r')
if (!(await waitFor(() => out.slice(mark).includes('\x1b[?1006l\x1b[?1002l\x1b[?1000l') && cleanOutput(out.slice(mark)).includes('Settings'), 'settings suspends inspection mouse tracking', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1b[27u')
if (!(await waitFor(() => out.slice(mark).includes('\x1b[?1000h\x1b[?1002h\x1b[?1006h'), 'inspection restored after settings', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('/trajectory\r')
if (!(await waitFor(() => out.slice(mark).includes('\x1b[?1006l\x1b[?1002l\x1b[?1000l') && cleanOutput(out.slice(mark)).includes('Trajectory'), 'trajectory command opens over inspection', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1b[27u')
if (!(await waitFor(() => out.slice(mark).includes('\x1b[?1000h\x1b[?1002h\x1b[?1006h'), 'inspection restored after trajectory command', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x0f')
if (!(await waitFor(() => out.length > mark && !cleanOutput(out.slice(mark)).includes('Jump to latest message'), 'inspection closed', deadline))) {
  term.kill()
  process.exit(1)
}
term.write('\x1b[5~')
mark = out.length
term.write('/session\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Session Details'), 'plugin command result after scrolling back', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('/agent\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Choose the Agent composition for this blank session'), 'Minimal Agent selector', deadline))) {
  term.kill()
  process.exit(1)
}
term.write('\x1b[B')
term.write('\r')
if (!(await waitFor(() => cleanOutput(out).includes('Agent: Cordis'), 'Cordis preset', deadline))) {
  console.error(cleanOutput(out).slice(-2500))
  term.kill()
  process.exit(1)
}
term.write('/workflow\r')
if (!(await waitFor(() => cleanOutput(out).includes('Choose how this session approaches the next step'), 'Workflow selector', deadline))) {
  term.kill()
  process.exit(1)
}
term.write('\x1b[B')
term.write('\r')
if (!(await waitFor(() => cleanOutput(out).includes('Workflow: Plan'), 'Plan workflow', deadline))) {
  term.kill()
  process.exit(1)
}
term.write('/permission\r')
if (!(await waitFor(() => cleanOutput(out).includes('Choose how omdsh may access your workspace'), 'permission selector', deadline))) {
  term.kill()
  process.exit(1)
}
term.write('\x1b[A')
term.write('\r')
if (!(await waitFor(() => cleanOutput(out).includes('Access: Read only'), 'permission switch', Math.min(deadline, Date.now() + 15000)))) {
  console.error(cleanOutput(out).slice(-3500))
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('hi\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('error:'), 'rendered turn error', deadline))) {
  console.error(cleanOutput(out.slice(mark)).slice(-2000))
  term.kill()
  process.exit(1)
}
term.write('\x1b')
await sleep(100)
term.write('\x1b')
if (!(await waitFor(() => cleanOutput(out).includes('Session Tree'), 'session tree', deadline))) {
  term.kill()
  process.exit(1)
}
term.write('\r')
if (!(await waitFor(() => cleanOutput(out).includes('Editing from before turn 1.'), 'historical turn fork', deadline))) {
  term.kill()
  process.exit(1)
}
// Forking before the first turn leaves no completed turn to open. Ctrl+O must not enter an
// unrelated full-output mode; use the catalog to exercise cleanup on exit.
mark = out.length
term.write('\x0f')
await sleep(200)
if (out.slice(mark).includes('\x1b[?1000h\x1b[?1002h\x1b[?1006h')) {
  console.error('FAIL: Ctrl+O opened an empty transcript after the historical fork')
  term.kill()
  process.exit(1)
}
// Editing from a historical turn restores the original prompt in the composer.
term.write('\x15')
term.write('/tools\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Available Tools'), 'tool catalog before exit', deadline))) {
  console.error(cleanOutput(out.slice(mark)).slice(-2000))
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x0f')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Collapse descriptions'), 'inspection before exit', deadline))) {
  console.error(cleanOutput(out.slice(mark)).slice(-3000))
  term.kill()
  process.exit(1)
}
term.write('\x03')
await sleep(100)
term.write('\x03')
if (!(await waitFor(() => exitCode !== null, 'clean exit', deadline))) {
  const clean = cleanOutput(out)
  console.error('--- pty output at failure ---')
  console.error(clean.slice(-1500))
  term.kill()
  process.exit(1)
}
term.kill()

const clean = cleanOutput(out)
const ok = exitCode === 0
  && out.slice(mark).includes('\x1b[?1006l\x1b[?1002l\x1b[?1000l')
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
  && clean.includes('Session Tree')
  && clean.includes('Editing from before turn 1.')
  && clean.includes('Resume this session with omdsh --resume session-')
if (!ok) {
  console.error('FAIL: exit=' + exitCode)
  console.error(clean.slice(-2000))
  process.exit(1)
}
console.log('PTY_SMOKE_PASS exit=' + exitCode)
