import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, ModelSelection } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage, ReasoningEffortId, ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalProjection } from '@deepseek-ai/dsh-goal/types'
import { mcpCatalogText } from '../commands/integrations.ts'
import type { TuiService, TuiSubmission } from '../definition.ts'

import {
  conversationTurns,
  createSubmissionMessage,
  encodeCommandAttachments,
  modelStatus,
  recentSessionContent,
  restoreSubmissionMessage,
  SessionRuntime,
  DefaultModelSaveError,
  sessionControls,
  shouldRefreshSessionInfoAfter,
  sessionStats,
  userSkillCommands,
} from './session-controller.ts'

/** Agent-owned selection stand-in: the runtime reads it and records replacements. */
function stubModel(initial: ModelSelection) {
  let current: ModelSelection | undefined = initial
  return { current: () => current, select: (next: ModelSelection) => { current = next } }
}


function stubTui(): TuiService {
  return {
    onInspectSubagent: () => () => {},
    onInspectClose: () => () => {},
    onInspectSubmit: () => () => {},
    setQueueHandler: () => () => {},
    setSessionSearch: () => {},
    setFileSearch: () => {},
    setImageValidator: () => {},
    setInspectedSubagent: () => {},
    setSubagents: () => {},
    restoreInput: vi.fn(),
    notice: vi.fn(),
    commandOutput: vi.fn(),
  } as unknown as TuiService
}

const PNG_1X1 = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zk5sAAAAASUVORK5CYII=',
  'base64',
))

describe('modelStatus', () => {
  it('shows the effective adapter default and prefers an explicit effort', () => {
    const base = { provider: 'deepseek-official', model: 'deepseek-v4-pro' }
    const info = {
      reasoning: {
        efforts: [],
        defaultEffort: ReasoningEffortId('high'),
      },
    }
    expect(modelStatus(base, info)).toEqual({ model: 'deepseek-v4-pro', reasoningEffort: 'high' })
    expect(modelStatus({ ...base, reasoningEffort: ReasoningEffortId('max') }, info))
      .toEqual({ model: 'deepseek-v4-pro', reasoningEffort: 'max' })
  })
})

describe('sessionControls', () => {
  it.each([
    [false, undefined, false], [false, true, true], [false, false, false],
    [true, undefined, false], [true, false, true], [true, true, false],
  ] as const)('distinguishes a pending target from a pending change (%s → %s)', (active, pending, changing) => {
    expect(sessionControls({ plan: { active: !active, pending: true }, permissions: { currentValue: 'read-only', options: [] } },
      { active, ...(pending === undefined ? {} : { pending }) })).toEqual({ plan: { active, pending: changing }, permission: 'read-only' })
  })

  it('projects Harness plan and permission state without inventing defaults', () => {
    expect(sessionControls()).toEqual({})
    expect(sessionControls({
      plan: { active: true, pending: false },
      permissions: { currentValue: 'workspace-write', options: [] },
    })).toEqual({
      plan: { active: true, pending: false },
      permission: 'workspace-write',
    })
  })

  it('counts only continued questions from the Harness projection', () => {
    const questions = [{ id: 'scope', question: 'Which scope?' }]
    expect(sessionControls({ userQuestions: {
      active: [
        { callId: ToolCallId('open'), state: 'open', questions },
        { callId: ToolCallId('continued'), state: 'continued', questions },
      ], settled: [],
    } }).pendingQuestions).toBe(1)
    expect(sessionControls({ userQuestions: { active: [], settled: [] } }).pendingQuestions).toBe(0)
  })

  it('reports the logged sandbox override ahead of the standing preset', () => {
    const permissions = { currentValue: 'workspace-write', options: [] }
    expect(sessionControls({ permissions })).toEqual({ permission: 'workspace-write' })
    expect(sessionControls({ permissions, sandboxMode: 'danger-full-access' })).toEqual({ permission: 'danger-full-access' })
    // null means no override was ever logged; the preset still describes the mode.
    expect(sessionControls({ permissions, sandboxMode: null })).toEqual({ permission: 'workspace-write' })
  })

  it('projects the durable goal and hides a completed one', () => {
    const projection: GoalProjection = {
      goal: { id: GoalId('goal-1'), revision: 2, objective: 'Land batch 2', phase: 'active', maxGoalRounds: 12 },
      roundsStarted: 3,
      createdAt: 1_000,
      updatedAt: 2_000,
    }
    expect(sessionControls({ goal: projection })).toEqual({
      goal: { phase: 'active', objective: 'Land batch 2', roundsStarted: 3, maxGoalRounds: 12 },
    })
    const blocked: GoalProjection = {
      ...projection,
      goal: {
        ...projection.goal,
        phase: 'blocked',
        blockedReason: { code: 'waiting', message: 'waiting on the API key' },
      },
    }
    expect(sessionControls({ goal: blocked }).goal).toMatchObject({
      phase: 'blocked',
      blockedReason: 'waiting on the API key',
    })
    expect(sessionControls({ goal: null })).toEqual({})
    expect(sessionControls({
      goal: { ...projection, goal: { ...projection.goal, phase: 'complete' } },
    })).toEqual({})
  })

  it('reads only client-visible snapshot values for footer inputs', () => {
    const snapshot = {
      sessionStats: { turns: 4, steps: 9, llmMs: 11, toolMs: 22, ttftMs: 5, ttftSteps: 3, decodeMs: 6, decodeTokens: 7 },
      tokenUsage: { uncachedInputTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 3, outputTokens: 8 },
      contextPressure: { projectedTokens: 40, contextWindow: 128_000 },
      plan: { active: false, pending: true },
      permissions: { currentValue: 'read-only', options: [] },
    }
    expect(sessionControls(snapshot)).toEqual({
      plan: { active: false, pending: true },
      permission: 'read-only',
    })
    expect(sessionStats([], undefined, snapshot)).toMatchObject({
      turns: 4,
      steps: 9,
      inputTokens: 6,
      outputTokens: 8,
      contextTokens: 40,
      contextWindow: 128_000,
    })
  })
})

