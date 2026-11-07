import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

it.each([false, true])('sends the edited rewind draft without replaying inherited inbox work (resume=%s)', async resume => {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-rewind-'))
  const workspace = join(root, 'workspace')
  const profile = join(root, 'profiles/omdsh')
  mkdirSync(workspace)
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n')
  const server = await startMockLlmServer({ port: 0, sequence: ['success'], repeatLast: true, successText: 'Done' })
  const app = fileURLToPath(new URL('../', import.meta.url))
  const tui = fileURLToPath(new URL('../../../packages/tui/omdsh-tui/src/', import.meta.url))
  const script = join(root, 'rewind.mjs')
  writeFileSync(script, `
    import { PassThrough } from 'node:stream';
    import { mountOmdsh } from ${JSON.stringify(pathToFileURL(join(app, 'src/boot.ts')).href)};
    import { SessionRuntime } from ${JSON.stringify(pathToFileURL(join(tui, 'session/session-controller.ts')).href)};
    import { LocalTui } from ${JSON.stringify(pathToFileURL(join(tui, 'runtime/provider-local.ts')).href)};
    const ctx = await mountOmdsh({ args: [], mode: 'exec', exit: code => { process.exitCode = code } });
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, destroy() {} });
    const terminal = new LocalTui({ input, output: { isTTY: true, write() {} }, width: () => 120, height: () => 28 },
      'model', false, 'dark', async () => {}, { deferInitialRender: true });
    input.write('\\x1b[?62;22c');
    const runtimeOptions = { stateDir: ${JSON.stringify(join(root, 'client'))} };
    let runtime = new SessionRuntime(ctx, terminal, runtimeOptions);
    const userTexts = agent => agent.session.snapshotEvents()
      .filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
      .map(event => event.data.content.filter(block => block.type === 'text').map(block => block.text).join(''));
    const pendingTexts = agent => [...agent.inbox.nextTurn, ...agent.inbox.nextStep]
      .map(message => message.content.filter(block => block.type === 'text').map(block => block.text).join(''));
    try {
      await runtime.start();
      await runtime.send({ text: 'DeepSeek Harness', images: [] }, runtime.agent);
      await runtime.agent.whenIdle();
      const original = runtime.agent.session;
      const originalEvents = original.snapshotEvents();
      let editing;
      const opened = Promise.withResolvers();
      const prompt = terminal.prompt.bind(terminal);
      terminal.prompt = (request, signal) => {
        const result = prompt(request, signal);
        opened.resolve();
        return result;
      };
      terminal.onRewind(() => { editing = runtime.openSessionTree(new AbortController().signal); });
      input.write('\\x1b\\x1b');
      await opened.promise;
      input.write('DeepSeek\\x1b[F\\r');
      await editing;
      const forkId = runtime.agent.id;
      const pendingAfterEdit = pendingTexts(runtime.agent);
      const inheritedCount = runtime.agent.session.inheritedEventCount;
      const inheritedPrefix = runtime.agent.session.snapshotEvents().slice(0, inheritedCount);
      const prefixPreserved = JSON.stringify(inheritedPrefix) === JSON.stringify(originalEvents.slice(0, inheritedCount));
      if (${resume}) {
        // Recreate the Agent from its stored log before submitting the restored draft.
        await runtime.dispose();
        runtime = new SessionRuntime(ctx, terminal, runtimeOptions);
        await runtime.start();
        await runtime.resumeSession(runtime.agent, forkId, new AbortController().signal);
      }
      const pendingAfterResume = pendingTexts(runtime.agent);
      const inputReady = terminal.readInput();
      input.write(' 支持么\\r');
      const submission = await inputReady;
      await runtime.send(submission, runtime.agent);
      await runtime.agent.whenIdle();
      console.log('REWIND_PROBE ' + JSON.stringify({ pendingAfterEdit, pendingAfterResume,
        submittedText: submission.text, messages: userTexts(runtime.agent), prefixPreserved,
        originalPreserved: JSON.stringify(original.snapshotEvents()) === JSON.stringify(originalEvents) }));
    } finally {
      await runtime.dispose();
      terminal.dispose();
      await ctx.fiber.dispose();
    }
  `)
  try {
    const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, script], {
      cwd: workspace,
      env: { ...process.env, OMDSH_HOME: root, NO_COLOR: '1', DEEPSEEK_BASE_URL: server.baseURL + '/v1', DEEPSEEK_API_KEY: 'sk-mock',
        NODE_PATH: fileURLToPath(new URL('../../../node_modules/.pnpm/node_modules', import.meta.url)) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', chunk => { output += String(chunk) })
    child.stderr.on('data', chunk => { output += String(chunk) })
    const status = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(output.slice(-5000))) }, 30_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', code => { clearTimeout(timer); resolve(code) })
    })
    expect(status, output.slice(-5000)).toBe(0)
    const line = output.split('\n').find(line => line.startsWith('REWIND_PROBE '))
    expect(line, output.slice(-5000)).toBeDefined()
    expect(JSON.parse(line!.slice('REWIND_PROBE '.length))).toEqual({
      pendingAfterEdit: [], pendingAfterResume: [], submittedText: 'DeepSeek Harness 支持么',
      messages: ['DeepSeek Harness 支持么'], prefixPreserved: true, originalPreserved: true,
    })
    expect(server.requests).toHaveLength(2)
    const body = server.requests[1]!.body as { messages: Array<{ role: string; content: unknown }> }
    const lastUser = body.messages.findLast(message => message.role === 'user')
    expect(JSON.stringify(lastUser?.content)).toContain('DeepSeek Harness 支持么')
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
}, 35_000)
