/** Published goal activation across cold resume, and job observer/model cursor isolation. */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
const repo = fileURLToPath(new URL('../../../', import.meta.url))

it('restores a disarmed goal and keeps observed output available to the model', async () => {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-goal-jobs-')), cwd = join(root, 'workspace'), profile = join(root, 'profiles/omdsh')
  mkdirSync(cwd); mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n')
  const run = async (id?: string) => {
    const source = (path: string) => JSON.stringify(pathToFileURL(join(repo, path)).href)
    const file = join(root, id === undefined ? 'live.mjs' : 'resume.mjs')
    writeFileSync(file, `
      import { PassThrough } from 'node:stream';
      import { mountOmdsh } from ${source('apps/omdsh/src/boot.ts')};
      import { SessionRuntime } from ${source('packages/tui/omdsh-tui/src/session/session-controller.ts')};
      import { LocalTui } from ${source('packages/tui/omdsh-tui/src/runtime/provider-local.ts')};
      import { browseJobs } from ${source('packages/tui/omdsh-tui/src/commands/jobs-browser.ts')};
      const ctx = await mountOmdsh({args:[],mode:'exec',exit:code=>{process.exitCode=code}});
      const tui = new LocalTui({input:new PassThrough(), output:{isTTY:false,write(){}}, width:()=>80,height:()=>24}, 'mock', false);
      const frames=[]; const original=tui.setSession.bind(tui); tui.setSession=info=>{frames.push(info.controls?.goal);original(info)};
      const runtime = new SessionRuntime(ctx,tui,{stateDir:${JSON.stringify(root)}});
      try {
        await runtime.start();
        ${id === undefined ? '' : `await runtime.resumeSession(runtime.agent, ${JSON.stringify(id)}, new AbortController().signal);`}
        const agent=runtime.agent;
        if (${id === undefined}) ctx.goals.create(agent,{objective:'DURABLE_GOAL 中文', maxGoalRounds:3});
        const before=runtime.controls().goal;
        ctx.goals.disarm(agent); const disarmed=runtime.controls().goal;
        ctx.goals.resume(agent,ctx.goals.get(agent)); const armed=runtime.controls().goal;
        ctx.goals.disarm(agent);
        let finish, producer;
        const off=ctx.jobs.attachController('human observer test');
        const jobId=ctx.jobs.start({kind:'bash',label:'CURSOR_ISOLATION',owner:agent.id,run:job=>{
          producer=job;job.append('MODEL_STDOUT 中文\\n',{channel:'stdout'});job.append('MODEL_STDERR\\n',{channel:'stderr'});
          return {cancel(){finish({status:'killed'})},done:new Promise(resolve=>{finish=resolve})};
        }});
        let step=0, observed='';
        ctx.provide('tui',{interactive:true,prompt:async request=>{
          if(step++===0)return 'output';
          if(request.documentSource){observed=request.documentSource.text;producer.append('AFTER_OBSERVATION\\n',{channel:'stdout'});return null}
          return 'back';
        }});
        await browseJobs(ctx,{agent,signal:new AbortController().signal},jobId);
        const modelRead=ctx.jobs.read(jobId,agent.id);
        finish({status:'completed',detail:'exit 0'}); await ctx.jobs.wait(jobId,1000,agent.id);off();
        console.log('GOAL_JOBS_PROBE '+JSON.stringify({id:agent.id,before,disarmed,armed,frames,observed,modelRead}));
      } finally {await runtime.dispose();tui.dispose();await ctx.fiber.dispose()}
    `)
    const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, file], {
      cwd, env: { ...process.env, OMDSH_HOME: root, NO_COLOR: '1', DEEPSEEK_API_KEY: 'sk-mock', NODE_PATH: join(repo, 'node_modules/.pnpm/node_modules') }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''; child.stdout.on('data', chunk => { output += String(chunk) }); child.stderr.on('data', chunk => { output += String(chunk) })
    const status = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(output.slice(-3000))) }, 25_000)
      child.once('error', error => { clearTimeout(timer); reject(error) }); child.once('close', code => { clearTimeout(timer); resolve(code) })
    })
    expect(status, output.slice(-3000)).toBe(0)
    const line = output.split('\n').find(line => line.startsWith('GOAL_JOBS_PROBE '))
    expect(line, output.slice(-3000)).toBeDefined()
    return JSON.parse(line!.slice('GOAL_JOBS_PROBE '.length))
  }
  try {
    const live = await run(), resumed = await run(live.id)
    expect(live.before).toMatchObject({ activation: 'armed', objective: 'DURABLE_GOAL 中文' })
    expect(resumed.before).toMatchObject({ activation: 'disarmed', phase: 'active', objective: 'DURABLE_GOAL 中文' })
    for (const result of [live, resumed]) {
      expect(result.disarmed.activation).toBe('disarmed'); expect(result.armed.activation).toBe('armed')
      expect(result.frames).toContainEqual(expect.objectContaining({ activation: 'disarmed' }))
      expect(result.observed).toContain('MODEL_STDOUT 中文'); expect(result.observed).toContain('MODEL_STDERR')
      expect(result.modelRead.chunks.map((chunk: {text: string}) => chunk.text).join('')).toBe('MODEL_STDOUT 中文\nMODEL_STDERR\nAFTER_OBSERVATION\n')
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 55_000)
