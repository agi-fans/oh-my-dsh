// Interactive streaming interruption e2e: a separate local SSE process emits
// a dense reasoning burst and keeps the request open. The real PTY must deliver
// Ctrl-C promptly while the TUI is folding and rendering that burst.
// Run: node scripts/stream-interrupt-smoke.mjs

import { fork } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REASONING_CHARS = 5_000
const INTERRUPT_BUDGET_MS = 1_000

if (process.argv[2] === 'server') {
  const sockets = new Set()
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const reasoning = 'issuefour '.repeat(Math.ceil(REASONING_CHARS / 10)).slice(0, REASONING_CHARS)
    for (const character of reasoning) {
      response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: character }, finish_reason: null }] })}\n\n`)
    }
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock server did not bind a TCP port')
  process.send?.({ baseURL: `http://127.0.0.1:${address.port}` })
  process.on('message', async message => {
    if (message !== 'close') return
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
    process.exit(0)
  })
  await new Promise(() => {})
}

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const pty = require('node-pty')
const omdshHome = mkdtempSync(join(tmpdir(), 'omdsh-stream-interrupt-'))
const server = fork(fileURLToPath(import.meta.url), ['server'], {
  cwd: root,
  stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
})

let term
try {
  const baseURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('mock server startup timeout')), 10_000)
    server.once('message', message => {
      clearTimeout(timer)
      if (typeof message !== 'object' || message === null || typeof message.baseURL !== 'string') {
        reject(new Error('mock server returned an invalid address'))
        return
      }
      resolve(message.baseURL)
    })
  })

  term = pty.spawn('pnpm', ['--dir', 'apps/omdsh', 'omdsh'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 30,
    cwd: root,
    env: {
      ...process.env,
      OMDSH_HOME: omdshHome,
      DEEPSEEK_BASE_URL: baseURL + '/v1',
      DEEPSEEK_API_KEY: 'sk-mock',
      NO_COLOR: '1',
    },
  })

  let out = ''
  let submitted = false
  let ctrlCAt
  let interruptedAt
  term.onData(data => {
    out += data
    if (!submitted && out.includes('deepseek-v4-flash')) {
      submitted = true
      term.write('exercise streaming interruption\r')
    }
    if (submitted && ctrlCAt === undefined && out.includes('issuefour')) {
      ctrlCAt = performance.now()
      term.write('\x03')
    }
    if (ctrlCAt !== undefined && interruptedAt === undefined && out.includes('interrupted')) {
      interruptedAt = performance.now()
    }
  })

  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && interruptedAt === undefined) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  const latency = interruptedAt === undefined || ctrlCAt === undefined
    ? Number.POSITIVE_INFINITY
    : interruptedAt - ctrlCAt
  if (!Number.isFinite(latency) || latency >= INTERRUPT_BUDGET_MS) {
    console.error(`FAIL: Ctrl-C latency=${Number.isFinite(latency) ? Math.round(latency) + 'ms' : 'not observed'}`)
    console.error(out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '').slice(-1_500))
    process.exitCode = 1
  } else {
    console.log(`STREAM_INTERRUPT_SMOKE_PASS latency=${Math.round(latency)}ms`)
  }
} finally {
  term?.kill()
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve))
    if (server.connected) server.send('close')
    else server.kill()
    await exited
  }
  rmSync(omdshHome, { recursive: true, force: true })
}
