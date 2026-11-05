// Read-only dependency assessment in an isolated home. Run with pnpm exec tsx.
// --expect-preserved fails until the published Harness supports inbox-preserving disposal.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'

const root = mkdtempSync(join(tmpdir(), 'omdsh-inbox-probe-'))
const cwd = process.cwd()
const require = createRequire(new URL('../apps/omdsh/package.json', import.meta.url))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const home = join(root, 'home'), workspace = join(root, 'workspace')
mkdirSync(workspace)
mkdirSync(join(home, 'profiles', 'omdsh'), { recursive: true })
writeFileSync(join(home, 'profiles', 'omdsh', 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n')
process.env.OMDSH_HOME = home
// This diagnostic never wakes the driver or calls a model.
process.chdir(workspace)
let ctx
try {
  const { mountOmdsh } = await import('../apps/omdsh/src/boot.ts')
  const { createUserMessage } = await load('@deepseek-ai/dsh-llm')
  const { configureAgentContext } = await load('@agi-fans/dsh-tui/agent-profile')
  const { readColdSessionLog } = await load('@deepseek-ai/dsh-session-query')
  ctx = await mountOmdsh({ args: [], mode: 'exec', exit: code => { process.exitCode = code } })
  const selection = ctx.get('agentDefaultModel').currentSelection()
  const setup = async (agentCtx, agent) => { await configureAgentContext(agentCtx, agent) }
  const store = ctx.get('attachments')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==', 'base64')
  const [image] = await store.saveImages([{ data: png, mediaType: 'image/png', name: 'pixel.png' }])
  const file = await store.saveFileStream({ data: Readable.from([Buffer.from('attachment survives')]), name: 'notes.txt' })
  const pending = agent => ({ nextStep: [...agent.inbox.nextStep], nextTurn: [...agent.inbox.nextTurn] })
  const output = []
  for (const disposal of ['handle', 'owner']) {
    // A child owner is the public counterpart of unloading a session's owning runtime.
    let owner
    const ownerFiber = await ctx.plugin(scope => { owner = scope })
    const id = `inbox-probe-${disposal}`
    const handle = await owner.get('agents').create({ sessionId: id, meta: { cwd: workspace, agentPreset: 'standard' }, agentOptions: selection, setup })
    const first = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'first queued' }, { type: 'image', attachment: image }, { type: 'file', attachment: file }] })
    const second = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'second queued' }] })
    const steering = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'next step' }] })
    handle.agent.inbox.append('next-turn', first)
    handle.agent.inbox.append('next-turn', second)
    handle.agent.inbox.append('next-step', steering)
    const before = pending(handle.agent)
    handle.agent.cancel({ kind: 'user' }, { keepInbox: true })
    await handle.agent.whenIdle()
    assert.deepEqual(pending(handle.agent), before, 'Stop must retain both queues')
    const offset = handle.agent.session.snapshotEvents().length
    if (disposal === 'handle') await handle.dispose()
    await ownerFiber.dispose()
    const log = await readColdSessionLog(ctx.get('sessionPersistence'), id)
    const canceled = log.events.slice(offset).filter(event => event.type === 'agent/inbox/spliced' && event.data.outcome === 'canceled')
    const resumed = await ctx.get('agents').resume({ resumeSessionId: id, agentOptions: selection, setup })
    try {
      const after = pending(resumed.agent)
      assert.deepEqual(Buffer.from((await store.readImage(image)).data), png)
      const chunks = []
      for await (const chunk of store.readFileStream(file)) chunks.push(chunk)
      assert.equal(Buffer.concat(chunks).toString(), 'attachment survives')
      const preserved = JSON.stringify(after) === JSON.stringify(before)
      output.push({ disposal, before: { nextStep: before.nextStep.length, nextTurn: before.nextTurn.length },
        resumed: { nextStep: after.nextStep.length, nextTurn: after.nextTurn.length }, preserved,
        canceledSplices: canceled.map(event => ({ target: event.data.target, removedCount: event.data.removedCount })), attachmentsReadable: true })
    } finally { await resumed.dispose() }
  }
  const agentPackage = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh-agent/package.json'), 'utf8'))
  console.log(JSON.stringify({ harness: agentPackage.version, modelRequests: 0, cases: output }, null, 2))
  if (process.argv.includes('--expect-preserved')) assert(output.every(item => item.preserved), 'Published Harness disposed pending inbox messages; see docs/integrations/harness-inbox-lifecycle.md')
} finally {
  try { await ctx?.fiber.dispose() }
  finally { process.chdir(cwd); rmSync(root, { recursive: true, force: true }) }
}
