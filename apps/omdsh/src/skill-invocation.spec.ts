/** Skill discovery and user-only instruction loading through the shipped composition. */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

const repo = fileURLToPath(new URL('../../../', import.meta.url))

it('loads a user-only skill once for direct and inline calls with images and files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-skills-')), cwd = join(root, 'workspace'), profile = join(root, 'profiles/omdsh')
  mkdirSync(profile, { recursive: true })
  for (const name of ['manual-review', 'help']) {
    const skill = join(cwd, '.dsh/skills', name)
    mkdirSync(skill, { recursive: true })
    writeFileSync(join(skill, 'SKILL.md'), `---\nname: ${name}\ndescription: Review supplied material\ndisable-model-invocation: true\n---\n\nSKILL_INSTRUCTIONS_PROBE: review the supplied material.\n`)
  }
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n')
  const server = await startMockLlmServer({ port: 0, sequence: ['success', 'success'], successText: 'REVIEWED' })
  try {
    const source = (path: string) => JSON.stringify(pathToFileURL(join(repo, path)).href)
    const script = join(root, 'probe.mjs')
    writeFileSync(script, `
      import { PassThrough } from 'node:stream';
      import { mountOmdsh } from ${source('apps/omdsh/src/boot.ts')};
      import { SessionRuntime } from ${source('packages/tui/omdsh-tui/src/session/session-controller.ts')};
      import { LocalTui } from ${source('packages/tui/omdsh-tui/src/runtime/provider-local.ts')};
      const ctx = await mountOmdsh({ args: [], mode: 'exec', exit: code => { process.exitCode = code } });
      const tui = new LocalTui({ input: new PassThrough(), output: { isTTY: false, write() {} }, width: () => 80, height: () => 24 }, 'mock', false);
      const runtime = new SessionRuntime(ctx, tui, { stateDir: ${JSON.stringify(root)} });
      const catalogs = []; const setCommands = tui.setCommands.bind(tui); tui.setCommands = rows => { catalogs.push(rows); setCommands(rows) };
      try {
        await runtime.start();
        const file = await ctx.attachments.saveFile({ data: new TextEncoder().encode('SUPPLIED_FILE'), name: 'note.txt', mediaType: 'text/plain' });
        const image = { mediaType: 'image/png', data: new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')) };
        const rejectedAlias = await runtime.execute('/skill:manual-review', new AbortController().signal);
        const results = [];
        for (const text of ['/manual-review TASK_PROBE', 'Please use /help TASK_PROBE']) {
          if (results.length) await runtime.newSession(runtime.agent);
          const submission = { text, images: [image], files: [file], segments: [
            { kind: 'text', text }, { kind: 'image', index: 0 }, { kind: 'text', text: ' AFTER_IMAGE' }, { kind: 'file', index: 0 }
          ] };
          if (text.startsWith('/')) await runtime.execute(submission, new AbortController().signal);
          else await runtime.send(submission);
          await runtime.agent.whenIdle();
          results.push({ text, messages: runtime.agent.session.deriveMessages() });
        }
        console.log('SKILL_PROBE ' + JSON.stringify({ catalogs, rejectedAlias, results }));
      } finally { await runtime.dispose(); tui.dispose(); await ctx.fiber.dispose() }
    `)
    const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, script], {
      cwd, env: { ...process.env, OMDSH_HOME: root, NO_COLOR: '1', DEEPSEEK_API_KEY: 'sk-mock', DEEPSEEK_BASE_URL: server.baseURL + '/v1', NODE_PATH: join(repo, 'node_modules/.pnpm/node_modules') },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''; child.stdout.on('data', chunk => { output += String(chunk) }); child.stderr.on('data', chunk => { output += String(chunk) })
    const status = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(output.slice(-3000))) }, 40_000)
      child.once('error', error => { clearTimeout(timer); reject(error) }); child.once('close', code => { clearTimeout(timer); resolve(code) })
    })
    expect(status, output.slice(-3000)).toBe(0)
    const line = output.split('\n').find(line => line.startsWith('SKILL_PROBE '))
    expect(line, output.slice(-3000)).toBeDefined()
    const probe = JSON.parse(line!.slice('SKILL_PROBE '.length))
    expect(probe.catalogs.flat()).toContainEqual(expect.objectContaining({ name: 'manual-review', skill: { userOnly: true } }))
    expect(probe.catalogs.flat().some((row: { skill?: unknown; name: string }) => row.skill !== undefined && row.name === 'help')).toBe(false)
    expect(probe.rejectedAlias).toBe(false)
    expect(probe.results).toHaveLength(2)
    for (const result of probe.results) {
      const message = result.messages.find((message: { source?: { kind: string } }) => message.source?.kind === 'user')
      expect(message.content.map((block: { type: string }) => block.type)).toEqual(['text', 'image', 'text', 'file'])
      expect(message.content[0].text).toBe(result.text)
    }
    expect(server.requests).toHaveLength(2)
    for (const [index, request] of server.requests.entries()) {
      const body = JSON.stringify(request.body)
      expect(body.match(/SKILL_INSTRUCTIONS_PROBE/g)).toHaveLength(1)
      expect(body).toContain(probe.results[index].text)
      expect(body).toContain('AFTER_IMAGE')
      expect(body).toContain('note.txt')
      expect(body).toContain('image')
    }
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }) }
}, 50_000)