describe('createSubmissionMessage', () => {
  const pngRef = {
    attachmentId: AttachmentId('attachment:test'),
    mediaType: 'image/png' as const,
    bytes: PNG_1X1.byteLength,
    width: 1,
    height: 1,
    name: 'clipboard.png',
  }

  it('admits one ordered image batch and emits one mixed user message', async () => {
    const first = { ...pngRef, attachmentId: AttachmentId('attachment:one'), name: 'one.png' }
    const second = { ...pngRef, attachmentId: AttachmentId('attachment:two'), name: 'two.webp', mediaType: 'image/webp' as const }
    const attachments = {
      saveImages: vi.fn(async (inputs: readonly { name?: string }[]) => {
        expect(inputs.map(input => input.name)).toEqual(['one.png', 'two.webp'])
        return [first, second]
      }),
    }

    const message = await createSubmissionMessage({
      text: 'describe these',
      images: [
        { data: PNG_1X1, mediaType: 'image/png', name: 'one.png', width: 1, height: 1 },
        { data: PNG_1X1, mediaType: 'image/webp', name: 'two.webp', width: 1, height: 1 },
      ],
    }, attachments)

    expect(attachments.saveImages).toHaveBeenCalledOnce()
    expect(message.content).toEqual([
      { type: 'text', text: 'describe these' },
      { type: 'image', attachment: first },
      { type: 'image', attachment: second },
    ])
  })

  it('keeps a picture where the reader inserted it', async () => {
    const attachments = { saveImages: vi.fn(async () => [pngRef]) }
    const message = await createSubmissionMessage({
      text: '看这个 怎么样',
      images: [{ data: PNG_1X1, mediaType: 'image/png', name: 'clipboard.png', width: 1, height: 1 }],
      segments: [
        { kind: 'text', text: '看这个' },
        { kind: 'image', index: 0 },
        { kind: 'text', text: '怎么样' },
      ],
    }, attachments)
    expect(message.content).toEqual([
      { type: 'text', text: '看这个' },
      { type: 'image', attachment: pngRef },
      { type: 'text', text: '怎么样' },
    ])
  })

  it('keeps an unmarked attachment instead of dropping it', async () => {
    const attachments = { saveImages: vi.fn(async () => [pngRef]) }
    const message = await createSubmissionMessage({
      text: 'no marker here',
      images: [{ data: PNG_1X1, mediaType: 'image/png', name: 'clipboard.png', width: 1, height: 1 }],
      segments: [{ kind: 'text', text: 'no marker here' }],
    }, attachments)
    expect(message.content).toEqual([
      { type: 'text', text: 'no marker here' },
      { type: 'image', attachment: pngRef },
    ])
  })

  it('commits no user event when batch admission fails', async () => {
    await expect(createSubmissionMessage({
      text: 'keep this draft',
      images: [{ data: PNG_1X1, mediaType: 'image/png', name: 'bad.png' }],
    }, {
      saveImages: async () => { throw new Error('Image batch exceeds the configured image-count limit.') },
    })).rejects.toThrow(/image-count limit/u)
  })

  it('still admits images when the selected model cannot accept them', async () => {
    const attachments = {
      saveImages: vi.fn(async () => [pngRef]),
    }
    const message = await createSubmissionMessage({
      text: 'text-only model',
      images: [{ data: PNG_1X1, mediaType: 'image/png', name: 'clipboard.png' }],
    }, attachments)
    expect(attachments.saveImages).toHaveBeenCalledOnce()
    expect(message.content).toEqual([
      { type: 'text', text: 'text-only model' },
      { type: 'image', attachment: pngRef },
    ])
  })

  it('rehydrates a durable queued message into an editable mixed draft', async () => {
    const ref = {
      attachmentId: AttachmentId('attachment:queued'),
      mediaType: 'image/png' as const,
      bytes: PNG_1X1.byteLength,
      width: 1,
      height: 1,
      name: 'queued.png',
      originalDimensions: { width: 2000, height: 1000 },
    }
    const message = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'edit me' }, { type: 'image', attachment: ref }],
    })

    await expect(restoreSubmissionMessage(message, {
      readImage: async () => ({ ref, data: PNG_1X1 }),
    })).resolves.toEqual({
      text: 'edit me',
      images: [{ data: PNG_1X1, mediaType: 'image/png', name: 'queued.png', width: 1, height: 1 }],
      segments: [{ kind: 'text', text: 'edit me' }, { kind: 'image', index: 0 }],
    })
  })
})

describe('durable file submissions', () => {
  it('retains mixed attachment placement through durable queue recall and resubmission', async () => {
    const file = { attachmentId: AttachmentId('file:ordered'), name: 'task.txt', bytes: 5 }
    const image = { attachmentId: AttachmentId('image:ordered'), mediaType: 'image/png' as const, name: 'plot.png', bytes: PNG_1X1.length, width: 1, height: 1 }
    const message = createUserMessage({ source: { kind: 'user' }, content: [
      { type: 'file', attachment: file }, { type: 'text', text: 'compare' }, { type: 'image', attachment: image },
    ] })
    const restored = await restoreSubmissionMessage(message, { readImage: async () => ({ data: PNG_1X1, ref: image }) })
    expect((await createSubmissionMessage(restored, { saveImages: async () => [image] })).content).toEqual(message.content)
  })

  it('submits and restores original file references without buffering or re-uploading bytes', async () => {
    const ref = { attachmentId: AttachmentId('file:test'), name: 'report.txt', bytes: 4096 }
    const message = await createSubmissionMessage({ text: 'Review this', images: [], files: [ref] })
    expect(message.content).toEqual([{ type: 'text', text: 'Review this' }, { type: 'file', attachment: ref }])
    await expect(restoreSubmissionMessage(message)).resolves.toEqual({ text: 'Review this', images: [], files: [ref],
      segments: [{ kind: 'text', text: 'Review this' }, { kind: 'file', index: 0 }] })
    expect((await createSubmissionMessage({ text: '', images: [], files: [ref] })).content).toEqual([{ type: 'file', attachment: ref }])
  })
})

describe('conversationTurns', () => {
  it('exposes direct human turns with the balanced prefix before each turn', () => {
    const events = [
      { type: 'session/start', data: {} },
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'First question' }] } },
      { type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [] }, stream: [] } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: 'Injected context' }] } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [
        { type: 'text', text: 'Second\nquestion' },
        { type: 'image', attachment: {} },
      ] } },
      { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
    ] as unknown as SessionEvent[]

    expect(conversationTurns(events)).toEqual([
      { turn: 1, messageIndex: 2, branchIndex: 1, preview: 'First question', imageCount: 0 },
      { turn: 2, messageIndex: 7, branchIndex: 5, preview: 'Second question', imageCount: 1 },
    ])
  })

  it('ignores human messages without a safe turn boundary', () => {
    const events = [
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'orphan' }] } },
    ] as unknown as SessionEvent[]

    expect(conversationTurns(events)).toEqual([])
  })
})

