/**
 * Boot the shipped CLI for one turn against the published mock LLM and return
 * what actually reached the wire. Shared by the specs that assert the
 * model-visible request facts of the composed session (tool catalog form and
 * shape), which a composition-level assertion cannot observe.
 * @module @agi-fans/oh-my-dsh/test-support
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))

/** One captured request body's model-visible tool names. */
export function requestToolNames(body: unknown): string[] {
  const tools = (body as { tools?: Array<{ function?: { name?: string } }> } | undefined)?.tools
  return (tools ?? []).map(tool => tool.function?.name ?? '').filter(name => name !== '')
}

/** Boot one turn with `preset` and return the captured request bodies plus output. */
export async function bootTuiTurn(options: {
  preset: string
  home: string
  input?: string
  extraEnv?: Record<string, string>
}): Promise<{ bodies: unknown[], output: string, status: number | null }> {
  // The published mock server implements only the chat-completions wire
  // protocol; the adapter defaults to Messages.
  writeFileSync(
    join(options.home, 'settings.yaml'),
    `agent-presets:\n  default: ${options.preset}\nllm-deepseek:\n  protocol: chat-completions\n`,
  )
  const server = await startMockLlmServer({
    port: 0,
    sequence: ['success'],
    successText: 'ok',
    chunkSize: 32,
    chunkDelayMs: 1,
  })
  const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'pnpm', '--dir', 'apps/omdsh', 'omdsh']
    : ['--dir', 'apps/omdsh', 'omdsh']
  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OMDSH_HOME: options.home,
      NO_COLOR: '1',
      DEEPSEEK_BASE_URL: server.baseURL + '/v1',
      DEEPSEEK_API_KEY: 'sk-mock',
      ...options.extraEnv,
    },
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += String(chunk) })
  child.stderr.on('data', (chunk) => { output += String(chunk) })
  child.stdin.end(options.input ?? 'ping\n')
  try {
    const status = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(null) }, 120_000)
      child.on('close', (code) => { clearTimeout(timer); resolve(code) })
    })
    return { bodies: server.requests.map(request => request.body), output, status }
  } finally {
    await server.close()
  }
}
