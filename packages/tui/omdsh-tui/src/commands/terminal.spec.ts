import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
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
  const harness = (): { ctx: Context; owner: Agent; output: ReturnType<typeof vi.fn>; inject: ReturnType<typeof vi.fn> } => {
    const output = vi.fn()
    const inject = vi.fn()
    return {
      ctx: { tui: { commandOutput: output } } as unknown as Context,
      owner: { inject } as unknown as Agent,
      output,
      inject,
    }
  }

  it('posts the output and hands it to the conversation', () => {
    const { ctx, owner, output, inject } = harness()
    expect(shareTerminalOutputToConversation(ctx, owner, 'Shell · `ls`', 'a.txt\nb.txt\n')).toBe(true)
    expect(output).toHaveBeenCalledWith('terminal', expect.stringContaining('a.txt'), { focus: true })
    expect(inject).toHaveBeenCalledTimes(1)
  })

  it('does nothing when there is no output to share', () => {
    const { ctx, owner, output, inject } = harness()
    expect(shareTerminalOutputToConversation(ctx, owner, 'Shell', '   \n')).toBe(false)
    expect(output).not.toHaveBeenCalled()
    expect(inject).not.toHaveBeenCalled()
  })
})
