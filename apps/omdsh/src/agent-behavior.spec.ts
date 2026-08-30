import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import {
  AGENT_BEHAVIOR_VARIABLE,
  AgentBehaviorPrompt,
  AgentBehaviorSettingsSchema,
  agentLanguageFragment,
} from './agent-behavior.ts'

const contextFor = (agent?: Agent): AssembleContext => ({ agent }) as AssembleContext

describe('AgentBehaviorSettingsSchema', () => {
  it('defaults to Auto and rejects unknown languages', () => {
    const validate = AgentBehaviorSettingsSchema as unknown as (input: object) => { language: string }
    expect(validate({})).toEqual({ language: 'auto' })
    expect(validate({ language: 'zh-CN' })).toEqual({ language: 'zh-CN' })
    expect(validate({ language: 'en' })).toEqual({ language: 'en' })
    expect(() => validate({ language: 'fr' })).toThrow()
  })
})

describe('Agent behavior prompt projection', () => {
  it('uses a legal variable name and emits no prompt text for Auto', () => {
    expect(AGENT_BEHAVIOR_VARIABLE).toMatch(/^[a-z][a-z0-9_]*$/u)
    expect(agentLanguageFragment('auto')).toBe('')
    expect(new AgentBehaviorPrompt().variable(contextFor(), 'auto')).toBe('')
  })

  it('freezes complete English and Simplified Chinese instructions', () => {
    expect(agentLanguageFragment('zh-CN')).toContain('主要使用简体中文进行推理和面向用户的沟通')
    expect(agentLanguageFragment('zh-CN')).toContain('Tool 参数')
    expect(agentLanguageFragment('zh-CN')).toContain('用户明确要求当前任务使用其他语言')
    expect(agentLanguageFragment('en')).toContain('Use English as the primary language')
    expect(agentLanguageFragment('en')).toContain('tool arguments')
    expect(agentLanguageFragment('en')).toContain('user explicitly requests another language')
  })

  it('keeps one language snapshot for the whole turn', () => {
    const prompt = new AgentBehaviorPrompt()
    const agent = {} as Agent
    const context = contextFor(agent)
    prompt.snapshot(agent, 4, 'zh-CN')
    prompt.snapshot(agent, 4, 'en')
    expect(prompt.fragment(context, 'en')).toBe(agentLanguageFragment('zh-CN'))
    prompt.snapshot(agent, 5, 'en')
    expect(prompt.fragment(context, 'zh-CN')).toBe(agentLanguageFragment('en'))
    prompt.clear(agent)
    expect(prompt.fragment(context, 'zh-CN')).toBe(agentLanguageFragment('zh-CN'))
  })

  it('adds spacing only for a non-empty complete-persona variable', () => {
    const prompt = new AgentBehaviorPrompt()
    expect(prompt.variable(contextFor(), 'en')).toBe(`\n\n${agentLanguageFragment('en')}`)
    const minimal = readFileSync(
      new URL('../config/agent-presets/minimal/agent.cordis.yml', import.meta.url),
      'utf8',
    )
    const persona = 'You are a helpful software engineer assistant.'
    expect(minimal).toContain(`text: ${persona}{{${AGENT_BEHAVIOR_VARIABLE}}}`)
    expect(`${persona}{{${AGENT_BEHAVIOR_VARIABLE}}}`.replace(
      `{{${AGENT_BEHAVIOR_VARIABLE}}}`,
      prompt.variable(contextFor(), 'auto'),
    )).toBe(persona)
  })
})
