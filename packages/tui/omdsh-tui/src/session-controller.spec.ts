import { describe, expect, it } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { mcpCatalogText } from './command-integrations.ts'
import { modelStatus, recentSessionContent, sessionControls, sessionStats, userSkillCommands } from './session-controller.ts'

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
})

describe('sessionStats', () => {
  it('folds boundaries and disjoint token usage', () => {
    const events = [
      { type: 'step/start', time: 10, data: { turn: 1, step: 1 } },
      { type: 'assistant/chunk', time: 12, data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'hi' } } },
      { type: 'assistant/message', time: 20, data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 3 } } },
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
