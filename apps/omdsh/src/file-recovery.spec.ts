/** Public composition and real confined worker proof for the recovery provider. */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

async function probe(body: string, automatic = false, stalled = false, sequence?: readonly string[]) {
  const root = mkdtempSync(join(tmpdir(), 'omdsh-recovery-composition-')); roots.push(root)
  const workspace = join(root, 'workspace'), profile = join(root, 'home/profiles/omdsh')
  mkdirSync(workspace); mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n' + (automatic ? '- id: file-recovery\n  config:\n    enabled: true\n' : ''))
  const app = fileURLToPath(new URL('../', import.meta.url)), script = join(root, 'probe.mjs')
  writeFileSync(script, `import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
    import {writeFile,readFile,unlink,readdir,mkdir} from 'node:fs/promises';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
    import {mountOmdsh} from ${JSON.stringify(pathToFileURL(join(app, 'src/boot.ts')).href)};
    const require=createRequire(${JSON.stringify(join(app, 'package.json'))});
    const {configureAgentContext}=await import(pathToFileURL(require.resolve('@agi-fans/dsh-tui/agent-profile')).href);
    const {createUserMessage}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
    const {readColdSessionLog}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-query')).href);
    const {pluginRecordOf,KNOWN_SESSION_EVENT_TYPES}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href);
    const mock=${automatic} ? await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-mock-server')).href) : undefined;
    const server=mock ? await mock.startMockLlmServer({port:0,sequence:${JSON.stringify(sequence ?? (stalled ? ['tool_call_success', 'stall'] : ['tool_call_success', 'success', 'success', 'success']))},toolName:'write',toolArguments:JSON.stringify({file_path:'created.txt',content:'after'}),successText:'done'}) : undefined;
    if(server)process.env.DEEPSEEK_BASE_URL=server.baseURL+'/v1';
    const ctx=await mountOmdsh({args:[],mode:'exec',exit:code=>{process.exitCode=code}});
    const selection=ctx.get('agentDefaultModel').currentSelection();
    const handle=await ctx.get('agents').create({sessionId:'recovery-owner',meta:{cwd:process.cwd(),agentPreset:'standard'},agentOptions:selection,
      setup:async(agentCtx,agent)=>{await configureAgentContext(agentCtx,agent,{current:selection,assembled:undefined})}});
    const agent=handle.agent,recovery=ctx.get('omdshFileRecovery'),signal=new AbortController().signal;
    try {${body}} finally {await handle.dispose();await ctx.fiber.dispose();await server?.close()}`)
  const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href, script], {
    cwd: workspace, env: { ...process.env, OMDSH_HOME: join(root, 'home'), DEEPSEEK_API_KEY: 'sk-mock',
      NODE_PATH: fileURLToPath(new URL('../../../node_modules/.pnpm/node_modules', import.meta.url)) }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', chunk => { out += String(chunk) }); child.stderr.on('data', chunk => { out += String(chunk) })
  const status = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(out)) }, 45_000)
    child.once('close', code => { clearTimeout(timer); resolve(code) })
  })
  expect(status, out).toBe(0)
  const line = out.split('\n').find(line => line.startsWith('RECOVERY_PROOF '))
  expect(line, out).toBeDefined()
  return JSON.parse(line!.slice(15))
}

