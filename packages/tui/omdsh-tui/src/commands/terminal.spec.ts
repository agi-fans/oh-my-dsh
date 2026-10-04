import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { TuiService } from '../definition.ts'
import { terminalConsole } from './terminal.ts'

function harness(answers: readonly (string | null)[], rawInput = '') {
  const prompt = vi.fn<TuiService['prompt']>()
  for (const answer of answers) prompt.mockResolvedValueOnce(answer)
  const owner = { session: { header: { cwd: '/workspace' } } }
  const terminals = {
    list: vi.fn(() => [{ sessionId: 'owned', name: 'Shell', type: 'shell', status: { kind: 'running' } }]),
    read: vi.fn(() => ({ text: 'output', truncated: false, lineEnd: 1, totalLines: 1 })),
    startSend: vi.fn(() => ({ done: Promise.resolve() })), signal: vi.fn(async () => {}), kill: vi.fn(async () => {}),
  }
  const ctx = { tui: { interactive: true, prompt, notice: vi.fn() }, terminals, logger: { warn: vi.fn() } } as unknown as Context
  const invocation = { agent: owner, signal: new AbortController().signal, rawInput } as unknown as CommandInvocation
  return { ctx, invocation, terminals, prompt, owner }
}

describe('persistent terminal console', () => {
  it('sends user input through the registry and detaches without killing the shell', async () => {
    const h = harness(['owned', 'input', 'echo hello', null])
    expect(await terminalConsole(h.ctx, h.invocation)).toEqual({ kind: 'success' })
    expect(h.terminals.startSend).toHaveBeenCalledWith(h.owner, 'owned', { text: 'echo hello', submit: true, signal: h.invocation.signal })
    expect(h.terminals.kill).not.toHaveBeenCalled()
    expect(h.prompt.mock.calls[1]![0].refreshDocument!()).toContain('output')
  })
  it('interrupts explicitly and requires confirmation to close', async () => {
    const h = harness(['interrupt', 'close', 'keep', 'close', 'close', null], 'owned')
    await terminalConsole(h.ctx, h.invocation)
    expect(h.terminals.signal).toHaveBeenCalledWith(h.owner, 'owned', 'SIGINT')
    expect(h.terminals.kill).toHaveBeenCalledTimes(1)
  })
  it('does not read or control a terminal owned by another session', async () => {
    const h = harness([], 'foreign')
    expect(await terminalConsole(h.ctx, h.invocation)).toEqual({ kind: 'error', text: 'Terminal foreign is not available in this session.' })
    expect(h.terminals.read).not.toHaveBeenCalled()
  })
})