describe('sessionStats', () => {
  it('folds boundaries and disjoint token usage', () => {
    const events = [
      { type: 'step/start', time: 10, data: { turn: 1, step: 1 } },
      { type: 'assistant/message', time: 20, data: {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'text', text: 'hi' }] },
        stream: [{ type: 'text-chunks', time0: 12, index: 0, dt: [], texts: ['hi'] }],
        usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 3 },
      } },
      { type: 'step/end', time: 25, data: { turn: 1, step: 1 } },
      { type: 'turn/end', time: 30, data: { turn: 1 } },
    ] as unknown as SessionEvent[]
    expect(sessionStats(events, 100)).toEqual({
      turns: 1,
      steps: 1,
      llmMs: 10,
      toolMs: 0,
      ttftMs: 2,
      ttftSteps: 1,
      decodeMs: 8,
      decodeTokens: 4,
      inputTokens: 13,
      outputTokens: 4,
      cacheReadTokens: 3,
      cacheWriteTokens: 0,
      contextTokens: 17,
      contextWindow: 100,
      elapsedMs: 20,
    })
  })

  it('prefers durable projection values over the fallback fold', () => {
    expect(sessionStats([], undefined, {
      sessionStats: { turns: 2, steps: 5, llmMs: 10, toolMs: 20, ttftMs: 3, ttftSteps: 2, decodeMs: 4, decodeTokens: 8 },
      tokenUsage: { uncachedInputTokens: 10, cacheReadTokens: 90, cacheWriteTokens: 5, outputTokens: 7 },
    })).toMatchObject({
      turns: 2,
      steps: 5,
      inputTokens: 105,
      outputTokens: 7,
      cacheReadTokens: 90,
      cacheWriteTokens: 5,
    })
  })

  it('reads only event boundaries when every durable stats projection is available', () => {
    const events = [
      { time: 10 },
      { time: 15 },
      { time: 30 },
    ] as SessionEvent[]
    let reads = 0
    const observed = new Proxy(events, {
      get(target, property, receiver) {
        if (property !== 'length') reads += 1
        return Reflect.get(target, property, receiver)
      },
    })

    expect(sessionStats(observed, undefined, {
      sessionStats: { turns: 2, steps: 5, llmMs: 10, toolMs: 20, ttftMs: 3, ttftSteps: 2, decodeMs: 4, decodeTokens: 8 },
      tokenUsage: { uncachedInputTokens: 10, cacheReadTokens: 90, cacheWriteTokens: 5, outputTokens: 7 },
      contextPressure: { projectedTokens: 123, contextWindow: 1_000 },
    })).toMatchObject({
      turns: 2,
      steps: 5,
      contextTokens: 123,
      contextWindow: 1_000,
      elapsedMs: 20,
    })
    expect(reads).toBe(2)
  })
})

describe('shouldRefreshSessionInfoAfter', () => {
  it('skips attempt settlements without usage and refreshes other settled events', () => {
    expect(shouldRefreshSessionInfoAfter({
      type: 'assistant/attempt',
      data: { turn: 1, step: 1, stream: [] },
    } as SessionEvent)).toBe(false)
    expect(shouldRefreshSessionInfoAfter({
      type: 'assistant/message',
      data: { turn: 1, step: 1, message: { content: [] }, stream: [] },
    } as SessionEvent)).toBe(true)
    expect(shouldRefreshSessionInfoAfter({
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    } as SessionEvent)).toBe(true)
  })
})

describe('recentSessionContent', () => {
  it('does not expose a durable session before it contains a human message', () => {
    const events = [
      { type: 'session/start', data: {} },
      { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: 'Hidden context' }] } },
    ] as unknown as SessionEvent[]

    expect(recentSessionContent(events)).toBeUndefined()
  })

  it('keeps the generated title and previews the latest human message', () => {
    const events = [
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'First question' }] } },
      { type: 'session/title', data: { title: 'Renderer work' } },
      { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: 'Hidden context' }] } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '  Latest\nquestion  ' }] } },
    ] as unknown as SessionEvent[]

    expect(recentSessionContent(events)).toEqual({
      title: 'Renderer work',
      preview: 'Latest question',
    })
  })

  it('does not duplicate a single human message as its own preview', () => {
    const events = [
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Only message' }] } },
    ] as unknown as SessionEvent[]

    expect(recentSessionContent(events)).toEqual({ title: 'Only message' })
  })
})

describe('capability catalogs', () => {
  it('exposes only human-invocable skills as slash commands', () => {
    const base = {
      description: 'Review code', source: 'project-dsh', provider: 'filesystem',
      invocation: { modelInvocable: true, userInvocable: true },
    } as const
    expect(userSkillCommands([
      { ...base, name: 'code-review' },
      { ...base, name: 'reserved' },
      { ...base, name: 'manual', invocation: { modelInvocable: false, userInvocable: true } },
      { ...base, name: 'hidden', invocation: { modelInvocable: true, userInvocable: false } },
    ], new Set(['reserved']))).toEqual([
      { name: 'code-review', description: 'Review code', skill: { userOnly: false } },
      { name: 'manual', description: 'Review code', skill: { userOnly: true } },
    ])
  })

  it('groups MCP tools by server', () => {
    expect(mcpCatalogText([
      { name: 'bash', description: 'shell' },
      { name: 'mcp__github__issues', description: 'List issues' },
      { name: 'mcp__github__pulls', description: 'List pulls' },
      { name: 'mcp__memory__search', description: '' },
    ])).toBe([
      'MCP tools · Servers: 2 · Tools: 3',
      '',
      '**github · Tools: 2**',
      '| Tool | Description |',
      '|---|---|',
      '| `issues` | List issues |',
      '| `pulls` | List pulls |',
      '',
      '**memory · Tools: 1**',
      '| Tool | Description |',
      '|---|---|',
      '| `search` | No description provided. |',
    ].join('\n'))
  })
})

describe('encodeCommandAttachments', () => {
  it('encodes composer drafts as canonical typed command attachments', () => {
    const data = new Uint8Array([1, 2, 3, 4])
    expect(encodeCommandAttachments([{ data, mediaType: 'image/png', name: 'shot.png' }])).toEqual([
      { type: 'image', data: Buffer.from(data).toString('base64'), mediaType: 'image/png', name: 'shot.png' },
    ])
  })
})

describe('SessionRuntime.execute', () => {
  it('does not treat a handwritten image placeholder as a slash command', async () => {
    const ctx = new Context()
    const runtime = new SessionRuntime(ctx, stubTui())
    await expect(runtime.execute('[Image #1] /goal literal', new AbortController().signal, []))
      .resolves.toBe(false)
    await runtime.dispose()
    await ctx.fiber.dispose()
  })
})

