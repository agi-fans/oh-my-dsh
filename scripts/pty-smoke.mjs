// Interactive-mode e2e: boots omdsh under a real PTY (raw-mode key path),
// submits a prompt, waits for the failed turn's rendered error (fake API
// key — keyless), opens the Session Tree through double Escape and forks
// before the failed human turn, then
// quits with double Ctrl-C and asserts the resume hint.
// Run: node scripts/pty-smoke.mjs

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
// Exercise explicit and unmarked paste through the shipped raw-input owner.
const pasteSource = Array.from({ length: 12 }, (_, index) => `paste line ${index}`).join('\n')
let pasteMark = out.length
term.write('\x1b[200~' + pasteSource + '\x1b[201~')
if (!(await waitFor(() => cleanOutput(out.slice(pasteMark)).includes('[Pasted #1: 12 lines]'), 'folded pasted block', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
pasteMark = out.length
term.write('\x1bi')
if (!(await waitFor(() => cleanOutput(out.slice(pasteMark)).includes('paste line 11'), 'expanded pasted block', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
term.write('\x03')
await sleep(100)
pasteMark = out.length
term.write(pasteSource.replaceAll('\n', '\r') + '\r')
if (!(await waitFor(() => cleanOutput(out.slice(pasteMark)).includes('[Pasted #2: 13 lines]'), 'legacy multiline paste protection', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
if (cleanOutput(out.slice(pasteMark)).includes('Deep Driving')) {
  console.error('FAIL: an Enter inside a paste submitted a turn'); term.kill(); process.exit(1)
}
// A clear should not be interpreted as the second gesture of a double Ctrl-C exit.
await sleep(600)
term.write('\x03')
await sleep(100)
term.write('\x1b[I\x1b[O')
// File viewing and attachment staging use the same raw TTY owner as chat.
const reviewDirectory = join(omdshHome, 'file-review')
mkdirSync(reviewDirectory, { recursive: true })
const attachmentPath = join(reviewDirectory, 'a.txt')
writeFileSync(attachmentPath, 'Hello file preview\n' + Array.from({ length: 80 }, (_, at) => `source row ${at + 2}\n`).join(''))
writeFileSync(join(reviewDirectory, 'b.txt'), 'Hello sibling preview\n')
let featureMark = out.length
term.write(`/files "${attachmentPath}"\r`)
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('Hello file preview'), 'file document page', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
featureMark = out.length
term.write('G')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('Line:'), 'file line entry', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
featureMark = out.length
term.write('42\r')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('Line 42/81'), 'source line jump', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
featureMark = out.length
term.write('/')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('Find:'), 'source search entry', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
featureMark = out.length
term.write('source row 60\r')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('1/1 matching lines'), 'source content search', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
featureMark = out.length
term.write('\t\t\r')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('Hello sibling preview'), 'Next file via Tab and Enter', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
featureMark = out.length
term.write('P')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('source row 60'), 'Previous file restores source position', deadline))) {
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
// Read a real long-running shell's history through the published terminal registry.
await sleep(300)
term.write('i')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('Send a line'), 'long-output terminal input', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
featureMark = out.length
term.write('node -e "for (let i=1;i<=650;i++) console.log(\'OMDSH_HISTORY_\'+i)"\r')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('OMDSH_HISTORY_650'), 'terminal newest output', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
await sleep(300)
featureMark = out.length
term.write('\x1b[H')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('Paused'), 'terminal pause following', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
term.write('l')
await sleep(200)
term.write('l')
await sleep(200)
featureMark = out.length
term.write('/\x1b[200~OMDSH_HISTORY_100\x1b[201~')
await sleep(100)
term.write('\r')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('1/1 matching lines'), 'terminal older-output search', deadline))) {
  console.error(cleanOutput(out).slice(-2500)); term.kill(); process.exit(1)
}
featureMark = out.length
term.write('\x1b[F')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('Following'), 'terminal resume following', deadline))) {
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
// Mark and filter the failed Turn using the shipped Session Tree.
term.write('\x1bl')
if (!(await waitFor(() => cleanOutput(out).includes('Label Conversation Node'), 'label editor', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('Smoke checkpoint\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Session Tree'), 'labelled tree', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1bb')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Session Tree · Marked'), 'marked tree', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1bb')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Session Tree'), 'full tree', deadline))) {
  term.kill()
  process.exit(1)
}
term.write('\r')
if (!(await waitFor(() => cleanOutput(out).includes('Editing from before turn 1.'), 'historical turn fork', deadline))) {
  term.kill()
  process.exit(1)
}
// Archiving changes only the local library; restoring keeps the Turn's label.
const libraryPath = join(omdshHome, 'omdsh', 'session-library.json')
const libraryMetadata = () => {
  try { return JSON.parse(readFileSync(libraryPath, 'utf8')) }
  catch { return {} }
}
mark = out.length
term.write('\x15/sessions\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Session Library'), 'session library', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1ba')
if (!(await waitFor(() => libraryMetadata().archived?.length === 1 && cleanOutput(out.slice(mark)).includes('Session Library'), 'archived session', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1bv')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Session Library · Archived'), 'archived library', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1ba')
if (!(await waitFor(() => libraryMetadata().archived?.length === 0 && cleanOutput(out.slice(mark)).includes('No archived sessions'), 'restored session', deadline))) {
  term.kill()
  process.exit(1)
}
if (Object.values(libraryMetadata().labels ?? {}).filter(label => label === 'Smoke checkpoint').length !== 1) {
  console.error('FAIL: archive actions lost the tree label')
  term.kill()
  process.exit(1)
}
// The archive list is now empty; its view action still works.
mark = out.length
term.write('\x1bv')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Session Library'), 'active library after restore', deadline))) {
  term.kill()
  process.exit(1)
}
term.write('\x03')
await sleep(100)
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
  && out.includes('\x1b[?1004h')
  && out.includes('\x1b[?1004l')
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
// Recovery must work through the shipped provider, including after an abrupt stop.
const resumeId = /Resume this session with omdsh --resume (session-[^\s]+)/u.exec(clean)?.[1]
if (resumeId === undefined) { console.error('FAIL: missing recovery session id'); process.exit(1) }
const draftPath = join(omdshHome, 'omdsh', 'drafts', createHash('sha256').update(resumeId).digest('hex'), 'draft.json')
const draftSource = Array.from({ length: 12 }, (_, at) => `recovery draft row ${at + 1}`).join('\n')
function recoveryTerminal() {
  const terminal = pty.spawn(spawnCmd[0], [...spawnCmd[1], '--resume', resumeId], {
    name: 'xterm-256color', cols: 80, rows: 30, cwd: repoRoot, env,
  })
  const capture = { process: terminal, output: '', exit: null }
  terminal.onData(data => { capture.output += data })
  terminal.onExit(({ exitCode }) => { capture.exit = exitCode })
  return capture
}
const draftWriter = recoveryTerminal()
if (!(await waitFor(() => cleanOutput(draftWriter.output).includes(`Resumed ${resumeId}.`), 'draft writer resumed', deadline))) {
  console.error(cleanOutput(draftWriter.output).slice(-2000)); draftWriter.process.kill(); process.exit(1)
}
draftWriter.process.write('\x1b[200~' + draftSource + '\x1b[201~')
if (!(await waitFor(() => {
  try { return JSON.parse(readFileSync(draftPath, 'utf8')).editor.pastes[0]?.content === draftSource } catch { return false }
}, 'draft autosave on disk', deadline))) {
  console.error(cleanOutput(draftWriter.output).slice(-2000)); draftWriter.process.kill(); process.exit(1)
}
draftWriter.process.kill()
if (!(await waitFor(() => draftWriter.exit !== null, 'draft writer stopped', deadline))) process.exit(1)
const draftReader = recoveryTerminal()
if (!(await waitFor(() => cleanOutput(draftReader.output).includes('[Pasted #1: 12 lines]'), 'restored folded draft', deadline))) {
  console.error(cleanOutput(draftReader.output).slice(-2000)); draftReader.process.kill(); process.exit(1)
}
const recoveryMark = draftReader.output.length
draftReader.process.write('\x1bi')
if (!(await waitFor(() => cleanOutput(draftReader.output.slice(recoveryMark)).includes('recovery draft row 12'), 'restored original paste text', deadline))) {
  console.error(cleanOutput(draftReader.output).slice(-2000)); draftReader.process.kill(); process.exit(1)
}
draftReader.process.write('\x03')
await sleep(100)
draftReader.process.write('\x03')
if (!(await waitFor(() => draftReader.exit !== null, 'recovery terminal clean exit', deadline))) {
  draftReader.process.kill(); process.exit(1)
}
if (draftReader.exit !== 0 || !draftReader.output.includes('\x1b[?2004l') || !draftReader.output.includes('\x1b[?1004l')) {
  console.error('FAIL: recovery terminal did not restore terminal modes'); process.exit(1)
}
try { readFileSync(draftPath); console.error('FAIL: discarded draft was not removed'); process.exit(1) }
catch (error) { if (error.code !== 'ENOENT') throw error }
// Keep a real Agent turn streaming while its durable inbox is managed through the keyboard.
const queueHome = smokeHome('omdsh-queue-pty-')
const queueProfile = join(queueHome, 'profiles', 'omdsh')
mkdirSync(queueProfile, { recursive: true })
writeFileSync(join(queueProfile, 'cordis.patch.yml'), '- id: agent-preset-registry\n  config:\n    default: code\n- id: session-title-llm\n  disabled: true\n')
const queueServer = await startMockLlmServer({ port: 0, sequence: ['slow_success'], successText: 'QUEUE_STREAM_READY ' + '.'.repeat(3000), chunkSize: 10, chunkDelayMs: 100 })
const queueTerm = pty.spawn(spawnCmd[0], spawnCmd[1], { name: 'xterm-256color', cols: 80, rows: 30, cwd: repoRoot,
  env: smokeEnv(queueHome, { DEEPSEEK_BASE_URL: queueServer.baseURL + '/v1', DEEPSEEK_API_KEY: 'sk-mock' }) })
let queueOut = '', queueExit = null
queueTerm.onData(data => { queueOut += data })
queueTerm.onExit(({ exitCode }) => { queueExit = exitCode })
async function queueWait(predicate, label) {
  if (await waitFor(predicate, label, deadline)) return
  console.error(cleanOutput(queueOut).slice(-2500))
  queueTerm.kill(); await queueServer.close(); process.exit(1)
}
await queueWait(() => hasReasoningEffort(queueOut), 'queue terminal ready')
queueTerm.write('queue smoke start\r')
await queueWait(() => cleanOutput(queueOut).includes('QUEUE_STREAM_READY'), 'queue model streaming')
queueTerm.write('first followup\r')
await sleep(150)
queueTerm.write('second followup\r')
await queueWait(() => cleanOutput(queueOut).includes('Queued · 2'), 'durable follow-ups')
let queueMark = queueOut.length
queueTerm.write('\x1bq')
await queueWait(() => cleanOutput(queueOut.slice(queueMark)).includes('Message Queue'), 'queue shortcut')
queueMark = queueOut.length
queueTerm.write('\x1b[B\x1b[1;3A')
await queueWait(() => cleanOutput(queueOut.slice(queueMark)).includes('Next turn · 1 · second followup'), 'durable queue reorder')
queueMark = queueOut.length
queueTerm.write('\r')
await queueWait(() => cleanOutput(queueOut.slice(queueMark)).includes('Edit Queued Message'), 'queue text editor')
queueMark = queueOut.length
queueTerm.write('\x01\x0bupdated followup\r')
await queueWait(() => cleanOutput(queueOut.slice(queueMark)).includes('Next turn · 1 · updated followup'), 'durable queue replacement')
queueMark = queueOut.length
queueTerm.write('\x1bd')
await queueWait(() => cleanOutput(queueOut.slice(queueMark)).includes('Next turn · 1 · first followup'), 'selected queue deletion')
queueMark = queueOut.length
queueTerm.write('\x1bd')
await queueWait(() => cleanOutput(queueOut.slice(queueMark)).includes('No pending messages.'), 'empty queue after deletion')
queueTerm.write('\x1b[27u')
await sleep(100)
queueMark = queueOut.length
queueTerm.write('/queue\r')
await queueWait(() => cleanOutput(queueOut.slice(queueMark)).includes('Message Queue'), 'queue slash command')
queueTerm.write('\x1b[27u')
await sleep(100)
queueTerm.write('\x03')
await sleep(100)
queueTerm.write('\x03')
await queueWait(() => queueExit !== null, 'queue terminal exit')
await queueServer.close()
if (queueExit !== 0 || !queueOut.includes('\x1b[?2004l') || !queueOut.includes('\x1b[?1004l')) {
  console.error('FAIL: queue terminal did not restore terminal modes'); process.exit(1)
}
console.log('PTY_SMOKE_PASS exit=' + exitCode + ' draft-recovery=pass message-queue=pass')
