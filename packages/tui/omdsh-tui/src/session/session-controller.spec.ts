import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage, ReasoningEffortId, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import { queueHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { mcpCatalogText } from '../commands/integrations.ts'
import type { TuiService } from '../definition.ts'

vi.mock('@deepseek-ai/dsh-subagent/internal', () => ({
  queueHostSubagentPrompt: vi.fn(async () => 'message-id-1'),
}))
import {
  conversationTurns,
  createSubmissionMessage,
  encodeCommandAttachments,
  modelStatus,
  recentSessionContent,
  restoreSubmissionMessage,
  SessionRuntime,
  sessionControls,
  shouldRefreshSessionInfoAfter,
  sessionStats,
  userSkillCommands,
} from './session-controller.ts'

function stubTui(): TuiService {
  return {
    onInspectSubagent: () => () => {},
    onInspectClose: () => () => {},
    onInspectSubmit: () => () => {},
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
    })
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
      { ...base, name: 'hidden', invocation: { modelInvocable: true, userInvocable: false } },
    ])).toEqual([{ name: 'skill:code-review', description: 'Review code' }])
  })

  it('groups MCP tools by server', () => {
    expect(mcpCatalogText([
      { name: 'bash', description: 'shell' },
      { name: 'mcp__github__issues', description: 'List issues' },
      { name: 'mcp__github__pulls', description: 'List pulls' },
      { name: 'mcp__memory__search', description: '' },
    ])).toBe([
      'MCP Servers · 2 connected · 3 tools',
      '',
      '**github · 2 tools**',
      '| Tool | Description |',
      '|---|---|',
      '| `issues` | List issues |',
      '| `pulls` | List pulls |',
      '',
      '**memory · 1 tool**',
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
  it('delivers a composer follow-up through the subagent host queue, never sendMessage', async () => {
    vi.mocked(queueHostSubagentPrompt).mockClear()
    const rootId = SessionId('session-steer-root')
    const childId = SessionId('session-steer-child')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const rootSession = ctx.sessions.create(rootId)
    const childSession = ctx.sessions.create(childId, {
      meta: {
        parentSession: rootId,
        isSeeded: false,
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
      resolve: async () => ({ id: 'standard' }),
      mount: async () => ({ id: 'standard' }),
    })
    const rootAgent = {
      id: rootId,
      session: rootSession,
      status: 'idle',
      inbox: { nextTurn: [], nextStep: [] },
    } as unknown as Agent

    const agentCtx = new Context()
    await agentCtx.plugin(CommandRuntime)
    agentCtx.provide('agentPresets', {
      defaultId: 'standard',
      resolve: async () => ({ id: 'standard' }),
      mount: async () => ({ id: 'standard' }),
    })
    agentCtx.provide('sessionProjections', { stateOf: () => 'standard' })
    agentCtx.provide('tools', { presentAs: () => () => undefined })
    agentCtx.provide('permissionPresets', { names: [], optionOf: () => undefined, current: () => undefined })
    Object.defineProperty(agentCtx, 'agent', { value: rootAgent })

    const subagents = {
      listChildren: async () => [],
      sendMessage: vi.fn(async () => 'sent-1'),
    }
    ctx.provide('agents', {
      create: async (options: { setup?: (context: typeof agentCtx) => Promise<void> }) => {
        await options.setup?.(agentCtx)
        return { agent: rootAgent, dispose: async () => undefined } as unknown as AgentHandle
      },
      get: () => undefined,
    })
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }),
    })
    ctx.provide('subagents', subagents)

    const inspectCallbacks: Array<(id: string) => void> = []
    const submitCallbacks: Array<(submission: { text: string, images: never[] }) => void> = []
    const restoreInput = vi.fn()
    const notice = vi.fn()
    const tui = new Proxy({ restoreInput, notice }, {
      get(target: Record<string, unknown>, prop: string) {
        if (prop in target) return target[prop]
        if (prop === 'onInspectSubagent') {
          return (handler: (id: string) => void) => {
            inspectCallbacks.push(handler)
            return () => {}
          }
        }
        if (prop === 'onInspectSubmit') {
          return (handler: (submission: { text: string, images: never[] }) => void) => {
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
      await inspectCallbacks[0]?.(childId)
      await submitCallbacks[0]?.({ text: 'Keep going.', images: [] })
      await new Promise(resolve => { setTimeout(resolve, 0) })

      expect(queueHostSubagentPrompt).toHaveBeenCalledTimes(1)
      expect(queueHostSubagentPrompt).toHaveBeenCalledWith(
        subagents,
        rootAgent,
        childId,
        expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'Keep going.' })]),
        { kind: 'user' },
        expect.any(AbortSignal),
      )
      expect(subagents.sendMessage).not.toHaveBeenCalled()
      expect(restoreInput).not.toHaveBeenCalled()
      expect(notice).not.toHaveBeenCalled()
    } finally {
      await runtime.dispose()
      await ctx.fiber.dispose()
      await agentCtx.fiber.dispose()
    }
  })
})