describe('SessionRuntime inspected-subagent delivery', () => {
  it.each(['queue', 'steer', 'abort-delivery', 'accepted-before-close', 'rejected', 'ordered', 'files', 'seeded'] as const)('routes %s delivery through the host and restores only unaccepted drafts', async mode => {
    const rootId = SessionId('session-steer-root')
    const childId = SessionId('session-steer-child')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const rootSession = ctx.sessions.create(rootId)
    if (mode === 'seeded') {
      rootSession.append('step/end', { turn: 1, step: 1 })
      rootSession.append('step/end', { turn: 2, step: 1 })
    }
    const seed = mode === 'seeded' ? rootSession.snapshotEvents() : []
    const childSession = ctx.sessions.create(childId, {
      seed, inheritedEventCount: SessionLogOffset(seed.length),
      meta: {
        parentSession: rootId,
        isSeeded: mode === 'seeded',
        origin: 'subagent',
        delegationDepth: 1,
      },
    })
    childSession.append('subagent/descriptor', {
      version: 2,
      mode: 'continuable',
      provider: 'spawn',
      label: 'Steer child',
    })
    ctx.provide('agentPresets', {
      defaultId: 'standard',
      presetForSession: () => 'standard',
      resolve: async () => ({ id: 'standard' }),
      mount: async () => ({ id: 'standard' }),
    })
    const rootAgent = {
      id: rootId,
      session: rootSession,
      status: 'idle',
      model: stubModel({ provider: 'deepseek', model: 'deepseek-chat' }),
      inbox: { nextTurn: [], nextStep: [] },
    } as unknown as Agent

    const agentCtx = new Context()
    await agentCtx.plugin(CommandRuntime)
    agentCtx.provide('agentPresets', {
      defaultId: 'standard',
      presetForSession: () => 'standard',
      resolve: async () => ({ id: 'standard' }),
      mount: async () => ({ id: 'standard' }),
    })
    agentCtx.provide('sessionProjections', { stateOf: () => 'standard' })
    agentCtx.provide('tools', { presentAs: () => () => undefined })
    agentCtx.provide('permissionPresets', { names: [], optionOf: () => undefined, current: () => undefined })

    const childAgent = { id: childId, session: childSession, status: 'running',
      model: stubModel({ provider: 'child-provider', model: 'child-model', reasoningEffort: ReasoningEffortId('low') }) } as unknown as Agent
    const promptRequest = vi.fn(async (_request: unknown, _signal: AbortSignal) => ({ messageId: 'message-id-1' }))
    const subagents = {
      listDescendants: async () => [],
      prompt: promptRequest,
      rootOf: (agent: Agent) => agent.id === rootId || agent.session.header.parentSession === rootId
        ? rootAgent
        : (() => { throw new Error('UNAUTHORIZED') })(),
      sendMessage: vi.fn(async () => 'sent-1'),
    }
    let childPermission = 'read-only'
    let childLoaded = true
    let otherAgent: Agent | undefined
    let projectionChanged: ((session: typeof childSession, key: 'permissions') => void) | undefined
    ctx.provide('sessionProjections', {
      snapshot: (session: typeof childSession) => ({ values: {
        permissions: { currentValue: session.id === childId ? childPermission : 'workspace-write', options: [] },
        ...(mode === 'seeded' ? {
          sessionStats: sessionStats(session.snapshotEvents()),
          tokenUsage: { uncachedInputTokens: 900, outputTokens: 200, cacheReadTokens: 100, cacheWriteTokens: 0 },
          contextPressure: { projectedTokens: 2048, contextWindow: 8192 },
        } : {}),
      } }),
      onChanged: (listener: typeof projectionChanged) => { projectionChanged = listener; return () => {} },
    } as never)
    ctx.provide('agents', {
      create: async (options: { setup?: (context: typeof agentCtx, agent: Agent) => Promise<void> }) => {
        await options.setup?.(agentCtx, rootAgent)
        return { agent: rootAgent, dispose: async () => undefined } as unknown as AgentHandle
      },
      get: (id: string) => id === rootId ? rootAgent : id === childId ? childLoaded ? childAgent : undefined : id === otherAgent?.id ? otherAgent : undefined,
    })
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }),
    })
    ctx.provide('subagents', subagents)

    const inspectCallbacks: Array<(id: string) => void> = []
    const submitCallbacks: Array<(submission: TuiSubmission) => void> = []
    let closeInspect = () => {}
    const restoreInput = vi.fn()
    const notice = vi.fn()
    const pendingPrepare = vi.fn()
    const pendingAcknowledge = vi.fn()
    const setStatus = vi.fn()
    const setInspectedSubagent = vi.fn()
    const setSession = vi.fn()
    const setWorkingDirectory = vi.fn()
    const tui = new Proxy({ restoreInput, notice, pendingInputs: { prepare: pendingPrepare, acknowledge: pendingAcknowledge },
      setStatus, setInspectedSubagent, setSession, setWorkingDirectory }, {
      get(target: Record<string, unknown>, prop: string) {
        if (prop in target) return target[prop]
        if (prop === 'onInspectSubagent') {
          return (handler: (id: string) => void) => {
            inspectCallbacks.push(handler)
            return () => {}
          }
        }
        if (prop === 'onInspectClose') return (handler: () => void) => { closeInspect = handler; return () => {} }
        if (prop === 'onInspectSubmit') {
          return (handler: (submission: TuiSubmission) => void) => {
            submitCallbacks.push(handler)
            return () => {}
          }
        }
        return () => () => {}
      },
    }) as unknown as TuiService

    const runtime = new SessionRuntime(ctx, tui)
    try {
      await runtime.start()
      expect(inspectCallbacks).toHaveLength(1)
      expect(setWorkingDirectory).toHaveBeenLastCalledWith(expect.any(String), { root: true })
      await inspectCallbacks[0]?.(childId)
      expect(setWorkingDirectory).toHaveBeenLastCalledWith(expect.any(String), { root: false })
      expect(setInspectedSubagent).toHaveBeenLastCalledWith(expect.objectContaining({
        id: childId, model: 'child-model', reasoningEffort: 'low', stats: expect.objectContaining({ turns: 0 }),
        controls: expect.objectContaining({ permission: 'read-only' }),
      }))
      childPermission = 'workspace-write'
      projectionChanged?.(childSession, 'permissions')
      expect(setInspectedSubagent).toHaveBeenLastCalledWith(expect.objectContaining({ controls: expect.objectContaining({ permission: 'workspace-write' }) }))
      childSession.append('step/end', { turn: 1, step: 1 })
      expect(setInspectedSubagent).toHaveBeenLastCalledWith(expect.objectContaining({ stats: expect.objectContaining({ turns: 1 }) }))
      if (mode === 'seeded') {
        const expected = { turns: 1, steps: 1, inputTokens: 0, outputTokens: 0 }
        expect(setInspectedSubagent.mock.lastCall?.[0].stats).toMatchObject({ ...expected, contextTokens: 2048, contextWindow: 8192 })
        closeInspect()
        const getSession = ctx.sessions.get.bind(ctx.sessions)
        const hidden = vi.spyOn(ctx.sessions, 'get').mockImplementation(id => id === childId ? undefined : getSession(id))
        childLoaded = false
        ctx.provide('sessionPersistence', { open: async () => ({
          header: { ...childSession.header, cwd: undefined }, inheritedEventCount: childSession.inheritedEventCount,
          read: async () => ({ events: childSession.snapshotEvents() }), close: async () => {},
        }) } as never)
        try {
          await inspectCallbacks[0]?.(childId)
          await vi.waitFor(() => expect(setInspectedSubagent).toHaveBeenLastCalledWith(expect.objectContaining({ id: childId })))
          expect(notice.mock.calls).toEqual([])
          expect(setInspectedSubagent.mock.lastCall?.[0].stats).toMatchObject(expected)
          expect(setWorkingDirectory).toHaveBeenLastCalledWith(process.cwd(), { root: false })
        } finally { hidden.mockRestore(); childLoaded = true }
        await inspectCallbacks[0]?.(childId)
        expect(setInspectedSubagent.mock.lastCall?.[0].stats).toMatchObject(expected)
      }
      if (mode === 'queue') {
        rootSession.append('working-directory/change', { cwd: process.cwd() })
        expect(setWorkingDirectory).toHaveBeenLastCalledWith(expect.any(String), { root: true })
        childSession.append('working-directory/change', { cwd: process.cwd() })
        expect(setWorkingDirectory).toHaveBeenLastCalledWith(expect.any(String), { root: false })
        const other = ctx.sessions.create(SessionId('session-other-child'), { meta: { parentSession: rootId, origin: 'subagent', delegationDepth: 1 } })
        otherAgent = { id: other.id, session: other, status: 'running', model: stubModel({ provider: 'other', model: 'other-model' }) } as unknown as Agent
        childLoaded = false
        const getSession = ctx.sessions.get.bind(ctx.sessions)
        const hidden = vi.spyOn(ctx.sessions, 'get').mockImplementation(id => id === childId ? undefined : getSession(id))
        try {
          const approval = runtime.beginSubagentApproval(otherAgent)
          expect(approval).toBeDefined()
          projectionChanged?.(childSession, 'permissions')
          expect(setInspectedSubagent).toHaveBeenLastCalledWith(expect.objectContaining({ id: childId, stats: expect.objectContaining({ turns: 1 }) }))
          expect(setInspectedSubagent.mock.lastCall?.[0].model).toBeUndefined()
          approval?.finish()
        } finally { hidden.mockRestore(); childLoaded = true }
      }
      setStatus.mockClear()
      ctx.emit('agent/status', { agent: rootAgent, status: 'idle' })
      expect(setStatus).toHaveBeenCalledWith('idle', { root: true })
      expect(setSession.mock.calls.every(([info]) => info.id === rootId)).toBe(true)
      projectionChanged?.(childSession, 'permissions')
      expect(setInspectedSubagent).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'child-model' }))
      promptRequest.mockClear()
      if (mode === 'rejected') promptRequest.mockRejectedValueOnce(new Error('delivery refused'))
      const accepted = Promise.withResolvers<{ messageId: string }>()
      if (mode === 'accepted-before-close') promptRequest.mockImplementationOnce(() => accepted.promise)
      if (mode === 'abort-delivery') promptRequest.mockImplementationOnce((_request: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }))
      const ordered = Promise.withResolvers<{ messageId: string }>()
      if (mode === 'ordered') promptRequest.mockImplementationOnce(() => ordered.promise)
      const submission: TuiSubmission = mode === 'files'
        ? { text: 'See file.', images: [], files: [{ attachmentId: 'file:test' as never, name: 'a.txt', bytes: 5 }],
          segments: [{ kind: 'file', index: 0 }, { kind: 'text', text: 'See file.' }] }
        : { text: 'Keep going.', images: mode === 'queue' ? [{ data: new Uint8Array([1]), mediaType: 'image/png' }] : [], delivery: mode === 'steer' ? 'steer' : 'queue' }
      submitCallbacks[0]?.(submission)
      if (mode === 'files') {
        await new Promise(resolve => { setTimeout(resolve, 0) })
        expect(promptRequest).not.toHaveBeenCalled()
        expect(restoreInput).toHaveBeenCalledWith(submission, childId)
        expect(notice).toHaveBeenCalledWith('Subagent follow-up does not accept files.', { level: 'error' })
        expect(subagents.sendMessage).not.toHaveBeenCalled()
        return
      }
      if (mode === 'abort-delivery' || mode === 'accepted-before-close') {
        await vi.waitFor(() => { expect(promptRequest).toHaveBeenCalledOnce() })
        closeInspect()
      }
      if (mode === 'abort-delivery') await vi.waitFor(() => { expect(restoreInput).toHaveBeenCalledWith(submission, childId) })
      if (mode === 'accepted-before-close') {
        accepted.resolve({ messageId: 'accepted-id' })
        await vi.waitFor(() => { expect(pendingAcknowledge).toHaveBeenCalledWith(submission) })
      }
      if (mode === 'ordered') {
        submitCallbacks[0]?.({ text: 'Second without an image.', images: [], delivery: 'queue' })
        await new Promise(resolve => { setTimeout(resolve, 0) })
        expect(promptRequest).toHaveBeenCalledOnce()
        ordered.resolve({ messageId: 'ordered-id' })
        await vi.waitFor(() => { expect(promptRequest).toHaveBeenCalledTimes(2) })
      }
      await new Promise(resolve => { setTimeout(resolve, 0) })
      if (mode === 'abort-delivery' || mode === 'rejected') {
        expect(restoreInput).toHaveBeenCalledWith(submission, childId)
      } else if (mode === 'accepted-before-close') {
        expect(restoreInput).not.toHaveBeenCalled()
      } else {
        const calls = promptRequest.mock.calls.map(call => call[0] as {
          childSessionId: string
          delivery: string
          content: readonly { type: string, text?: string, mediaType?: string, data?: string }[]
        })
        expect(calls).toHaveLength(mode === 'ordered' ? 2 : 1)
        expect(calls[0]).toMatchObject({ childSessionId: childId, delivery: mode === 'steer' ? 'steer' : 'queue' })
        expect(calls[0]?.content).toContainEqual({ type: 'text', text: 'Keep going.' })
        if (mode === 'queue') expect(calls[0]?.content).toContainEqual({ type: 'image', mediaType: 'image/png', data: 'AQ==' })
        else expect(calls[0]?.content).toEqual([{ type: 'text', text: 'Keep going.' }])
        if (mode === 'ordered') expect(calls[1]?.content).toEqual([{ type: 'text', text: 'Second without an image.' }])
        expect(restoreInput).not.toHaveBeenCalled()
        expect(notice).not.toHaveBeenCalled()
        expect(pendingPrepare).toHaveBeenCalled()
        expect(pendingAcknowledge).toHaveBeenCalled()
      }
      if (mode === 'abort-delivery') expect(notice).not.toHaveBeenCalled()
      if (mode === 'rejected') expect(notice).toHaveBeenCalledWith('delivery refused', { level: 'error' })
      expect(subagents.sendMessage).not.toHaveBeenCalled()
    } finally {
      await runtime.dispose()
      await ctx.fiber.dispose()
      await agentCtx.fiber.dispose()
    }
  })
})

