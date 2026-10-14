import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { readExecPrompt } from './exec.ts'

const repo = fileURLToPath(new URL('../../..', import.meta.url))
const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href
const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-exec-'))
  roots.push(root)
  const cwd = join(root, 'workspace'), home = join(root, 'home'), profile = join(home, 'profiles', 'omdsh')
  mkdirSync(cwd); mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n- id: agent-preset-registry\n  config:\n    default: standard\n')
  return { cwd, home }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function launch(cwd: string, home: string, baseURL: string, args: readonly string[], stdin = '') {
  const env = { ...process.env, OMDSH_HOME: home, NO_COLOR: '1', DEEPSEEK_API_KEY: 'sk-mock', DEEPSEEK_BASE_URL: baseURL + '/v1',
    NODE_PATH: join(repo, 'node_modules/.pnpm/node_modules') }
  for (const key of Object.keys(env)) if (key.startsWith('HERDR_')) delete (env as Record<string, unknown>)[key]
  const child = spawn(process.execPath, ['--import', loader, join(repo, 'apps/omdsh/src/bin.ts'), 'exec', '--json', ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += String(chunk) })
  child.stderr.on('data', chunk => { stderr += String(chunk) })
  child.stdin.end(stdin)
  const result = new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Exec CLI timed out:\n' + stdout.slice(-3000) + stderr.slice(-3000))) }, 30_000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('close', status => { clearTimeout(timeout); resolve({ status, stdout, stderr }) })
  })
  return { child, result, output: () => stdout }
}
function records(output: string) { return output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }

describe('exec prompt input', () => {
  it('keeps positional prompts literal without reading a still-open stdin', async () => {
    const input = new PassThrough()
    expect(await readExecPrompt(['!do not execute', '/clear'], input as never, new AbortController().signal)).toBe('!do not execute /clear')
    expect(input.destroyed).toBe(false)
    input.destroy()
  })
  it('reads one multiline UTF-8 prompt through EOF, including split code points', async () => {
    const input = new PassThrough()
    const reading = readExecPrompt(['-'], input as never, new AbortController().signal)
    const bytes = Buffer.from('第一行 🐳\n/clear\n!echo literal')
    input.write(bytes.subarray(0, 5)); input.end(bytes.subarray(5))
    expect(await reading).toBe('第一行 🐳\n/clear\n!echo literal')
  })
})

