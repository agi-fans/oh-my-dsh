/**
 * End-to-end smoke for the three repaired defects, through the real TUI and a
 * scrolling terminal: a run whose work settles after the answer, a status change
 * that reuses the render cache, and two runs keyed apart.
 */
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { stripAnsi } from '../chrome/width.ts'
import { LocalTui, type TerminalLike } from './provider-local.ts'
import { processGroups } from '../views/transcript-render.ts'
import type { Block } from '../views/transcript-types.ts'

class ScrollingTerminal implements TerminalLike {
  captured = ''
  screen: string[]
  history: string[] = []
  #row = 0
  #col = 0
  output = { isTTY: true, write: (chunk: string): void => this.#write(chunk) }
  input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (): void => {}, destroy: (): void => {} })
  constructor(readonly columns: number, readonly rows: number) {
    this.screen = Array.from({ length: rows }, () => '')
  }
  width(): number { return this.columns }
  height(): number { return this.rows }
  visible(): string[] { return this.screen.map(row => stripAnsi(row)) }
  scrollback(): string[] { return this.history.map(row => stripAnsi(row)) }
  #write(chunk: string): void {
    this.captured += chunk
    for (const token of chunk.match(/\x1b\[[?0-9;]*[ -/]*[@-~]|\r\n|\r|\n|[^\r\n\x1b]+/gu) ?? []) {
      if (token === '\r\n' || token === '\n') {
        if (this.#row === this.rows - 1) {
          this.history.push(this.screen.shift() ?? '')
          this.screen.push('')
        } else this.#row += 1
        if (token === '\r\n') this.#col = 0
      } else if (token === '\r') this.#col = 0
      else if (token.startsWith('\x1b[')) {
        const final = token.at(-1)
        const params = token.slice(2, -1).replace(/^\?/u, '').split(';').map(value => Number(value || '1'))
        if (final === 'H') {
          this.#row = Math.min(this.rows - 1, (params[0] ?? 1) - 1)
          this.#col = (params[1] ?? 1) - 1
        } else if (final === 'K') this.screen[this.#row] = (params[0] ?? 0) === 2 ? '' : (this.screen[this.#row] ?? '').slice(0, this.#col)
        else if (final === 'J' && (params[0] === 2 || params[0] === 3)) this.screen = this.screen.map(() => '')
      } else {
        const current = (this.screen[this.#row] ?? '').padEnd(this.#col)
        this.screen[this.#row] = current.slice(0, this.#col) + token + current.slice(this.#col + token.length)
        this.#col += token.length
      }
    }
  }
}

function ev(type: string, data: unknown, seq: number): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}
const call = (id: string, args: unknown, seq: number, turn = 1): SessionEvent =>
  ev('tool/call', { turn, step: 1, callId: id, name: 'read', arguments: JSON.stringify(args) }, seq)
const ok = (id: string, seq: number): SessionEvent =>
  ev('tool/result', { message: { role: 'tool', toolCallId: id, content: [{ type: 'text', text: 'body' }] } }, seq)
const screen = (t: ScrollingTerminal): string => t.visible().join('\n')

describe('the repaired defects, on a real terminal', () => {
  it('still shows the answer when the turn\'s work settles after it', () => {
    const term = new ScrollingTerminal(80, 24)
    const tui = new LocalTui(term, 'm', false)
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'map the project' }] }, 1))
    tui.event(ev('turn/start', { turn: 1 }, 2))
    tui.event(call('c1', { path: 'src/a.ts' }, 3))
    tui.event(ok('c1', 4))
    tui.event(call('c2', { path: 'src/b.ts' }, 5))
    tui.event(ok('c2', 6))
    tui.event(ev('assistant/message', {
      turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'THE FINAL ANSWER' }] },
    }, 7))
    tui.setStatus('running')
    // A background job settles after the turn already answered.
    tui.notice('Background job bash-1 completed · pnpm test', { process: true, processSource: 'job:bash-1' })
    tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 8))
    tui.setStatus('idle')

    // The reply is the one thing a reader scrolling back must find.
    expect(screen(term)).toContain('THE FINAL ANSWER')
    // The run is still folded, and the trailing notice is on screen with it.
    expect(screen(term)).toContain('Read file')
    expect(screen(term)).toContain('Background job bash-1')
    tui.dispose()
  })

  it('folds a live turn when the status flips back to idle, and not before', () => {
    const term = new ScrollingTerminal(80, 24)
    const tui = new LocalTui(term, 'm', false)
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] }, 1))
    tui.event(ev('turn/start', { turn: 1 }, 2))
    tui.event(call('c1', { path: 'src/a.ts' }, 3))
    tui.event(ok('c1', 4))
    tui.event(call('c2', { path: 'src/b.ts' }, 5))
    tui.event(ok('c2', 6))
    tui.event(ev('assistant/message', {
      turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'all done' }] },
    }, 7))
    tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 8))

    // Running: the run is not grouped, so its calls are laid out as they happen.
    tui.setStatus('running')
    expect(screen(term)).toContain('src/a.ts')
    // Idle: the same block array must now fold, so the calls leave the screen.
    // This is the direction that reused the running turn's flat rows when the
    // status was not in the cache key.
    tui.setStatus('idle')
    expect(screen(term)).not.toContain('src/a.ts')
    tui.dispose()
  })

  it('opens one run without opening the other', () => {
    const term = new ScrollingTerminal(80, 24)
    const tui = new LocalTui(term, 'm', false)
    for (const [turn, jobs] of [[1, 'bash-1'], [2, 'bash-2']] as const) {
      tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: `turn ${turn}` }] }, turn * 10))
      tui.event(ev('turn/start', { turn }, turn * 10 + 1))
      tui.notice(`Background job ${jobs} completed`, { process: true, processSource: `job:${jobs}` })
      tui.event(call(`t${turn}a`, { path: `src/${turn}a.ts` }, turn * 10 + 2, turn))
      tui.event(ok(`t${turn}a`, turn * 10 + 3))
      tui.event(call(`t${turn}b`, { path: `src/${turn}b.ts` }, turn * 10 + 4, turn))
      tui.event(ok(`t${turn}b`, turn * 10 + 5))
      tui.event(ev('assistant/message', {
        turn, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: `answer ${turn}` }] },
      }, turn * 10 + 6))
      tui.event(ev('turn/end', { turn, reason: { kind: 'completed' } }, turn * 10 + 7))
    }
    tui.setStatus('idle')
    // Folded: neither run's calls are on screen.
    expect(screen(term)).not.toContain('src/1a.ts')
    expect(screen(term)).not.toContain('src/2a.ts')
    // Open the run under the viewport, which following the tail makes the last.
    term.input.write('\x0f')
    expect(screen(term)).toContain('src/2a.ts')
    tui.dispose()
  })

  it('gives two notice-led runs two keys, so one opened run cannot take the other', () => {
    // The shared key is visible from the projection the TUI reads: two
    // distinct stretches of blocks and one key between them, which the
    // opened-run set addresses the reader's choice by. Same shape as the turn
    // above, so a key that drifts is caught here and not only on screen.
    const led = (turn: number, source: string): Block[] => [
      { kind: 'user', text: `turn ${turn}` },
      { kind: 'notice', level: 'info', text: `Background job ${source} completed`, process: { turn, source: `job:${source}` } },
      { kind: 'tool', callId: `t${turn}a`, name: 'read', args: '{"path":"src/' + turn + 'a.ts"}', status: 'ok', output: 'body', turn },
      { kind: 'tool', callId: `t${turn}b`, name: 'read', args: '{"path":"src/' + turn + 'b.ts"}', status: 'ok', output: 'body', turn },
    ]
    const groups = processGroups([...led(1, 'bash-1'), ...led(2, 'bash-2')])

    expect(groups).toHaveLength(2)
    expect(new Set(groups.map(group => group.key)).size).toBe(2)
  })
})
