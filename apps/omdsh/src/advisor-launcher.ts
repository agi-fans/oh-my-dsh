/** Preserve native stdio under a pre-established Harness process sandbox. */
import { spawn } from 'node:child_process'

const [program, ...args] = process.argv.slice(2)
if (program === undefined) process.exit(1)
const child = spawn(program, args, { stdio: 'inherit', shell: false })
child.on('error', () => { process.exitCode = 1 })
child.on('exit', (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
