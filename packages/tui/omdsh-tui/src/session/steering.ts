/** Shared text guidance entry for the slash command and composer shortcut. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export function steerAgent(agent: Agent | undefined, text: string): void {
  if (text.trim() === '') throw new Error('Enter guidance for the active turn.')
  if (agent?.status !== 'running') throw new Error('Steering needs an active turn. Use Enter to send the next message.')
  agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}
