/**
 * Boot the shipped CLI for one turn against the published mock LLM and return
 * what actually reached the wire. Shared by the specs that assert the
 * model-visible request facts of the composed session (tool catalog form and
 * shape), which a composition-level assertion cannot observe.
 * @module @agi-fans/oh-my-dsh/test-support
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))

/**
 * Point one booted turn at an Agent preset. Row configuration rides the
 * Profile patch — the layer the harness reloads and `config-editor` writes —
 * because plugin configuration is no longer read from a settings document.
 * @param home - the `OMDSH_HOME` the turn boots with.
 * @param preset - Agent preset id the registry selects when none is requested.
 */
export function writeTurnConfig(home: string, preset: string): void {
  const dir = join(home, 'profiles', 'omdsh')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'cordis.patch.yml'), [
    '- id: agent-preset-registry',
    '  config:',
    `    default: ${preset}`,
    '',
  ].join('\n'))
}

/**
 * One captured request body's model-visible tool names. The adapter speaks the
 * Messages wire, where a tool names itself at the top level.
 */
export function requestToolNames(body: unknown): string[] {
  const tools = (body as { tools?: Array<{ name?: string }> } | undefined)?.tools
  return (tools ?? []).map(tool => tool.name ?? '').filter(name => name !== '')
}

async function startScriptedToolServer(
  calls: ReadonlyArray<{ name: string; arguments: string }>,
): Promise<{ baseURL: string; requests: unknown[]; close(): Promise<void> }> {
  const requests: unknown[] = []
  let index = 0
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => { raw += String(chunk) })
    req.on('end', () => {
      try { requests.push(JSON.parse(raw)) } catch { requests.push(raw) }
      const call = calls[index++]
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const emit = (payload: Record<string, unknown>) => {
        res.write(`event: ${String(payload.type)}\ndata: ${JSON.stringify(payload)}\n\n`)
      }
      emit({
        type: 'message_start',
        message: { id: `msg_${index}`, type: 'message', role: 'assistant', model: 'deepseek-flash', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } },
      })
      if (call !== undefined) {
        emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${index}`, name: call.name, input: {} } })
        emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: call.arguments } })
        emit({ type: 'content_block_stop', index: 0 })
        emit({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } })
      } else {
        emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
        emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } })
        emit({ type: 'content_block_stop', index: 0 })
        emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } })
      }
      emit({ type: 'message_stop' })
      res.end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    baseURL: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

/** Boot one turn with `preset` and return the captured request bodies plus output. */
export async function bootTuiTurn(options: {
  preset: string
  home: string
  input?: string
  extraEnv?: Record<string, string>
  toolCall?: { name: string; arguments: string }
  toolCalls?: ReadonlyArray<{ name: string; arguments: string }>
  patch?: string
  repeatLast?: boolean
  cwd?: string
}): Promise<{ bodies: unknown[], output: string, status: number | null }> {
  writeTurnConfig(options.home, options.preset)
  // Disable background session-title LLM calls so they never race ahead of the
  // main turn request and steal `bodies[0]` (or mock sequence slots) under load.
  appendFileSync(join(options.home, 'profiles', 'omdsh', 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n')
  if (options.patch !== undefined) appendFileSync(join(options.home, 'profiles', 'omdsh', 'cordis.patch.yml'), options.patch)
  const scripted = options.toolCalls !== undefined ? await startScriptedToolServer(options.toolCalls) : undefined
  const server = scripted === undefined ? await startMockLlmServer({
    port: 0,
    sequence: options.toolCall === undefined ? ['success'] : ['tool_call_success', 'success'],
    ...(options.toolCall === undefined ? {} : { toolName: options.toolCall.name, toolArguments: options.toolCall.arguments }),
    successText: 'ok',
    repeatLast: options.repeatLast ?? false,
    chunkSize: 32,
    chunkDelayMs: 1,
  }) : undefined
  const baseURL = scripted?.baseURL ?? server!.baseURL
  const command = options.cwd !== undefined ? process.execPath : process.platform === 'win32' ? 'cmd.exe' : 'pnpm'
  const args = options.cwd !== undefined ? ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, fileURLToPath(new URL('../bin.ts', import.meta.url))] : process.platform === 'win32'
    ? ['/d', '/s', '/c', 'pnpm', '--dir', 'apps/omdsh', 'omdsh']
    : ['--dir', 'apps/omdsh', 'omdsh']
  const inheritedEnv: NodeJS.ProcessEnv = { ...process.env }
  delete inheritedEnv.TMUX
  delete inheritedEnv.TMUX_PANE
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...inheritedEnv,
      OMDSH_HOME: options.home,
      NO_COLOR: '1',
      DEEPSEEK_BASE_URL: baseURL + '/v1',
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
    return { bodies: scripted?.requests ?? server!.requests.map(request => request.body), output, status }
  } finally {
    await (scripted?.close() ?? server!.close())
  }
}