describe('SessionRuntime subagent catalog restore', () => {
  it('lists the children a resumed parent recorded in its own log', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const rootId = SessionId('session-catalog-root')
    const rootSession = ctx.sessions.create(rootId)
    // A resumed parent never loads its children, so this durable fact is the
    // only thing that can still put them on the roster.
    rootSession.append('subagent/catalog', {
      version: 0,
      childId: SessionId('session-catalog-child'),
      childCreatedAt: 1,
      mode: 'continuable',
      label: 'Catalog child',
    })

    const agentCtx = new Context()
    await agentCtx.plugin(CommandRuntime)
    agentCtx.provide('agentPresets', {
      defaultId: 'standard',
      presetForSession: () => 'standard',
      resolve: async () => ({ id: 'standard' }),
      mount: async () => ({ id: 'standard' }),
    })
    agentCtx.provide('sessionProjections', { stateOf: () => 'standard' })
    agentCtx.provide('tools', { presentAs: () => () => undefined })
    agentCtx.provide('permissionPresets', { names: [], optionOf: () => undefined, current: () => undefined })

    const rootAgent = {
      id: rootId,
      session: rootSession,
      status: 'idle',
      model: stubModel({ provider: 'deepseek', model: 'deepseek-chat' }),
      inbox: { nextTurn: [], nextStep: [] },
    } as unknown as Agent
    ctx.provide('agentPresets', {
      defaultId: 'standard',
      presetForSession: () => 'standard',
      resolve: async () => ({ id: 'standard' }),
      mount: async () => ({ id: 'standard' }),
    })
    ctx.provide('agents', {
      create: async (options: { setup?: (context: typeof agentCtx, agent: Agent) => Promise<void> }) => {
        await options.setup?.(agentCtx, rootAgent)
        return { agent: rootAgent, dispose: async () => undefined } as unknown as AgentHandle
      },
      get: () => undefined,
    })
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }),
    })
    ctx.provide('subagents', { listDescendants: async () => [], sendMessage: vi.fn(async () => 'sent-1') })

    const rosters: unknown[] = []
    // Activation touches far more of the TuiService than one roster assertion
    // needs; unknown members resolve to a no-op returning no-op.
    const tui = new Proxy(
      {
        ...(stubTui() as unknown as Record<string, unknown>),
        setSubagents: (roster: unknown) => { rosters.push(roster) },
      },
      {
        get(target: Record<string, unknown>, prop: string) {
          return prop in target ? target[prop] : () => () => {}
        },
      },
    ) as unknown as TuiService

    const runtime = new SessionRuntime(ctx, tui)
    try {
      await runtime.start()
      expect(rosters.at(-1)).toMatchObject({
        agents: [{ id: 'session-catalog-child', label: 'Catalog child', mode: 'continuable', phase: 'waiting' }],
      })
    } finally {
      await runtime.dispose()
      await ctx.fiber.dispose()
      await agentCtx.fiber.dispose()
    }
  })
})

