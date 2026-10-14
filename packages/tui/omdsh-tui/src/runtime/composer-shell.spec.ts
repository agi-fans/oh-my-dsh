import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TerminalSendResult } from '@deepseek-ai/dsh-terminal'
import { describe, expect, it, vi } from 'vitest'
import type { TuiService, TuiSubmission } from '../definition.ts'
import { composerShellCommand, runComposerShell } from './composer-shell.ts'

function submission(text: string, extra: Partial<TuiSubmission> = {}): TuiSubmission { return { text, images: [], ...extra } }

function harness() {
  const ctx = new Context()
  const owner = { session: { header: { cwd: '/original' } } } as Agent
  const published = new Map<Agent, 'running' | 'exited'>()
  let lastOwner: Agent | undefined
  const pending = Promise.withResolvers<TerminalSendResult>()
  const operation = { done: pending.promise, readOutput: vi.fn(), cancel: vi.fn(() => { pending.resolve({ viewport: '', waitReason: 'stdin_read', sessionStatus: { kind: 'running' }, truncated: false }); return true }) }
  const terminals = {
    spawn: vi.fn(async (agent: Agent = owner) => { published.set(agent, 'running'); lastOwner = agent; return { sessionId: 'composer' } }),
    list: vi.fn((agent: Agent) => { const status = published.get(agent); return status === undefined ? [] : [{ sessionId: 'composer', name: 'Composer shell', type: 'shell', status: status === 'running' ? { kind: status } : { kind: status, exitCode: 0, signal: null } }] }),
    kill: vi.fn(async (agent: Agent) => { published.delete(agent); return true }),
    startSend: vi.fn(() => operation), signal: vi.fn(),
    read: vi.fn(() => ({ text: 'hello\ndsh> ', truncated: false, lineBegin: 0, lineEnd: 2, totalLines: 2 })),
  }
  const prompt = vi.fn<TuiService['prompt']>().mockResolvedValue(null)
  const notice = vi.fn(), commandOutput = vi.fn()
  ctx.provide('tui', { interactive: true, prompt, notice, commandOutput } as never)
  ctx.provide('terminals', terminals as never)
  ctx.provide('workingDirectory', { get: () => '/current' } as never)
  return { ctx, owner, terminals, prompt, notice, commandOutput, operation, pending, setExited: () => { if (lastOwner !== undefined) published.set(lastOwner, 'exited') } }
}

describe('Composer Shell input', () => {
  it('recognizes only an explicit leading ! and retains the Shell command body', () => {
    expect(composerShellCommand(submission('!cd ../next && echo 中文 🐳'))).toBe('cd ../next && echo 中文 🐳')
    expect(composerShellCommand(submission('!'))).toBe('')
    expect(composerShellCommand(submission('please explain !rm'))).toBeUndefined()
  })

  it('never executes a pasted leading ! or an attachment-bearing message', () => {
    expect(composerShellCommand(submission('!rm -rf target', { literal: true }))).toBeUndefined()
    expect(composerShellCommand(submission('!echo image', { images: [{}] as never }))).toBeUndefined()
    expect(composerShellCommand(submission('!echo file', { files: [{}] as never }))).toBeUndefined()
  })
})

