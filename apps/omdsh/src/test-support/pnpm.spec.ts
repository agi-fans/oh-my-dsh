import { expect, it } from 'vitest'
import { runTool } from './pnpm.ts'

it('keeps the test worker responsive while waiting for a process', async () => {
  let ticks = 0
  const heartbeat = setInterval(() => { ticks++ }, 5)
  try {
    const result = await runTool(process.execPath, ['-e', 'setTimeout(() => process.stdout.write("ready"), 80)'])
    expect(result.stdout).toBe('ready')
    expect(ticks).toBeGreaterThan(0)
  } finally { clearInterval(heartbeat) }
})

it('rejects a failed process while retaining its diagnostic output', async () => {
  await expect(runTool(process.execPath, ['-e', 'process.stdout.write("before failure"); process.stderr.write("failed"); process.exit(7)']))
    .rejects.toMatchObject({ code: 7, stdout: 'before failure', stderr: 'failed' })
})

it('passes executable arguments literally without command-shell interpretation', async () => {
  const literal = 'a & b > c "d"'
  const result = await runTool(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', literal])
  expect(result.stdout).toBe(literal)
})
