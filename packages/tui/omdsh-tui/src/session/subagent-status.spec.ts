import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AssistantStreamFrame, ModelSelection } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, type UserMessage, LlmAttemptId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { TuiPrompt, TuiService } from '../definition.ts'
import { SessionRuntime } from './session-controller.ts'

/** Agent-owned selection stand-in: the runtime reads it and records replacements. */
function stubModel(initial: ModelSelection) {
  let current: ModelSelection | undefined = initial
  return { current: () => current, select: (next: ModelSelection) => { current = next } }
}


/** Real session events and stream routing with external Agent execution replaced. */
async function fixture() {
  const ctx = new Context()
  const agentCtx = new Context()
  await ctx.plugin(SessionStore)
  await agentCtx.plugin(CommandRuntime)
  const rootId = SessionId('status-root')
  const root = {
    id: rootId, session: ctx.sessions.create(rootId), status: 'idle',
    model: stubModel({ provider: 'deepseek', model: 'deepseek-chat' }),
    inbox: { nextTurn: [], nextStep: [] },
  } as unknown as Agent
  const children = Array.from({ length: 3 }, (_, index) => {
    const id = SessionId(`status-child-${index}`)
    const session = ctx.sessions.create(id, {
      meta: { parentSession: rootId, isSeeded: false, origin: 'subagent', delegationDepth: 1 },
    })
    session.append('subagent/descriptor', {
      version: 2, mode: 'continuable', provider: 'spawn', label: `Worker ${index}`,
    })
    return { id, session, status: 'running', model: stubModel({ provider: 'deepseek', model: 'deepseek-chat' }) } as unknown as Agent
  })
  const presets = {
    defaultId: 'standard', presetForSession: () => 'standard', resolve: async () => ({ id: 'standard' }), mount: async () => ({ id: 'standard' }),
  }
  ctx.provide('agentPresets', presets)
  agentCtx.provide('agentPresets', presets)
  agentCtx.provide('sessionProjections', { stateOf: () => 'standard' })
  agentCtx.provide('tools', { presentAs: () => () => undefined })
  agentCtx.provide('permissionPresets', { names: [], optionOf: () => undefined, current: () => undefined })
  ctx.provide('agents', {
    create: async (options: { setup?: (context: typeof agentCtx, agent: Agent) => Promise<void> }) => {
      await options.setup?.(agentCtx, root)
      return { agent: root, dispose: async () => undefined } as unknown as AgentHandle
    },
    get: (id: string) => [root, ...children].find(agent => agent.id === id),
  })
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }),
  })
  ctx.provide('subagents', {
    listDescendants: async () => [],
    rootOf: (agent: Agent) => {
      if (agent === root || children.some(child => child.id === agent.id)) return root
      throw new Error('UNAUTHORIZED')
    },
  })
  let inspect: (id: string) => void = () => {}
  let closeInspect: () => void = () => {}
  const calls = { prompt: vi.fn<(request: TuiPrompt) => Promise<string | null>>().mockResolvedValue(null), restoreInput: vi.fn(), notice: vi.fn(), pendingInputs: { list: vi.fn(() => []), update: vi.fn(() => false) }, setSubagents: vi.fn(), streamDelta: vi.fn(), replaceSession: vi.fn(), setInspectedSubagent: vi.fn(), event: vi.fn() }
  const tui = new Proxy({
    ...calls,
    onInspectSubagent: (handler: typeof inspect) => { inspect = handler; return () => {} },
    onInspectClose: (handler: typeof closeInspect) => { closeInspect = handler; return () => {} },
  }, {
    get(target: Record<string, unknown>, key: string) { return key in target ? target[key] : () => () => {} },
  }) as unknown as TuiService
  const runtime = new SessionRuntime(ctx, tui)
  await runtime.start()
  await Promise.resolve()
  return {
    ctx, children, calls, runtime, root,
    inspect: (id: string) => inspect(id), closeInspect: () => closeInspect(),
    emit: (agent: Agent, frame: AssistantStreamFrame) => ctx.emit('agent/assistant-stream', { agent, frame }),
    async dispose() { await runtime.dispose(); await ctx.fiber.dispose(); await agentCtx.fiber.dispose() },
  }
}

