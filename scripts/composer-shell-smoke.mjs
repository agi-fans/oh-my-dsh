// Deliberate Composer input over the shipped CLI and published persistent PTY.
import { createRequire } from 'node:module'
import { cleanOutput, omdshCommand, repoRoot, sleep, smokeEnv, smokeHome, waitFor } from './smoke-lib.mjs'

const require = createRequire(import.meta.url)
const pty = require('node-pty')
const command = omdshCommand()
const home = smokeHome('omdsh-composer-shell-')
const term = pty.spawn(command[0], command[1], { name: 'xterm-256color', cols: 100, rows: 30, cwd: repoRoot,
  env: smokeEnv(home, { DEEPSEEK_API_KEY: 'sk-invalid-shell-only', DEEPSEEK_BASE_URL: 'http://127.0.0.1:9/v1' }) })
let output = '', exitCode = null
term.onData(data => { output += data })
term.onExit(event => { exitCode = event.exitCode })
const deadline = Date.now() + 60_000
async function check(predicate, label) {
  if (await waitFor(predicate, label, deadline)) return
  console.error(cleanOutput(output).slice(-5000))
  term.kill()
  process.exit(1)
}

try {
  await check(() => cleanOutput(output).includes('Into the Unknown'), 'startup')
  // A short bracketed paste must stay ordinary text, even with a leading !.
  let mark = output.length
  term.write('\x1b[200~!echo PASTE_SHOULD_NOT_RUN\x1b[201~')
  await check(() => cleanOutput(output.slice(mark)).includes('PASTE_SHOULD_NOT_RUN'), 'pasted draft')
  term.write('\x03')
  await sleep(600)
  mark = output.length
  const assign = process.platform === 'win32'
    ? "$env:OMDSH_COMPOSER_VALUE='OMDSH_' + 'COMPOSER_STATE_READY'"
    : 'export OMDSH_COMPOSER_VALUE=OMDSH_$(printf COMPOSER_STATE_READY)'
  term.write(`!${assign}\r`)
  await check(() => cleanOutput(output.slice(mark)).includes('Terminal · Composer shell'), 'Composer Shell reader')
  await check(() => cleanOutput(output.slice(mark)).includes('Ctrl+C interrupt'), 'Shell interrupt hint')
  await sleep(500)
  term.write('\x1b[27u')
  await sleep(150)
  mark = output.length
  term.write(process.platform === 'win32' ? '!Write-Output $env:OMDSH_COMPOSER_VALUE\r' : '!echo "$OMDSH_COMPOSER_VALUE"\r')
  await check(() => cleanOutput(output.slice(mark)).includes('OMDSH_COMPOSER_STATE_READY'), 'persistent environment across Composer calls')
  await sleep(200)
  term.write('\x1b[27u')
  await sleep(150)
  mark = output.length
  term.write('!node -e "setInterval(()=>{},1000)"\r')
  await check(() => cleanOutput(output.slice(mark)).includes('Terminal · Composer shell'), 'long command reader')
  term.write('\x03')
  await sleep(600)
  // The established second Ctrl+C exits and drains all owner-scoped PTYs.
  term.write('\x03')
  await sleep(100)
  term.write('\x03')
  await check(() => exitCode !== null, 'terminal restoration and exit')
  if (exitCode !== 0 || cleanOutput(output).includes('Deep Driving') || cleanOutput(output).includes('PASTE_SHOULD_NOT_RUN\n')) {
    throw new Error(`Unexpected Shell-only lifecycle (exit=${exitCode})`)
  }
  console.log('COMPOSER_SHELL_SMOKE_PASS persistent-state=pass interrupt=pass exit=0')
} finally { if (exitCode === null) term.kill() }
