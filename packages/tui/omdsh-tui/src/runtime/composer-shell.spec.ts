import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TerminalSendResult } from '@deepseek-ai/dsh-terminal'
import { describe, expect, it, vi } from 'vitest'
import type { TuiService, TuiSubmission } from '../definition.ts'
import { composerShellCommand, composerShellShare, runComposerShell } from './composer-shell.ts'

function submission(text: string, extra: Partial<TuiSubmission> = {}): TuiSubmission { return { text, images: [], ...extra } }

function harness() {
  const ctx = new Context()
  const owner = { session: { header: { cwd: '/original' } } } as Agent
  const published = new Map<Agent, 'running' | 'exited'>()
  let lastOwner: Agent | undefined
  const pending = Promise.withResolvers<TerminalSendResult>()
  /**
   * A send that settles on delivery, which is what the card waits for. The card
   * no longer holds the surface open until the command exits, so the send is not
   * the test's to keep pending.
   */
  pending.resolve({ viewport: '', waitReason: 'stdin_read', sessionStatus: { kind: 'running' }, truncated: false })
  const operation = { done: pending.promise, readOutput: vi.fn(), cancel: vi.fn(() => { pending.resolve({ viewport: '', waitReason: 'stdin_read', sessionStatus: { kind: 'running' }, truncated: false }); return true }) }
  // The shell answers a line by writing it back plus its output, which is what
  // makes a baseline worth taking at all.
  let sent = false
  const terminals = {
    spawn: vi.fn(async (agent: Agent = owner) => { published.set(agent, 'running'); lastOwner = agent; return { sessionId: 'composer' } }),
    list: vi.fn((agent: Agent) => { const status = published.get(agent); return status === undefined ? [] : [{ sessionId: 'composer', name: 'Composer shell', type: 'shell', status: status === 'running' ? { kind: status } : { kind: status, exitCode: 0, signal: null } }] }),
    kill: vi.fn(async (agent: Agent) => { published.delete(agent); return true }),
    startSend: vi.fn(() => { sent = true; return operation }), signal: vi.fn(),
    // A persistent shell's scrollback: the prompt from a previous line first,
    // then whatever this line writes. `count` is honoured so a caller can ask
    // for only the lines past its own baseline.
    read: vi.fn((_agent: unknown, _id: unknown, request?: { offset?: number; count?: number }) => {
      const lines = sent
        ? ['dsh> old output', 'dsh>', 'dsh> git status', 'M a.ts', 'dsh>']
        : ['dsh> old output', 'dsh>']
      // `offset` counts back from the newest retained line, so a page is the
      // lines ending at `totalLines - offset` — not the first N of the buffer.
      const total = lines.length
      const end = total - (request?.offset ?? 0)
      const start = Math.max(0, end - (request?.count ?? total))
      return {
        text: lines.slice(start, end).join('\n'),
        truncated: false,
        lineBegin: end - start,
        lineEnd: end,
        totalLines: lines.length,
      }
    }),
  }
  const prompt = vi.fn<TuiService['prompt']>().mockResolvedValue(null)
  const notice = vi.fn(), commandOutput = vi.fn()
  /**
   * The card surface, reduced to what a caller observes: run the request and
   * hand back its result. The provider's own rendering is covered by the
   * fake-TTY contract, not here.
   */
  /** Output the card was last handed, so a test can assert the projection. */
  const cardOutput: { last: string } = { last: '' }
  const shellCommand = vi.fn(async (request: { run: (onOutput: (output: string) => void, signal: AbortSignal) => Promise<unknown>; signal: AbortSignal }) =>
    request.run(output => { cardOutput.last = output }, request.signal))
  ctx.provide('tui', { interactive: true, prompt, notice, commandOutput, shellCommand } as never)
  ctx.provide('terminals', terminals as never)
  ctx.provide('workingDirectory', { get: () => '/current' } as never)
  return { ctx, owner, terminals, prompt, notice, commandOutput, shellCommand, cardOutput, operation, pending, setExited: () => { if (lastOwner !== undefined) published.set(lastOwner, 'exited') } }
}