describe('SessionRuntime workspace claim', () => {
  async function harness(cwd: string | undefined, registry?: Record<string, unknown>) {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const rootId = SessionId('session-workspace-root')
    const rootSession = ctx.sessions.create(rootId, {
      meta: cwd === undefined ? {} : { cwd },
    })
    const agentCtx = new Context()
    await agentCtx.plugin(CommandRuntime)
    agentCtx.provide('agentPresets', {
      defaultId: 'standard',
      presetForSession: () => 'standard',
      resolve: async () => ({ id: 'standard' }),
      mount: async () => ({ id: 'standard' }),
    })
    agentCtx.provide('sessionProjections', { stateOf: () => 'standard' })
    agentCtx.provide('tools', { presentAs: () => () => undefined })
    agentCtx.provide('permissionPresets', { names: [], optionOf: () => undefined, current: () => undefined })
    const rootAgent = {
      id: rootId,
      session: rootSession,
      status: 'idle',
      model: stubModel({ provider: 'deepseek', model: 'deepseek-chat' }),
      inbox: { nextTurn: [], nextStep: [] },
    } as unknown as Agent
    ctx.provide('agentPresets', {
      defaultId: 'standard',
      presetForSession: () => 'standard',
      resolve: async () => ({ id: 'standard' }),
      mount: async () => ({ id: 'standard' }),
    })
    ctx.provide('agents', {
      create: async (options: { setup?: (context: typeof agentCtx, agent: Agent) => Promise<void> }) => {
        await options.setup?.(agentCtx, rootAgent)
        return { agent: rootAgent, dispose: async () => undefined } as unknown as AgentHandle
      },
      get: () => undefined,
    })
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }),
    })
    ctx.provide('subagents', { listDescendants: async () => [], sendMessage: vi.fn(async () => 'sent-1') })
    if (registry !== undefined) ctx.provide('workspaceRegistry', registry)
    const calls: string[] = []
    const tui = new Proxy({ ...stubTui(), setModel: () => { calls.push('model') }, replaceSession: vi.fn(() => { calls.push('transcript') }) } as unknown as Record<string, unknown>, {
      get(target, prop) {
        return prop in target ? target[prop] : () => () => {}
      },
    }) as unknown as TuiService
    return { ctx, agentCtx, calls, tui, runtime: new SessionRuntime(ctx, tui) }
  }

  it('publishes the live model before a default save failure and retries without another selection event', async () => {
    const h = await harness('/tmp/omdsh-model-retry')
    const saveSelection = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    Object.assign(h.ctx.agentDefaultModel, { saveSelection })
    try {
      await h.runtime.start()
      const agent = h.runtime.agent!
      const select = vi.spyOn(agent.model, 'select')
      const selected = { provider: 'other', model: 'new-model' }
      h.calls.length = 0
      await expect(h.runtime.changeSelection(agent, selected, {})).rejects.toBeInstanceOf(DefaultModelSaveError)
      expect(h.runtime.selection(agent)).toEqual(selected)
      expect(h.calls).toContain('model')
      await h.runtime.changeSelection(agent, selected, {})
      expect(select).toHaveBeenCalledTimes(1)
      expect(saveSelection).toHaveBeenCalledTimes(2)
    } finally { await h.runtime.dispose(); await h.ctx.fiber.dispose(); await h.agentCtx.fiber.dispose() }
  })

  it('adopts the cwd workspace and attaches the activated session', async () => {
    const attachSession = vi.fn(async () => undefined)
    const create = vi.fn(async () => ({ attachSession }))
    const resolveByPath = vi.fn(async () => undefined)
    const { ctx, agentCtx, calls, runtime } = await harness('/tmp/omdsh-ws', { resolveByPath, create })
    try {
      await runtime.start()
      expect(calls.indexOf('model')).toBeGreaterThanOrEqual(0)
      expect(calls.indexOf('model')).toBeLessThan(calls.indexOf('transcript'))
      await new Promise(resolve => { setTimeout(resolve, 0) })
      expect(resolveByPath).toHaveBeenCalledWith('/tmp/omdsh-ws')
      expect(create).toHaveBeenCalledWith('/tmp/omdsh-ws')
      expect(attachSession).toHaveBeenCalledWith('session-workspace-root')
    } finally {
      await runtime.dispose()
      await ctx.fiber.dispose()
      await agentCtx.fiber.dispose()
    }
  })

  it('cancels interaction scopes on replacement, failed activation and disposal', async () => {
    const h = await harness(undefined)
    try {
      await h.runtime.start()
      const first = h.runtime.interactionSignal
      await h.runtime.newSession(h.runtime.agent!)
      expect(first.aborted).toBe(true)
      const second = h.runtime.interactionSignal
      expect(second.aborted).toBe(false)
      let failed: AbortSignal | undefined
      vi.mocked(h.tui.replaceSession).mockImplementationOnce(() => {
        failed = h.runtime.interactionSignal
        throw new Error('presentation failed')
      })
      await expect(h.runtime.newSession(h.runtime.agent!)).rejects.toThrow('presentation failed')
      expect(second.aborted).toBe(true)
      expect(failed?.aborted).toBe(true)
      const restored = h.runtime.interactionSignal
      expect(restored.aborted).toBe(false)
      expect(restored).not.toBe(second)
      await h.runtime.dispose()
      expect(restored.aborted).toBe(true)
    } finally {
      await h.runtime.dispose()
      await h.ctx.fiber.dispose()
      await h.agentCtx.fiber.dispose()
    }
  })

  it('starts fine with no registry and skips sessions without a cwd', async () => {
    const attachSession = vi.fn(async () => undefined)
    const create = vi.fn(async () => ({ attachSession }))
    const resolveByPath = vi.fn(async () => ({ attachSession }))
    const withRegistry = await harness(undefined, { resolveByPath, create })
    try {
      await withRegistry.runtime.start()
      await new Promise(resolve => { setTimeout(resolve, 0) })
      expect(resolveByPath).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
    } finally {
      await withRegistry.runtime.dispose()
      await withRegistry.ctx.fiber.dispose()
      await withRegistry.agentCtx.fiber.dispose()
    }
    const without = await harness('/tmp/omdsh-ws')
    try {
      await without.runtime.start()
    } finally {
      await without.runtime.dispose()
      await without.ctx.fiber.dispose()
      await without.agentCtx.fiber.dispose()
    }
  })
})

