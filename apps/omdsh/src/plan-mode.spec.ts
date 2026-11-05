/** Published Harness state, review outcomes and durable plan presentation through the product composition. */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { requestToolNames } from './test-support/tui-boot.ts'

const app = fileURLToPath(new URL('../', import.meta.url))
const tui = fileURLToPath(new URL('../../../packages/tui/omdsh-tui/src/', import.meta.url))
const plan = '# Durable Plan 原文\n\n' + Array.from({ length: 70 }, (_, index) => `- Step ${index + 1}`).join('\n')

describe('Plan behavior through the shipped composition', () => {
  it.each([
    ['standard', 'approve'], ['standard', 'revise'], ['standard', 'dismiss'], ['code', 'approve'],
  ])('preserves %s/%s semantics across review, fork and cold resume', async (preset, outcome) => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-plan-')), workspace = join(root, 'workspace'), profile = join(root, 'profiles/omdsh')
    mkdirSync(workspace); mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n')
    const args = { plan }
    const server = await startMockLlmServer({ port: 0, sequence: ['success', 'tool_call_success', 'success'], successText: 'FINISHED',
      toolName: preset === 'standard' ? 'exit_plan_mode' : 'run_code',
      toolArguments: JSON.stringify(preset === 'standard' ? args : { description: 'Submit a plan', code: `return await tools.exit_plan_mode(${JSON.stringify(args)})` }),
    })
    const run = async (resume: boolean) => {
      const script = join(root, resume ? 'resume.mjs' : 'review.mjs')
      writeFileSync(script, `
        import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
        import { mountOmdsh } from ${JSON.stringify(pathToFileURL(join(app, 'src/boot.ts')).href)};
        import { bindHumanInteraction } from ${JSON.stringify(pathToFileURL(join(tui, 'session/interaction-adapter.ts')).href)};
        import { createToolPresentationBridge } from ${JSON.stringify(pathToFileURL(join(tui, 'runtime/tool-presentation.ts')).href)};
        const require = createRequire(${JSON.stringify(join(app, 'package.json'))});
        const { configureAgentContext } = await import(pathToFileURL(require.resolve('@agi-fans/dsh-tui/agent-profile')).href);
        const { createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
        const ctx = await mountOmdsh({ args: [], mode: 'exec', exit: code => { process.exitCode = code } });
        const setup = async (scope, agent) => { await configureAgentContext(scope, agent) };
        const agentOptions = ctx.get('agentDefaultModel').currentSelection();
        const handles = []; let off;
        try {
          const handle = ${resume ? `await ctx.agents.resume({ resumeSessionId: 'plan-probe', agentOptions, setup })` : `await ctx.agents.create({ sessionId: 'plan-probe', meta: { cwd: process.cwd(), agentPreset: ${JSON.stringify(preset)} }, agentOptions, setup })`};
          handles.push(handle); const agent = handle.agent;
          const state = () => ctx.planMode.get(agent);
          const command = (text, attachments = []) => ctx.commands.execute(agent, text, attachments, new AbortController().signal);
          const ask = async text => { agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })); await agent.whenIdle() };
          const bridge = createToolPresentationBridge(ctx);
          const present = target => [...bridge.session(target, target.session.snapshotEvents()).values()];
          if (${resume}) {
            console.log('PLAN_PROBE ' + JSON.stringify({ state: state(), presentations: present(agent) }));
          } else {
            await ask('BASELINE');
            const baseline = state();
            const permissionBefore = ctx.sessionProjections.snapshot(agent.session).values.permissions;
            const entered = await command('/plan');
            const idle = state();
            const badExit = await command('/plan off', [{ type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }]);
            const afterBadExit = state();
            const prompts = []; let queuedExit, cancelledExit;
            off = bindHumanInteraction(ctx, { prefs: () => ({ uiLanguage: 'en' }), prompt: async request => {
              prompts.push({ presentation: request.presentation, detail: request.detail, allowCustom: request.allowCustom });
              if (request.presentation !== 'plan-review') return 'Approve';
              await command('/plan off'); queuedExit = state();
              await command('/plan'); cancelledExit = state();
              return ${JSON.stringify(outcome)} === 'approve' ? 'Approve' : ${JSON.stringify(outcome)} === 'revise' ? 'Keep planning' : null;
            } }, () => agent);
            await command('/plan PLAN_TASK'); await agent.whenIdle();
            const settled = state(), events = agent.session.snapshotEvents();
            const requestsBeforeFollowup = events.filter(event => event.type === 'step/start').length;
            if (${JSON.stringify(outcome)} === 'dismiss') await ask('AFTER_DISMISS');
            const history = present(agent);
            const seed = agent.session.snapshotEvents();
            const fork = await ctx.agents.create({ sessionId: 'plan-fork', seed, inheritedEventCount: seed.length,
              meta: { cwd: process.cwd(), parentSession: agent.session.id, isSeeded: true, agentPreset: ${JSON.stringify(preset)} }, agentOptions, setup });
            handles.push(fork);
            console.log('PLAN_PROBE ' + JSON.stringify({ baseline, idle, entered, badExit, afterBadExit, queuedExit, cancelledExit, settled,
              prompts, requestsBeforeFollowup, presentations: history, forkState: ctx.planMode.get(fork.agent), forkPresentations: present(fork.agent),
              messages: agent.session.deriveMessages(), permissionBefore, permission: ctx.sessionProjections.snapshot(agent.session).values.permissions }));
          }
        } finally { await off?.(); for (const handle of handles.reverse()) await handle.dispose(); await ctx.fiber.dispose() }
      `)
      const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, script], {
        cwd: workspace, env: { ...process.env, OMDSH_HOME: root, NO_COLOR: '1', DEEPSEEK_BASE_URL: server.baseURL + '/v1', DEEPSEEK_API_KEY: 'sk-mock',
          NODE_PATH: fileURLToPath(new URL('../../../node_modules/.pnpm/node_modules', import.meta.url)) }, stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      child.stdout.on('data', chunk => { output += String(chunk) }); child.stderr.on('data', chunk => { output += String(chunk) })
      const status = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(output.slice(-5000))) }, 45_000)
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('close', code => { clearTimeout(timer); resolve(code) })
      })
      expect(status, output.slice(-5000)).toBe(0)
      const line = output.split('\n').find(line => line.startsWith('PLAN_PROBE '))
      expect(line, output.slice(-5000)).toBeDefined()
      return JSON.parse(line!.slice('PLAN_PROBE '.length))
    }
    try {
      const live = await run(false), active = outcome !== 'approve'
      expect(live.baseline).toEqual({ active: false })
      expect(live.idle).toEqual({ active: true })
      expect(live.badExit.result.kind).toBe('error')
      expect(live.afterBadExit).toEqual({ active: true })
      expect(live.queuedExit).toEqual({ active: true, pending: false })
      expect(live.cancelledExit).toEqual({ active: true, pending: true })
      expect(live.settled.active).toBe(active)
      expect(live.permission).toEqual(live.permissionBefore)
      expect(live.forkState).toEqual({ active })
      expect(live.prompts[0]).toEqual({ presentation: 'plan-review', detail: plan, allowCustom: false })
      expect(live.requestsBeforeFollowup).toBe(outcome === 'dismiss' ? 2 : 3)
      expect(JSON.stringify(live.presentations)).toContain(JSON.stringify(plan).slice(1, -1))
      expect(JSON.stringify(live.forkPresentations)).toContain(JSON.stringify(plan).slice(1, -1))
      expect(server.requests).toHaveLength(3)
      const bodies = server.requests.map(request => request.body)
      expect(JSON.stringify(bodies[0])).not.toContain('You are in plan mode.')
      expect(JSON.stringify(bodies[1])).toContain('You are in plan mode.')
      expect(JSON.stringify(bodies[1])).not.toContain('The tool catalog stays the same across modes')
      // The Messages route appends updated system text in history for cache reuse.
      const last = bodies[2] as { system?: unknown; messages?: Array<{ role: string; content: unknown }> }
      const systemUpdates = last.messages?.filter(message => message.role === 'system').flatMap(message => Array.isArray(message.content) ? message.content : []) ?? []
      const system = systemUpdates.findLast(block => block.type === 'text')?.text ?? last.system
      expect(JSON.stringify(system).includes('You are in plan mode.')).toBe(active)
      if (preset === 'standard') {
        expect(requestToolNames(bodies[0])).not.toContain('exit_plan_mode')
        expect(requestToolNames(bodies[1])).toContain('exit_plan_mode')
        expect(requestToolNames(bodies[2])).toContain('exit_plan_mode')
      }
      if (outcome === 'revise') expect(JSON.stringify(live.messages)).toContain('their feedback: Approve')
      const restored = await run(true)
      expect(restored.state).toEqual({ active })
      expect(JSON.stringify(restored.presentations)).toContain(JSON.stringify(plan).slice(1, -1))
    } finally { await server.close(); rmSync(root, { recursive: true, force: true }) }
  }, 100_000)
})
