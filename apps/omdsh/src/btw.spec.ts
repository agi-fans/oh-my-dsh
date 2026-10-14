import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootTuiTurn, requestToolNames } from './test-support/tui-boot.ts'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

const roots: string[] = []
function home() { const root = mkdtempSync(join(tmpdir(), 'omdsh-btw-')); roots.push(root); return root }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('composed side consultation', () => {
  it('cancels a stalled consultation while the primary request remains running', async () => {
    const root = home(), workspace = join(root, 'workspace'), profile = join(root, 'profiles/omdsh')
    mkdirSync(workspace); mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n')
    const app = fileURLToPath(new URL('../', import.meta.url)), script = join(root, 'cancel.mjs')
    writeFileSync(script, `import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {createInterface} from 'node:readline';
      import {mountOmdsh} from ${JSON.stringify(pathToFileURL(join(app, 'src/boot.ts')).href)};
      const require=createRequire(${JSON.stringify(join(app, 'package.json'))});
      const {configureAgentContext}=await import(pathToFileURL(require.resolve('@agi-fans/dsh-tui/agent-profile')).href);
      const {createUserMessage}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
      const ctx=await mountOmdsh({args:[],mode:'exec',exit:code=>{process.exitCode=code}});
      const selection=ctx.get('agentDefaultModel').currentSelection();
      const handle=await ctx.get('agents').create({sessionId:'parent-cancellation',meta:{cwd:process.cwd(),agentPreset:'standard'},agentOptions:selection,
        setup:async(agentCtx,agent)=>{await configureAgentContext(agentCtx,agent,{current:selection,assembled:undefined})}});
      const parent=handle.agent, abort=new AbortController(), lines=createInterface({input:process.stdin});
      const nextLine=()=>new Promise(resolve=>lines.once('line',resolve));
      try {
        parent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'PRIMARY_STILL_RUNNING'}]}));
        await nextLine();
        const pending=ctx.get('omdshBtw').consult(parent,'CANCEL_ONLY_THIS_SIDE',selection,abort.signal,()=>{});
        await nextLine(); abort.abort();
        const reply=await pending;
        console.log('CANCEL WIRE '+JSON.stringify({reply,primaryStatus:parent.status,parentMessages:parent.session.deriveMessages(),topics:ctx.get('omdshBtw').list(parent)}));
        parent.cancel({kind:'user'});await parent.whenIdle();
      } finally {lines.close();process.stdin.destroy();await handle.dispose();await ctx.fiber.dispose()}`)
    const server = await startMockLlmServer({ port: 0, sequence: ['stall', 'stall'] })
    const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, script], {
      cwd: workspace, env: { ...process.env, OMDSH_HOME: root, DEEPSEEK_BASE_URL: server.baseURL + '/v1', DEEPSEEK_API_KEY: 'sk-mock',
        NODE_PATH: fileURLToPath(new URL('../../../node_modules/.pnpm/node_modules', import.meta.url)) }, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', chunk => { out += String(chunk) }); child.stderr.on('data', chunk => { out += String(chunk) })
    const exit = new Promise<number | null>(resolve => child.once('close', resolve))
    try {
      await vi.waitFor(() => expect(server.requests, out).toHaveLength(1), { timeout: 15_000 })
      child.stdin.write('consult\n')
      await vi.waitFor(() => expect(server.requests, out).toHaveLength(2), { timeout: 15_000 })
      child.stdin.write('cancel\n')
      await vi.waitFor(() => expect(child.exitCode, out).toBe(0), { timeout: 15_000 })
      expect(await exit, out).toBe(0)
      const result = JSON.parse(out.split('\n').find(line => line.startsWith('CANCEL WIRE '))!.slice(12))
      expect(result.primaryStatus).toBe('running')
      expect(result.reply.topic.status).toBe('cancelled')
      expect(result.topics[0].status).toBe('cancelled')
      expect(JSON.stringify(result.parentMessages)).not.toContain('CANCEL_ONLY_THIS_SIDE')
    } finally { child.kill('SIGKILL'); await exit; await server.close() }
  }, 50_000)
  it('keeps follow-ups on the original prefix and meters only their own requests', async () => {
    const root = home(), workspace = join(root, 'workspace'), profile = join(root, 'profiles/omdsh')
    mkdirSync(workspace); mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n')
    const app = fileURLToPath(new URL('../', import.meta.url)), script = join(root, 'probe.mjs')
    writeFileSync(script, `import {createRequire} from 'node:module'; import {pathToFileURL} from 'node:url';
      import {mountOmdsh} from ${JSON.stringify(pathToFileURL(join(app, 'src/boot.ts')).href)};
      const require = createRequire(${JSON.stringify(join(app, 'package.json'))});
      const {configureAgentContext} = await import(pathToFileURL(require.resolve('@agi-fans/dsh-tui/agent-profile')).href);
      const {SessionId} = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href);
      const {createUserMessage} = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
      const ctx = await mountOmdsh({args:[], mode:'exec', exit:code=>{process.exitCode=code}});
      const selection=ctx.get('agentDefaultModel').currentSelection();
      const setup=async(agentCtx,agent)=>{await configureAgentContext(agentCtx,agent,{current:selection,assembled:undefined})};
      const handle=process.env.EXISTING_TOPIC ? await ctx.get('agents').resume({resumeSessionId:SessionId('parent-probe'),agentOptions:selection,setup}) : await ctx.get('agents').create({sessionId:SessionId('parent-probe'),meta:{cwd:process.cwd(),agentPreset:'standard'},agentOptions:selection,
        setup});
      const parent=handle.agent, ask=async text=>{parent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text}]}));await parent.whenIdle()};
      try {
        if(process.env.EXISTING_TOPIC) {
          const before=ctx.get('omdshBtw').list(parent);
          const reply=await ctx.get('omdshBtw').consult(parent,'SIDE_QUESTION_THREE',selection,new AbortController().signal,()=>{},process.env.EXISTING_TOPIC);
          const history=await ctx.get('omdshBtw').read(parent,process.env.EXISTING_TOPIC,new AbortController().signal);
          console.log('BT WIRE '+JSON.stringify({before,reply,history}));
        } else {
        await ask('ORIGINAL_PARENT_CONTEXT');
        const goal=ctx.get('goals').create(parent,{objective:'PARENT_GOAL_MUST_STAY',maxGoalRounds:10});
        ctx.get('goals').disarm(parent);
        ctx.get('planMode').set(parent,true);
        const first=await ctx.get('omdshBtw').consult(parent,'SIDE_QUESTION_ONE',selection,new AbortController().signal,()=>{});
        const inspection=await ctx.get('agents').resume({resumeSessionId:SessionId(first.topic.sessionId),agentOptions:selection,setup});
        let called=false, inspectionResult;
        try {
          const side=inspection.agent;
          side.ctx.get('tools').register({name:'scope_local_probe',description:'Probe',parameters:{type:'object',properties:{}},
            output:{schema:{type:'object'},render:()=>[]},execute:async()=>{called=true;return {}}});
          side.ctx.on('tools/pre-execute',async()=>({kind:'allow'}),true);
          const blocked=await ctx.get('tools').execute({callId:'probe-call',name:'scope_local_probe',arguments:{},agent:side,signal:new AbortController().signal});
          inspectionResult={goal:ctx.get('goals').get(side)??null,plan:ctx.get('planMode').get(side),blocked,called};
        } finally {await inspection.dispose()}
        await ask('LATE_PARENT_MUST_NOT_LEAK');
        const second=await ctx.get('omdshBtw').consult(parent,'SIDE_QUESTION_TWO',selection,new AbortController().signal,()=>{},first.topic.sessionId);
        console.log('BT WIRE '+JSON.stringify({first,second,inspectionResult,parentGoal:ctx.get('goals').get(parent),parentPlan:ctx.get('planMode').get(parent),parentMessages:parent.session.deriveMessages()}));
        }
      } finally {await handle.dispose();await ctx.fiber.dispose()}`)
    const server = await startMockLlmServer({ port: 0, sequence: ['success', 'success', 'success', 'success', 'success'], successText: 'REPLY' })
    try {
      const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, script], {
        cwd: workspace, env: { ...process.env, OMDSH_HOME: root, DEEPSEEK_BASE_URL: server.baseURL + '/v1', DEEPSEEK_API_KEY: 'sk-mock',
          NODE_PATH: fileURLToPath(new URL('../../../node_modules/.pnpm/node_modules', import.meta.url)) }, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', chunk => { out += String(chunk) }); child.stderr.on('data', chunk => { out += String(chunk) })
      const status = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(out)) }, 30_000)
        child.once('close', code => { clearTimeout(timer); resolve(code) })
      })
      expect(status, out).toBe(0)
      expect(server.requests).toHaveLength(4)
      const side = JSON.stringify(server.requests[3]!.body)
      expect(side).toContain('ORIGINAL_PARENT_CONTEXT')
      expect(side).toContain('SIDE_QUESTION_ONE')
      expect(side).toContain('SIDE_QUESTION_TWO')
      expect(side).not.toContain('LATE_PARENT_MUST_NOT_LEAK')
      expect(requestToolNames(server.requests[0]!.body)).toContain(process.platform === 'win32' ? 'pwsh' : 'bash')
      expect(requestToolNames(server.requests[1]!.body)).toEqual([])
      expect(requestToolNames(server.requests[2]!.body)).toContain(process.platform === 'win32' ? 'pwsh' : 'bash')
      expect(requestToolNames(server.requests[3]!.body)).toEqual([])
      const result = JSON.parse(out.split('\n').find(line => line.startsWith('BT WIRE '))!.slice(8))
      expect(result.first.topic.sessionId).toBe(result.second.topic.sessionId)
      expect(result.first.usage.totalTokens).toBe(8)
      expect(result.second.usage.totalTokens).toBe(8)
      expect(result.inspectionResult.goal).toBeNull()
      expect(result.inspectionResult.plan.active).toBe(false)
      expect(result.inspectionResult.called).toBe(false)
      expect(JSON.stringify(result.inspectionResult.blocked)).toContain('Side consultations cannot use tools.')
      expect(result.parentGoal.objective).toBe('PARENT_GOAL_MUST_STAY')
      expect(result.parentPlan.active).toBe(true)
      expect(JSON.stringify(result.parentMessages)).not.toContain('SIDE_QUESTION_')
      const resumed = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, script], {
        cwd: workspace, env: { ...process.env, OMDSH_HOME: root, DEEPSEEK_BASE_URL: server.baseURL + '/v1', DEEPSEEK_API_KEY: 'sk-mock',
          EXISTING_TOPIC: result.first.topic.sessionId, NODE_PATH: fileURLToPath(new URL('../../../node_modules/.pnpm/node_modules', import.meta.url)) }, stdio: ['ignore', 'pipe', 'pipe'] })
      let restored = ''
      resumed.stdout.on('data', chunk => { restored += String(chunk) }); resumed.stderr.on('data', chunk => { restored += String(chunk) })
      const exit = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => { resumed.kill('SIGKILL'); reject(new Error(restored)) }, 30_000)
        resumed.once('close', code => { clearTimeout(timer); resolve(code) })
      })
      expect(exit, restored).toBe(0)
      const saved = JSON.parse(restored.split('\n').find(line => line.startsWith('BT WIRE '))!.slice(8))
      expect(saved.before[0].sessionId).toBe(result.first.topic.sessionId)
      expect(saved.reply.topic.status).toBe('completed')
      expect(saved.history).toContain('SIDE_QUESTION_ONE')
      expect(saved.history).toContain('SIDE_QUESTION_THREE')
      expect(saved.history).not.toContain('ORIGINAL_PARENT_CONTEXT')
      expect(JSON.stringify(server.requests[4]!.body)).not.toContain('LATE_PARENT_MUST_NOT_LEAK')
      expect(requestToolNames(server.requests[4]!.body)).toEqual([])

    } finally { await server.close() }
  }, 35_000)
  it('uses the current model without tools and retains a separate session record', async () => {
    const root = home()
    const turn = await bootTuiTurn({ preset: 'code', home: root, input: '/btw Explain the approach\n',
      patch: '- id: session-title-llm\n  disabled: true\n' })
    expect(turn.status, turn.output).toBe(0)
    expect(turn.bodies, turn.output).toHaveLength(1)
    expect(requestToolNames(turn.bodies[0])).toEqual([])
    expect(JSON.stringify(turn.bodies[0])).toContain('Explain the approach')
    expect(turn.output.replace(/\s+/gu, ' ')).toContain('Separate session: session-')
    expect(turn.output).toContain('completed')
    const names = readdirSync(join(root, 'omdsh/btw'))
    expect(names).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(root, 'omdsh/btw', names[0]!), 'utf8'))).toMatchObject({ version: 1, question: 'Explain the approach', status: 'completed' })
  }, 120_000)

  it('does not execute an unsolicited tool call, even from a Full access parent', async () => {
    const root = home()
    const turn = await bootTuiTurn({ preset: 'standard', home: root, input: '/btw Give advice only\n',
      extraEnv: { OMDSH_PERMISSION_MODE: 'danger-full-access' },
      toolCall: { name: process.platform === 'win32' ? 'pwsh' : 'bash', arguments: JSON.stringify({ command: 'echo SHOULD_NOT_EXECUTE' }) } })
    expect(turn.status, turn.output).toBe(0)
    expect(turn.bodies).toHaveLength(2)
    expect(turn.bodies.every(body => requestToolNames(body).length === 0)).toBe(true)
    expect(JSON.stringify(turn.bodies[1])).toContain('Side consultations cannot use tools.')
    expect(turn.output).toContain('completed')
  }, 120_000)
})
