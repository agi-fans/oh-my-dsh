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

// Partial preference patches must not remove the initial model label or crash
// the welcome card before the Session supplies its effective model.
writeFileSync(join(omdshHome, 'profiles', 'omdsh', 'cordis.patch.yml'),
  '- id: tui\n  config:\n    terminalTitle: workspace\n    terminalState: on\n')

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
// The document reader's line jumps, search, and sibling navigation are covered
// by views/document-reader.spec.ts. What this end-to-end run still has to prove
// is that staging a file keeps the raw TTY owner intact.
term.write(`/attach "${attachmentPath}"\r`)
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('Attached a.txt'), 'file staged through the raw TTY', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
// Drop the staged draft so the session is still blank for the steps below; a
// `[File:1]` marker only leaves the composer with the message it belongs to, so
// this clears the buffer instead of sending it.
await sleep(150)
term.write('\x1b')
await sleep(100)
term.write('\x15')
await sleep(200)
term.write('\x1b[27u')
await sleep(100)
// A `!` line runs into a transcript card that settles in place: no picker, no
// reader, no exit gesture. The card streams the command's own output and keeps
// the composer available afterwards.
featureMark = out.length
term.write('!echo OMDSH_SHELL_CARD\r')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('OMDSH_SHELL_CARD'), 'shell card output', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
if (!cleanOutput(out.slice(featureMark)).includes('$ echo OMDSH_SHELL_CARD')) {
  console.error('shell card did not show its command line')
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
// The card settles on its own; the composer takes the next line immediately.
await sleep(400)
featureMark = out.length
term.write('!echo OMDSH_SECOND_LINE\r')
if (!(await waitFor(() => cleanOutput(out.slice(featureMark)).includes('OMDSH_SECOND_LINE'), 'second shell card', deadline))) {
  console.error(cleanOutput(out).slice(-2000)); term.kill(); process.exit(1)
}
await sleep(400)
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
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Interface'), 'settings sections', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('translation')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('No matching settings'), 'removed translation controls', deadline))) {
  term.kill()
  process.exit(1)
}
term.write('\x15')
await sleep(100)
mark = out.length
term.write('Shell')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Search: Shell'), 'cross-category settings search', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Default timeout') && cleanOutput(out.slice(mark)).includes('Restore inherited setting'), 'searched product form', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1b[27u')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Search: Shell'), 'return to searched settings result', deadline))) {
  term.kill()
  process.exit(1)
}
term.write('\x1b[27u')
await sleep(100)
mark = out.length
term.write('\x1b[27u')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('● Interface'), 'return to original settings category', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x12')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Restore inherited setting'), 'inherited preference confirmation', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1b[27u')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('● Interface'), 'cancel inherited preference restoration', deadline))) {
  term.kill()
  process.exit(1)
}
// Advanced is empty in the shipped profile: Web search now carries its own
// provider credentials inside the Integrations section.
mark = out.length
term.write('Web search')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Search: Web search'), 'web search settings result', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Results per search') && cleanOutput(out.slice(mark)).includes('API key reference'), 'web search provider form', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1b[27u')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Search: Web search'), 'return to web search result', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x15')
term.write('Claude Code')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Search: Claude Code'), 'native integration search result', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Enable integration') && cleanOutput(out.slice(mark)).includes('Claude Code'), 'native integration controls without a model request', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1b[F\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Package: available') && cleanOutput(out.slice(mark)).includes('Profile: disabled'), 'native status reading page', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1b[27u')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Enable integration') && cleanOutput(out.slice(mark)).includes('Installation status'), 'return from native status reading page', deadline))) {
  term.kill()
  process.exit(1)
}
let settingsClosed = false
for (let attempt = 0; attempt < 5 && !settingsClosed; attempt += 1) {
  mark = out.length
  term.write('\x1b[27u')
  await sleep(350)
  settingsClosed = cleanOutput(out.slice(mark)).includes('Ask anything')
}
if (!settingsClosed) {
  console.error(cleanOutput(out).slice(-2500))
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('/agent\r')
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Choose the Agent composition for this blank session'), 'Agent selector', deadline))) {
  term.kill()
  process.exit(1)
}
term.write('\x1b[B')
term.write('\r')
if (!(await waitFor(() => cleanOutput(out).includes('Agent: PTC'), 'PTC preset', deadline))) {
  console.error(cleanOutput(out).slice(-2500))
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
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Tools'), 'Minimal tool catalog', deadline))) {
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
// The catalog is a reader now: leaving it returns to the composer, and Ctrl+O on
// a blank transcript has no turn group to inspect.
term.write('\x03')
await sleep(100)
mark = out.length
term.write('\x0f')
await sleep(200)
if (out.slice(mark).includes('\x1b[?1000h\x1b[?1002h\x1b[?1006h')
  || cleanOutput(out.slice(mark)).includes('Jump to latest message')) {
  console.error('FAIL: Ctrl+O entered inspection with nothing to inspect')
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
term.write('/plan\r')
if (!(await waitFor(() => cleanOutput(out).includes('Plan mode on.'), 'Plan mode', deadline))) {
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
term.write('\x1b[<64;10;5M')
mark = out.length
term.write('/settings\r')
if (!(await waitFor(() => out.slice(mark).includes('\x1b[?1006l\x1b[?1002l\x1b[?1000l') && cleanOutput(out.slice(mark)).includes('Settings'), 'settings suspends transcript mouse tracking', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1b[27u')
if (!(await waitFor(() => out.slice(mark).includes('\x1b[?1000h\x1b[?1002h\x1b[?1006h'), 'mouse restored after settings', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('/trajectory\r')
if (!(await waitFor(() => out.slice(mark).includes('\x1b[?1006l\x1b[?1002l\x1b[?1000l') && cleanOutput(out.slice(mark)).includes('Trajectory'), 'trajectory command owns the screen', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
term.write('\x1b[27u')
if (!(await waitFor(() => out.slice(mark).includes('\x1b[?1000h\x1b[?1002h\x1b[?1006h'), 'mouse restored after trajectory command', deadline))) {
  term.kill()
  process.exit(1)
}
mark = out.length
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
term.write('\x15/resume\r')
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
// unrelated full-output mode; the tool reader stands in for an overlay on exit.
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
if (!(await waitFor(() => cleanOutput(out.slice(mark)).includes('Tools'), 'composer restored before exit', deadline))) {
  console.error(cleanOutput(out.slice(mark)).slice(-2000))
  term.kill()
  process.exit(1)
}
// The reader owns Ctrl+C while it is open: the first closes it, the next two
// follow the shipped exit rule.
term.write('\x03')
await sleep(100)
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
  // Mouse reporting is only on while a frame owns it, so assert the shipped
  // invariant — it ends disabled — rather than that one particular surface turned
  // it off on the way out.
  && out.lastIndexOf('\x1b[?1006l\x1b[?1002l\x1b[?1000l') > out.lastIndexOf('\x1b[?1000h\x1b[?1002h\x1b[?1006h')
  // The header is a lockup now: the mark, its name and version, the slogan, and
  // one discovery hint. The recent-session list it used to carry is what `/resume`
  // covers instead, so this asserts the shipped shape rather than a list.
  && clean.includes('Into the Unknown')
  && clean.includes('Oh-My-DSH v')
  && clean.includes(' commands · ')
  && !clean.includes('Recent sessions')
  && clean.includes('hi')
  && clean.includes('error:')
  && clean.includes('deepseek-flash')
  && hasReasoningEffort(clean)
  && clean.includes('Agent: PTC')
  && clean.includes('ptc')
  && clean.includes('Agent: Minimal')
  && clean.includes('Agent: Cordis')
  && clean.includes('Plan mode on.')
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
