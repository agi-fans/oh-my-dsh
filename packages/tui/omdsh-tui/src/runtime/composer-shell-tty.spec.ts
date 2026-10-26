import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { LocalTui, type TerminalLike } from './provider-local.ts'
import { composerShellCommand, runComposerShell } from './composer-shell.ts'
import { stripAnsi } from '../chrome/width.ts'

function terminal() {
  let output = ''
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() })
  const term: TerminalLike = { input, output: { isTTY: true, write: chunk => { output += chunk } }, width: () => 90, height: () => 24, onResize: () => () => {} }
  return { term, input, captured: () => stripAnsi(output) }
}

/** A registry whose one Composer shell answers `read` with whatever the test set. */
function registry(state: { text: string; running: boolean }) {
  const settled = Promise.withResolvers<void>()
  const operation = { done: settled.promise, cancel: vi.fn(() => { settled.reject(new Error('interrupted')); return true }) }
  return {
    state,
    operation,
    settle: () => settled.resolve(),
    registry: {
      spawn: async () => ({ sessionId: 'shell' }),
      list: () => [{ sessionId: 'shell', name: 'Composer shell', type: 'shell', status: { kind: state.running ? 'running' : 'exited' } }],
      startSend: vi.fn(() => operation),
      read: () => ({ text: state.text, totalLines: state.text.split('\n').length, lineBegin: 0, lineEnd: 1, truncated: false }),
    } as never,
  }
}

describe('Composer Shell fake-TTY contract', () => {
  it.each([false, true])('keeps pasted ! literal and deliberate ! runnable (color=%s)', async color => {
    const h = terminal()
    const tui = new LocalTui(h.term, 'model', color, 'dark', async () => {})
    try {
      const pasted = tui.readInput()
      h.input.write('\x1b[200~!echo pasted\x1b[201~\r')
      const literal = await pasted
      expect(literal).toMatchObject({ text: '!echo pasted', literal: true })
      expect(composerShellCommand(literal!)).toBeUndefined()
      const typed = tui.readInput()
      for (const character of '!echo typed') {
        h.input.write(character)
        await new Promise(resolve => setTimeout(resolve, 8))
      }
      h.input.write('\r')
      expect(composerShellCommand((await typed)!)).toBe('echo typed')
    } finally { await tui.dispose() }
  })

  it.each([false, true])('runs into a transcript card that settles in place (color=%s)', async color => {
    const h = terminal()
    const tui = new LocalTui(h.term, 'model', color, 'dark', async () => {})
    const ctx = new Context()
    const owner = { session: { header: { cwd: '/workspace' } } } as Agent
    const { operation, registry: terminals, settle, state } = registry({ text: 'hello 中文 🐳', running: true })
    ctx.provide('tui', tui)
    ctx.provide('terminals', terminals)
    try {
      tui.restoreInput({ text: 'keep my draft', images: [] })
      const running = runComposerShell(ctx, owner, 'echo hello', new AbortController().signal)
      // The card streams while the command runs, in the transcript — no reader
      // to enter, so the composer draft survives untouched.
      await vi.waitFor(() => { expect(h.captured()).toContain('hello 中文 🐳') })
      expect(h.captured()).toContain('$ echo hello')
      state.running = false
      settle()
      await running
      expect(operation.cancel).not.toHaveBeenCalled()
      // And it settles in place rather than waiting for an exit gesture.
      expect(h.captured()).toContain('$ echo hello')
      const restored = tui.readInput()
      h.input.write('\r')
      expect((await restored)?.text).toBe('keep my draft')
    } finally { operation.cancel(); await tui.dispose(); await ctx.fiber.dispose() }
  })

  it('Ctrl+C interrupts the Shell without cancelling a model Turn', async () => {
    const h = terminal()
    const tui = new LocalTui(h.term, 'model', false, 'dark', async () => {})
    const ctx = new Context()
    const owner = { session: { header: { cwd: '/workspace' } } } as Agent
    const { operation, registry: terminals, settle } = registry({ text: 'still running', running: true })
    ctx.provide('tui', tui)
    ctx.provide('terminals', terminals)
    const cancelled = vi.fn()
    const off = tui.onInterrupt(cancelled)
    try {
      // An empty composer, which is the state a reader is in while watching a
      // command run. With a draft present Ctrl+C clears the draft first — that
      // ordering is what keeps a half-written message from being thrown away.
      const running = runComposerShell(ctx, owner, 'sleep 100', new AbortController().signal)
      await vi.waitFor(() => { expect(h.captured()).toContain('still running') })
      h.input.write('\x03')
      await running
      expect(operation.cancel).toHaveBeenCalledOnce()
      // The primary turn is not the Shell's to cancel.
      expect(cancelled).not.toHaveBeenCalled()
      settle()
      // The card is settled and the composer is still usable.
      const next = tui.readInput()
      h.input.write('after\r')
      expect((await next)?.text).toBe('after')
    } finally { operation.cancel(); off(); await tui.dispose(); await ctx.fiber.dispose() }
  })
})
