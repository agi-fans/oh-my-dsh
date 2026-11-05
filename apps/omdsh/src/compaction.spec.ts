/** Published compaction transactions, queue ordering and durable resume. */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
const repo = fileURLToPath(new URL('../../../', import.meta.url))

it.each(['success', 'failure', 'cancel'] as const)('preserves compaction %s behavior and cold replay', async outcome => {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-compact-')), cwd = join(root, 'workspace'), profile = join(root, 'profiles/omdsh')
  mkdirSync(cwd); mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n- id: llm-retry\n  disabled: true\n- id: compaction\n  config:\n    auto: false\n    retainTokens: 1\n    headroomTokens: 0\n    maxTokens: 256\n')
  const server = await startMockLlmServer({ port: 0, sequence: ['success', outcome === 'failure' ? 'server_error' : 'slow_success', 'success'],
    successText: 'SUMMARY_PROBE 中文', chunkSize: 1, chunkDelayMs: 20 })
  const run = async (id?: string) => {
    const source = (path: string) => JSON.stringify(pathToFileURL(join(repo, path)).href)
    const file = join(root, id === undefined ? 'live.mjs' : 'resume.mjs')
    writeFileSync(file, `
      import { PassThrough } from 'node:stream';
      import { mountOmdsh } from ${source('apps/omdsh/src/boot.ts')};
      import { SessionRuntime } from ${source('packages/tui/omdsh-tui/src/session/session-controller.ts')};
      import { LocalTui } from ${source('packages/tui/omdsh-tui/src/runtime/provider-local.ts')};
      import { replayEvents } from ${source('packages/tui/omdsh-tui/src/views/event-views.ts')};
      const ctx = await mountOmdsh({ args: [], mode: 'exec', exit: code => { process.exitCode = code } });
      const tui = new LocalTui({ input: new PassThrough(), output: { isTTY: false, write() {} }, width: () => 80, height: () => 24 }, 'mock', false);
      const outputs = []; tui.commandOutput = (...args) => outputs.push(args);
      const runtime = new SessionRuntime(ctx, tui, { stateDir: ${JSON.stringify(root)} });
      try {
        await runtime.start();
        ${id === undefined ? '' : `await runtime.resumeSession(runtime.agent, ${JSON.stringify(id)}, new AbortController().signal);`}
        const agent = runtime.agent;
        if (${id === undefined}) {
          await runtime.send('ORIGINAL ' + 'long retained conversation context '.repeat(800)); await agent.whenIdle();
          const abort = new AbortController();
          let queued; const off = ctx.on('session/event', (session, event) => {
            if (session === agent.session && event.type === 'compaction/start') {
              if (${JSON.stringify(outcome)} === 'cancel') abort.abort();
              else if (${JSON.stringify(outcome)} === 'success') queued = runtime.send('AFTER_CHECKPOINT');
            }
          });
          try { await runtime.execute('/compact', abort.signal) } catch (error) { if (!abort.signal.aborted) throw error } off(); await queued; await agent.whenIdle();
        }
        const events = agent.session.snapshotEvents();
        console.log('COMPACT_PROBE ' + JSON.stringify({ id: agent.id, outputs,
          blocks: replayEvents(events).blocks.filter(b => b.kind === 'notice'),
          summaries: events.filter(e => e.type === 'compaction/summary').map(e => e.seq),
          endings: events.filter(e => e.type === 'compaction/end').map(e => ({ seq:e.seq, error:e.data.error })),
          users: events.filter(e => e.type === 'user/message' && e.data.source.kind === 'user').map(e => ({seq:e.seq,text:e.data.content[0]?.text})),
          results: events.filter(e => e.type === 'command/done').map(e => e.data),
          transcript: agent.session.deriveMessages() }));
      } finally { await runtime.dispose(); tui.dispose(); await ctx.fiber.dispose() }
    `)
    const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, file], {
      cwd, env: { ...process.env, OMDSH_HOME: root, NO_COLOR: '1', DEEPSEEK_BASE_URL: server.baseURL + '/v1', DEEPSEEK_API_KEY: 'sk-mock', NODE_PATH: join(repo, 'node_modules/.pnpm/node_modules') }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''; child.stdout.on('data', chunk => { output += String(chunk) }); child.stderr.on('data', chunk => { output += String(chunk) })
    const status = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(output.slice(-3000))) }, 30_000)
      child.once('error', e => { clearTimeout(timer); reject(e) }); child.once('close', code => { clearTimeout(timer); resolve(code) })
    })
    expect(status, output.slice(-3000)).toBe(0)
    const line = output.split('\n').find(line => line.startsWith('COMPACT_PROBE '))
    expect(line, output.slice(-3000)).toBeDefined()
    return JSON.parse(line!.slice('COMPACT_PROBE '.length))
  }
  try {
    const live = await run(), resumed = await run(live.id)
    expect(resumed.blocks).toEqual(live.blocks)
    expect(resumed.summaries).toEqual(live.summaries)
    if (outcome === 'success') {
      expect(live.summaries).toHaveLength(1)
      expect(live.outputs).toEqual([])
      expect(live.blocks).toContainEqual(expect.objectContaining({ detail: 'SUMMARY_PROBE 中文' }))
      expect(live.users.filter((m: {text:string}) => m.text === 'AFTER_CHECKPOINT')).toHaveLength(1)
      expect(live.users.at(-1).seq).toBeGreaterThan(live.endings[0].seq)
      expect(JSON.stringify(server.requests.at(-1)!.body)).toContain('SUMMARY_PROBE')
      expect(JSON.stringify(server.requests.at(-1)!.body)).not.toContain('long retained conversation context')
    } else {
      expect(live.summaries).toEqual([])
      expect(live.results.at(-1).kind).toBe('error')
      expect(JSON.stringify(resumed.transcript)).toContain('long retained conversation context')
    }
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }) }
}, 65_000)
