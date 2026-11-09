import { Terminal } from '@xterm/headless'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { PassThrough } from 'node:stream'
import { expect, it } from 'vitest'
import { stripAnsi } from '../chrome/width.ts'
import { applyEvent, initialTranscript, renderView } from '../views/event-views.ts'
import { LocalTui, type TerminalLike } from './provider-local.ts'

it.each([false, true].flatMap(colors => [false, true].map(longHistory => ({ colors, longHistory }))))(
  'fills the viewport after a long turn folds (colors=$colors, long history=$longHistory)', async ({ colors, longHistory }) => {
    const terminal = new Terminal({ cols: 100, rows: 40, scrollback: 2000, allowProposedApi: true })
    let pending = Promise.resolve()
    let resized: (() => void) | undefined
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {} })
    const term: TerminalLike = {
      input,
      output: { isTTY: true, write: chunk => {
        pending = pending.then(() => new Promise<void>(resolve => { terminal.write(chunk, resolve) }))
      } },
      width: () => terminal.cols,
      height: () => terminal.rows,
      onResize: listener => {
        resized = listener
        return () => { resized = undefined }
      },
    }
    const tui = new LocalTui(term, 'm', colors, 'dark', async () => {}, { streamRenderMs: 0, imageProtocol: 'none' })
    tui.applyStoredPrefs({ theme: 'dark', colors, motion: 'off', notifications: 'off' })
    void tui.readInput()
    let seq = 0
    let state = initialTranscript()
    const event = (type: string, data: unknown): void => {
      const next = { type, data, seq: ++seq, time: seq } as SessionEvent
      state = applyEvent(state, next)
      tui.event(next)
    }
    const flush = async (): Promise<void> => {
      await new Promise<void>(resolve => { setTimeout(resolve, 0) })
      await pending
    }
    const visible = (): string[] => Array.from({ length: terminal.rows }, (_, row) =>
      terminal.buffer.normal.getLine(terminal.buffer.normal.baseY + row)?.translateToString(true) ?? '')
    const history = (): string[] => Array.from({ length: terminal.buffer.normal.baseY }, (_, row) =>
      terminal.buffer.normal.getLine(row)?.translateToString(true) ?? '')
    const previousRows = (): string[] => visible().filter(row => row.includes('PREVIOUS-')).map(row => row.trimEnd())
    const expectedPrevious = (): string[] => renderView(state, {
      width: terminal.cols, height: terminal.rows, model: 'm', input: '', inputCursor: 0,
      colors, hideThinking: true, scrollStart: Infinity,
    }).lines.slice(-terminal.rows).filter(row => row.includes('PREVIOUS-')).map(row => stripAnsi(row).trimEnd())
    const runTools = async (turn: number): Promise<void> => {
      event('turn/start', { turn })
      event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: `Request ${turn}` }] })
      for (let i = 0; i < 55; i++) {
        const callId = `${turn}-${i}`
        event('tool/call', { turn, step: i + 1, callId, name: 'read', arguments: JSON.stringify({ path: `file-${i}.ts` }) })
        event('tool/result', { message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text: 'ok' }] } })
        await flush()
      }
      event('assistant/message', { turn, step: 56, message: { role: 'assistant', content: [{ type: 'text', text: `CURRENT ANSWER ${turn}` }] } })
      await flush()
    }
    try {
      event('turn/start', { turn: 1 })
      event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'First request' }] })
      event('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{
        type: 'text', text: Array.from({ length: 90 }, (_, i) => `PREVIOUS-${String(i).padStart(2, '0')}`).join(longHistory ? '\n\n' : '\n'),
      }] } })
      event('turn/end', { turn: 1, reason: { kind: 'completed' } })
      await flush()
      expect(previousRows().length).toBeGreaterThan(0)

      await runTools(2)
      expect(visible().some(row => row.includes('PREVIOUS-'))).toBe(false)
      const frozen = history()
      expect(frozen.some(row => row.includes('PREVIOUS-'))).toBe(true)

      event('turn/end', { turn: 2, reason: { kind: 'completed' } })
      await flush()
      expect(previousRows()).toEqual(expectedPrevious())
      expect(previousRows().length).toBeGreaterThan(0)
      expect(visible().some(row => row.includes('CURRENT ANSWER'))).toBe(true)
      expect(history()).toEqual(frozen)

      input.write('unfinished draft')
      await flush()
      const folded = visible()
      input.write('\x1b[5~')
      await flush()
      if (longHistory) expect(visible().some(row => row.includes('↓ Latest'))).toBe(true)
      input.write('\x1b[F')
      await flush()
      expect(visible()).toEqual(folded)
      expect(visible().some(row => row.includes('unfinished draft'))).toBe(true)
      expect(history()).toEqual(frozen)

      terminal.resize(90, 34)
      resized?.()
      await flush()
      expect(previousRows()).toEqual(expectedPrevious())
      expect(previousRows().length).toBeGreaterThan(0)
      expect(visible().some(row => row.includes('unfinished draft'))).toBe(true)
      expect(terminal.buffer.normal.cursorY).toBeGreaterThanOrEqual(terminal.rows - 6)
      terminal.resize(100, 40)
      resized?.()
      await flush()
      expect(previousRows()).toEqual(expectedPrevious())

      const beforeNextTurn = history()
      await runTools(3)
      event('turn/end', { turn: 3, reason: { kind: 'completed' } })
      await flush()
      expect(previousRows()).toEqual(expectedPrevious())
      expect(previousRows().length).toBeGreaterThan(0)
      expect(history().slice(0, beforeNextTurn.length)).toEqual(beforeNextTurn)
      expect(history().filter(row => row.includes('PREVIOUS-'))).toEqual(beforeNextTurn.filter(row => row.includes('PREVIOUS-')))
    } finally {
      await tui.dispose()
      await pending
      terminal.dispose()
    }
  },
)