describe('SessionRuntime composer delivery', () => {
  function fixture() {
    const ctx = new Context(), tui = stubTui()
    Object.assign(tui, { pendingInputs: { prepare: vi.fn() } })
    const runtime = new SessionRuntime(ctx, tui)
    const active = vi.spyOn(runtime, 'assertActive').mockImplementation(() => {})
    const events: SessionEvent[] = []
    const agent = { status: 'running', session: { snapshotEvents: () => events }, followup: vi.fn(), steer: vi.fn() } as unknown as Agent
    const pngRef = { attachmentId: AttachmentId('steering-image'), mediaType: 'image/png' as const, bytes: 5, width: 1, height: 1 }
    const saveImages = vi.fn(async () => [pngRef])
    ctx.provide('attachments', { saveImages } as never)
    return { ctx, tui, runtime, active, events, agent, pngRef, saveImages }
  }

  it.each(['queue', 'steer'] as const)('delivers %s with the same ordered content and attachment references', async delivery => {
    const f = fixture()
    const file = { attachmentId: AttachmentId('steering-file'), name: '中文.txt', bytes: 3 }
    try {
      await f.runtime.send({ text: 'before after', images: [{ data: PNG_1X1, mediaType: 'image/png' }], files: [file],
        segments: [{ kind: 'text', text: 'before ' }, { kind: 'image', index: 0 }, { kind: 'text', text: 'after' }], delivery }, f.agent)
      const admit = delivery === 'steer' ? f.agent.steer : f.agent.followup
      expect(admit).toHaveBeenCalledOnce()
      expect(admit).toHaveBeenCalledWith(expect.objectContaining({ source: { kind: 'user' }, content: [
        { type: 'text', text: 'before ' }, { type: 'image', attachment: f.pngRef }, { type: 'text', text: 'after' }, { type: 'file', attachment: file },
      ] }))
      expect(delivery === 'steer' ? f.agent.followup : f.agent.steer).not.toHaveBeenCalled()
    } finally { await f.runtime.dispose(); await f.ctx.fiber.dispose() }
  })

  it('records the generated message identity before Harness admission', async () => {
    const f = fixture()
    const submission = { text: 'once', images: [] }
    vi.mocked(f.agent.followup).mockImplementation(message => {
      expect(f.tui.pendingInputs.prepare).toHaveBeenCalledWith(submission, message.id)
    })
    try {
      await f.runtime.send(submission, f.agent)
      expect(f.agent.followup).toHaveBeenCalledOnce()
    } finally { await f.runtime.dispose(); await f.ctx.fiber.dispose() }
  })

  it.each(['upload', 'stopped', 'switched', 'refused'])('rejects %s before admission so the runner can restore the complete draft', async failure => {
    const f = fixture()
    f.saveImages.mockImplementationOnce(async () => {
      if (failure === 'upload') throw new Error('upload failed')
      if (failure === 'stopped') Object.assign(f.agent, { status: 'idle' })
      if (failure === 'switched') f.active.mockImplementation(() => { throw new Error('session changed') })
      return [f.pngRef]
    })
    if (failure === 'refused') vi.mocked(f.agent.steer).mockImplementationOnce(() => { throw new Error('refused') })
    try {
      await expect(f.runtime.send({ text: 'keep', images: [{ data: PNG_1X1, mediaType: 'image/png' }], delivery: 'steer' }, f.agent)).rejects.toThrow()
      expect(f.agent.followup).not.toHaveBeenCalled()
      if (failure !== 'refused') expect(f.agent.steer).not.toHaveBeenCalled()
    } finally { await f.runtime.dispose(); await f.ctx.fiber.dispose() }
  })

  it.each(['queue', 'steer'] as const)('does not restore an already admitted %s when an event subscriber throws after claim', async delivery => {
    const f = fixture()
    vi.mocked(delivery === 'steer' ? f.agent.steer : f.agent.followup).mockImplementationOnce(message => {
      f.events.push({ type: 'agent/inbox/spliced', data: { target: delivery === 'steer' ? 'next-step' : 'next-turn', start: 0, inserted: [message] } } as SessionEvent)
      f.events.push({ type: 'agent/inbox/spliced', data: { target: delivery === 'steer' ? 'next-step' : 'next-turn', start: 0, inserted: [], removedCount: 1 } } as SessionEvent)
      throw new Error('subscriber failed')
    })
    try {
      await expect(f.runtime.send({ text: 'once', images: [], delivery }, f.agent)).resolves.toBeUndefined()
      expect(f.tui.notice).toHaveBeenCalledWith('subscriber failed', { level: 'error' })
    } finally { await f.runtime.dispose(); await f.ctx.fiber.dispose() }
  })
})

