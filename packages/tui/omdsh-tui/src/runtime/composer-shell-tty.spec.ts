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
  return { term, input, captured: () => output }
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

  it.each([false, true])('streams in the existing reader and Esc restores the draft; Ctrl+C drains only the Shell (color=%s)', async color => {
    const h = terminal()
    const tui = new LocalTui(h.term, 'model', color, 'dark', async () => {})
    const ctx = new Context()
    const owner = { session: { header: { cwd: '/workspace' } } } as Agent
    const cancelled = vi.fn(), settled = Promise.withResolvers<never>()
    const operation = { done: settled.promise, cancel: vi.fn(() => { settled.reject(new Error('interrupted')); return true }) }
    ctx.provide('tui', tui)
    ctx.provide('terminals', {
      spawn: async () => ({ sessionId: 'shell' }),
      list: () => [{ sessionId: 'shell', name: 'Composer shell', type: 'shell', status: { kind: 'running' } }],
      startSend: vi.fn(() => operation),
      read: () => ({ text: 'hello 中文 🐳', totalLines: 1, lineBegin: 0, lineEnd: 1, truncated: false }),
    } as never)
    const off = tui.onInterrupt(cancelled)
    try {
      tui.restoreInput({ text: 'keep my draft', images: [] })
      const reading = runComposerShell(ctx, owner, 'echo hello', new AbortController().signal)
      await vi.waitFor(() => { expect(stripAnsi(h.captured())).toContain('hello 中文 🐳') })
      h.input.write('\x1b')
      await reading
      expect(operation.cancel).not.toHaveBeenCalled()
      const restored = tui.readInput()
      h.input.write('\r')
      expect((await restored)?.text).toBe('keep my draft')
      tui.restoreInput({ text: 'keep my draft', images: [] })
      const interrupted = runComposerShell(ctx, owner, 'sleep 100', new AbortController().signal)
      await vi.waitFor(() => { expect(stripAnsi(h.captured())).toContain('Ctrl+C interrupt') })
      h.input.write('\x03')
      await interrupted
      expect(operation.cancel).toHaveBeenCalledOnce()
      expect(cancelled).not.toHaveBeenCalled()
      const afterInterrupt = tui.readInput()
      h.input.write('\r')
      expect((await afterInterrupt)?.text).toBe('keep my draft')
    } finally { operation.cancel(); off(); await tui.dispose(); await ctx.fiber.dispose() }
  })
})
