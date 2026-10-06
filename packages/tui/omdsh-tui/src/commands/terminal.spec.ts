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
    read: vi.fn(() => ({ text: 'output', truncated: false, lineBegin: 0, lineEnd: 1, totalLines: 1 })),
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
    expect(h.prompt.mock.calls[1]![0].refreshDocumentSource!(true).text).toContain('output')
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

  it('retains a paused reading position and search across input cancellation and older-page loading', async () => {
    const h = harness([], 'owned')
    const lines = Array.from({ length: 800 }, (_, at) => `line ${at + 1}`)
    h.terminals.read.mockImplementation((_owner?: unknown, _id?: unknown, request?: { offset?: number; count?: number }) => {
      const offset = request?.offset ?? 0, end = lines.length - offset, start = Math.max(0, end - (request?.count ?? 300))
      return { text: lines.slice(start, end).join('\n'), truncated: false, lineBegin: offset, lineEnd: offset + end - start, totalLines: lines.length }
    })
    let documents = 0
    h.prompt.mockImplementation(async request => {
      if (request.presentation !== 'document') return null
      documents++
      expect(request.notify).toBe(false)
      expect(request.refreshDocumentSource).toBeTypeOf('function')
      if (documents === 1) {
        request.onDocumentPosition!({ row: 20, wrap: 1, query: 'line', following: false })
        return 'input'
      }
      expect(request.documentPosition).toEqual({ row: documents === 2 ? 20 : 320, wrap: 1, query: 'line', following: false })
      if (documents === 2) {
        request.onDocumentPosition!(request.documentPosition!)
        return 'earlier'
      }
      expect(request.documentSource?.firstLine).toBe(201)
      return null
    })
    expect(await terminalConsole(h.ctx, h.invocation)).toEqual({ kind: 'success' })
    expect(documents).toBe(3)
    expect(h.terminals.startSend).not.toHaveBeenCalled()
  })
})
