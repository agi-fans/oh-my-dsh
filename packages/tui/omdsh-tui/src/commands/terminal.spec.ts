import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { formatTerminalQuote, shareTerminalOutputToConversation } from './terminal.ts'

describe('terminal quoting', () => {
  it('wraps output in a fence longer than any backtick run inside it', () => {
    const quoted = formatTerminalQuote('before ```js\nafter ````')
    // Four backticks inside means the fence needs five.
    expect(quoted.startsWith('`````text\n')).toBe(true)
    expect(quoted.endsWith('\n`````')).toBe(true)
  })

  it('uses the shortest safe fence for plain output', () => {
    expect(formatTerminalQuote('plain')).toBe('```text\nplain\n```')
  })
})

describe('sharing terminal output', () => {
  const harness = (): { owner: Agent; inject: ReturnType<typeof vi.fn> } => {
    const inject = vi.fn()
    return { owner: { inject } as unknown as Agent, inject }
  }

  it('hands the output to the conversation as one injection', () => {
    // The injection is the only record: the transcript renders it, so a resumed
    // session still shows the output the model was given.
    const { owner, inject } = harness()
    expect(shareTerminalOutputToConversation(owner, 'Shell · `ls`', 'a.txt\nb.txt\n')).toBe(true)
    expect(inject).toHaveBeenCalledTimes(1)
    expect(inject.mock.calls[0]?.[0]).toMatchObject({
      source: expect.objectContaining({ kind: 'omdsh-terminal', form: 'notice' }),
    })
  })

  it('does nothing when there is no output to share', () => {
    const { owner, inject } = harness()
    expect(shareTerminalOutputToConversation(owner, 'Shell', '   \n')).toBe(false)
    expect(inject).not.toHaveBeenCalled()
  })
})


it('propagates failed sharing and rejects sessions without injection', () => {
  const inject = vi.fn(() => { throw new Error('session closed') })
  expect(() => shareTerminalOutputToConversation({ inject } as unknown as Agent, 'Shell', 'output')).toThrow('session closed')
  expect(() => shareTerminalOutputToConversation({} as Agent, 'Shell', 'output')).toThrow('cannot receive')
})


it('recognizes committed delivery when a subsequent observer throws', () => {
  const events: SessionEvent[] = []
  const inject = vi.fn(message => {
    events.push({ type: 'agent/inbox/spliced', data: { inserted: [message] } } as SessionEvent)
    throw new Error('observer failed')
  })
  const owner = { inject, session: { snapshotEvents: () => events } } as unknown as Agent
  expect(shareTerminalOutputToConversation(owner, 'Shell', 'captured')).toBe(true)
  expect(inject).toHaveBeenCalledOnce()
})
