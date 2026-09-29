/**
 * Folded reasoning contract: a thought is one line carrying the first line of
 * the last finished paragraph, or a bare marker while the first paragraph is
 * still being written. Every assertion is on display cells and on what a
 * terminal shows.
 */
import { describe, expect, it } from 'vitest'
import { blockLines, reasoningPreview } from './event-views.ts'
import { SYMBOL } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import type { Block } from './transcript-types.ts'

const plain = (lines: readonly string[]): string[] => lines.map(stripAnsi)
const theme = { getFgAnsi: () => '', fg: (t: string, s: string) => s, italic: (s: string) => s } as never

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

  it('is empty for empty or whitespace-only reasoning', () => {
    expect(reasoningPreview('', false)).toBe('')
    expect(reasoningPreview('   \n\n  ', true)).toBe('')
  })
})

describe('folded reasoning row', () => {
  it('renders one line for a settled thought and the answer below it', () => {
    const lines = plain(blockLines(assistant({
      reasoning: 'The user asks whether the cohort needs updating.\n\nAnd more detail here.',
    }), theme, 60))

    expect(lines[0]).toContain(SYMBOL.reasoning)
    expect(lines[0]).toContain('The user asks whether the cohort needs updating.')
    expect(lines[0]).not.toContain('And more detail here.')
    expect(lines.join('\n')).toContain('answer')
  })

  it('shows a bare marker while the first paragraph is still being written', () => {
    const lines = plain(blockLines(assistant({
      reasoning: 'One paragraph with no break yet',
      streaming: true,
      text: '',
    }), theme, 60))

    expect(stripAnsi(lines[0] ?? '').trim()).toBe(SYMBOL.reasoning)
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

  it('restores the whole thought when the reader opened it', () => {
    const block = assistant({ reasoning: 'first para\n\nsecond para with detail' })
    const folded = plain(blockLines(block, theme, 60))
    const opened = plain(blockLines(block, theme, 60, 0, false, true))

    expect(opened.join('\n')).toContain('second para with detail')
    expect(opened.length).toBeGreaterThan(folded.length)
    // Opening the thought does not disturb the answer below it.
    expect(opened.join('\n')).toContain('answer')
  })

  it('keeps the assistant padding so a folded thought reads as part of the reply', () => {
    const lines = blockLines(assistant({ reasoning: 'thought' }), theme, 12)

    expect(plain(lines)[0]).toMatch(/^ ⋆/u)
    expect(visibleWidth(lines[0]!)).toBe(12)
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
