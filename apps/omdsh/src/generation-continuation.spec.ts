/** Real provider failures and cold resume through the published Harness composition. */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
it('continues a cold failed generation once, preserves attachment retry, and rejects interrupted work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-continuation-')), workspace = join(root, 'workspace'), profile = join(root, 'profiles/omdsh')
  mkdirSync(workspace); mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n- id: llm-retry\n  disabled: true\n')
  const server = await startMockLlmServer({ port: 0, sequence: ['server_error', 'success', 'success', 'slow_success'], successText: 'CONTINUED', chunkSize: 1, chunkDelayMs: 30 })
  const run = async (resumeId?: string) => {
    const script = join(root, resumeId === undefined ? 'fail.mjs' : 'continue.mjs')
    const source = (path: string) => JSON.stringify(pathToFileURL(join(repo, path)).href)
    writeFileSync(script, `
      import { PassThrough } from 'node:stream';
      import { mountOmdsh } from ${source('apps/omdsh/src/boot.ts')};
      import { SessionRuntime } from ${source('packages/tui/omdsh-tui/src/session/session-controller.ts')};
      import { LocalTui } from ${source('packages/tui/omdsh-tui/src/runtime/provider-local.ts')};
      import { continuableFailure } from ${source('packages/tui/omdsh-tui/src/session/generation-continuation.ts')};
      const ctx = await mountOmdsh({ args: [], mode: 'exec', exit: code => { process.exitCode = code } });
      const tui = new LocalTui({ input: new PassThrough(), output: { isTTY: false, write() {} }, width: () => 80, height: () => 24 }, 'mock', false);
      const runtime = new SessionRuntime(ctx, tui, { stateDir: ${JSON.stringify(root)} });
      try {
        await runtime.start();
        ${resumeId === undefined ? '' : `await runtime.resumeSession(runtime.agent, ${JSON.stringify(resumeId)}, new AbortController().signal);`}
        const agent = runtime.agent;
        if (${resumeId === undefined}) {
          const file = await ctx.attachments.saveFile({ data: new TextEncoder().encode('attachment body'), name: 'note.txt', mediaType: 'text/plain' });
          await runtime.send({ text: 'ORIGINAL_PROMPT', images: [], files: [file] }); await agent.whenIdle();
          console.log('CONTINUATION_PROBE ' + JSON.stringify({ id: agent.id, failure: continuableFailure(agent.session.snapshotEvents()), end: agent.session.snapshotEvents().findLast(e => e.type === 'turn/end') }));
        } else {
          const before = agent.session.snapshotEvents(); const failure = continuableFailure(before);
          const duplicate = await Promise.allSettled([runtime.continueGeneration(agent, failure), runtime.continueGeneration(agent, failure)]);
          await agent.whenIdle();
          let staleRejected = false; try { await runtime.continueGeneration(agent, failure) } catch { staleRejected = true }
          await runtime.retryLastPrompt(agent); await agent.whenIdle();
          const off = ctx.on('agent/assistant-stream', payload => {
            if (payload.agent === agent && payload.frame.type === 'chunk') agent.cancel({ kind: 'user' }, { keepInbox: true });
          }, { global: true });
          await runtime.send('INTERRUPT_ME'); await agent.whenIdle(); off();
          let interruptedRejected = false; try { await runtime.continueGeneration(agent) } catch { interruptedRejected = true }
          const events = agent.session.snapshotEvents();
          console.log('CONTINUATION_PROBE ' + JSON.stringify({ failure, duplicate: duplicate.map(r => r.status), staleRejected, interruptedRejected,
            human: events.filter(e => e.type === 'user/message' && e.data.source.kind === 'user').map(e => e.data),
            retry: events.filter(e => e.type === 'user/message' && e.data.source.kind === 'retry').map(e => e.data),
            endings: events.filter(e => e.type === 'turn/end').map(e => e.data.reason) }));
        }
      } finally { await runtime.dispose(); tui.dispose(); await ctx.fiber.dispose() }
    `)
    const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, script], {
      cwd: workspace, env: { ...process.env, OMDSH_HOME: root, NO_COLOR: '1', DEEPSEEK_BASE_URL: server.baseURL + '/v1', DEEPSEEK_API_KEY: 'sk-mock', NODE_PATH: join(repo, 'node_modules/.pnpm/node_modules') }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', chunk => { output += String(chunk) }); child.stderr.on('data', chunk => { output += String(chunk) })
    const status = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(output.slice(-5000))) }, 30_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', code => { clearTimeout(timer); resolve(code) })
    })
    expect(status, output.slice(-5000)).toBe(0)
    const line = output.split('\n').find(line => line.startsWith('CONTINUATION_PROBE '))
    expect(line, output.slice(-5000)).toBeDefined()
    return JSON.parse(line!.slice('CONTINUATION_PROBE '.length))
  }
  try {
    const failed = await run()
    expect(failed.failure, JSON.stringify(failed)).toEqual(expect.any(Number))
    const resumed = await run(failed.id)
    expect(resumed.failure).toBe(failed.failure)
    expect(resumed.duplicate.sort()).toEqual(['fulfilled', 'rejected'])
    expect(resumed.staleRejected).toBe(true)
    expect(resumed.interruptedRejected).toBe(true)
    expect(resumed.retry).toHaveLength(1)
    expect(resumed.retry[0].content).toEqual([])
    expect(resumed.human).toHaveLength(3)
    expect(resumed.human[0].content).toEqual(resumed.human[1].content)
    expect(resumed.human[0].id).not.toBe(resumed.human[1].id)
    expect(resumed.human[0].content.some((block: { type: string }) => block.type === 'file')).toBe(true)
    expect(resumed.endings.map((reason: { kind: string }) => reason.kind)).toEqual(['error', 'completed', 'completed', 'aborted'])
    expect(server.requests).toHaveLength(4)
    const wire = JSON.stringify(server.requests[1]!.body)
    expect(wire.split('ORIGINAL_PROMPT')).toHaveLength(2)
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }) }
}, 70_000)
