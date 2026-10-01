/**
 * Search-driven reshaping, through the provider's real notification chain.
 *
 * The renderer tells the host which surfaces are open as one comparable string;
 * the host compares it between frames and tells the renderer when rows above the
 * screen changed shape. A search that opens a thought reshapes those rows, so
 * the string has to change — otherwise the renderer keeps a boundary that no
 * longer describes the document, and the next growth either replays rows the
 * terminal already holds or skips rows the reader has never seen.
 *
 * The screen and the history are read off a scrolling terminal, not off the
 * accumulated output, so a row is judged by where it actually landed.
 */
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { stripAnsi } from '../chrome/width.ts'
import { LocalTui, type TerminalLike } from './provider-local.ts'

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
describe('a search that opens a thought the run took', () => {
  /**
   * The freeze stops part-way through the answer. A thought-only hit aims the
   * reader at the thought, which is a row *before* the words; if that navigation
   * offset also became the answer's drawn start, the mapper would read the
   * block's span as starting earlier, see its length change, and freeze from
   * the wrong place — leaving the first unfrozen answer row in a hole that no
   * later write could fill.
   */
  it('does not skip the rows the opening made reachable', () => {
    const term = new ScrollingTerminal(80, 20)
    const tui = new LocalTui(term, 'm', false)
    // Long enough that scrolling actually pushes transcript rows into history;
    // a short document would leave the welcome chrome as the only history and
    // the test would assert nothing about the fold.
    const long = (count: number, label: string): string =>
      Array.from({ length: count }, (_, i) => `${label} ${i}`).join('\n\n')
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] }, 1))
    tui.event(ev('turn/start', { turn: 1 }, 2))
    tui.event(ev('tool/call', { turn: 1, step: 1, callId: 'a', name: 'read', arguments: '{"path":"a"}' }, 3))
    tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: 'a', content: [{ type: 'text', text: 'x' }] } }, 4))
    tui.event(ev('tool/call', { turn: 1, step: 1, callId: 'b', name: 'read', arguments: '{"path":"b"}' }, 5))
    tui.event(ev('tool/result', { message: { role: 'tool', toolCallId: 'b', content: [{ type: 'text', text: 'x' }] } }, 6))
    tui.event(ev('assistant/message', {
      turn: 1, step: 2,
      message: { role: 'assistant', content: [
        { type: 'reasoning', text: long(40, 'anchor thought') },
        { type: 'text', text: long(40, 'anchor body') },
      ] },
    }, 7))
    tui.event(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 8))
    tui.setStatus('idle')

    // Search only — no Ctrl+O. Opening a run with Ctrl+O adds its members'
    // thoughts to the host's own set, which would pre-expand the very thought
    // this test needs to be opened *by the search*, and the path under test
    // would never run. The run is therefore still folded here, which is exactly
    // the state a reader is in when they first search.
    // Snapshot before anything below: taking it afterwards and comparing the
    // same array to itself asserts nothing.
    const frozen = [...term.scrollback()]

    // Both the thought and the answer begin with `anchor`, so every query below
    // matches the same block and the run stays open throughout. Editing the
    // query down to nothing and back would close and reopen the run, and the
    // run's own open/fold would fire a reflow that hides a missing thought mark.
    // Each query is written as one string and confirmed, so it replaces the
    // previous query in a single frame. Typing it character by character would
    // pass through an empty query — which closes the run and reopens it, and
    // the run's own open/fold would fire a reflow that hides everything else.
    term.input.write('\x06') // ctrl+f opens transcript search
    term.input.write('anchor body 0')
    term.input.write('\r')
    expect(term.visible().join('\n')).toContain('anchor body 39')
    // The run is open; its thought is still folded.
    expect(term.visible().join('\n')).not.toContain('anchor thought 20')

    // Replace the whole query in one write: same block, run stays open, and the
    // thought opens while the navigation offset moves onto it.
    term.input.write('anchor thought 9')
    const afterSearch = term.visible().join('\n')

    // The thought's rows are on screen because the search reached into it.
    expect(afterSearch).toContain('anchor thought 9')
    // History the terminal already held is untouched by all of this.
    expect(term.scrollback().slice(0, frozen.length)).toEqual(frozen)
    // The freeze is real and stops part-way through the answer: the opening of
    // the answer is already in history, its tail is not, and the thought is not
    // either. Both are read out of the terminal rather than inferred from how
    // long the document is.
    const beforeSearch = frozen.map(row => row.trim())
    expect(beforeSearch).toContain('anchor body 0')
    expect(beforeSearch).not.toContain('anchor thought 9')
    // The first body row past the freeze, read out of the terminal rather than
    // guessed from how long the document is. It is not in history yet, and
    // after the round trip it has to be there exactly once: a boundary that
    // followed the thought's row instead of the answer's own would over-freeze
    // it along with everything after, and it would never be sent.
    const indexes = beforeSearch
      .map(row => /^anchor body (\d+)$/u.exec(row))
      .filter((match): match is RegExpExecArray => match !== null)
      .map(match => Number(match[1]))
      .sort((a, b) => a - b)
    // A contiguous prefix, so a gap in the middle is a missed row rather than
    // merely a row that has not been reached yet, and there is a real tail past
    // the freeze for the assertions below to be about.
    expect(indexes).toEqual(Array.from({ length: indexes.length }, (_, i) => i))
    expect(indexes.length).toBeGreaterThan(0)
    // The first body row past the freeze. It must be a row the terminal can
    // actually reach — a row beyond the window is neither on screen nor in
    // history, and asserting on it would be asserting the impossible.
    const tail = `anchor body ${indexes.length}`
    expect(beforeSearch).not.toContain(tail)
    expect(term.visible().join('\n')).toContain(tail)

    // Confirm the thought query first. Typing leaves the search *editing*, and
    // in that state the next text event is appended, so writing the body query
    // straight away would produce `anchor thought 9anchor body 0` — a query
    // that matches nothing, folding the run, and testing nothing.
    term.input.write('\r')
    term.input.write('anchor body 0')
    term.input.write('\r')
    expect(term.visible().join('\n')).toContain('anchor body 39')

    // Close the search and let the turn keep writing. The answer is long, so
    // this pushes real transcript rows through the ordinary flush: some of them
    // were never frozen, and they have to arrive exactly once.
    term.input.write('\x1b')
    tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'again' }] }, 9))
    tui.event(ev('turn/start', { turn: 2 }, 10))
    tui.event(ev('assistant/message', {
      turn: 2, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'second turn reply' }] },
    }, 11))
    tui.event(ev('turn/end', { turn: 2, reason: { kind: 'completed' } }, 12))
    tui.setStatus('idle')
    // Enough further writing to push the tail row off the screen, which is what
    // makes the ordinary flush responsible for it.
    for (let turn = 3; turn <= 6; turn += 1) {
      tui.event(ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: `more ${turn}` }] }, 100 + turn * 10))
      tui.event(ev('turn/start', { turn }, 100 + turn * 10 + 1))
      tui.event(ev('assistant/message', {
        turn, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: `reply turn ${turn}` }] },
      }, 100 + turn * 10 + 2))
      tui.event(ev('turn/end', { turn, reason: { kind: 'completed' } }, 100 + turn * 10 + 3))
      tui.setStatus('idle')
    }

    // Nothing the terminal holds may be submitted twice: a boundary that
    // stopped short of the new rows sends them again. The opposite failure — a
    // boundary that overshot and never commits them — is not what this asserts.
    const content = term.scrollback().map(row => row.trim()).filter(row => row !== '')
    // Blank and chrome rows recur by design, so uniqueness is over transcript
    // content, and the rows that scrolled off are checked by name.
    const transcript = content.filter(row => !row.startsWith('│') && !row.startsWith('╭') && !row.startsWith('╰'))

    expect(new Set(transcript).size).toBe(transcript.length)
    // The tail that was *not* frozen before the search arrives exactly once,
    // and the rows that were stay exactly once. A boundary that followed the
    // navigation offset instead of the answer's own position would over-freeze
    // this tail along with everything after it, and it would never be sent.
    for (const row of ['anchor body 0', tail]) {
      expect(transcript.filter(entry => entry === row).length).toBe(1)
    }
    tui.dispose()
  })
})
