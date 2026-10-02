import { describe, expect, it } from 'vitest'
import { blockLines } from './event-views.ts'
import { createTheme } from '../chrome/theme.ts'
import { stripAnsi, visibleWidth } from '../chrome/width.ts'
import type { Block } from './transcript-types.ts'

const thought = (streaming: boolean): Block => ({ kind: 'assistant', turn: 1, step: 1, text: '', reasoning: 'First paragraph.\n\nSecond paragraph.', streaming })

describe('thinking content', () => {
  it('keeps identical content when a thinking step settles', () => {
    expect(blockLines(thought(true), createTheme(false), 80)).toEqual(blockLines(thought(false), createTheme(false), 80))
  })
  it.each([false, true])('shows both paragraphs without a title or frame (colors=%s)', colors => {
    const rows = blockLines(thought(true), createTheme(colors), 80)
    const plain = rows.map(stripAnsi).join('\n')
    expect(plain).toContain('First paragraph.')
    expect(plain).toContain('Second paragraph.')
    expect(plain).not.toMatch(/Thinking|Thought|tok\/s|[╭╰│∴]/u)
    if (colors) {
      expect(rows.join('\n')).toContain('\x1b[3m')
      expect(rows.join('\n')).toContain(createTheme(true).getFgAnsi('thinkingText'))
    }
  })
  it('keeps the full thought before the complete answer', () => {
    const rows = blockLines({ ...thought(false), text: 'Answer one.\n\nAnswer two.' } as Block, createTheme(false), 80).join('\n')
    expect(rows.indexOf('Second paragraph.')).toBeLessThan(rows.indexOf('Answer one.'))
    expect(rows).toContain('Answer two.')
  })
  it.each([20, 80, 160])('wraps Unicode thinking at width %i with padding', width => {
    const rows = blockLines({ ...thought(true), reasoning: '检查🐳é'.repeat(50) } as Block, createTheme(true), width)
    expect(rows.every(row => visibleWidth(row) <= width)).toBe(true)
    expect(rows.every(row => stripAnsi(row).endsWith('  '))).toBe(true)
  })
})