describe('background subagent status routing', () => {
  it('ignores background stream traffic but replays the full live prefix when inspected', async () => {
    const f = await fixture()
    try {
      const attemptId = LlmAttemptId('attempt')
      for (const child of f.children) f.emit(child, { type: 'start', attemptId, revision: 0, turn: 1, step: 1 })
      f.calls.setSubagents.mockClear()
      for (let index = 0; index < 40; index += 1) {
        for (const child of f.children) f.emit(child, {
          type: 'chunk', attemptId, revision: index + 1, index, time: index,
          chunk: { type: 'text-delta', index: 0, text: `${child.id}:${index};` },
        })
      }
      expect(f.calls.setSubagents.mock.calls.length).toBe(0)
      expect(f.calls.streamDelta).not.toHaveBeenCalled()
      const child = f.children[0]!
      f.inspect(child.id)
      expect(f.calls.replaceSession.mock.lastCall?.[3]).toBe('refresh')
      expect(f.calls.streamDelta).toHaveBeenCalledTimes(40)
      expect(f.calls.streamDelta.mock.calls.map(([delta]) => delta.chunk.text).join(''))
        .toBe(Array.from({ length: 40 }, (_, index) => `${child.id}:${index};`).join(''))
      f.emit(child, {
        type: 'chunk', attemptId, revision: 41, index: 40, time: 41,
        chunk: { type: 'tool-call-delta', index: 1, id: 'call', name: 'read', argumentsDelta: '{"path":' },
      })
      expect(f.calls.streamDelta).toHaveBeenCalledTimes(41)
      f.closeInspect()
      expect(f.calls.replaceSession.mock.lastCall?.[3]).toBe('refresh')
      f.calls.streamDelta.mockClear()
      f.emit(child, {
        type: 'chunk', attemptId, revision: 42, index: 41, time: 42,
        chunk: { type: 'tool-call-delta', index: 1, argumentsDelta: '"file"}' },
      })
      expect(f.calls.streamDelta).not.toHaveBeenCalled()
      expect(f.calls.setSubagents.mock.calls.length).toBe(0)
      f.emit(child, { type: 'end', attemptId, revision: 43, index: 42, outcome: { kind: 'abandoned' } })
      f.inspect(child.id)
      expect(f.calls.streamDelta).not.toHaveBeenCalled()
    } finally { await f.dispose() }
  })

  it('publishes ready, stopped and resumed running states without replaying history', async () => {
    const f = await fixture()
    try {
      const child = f.children[0]!
      const history = vi.spyOn(child.session, 'ownEvents')
      child.session.append('step/start', { turn: 1, step: 1 })
      child.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      expect(f.calls.setSubagents.mock.lastCall?.[0].agents.find((row: { id: string }) => row.id === child.id)?.phase).toBe('waiting')
      child.session.append('step/start', { turn: 2, step: 1 })
      expect(f.calls.setSubagents.mock.lastCall?.[0].agents.find((row: { id: string }) => row.id === child.id)?.phase).toBe('running')
      child.session.append('turn/end', { turn: 2, reason: { kind: 'aborted' } })
      expect(f.calls.setSubagents.mock.lastCall?.[0].agents.find((row: { id: string }) => row.id === child.id)?.phase).toBe('stopped')
      f.ctx.emit('agent/status', { agent: child, status: 'idle' })
      expect(f.calls.setSubagents.mock.lastCall?.[0].agents.find((row: { id: string }) => row.id === child.id)?.phase).toBe('stopped')
      child.session.append('step/start', { turn: 3, step: 1 })
      expect(f.calls.setSubagents.mock.lastCall?.[0].agents.find((row: { id: string }) => row.id === child.id)?.phase).toBe('running')
      expect(history).not.toHaveBeenCalled()
    } finally { await f.dispose() }
  })
})

it('projects concurrent approval requests only for exact live descendants and clears on completion', async () => {
  const f = await fixture()
  try {
    const child = f.children[0]!
    expect(f.runtime.beginSubagentApproval(f.root)).toBeUndefined()
    expect(f.runtime.beginSubagentApproval({ ...child } as Agent)).toBeUndefined()
    const first = f.runtime.beginSubagentApproval(child)!
    const second = f.runtime.beginSubagentApproval(child)!
    const row = () => f.calls.setSubagents.mock.lastCall?.[0]?.agents.find((item: { id: string }) => item.id === child.id)
    expect(first.label).toBe('Worker 0')
    expect(row()?.needsApproval).toBe(true)
    first.finish()
    expect(row()?.needsApproval).toBe(true)
    second.finish()
    expect(row()?.needsApproval).toBe(false)
    const third = f.runtime.beginSubagentApproval(child)!
    f.ctx.emit('agent/disposed', { agent: child })
    expect(third.signal.aborted).toBe(true)
    third.finish()
    Object.assign(f.ctx.subagents, { rootOf: () => { throw new Error('UNAUTHORIZED') } })
    expect(f.runtime.beginSubagentApproval(child)).toBeUndefined()
  } finally { await f.dispose() }
})

