import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

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

/** Write a Profile patch that selects a preset and may disable rows. */
function writePatch(home: string, disabled: readonly string[]): void {
  const dir = join(home, 'profiles', 'omdsh')
  mkdirSync(dir, { recursive: true })
  const rows = disabled.map(id => `- id: ${id}\n  disabled: true\n`).join('')
  writeFileSync(join(dir, 'cordis.patch.yml'), [
    '- id: agent-preset-registry',
    '  config:',
    '    default: standard',
    ...(rows === '' ? [] : ['\n' + rows]),
  ].join('\n'))
}

async function runFileWritingTurn(workspace: string, home: string, baseURL: string): Promise<string> {
  mkdirSync(join(workspace, 'src'), { recursive: true })
  writeFileSync(join(workspace, 'src', 'probe.ts'), 'export const before = 1\n')
  // The built bin is spawned directly: `pnpm --dir` re-roots the child's cwd at
  // the app directory, which would put the Session outside the fixture and make
  // the fs sandbox deny the write.
  const child = spawn(process.execPath, [join(repoRoot, 'apps/omdsh/lib/bin.js')], {
    cwd: workspace,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OMDSH_HOME: home,
      NO_COLOR: '1',
      DEEPSEEK_BASE_URL: baseURL + '/v1',
      DEEPSEEK_API_KEY: 'sk-mock',
      OMDSH_PERMISSION_MODE: 'danger-full-access',
    },
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += String(chunk) })
  child.stderr.on('data', (chunk) => { output += String(chunk) })
  child.stdin.write('rewrite the probe file\n')
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (output.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, '').includes('DONE')) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  child.stdin.end()
  await Promise.race([
    new Promise(resolve => child.on('close', resolve)),
    new Promise(resolve => setTimeout(() => { child.kill(); resolve(undefined) }, 20_000)),
  ])
  return output.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, '')
}

describe('Profile patch feature toggles', () => {
  it('stops the changed-file summary when the patch disables its row', async () => {
    const workspace = temp('omdsh-toggle-workspace-')
    const home = temp('omdsh-toggle-home-')
    writePatch(home, ['workspace-changes'])
    const live = await startMockLlmServer({
      port: 0,
      sequence: ['tool_call_success', 'success', 'success'],
      toolName: 'str_replace_editor',
      toolArguments: JSON.stringify({
        command: 'create',
        path: join(workspace, 'src', 'created.ts'),
        file_text: 'export const created = 1\n',
      }),
      successText: 'DONE',
      chunkSize: 64,
      chunkDelayMs: 1,
    })
    try {
      const clean = await runFileWritingTurn(workspace, home, live.baseURL)
      // The turn still runs and writes the file; only the summary is absent.
      expect(clean).not.toMatch(/Changed 1 file/)
      expect(clean).not.toContain('Workspace changes recorded for turn')
      expect(readFileSync(join(workspace, 'src', 'created.ts'), 'utf8')).toContain('created')
    } finally {
      await live.close()
    }
  }, 180_000)
})