describe('independent exec CLI', () => {
  it('streams versioned JSON and returns the formal answer, session identity and Harness totals', async () => {
    const h = fixture()
    const server = await startMockLlmServer({ port: 0, sequence: ['success'], successText: 'Hello 中文 🐳', chunkSize: 2, chunkDelayMs: 10 })
    try {
      const result = await launch(h.cwd, h.home, server.baseURL, ['Say hello']).result
      expect(result.status, result.stderr + result.stdout).toBe(0)
      const rows = records(result.stdout)
      expect(rows.map(row => row.sequence)).toEqual(rows.map((_, at) => at + 1))
      expect(rows.every(row => row.schemaVersion === 1)).toBe(true)
      expect(rows[0].type).toBe('run.started')
      expect(rows.some(row => row.type === 'assistant.stream')).toBe(true)
      expect(rows.filter(row => row.type === 'run.finished')).toHaveLength(1)
      expect(rows.at(-1)).toMatchObject({ type: 'run.finished', data: { outcome: 'completed', exitCode: 0, text: 'Hello 中文 🐳', sessionTotals: { stats: { turns: 1, steps: 1 } } } })
      expect(rows.at(-1).data.sessionId).toMatch(/^session-/u)
      expect(result.stdout).not.toContain('\x1b')
      expect(result.stdout).not.toMatch(/Into the Unknown|Worked for|Resume this session|╭/u)
    } finally { await server.close() }
  }, 35_000)

  it('uses stdin as one prompt and resumes without replaying the earlier answer', async () => {
    const h = fixture()
    const server = await startMockLlmServer({ port: 0, sequence: ['success', 'success'], successText: 'FIRST' })
    try {
      const first = await launch(h.cwd, h.home, server.baseURL, ['-'], 'First\nmultiline prompt').result
      expect(first.status, first.stderr).toBe(0)
      const sessionId = records(first.stdout).at(-1).data.sessionId
      const next = await launch(h.cwd, h.home, server.baseURL, ['--resume', sessionId, 'Continue']).result
      expect(next.status, next.stderr + next.stdout).toBe(0)
      const rows = records(next.stdout)
      expect(rows.filter(row => row.type === 'assistant.message')).toHaveLength(1)
      expect(rows.some(row => row.type === 'session.resumed' && row.data.sessionId === sessionId)).toBe(true)
      expect(rows.at(-1).data.sessionTotals.stats.turns).toBe(2)
    } finally { await server.close() }
  }, 35_000)

  it('emits a failed final result and exit code 1 for an actual model error', async () => {
    const h = fixture()
    const result = await launch(h.cwd, h.home, 'http://127.0.0.1:9', ['Fail']).result
    expect(result.status, result.stderr).toBe(1)
    const rows = records(result.stdout)
    expect(rows.at(-1)).toMatchObject({ type: 'run.finished', data: { outcome: 'failed', exitCode: 1 } })
    expect(rows.at(-1).data.error.code).toBeTruthy()
  }, 35_000)

  it('returns a machine-readable invalid-input result before booting', async () => {
    const h = fixture()
    const result = await launch(h.cwd, h.home, 'http://127.0.0.1:9', []).result
    expect(result.status).toBe(2)
    expect(records(result.stdout).at(-1)).toMatchObject({ type: 'run.finished', data: { exitCode: 2, error: { code: 'INVALID_INPUT' } } })
    expect(existsSync(join(h.home, 'profiles/omdsh/package.json'))).toBe(false)
  })

  it('emits the actual tool call/result pair and completes after a read in the current sandbox', async () => {
    const h = fixture()
    writeFileSync(join(h.cwd, 'hello.txt'), 'Hello from a real file\n')
    const server = await startMockLlmServer({ port: 0, sequence: ['tool_call_success', 'success'], toolName: 'read',
      toolArguments: JSON.stringify({ file_path: 'hello.txt' }), successText: 'READ DONE' })
    try {
      const result = await launch(h.cwd, h.home, server.baseURL, ['Read hello.txt']).result
      expect(result.status, result.stderr + result.stdout).toBe(0)
      const rows = records(result.stdout)
      const call = rows.find(row => row.type === 'tool.started'), answer = rows.find(row => row.type === 'tool.finished')
      expect(call.data.name).toBe('read')
      expect(answer.data.message.toolCallId).toBe(call.data.callId)
      expect(JSON.stringify(answer.data.message.content)).toContain('Hello from a real file')
      expect(rows.at(-1).data.text).toBe('READ DONE')
    } finally { await server.close() }
  }, 35_000)

  it('returns requires_input for a model question rather than fabricating an answer', async () => {
    const h = fixture()
    const server = await startMockLlmServer({ port: 0, sequence: ['tool_call_success'], toolName: 'ask_user_question',
      toolArguments: JSON.stringify({ questions: [{ id: 'choice', question: 'Which approach?', options: [{ label: 'A' }, { label: 'B' }] }] }) })
    try {
      const result = await launch(h.cwd, h.home, server.baseURL, ['Ask me']).result
      expect(result.status, result.stderr + result.stdout).toBe(3)
      const rows = records(result.stdout)
      expect(rows.some(row => row.type === 'input.required' && row.data.kind === 'question')).toBe(true)
      expect(rows.at(-1)).toMatchObject({ type: 'run.finished', data: { outcome: 'requires_input', exitCode: 3, error: { code: 'REQUIRES_INPUT' } } })
      expect(server.requests).toHaveLength(1)
    } finally { await server.close() }
  }, 35_000)

  it('keeps approval fail-closed and redirects incidental plugin stdout to stderr', async () => {
    const h = fixture(), plugin = join(h.cwd, 'approval.mjs')
    writeFileSync(plugin, `export const inject = ['tools', 'approval']; export function apply(ctx) {
      process.stdout.write('INCIDENTAL_PLUGIN_LOG\\n');
      ctx.tools.register({name:'approval_probe', description:'Approval probe', parameters:{}, output:{schema:{type:'string'}, render:(_args,value)=>[{type:'text',text:value}]},
        async execute(_args,exec) { const result = await ctx.approval.request({agent:exec.agent,toolName:exec.name,callId:exec.callId,signal:exec.signal});
          if(result === 'allowed-once') { const fs = await import('node:fs'); fs.writeFileSync(${JSON.stringify(join(h.cwd, 'unexpected-write'))},'BAD'); } return result; }
      }); }`)
    writeFileSync(join(h.home, 'profiles/omdsh/cordis.patch.yml'), `- id: session-title-llm\n  disabled: true\n- insert:\n    - id: approval-probe\n      name: ${JSON.stringify(plugin)}\n`)
    const server = await startMockLlmServer({ port: 0, sequence: ['tool_call_success'], toolName: 'approval_probe', toolArguments: '{}' })
    try {
      const result = await launch(h.cwd, h.home, server.baseURL, ['Request approval']).result
      expect(result.status, result.stderr + result.stdout).toBe(3)
      const rows = records(result.stdout)
      expect(rows.some(row => row.type === 'input.required' && row.data.kind === 'approval')).toBe(true)
      expect(rows.some(row => row.type === 'approval.decided' && row.data.outcome === 'allowed-once')).toBe(false)
      expect(result.stderr).toContain('INCIDENTAL_PLUGIN_LOG')
      expect(result.stdout).not.toContain('INCIDENTAL_PLUGIN_LOG')
      expect(existsSync(join(h.cwd, 'unexpected-write'))).toBe(false)
    } finally { await server.close() }
  }, 35_000)

  it.runIf(process.platform !== 'win32').each(['SIGINT', 'SIGTERM'] as const)('emits one cancelled result and the conventional %s exit code', async signal => {
    const h = fixture()
    const server = await startMockLlmServer({ port: 0, sequence: ['slow_success'], successText: 'A very long response '.repeat(100), chunkSize: 1, chunkDelayMs: 100 })
    try {
      const running = launch(h.cwd, h.home, server.baseURL, ['Long response'])
      const deadline = Date.now() + 15_000
      while (!running.output().includes('assistant.stream') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
      expect(running.output()).toContain('assistant.stream')
      running.child.kill(signal)
      const result = await running.result
      const exitCode = signal === 'SIGINT' ? 130 : 143
      expect(result.status, result.stderr + result.stdout).toBe(exitCode)
      const rows = records(result.stdout)
      expect(rows.filter(row => row.type === 'run.finished')).toHaveLength(1)
      expect(rows.at(-1)).toMatchObject({ type: 'run.finished', data: { outcome: 'cancelled', exitCode } })
    } finally { await server.close() }
  }, 35_000)

  it('drains a managed child and the parent response after stdin EOF', async () => {
    const h = fixture()
    const server = await startMockLlmServer({ port: 0, sequence: ['tool_call_success', 'success'], repeatLast: true,
      toolName: 'subagent', toolArguments: JSON.stringify({ description: 'Child task', prompt: 'Reply with ok.' }), successText: 'CHILD AND PARENT DONE' })
    try {
      const result = await launch(h.cwd, h.home, server.baseURL, [], 'Delegate a child').result
      expect(result.status, result.stderr + result.stdout).toBe(0)
      const rows = records(result.stdout)
      expect(rows.some(row => row.type === 'assistant.message' && row.data.root === false)).toBe(true)
      expect(rows.at(-1).data.text).toBe('CHILD AND PARENT DONE')
      expect(server.requests.length).toBeGreaterThanOrEqual(3)
      expect(JSON.stringify(server.requests)).toContain('finished and will do no further work')
    } finally { await server.close() }
  }, 35_000)

  it('cancels cleanly when a pipeline closes stdout early', async () => {
    const h = fixture()
    const server = await startMockLlmServer({ port: 0, sequence: ['slow_success'], successText: 'Slow output '.repeat(100), chunkSize: 1, chunkDelayMs: 50 })
    try {
      const running = launch(h.cwd, h.home, server.baseURL, ['Stream'])
      const deadline = Date.now() + 15_000
      while (!running.output().includes('assistant.stream') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
      expect(running.output()).toContain('assistant.stream')
      running.child.stdout.destroy()
      const result = await running.result
      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).toMatch(/EPIPE|broken pipe/iu)
      expect(result.stderr).not.toContain('Unhandled')
    } finally { await server.close() }
  }, 35_000)

  it.each(['agent-default-model', 'session-projection'])('fails explicitly when the %s provider is disabled', async id => {
    const h = fixture()
    writeFileSync(join(h.home, 'profiles/omdsh/cordis.patch.yml'), `- id: session-title-llm\n  disabled: true\n- id: ${id}\n  disabled: true\n`)
    const result = await launch(h.cwd, h.home, 'http://127.0.0.1:9', ['Run']).result
    expect(result.status, result.stderr + result.stdout).toBe(1)
    expect(records(result.stdout).at(-1)).toMatchObject({ type: 'run.finished', data: { outcome: 'failed', exitCode: 1 } })
  }, 35_000)
})