it('interrupts the inspected child through Harness without cancelling the parent', async () => {
  const f = await fixture()
  const interrupt = vi.fn()
  Object.assign(f.ctx.subagents, { interrupt })
  try {
    expect(f.runtime.interruptVisible()).toBe(false)
    f.inspect(f.children[0]!.id)
    expect(f.runtime.interruptVisible()).toBe(true)
    expect(interrupt).toHaveBeenCalledWith(f.children[0]!.id, { kind: 'ancestor', agent: f.root })
    f.closeInspect()
    expect(f.runtime.interruptVisible()).toBe(false)
  } finally { await f.dispose() }
})


function queueInbox(agent: Agent, messages: UserMessage[]) {
  const nextTurn = [...messages], nextStep: UserMessage[] = []
  const inbox = {
    nextTurn, nextStep,
    remove: vi.fn((id: string) => {
      for (const list of [nextTurn, nextStep]) {
        const index = list.findIndex(message => message.id === id)
        if (index >= 0) { list.splice(index, 1); return true }
      }
      return false
    }),
    replace: vi.fn((id: string, replacement: UserMessage) => {
      const index = nextTurn.findIndex(message => message.id === id)
      if (index < 0) return false
      nextTurn[index] = replacement
      return true
    }),
    splice: vi.fn((target: string, start: number, count: number, inserted: UserMessage[]) =>
      (target === 'next-turn' ? nextTurn : nextStep).splice(start, count, ...inserted)),
  }
  const steer = vi.fn((message: UserMessage) => { nextStep.push(message) })
  Object.assign(agent, { inbox, steer })
  return { ...inbox, steer }
}
const queued = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