describe('confined file recovery provider', () => {
  it('exposes a live, persistent snapshot switch through the shipped Settings composition', async () => {
    const result = await probe(`
      const settings=ctx.get('settings'),describe=()=>settings.describe({redactSecrets:true}).find(row=>row.ns==='file-recovery');
      const before=describe();if(!before)throw new Error('Recovery Settings entry is missing');
      await settings.mutate('file-recovery',[{op:'set',path:['enabled'],value:true}],before.revision);
      const enabled=recovery.enabled,after=describe(),enabledPatch=await readFile(join(process.env.OMDSH_HOME,'profiles/omdsh/cordis.patch.yml'),'utf8');
      await settings.mutate('file-recovery',[{op:'set',path:['enabled'],value:false}],after.revision);
      const disabled=recovery.enabled,patch=await readFile(join(process.env.OMDSH_HOME,'profiles/omdsh/cordis.patch.yml'),'utf8');
      console.log('RECOVERY_PROOF '+JSON.stringify({schema:before.schema,before:before.value,after:after.value,enabled,disabled,enabledPatch,patch}));
    `)
    const dict = result.schema.refs[result.schema.uid].dict
    expect(result.schema.refs[dict.enabled].type).toBe('boolean')
    expect(dict.stateDir).toBeUndefined()
    expect(result.before.enabled).toBe(false)
    expect(result.after.enabled).toBe(true)
    expect(result.enabled).toBe(true)
    expect(result.disabled).toBe(false)
    expect(result.enabledPatch).toContain('enabled: true')
    expect(result.patch).not.toContain('file-recovery')
  }, 50_000)
  it('drains a cancelled worker and records uncertainty when a file changed before its acknowledgement', async () => {
    const result = await probe(`
      const before=await recovery.capture(agent,[],signal);await writeFile('created.txt','after');
      const after=await recovery.capture(agent,[],signal),wrapper=join(recovery.store.directory,'stall-worker.mjs');
      const marker=join(process.cwd(),'.omdsh-recovery-proof.marker');
      await writeFile(wrapper,\`import {pathToFileURL} from 'node:url';import {writeFileSync} from 'node:fs';
        const {restoreRecoveryFile}=await import(pathToFileURL(process.argv[2]).href);let input='';for await(const chunk of process.stdin)input+=String(chunk);
        const result=await restoreRecoveryFile(JSON.parse(input));writeFileSync(\${JSON.stringify(marker)},JSON.stringify(result));setInterval(()=>{},1000);\`);
      const sandbox=ctx.get('sandbox'),confine=sandbox.confine.bind(sandbox);
      sandbox.confine=(argv,policy,signal)=>confine([argv[0],wrapper,...argv.slice(1)],policy,signal);
      const abort=new AbortController(),pending=recovery.restore(agent,before.id,after.id,['created.txt'],abort.signal);
      const deadline=Date.now()+15000;while(!(await readdir('.')).includes('.omdsh-recovery-proof.marker')){if(Date.now()>deadline)throw new Error('Worker did not reach the publication boundary');await new Promise(resolve=>setTimeout(resolve,10))}
      abort.abort();const report=await pending,retained=await recovery.readReceipt(report.id);
      console.log('RECOVERY_PROOF '+JSON.stringify({report,retained,actual:JSON.parse(await readFile(marker,'utf8')),exists:(await readdir('.')).includes('created.txt')}));
    `)
    expect(result.actual.status).toBe('restored')
    expect(result.report.entries[0].status).toBe('uncertain')
    expect(result.retained).toEqual(result.report)
    expect(result.exists).toBe(false)
  }, 50_000)
  it('keeps approval rule annotations ignorable for the published stock session reader', async () => {
    const result = await probe(`
      agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Create the file'}]}));
      const deadline=Date.now()+15000;while(server.requests.length<2){if(Date.now()>deadline)throw new Error('No open model request');await new Promise(resolve=>setTimeout(resolve,10))}
      ctx.get('permissionPresets').set(agent.session,'workspace-write');
      ctx.on('approval/request',async request=>{ctx.get('omdshApprovalRules').remember(request,'session','allow');return 'allowed-once'});
      ctx.get('tools').register({name:'rule_portability_probe',description:'Probe',parameters:{type:'object',properties:{}},output:{schema:{type:'object'},render:()=>[]},
        execute:async(_args,exec)=>({outcome:await ctx.get('approval').request({agent:exec.agent,callId:exec.callId,toolName:'rule_portability_probe',reason:'Portability proof',signal:exec.signal})})});
      for(let index=0;index<2;index++)await ctx.get('tools').execute({name:'rule_portability_probe',callId:'rule-'+index,arguments:{},agent,signal});
      agent.cancel({kind:'user'});await agent.whenIdle();await ctx.get('sessions').flush(agent.session);
      const log=await readColdSessionLog(ctx.get('sessionPersistence'),agent.id,signal);
      const records=log.events.filter(event=>pluginRecordOf(event)?.type==='plugin:omdsh/approval-rule-matched');
      console.log('RECOVERY_PROOF '+JSON.stringify({records,unknown:records.every(event=>!KNOWN_SESSION_EVENT_TYPES.has(event.type)),decisions:log.events.filter(event=>event.type==='approval/decided').map(event=>event.data.outcome)}));
    `, true, true)
    expect(result.records).toHaveLength(1)
    expect(result.records[0].ignorable).toBe(true)
    expect(result.unknown).toBe(true)
    expect(result.decisions).toEqual(['allowed-once', 'allowed-once'])
  }, 50_000)
  it('finishes a capture already started when snapshots are disabled and the model is cancelled', async () => {
    const result = await probe(`
      agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Create the file'}]}));
      const deadline=Date.now()+15000;while(server.requests.length<2){if(Date.now()>deadline)throw new Error('The tool request did not settle');await new Promise(resolve=>setTimeout(resolve,10))}
      const settings=ctx.get('settings'),row=settings.describe().find(row=>row.ns==='file-recovery');
      await settings.mutate('file-recovery',[{op:'set',path:['enabled'],value:false}],row.revision);
      agent.cancel({kind:'user'});await agent.whenIdle();
      const checkpoint=await recovery.checkpoint(agent.id,1);
      const report=await recovery.restore(agent,checkpoint.before,checkpoint.after,['created.txt'],signal);
      console.log('RECOVERY_PROOF '+JSON.stringify({enabled:recovery.enabled,checkpoint,report,exists:(await readdir('.')).includes('created.txt')}));
    `, true, true)
    expect(result.checkpoint.status).toBe('ready')
    expect(result.enabled).toBe(false)
    expect(result.report.entries[0].status).toBe('restored')
    expect(result.exists).toBe(false)
  }, 50_000)
  it('captures real Turns automatically, seals queued boundaries and retains records after owner disposal', async () => {
    const result = await probe(`
      const ask=async text=>{agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text}]}));await agent.whenIdle()};
      await ask('Create the requested file');
      const first=await recovery.checkpoint(agent.id,1);
      await ask('Explain the change');
      const second=await recovery.checkpoint(agent.id,2),sameFirst=await recovery.checkpoint(agent.id,1);
      const plan=await recovery.store.plan(first.before,first.after,signal);
      const report=await recovery.restore(agent,first.before,first.after,['created.txt'],signal);
      await ask('Check the new filesystem state');await ctx.get('sessions').flush(agent.session);
      const log=await readColdSessionLog(ctx.get('sessionPersistence'),agent.id,signal);
      const id=agent.id;await handle.dispose();const cold=await recovery.checkpoint(id,1);
      console.log('RECOVERY_PROOF '+JSON.stringify({first,second,sameFirst,cold,plan,report,exists:(await readdir('.')).includes('created.txt'),requests:server.requests.length,lastWire:server.requests.at(-1).body,stockEvents:log.events.length}));
    `, true)
    expect(result.first.status).toBe('ready')
    expect(result.second.status).toBe('ready')
    expect(result.sameFirst).toEqual(result.first)
    expect(result.cold).toEqual(result.first)
    expect(result.plan.operations).toMatchObject([{ path: 'created.txt', status: 'ready', before: { kind: 'missing' } }])
    expect(result.report.entries[0].status).toBe('restored')
    expect(result.exists).toBe(false)
    expect(result.requests).toBe(4)
    expect(JSON.stringify(result.lastWire)).toContain('The user attempted file recovery')
    expect(result.stockEvents).toBeGreaterThan(0)
  }, 50_000)
  it('starts newly enabled captures only at a Turn boundary without reopening an older checkpoint', async () => {
    const result = await probe(`
      const ask=async text=>{agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text}]}));await agent.whenIdle()};
      const settings=ctx.get('settings'),set=async value=>{const row=settings.describe().find(row=>row.ns==='file-recovery');await settings.mutate('file-recovery',[{op:'set',path:['enabled'],value}],row.revision)};
      await ask('Create the file');const first=await recovery.checkpoint(agent.id,1);await set(false);
      let changed=false;ctx.on('agent/pre-step',async(payload,next)=>{if(payload.turn===2&&payload.step===2){await set(true);changed=true}return next()},true);
      await ask('Write again');const second=await recovery.checkpoint(agent.id,2),sameFirst=await recovery.checkpoint(agent.id,1);
      await ask('Explain');const third=await recovery.checkpoint(agent.id,3);
      console.log('RECOVERY_PROOF '+JSON.stringify({first,sameFirst,second:second??null,third,changed}));
    `, true, false, ['tool_call_success', 'success', 'tool_call_success', 'success', 'success'])
    expect(result.changed).toBe(true)
    expect(result.first.status).toBe('ready')
    expect(result.sameFirst).toEqual(result.first)
    expect(result.second).toBeNull()
    expect(result.third.status).toBe('ready')
  }, 50_000)
  it('treats an embedded repository as a protected boundary in its parent snapshot', async () => {
    const result = await probe(`
      execFileSync('git',['init'],{stdio:'ignore'});await mkdir('embedded');execFileSync('git',['-C','embedded','init'],{stdio:'ignore'});
      await writeFile(join('embedded','file'),'nested user data');await writeFile('source','before');
      const before=await recovery.capture(agent,[],signal);await writeFile('source','after');
      const after=await recovery.capture(agent,before.entries.map(entry=>entry.path),signal);
      const report=await recovery.restore(agent,before.id,after.id,['source'],signal);
      console.log('RECOVERY_PROOF '+JSON.stringify({protected:before.protected,paths:before.entries.map(entry=>entry.path),report,nested:await readFile(join('embedded','file'),'utf8')}));
    `)
    expect(result.protected).toContain('embedded/')
    expect(result.paths).not.toContain('embedded/file')
    expect(result.report.entries[0].status).toBe('restored')
    expect(result.nested).toBe('nested user data')
  }, 50_000)
  it('captures the active directory and restores its files after returning to another directory', async () => {
    const result = await probe(`
      const nested=join(process.cwd(),'nested');await mkdir(nested);await writeFile(join(nested,'file'),'before');
      await ctx.get('workingDirectory').set(agent,nested,signal);
      const before=await recovery.capture(agent,[],signal);await writeFile(join(nested,'file'),'after');
      const after=await recovery.capture(agent,before.entries.map(entry=>entry.path),signal);
      await ctx.get('workingDirectory').set(agent,process.cwd(),signal);
      const report=await recovery.restore(agent,before.id,after.id,['file'],signal);
      console.log('RECOVERY_PROOF '+JSON.stringify({root:before.root,report,actual:await readFile(join(nested,'file'),'utf8'),cwd:ctx.get('workingDirectory').get(agent.session)}));
    `)
    expect(result.root.replaceAll('\\', '/')).toMatch(/\/nested$/u)
    expect(result.report.entries[0].status).toBe('restored')
    expect(result.actual).toBe('before')
    expect(result.cwd).not.toBe(result.root)
  }, 50_000)
  it('preserves pre-existing ignored content when ignore rules change during the Turn', async () => {
    const result = await probe(`
      execFileSync('git',['init'],{stdio:'ignore'});
      await writeFile('.gitignore','was-ignored\\n');await writeFile('was-ignored','original user data');
      const before=await recovery.capture(agent,[],signal);
      await writeFile('.gitignore','');const after=await recovery.capture(agent,before.entries.map(entry=>entry.path),signal);
      const plan=await recovery.store.plan(before.id,after.id,signal);
      const report=await recovery.restore(agent,before.id,after.id,plan.operations.map(operation=>operation.path),signal);
      console.log('RECOVERY_PROOF '+JSON.stringify({excluded:before.excluded,report,actual:await readFile('was-ignored','utf8'),ignore:await readFile('.gitignore','utf8')}));
    `)
    expect(result.excluded).toContain('was-ignored')
    expect(result.report.entries.find(entry => entry.path === 'was-ignored')).toMatchObject({ status: 'conflict' })
    expect(result.actual).toBe('original user data')
    expect(result.ignore).toBe('was-ignored\n')
  }, 50_000)
  it('uses workspace confinement even from Full access and persists a real binary/create/delete receipt', async () => {
    const result = await probe(`
      await writeFile('binary',Buffer.from([0,255,128,42]));await writeFile('deleted','before');
      const before=await recovery.capture(agent,[],signal);
      await writeFile('binary','after');await unlink('deleted');await writeFile('created','new');
      const after=await recovery.capture(agent,before.entries.map(entry=>entry.path),signal);
      ctx.get('permissionPresets').set(agent.session,'danger-full-access');
      const policies=[],sandbox=ctx.get('sandbox'),confine=sandbox.confine.bind(sandbox);
      sandbox.confine=async(argv,policy,signal)=>{policies.push(policy);return confine(argv,policy,signal)};
      const report=await recovery.restore(agent,before.id,after.id,['binary','created','deleted'],signal);
      const retained=await recovery.readReceipt(report.id);
      const reports=await recovery.savedReports(before.id,after.id,signal);
      console.log('RECOVERY_PROOF '+JSON.stringify({report,retained,reports,policies,binary:[...await readFile('binary')],deleted:await readFile('deleted','utf8'),
        created:(await readdir('.')).includes('created'),access:ctx.get('permissionPresets').current(agent.session)}));
    `)
    expect(result.report.entries.map(entry => entry.status), JSON.stringify(result.report)).toEqual(['restored', 'restored', 'restored'])
    expect(result.retained).toEqual(result.report)
    expect(result.reports[0]).toEqual(result.report)
    expect(result.binary).toEqual([0, 255, 128, 42])
    expect(result.deleted).toBe('before')
    expect(result.created).toBe(false)
    expect(result.policies).toHaveLength(3)
    expect(result.policies.every(policy => policy.mode === 'workspace-write')).toBe(true)
    expect(result.access).toBe('danger-full-access')
  }, 50_000)

  it('keeps Read only authoritative and protects files changed after the snapshot', async () => {
    const result = await probe(`
      await writeFile('file','before');const before=await recovery.capture(agent,[],signal);
      await writeFile('file','after');const after=await recovery.capture(agent,before.entries.map(entry=>entry.path),signal);
      ctx.get('permissionPresets').set(agent.session,'read-only');
      const readonly=await recovery.restore(agent,before.id,after.id,['file'],signal),stillAfter=await readFile('file','utf8');
      ctx.get('permissionPresets').set(agent.session,'workspace-write');await writeFile('file','later user edit');
      const conflict=await recovery.restore(agent,before.id,after.id,['file'],signal);
      console.log('RECOVERY_PROOF '+JSON.stringify({readonly,stillAfter,conflict,actual:await readFile('file','utf8')}));
    `)
    expect(result.readonly.entries[0]).toMatchObject({ status: 'failed', reason: expect.stringContaining('Read only') })
    expect(result.stillAfter).toBe('after')
    expect(result.conflict.entries[0].status).toBe('conflict')
    expect(result.actual).toBe('later user edit')
  }, 50_000)
})