describe('Composer persistent Shell', () => {
  it('starts in the current workspace and reuses only the exact owner’s terminal; Esc detaches', async () => {
    const h = harness()
    try {
      const signal = new AbortController().signal
      await runComposerShell(h.ctx, h.owner, 'export HELLO=world', signal)
      await runComposerShell(h.ctx, h.owner, 'echo "$HELLO"', signal)
      expect(h.terminals.spawn).toHaveBeenCalledOnce()
      expect(h.terminals.spawn).toHaveBeenCalledWith(h.owner, { type: 'shell', name: 'Composer shell', cwd: '/current' }, expect.any(AbortSignal))
      expect(h.terminals.startSend.mock.calls.map(call => (call as unknown as [unknown, unknown, { text: string }])[2].text)).toEqual(['export HELLO=world', 'echo "$HELLO"'])
      expect(h.terminals.kill).not.toHaveBeenCalled()
      expect(h.operation.cancel).not.toHaveBeenCalled()
      expect(h.commandOutput).not.toHaveBeenCalled()
      expect(h.prompt.mock.calls[0]![0].detail).toContain('outside model context')
      // A second Agent must not inherit the first Agent's environment or cwd.
      await runComposerShell(h.ctx, { session: h.owner.session } as Agent, 'pwd', signal)
      expect(h.terminals.spawn).toHaveBeenCalledTimes(2)
    } finally { h.operation.cancel(); await h.ctx.fiber.dispose() }
  })

  it('closes a previously exited Shell before recreating its reserved name', async () => {
    const h = harness()
    try {
      await runComposerShell(h.ctx, h.owner, 'exit', new AbortController().signal)
      h.setExited()
      await runComposerShell(h.ctx, h.owner, 'pwd', new AbortController().signal)
      expect(h.terminals.kill).toHaveBeenCalledWith(h.owner, 'composer', 'Composer shell exited')
      expect(h.terminals.spawn).toHaveBeenCalledTimes(2)
    } finally { h.operation.cancel(); await h.ctx.fiber.dispose() }
  })

  it('does not retarget an old id after the registry is replaced', async () => {
    const first = harness(), replacement = harness()
    try {
      await runComposerShell(first.ctx, first.owner, 'pwd', new AbortController().signal)
      // The replacement provider can independently mint the same id for a
      // different terminal; an id alone cannot identify the Composer Shell.
      replacement.terminals.list.mockReturnValue([{ sessionId: 'composer', name: 'Other terminal', type: 'shell', status: { kind: 'running' } }])
      await runComposerShell(replacement.ctx, first.owner, 'pwd', new AbortController().signal)
      expect(replacement.terminals.spawn).toHaveBeenCalledOnce()
    } finally { first.operation.cancel(); replacement.operation.cancel(); await first.ctx.fiber.dispose(); await replacement.ctx.fiber.dispose() }
  })

  it('Ctrl+C interrupts and drains the send without cancelling a model Turn', async () => {
    const h = harness()
    try {
      h.prompt.mockImplementationOnce(async request => { request.interrupt!(); return null })
      await runComposerShell(h.ctx, h.owner, 'sleep 100', new AbortController().signal)
      expect(h.operation.cancel).toHaveBeenCalledOnce()
      const request = h.terminals.startSend.mock.calls[0] as unknown as [unknown, unknown, { signal: AbortSignal }]
      expect(request[2].signal.aborted).toBe(true)
      expect(h.terminals.kill).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('unloading cancels pending work and waits for the provider acknowledgement', async () => {
    const h = harness()
    const abort = new AbortController()
    try {
      h.prompt.mockImplementationOnce(async request => new Promise(resolve => { request.signal!.addEventListener('abort', () => resolve(null), { once: true }) }))
      const running = runComposerShell(h.ctx, h.owner, 'sleep 100', abort.signal)
      await vi.waitFor(() => { expect(h.prompt).toHaveBeenCalledOnce() })
      abort.abort(new Error('runner unloaded'))
      await running
      expect(h.operation.cancel).toHaveBeenCalledOnce()
    } finally { h.operation.cancel(); await h.ctx.fiber.dispose() }
  })

  it('interrupts the foreground process even after the input wait has already settled', async () => {
    const h = harness()
    try {
      h.pending.resolve({ viewport: 'partial', waitReason: 'timeout', sessionStatus: { kind: 'running' }, truncated: false })
      h.operation.cancel.mockReturnValueOnce(false)
      h.prompt.mockImplementationOnce(async request => { request.interrupt!(); return null })
      await runComposerShell(h.ctx, h.owner, 'sleep 100', new AbortController().signal)
      expect(h.terminals.signal).toHaveBeenCalledWith(h.owner, 'composer', 'SIGINT')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('provider readiness never becomes a fabricated command success or tool result', async () => {
    const h = harness()
    try {
      h.pending.resolve({ viewport: 'partial', waitReason: 'inferred_idle', sessionStatus: { kind: 'running' }, truncated: false })
      await runComposerShell(h.ctx, h.owner, 'long command', new AbortController().signal)
      expect(h.notice.mock.calls.flat().join(' ')).not.toMatch(/success|finished|exit code/iu)
      expect(h.commandOutput).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('keeps provider failures visible and never falls back to a local subprocess', async () => {
    const h = harness()
    try {
      h.terminals.startSend.mockImplementationOnce(() => { throw new Error('SEND_ACTIVE') })
      await expect(runComposerShell(h.ctx, h.owner, 'pwd', new AbortController().signal)).rejects.toThrow('SEND_ACTIVE')
      h.terminals.spawn.mockRejectedValueOnce(new Error('sandbox denied'))
      await expect(runComposerShell(h.ctx, { session: h.owner.session } as Agent, 'pwd', new AbortController().signal)).rejects.toThrow('sandbox denied')
    } finally { h.operation.cancel(); await h.ctx.fiber.dispose() }
  })

  it('rejects empty, cancelled and noninteractive requests before sending input', async () => {
    const h = harness()
    try {
      await expect(runComposerShell(h.ctx, h.owner, '', new AbortController().signal)).rejects.toThrow('Enter a command')
      await expect(runComposerShell(h.ctx, h.owner, 'pwd', AbortSignal.abort(new Error('stopped')))).rejects.toThrow('stopped')
      h.ctx.tui.interactive = false
      await expect(runComposerShell(h.ctx, h.owner, 'pwd', new AbortController().signal)).rejects.toThrow('interactive terminal')
      expect(h.terminals.spawn).not.toHaveBeenCalled()
      expect(h.terminals.startSend).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })
})