describe('SessionRuntime continuation and full prompt retry', () => {
  function fixture() {
    const ctx = new Context(), tui = stubTui()
    Object.assign(tui, { pendingInputs: { list: vi.fn(() => []) } })
    const runtime = new SessionRuntime(ctx, tui)
    vi.spyOn(runtime, 'assertActive').mockImplementation(() => {})
    let events: readonly SessionEvent[] = []
    const agent = { status: 'idle', inbox: { nextTurn: [], nextStep: [] }, session: { snapshotEvents: () => events }, followup: vi.fn(),
      runMaintenance: vi.fn(async (task: (signal: AbortSignal) => unknown) => task(new AbortController().signal)),
    } as unknown as Agent
    const setEvents = (next: unknown[]) => { events = next as SessionEvent[] }
    const failed = () => setEvents([
      { type: 'turn/start' },
      { type: 'user/message', surfaceOp: 'append', data: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'once' }] }) },
      { type: 'assistant/attempt' },
      { type: 'turn/end', seq: 7, data: { reason: { kind: 'error', error: { code: 'SERVER' } } } },
    ])
    const dispose = async () => { await runtime.dispose(); await ctx.fiber.dispose() }
    return { ctx, tui, runtime, agent, setEvents, failed, dispose }
  }

  it.each([false, true])('resends ordered durable blocks with fresh identity, including attachment-only=%s', async onlyAttachments => {
    const f = fixture()
    const file = { attachmentId: AttachmentId('saved-file'), bytes: 3, name: 'notes.txt' }
    const image = { attachmentId: AttachmentId('saved-image'), bytes: 3, width: 1, height: 1, mediaType: 'image/png' as const }
    const message = createUserMessage({ source: { kind: 'user' }, content: [
      ...onlyAttachments ? [] : [{ type: 'text' as const, text: 'before' }],
      { type: 'image', attachment: image }, { type: 'file', attachment: file },
      ...onlyAttachments ? [] : [{ type: 'text' as const, text: 'after' }],
    ] })
    f.setEvents([{ type: 'user/message', data: message }, { type: 'user/message', data: createUserMessage({ source: { kind: 'retry' }, content: [] }) }])
    try {
      expect(await f.runtime.retryLastPrompt(f.agent)).toBe(true)
      const sent = vi.mocked(f.agent.followup).mock.calls[0]![0]
      expect(sent.content).toEqual(message.content)
      expect(sent.id).not.toBe(message.id)
      expect(sent.source).toEqual({ kind: 'user' })
      expect(f.agent.runMaintenance).toHaveBeenCalledOnce()
    } finally { await f.dispose() }
  })

  it('continues with empty retry input and rejects obsolete failure actions', async () => {
    const f = fixture(); f.failed()
    try {
      await expect(f.runtime.continueGeneration(f.agent, 6)).rejects.toThrow('No recoverable')
      expect(f.agent.followup).not.toHaveBeenCalled()
      await f.runtime.continueGeneration(f.agent, 7)
      expect(f.agent.followup).toHaveBeenCalledWith(expect.objectContaining({ content: [], source: { kind: 'retry' } }))
      f.setEvents([{ type: 'turn/start' }])
      await expect(f.runtime.continueGeneration(f.agent, 7)).rejects.toThrow('No recoverable')
      expect(f.agent.followup).toHaveBeenCalledOnce()
    } finally { await f.dispose() }
  })

  it.each(['busy', 'queue', 'steer', 'local', 'cancel', 'question'])('rejects %s before either operation admits input', async condition => {
    const f = fixture(); f.failed()
    const signal = new AbortController()
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'pending' }] })
    if (condition === 'busy') Object.assign(f.agent, { status: 'running' })
    if (condition === 'queue') Object.assign(f.agent.inbox, { nextTurn: [message] })
    if (condition === 'steer') Object.assign(f.agent.inbox, { nextStep: [message] })
    if (condition === 'local') vi.mocked(f.tui.pendingInputs.list).mockReturnValue([{}] as never)
    if (condition === 'cancel') signal.abort()
    if (condition === 'question') f.ctx.provide('sessionProjections', { snapshot: () => ({ values: { userQuestions: { active: [{ state: 'open' }] } } }) } as never)
    try {
      await expect(f.runtime.continueGeneration(f.agent, 7, signal.signal)).rejects.toThrow()
      await expect(f.runtime.retryLastPrompt(f.agent, signal.signal)).rejects.toThrow()
      expect(f.agent.followup).not.toHaveBeenCalled()
    } finally { await f.dispose() }
  })

  it('rechecks pending work inside the maintenance claim and preserves pre-admission failures', async () => {
    const f = fixture(); f.failed()
    vi.mocked(f.agent.runMaintenance).mockImplementationOnce(async task => {
      Object.assign(f.agent, { status: 'running' })
      return task(new AbortController().signal)
    })
    try {
      await expect(f.runtime.continueGeneration(f.agent)).rejects.toThrow('Wait for')
      expect(f.agent.followup).not.toHaveBeenCalled()
      Object.assign(f.agent, { status: 'idle' })
      vi.mocked(f.agent.followup).mockImplementationOnce(() => { throw new Error('not accepted') })
      await expect(f.runtime.continueGeneration(f.agent)).rejects.toThrow('not accepted')
    } finally { await f.dispose() }
  })

  it('blocks repetition while a composer attachment is still uploading', async () => {
    const f = fixture(); f.failed()
    let release!: () => void
    f.ctx.provide('attachments', { saveImages: async () => { await new Promise<void>(resolve => { release = resolve }); return [] } } as never)
    const send = f.runtime.send({ text: 'upload', images: [{ data: PNG_1X1, mediaType: 'image/png' }] }, f.agent)
    try {
      await expect(f.runtime.continueGeneration(f.agent)).rejects.toThrow('Wait for')
      await expect(f.runtime.retryLastPrompt(f.agent)).rejects.toThrow('Wait for')
    } finally { release(); await send.catch(() => {}); await f.dispose() }
  })
})