describe('Composer Shell input', () => {
  it('recognizes only an explicit leading ! or !! and retains the Shell command body', () => {
    expect(composerShellCommand(submission('!cd ../next && echo 中文 🐳'))).toBe('cd ../next && echo 中文 🐳')
    expect(composerShellShare(submission('!cd ../next && echo 中文 🐳'))).toBe(false)
    expect(composerShellCommand(submission('!!git status --short'))).toBe('git status --short')
    expect(composerShellShare(submission('!!git status --short'))).toBe(true)
    expect(composerShellCommand(submission('!'))).toBe('')
    expect(composerShellCommand(submission('please explain !rm'))).toBeUndefined()
  })

  it('never executes a pasted leading ! or an attachment-bearing message', () => {
    expect(composerShellCommand(submission('!rm -rf target', { literal: true }))).toBeUndefined()
    expect(composerShellShare(submission('!!rm -rf target', { literal: true }))).toBe(false)
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
      // The card is the surface; no reader prompt is opened at all.
      expect(h.prompt).not.toHaveBeenCalled()
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

  it('interrupting the card cancels the send and signals the shell', async () => {
    const h = harness()
    try {
      // The card's abort is what Ctrl+C routes to while a command runs.
      h.shellCommand.mockImplementationOnce(async (request: { run: (onOutput: (output: string) => void, signal: AbortSignal) => Promise<unknown>; signal: AbortSignal; abort: () => void }) => {
        const running = request.run(() => {}, request.signal)
        // Let the send start, then interrupt exactly as the key would.
        await Promise.resolve()
        request.abort()
        return running
      })
      h.operation.cancel.mockReturnValueOnce(false)
      await runComposerShell(h.ctx, h.owner, 'sleep 100', new AbortController().signal)
      expect(h.terminals.signal).toHaveBeenCalledWith(h.owner, 'composer', 'SIGINT')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('unloading cancels pending work and waits for the provider acknowledgement', async () => {
    const h = harness()
    const abort = new AbortController()
    try {
      abort.abort(new Error('runner unloaded'))
      await expect(runComposerShell(h.ctx, h.owner, 'sleep 100', abort.signal)).rejects.toThrow('runner unloaded')
      h.operation.cancel()
      await h.ctx.fiber.dispose()
    } finally { h.operation.cancel(); await h.ctx.fiber.dispose() }
  })

  it('provider readiness never becomes a fabricated command success or tool result', async () => {
    const h = harness()
    try {
      await runComposerShell(h.ctx, h.owner, 'long command', new AbortController().signal)
      expect(h.notice.mock.calls.flat().join(' ')).not.toMatch(/success|finished|exit code/iu)
      expect(h.commandOutput).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('shares output to the main transcript and session context when invoked with share: true (!!command)', async () => {
    const h = harness()
    const inject = vi.fn()
    Object.assign(h.owner, { inject })
    try {
      await runComposerShell(h.ctx, h.owner, 'git status', new AbortController().signal, { share: true })
      // The injection is the only record: the transcript renders it, so a
      // resumed session still shows the output the model was given. A parallel
      // local write would have vanished on resume.
      expect(inject).toHaveBeenCalledWith(expect.objectContaining({
        source: expect.objectContaining({ kind: 'omdsh-terminal', form: 'notice' }),
      }))
      expect(h.commandOutput).not.toHaveBeenCalled()
    } finally { h.operation.cancel(); await h.ctx.fiber.dispose() }
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

describe('Access changes and the composer Shell', () => {
  it('closes the composer Shell so an Access switch is not blocked by it', async () => {
    // A persistent terminal pins the session to the sandbox it was created in,
    // and the Harness refuses to change sandbox mode while one is open. Without
    // closing it, a reader who ran one `!` line could never change Access again
    // — and there is no other surface left to close it from.
    const h = harness()
    try {
      await runComposerShell(h.ctx, h.owner, 'pwd', new AbortController().signal)
      const { closeIdleComposerShell } = await import('./composer-shell.ts')
      expect(await closeIdleComposerShell(h.ctx, h.owner)).toBe(true)
      expect(h.terminals.kill).toHaveBeenCalledWith(h.owner, 'composer', 'Composer shell closed for an Access change')
    } finally { await h.ctx.fiber.dispose() }
  })

  it('reports nothing to close when no composer Shell exists', async () => {
    const h = harness()
    try {
      const { closeIdleComposerShell } = await import('./composer-shell.ts')
      expect(await closeIdleComposerShell(h.ctx, h.owner)).toBe(false)
      expect(h.terminals.kill).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })
})

describe('Shell card projection', () => {
  it('shows only what this line produced, not the shell history above it', async () => {
    // The shell is persistent and echoes the prompt, so the raw scrollback holds
    // an earlier line's output and this line's own echo. A card that rendered the
    // whole snapshot repeated the command under its `$ command` header and
    // replayed history from before this line ran.
    const h = harness()
    try {
      await runComposerShell(h.ctx, h.owner, 'git status', new AbortController().signal)
      // The card is handed the delta: this line's echo, its output, the next
      // prompt — never the earlier line's output above the baseline.
      expect(h.cardOutput.last).toContain('git status')
      expect(h.cardOutput.last).toContain('M a.ts')
      expect(h.cardOutput.last).not.toContain('old output')
    } finally { h.operation.cancel(); await h.ctx.fiber.dispose() }
  })
})
