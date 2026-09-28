import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { writeTurnConfig } from './test-support/tui-boot.ts'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

const roots: string[] = []

function temp(name: string): string {
  const path = mkdtempSync(join(tmpdir(), name))
  roots.push(path)
  return path
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

/**
 * Boot omdsh in `workspace`, drive one turn, and resolve once `ready` appears in
 * the terminal output.
 *
 * stdin stays open for the whole turn: closing it makes the runner exit on EOF,
 * which races the turn and truncates the transcript before the settlement
 * rows are painted.
 */
async function runTurnUntil(options: {
  workspace: string
  home: string
  baseURL: string
  prompt: string
  ready: RegExp
}): Promise<{ status: number | null; clean: string }> {
  // The built bin is spawned directly rather than through `pnpm --dir`, which
  // re-roots the child's cwd at the app directory: the Session would then
  // start outside the fixture workspace and the fs sandbox would deny the
  // write this test is about.
  const child = spawn(process.execPath, [join(repoRoot, 'apps/omdsh/lib/bin.js')], {
    cwd: options.workspace,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OMDSH_HOME: options.home,
      NO_COLOR: '1',
      DEEPSEEK_BASE_URL: options.baseURL + '/v1',
      DEEPSEEK_API_KEY: 'sk-mock',
      // The fixture drives a real file write; the default workspace-write
      // preset stops at an approval prompt this non-interactive child can
      // never answer.
      OMDSH_PERMISSION_MODE: 'danger-full-access',
    },
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += String(chunk) })
  child.stderr.on('data', (chunk) => { output += String(chunk) })
  child.stdin.write(options.prompt + '\n')

  const settled = new Promise<number | null>((resolve) => {
    child.on('close', (code) => { resolve(code) })
  })
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const clean = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, '')
    if (options.ready.test(clean)) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  child.stdin.end()
  const status = await Promise.race([
    settled,
    new Promise<number | null>(resolve => setTimeout(() => { child.kill(); resolve(null) }, 20_000)),
  ])
  return { status, clean: output.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, '') }
}

describe('workspace changed-file summary', () => {
  it('names the files a turn wrote and their line counts', async () => {
    const workspace = temp('omdsh-ws-changes-workspace-')
    const home = temp('omdsh-ws-changes-home-')
    mkdirSync(join(workspace, 'src'), { recursive: true })
    writeFileSync(join(workspace, 'src', 'probe.ts'), 'export const before = 1\n')

    writeTurnConfig(home, 'standard')
    const server = await startMockLlmServer({
      port: 0,
      sequence: ['tool_call_success', 'success', 'success'],
      toolName: 'str_replace_editor',
      // `create` needs no prior read, so the fixture exercises one real file
      // write without also scripting a read turn.
      toolArguments: JSON.stringify({
        command: 'create',
        path: join(workspace, 'src', 'created.ts'),
        file_text: 'export const created = 1\nexport const second = 2\n',
      }),
      successText: 'done',
      chunkSize: 64,
      chunkDelayMs: 1,
    })

    try {
      const { clean } = await runTurnUntil({
        workspace, home, baseURL: server.baseURL,
        prompt: 'rewrite the probe file', ready: /done/,
      })
      // The changed-file block is a transcript row of its own, not a tool card.
      expect(clean).toMatch(/Changed 1 file \+\d/)
      expect(clean).toContain('src/created.ts')
    } finally {
      await server.close()
    }
  }, 180_000)
})
