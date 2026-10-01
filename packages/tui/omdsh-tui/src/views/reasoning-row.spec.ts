/**
 * Folded reasoning contract: a thought is one `∴  Thought · …` row carrying the
 * first telling sentence of the last finished paragraph, or `∴  Thinking` while
 * the first paragraph is still being written. Every assertion is on display
 * cells and on what a terminal shows.
 */
import { describe, expect, it } from 'vitest'
import { blockLines, reasoningPreview } from './event-views.ts'
import { createTheme, SYMBOL } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import type { Block } from './transcript-types.ts'

const plain = (lines: readonly string[]): string[] => lines.map(stripAnsi)
const theme = createTheme(false)

function assistant(over: { reasoning: string; streaming?: boolean; text?: string }): Block {
  return {
    kind: 'assistant',
    turn: 1,
    step: 1,
    text: over.text ?? 'answer',
    reasoning: over.reasoning,
    streaming: over.streaming ?? false,
  }
}

describe('reasoningPreview', () => {
  it('takes the first line of the whole text once the block settles', () => {
    expect(reasoningPreview('opening line\nsecond line', false)).toBe('opening line')
  })

  it('skips leading blank lines', () => {
    expect(reasoningPreview('\n\n  opening line\nrest', false)).toBe('opening line')
  })

  it('waits for a finished paragraph while the model is still writing', () => {
    expect(reasoningPreview('One paragraph with no break yet', true)).toBe('')
  })

  it('advances to the last completed paragraph, never the one in flight', () => {
    const streaming = 'first paragraph\n\nsecond paragraph\n\nthird paragraph half-wr'
    expect(reasoningPreview(streaming, true)).toBe('second paragraph')
  })

  it('treats a blank line that is only whitespace as a paragraph break', () => {
    expect(reasoningPreview('alpha\n   \nbeta\n\ngamma in flight', true)).toBe('beta')
  })

  it('strips emphasis and code markers because the row is prose', () => {
    expect(reasoningPreview('run `pwd` then **bold**', false)).toBe('run pwd then bold')
  })

  it('skips an acknowledgement to reach the sentence it introduces', () => {
    // A preview that stops at `Good.` is a row of noise down the run.
    expect(reasoningPreview('Good. The lockfile pins rc.1 everywhere.', false))
      .toBe('The lockfile pins rc.1 everywhere.')
    expect(reasoningPreview('Hmm. OK. Now the real work starts here.', false))
      .toBe('Now the real work starts here.')
  })

  it('keeps an acknowledgement that is the whole thought', () => {
    expect(reasoningPreview('Good.', false)).toBe('Good.')
  })

  it('takes a closing quote with the sentence that ends inside it', () => {
    expect(reasoningPreview('The user asks: "is it done?" Then more follows here.', false))
      .toBe('The user asks: "is it done?"')
  })

  it('ends a CJK sentence at its own stop, with no space after it', () => {
    expect(reasoningPreview('先确认版本。然后再看锁文件。', false)).toBe('先确认版本。')
  })

  it('is empty for empty or whitespace-only reasoning', () => {
    expect(reasoningPreview('', false)).toBe('')
    expect(reasoningPreview('   \n\n  ', true)).toBe('')
  })
})

describe('folded reasoning row', () => {
  it('renders one line for a settled thought and the answer below it', () => {
    const lines = plain(blockLines(assistant({
      reasoning: 'The user asks whether the cohort needs updating.\n\nAnd more detail here.',
    }), theme, 72))

    expect(lines[0]).toContain(SYMBOL.reasoning)
    expect(lines[0]).toContain('Thought · The user asks whether the cohort needs updating.')
    expect(lines[0]).not.toContain('And more detail here.')
    expect(lines.join('\n')).toContain('answer')
  })

  it('says it is thinking while the first paragraph is still being written', () => {
    const lines = plain(blockLines(assistant({
      reasoning: 'One paragraph with no break yet',
      streaming: true,
      text: '',
    }), theme, 60))

    expect(stripAnsi(lines[0] ?? '').trim()).toBe(`${SYMBOL.reasoning} Thinking`)
    // No half sentence is shown, only the streaming placeholder for the answer.
    expect(lines.join('\n')).not.toContain('One paragraph')
  })

  it('never shows a half-written sentence as its preview', () => {
    const lines = plain(blockLines(assistant({
      reasoning: 'alpha\n\nbeta complete\n\ngamma is only half',
      streaming: true,
      text: '',
    }), theme, 60))

    expect(lines[0]).toContain('beta complete')
    expect(lines[0]).not.toContain('gamma')
  })

  it('never marks a streaming preview as finished', () => {
    // The text continues past the right edge, so a settled row's ellipsis would
    // be claiming an ending that has not happened — a small lie the reader has to
    // notice and then go check. A streaming row is cut because the row is full,
    // not because the thought ended, and the width says so on its own.
    const long = 'alpha\n\n' + 'beta '.repeat(40) + '\n\ngamma is only half'
    const row = plain(blockLines(assistant({ reasoning: long, streaming: true, text: '' }), theme, 40))[0] ?? ''

    expect(row).toContain('beta')
    expect(row).not.toContain('…')
    expect(visibleWidth(row)).toBe(40)
  })

  it('restores the whole thought when the reader opened it', () => {
    const block = assistant({ reasoning: 'first para\n\nsecond para with detail' })
    const folded = plain(blockLines(block, theme, 60))
    const opened = plain(blockLines(block, theme, 60, 0, false, true))

    expect(opened.join('\n')).toContain('second para with detail')
    expect(opened.length).toBeGreaterThan(folded.length)
    // Opening the thought does not disturb the answer below it.
    expect(opened.join('\n')).toContain('answer')
  })

  it('puts the mark in the first column, where every other mark is', () => {
    const lines = blockLines(assistant({ reasoning: 'thought' }), theme, 40)

    expect(plain(lines)[0]).toMatch(/^∴ /u)
    expect(visibleWidth(lines[0]!)).toBe(40)
  })

  it('previews a whole sentence rather than a line that runs off the edge', () => {
    // The first sentence has to end well before the right edge, or taking the
    // first *line* would fill the row with the continuation and the two would be
    // indistinguishable. Filling the row with the rest of the clause was what
    // made a long turn come back as a wall of identically truncated rows.
    const long = 'The user typed it. Then a long tail follows, and it keeps going well past the edge of this row.'
    const row = plain(blockLines(assistant({ reasoning: long }), theme, 80))[0] ?? ''

    expect(row).toContain('The user typed it.')
    expect(row).not.toContain('long tail follows')
    expect(row).not.toContain('…')
  })

  it('says so when a thought never closes on a sentence', () => {
    const runOn = 'a'.repeat(200)
    const row = plain(blockLines(assistant({ reasoning: runOn }), theme, 80))[0] ?? ''

    expect(row).toContain('…')
    expect(visibleWidth(row)).toBe(80)
  })

  describe('width discipline', () => {
    for (const width of [20, 40, 80, 120]) {
      it(`fills exactly ${width} display cells`, () => {
        const lines = blockLines(assistant({ reasoning: 'a'.repeat(300) }), theme, width)

        expect(visibleWidth(lines[0]!)).toBe(width)
      })
    }

    it('truncates a CJK and emoji thought by display cell', () => {
      const lines = blockLines(assistant({ reasoning: '检查配置并运行测试 🎉 '.repeat(30) }), theme, 40)

      expect(visibleWidth(lines[0]!)).toBe(40)
    })
  })
})