describe('inspected subagent queue ownership', () => {
  it('edits, reorders, steers and withdraws only the selected child inbox', async () => {
    const f = await fixture()
    try {
      const child = f.children[0]!, first = queued('first'), second = queued('second')
      const parentMessage = queued('parent')
      const parent = queueInbox(f.root, [parentMessage])
      const inbox = queueInbox(child, [first, second])
      f.inspect(child.id)
      f.calls.prompt.mockResolvedValueOnce(`up:next-turn:${second.id}`)
        .mockResolvedValueOnce(`steer:next-turn:${first.id}`)
        .mockResolvedValueOnce(`next-turn:${second.id}`).mockResolvedValueOnce('edited')
        .mockResolvedValueOnce(`delete:next-step:${first.id}`)
      await f.runtime.openQueue(new AbortController().signal)
      expect(inbox.splice).toHaveBeenCalledWith('next-turn', 0, 2, [second, first])
      expect(inbox.steer).toHaveBeenCalledWith(first)
      expect(inbox.nextStep).toEqual([])
      expect(inbox.nextTurn[0]?.content).toEqual([{ type: 'text', text: 'edited' }])
      expect(parent.nextTurn).toEqual([parentMessage])
      expect(parent.remove).not.toHaveBeenCalled()
      expect(f.calls.prompt.mock.calls.every(([request]) => request.detail === 'Worker 0')).toBe(true)
    } finally { await f.dispose() }
  })

  it('allows a stopped child queue to be edited but refuses steering without an active turn', async () => {
    const f = await fixture()
    try {
      const child = f.children[0]!, message = queued('queued')
      const inbox = queueInbox(child, [message])
      Object.assign(child, { status: 'idle' })
      child.session.append('turn/end', { turn: 1, reason: { kind: 'aborted' } })
      f.inspect(child.id)
      f.calls.prompt.mockResolvedValueOnce(`steer:next-turn:${message.id}`)
        .mockResolvedValueOnce(`next-turn:${message.id}`).mockResolvedValueOnce('revised')
      await f.runtime.openQueue(new AbortController().signal)
      expect(inbox.steer).not.toHaveBeenCalled()
      expect(inbox.nextTurn[0]?.content).toEqual([{ type: 'text', text: 'revised' }])
      expect(f.calls.notice).toHaveBeenCalledWith('Steering needs an active turn. The message stays queued.', undefined)
    } finally { await f.dispose() }
  })

  it.each(['cold', 'unowned', 'readonly'])('rejects %s children without changing an inbox or resuming a session', async kind => {
    const f = await fixture()
    try {
      const child = f.children[0]!, inbox = queueInbox(child, [queued('keep')])
      if (kind === 'readonly') child.session.append('subagent/descriptor', { version: 2, mode: 'one-shot', provider: 'spawn', label: 'Read only' })
      f.inspect(child.id)
      if (kind === 'cold') Object.assign(f.ctx.agents, { get: (id: string) => id === f.root.id ? f.root : undefined })
      if (kind === 'unowned') Object.assign(f.ctx.subagents, { rootOf: () => { throw new Error('UNAUTHORIZED') } })
      await expect(f.runtime.openQueue(new AbortController().signal)).rejects.toThrow(kind === 'cold' ? 'not loaded locally' : kind === 'readonly' ? 'read-only' : 'no longer active')
      expect(inbox.remove).not.toHaveBeenCalled()
      expect(f.calls.prompt).not.toHaveBeenCalled()
    } finally { await f.dispose() }
  })

  it.each(['navigate', 'consume', 'cancel'])('keeps attachment recall safe when %s races the image read', async action => {
    const f = await fixture()
    try {
      const ref = { attachmentId: AttachmentId('queued-image'), mediaType: 'image/png' as const, width: 1, height: 1, bytes: 3 }
      const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'image' }, { type: 'image', attachment: ref }] })
      const child = f.children[0]!, inbox = queueInbox(child, [message])
      let finish: () => void = () => {}
      f.ctx.provide('attachments', { readImage: () => new Promise(resolve => { finish = () => resolve({ ref, data: new Uint8Array([1, 2, 3]) }) }) })
      f.inspect(child.id)
      const abort = new AbortController()
      const recall = f.runtime.editLatestFollowup({ sessionId: child.id, signal: abort.signal })
      expect(inbox.nextTurn).toEqual([message])
      if (action === 'navigate') f.closeInspect()
      if (action === 'consume') inbox.nextTurn.splice(0)
      if (action === 'cancel') abort.abort()
      finish()
      if (action === 'consume') await expect(recall).resolves.toBeUndefined()
      else {
        await expect(recall).rejects.toThrow()
        expect(inbox.remove).not.toHaveBeenCalled()
        expect(inbox.nextTurn).toEqual([message])
      }
    } finally { await f.dispose() }
  })

  it('rescues an edit submitted just before navigation into its original child draft', async () => {
    const f = await fixture()
    try {
      const child = f.children[0]!, message = queued('original'), inbox = queueInbox(child, [message])
      f.inspect(child.id)
      f.calls.prompt.mockResolvedValueOnce(`next-turn:${message.id}`).mockImplementationOnce(async () => {
        f.closeInspect()
        return 'edited before navigation'
      })
      await f.runtime.openQueue(new AbortController().signal)
      expect(inbox.nextTurn).toEqual([message])
      expect(f.calls.restoreInput).toHaveBeenCalledWith(expect.objectContaining({ text: 'edited before navigation' }), child.id)
    } finally { await f.dispose() }
  })

  it('opens the new queue while an aborted child image restoration is still settling', async () => {
    const f = await fixture()
    try {
      const ref = { attachmentId: AttachmentId('slow-image'), mediaType: 'image/png' as const, width: 1, height: 1, bytes: 1 }
      const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'image', attachment: ref }] })
      const child = f.children[0]!, inbox = queueInbox(child, [message])
      let finish: () => void = () => {}
      const readImage = vi.fn(() => new Promise(resolve => { finish = () => resolve({ ref, data: new Uint8Array([1]) }) }))
      f.ctx.provide('attachments', { readImage })
      f.inspect(child.id)
      f.calls.prompt.mockResolvedValueOnce(`next-turn:${message.id}`)
      const old = f.runtime.openQueue(new AbortController().signal)
      await vi.waitFor(() => expect(readImage).toHaveBeenCalledOnce())
      f.closeInspect()
      await f.runtime.openQueue(new AbortController().signal)
      finish()
      await old
      expect(inbox.nextTurn).toEqual([message])
      expect(f.calls.prompt).toHaveBeenCalledTimes(2)
    } finally { await f.dispose() }
  })

  it('refreshes the child inbox and closes its queue on disposal', async () => {
    const f = await fixture()
    try {
      const child = f.children[0]!, inbox = queueInbox(child, [queued('old')])
      f.inspect(child.id)
      f.calls.prompt.mockImplementationOnce(async request => {
        inbox.nextTurn.splice(0, 1, queued('new'))
        expect(request.refreshOptions?.()?.[0]?.label).toContain('new')
        f.ctx.emit('agent/disposed', { agent: child })
        expect(request.signal?.aborted).toBe(true)
        return null
      })
      await f.runtime.openQueue(new AbortController().signal)
    } finally { await f.dispose() }
  })
})

