/**
 * Product-owned Agent behavior settings projected into the Harness system prompt.
 * @module @agi-fans/oh-my-dsh/agent-behavior
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-settings'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import type { TuiAgentBehaviorSettingsBinding } from '@agi-fans/dsh-tui'

export const name = 'omdsh-agent-behavior'
export const inject = ['settings', 'systemPrompt']

/** Profile entry id whose volatile config carries the language preference. */
export const AGENT_BEHAVIOR_ENTRY = 'agent-behavior'
export const AGENT_BEHAVIOR_SECTION = 'omdsh:agent-behavior'
export const AGENT_BEHAVIOR_ORDER = 30
export const AGENT_BEHAVIOR_VARIABLE = 'omdsh_agent_behavior'

export const AGENT_LANGUAGES = ['auto', 'zh-CN', 'en'] as const
export type AgentLanguage = typeof AGENT_LANGUAGES[number]

/** Live language setting; a settings form edit commits into this reference. */
export interface Config {
  language: Volatile<AgentLanguage>
}

export const Config = z.object({
  language: z.union([...AGENT_LANGUAGES]).default('auto').volatile(),
})

const LANGUAGE_FRAGMENTS: Record<Exclude<AgentLanguage, 'auto'>, string> = {
  'zh-CN': '主要使用简体中文进行推理和面向用户的沟通，包括回复、提问、计划、待办文字和子 Agent 简报。代码、标识符、命令、Tool 参数、日志、引用、文件内容和惯用技术术语在准确性需要时保留原文或标准写法。项目指令中明确规定语言时，遵循项目指令；若用户明确要求当前任务使用其他语言，以该要求为准。',
  en: 'Use English as the primary language for reasoning and user-facing communication, including replies, questions, plans, todo text, and subagent summaries. Preserve code, identifiers, commands, tool arguments, logs, quotations, file contents, and conventional technical terms in their original or standard form when accuracy requires. Follow explicit language requirements in project instructions; if the user explicitly requests another language for the current task, follow that request.',
}

/** Stable model instruction for one accepted language setting. */
export function agentLanguageFragment(language: AgentLanguage): string {
  return language === 'auto' ? '' : LANGUAGE_FRAGMENTS[language]
}

interface TurnLanguageSnapshot {
  turn: number
  language: AgentLanguage
}

/** Freeze live user settings at a turn boundary while keeping direct assemblies useful. */
export class AgentBehaviorPrompt {
  readonly #snapshots = new WeakMap<Agent, TurnLanguageSnapshot>()

  snapshot(agent: Agent, turn: number, language: AgentLanguage): void {
    const current = this.#snapshots.get(agent)
    if (current?.turn === turn) return
    this.#snapshots.set(agent, { turn, language })
  }

  clear(agent: Agent): void {
    this.#snapshots.delete(agent)
  }

  fragment(context: AssembleContext, current: AgentLanguage): string {
    const language = context.agent === undefined
      ? current
      : this.#snapshots.get(context.agent)?.language ?? current
    return agentLanguageFragment(language)
  }

  variable(context: AssembleContext, current: AgentLanguage): string {
    const fragment = this.fragment(context, current)
    return fragment === '' ? '' : `\n\n${fragment}`
  }
}

export function apply(ctx: Context, config: Config): void {
  const prompt = new AgentBehaviorPrompt()
  ctx.on('agent/pre-step', async (payload, next) => {
    prompt.snapshot(payload.agent, payload.turn, config.language.get())
    return next()
  })
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') prompt.clear(agent)
  })
  ctx.on('agent/disposed', ({ agent }) => { prompt.clear(agent) })
  ctx.effect(() => ctx.systemPrompt.section({
    name: AGENT_BEHAVIOR_SECTION,
    order: AGENT_BEHAVIOR_ORDER,
    text: context => prompt.fragment(context, config.language.get()),
  }), 'omdsh Agent behavior prompt section')
  ctx.effect(() => ctx.systemPrompt.variable(
    AGENT_BEHAVIOR_VARIABLE,
    context => prompt.variable(context, config.language.get()),
  ), 'omdsh Agent behavior prompt variable')
  ctx.inject(['tui'], (tuiCtx) => {
    const binding: TuiAgentBehaviorSettingsBinding = {
      get: () => ({ language: config.language.get() }),
      update: next => tuiCtx.settings.mutate(AGENT_BEHAVIOR_ENTRY, [{ op: 'set', path: ['language'], value: next.language }]),
      // A form edit commits into the reference and reaches this fiber only.
      watch: listener => ctx.on('loader/volatile-update', () => { listener({ language: config.language.get() }) }),
    }
    tuiCtx.effect(
      () => tuiCtx.tui.bindAgentBehaviorSettings?.(binding) ?? (() => {}),
      'bind Agent behavior settings to TUI',
    )
  })
}
