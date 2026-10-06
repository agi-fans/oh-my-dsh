import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'
import { steerAgent } from './steering.ts'

describe('steerAgent', () => {
  it('uses the Harness guidance entry with human attribution and verbatim text', () => {
    const steer = vi.fn(), agent = { status: 'running', steer } as unknown as Agent
    steerAgent(agent, '纠正 🐳\nUse a smaller patch.')
    expect(steer).toHaveBeenCalledOnce()
    expect(steer.mock.calls[0]?.[0]).toMatchObject({
      source: { kind: 'user' }, content: [{ type: 'text', text: '纠正 🐳\nUse a smaller patch.' }],
    })
  })
  it('rejects idle or unavailable agents and empty text before admitting a message', () => {
    const steer = vi.fn(), agent = { status: 'idle', steer } as unknown as Agent
    expect(() => steerAgent(agent, 'hello')).toThrow('active turn')
    expect(() => steerAgent(undefined, 'hello')).toThrow('active turn')
    expect(() => steerAgent({ status: 'running', steer } as unknown as Agent, ' ')).toThrow('Enter guidance')
    expect(steer).not.toHaveBeenCalled()
  })
})