function startWorkflow(f: Awaited<ReturnType<typeof fixture>>) {
  const runId = 'workflow-run' as never
  f.root.session.append('tool-workflow/run-start', { runId, name: 'Review workflow' })
  for (const [index, child] of f.children.entries()) {
    f.root.session.append('tool-workflow/agent-start', { runId, seq: index + 1, childId: child.id, label: `Member ${index}`, phase: 'Check' })
  }
  return runId
}

describe('workflow member navigation', () => {
  it('opens an exact live owned member through the existing child inspector', async () => {
    const f = await fixture()
    try {
      const id = startWorkflow(f)
      f.calls.prompt.mockResolvedValueOnce('member:2')
      await f.runtime.openWorkflow(id)
      expect(f.calls.setInspectedSubagent.mock.lastCall?.[0]).toMatchObject({ id: f.children[1]!.id, label: 'Worker 1', writable: true })
      expect(f.calls.prompt.mock.calls[0]?.[0].options?.find(row => row.value === 'member:2')?.disabled).toBe(false)
    } finally { await f.dispose() }
  })

  it.each(['settled', 'idle', 'unloaded', 'unowned'])('keeps %s members visible without offering navigation', async kind => {
    const f = await fixture()
    try {
      const id = startWorkflow(f), child = f.children[0]!
      if (kind === 'settled') f.root.session.append('tool-workflow/agent-end', { runId: id, seq: 1, outcome: 'completed' })
      if (kind === 'idle') Object.assign(child, { status: 'idle' })
      if (kind === 'unloaded') Object.assign(f.ctx.agents, { get: (id: string) => [f.root, ...f.children.slice(1)].find(agent => agent.id === id) })
      if (kind === 'unowned') Object.assign(f.ctx.subagents, { rootOf: () => { throw new Error('UNAUTHORIZED') } })
      await f.runtime.openWorkflow(id)
      const row = f.calls.prompt.mock.calls[0]?.[0].options?.find(row => row.value === 'member:1')
      expect(row).toMatchObject({ label: 'Member 0', disabled: true })
      expect(f.calls.setInspectedSubagent.mock.calls.some(([view]) => view?.id === child.id)).toBe(false)
    } finally { await f.dispose() }
  })

  it('refreshes terminal status without removing or reordering members', async () => {
    const f = await fixture()
    try {
      const id = startWorkflow(f)
      f.calls.prompt.mockImplementationOnce(async request => {
        const before = request.options!
        f.root.session.append('tool-workflow/agent-end', { runId: id, seq: 2, outcome: 'failed' })
        const after = request.refreshOptions!()
        expect(after.map(row => row.value)).toEqual(before.map(row => row.value))
        expect(after.find(row => row.value === 'member:2')).toMatchObject({ disabled: true, badge: { label: 'Failed' } })
        expect(after.find(row => row.value === 'member:1')?.disabled).toBe(false)
        return null
      })
      await f.runtime.openWorkflow(id)
    } finally { await f.dispose() }
  })

  it('rechecks member liveness after Enter instead of cold-opening a settled child', async () => {
    const f = await fixture()
    try {
      const id = startWorkflow(f)
      f.calls.prompt.mockImplementationOnce(async () => {
        Object.assign(f.children[0]!, { status: 'idle' })
        return 'member:1'
      })
      await f.runtime.openWorkflow(id)
      expect(f.calls.notice).toHaveBeenCalledWith('This workflow member is no longer available to open.')
      expect(f.calls.prompt).toHaveBeenCalledTimes(2)
      expect(f.calls.setInspectedSubagent.mock.calls.some(([view]) => view?.id === f.children[0]!.id)).toBe(false)
    } finally { await f.dispose() }
  })

  it('closes the workflow prompt when the inspected session changes', async () => {
    const f = await fixture()
    try {
      const id = startWorkflow(f)
      f.inspect(f.children[0]!.id)
      f.calls.prompt.mockImplementationOnce(async request => {
        f.closeInspect()
        expect(request.signal?.aborted).toBe(true)
        return 'member:2'
      })
      await f.runtime.openWorkflow(id)
      expect(f.calls.setInspectedSubagent.mock.lastCall?.[0]).toBeUndefined()
    } finally { await f.dispose() }
  })
})
