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
  it('paints queued tool output before folding the completed turn without replaying native history', () => {
    const term = new ScrollingTerminal(100, 30)
    term.history.push('existing shell output')
    const tui = new LocalTui(term, 'model', false, 'dark', undefined, { streamRenderMs: 60_000 })
    tui.event(ev('turn/start', { turn: 1 }, 1000))
    tui.setStatus('running')
    tui.event(ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"cat README.md"}' }, 2000))
    tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'LAST_TOOL_OUTPUT' }] } }, 3000))
    tui.event(ev('assistant/message', { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'FINAL_ANSWER' }] } }, 4000))
    expect(term.captured).not.toContain('LAST_TOOL_OUTPUT')
    tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 17000))
    const painted = stripAnsi(term.captured)
    expect(painted.indexOf('LAST_TOOL_OUTPUT')).toBeGreaterThan(-1)
    expect(painted.indexOf('Worked for 16s')).toBeGreaterThan(painted.indexOf('LAST_TOOL_OUTPUT'))
    expect(screen(term)).toContain('Worked for 16s')
    expect(screen(term)).toContain('FINAL_ANSWER')
    expect(screen(term)).not.toContain('LAST_TOOL_OUTPUT')
    expect(term.scrollback()[0]).toBe('existing shell output')
    expect(term.captured).not.toContain('\x1b[3J')
    const rows = term.visible()
    expect(rows[rows.length - 2]).toContain('model')
    tui.dispose()
  })

  it('merges job outcomes in the live view while preserving terminal history and the footer', () => {
    const term = new ScrollingTerminal(100, 24)
    term.history.push('shell output before omdsh')
    const tui = new LocalTui(term, 'test-model', false)
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'check the project' }] }, 1))
    tui.event(ev('turn/start', { turn: 1 }, 2))
    tui.setStatus('running')
    tui.event(ev('tool/call', { turn: 1, step: 1, callId: 'shell-1', name: 'bash', arguments: JSON.stringify({ command: 'pnpm test', description: 'Run project tests' }) }, 3))
    const history = [...term.scrollback()]
    tui.notice('Background job bash-1 failed · pnpm test · exit code: 3', {
      process: true, processSource: 'job:bash-1',
      job: { id: 'bash-1', label: 'pnpm test', status: 'failed', startedAt: 3, detail: 'exit code: 3' },
    })
    // The later tool acknowledgement must not erase the job's failure.
    tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: 'shell-1', content: [{ type: 'text', text: 'started background job bash-1' }] } }, 4))
    tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
    tui.setStatus('idle')
    expect(screen(term)).toContain('Run project tests')
    expect(screen(term)).toContain('exit code: 3')
    expect(screen(term)).not.toContain('Background job')
    expect(term.scrollback().slice(0, history.length)).toEqual(history)
    expect(term.captured).not.toContain('\x1b[3J')
    const rows = term.visible()
    expect(rows[rows.length - 2]).toContain('test-model')
    tui.dispose()
  })

  it('still announces a job from an earlier turn whose row may be in history', () => {
    const term = new ScrollingTerminal(100, 24)
    const tui = new LocalTui(term, 'm', false)
    tui.event(ev('turn/start', { turn: 1 }, 1))
    tui.event(ev('tool/call', { turn: 1, step: 1, callId: 'old-call', name: 'bash', arguments: '{"command":"pnpm test","description":"Run tests"}' }, 2))
    tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: 'old-call', content: [{ type: 'text', text: 'started background job bash-1' }] } }, 3))
    tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 4))
    tui.event(ev('turn/start', { turn: 2 }, 5))
    tui.notice('Background job bash-1 failed · exit code: 2', {
      process: true, level: 'error', processSource: 'job:bash-1',
      job: { id: 'bash-1', label: 'pnpm test', status: 'failed', startedAt: 2, detail: 'exit code: 2' },
    })
    expect(screen(term)).toContain('Background job bash-1 failed')
    tui.dispose()
  })

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
    expect(screen(term)).toContain('▸ Worked')
    expect(screen(term)).not.toContain('Background job bash-1')
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
